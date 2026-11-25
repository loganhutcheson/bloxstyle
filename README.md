# bloxstyle

Three generations of diffusion-backed Roblox clothing generation and precision UV texture editing (`585 × 559` template), built over a year and completed as part of [Lanturn](https://lanturn.ai/)’s Founding Sprint ($100 founder’s grant).

Read the full write-up and visuals at [loganhutcheson.com/2026/09/12/roblox-clothing-generator.html](https://loganhutcheson.com/2026/09/12/roblox-clothing-generator.html).

## Architecture across three versions

1. **Version 1 — Dataset augmentation & custom SD 1.5 LoRA (`train_shirt_lora.py`, `train_controlnet_lora.py`, `generate_lora_dataset.py`)**
   - Scraped ~500 Roblox shirt templates (`416` cleaned in `shirt_set.tar` via Git LFS) and expanded them to ~8,000 examples with shading passes, rotations, alpha-to-white compositing, and `592 × 560` multiple-of-8 padding.
   - Hand-rolled rank-16 (`alpha = 32`) LoRA layers on SD 1.5 UNet `attn2` cross-attention projections (`to_q`, `to_k`, `to_v`, `to_out.0`) plus a Lineart ControlNet LoRA (`control_v11p_sd15_lineart`), served on Modal A10G GPUs and local Apple Silicon MPS.

2. **Version 2 — Qwen + ComfyUI on Modal + Web App (`web/`, `workflows/`)**
   - 24-node ComfyUI workflow running Qwen Image Edit 2509 BF16 + 8-step Lightning LoRA + ControlNet Union on serverless [Modal](https://modal.com/) GPUs.
   - Next.js + Vercel frontend with Google OAuth, Prisma atomic credit reserve/refund, Stripe checkout/webhooks, and background homepage warm-boot pings ([`0d9cbd3`](https://github.com/loganhutcheson/bloxstyle/commit/0d9cbd3)) to absorb serverless GPU cold starts.

3. **Version 3 — FLUX.2 Klein 4B + Watch Editor (`modal/flux2-klein/`, `web/src/components/WatchEditor.tsx`)**
   - 4-step FLUX.2 Klein 4B editing via Diffusers on local Apple Silicon MPS or scale-to-zero Modal L40S (`min_containers=0`, 5s scaledown, persistent `modal.Volume` HF cache).
   - TypeScript canvas editor projecting wrapped watch geometry across `F / L / B / R` arm UV faces, sending a targeted `512 × 512` crop + mask, strict masked compositing, unit-tested UV wrap geometry, a 10-fixture angle/pattern benchmark (`watch_benchmark.py`), and live Three.js 3D OBJ avatar previews.
