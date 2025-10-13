#!/usr/bin/env python3
"""
Shirt LoRA Inference with ControlNet Inpaint integration
Loads LoRA into the StableDiffusionControlNetInpaintPipeline used by controlnet_inpaint_generate.py
"""

import os
import json
import argparse
import torch
from PIL import Image
from diffusers import (
    ControlNetModel,
    StableDiffusionControlNetInpaintPipeline,
    DPMSolverMultistepScheduler,
)

from controlnet_inpaint_generate import (
    load_image,
    create_control_image_from_outline,
    create_inpaint_mask_from_outline,
    create_inpaint_mask_from_black_regions,
    ensure_size,
)

def _round_up_to_multiple_of_8(n: int) -> int:
    return (n + 7) // 8 * 8

def _pad_to_size(img: Image.Image, target_w: int, target_h: int, fill=(255, 255, 255)) -> Image.Image:
    if img.size == (target_w, target_h):
        return img
    canvas = Image.new("RGB", (target_w, target_h), fill)
    canvas.paste(img, (0, 0))
    return canvas

def load_custom_lora_weights_into_unet(unet, lora_path, lora_scale=0.75, default_alpha=32):
    print(f"Loading LoRA weights from {lora_path}...")
    lora_state_dict = torch.load(lora_path, map_location="cpu")
    config = None
    config_path = lora_path.replace('.safetensors', '_config.json')
    if os.path.exists(config_path):
        with open(config_path, 'r') as f:
            config = json.load(f)
        print(f"Loaded LoRA config: {config}")
    unet_dtype = next(unet.parameters()).dtype
    for name, module in unet.named_modules():
        if "attn2" in name:
            device = next(unet.parameters()).device
            alpha = config.get('lora_alpha', default_alpha) if isinstance(config, dict) else default_alpha
            def apply_lora(linear_layer, key_prefix):
                down_key = f"{key_prefix}.lora_down.weight"
                up_key = f"{key_prefix}.lora_up.weight"
                if down_key in lora_state_dict and up_key in lora_state_dict:
                    rank = lora_state_dict[down_key].shape[0]
                    lora_down = torch.nn.Linear(linear_layer.in_features, rank, bias=False)
                    lora_up = torch.nn.Linear(rank, linear_layer.out_features, bias=False)
                    lora_down.weight.data = lora_state_dict[down_key]
                    lora_up.weight.data = lora_state_dict[up_key]
                    # Match device and dtype of UNet
                    lora_down.to(device=device, dtype=unet_dtype)
                    lora_up.to(device=device, dtype=unet_dtype)
                    base_scale = alpha / rank
                    scale = lora_scale * base_scale
                    original_forward = linear_layer.forward
                    def lora_forward(x, original=original_forward, down=lora_down, up=lora_up, s=scale):
                        x_dtype = x.dtype
                        y = up(down(x.to(unet_dtype)))
                        y = y.to(x_dtype)
                        return original(x) + s * y
                    linear_layer.forward = lora_forward
                    return True
                return False
            for proj in ["to_q", "to_k", "to_v"]:
                if hasattr(module, proj):
                    apply_lora(getattr(module, proj), f"{name}.{proj}")
            if hasattr(module, "to_out"):
                try:
                    apply_lora(module.to_out[0], f"{name}.to_out.0")
                except Exception:
                    pass
    print("LoRA weights loaded into UNet.")

def load_custom_lora_weights_into_controlnet(controlnet, lora_path, lora_scale=0.75, default_alpha=32):
    print(f"Loading ControlNet LoRA weights from {lora_path}...")
    lora_state_dict = torch.load(lora_path, map_location="cpu")
    config = None
    config_path = lora_path.replace('.safetensors', '_config.json')
    if os.path.exists(config_path):
        with open(config_path, 'r') as f:
            config = json.load(f)
        print(f"Loaded ControlNet LoRA config: {config}")
    cn_dtype = next(controlnet.parameters()).dtype
    device = next(controlnet.parameters()).device

    alpha = config.get('lora_alpha', default_alpha) if isinstance(config, dict) else default_alpha

    def apply_lora(linear_layer, key_prefix):
        down_key = f"{key_prefix}.lora_down.weight"
        up_key = f"{key_prefix}.lora_up.weight"
        if down_key in lora_state_dict and up_key in lora_state_dict:
            rank = lora_state_dict[down_key].shape[0]
            lora_down = torch.nn.Linear(linear_layer.in_features, rank, bias=False)
            lora_up = torch.nn.Linear(rank, linear_layer.out_features, bias=False)
            lora_down.weight.data = lora_state_dict[down_key]
            lora_up.weight.data = lora_state_dict[up_key]
            lora_down.to(device=device, dtype=cn_dtype)
            lora_up.to(device=device, dtype=cn_dtype)
            base_scale = alpha / rank
            scale = lora_scale * base_scale
            original_forward = linear_layer.forward
            def lora_forward(x, original=original_forward, down=lora_down, up=lora_up, s=scale):
                x_dtype = x.dtype
                y = up(down(x.to(cn_dtype)))
                y = y.to(x_dtype)
                return original(x) + s * y
            linear_layer.forward = lora_forward
            return True
        return False

    attached = 0
    for name, module in controlnet.named_modules():
        if "attn2" in name:
            for proj in ["to_q", "to_k", "to_v"]:
                if hasattr(module, proj):
                    if apply_lora(getattr(module, proj), f"{name}.{proj}"):
                        attached += 1
            if hasattr(module, "to_out"):
                try:
                    if apply_lora(module.to_out[0], f"{name}.to_out.0"):
                        attached += 1
                except Exception:
                    pass
    print(f"LoRA weights loaded into ControlNet. Attached: {attached}")

def pick_device_and_dtype():
    if torch.cuda.is_available():
        return ("cuda", torch.float16)
    if torch.backends.mps.is_available():
        return ("mps", torch.float32)
    return ("cpu", torch.float32)

def main():
    parser = argparse.ArgumentParser(description="Inference for Shirt LoRA with ControlNet Inpainting")
    parser.add_argument("--lora_path", type=str, default=None, help="Optional UNet LoRA weights (.safetensors)")
    parser.add_argument("--prompt", type=str, required=True)
    parser.add_argument("--negative_prompt", type=str, default=None)
    # Defaults now resolve from the current working directory
    parser.add_argument("--outline", type=str, default="Template-Shirts-Outline.png")
    parser.add_argument("--template", type=str, default=None, help="Optional init image (R15). If omitted/missing, a white canvas is used")
    parser.add_argument("--output", type=str, default="generated")
    parser.add_argument("--width", type=int, default=585)
    parser.add_argument("--height", type=int, default=559)
    parser.add_argument("--steps", type=int, default=30)
    parser.add_argument("--guidance", type=float, default=7.0)
    parser.add_argument("--cn_scale", type=float, default=1.0)
    parser.add_argument("--num_images", type=int, default=1)
    parser.add_argument("--seed", type=int, default=None)
    parser.add_argument("--mask_from_black", action="store_true")
    parser.add_argument("--dilate_mask", type=int, default=2)
    parser.add_argument("--disable_safety", action="store_true")
    parser.add_argument("--lora_scale", type=float, default=0.75)
    parser.add_argument("--controlnet_lora_path", type=str, default=None, help="Optional path to ControlNet LoRA (.safetensors)")
    parser.add_argument("--controlnet_id", type=str, default="lllyasviel/control_v11p_sd15_lineart", help="ControlNet model id")
    parser.add_argument("--save_debug", action="store_true", help="Save control and mask images for debugging")
    parser.add_argument("--paint_all", action="store_true", help="Paint entire canvas (use full-white mask) to rule out mask issues")
    args = parser.parse_args()

    # Normalize incoming paths relative to current working directory
    if args.lora_path and not os.path.isabs(args.lora_path):
        args.lora_path = os.path.abspath(args.lora_path)
    if args.outline and not os.path.isabs(args.outline):
        args.outline = os.path.abspath(args.outline)
    if args.template and not os.path.isabs(args.template):
        args.template = os.path.abspath(args.template)
    if args.output and not os.path.isabs(args.output):
        args.output = os.path.abspath(args.output)
    if args.controlnet_lora_path and not os.path.isabs(args.controlnet_lora_path):
        args.controlnet_lora_path = os.path.abspath(args.controlnet_lora_path)

    os.makedirs(args.output, exist_ok=True)
    outline_img = load_image(args.outline)
    control_img = create_control_image_from_outline(outline_img, args.width, args.height)
    if args.paint_all:
        mask_img = Image.new("L", (args.width, args.height), 255)
    else:
        if args.mask_from_black:
            mask_img = create_inpaint_mask_from_black_regions(outline_img, args.width, args.height, dilate=args.dilate_mask)
        else:
            mask_img = create_inpaint_mask_from_outline(outline_img, args.width, args.height, dilate=args.dilate_mask)
    if args.template and os.path.exists(args.template):
        template_img = load_image(args.template)
        template_img = ensure_size(template_img, args.width, args.height)
    else:
        template_img = Image.new("RGB", (args.width, args.height), color=(255, 255, 255))

    # Pad all inputs to multiples of 8 for the model, then crop outputs back to requested size
    req_w, req_h = args.width, args.height
    pad_w, pad_h = _round_up_to_multiple_of_8(req_w), _round_up_to_multiple_of_8(req_h)
    if (pad_w, pad_h) != (req_w, req_h):
        control_img = _pad_to_size(control_img, pad_w, pad_h, fill=(255, 255, 255))
        # For inpaint mask: black (0) means keep, white (255) means paint; pad with black to avoid painting outside
        mask_rgb = mask_img.convert("L")
        mask_canvas = Image.new("L", (pad_w, pad_h), 0)
        mask_canvas.paste(mask_rgb, (0, 0))
        mask_img = mask_canvas
        template_img = _pad_to_size(template_img, pad_w, pad_h, fill=(255, 255, 255))

    # Optional debug saves
    if args.save_debug:
        try:
            control_img.save(os.path.join(args.output, "debug_control.png"))
            mask_img.save(os.path.join(args.output, "debug_mask.png"))
        except Exception:
            pass

    device, dtype = pick_device_and_dtype()
    controlnet_id = args.controlnet_id
    base_model_id = "runwayml/stable-diffusion-inpainting"
    controlnet = ControlNetModel.from_pretrained(controlnet_id, torch_dtype=dtype)
    pipe = StableDiffusionControlNetInpaintPipeline.from_pretrained(
        base_model_id,
        controlnet=controlnet,
        torch_dtype=dtype,
        safety_checker=None if args.disable_safety else None,
    ).to(device)
    try:
        pipe.enable_vae_slicing(); pipe.enable_attention_slicing()
    except Exception:
        pass
    pipe.scheduler = DPMSolverMultistepScheduler.from_config(pipe.scheduler.config)

    # Inject UNet LoRA (optional)
    if args.lora_path and os.path.exists(args.lora_path):
        load_custom_lora_weights_into_unet(pipe.unet, args.lora_path, lora_scale=args.lora_scale)
    if args.controlnet_lora_path and os.path.exists(args.controlnet_lora_path):
        load_custom_lora_weights_into_controlnet(pipe.controlnet, args.controlnet_lora_path, lora_scale=1.0)

    generator = None
    if args.seed is not None:
        generator = torch.Generator(device=device).manual_seed(args.seed)

    result = pipe(
        prompt=args.prompt,
        negative_prompt=args.negative_prompt,
        image=template_img,
        mask_image=mask_img,
        control_image=control_img,
        num_inference_steps=args.steps,
        guidance_scale=args.guidance,
        controlnet_conditioning_scale=args.cn_scale,
        generator=generator,
        num_images_per_prompt=args.num_images,
    )

    for i, img in enumerate(result.images):
        # Crop back to requested size if padded
        if (pad_w, pad_h) != (req_w, req_h):
            img = img.crop((0, 0, req_w, req_h))
        out_path = os.path.join(args.output, f"shirt_lora_{i+1:03d}.png")
        img.save(out_path)
        print(f"Saved {out_path}")

if __name__ == "__main__":
    main()


