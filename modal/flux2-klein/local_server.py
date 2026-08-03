from __future__ import annotations

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response

from engine import FluxEditor


editor: FluxEditor | None = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global editor
    editor = FluxEditor(device=os.getenv("FLUX_DEVICE") or None)
    yield
    editor = None


app = FastAPI(title="FLUX.2 Klein shirt editor", lifespan=lifespan)


@app.get("/health")
def health() -> dict[str, bool]:
    return {"ok": True, "loaded": editor is not None}


@app.post("/")
def edit_image(
    image: UploadFile = File(...),
    prompt: str | None = Form(None),
    seed: int | None = Form(None),
) -> Response:
    if editor is None:
        raise HTTPException(status_code=503, detail="Model is not loaded")
    if image.content_type not in {"image/png", "image/jpeg", "image/webp"}:
        raise HTTPException(status_code=415, detail="Expected a PNG, JPEG, or WebP image")

    image_bytes = image.file.read()
    if not image_bytes:
        raise HTTPException(status_code=400, detail="Image is empty")
    if len(image_bytes) > 20 * 1024 * 1024:
        raise HTTPException(status_code=413, detail="Image exceeds 20 MB")

    try:
        result = editor.edit(image_bytes=image_bytes, prompt=prompt, seed=seed)
    except Exception as exc:
        raise HTTPException(status_code=500, detail=f"Generation failed: {exc}") from exc
    return Response(result, media_type="image/png", headers={"Cache-Control": "no-store"})
