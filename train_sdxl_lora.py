#!/usr/bin/env python3
"""
SDXL UNet LoRA Training for Roblox Shirt Templates

This script fine-tunes lightweight LoRA adapters on the SDXL UNet cross-attention
layers, keeping VAE and both text encoders frozen. It mirrors the manual LoRA
injection style used in `train_shirt_lora.py` for compatibility with your stack
while handling SDXL-specific conditioning (dual text encoders and time ids).

Base: stabilityai/stable-diffusion-xl-base-1.0

Dataset layout options:
1) Flat folder of RGB targets + optional sidecar .txt captions:
     dataset_dir/*.png and dataset_dir/*.txt
2) Explicit target_dir if not using dataset_dir.

Captions: If a `*.txt` with the same basename exists, it's used as the prompt;
otherwise a default short caption including a trigger token is applied.

Example:
  python train_sdxl_lora.py \
    --target_dir datasets/shirt_set_v1 \
    --output_dir weights/sdxl_shirt_lora \
    --width 585 --height 559 \
    --max_train_steps 6000 --learning_rate 2e-5 \
    --rank 16 --lora_alpha 32 --train_batch_size 1 --save_steps 500
"""

import os
import argparse
import json
from typing import List, Tuple

import numpy as np
from PIL import Image

import torch
from torch.utils.data import Dataset, DataLoader

from accelerate import Accelerator
from accelerate.utils import set_seed

from transformers import CLIPTextModel, CLIPTokenizer

from diffusers import (
    AutoencoderKL,
    UNet2DConditionModel,
    DDPMScheduler,
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


def discover_targets_with_captions(target_dir: str) -> List[Tuple[str, str]]:
    """
    Returns list of (image_path, caption_path_or_empty) sorted by filename.
    """
    files = [f for f in os.listdir(target_dir) if f.lower().endswith((".png", ".jpg", ".jpeg", ".bmp", ".tiff"))]
    files.sort()
    pairs = []
    for name in files:
        img_path = os.path.join(target_dir, name)
        base = os.path.splitext(name)[0]
        cap_path = os.path.join(target_dir, f"{base}.txt")
        if not os.path.exists(cap_path):
            cap_path = ""
        pairs.append((img_path, cap_path))
    return pairs


class SDXLShirtDataset(Dataset):
    def __init__(self, pairs: List[Tuple[str, str]], tok1: CLIPTokenizer, tok2: CLIPTokenizer, width: int = 585, height: int = 559, default_trigger: str = "rbx_shirt"):
        self.pairs = pairs
        self.tok1 = tok1
        self.tok2 = tok2
        self.width = width
        self.height = height
        self.default_trigger = default_trigger

    def __len__(self):
        return len(self.pairs)

    def _preprocess_image(self, img: Image.Image) -> torch.Tensor:
        img = img.resize((self.width, self.height), resample=Image.NEAREST)
        arr = np.array(img).astype(np.float32) / 255.0
        tensor = torch.from_numpy(arr).permute(2, 0, 1)
        tensor = tensor * 2.0 - 1.0
        pad_w, pad_h = _round_up_to_multiple_of_8(self.width), _round_up_to_multiple_of_8(self.height)
        tensor = _pad_to_size_tensor(tensor, pad_h, pad_w)
        return tensor

    def __getitem__(self, idx):
        img_path, cap_path = self.pairs[idx]
        image = load_rgb_image_transparent_white(img_path)
        pixel_values = self._preprocess_image(image)
        if cap_path and os.path.exists(cap_path):
            with open(cap_path, "r", encoding="utf-8") as f:
                prompt = f.read().strip()
        else:
            prompt = f"{self.default_trigger}, roblox shirt template, clean design"

        tokens1 = self.tok1(
            prompt,
            padding="max_length",
            max_length=self.tok1.model_max_length,
            truncation=True,
            return_tensors="pt",
        )
        tokens2 = self.tok2(
            prompt,
            padding="max_length",
            max_length=self.tok2.model_max_length,
            truncation=True,
            return_tensors="pt",
        )
        return {
            "pixel_values": pixel_values,
            "input_ids_1": tokens1.input_ids.squeeze(),
            "attention_mask_1": tokens1.attention_mask.squeeze(),
            "input_ids_2": tokens2.input_ids.squeeze(),
            "attention_mask_2": tokens2.attention_mask.squeeze(),
        }


def add_lora_to_unet(unet: UNet2DConditionModel, rank: int, lora_alpha: int):
    """
    Inject LoRA adapters into UNet cross-attention linear projections (attn2: to_q, to_k, to_v, to_out.0).
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

    for name, module in unet.named_modules():
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

    scale = lora_alpha / float(rank)
    for name, module in unet.named_modules():
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


def compute_sdxl_text_embeddings(tok1, tok2, enc1: CLIPTextModel, enc2: CLIPTextModel, input_ids_1, input_ids_2):
    # Text encoder 1
    prompt_embeds_1 = enc1(input_ids_1).last_hidden_state
    # Text encoder 2 returns pooled also via the hidden state; in SDXL, pooled from last_hidden_state[:, 0]
    prompt_outputs_2 = enc2(input_ids_2, output_hidden_states=False)
    prompt_embeds_2 = prompt_outputs_2.last_hidden_state
    pooled_prompt_embeds = prompt_embeds_2[:, 0]  # [bs, hidden]
    # Concat hidden states for SDXL (as in diffusers pipeline)
    prompt_embeds = torch.cat([prompt_embeds_1, prompt_embeds_2], dim=-1)
    return prompt_embeds, pooled_prompt_embeds


def get_add_time_ids(batch_size: int, height: int, width: int, device, dtype):
    # SDXL base expects 6-dim time ids: [orig_h, orig_w, crop_h, crop_w, target_h, target_w]
    add_time_ids = torch.tensor([height, width, 0, 0, height, width], device=device, dtype=dtype)
    add_time_ids = add_time_ids[None, :].repeat(batch_size, 1)
    return add_time_ids


def main():
    parser = argparse.ArgumentParser(description="Train SDXL UNet LoRA for Roblox shirts")
    parser.add_argument("--dataset_dir", type=str, default=None, help="Root dataset dir containing images and optional .txt captions")
    parser.add_argument("--target_dir", type=str, default=None, help="Explicit target image dir")
    parser.add_argument("--output_dir", type=str, default=os.path.join(os.path.dirname(__file__), "sdxl_shirt_lora_output"))
    parser.add_argument("--max_train_steps", type=int, default=6000)
    parser.add_argument("--learning_rate", type=float, default=2e-5)
    parser.add_argument("--train_batch_size", type=int, default=1)
    parser.add_argument("--width", type=int, default=585)
    parser.add_argument("--height", type=int, default=559)
    parser.add_argument("--rank", type=int, default=16)
    parser.add_argument("--lora_alpha", type=int, default=32)
    parser.add_argument("--save_steps", type=int, default=500)
    parser.add_argument("--output_name", type=str, default="sdxl_shirt_lora")
    parser.add_argument("--trigger_token", type=str, default="rbx_shirt")
    parser.add_argument("--seed", type=int, default=42)
    args = parser.parse_args()

    set_seed(args.seed)
    os.makedirs(args.output_dir, exist_ok=True)

    if args.dataset_dir and not args.target_dir:
        target_dir = args.dataset_dir
    else:
        target_dir = args.target_dir
    if not target_dir:
        raise ValueError("Please provide --target_dir or --dataset_dir containing images")
    target_dir = os.path.abspath(target_dir)

    accelerator = Accelerator(gradient_accumulation_steps=1, mixed_precision="no")

    # SDXL base
    base_model_id = "stabilityai/stable-diffusion-xl-base-1.0"
    vae = AutoencoderKL.from_pretrained(base_model_id, subfolder="vae")
    unet = UNet2DConditionModel.from_pretrained(base_model_id, subfolder="unet")
    tokenizer_1 = CLIPTokenizer.from_pretrained(base_model_id, subfolder="tokenizer")
    tokenizer_2 = CLIPTokenizer.from_pretrained(base_model_id, subfolder="tokenizer_2")
    text_encoder_1 = CLIPTextModel.from_pretrained(base_model_id, subfolder="text_encoder")
    text_encoder_2 = CLIPTextModel.from_pretrained(base_model_id, subfolder="text_encoder_2")

    vae.requires_grad_(False)
    text_encoder_1.requires_grad_(False)
    text_encoder_2.requires_grad_(False)

    # Inject LoRA in UNet cross-attn
    lora_modules = add_lora_to_unet(unet, rank=args.rank, lora_alpha=args.lora_alpha)

    # Dataset
    pairs = discover_targets_with_captions(target_dir)
    if len(pairs) == 0:
        raise ValueError("No training images found in target_dir")
    dataset = SDXLShirtDataset(pairs, tokenizer_1, tokenizer_2, width=args.width, height=args.height, default_trigger=args.trigger_token)
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
    unet, optimizer, dataloader, lr_scheduler = accelerator.prepare(unet, optimizer, dataloader, lr_scheduler)
    device = accelerator.device
    vae.to(device)
    text_encoder_1.to(device)
    text_encoder_2.to(device)
    for down, up in lora_modules.values():
        down.to(device)
        up.to(device)

    # Stats
    total_trainable = sum(p.numel() for p in trainable_params)
    total_params = sum(p.numel() for p in unet.parameters())
    if accelerator.is_local_main_process:
        print(f"UNet trainable params (LoRA): {total_trainable:,} / {total_params:,} ({100*total_trainable/total_params:.2f}%)")

    # Training loop
    global_step = 0
    try:
        from tqdm.auto import tqdm
        pbar = tqdm(range(args.max_train_steps), disable=not accelerator.is_local_main_process)
        pbar.set_description("Training SDXL UNet LoRA")
    except Exception:
        pbar = None

    for epoch in range(args.max_train_steps // max(1, len(dataloader)) + 2):
        unet.train()
        for step, batch in enumerate(dataloader):
            with accelerator.accumulate(unet):
                pixel_values = batch["pixel_values"].to(device, non_blocking=True)
                input_ids_1 = batch["input_ids_1"].to(device, non_blocking=True)
                input_ids_2 = batch["input_ids_2"].to(device, non_blocking=True)

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
                    # SDXL text conditioning
                    prompt_embeds, pooled_prompt_embeds = compute_sdxl_text_embeddings(
                        tokenizer_1, tokenizer_2, text_encoder_1, text_encoder_2, input_ids_1, input_ids_2
                    )

                # Match types
                target_dtype = unet.dtype if hasattr(unet, "dtype") else noisy_latents.dtype
                noisy_latents = noisy_latents.to(target_dtype)
                prompt_embeds = prompt_embeds.to(target_dtype)
                pooled_prompt_embeds = pooled_prompt_embeds.to(target_dtype)

                add_time_ids = get_add_time_ids(bsz, height=_round_up_to_multiple_of_8(args.height), width=_round_up_to_multiple_of_8(args.width), device=device, dtype=target_dtype)

                with autocast_ctx:
                    model_pred = unet(
                        sample=noisy_latents,
                        timestep=timesteps,
                        encoder_hidden_states=prompt_embeds,
                        added_cond_kwargs={
                            "text_embeds": pooled_prompt_embeds,
                            "time_ids": add_time_ids,
                        },
                    ).sample

                target = noise.to(model_pred.dtype)
                loss = torch.nn.functional.mse_loss(model_pred, target, reduction="none").mean([1, 2, 3]).mean()

                accelerator.backward(loss)
                if accelerator.sync_gradients:
                    accelerator.clip_grad_norm_(trainable_params, 1.0)
                optimizer.step(); lr_scheduler.step(); optimizer.zero_grad()

            if accelerator.sync_gradients:
                global_step += 1
                if pbar is not None:
                    pbar.update(1)
                    pbar.set_postfix({"loss": float(loss.detach().float().item())})

                if global_step % args.save_steps == 0:
                    accelerator.wait_for_everyone()
                    # Save LoRA weights
                    lora_state_dict = {}
                    for name, (down, up) in lora_modules.items():
                        lora_state_dict[f"{name}.lora_down.weight"] = down.weight
                        lora_state_dict[f"{name}.lora_up.weight"] = up.weight
                    out_path = os.path.join(args.output_dir, f"{args.output_name}_step_{global_step}.safetensors")
                    torch.save(lora_state_dict, out_path)
                    config = {
                        "base_model": base_model_id,
                        "target": "unet",
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

    accelerator.wait_for_everyone()
    lora_state_dict = {}
    for name, (down, up) in lora_modules.items():
        lora_state_dict[f"{name}.lora_down.weight"] = down.weight
        lora_state_dict[f"{name}.lora_up.weight"] = up.weight
    final_path = os.path.join(args.output_dir, f"{args.output_name}_final.safetensors")
    torch.save(lora_state_dict, final_path)
    config = {
        "base_model": base_model_id,
        "target": "unet",
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
        print(f"Training completed! SDXL LoRA saved to {final_path}")

    try:
        accelerator.end_training()
    except Exception:
        pass


if __name__ == "__main__":
    main()



