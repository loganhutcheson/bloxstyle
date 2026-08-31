from __future__ import annotations

import sys
from pathlib import Path

import modal
from fastapi import File, HTTPException, UploadFile
from fastapi.responses import Response


APP_NAME = "roblox-watch-renderer"
MODEL_CACHE = "/cache/huggingface"

model_cache = modal.Volume.from_name("flux2-klein-model-cache", create_if_missing=True)

runtime_image = (
    modal.Image.debian_slim(python_version="3.12")
    .uv_pip_install(
        "accelerate>=1.8,<2",
        "diffusers==0.38.0",
        "fastapi[standard]>=0.115,<1",
        "hf-xet>=1.1,<2",
        "huggingface-hub>=0.36,<1",
        "pillow>=11,<13",
        "protobuf>=5,<7",
        "python-multipart>=0.0.20,<1",
        "sentencepiece>=0.2,<1",
        "torch>=2.7,<3",
        "transformers>=4.57,<5",
    )
    .env(
        {
            "HF_HOME": MODEL_CACHE,
            "HF_XET_HIGH_PERFORMANCE": "1",
        }
    )
    .add_local_file(
        Path(__file__).with_name("engine.py"),
        "/root/flux2_klein/engine.py",
        copy=True,
    )
)

app = modal.App(APP_NAME)


@app.cls(
    image=runtime_image,
    gpu="L40S",
    volumes={"/cache": model_cache},
    min_containers=0,
    max_containers=1,
    buffer_containers=0,
    scaledown_window=5,
    startup_timeout=600,
    timeout=600,
)
@modal.concurrent(max_inputs=1)
class WatchRenderer:
    @modal.enter()
    def load_model(self) -> None:
        sys.path.insert(0, "/root/flux2_klein")
        from engine import FluxEditor

        self.editor = FluxEditor(device="cuda")

    @modal.fastapi_endpoint(method="POST", label="watch-render")
    async def render(
        self,
        image: UploadFile = File(...),
        mask: UploadFile = File(...),
    ) -> Response:
        if image.content_type not in {"image/png", "image/jpeg", "image/webp"}:
            raise HTTPException(status_code=415, detail="Unsupported image type")
        if mask.content_type not in {"image/png", "image/jpeg", "image/webp"}:
            raise HTTPException(status_code=415, detail="Unsupported mask type")

        try:
            result = self.editor.render_watch(await image.read(), await mask.read())
        except ValueError as error:
            raise HTTPException(status_code=400, detail=str(error)) from error

        return Response(content=result, media_type="image/png")
