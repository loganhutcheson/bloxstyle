#!/usr/bin/env python3
"""
ControlNet LoRA training for Roblox shirt templates using lineart control.

This script fine-tunes lightweight LoRA adapters on top of the
`lllyasviel/control_v11p_sd15_lineart` ControlNet while keeping the base SD 1.5
UNet, VAE, and text encoder frozen. It follows the manual LoRA wrapping style
used in `train_shirt_lora.py` for maximum compatibility with your stack.

Expected dataset layout (default):
  dataset_dir/
    control/   # control images (lineart/edges; RGB; same filenames)
    target/    # ground-truth shirt textures (RGB)
    captions/  # optional .txt files with prompts (shirt_1.txt), else auto-prompt

Or specify `--control_dir` and `--target_dir` directly.

Example:
  python train_controlnet_lora.py \
    --dataset_dir datasets/shirt_set_v2/dataset_shaded \
    --output_dir weights/controlnet_lineart_lora \
    --max_train_steps 3000 --train_batch_size 1 --learning_rate 5e-5 \
    --width 585 --height 559 --rank 16 --lora_alpha 32 --save_steps 200
"""

import os
import argparse
import json
from typing import List, Tuple

import numpy as np
from PIL import Image, ImageFilter, ImageOps

import torch
from torch.utils.data import Dataset, DataLoader

from accelerate import Accelerator
from accelerate.utils import set_seed

from transformers import CLIPTextModel, CLIPTokenizer

from diffusers import (
    DDPMScheduler,
    UNet2DConditionModel,
    ControlNetModel,
)
from diffusers.optimization import get_scheduler


USE_MPS = torch.backends.mps.is_available() and torch.backends.mps.is_built()
if USE_MPS:
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")


def _round_up_to_multiple_of_8(n: int) -> int:
    return (n + 7) // 8 * 8


def _pad_to_size_tensor(pixel_values: torch.Tensor, target_h: int, target_w: int) -> torch.Tensor:
    # pixel_values: [C,H,W] in [-1,1]
    c, h, w = pixel_values.shape
    if (h, w) == (target_h, target_w):
        return pixel_values
    padded = torch.ones((c, target_h, target_w), dtype=pixel_values.dtype)
    padded = padded * 1.0  # white background in [-1,1]
    padded[:, :h, :w] = pixel_values
    return padded


def load_rgb_image_transparent_white(path: str) -> Image.Image:
    img = Image.open(path)
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        alpha = img.convert("RGBA")
        background = Image.new("RGBA", alpha.size, (255, 255, 255, 255))
        composited = Image.alpha_composite(background, alpha)
        return composited.convert("RGB")
    return img.convert("RGB")


def discover_pairs(control_dir: str, target_dir: str, generate_control_from_target: bool = False) -> List[Tuple[str, str, str]]:
    """
    Returns list of (control_path, target_path, caption_path_or_empty)
    by intersecting filenames present in both dirs (case-sensitive).
    """
    target_files = {f for f in os.listdir(target_dir) if f.lower().endswith((".png", ".jpg", ".jpeg", ".bmp", ".tiff"))}
    pairs = []
    if not generate_control_from_target:
        control_files = {f for f in os.listdir(control_dir) if f.lower().endswith((".png", ".jpg", ".jpeg", ".bmp", ".tiff"))}
        common = sorted(control_files.intersection(target_files))
        for name in common:
            control_path = os.path.join(control_dir, name)
            target_path = os.path.join(target_dir, name)
            base = os.path.splitext(name)[0]
            caption_path = os.path.join(os.path.dirname(target_dir), "captions", f"{base}.txt")
            if not os.path.exists(caption_path):
                sibling_caption = os.path.join(target_dir, f"{base}.txt")
                caption_path = sibling_caption if os.path.exists(sibling_caption) else ""
            pairs.append((control_path, target_path, caption_path))
    else:
        for name in sorted(target_files):
            target_path = os.path.join(target_dir, name)
            base = os.path.splitext(name)[0]
            caption_path = os.path.join(os.path.dirname(target_dir), "captions", f"{base}.txt")
            if not os.path.exists(caption_path):
                sibling_caption = os.path.join(target_dir, f"{base}.txt")
                caption_path = sibling_caption if os.path.exists(sibling_caption) else ""
            # control_path empty signals dataset to synthesize from target
            pairs.append(("", target_path, caption_path))
    return pairs


class ControlNetLineartDataset(Dataset):
    def __init__(self, pairs: List[Tuple[str, str, str]], tokenizer: CLIPTokenizer, width: int = 585, height: int = 559, default_trigger: str = "rbx_shirt"):
        self.pairs = pairs
        self.tokenizer = tokenizer
        self.width = width
        self.height = height
        self.default_trigger = default_trigger

    def __len__(self):
        return len(self.pairs)

    def _preprocess_image(self, img: Image.Image) -> torch.Tensor:
        img = img.resize((self.width, self.height), resample=Image.NEAREST)
        arr = np.array(img).astype(np.float32) / 255.0
        tensor = torch.from_numpy(arr).permute(2, 0, 1)  # [C,H,W]
        tensor = tensor * 2.0 - 1.0  # [-1, 1]
        pad_w, pad_h = _round_up_to_multiple_of_8(self.width), _round_up_to_multiple_of_8(self.height)
        tensor = _pad_to_size_tensor(tensor, pad_h, pad_w)
        return tensor

    def __getitem__(self, idx):
        control_path, target_path, caption_path = self.pairs[idx]
        target_img = load_rgb_image_transparent_white(target_path)
        if control_path and os.path.exists(control_path):
            control_img = load_rgb_image_transparent_white(control_path)  # expected white bg + black lines
        else:
            control_img = create_lineart_from_image(target_img)

        control_tensor = self._preprocess_image(control_img)
        target_tensor = self._preprocess_image(target_img)

        if caption_path and os.path.exists(caption_path):
            with open(caption_path, "r", encoding="utf-8") as f:
                prompt = f.read().strip()
        else:
            prompt = f"{self.default_trigger}, roblox shirt template, clean design"

        tokens = self.tokenizer(
            prompt,
            padding="max_length",
            max_length=self.tokenizer.model_max_length,
            truncation=True,
            return_tensors="pt",
        )

        return {
            "control_values": control_tensor,  # [-1,1]
            "pixel_values": target_tensor,     # [-1,1]
            "input_ids": tokens.input_ids.squeeze(),
            "attention_mask": tokens.attention_mask.squeeze(),
        }


def create_lineart_from_image(image: Image.Image) -> Image.Image:
    """
    Approximate a lineart control map from a target RGB image using PIL
    edge detection, producing black lines on white background (RGB).
    """
    gray = image.convert("L").filter(ImageFilter.GaussianBlur(1))
    edges = gray.filter(ImageFilter.FIND_EDGES)
    edges = ImageOps.invert(edges)
    # Binarize for crisp lines
    edges = edges.point(lambda p: 255 if p > 128 else 0)
    return edges.convert("RGB")


def add_lora_to_controlnet(controlnet: ControlNetModel, rank: int, lora_alpha: int):
    """
    Inject LoRA adapters into ControlNet cross-attention linear projections (attn2: to_q, to_k, to_v, to_out.0).
    Returns dict: name -> (down, up)
    """
    lora_modules = {}

    def register_lora_for_linear(layer: torch.nn.Linear, key: str):
        lora_down = torch.nn.Linear(layer.in_features, rank, bias=False)
        lora_up = torch.nn.Linear(rank, layer.out_features, bias=False)
        torch.nn.init.normal_(lora_down.weight, std=1.0 / max(1, rank))
        torch.nn.init.zeros_(lora_up.weight)
        lora_down.requires_grad_(True)
        lora_up.requires_grad_(True)
        layer.requires_grad_(False)
        lora_modules[key] = (lora_down, lora_up)

    # Find cross-attention layers in the ControlNet's UNet-like blocks
    for name, module in controlnet.named_modules():
        if "attn2" in name:
            for proj in ["to_q", "to_k", "to_v"]:
                if hasattr(module, proj):
                    linear = getattr(module, proj)
                    if isinstance(linear, torch.nn.Linear):
                        register_lora_for_linear(linear, f"{name}.{proj}")
            if hasattr(module, "to_out"):
                try:
                    out_linear = module.to_out[0]
                    if isinstance(out_linear, torch.nn.Linear):
                        register_lora_for_linear(out_linear, f"{name}.to_out.0")
                except Exception:
                    pass

    # Wire LoRA into forward passes
    scale = lora_alpha / float(rank)
    for name, module in controlnet.named_modules():
        if "attn2" in name:
            for proj in ["to_q", "to_k", "to_v"]:
                if hasattr(module, proj):
                    key = f"{name}.{proj}"
                    if key in lora_modules:
                        linear = getattr(module, proj)
                        if not hasattr(linear, "_lora_wrapped"):
                            original_forward = linear.forward
                            down, up = lora_modules[key]

                            def lora_forward(x, original=original_forward, down=down, up=up, s=scale):
                                return original(x) + s * up(down(x))

                            linear.forward = lora_forward
                            linear._lora_wrapped = True
            if hasattr(module, "to_out"):
                key = f"{name}.to_out.0"
                if key in lora_modules:
                    out_linear = module.to_out[0]
                    if not hasattr(out_linear, "_lora_wrapped"):
                        original_forward = out_linear.forward
                        down, up = lora_modules[key]

                        def lora_forward(x, original=original_forward, down=down, up=up, s=scale):
                            return original(x) + s * up(down(x))

                        out_linear.forward = lora_forward
                        out_linear._lora_wrapped = True

    return lora_modules


def main():
    parser = argparse.ArgumentParser(description="Train ControlNet LoRA (lineart) for Roblox shirts")
    parser.add_argument("--dataset_dir", type=str, default=None, help="Root dataset dir containing control/, target/, captions/")
    parser.add_argument("--control_dir", type=str, default=None, help="Explicit control image dir")
    parser.add_argument("--target_dir", type=str, default=None, help="Explicit target image dir")
    parser.add_argument("--output_dir", type=str, default=os.path.join(os.path.dirname(__file__), "controlnet_lineart_lora_output"))
    parser.add_argument("--max_train_steps", type=int, default=3000)
    parser.add_argument("--learning_rate", type=float, default=5e-5)
    parser.add_argument("--train_batch_size", type=int, default=1)
    parser.add_argument("--width", type=int, default=585)
    parser.add_argument("--height", type=int, default=559)
    parser.add_argument("--rank", type=int, default=16)
    parser.add_argument("--lora_alpha", type=int, default=32)
    parser.add_argument("--save_steps", type=int, default=200)
    parser.add_argument("--output_name", type=str, default="controlnet_lineart")
    parser.add_argument("--trigger_token", type=str, default="rbx_shirt")
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument("--generate_control_from_target", action="store_true", help="Synthesize control maps from target images if control dir is missing")
    args = parser.parse_args()

    set_seed(args.seed)
    os.makedirs(args.output_dir, exist_ok=True)

    # Resolve dataset dirs
    if args.dataset_dir and not (args.control_dir and args.target_dir):
        control_dir = os.path.join(args.dataset_dir, "control")
        target_dir = os.path.join(args.dataset_dir, "target")
    else:
        control_dir = args.control_dir
        target_dir = args.target_dir
    if not target_dir:
        raise ValueError("Please provide --target_dir or --dataset_dir pointing to a directory containing target images.")

    target_dir = os.path.abspath(target_dir)
    # If control_dir is absent or missing, enable generation from target
    if control_dir is None or not os.path.exists(control_dir):
        control_dir = ""
        args.generate_control_from_target = True
    else:
        control_dir = os.path.abspath(control_dir)

    accelerator = Accelerator(gradient_accumulation_steps=1, mixed_precision="no")

    # Base models
    base_model_id = "runwayml/stable-diffusion-v1-5"
    controlnet_id = "lllyasviel/control_v11p_sd15_lineart"

    tokenizer = CLIPTokenizer.from_pretrained(base_model_id, subfolder="tokenizer")
    text_encoder = CLIPTextModel.from_pretrained(base_model_id, subfolder="text_encoder")
    from diffusers import AutoencoderKL
    vae = AutoencoderKL.from_pretrained(base_model_id, subfolder="vae")
    unet = UNet2DConditionModel.from_pretrained(base_model_id, subfolder="unet")
    controlnet = ControlNetModel.from_pretrained(controlnet_id)

    # Freeze everything except ControlNet LoRA adapters
    vae.requires_grad_(False)
    text_encoder.requires_grad_(False)
    unet.requires_grad_(False)
    controlnet.requires_grad_(False)

    # Inject LoRA into ControlNet cross-attention
    lora_modules = add_lora_to_controlnet(controlnet, rank=args.rank, lora_alpha=args.lora_alpha)

    # Dataset
    pairs = discover_pairs(control_dir, target_dir, generate_control_from_target=args.generate_control_from_target)
    if len(pairs) == 0:
        raise ValueError("No overlapping control/target image pairs found!")
    dataset = ControlNetLineartDataset(pairs, tokenizer, width=args.width, height=args.height, default_trigger=args.trigger_token)
    dataloader = DataLoader(dataset, batch_size=args.train_batch_size, shuffle=True, num_workers=0, pin_memory=False, persistent_workers=False)

    # Optimizer and schedulers
    trainable_params = []
    for down, up in lora_modules.values():
        trainable_params.extend([down.weight, up.weight])
    optimizer = torch.optim.AdamW(trainable_params, lr=args.learning_rate, betas=(0.9, 0.999), weight_decay=1e-2, eps=1e-08)
    warmup_steps = max(1, int(0.05 * args.max_train_steps))
    lr_scheduler = get_scheduler("cosine", optimizer=optimizer, num_warmup_steps=warmup_steps, num_training_steps=args.max_train_steps)
    noise_scheduler = DDPMScheduler.from_pretrained(base_model_id, subfolder="scheduler")

    # Prepare
    controlnet, optimizer, dataloader, lr_scheduler = accelerator.prepare(controlnet, optimizer, dataloader, lr_scheduler)
    device = accelerator.device
    vae.to(device)
    text_encoder.to(device)
    unet.to(device)
    for down, up in lora_modules.values():
        down.to(device)
        up.to(device)

    # Stats
    total_trainable = sum(p.numel() for p in trainable_params)
    total_params = sum(p.numel() for p in controlnet.parameters())
    if accelerator.is_local_main_process:
        print(f"ControlNet trainable params (LoRA): {total_trainable:,} / {total_params:,} ({100*total_trainable/total_params:.2f}%)")

    # Training loop
    global_step = 0
    try:
        from tqdm.auto import tqdm
        pbar = tqdm(range(args.max_train_steps), disable=not accelerator.is_local_main_process)
        pbar.set_description("Training ControlNet LoRA (lineart)")
    except Exception:
        pbar = None

    for epoch in range(args.max_train_steps // max(1, len(dataloader)) + 2):
        controlnet.train()
        for step, batch in enumerate(dataloader):
            with accelerator.accumulate(controlnet):
                # Targets
                pixel_values = batch["pixel_values"].to(device, non_blocking=True)  # [-1,1]
                control_values = batch["control_values"].to(device, non_blocking=True)  # [-1,1]
                input_ids = batch["input_ids"].to(device, non_blocking=True)

                # Latents
                if USE_MPS and hasattr(torch, "autocast"):
                    autocast_ctx = torch.autocast(device_type="mps", dtype=torch.float16)
                else:
                    autocast_ctx = torch.cuda.amp.autocast(enabled=False)

                with autocast_ctx:
                    latents = vae.encode(pixel_values).latent_dist.sample()
                    latents = latents * vae.config.scaling_factor

                if USE_MPS:
                    latents = latents.to(torch.float32)

                noise = torch.randn_like(latents, dtype=latents.dtype, device=device)
                bsz = latents.shape[0]
                timesteps = torch.randint(0, noise_scheduler.config.num_train_timesteps, (bsz,), device=device).long()
                noisy_latents = noise_scheduler.add_noise(latents, noise, timesteps)

                with autocast_ctx:
                    encoder_hidden_states = text_encoder(input_ids).last_hidden_state

                # Match dtypes
                target_dtype = unet.dtype if hasattr(unet, "dtype") else noisy_latents.dtype
                noisy_latents = noisy_latents.to(target_dtype)
                encoder_hidden_states = encoder_hidden_states.to(target_dtype)
                control_values = control_values.to(target_dtype)

                # ControlNet forward → additional residuals
                with autocast_ctx:
                    down_samples, mid_sample = controlnet(
                        sample=noisy_latents,
                        timestep=timesteps,
                        encoder_hidden_states=encoder_hidden_states,
                        controlnet_cond=control_values,
                        return_dict=False,
                    )

                    # UNet forward with ControlNet residuals
                    model_pred = unet(
                        sample=noisy_latents,
                        timestep=timesteps,
                        encoder_hidden_states=encoder_hidden_states,
                        down_block_additional_residuals=down_samples,
                        mid_block_additional_residual=mid_sample,
                    ).sample

                target = noise.to(model_pred.dtype)
                loss = torch.nn.functional.mse_loss(model_pred, target, reduction="none").mean([1, 2, 3]).mean()

                accelerator.backward(loss)
                if accelerator.sync_gradients:
                    accelerator.clip_grad_norm_(trainable_params, 1.0)
                optimizer.step()
                lr_scheduler.step()
                optimizer.zero_grad()

            if accelerator.sync_gradients:
                global_step += 1
                if pbar is not None:
                    pbar.update(1)
                    pbar.set_postfix({"loss": float(loss.detach().float().item())})

                if global_step % args.save_steps == 0:
                    accelerator.wait_for_everyone()
                    # Save only LoRA weights
                    lora_state_dict = {}
                    for name, (down, up) in lora_modules.items():
                        lora_state_dict[f"{name}.lora_down.weight"] = down.weight
                        lora_state_dict[f"{name}.lora_up.weight"] = up.weight
                    out_path = os.path.join(args.output_dir, f"{args.output_name}_step_{global_step}.safetensors")
                    torch.save(lora_state_dict, out_path)
                    config = {
                        "target": "controlnet",
                        "base_controlnet": controlnet_id,
                        "rank": args.rank,
                        "lora_alpha": args.lora_alpha,
                        "width": args.width,
                        "height": args.height,
                        "global_step": global_step,
                        "loss": float(loss.detach().float().item()),
                        "targets": ["to_q", "to_k", "to_v", "to_out.0"],
                        "trigger_token": args.trigger_token,
                    }
                    with open(out_path.replace(".safetensors", "_config.json"), "w") as f:
                        json.dump(config, f, indent=2)
                    if accelerator.is_local_main_process:
                        print(f"Saved checkpoint at step {global_step}: {out_path}")

                if global_step >= args.max_train_steps:
                    break

        if global_step >= args.max_train_steps:
            break

    # Final save
    accelerator.wait_for_everyone()
    lora_state_dict = {}
    for name, (down, up) in lora_modules.items():
        lora_state_dict[f"{name}.lora_down.weight"] = down.weight
        lora_state_dict[f"{name}.lora_up.weight"] = up.weight
    final_path = os.path.join(args.output_dir, f"{args.output_name}_final.safetensors")
    torch.save(lora_state_dict, final_path)
    config = {
        "target": "controlnet",
        "base_controlnet": controlnet_id,
        "rank": args.rank,
        "lora_alpha": args.lora_alpha,
        "width": args.width,
        "height": args.height,
        "final_loss": float(loss.detach().float().item()) if 'loss' in locals() else None,
        "targets": ["to_q", "to_k", "to_v", "to_out.0"],
        "trigger_token": args.trigger_token,
    }
    with open(final_path.replace(".safetensors", "_config.json"), "w") as f:
        json.dump(config, f, indent=2)
    if accelerator.is_local_main_process:
        print(f"Training completed! ControlNet LoRA saved to {final_path}")

    try:
        accelerator.end_training()
    except Exception:
        pass


if __name__ == "__main__":
    main()


