#!/usr/bin/env python3
"""
Stable Diffusion 3.5 inference for Roblox shirt templates (text2img or img2img).

This DOES NOT use ControlNet. SD3.5 currently does not have a drop-in
ControlNet Inpaint equivalent like SD 1.5. Use this to evaluate style quality
and general capabilities of SD3.5 on your prompts at the exact template size.

Default model: stabilityai/stable-diffusion-3.5-medium

Examples:
  # Text-to-image
  python inference_shirt_sd35.py \
    --prompt "rbx_shirt, clean seams, minimal shading" \
    --width 585 --height 559 \
    --steps 28 --guidance 5.5 --num_images 2 --seed 42 \
    --output generated_sd35

  # Image-to-image (optional init image)
  python inference_shirt_sd35.py \
    --prompt "rbx_shirt, clean seams, minimal shading" \
    --init_image Template-Shirts-Outline.png \
    --strength 0.65 \
    --width 585 --height 559 \
    --steps 28 --guidance 5.5 --num_images 2 --seed 42 \
    --output generated_sd35
"""

import os
import argparse
from typing import Optional

import torch
from PIL import Image

from diffusers import (
    StableDiffusion3Pipeline,
)

try:
    from diffusers import StableDiffusion3Img2ImgPipeline
    HAS_IMG2IMG = True
except Exception:
    HAS_IMG2IMG = False


def pick_device_and_dtype():
    if torch.cuda.is_available():
        return ("cuda", torch.float16)
    if torch.backends.mps.is_available():
        return ("mps", torch.float32)
    return ("cpu", torch.float32)


def load_image(path: str) -> Image.Image:
    img = Image.open(path)
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        alpha = img.convert("RGBA")
        background = Image.new("RGBA", alpha.size, (255, 255, 255, 255))
        composited = Image.alpha_composite(background, alpha)
        return composited.convert("RGB")
    return img.convert("RGB")


def ensure_size(img: Image.Image, width: int, height: int) -> Image.Image:
    if img.size == (width, height):
        return img
    return img.resize((width, height), resample=Image.Resampling.BICUBIC)


def run_text2img(model_id: str, prompt: str, negative_prompt: Optional[str], width: int, height: int, steps: int, guidance: float, num_images: int, seed: Optional[int], output_dir: str, disable_safety: bool):
    os.makedirs(output_dir, exist_ok=True)
    device, dtype = pick_device_and_dtype()
    pipe = StableDiffusion3Pipeline.from_pretrained(model_id, torch_dtype=dtype)
    if disable_safety:
        try:
            pipe.safety_checker = None
        except Exception:
            pass
    pipe.to(device)
    try:
        pipe.enable_vae_slicing(); pipe.enable_attention_slicing()
    except Exception:
        pass

    generator = None
    if seed is not None:
        generator = torch.Generator(device=device).manual_seed(seed)

    result = pipe(
        prompt=prompt,
        negative_prompt=negative_prompt,
        num_inference_steps=steps,
        guidance_scale=guidance,
        width=width,
        height=height,
        num_images_per_prompt=num_images,
        generator=generator,
    )
    for i, img in enumerate(result.images):
        out_path = os.path.join(output_dir, f"sd35_gen_{i+1:03d}.png")
        img.save(out_path)
        print(f"Saved {out_path}")


def run_img2img(model_id: str, prompt: str, negative_prompt: Optional[str], init_image_path: str, strength: float, width: int, height: int, steps: int, guidance: float, num_images: int, seed: Optional[int], output_dir: str, disable_safety: bool):
    if not HAS_IMG2IMG:
        raise RuntimeError("diffusers installation does not provide StableDiffusion3Img2ImgPipeline; update diffusers.")

    os.makedirs(output_dir, exist_ok=True)
    device, dtype = pick_device_and_dtype()
    pipe = StableDiffusion3Img2ImgPipeline.from_pretrained(model_id, torch_dtype=dtype)
    if disable_safety:
        try:
            pipe.safety_checker = None
        except Exception:
            pass
    pipe.to(device)
    try:
        pipe.enable_vae_slicing(); pipe.enable_attention_slicing()
    except Exception:
        pass

    init_img = load_image(init_image_path)
    init_img = ensure_size(init_img, width, height)

    generator = None
    if seed is not None:
        generator = torch.Generator(device=device).manual_seed(seed)

    result = pipe(
        prompt=prompt,
        negative_prompt=negative_prompt,
        image=init_img,
        strength=strength,
        num_inference_steps=steps,
        guidance_scale=guidance,
        num_images_per_prompt=num_images,
        generator=generator,
    )
    for i, img in enumerate(result.images):
        out_path = os.path.join(output_dir, f"sd35_img2img_{i+1:03d}.png")
        img.save(out_path)
        print(f"Saved {out_path}")


def parse_args():
    p = argparse.ArgumentParser(description="Stable Diffusion 3.5 inference (text2img or img2img)")
    p.add_argument("--model", type=str, default="stabilityai/stable-diffusion-3.5-medium")
    p.add_argument("--prompt", type=str, required=True)
    p.add_argument("--negative_prompt", type=str, default=None)
    p.add_argument("--width", type=int, default=585)
    p.add_argument("--height", type=int, default=559)
    p.add_argument("--steps", type=int, default=28)
    p.add_argument("--guidance", type=float, default=5.5)
    p.add_argument("--num_images", type=int, default=1)
    p.add_argument("--seed", type=int, default=None)
    p.add_argument("--output", type=str, default="generated_sd35")
    p.add_argument("--disable_safety", action="store_true")
    # img2img
    p.add_argument("--init_image", type=str, default=None)
    p.add_argument("--strength", type=float, default=0.6)
    return p.parse_args()


def main():
    args = parse_args()
    if args.init_image:
        run_img2img(
            model_id=args.model,
            prompt=args.prompt,
            negative_prompt=args.negative_prompt,
            init_image_path=args.init_image,
            strength=args.strength,
            width=args.width,
            height=args.height,
            steps=args.steps,
            guidance=args.guidance,
            num_images=args.num_images,
            seed=args.seed,
            output_dir=args.output,
            disable_safety=args.disable_safety,
        )
    else:
        run_text2img(
            model_id=args.model,
            prompt=args.prompt,
            negative_prompt=args.negative_prompt,
            width=args.width,
            height=args.height,
            steps=args.steps,
            guidance=args.guidance,
            num_images=args.num_images,
            seed=args.seed,
            output_dir=args.output,
            disable_safety=args.disable_safety,
        )


if __name__ == "__main__":
    main()


