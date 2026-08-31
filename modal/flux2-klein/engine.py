from __future__ import annotations

import io
import os
import random
from dataclasses import dataclass

from PIL import Image


MODEL_ID = os.getenv("FLUX_MODEL_ID", "black-forest-labs/FLUX.2-klein-4B")
DEFAULT_PROMPT = "Preserve the clothing template layout and edit only what is requested."
WATCH_PROMPT = (
    "Refine only the already-drawn watch into a clean 2D Roblox clothing-texture illustration "
    "of a silver analog wristwatch. Preserve the exact circle, complete strap, orientation, size, "
    "and background. Add a readable bezel, simple hands, and restrained cartoon shading. "
    "Do not add text, extra objects, arms, people, or scenery."
)


@dataclass(frozen=True)
class GenerationSettings:
    steps: int = 4
    max_side: int = 1024


def generation_size(width: int, height: int, max_side: int = 1024) -> tuple[int, int]:
    if width < 1 or height < 1:
        raise ValueError("Image dimensions must be positive")

    scale = min(1.0, max_side / max(width, height))
    scaled_width = max(64, round(width * scale / 16) * 16)
    scaled_height = max(64, round(height * scale / 16) * 16)
    return scaled_width, scaled_height


class FluxEditor:
    def __init__(self, device: str | None = None) -> None:
        import torch
        from diffusers import Flux2KleinPipeline

        self.device = device or ("mps" if torch.backends.mps.is_available() else "cpu")
        if self.device == "cuda":
            dtype = torch.bfloat16
        elif self.device == "mps":
            dtype = torch.float16
        else:
            dtype = torch.float32

        self._torch = torch
        self.pipe = Flux2KleinPipeline.from_pretrained(
            MODEL_ID,
            torch_dtype=dtype,
            low_cpu_mem_usage=True,
        )
        self.pipe.to(self.device)
        self.pipe.set_progress_bar_config(disable=False)

    def edit(
        self,
        image_bytes: bytes,
        prompt: str | None,
        seed: int | None = None,
        settings: GenerationSettings = GenerationSettings(),
    ) -> bytes:
        source = Image.open(io.BytesIO(image_bytes)).convert("RGB")
        original_size = source.size
        width, height = generation_size(*original_size, max_side=settings.max_side)
        source = source.resize((width, height), Image.Resampling.LANCZOS)

        clean_prompt = (prompt or "").strip()
        if not clean_prompt:
            clean_prompt = DEFAULT_PROMPT
        else:
            clean_prompt = f"{DEFAULT_PROMPT} {clean_prompt}"

        chosen_seed = seed if seed is not None else random.SystemRandom().randrange(2**32)
        generator = self._torch.Generator(device=self.device).manual_seed(chosen_seed)

        with self._torch.inference_mode():
            result = self.pipe(
                image=source,
                prompt=clean_prompt,
                width=width,
                height=height,
                num_inference_steps=settings.steps,
                guidance_scale=1.0,
                generator=generator,
            ).images[0]

        if result.size != original_size:
            result = result.resize(original_size, Image.Resampling.LANCZOS)

        output = io.BytesIO()
        result.save(output, format="PNG")
        return output.getvalue()

    def render_watch(self, image_bytes: bytes, mask_bytes: bytes) -> bytes:
        source, mask = validate_watch_inputs(image_bytes, mask_bytes)
        generated_bytes = self.edit(image_bytes, WATCH_PROMPT, seed=1)
        generated = Image.open(io.BytesIO(generated_bytes)).convert("RGB")
        if generated.size != source.size:
            generated = generated.resize(source.size, Image.Resampling.LANCZOS)
        return composite_watch_result(source, generated, mask)


def validate_watch_inputs(image_bytes: bytes, mask_bytes: bytes) -> tuple[Image.Image, Image.Image]:
    source = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    mask = Image.open(io.BytesIO(mask_bytes)).convert("L")
    if source.size != (512, 512) or mask.size != source.size:
        raise ValueError("Watch image and mask must both be 512 x 512")

    extrema = mask.getextrema()
    if extrema == (0, 0):
        raise ValueError("Watch mask is empty")
    histogram = mask.histogram()
    non_black = sum(histogram[1:])
    if non_black > source.width * source.height * 0.6:
        raise ValueError("Watch mask covers too much of the crop")
    return source, mask


def composite_watch_result(source: Image.Image, generated: Image.Image, mask: Image.Image) -> bytes:
    safe_result = Image.composite(generated.convert("RGB"), source.convert("RGB"), mask.convert("L"))
    output = io.BytesIO()
    safe_result.save(output, format="PNG")
    return output.getvalue()
