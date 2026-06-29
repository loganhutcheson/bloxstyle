import os
import io
import sys
import modal
import traceback
from fastapi import Request, Response
from fastapi.responses import JSONResponse

app = modal.App("roblox-shirt-lora")
ROOT = os.path.dirname(os.path.abspath(__file__))

# Dependencies image
image = (
	modal.Image.debian_slim()
	.run_commands(
		"pip install --upgrade pip",
		# CUDA 12.1 wheel for PyTorch on Modal GPU runners
		"pip install --extra-index-url https://download.pytorch.org/whl/cu121 torch==2.5.1+cu121",
		# Remaining deps
		"pip install diffusers==0.30.2 transformers==4.45.2 accelerate==1.0.1 Pillow==10.4.0 safetensors==0.4.5 numpy==1.26.4 fastapi[standard]==0.115.4",
	)
	# Include only the minimal inference helpers to avoid uploading the whole repo
	.add_local_file(os.path.join(ROOT, "controlnet_inpaint_generate.py"), "/root/app/controlnet_inpaint_generate.py")
	.add_local_file(os.path.join(ROOT, "inference_shirt_lora.py"), "/root/app/inference_shirt_lora.py")
)

# Local paths to embed (update if yours differ)
LOCAL_LORA = os.path.join(ROOT, "weights", "shirt_lora_output_v2", "shirt_generator_final.safetensors")
LOCAL_OUTLINE = os.path.join(ROOT, "Template-Shirts-Outline.png")

# Remote paths baked into the image
REMOTE_LORA = "/assets/shirt_generator_final.safetensors"
REMOTE_OUTLINE = "/assets/Template-Shirts-Outline.png"

@app.local_entrypoint()
def upload_assets():
	"""No-op: assets are baked into the image now. Verifies local files exist."""
	missing = [p for p in [LOCAL_LORA, LOCAL_OUTLINE] if not os.path.exists(p)]
	if missing:
		raise FileNotFoundError(f"Missing local files: {missing}")
	print("Assets verified locally. No upload needed (bundled into image).")

# Rebuild the image with assets baked in (Modal caches layers across runs)
image = (
	image
	.add_local_file(LOCAL_LORA, REMOTE_LORA)
	.add_local_file(LOCAL_OUTLINE, REMOTE_OUTLINE)
)

@app.cls(
	image=image,
	gpu="A10G",
	timeout=600,
)
class ShirtGenerator:
	def __enter__(self):
		# Lazy-init on first request; nothing to do here
		return self

	def _ensure_initialized(self):
		if hasattr(self, "pipe") and self.pipe is not None:
			return
		# Make project code importable
		if "/root/app" not in sys.path:
			sys.path.append("/root/app")
	# Imports after sys.path update
		from diffusers import (
			ControlNetModel,
			StableDiffusionControlNetInpaintPipeline,
			DPMSolverMultistepScheduler,
		)
		import torch
		from controlnet_inpaint_generate import (
			load_image,
			create_control_image_from_outline,
			create_inpaint_mask_from_outline,
			create_inpaint_mask_from_black_regions,
			ensure_size,
		)
		from inference_shirt_lora import load_custom_lora_weights_into_unet

		self.torch = torch
		self.load_image = load_image
		self.create_control_image_from_outline = create_control_image_from_outline
		self.create_inpaint_mask_from_outline = create_inpaint_mask_from_outline
		self.create_inpaint_mask_from_black_regions = create_inpaint_mask_from_black_regions
		self.ensure_size = ensure_size
		self.ControlNetModel = ControlNetModel
		self.StableDiffusionControlNetInpaintPipeline = StableDiffusionControlNetInpaintPipeline
		self.DPMSolverMultistepScheduler = DPMSolverMultistepScheduler
		self.load_custom_lora_weights_into_unet = load_custom_lora_weights_into_unet

		# Device/dtype preference
		if torch.cuda.is_available():
			device, dtype = ("cuda", torch.float16)
		elif torch.backends.mps.is_available():
			device, dtype = ("mps", torch.float32)
		else:
			device, dtype = ("cpu", torch.float32)
		self.device = device
		self.dtype = dtype

		# Model setup
		controlnet_id = "lllyasviel/control_v11p_sd15_lineart"
		base_model_id = "runwayml/stable-diffusion-inpainting"
		self.controlnet = self.ControlNetModel.from_pretrained(controlnet_id, torch_dtype=dtype)
		self.pipe = self.StableDiffusionControlNetInpaintPipeline.from_pretrained(
			base_model_id,
			controlnet=self.controlnet,
			torch_dtype=dtype,
			safety_checker=None,
		).to(device)
		try:
			self.pipe.enable_vae_slicing(); self.pipe.enable_attention_slicing()
		except Exception:
			pass
		self.pipe.scheduler = self.DPMSolverMultistepScheduler.from_config(self.pipe.scheduler.config)

		# Inject LoRA
		self.load_custom_lora_weights_into_unet(self.pipe.unet, REMOTE_LORA, lora_scale=0.75)
		print(f"Initialized pipeline on device={device}, dtype={dtype}")

	def _infer(self, prompt: str) -> bytes:
		"""Run a single inference and return PNG bytes."""
		from PIL import Image
		self._ensure_initialized()

		width, height = 585, 559
		outline_img = self.load_image(REMOTE_OUTLINE)
		control_img = self.create_control_image_from_outline(outline_img, width, height)
		mask_img = self.create_inpaint_mask_from_black_regions(outline_img, width, height, dilate=6)
		template_img = Image.new("RGB", (width, height), color=(255, 255, 255))

		# Pad to multiples of 8 for model, then crop back to requested size
		def _round_up_to_multiple_of_8(n: int) -> int:
			return (n + 7) // 8 * 8

		pad_w, pad_h = _round_up_to_multiple_of_8(width), _round_up_to_multiple_of_8(height)
		if (pad_w, pad_h) != (width, height):
			# Control image: pad with white background
			control_canvas = Image.new("RGB", (pad_w, pad_h), (255, 255, 255))
			control_canvas.paste(control_img, (0, 0))
			control_img = control_canvas
			# Mask: convert to L; pad with black (0) to keep area outside original untouched
			mask_rgb = mask_img.convert("L")
			mask_canvas = Image.new("L", (pad_w, pad_h), 0)
			mask_canvas.paste(mask_rgb, (0, 0))
			mask_img = mask_canvas
			# Template image: pad with white
			template_canvas = Image.new("RGB", (pad_w, pad_h), (255, 255, 255))
			template_canvas.paste(template_img, (0, 0))
			template_img = template_canvas

		# Run
		result = self.pipe(
			prompt=prompt,
			negative_prompt=None,
			image=template_img,
			mask_image=mask_img,
			control_image=control_img,
			num_inference_steps=30,
			guidance_scale=7.0,
			controlnet_conditioning_scale=1.5,
			num_images_per_prompt=1,
		)
		img = result.images[0]
		# Crop back to exact requested size
		if (pad_w, pad_h) != (width, height):
			img = img.crop((0, 0, width, height))
		buf = io.BytesIO()
		img.save(buf, format="PNG")
		return buf.getvalue()

	@modal.fastapi_endpoint(method="POST")
	async def generate(self, request: Request):
		"""HTTP endpoint: expects JSON {"prompt": "..."}, returns PNG bytes."""
		try:
			data = await request.json()
			prompt = (data.get("prompt") or "").strip()
			if not prompt:
				return JSONResponse({"message": "Missing prompt"}, status_code=400)
			png_bytes = self._infer(prompt)
			return Response(content=png_bytes, media_type="image/png")
		except Exception:
			return JSONResponse({"message": "Internal error", "trace": traceback.format_exc()}, status_code=500)

	@modal.fastapi_endpoint(method="GET")
	async def health(self):
		return JSONResponse({"ok": True})
