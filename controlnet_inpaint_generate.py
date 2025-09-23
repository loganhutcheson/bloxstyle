#!/usr/bin/env python3
import argparse
import os
from typing import Optional

import numpy as np
from PIL import Image, ImageOps, ImageFilter
from collections import deque

import torch
from diffusers import (
    ControlNetModel,
    StableDiffusionControlNetInpaintPipeline,
)


DEFAULT_OUTLINE_PATH = os.path.join(os.path.dirname(__file__), "Template-Shirts-Outline.png")
DEFAULT_TEMPLATE_PATH = os.path.join(os.path.dirname(__file__), "Template-Shirts-R15.png")
DEFAULT_OUTPUT_DIR = os.path.join(os.path.dirname(__file__), "generated")


def load_image(path: str) -> Image.Image:
    img = Image.open(path)
    # If PNG has transparency, composite over white so transparent areas become white, not black
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


def create_control_image_from_outline(outline_img: Image.Image, width: int, height: int) -> Image.Image:
    """Create a high-contrast control image for the scribble model: black lines on white background."""
    img = outline_img.convert("L")
    img = ImageOps.autocontrast(img)
    arr = np.array(img)
    threshold = 200
    # Produce white background (255) with black strokes (0)
    binary = np.where(arr < threshold, 0, 255).astype(np.uint8)
    img_bin = Image.fromarray(binary, mode="L")
    img_rgb = img_bin.convert("RGB")
    img_rgb = ensure_size(img_rgb, width, height)
    return img_rgb


def create_inpaint_mask_from_outline(outline_img: Image.Image, width: int, height: int, dilate: int = 1) -> Image.Image:
    """Build inpainting mask from outline strokes: white=interior to paint, black=background."""
    gray = outline_img.convert("L")
    gray = ImageOps.autocontrast(gray)
    arr = np.array(gray)

    threshold = 200
    # 0 for lines, 255 for non-lines
    bin_img = np.where(arr < threshold, 0, 255).astype(np.uint8)

    # Dilate lines to ensure closed boundaries
    mask_img = Image.fromarray(bin_img, mode="L")
    for _ in range(max(0, dilate)):
        mask_img = mask_img.filter(ImageFilter.MinFilter(size=3))  # shrink white / thicken black lines
        mask_img = mask_img.filter(ImageFilter.MaxFilter(size=3))  # optional close
    mask_img = ensure_size(mask_img, width, height)
    bin_img = np.array(mask_img)

    h, w = bin_img.shape
    visited = np.zeros((h, w), dtype=bool)
    q = deque()

    # Initialize queue with all border white pixels (background)
    for x in range(w):
        if bin_img[0, x] == 255:
            q.append((0, x))
        if bin_img[h - 1, x] == 255:
            q.append((h - 1, x))
    for y in range(h):
        if bin_img[y, 0] == 255:
            q.append((y, 0))
        if bin_img[y, w - 1] == 255:
            q.append((y, w - 1))

    # Flood fill background across white areas
    while q:
        y, x = q.popleft()
        if visited[y, x]:
            continue
        if bin_img[y, x] != 255:
            continue
        visited[y, x] = True
        if y > 0:
            q.append((y - 1, x))
        if y < h - 1:
            q.append((y + 1, x))
        if x > 0:
            q.append((y, x - 1))
        if x < w - 1:
            q.append((y, x + 1))

    # Interior is white but not reachable from border
    interior = (bin_img == 255) & (~visited)
    inpaint_mask = np.zeros_like(bin_img, dtype=np.uint8)
    inpaint_mask[interior] = 255  # white to paint

    return Image.fromarray(inpaint_mask, mode="L")


def create_inpaint_mask_from_black_regions(img_with_black: Image.Image, width: int, height: int, dilate: int = 1) -> Image.Image:
    """Build inpainting mask where black-filled regions are the paint area (white in mask)."""
    gray = img_with_black.convert("L")
    gray = ImageOps.autocontrast(gray)
    arr = np.array(gray)
    # White mask where pixels are dark (inside black rectangles)
    mask = (arr < 128).astype(np.uint8) * 255
    mask_img = Image.fromarray(mask, mode="L")
    # Slight dilation to ensure coverage
    for _ in range(max(0, dilate)):
        mask_img = mask_img.filter(ImageFilter.MaxFilter(size=3))
    mask_img = ensure_size(mask_img, width, height)
    return mask_img


def pick_init_image(width: int, height: int, template_path: Optional[str]) -> Image.Image:
    if template_path and os.path.exists(template_path):
        base = load_image(template_path)
        return ensure_size(base, width, height)
    return Image.new("RGB", (width, height), color=(255, 255, 255))


def pick_device_and_dtype():
    if torch.cuda.is_available():
        return ("cuda", torch.float16)
    if torch.backends.mps.is_available():
        # On Apple MPS, float16 often produces black images/NaNs. Prefer float32.
        return ("mps", torch.float32)
    return ("cpu", torch.float32)


def build_pipeline(device: str, dtype: torch.dtype, disable_safety: bool = False):
    controlnet_id = "lllyasviel/control_v11p_sd15_scribble"
    base_model_id = "runwayml/stable-diffusion-inpainting"

    controlnet = ControlNetModel.from_pretrained(controlnet_id, torch_dtype=dtype)
    pipe = StableDiffusionControlNetInpaintPipeline.from_pretrained(
        base_model_id,
        controlnet=controlnet,
        torch_dtype=dtype,
    )
    if disable_safety:
        # Disable safety checker to avoid false positives turning images black
        try:
            pipe.safety_checker = lambda images, clip_input: (images, [False])
        except Exception:
            pass
    pipe.enable_attention_slicing()
    try:
        pipe.enable_vae_slicing()
    except Exception:
        pass
    if device == "cuda":
        try:
            pipe.enable_xformers_memory_efficient_attention()
        except Exception:
            pass
    pipe = pipe.to(device)
    return pipe


def run_generation(
    prompt: str,
    negative_prompt: Optional[str],
    width: int,
    height: int,
    steps: int,
    guidance: float,
    cn_scale: float,
    seed: Optional[int],
    num_images: int,
    outline_path: str,
    template_path: Optional[str],
    output_dir: str,
    dilate_mask: int,
    disable_safety: bool,
    mask_from_black: bool,
    save_debug: bool,
):
    os.makedirs(output_dir, exist_ok=True)

    outline_img = load_image(outline_path)
    control_img = create_control_image_from_outline(outline_img, width, height)
    if mask_from_black:
        mask_img = create_inpaint_mask_from_black_regions(outline_img, width, height, dilate=dilate_mask)
    else:
        mask_img = create_inpaint_mask_from_outline(outline_img, width, height, dilate=dilate_mask)

    if save_debug:
        control_img.save(os.path.join(output_dir, "debug_control.png"))
        mask_img.save(os.path.join(output_dir, "debug_mask.png"))
    init_img = pick_init_image(width, height, template_path)

    device, dtype = pick_device_and_dtype()
    pipe = build_pipeline(device, dtype, disable_safety=disable_safety)

    generator = None
    if seed is not None:
        generator = torch.Generator(device=device).manual_seed(seed)

    result = pipe(
        prompt=prompt,
        negative_prompt=negative_prompt,
        image=init_img,
        mask_image=mask_img,
        control_image=control_img,
        num_inference_steps=steps,
        guidance_scale=guidance,
        controlnet_conditioning_scale=cn_scale,
        generator=generator,
        num_images_per_prompt=num_images,
    )

    images = result.images
    saved = []
    for i, img in enumerate(images):
        fname = f"shirt_gen_{i+1:03d}.png"
        path = os.path.join(output_dir, fname)
        img.save(path)
        saved.append(path)
    return saved


def parse_args():
    parser = argparse.ArgumentParser(description="Generate Roblox shirts with SD Inpaint + ControlNet (scribble)")
    parser.add_argument("--prompt", type=str, required=True, help="Text prompt")
    parser.add_argument("--negative-prompt", type=str, default=None, help="Negative prompt")
    parser.add_argument("--width", type=int, default=512, help="Output width (multiple of 8)")
    parser.add_argument("--height", type=int, default=512, help="Output height (multiple of 8)")
    parser.add_argument("--steps", type=int, default=30, help="Inference steps")
    parser.add_argument("--guidance", type=float, default=7.0, help="Classifier-free guidance scale")
    parser.add_argument("--cn-scale", type=float, default=0.9, help="ControlNet conditioning scale")
    parser.add_argument("--seed", type=int, default=None, help="Random seed")
    parser.add_argument("--num-images", type=int, default=1, help="Number of images to generate")
    parser.add_argument("--outline", type=str, default=DEFAULT_OUTLINE_PATH, help="Path to Template-Shirts-Outline.png")
    parser.add_argument("--template", type=str, default=DEFAULT_TEMPLATE_PATH, help="Optional init image (Template-Shirts-R15.png)")
    parser.add_argument("--output", type=str, default=DEFAULT_OUTPUT_DIR, help="Output directory")
    parser.add_argument("--dilate-mask", type=int, default=1, help="Mask dilation iterations (expand paint area)")
    parser.add_argument("--disable-safety", action="store_true", help="Disable safety checker (avoid false black images)")
    parser.add_argument("--mask-from-black", action="store_true", help="Treat black regions in outline PNG as paint area")
    parser.add_argument("--save-debug", action="store_true", help="Save control and mask images for debugging")
    return parser.parse_args()


def main():
    args = parse_args()
    paths = run_generation(
        prompt=args.prompt,
        negative_prompt=args.negative_prompt,
        width=args.width,
        height=args.height,
        steps=args.steps,
        guidance=args.guidance,
        cn_scale=args.cn_scale,
        seed=args.seed,
        num_images=args.num_images,
        outline_path=args.outline,
        template_path=args.template,
        output_dir=args.output,
        dilate_mask=args.dilate_mask,
        disable_safety=args.disable_safety,
        mask_from_black=args.mask_from_black,
        save_debug=args.save_debug,
    )
    print("Saved:")
    for p in paths:
        print(p)


if __name__ == "__main__":
    main()

