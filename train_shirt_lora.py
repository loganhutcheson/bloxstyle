#!/usr/bin/env python3
"""
LoRA Training Script for Roblox Shirt Dataset (full_template)
Mirrors torso/train_torso_lora.py methodology with minimal changes.
"""

import os
import torch
from diffusers import DDPMScheduler, UNet2DConditionModel
from transformers import CLIPTextModel, CLIPTokenizer
from accelerate import Accelerator
from accelerate.utils import set_seed
from tqdm.auto import tqdm
import numpy as np
from PIL import Image
import argparse
from torch.utils.data import Dataset, DataLoader
from diffusers.optimization import get_scheduler
import json

USE_MPS = torch.backends.mps.is_available() and torch.backends.mps.is_built()
if USE_MPS:
    os.environ.setdefault("PYTORCH_ENABLE_MPS_FALLBACK", "1")

def _round_up_to_multiple_of_8(n: int) -> int:
    return (n + 7) // 8 * 8

def _pad_to_size_tensor(pixel_values: torch.Tensor, target_h: int, target_w: int) -> torch.Tensor:
    # pixel_values: [C,H,W]
    c, h, w = pixel_values.shape
    if (h, w) == (target_h, target_w):
        return pixel_values
    padded = torch.ones((c, target_h, target_w), dtype=pixel_values.dtype)
    # white background in [-1,1] space → 1.0
    padded = padded * 1.0
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

def create_shirt_dataset(dataset_dir, resolution=512, trigger_token="rbx_shirt"):
    dataset = []
    image_extensions = ['.png', '.jpg', '.jpeg', '.bmp', '.tiff']
    for file in os.listdir(dataset_dir):
        if any(file.lower().endswith(ext) for ext in image_extensions):
            image_path = os.path.join(dataset_dir, file)
            base_name = os.path.splitext(file)[0]
            text_file = os.path.join(dataset_dir, f"{base_name}.txt")
            if os.path.exists(text_file):
                with open(text_file, 'r', encoding='utf-8') as f:
                    prompt = f.read().strip()
            else:
                prompt = "roblox shirt template, clean design, high quality"
            if trigger_token not in prompt:
                prompt = f"{trigger_token}, {prompt}"
            dataset.append({"image_path": image_path, "prompt": prompt})
    print(f"Found {len(dataset)} images with prompts in dataset")
    return dataset

class ShirtDataset(Dataset):
    def __init__(self, dataset, tokenizer, width=585, height=559):
        self.dataset = dataset
        self.tokenizer = tokenizer
        self.width = width
        self.height = height
    def __len__(self):
        return len(self.dataset)
    def __getitem__(self, idx):
        item = self.dataset[idx]
        image = load_rgb_image_transparent_white(item["image_path"])
        image = image.resize((self.width, self.height), resample=Image.NEAREST)
        image = np.array(image).astype(np.float32) / 255.0
        image = torch.from_numpy(image).permute(2, 0, 1)
        image = image * 2.0 - 1.0
        # Pad to multiples of 8 for latents
        pad_w, pad_h = _round_up_to_multiple_of_8(self.width), _round_up_to_multiple_of_8(self.height)
        image = _pad_to_size_tensor(image, pad_h, pad_w)
        tokens = self.tokenizer(
            item["prompt"], padding="max_length", max_length=self.tokenizer.model_max_length,
            truncation=True, return_tensors="pt"
        )
        return {
            "pixel_values": image,
            "input_ids": tokens.input_ids.squeeze(),
            "attention_mask": tokens.attention_mask.squeeze(),
        }

def main():
    parser = argparse.ArgumentParser(description="Train LoRA on full_template/dataset shirts")
    parser.add_argument("--dataset_dir", type=str, default=os.path.join(os.path.dirname(__file__), "dataset"))
    parser.add_argument("--output_dir", type=str, default=os.path.join(os.path.dirname(__file__), "shirt_lora_output"))
    parser.add_argument("--max_train_steps", type=int, default=3000)
    parser.add_argument("--learning_rate", type=float, default=1e-4)
    parser.add_argument("--train_batch_size", type=int, default=1)
    parser.add_argument("--width", type=int, default=585)
    parser.add_argument("--height", type=int, default=559)
    parser.add_argument("--rank", type=int, default=16)
    parser.add_argument("--lora_alpha", type=int, default=32)
    parser.add_argument("--save_steps", type=int, default=100)
    parser.add_argument("--output_name", type=str, default="shirt_generator")
    parser.add_argument("--trigger_token", type=str, default="rbx_shirt")
    args = parser.parse_args()

    os.makedirs(args.output_dir, exist_ok=True)
    set_seed(42)
    accelerator = Accelerator(gradient_accumulation_steps=1, mixed_precision="no")

    model_id = "runwayml/stable-diffusion-v1-5"
    tokenizer = CLIPTokenizer.from_pretrained(model_id, subfolder="tokenizer")
    text_encoder = CLIPTextModel.from_pretrained(model_id, subfolder="text_encoder")
    from diffusers import AutoencoderKL
    vae = AutoencoderKL.from_pretrained(model_id, subfolder="vae")
    if USE_MPS:
        try:
            vae.enable_slicing(); vae.enable_tiling()
        except Exception:
            pass
    unet = UNet2DConditionModel.from_pretrained(model_id, subfolder="unet")

    vae.requires_grad_(False)
    text_encoder.requires_grad_(False)

    print("Adding LoRA layers to UNet (cross-attn)...")
    lora_modules = {}
    def register_lora_for_linear(layer, key):
        lora_down = torch.nn.Linear(layer.in_features, args.rank, bias=False)
        lora_up = torch.nn.Linear(args.rank, layer.out_features, bias=False)
        torch.nn.init.normal_(lora_down.weight, std=1.0 / args.rank)
        torch.nn.init.zeros_(lora_up.weight)
        lora_down.requires_grad_(True); lora_up.requires_grad_(True)
        layer.requires_grad_(False)
        lora_modules[key] = (lora_down, lora_up)

    for name, module in unet.named_modules():
        if "attn2" in name:
            for proj in ["to_q", "to_k", "to_v"]:
                if hasattr(module, proj):
                    layer = getattr(module, proj)
                    if isinstance(layer, torch.nn.Linear):
                        register_lora_for_linear(layer, f"{name}.{proj}")
            if hasattr(module, "to_out"):
                try:
                    out_layer = module.to_out[0]
                    if isinstance(out_layer, torch.nn.Linear):
                        register_lora_for_linear(out_layer, f"{name}.to_out.0")
                except Exception:
                    pass

    scale = args.lora_alpha / args.rank
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

    trainable_params = 0
    all_param = 0
    for _, param in unet.named_parameters():
        all_param += param.numel()
        if param.requires_grad:
            trainable_params += param.numel()
    print(f"trainable params: {trainable_params:,} || all params: {all_param:,} || trainable%: {100 * trainable_params / all_param:.2f}")

    dataset = create_shirt_dataset(args.dataset_dir, max(args.width, args.height), args.trigger_token)
    if len(dataset) == 0:
        raise ValueError("No images found in dataset directory!")
    train_dataset = ShirtDataset(dataset, tokenizer, width=args.width, height=args.height)
    train_dataloader = DataLoader(
        train_dataset, batch_size=args.train_batch_size, shuffle=True,
        num_workers=0, pin_memory=False, persistent_workers=False,
    )

    lora_params = []
    for down, up in lora_modules.values():
        lora_params.extend([down.weight, up.weight])
    optimizer = torch.optim.AdamW(lora_params, lr=args.learning_rate, betas=(0.9, 0.999), weight_decay=1e-2, eps=1e-08)
    warmup_steps = max(1, int(0.05 * args.max_train_steps))
    lr_scheduler = get_scheduler("cosine", optimizer=optimizer, num_warmup_steps=warmup_steps, num_training_steps=args.max_train_steps)
    noise_scheduler = DDPMScheduler.from_pretrained(model_id, subfolder="scheduler")

    unet, optimizer, train_dataloader, lr_scheduler = accelerator.prepare(unet, optimizer, train_dataloader, lr_scheduler)
    device = accelerator.device
    vae.to(device); text_encoder.to(device)
    for down, up in lora_modules.values():
        down.to(device); up.to(device)

    progress_bar = tqdm(range(args.max_train_steps), disable=not accelerator.is_local_main_process)
    progress_bar.set_description("Training Shirt LoRA")
    global_step = 0

    for epoch in range(args.max_train_steps // len(train_dataloader) + 1):
        unet.train()
        for step, batch in enumerate(train_dataloader):
            with accelerator.accumulate(unet):
                pixel_values = batch["pixel_values"].to(device, non_blocking=True)
                input_ids = batch["input_ids"].to(device, non_blocking=True)

                autocast_ctx = (
                    torch.autocast(device_type="mps", dtype=torch.float16)
                    if USE_MPS and hasattr(torch, "autocast") else
                    torch.cuda.amp.autocast(enabled=False)
                )
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

                try:
                    target_dtype = unet.dtype
                except AttributeError:
                    target_dtype = latents.dtype
                noisy_latents = noisy_latents.to(target_dtype)
                encoder_hidden_states = encoder_hidden_states.to(target_dtype)

                with autocast_ctx:
                    model_pred = unet(noisy_latents, timesteps, encoder_hidden_states).sample

                target = noise.to(model_pred.dtype)
                loss = torch.nn.functional.mse_loss(model_pred, target, reduction="none").mean([1,2,3]).mean()

                accelerator.backward(loss)
                if accelerator.sync_gradients:
                    accelerator.clip_grad_norm_(lora_params, 1.0)
                optimizer.step(); lr_scheduler.step(); optimizer.zero_grad()

            if accelerator.sync_gradients:
                progress_bar.update(1)
                global_step += 1
                if global_step % args.save_steps == 0:
                    accelerator.wait_for_everyone()
                    unwrapped_unet = accelerator.unwrap_model(unet)
                    lora_state_dict = {}
                    for name, (down, up) in lora_modules.items():
                        lora_state_dict[f"{name}.lora_down.weight"] = down.weight
                        lora_state_dict[f"{name}.lora_up.weight"] = up.weight
                    torch.save(lora_state_dict, os.path.join(args.output_dir, f"{args.output_name}_step_{global_step}.safetensors"))
                    config = {
                        "model_name": "shirt_generator",
                        "rank": args.rank,
                        "lora_alpha": args.lora_alpha,
                        "lora_dropout": 0.0,
                        "train_text_encoder": False,
                        "width": args.width,
                        "height": args.height,
                        "global_step": global_step,
                        "loss": float(loss.detach().float().item()),
                        "targets": ["to_q","to_k","to_v","to_out.0"],
                        "trigger_token": args.trigger_token,
                    }
                    with open(os.path.join(args.output_dir, f"{args.output_name}_step_{global_step}_config.json"), "w") as f:
                        json.dump(config, f, indent=2)
                    print(f"Saved checkpoint at step {global_step}")
                if global_step >= args.max_train_steps:
                    break
        if global_step >= args.max_train_steps:
            break

    try:
        progress_bar.close()
    except Exception:
        pass
    if USE_MPS:
        try:
            torch.mps.synchronize()
        except Exception:
            pass
    try:
        del train_dataloader
    except Exception:
        pass

    accelerator.wait_for_everyone()
    unwrapped_unet = accelerator.unwrap_model(unet)
    lora_state_dict = {}
    for name, (down, up) in lora_modules.items():
        lora_state_dict[f"{name}.lora_down.weight"] = down.weight
        lora_state_dict[f"{name}.lora_up.weight"] = up.weight
    torch.save(lora_state_dict, os.path.join(args.output_dir, f"{args.output_name}_final.safetensors"))
    config = {
        "model_name": "shirt_generator",
        "rank": args.rank,
        "lora_alpha": args.lora_alpha,
        "lora_dropout": 0.0,
        "train_text_encoder": False,
        "width": args.width,
        "height": args.height,
        "final_loss": float(loss.detach().float().item()),
        "targets": ["to_q","to_k","to_v","to_out.0"],
        "trigger_token": args.trigger_token,
    }
    with open(os.path.join(args.output_dir, f"{args.output_name}_final_config.json"), "w") as f:
        json.dump(config, f, indent=2)
    print(f"Training completed! Shirt LoRA model saved to {args.output_dir}")
    try:
        accelerator.end_training()
    except Exception:
        pass

if __name__ == "__main__":
    main()


