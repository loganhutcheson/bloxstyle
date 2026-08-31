from __future__ import annotations

import argparse
import io
import math
import urllib.request
import uuid
from dataclasses import dataclass
from pathlib import Path

from PIL import Image, ImageChops, ImageDraw


MODEL_SIZE = 512
FACE_DIAMETER = 50
STRAP_WIDTH = 22
PADDING = 25


@dataclass(frozen=True)
class Fixture:
    name: str
    angle: float
    guide_length: int
    background: tuple[int, int, int]
    pattern: str = "plain"


FIXTURES = [
    Fixture("horizontal-light", 0, 100, (232, 220, 202)),
    Fixture("vertical-dark", 90, 110, (38, 64, 88)),
    Fixture("diagonal-warm", 38, 125, (173, 122, 102)),
    Fixture("reverse-diagonal", 142, 95, (91, 116, 91)),
    Fixture("short-guide", -20, 72, (215, 205, 188)),
    Fixture("long-guide", 12, 180, (59, 59, 66)),
    Fixture("vertical-stripes", 82, 130, (192, 151, 98), "stripes"),
    Fixture("diagonal-checks", -48, 115, (116, 143, 165), "checks"),
    Fixture("horizontal-dark", 4, 145, (54, 43, 50)),
    Fixture("steep-light", 63, 105, (204, 208, 196)),
]


def native_crop_size(fixture: Fixture) -> int:
    angle = math.radians(fixture.angle)
    dx = abs(math.cos(angle) * fixture.guide_length)
    dy = abs(math.sin(angle) * fixture.guide_length)
    content_width = max(dx + STRAP_WIDTH, FACE_DIAMETER)
    content_height = max(dy + STRAP_WIDTH, FACE_DIAMETER)
    return math.ceil(max(content_width, content_height) + PADDING * 2)


def draw_background(image: Image.Image, fixture: Fixture) -> None:
    draw = ImageDraw.Draw(image)
    draw.rectangle((0, 0, MODEL_SIZE, MODEL_SIZE), fill=fixture.background)
    if fixture.pattern == "stripes":
        for x in range(-MODEL_SIZE, MODEL_SIZE * 2, 64):
            draw.line((x, 0, x + MODEL_SIZE, MODEL_SIZE), fill=(160, 116, 76), width=18)
    elif fixture.pattern == "checks":
        for y in range(0, MODEL_SIZE, 64):
            for x in range(0, MODEL_SIZE, 64):
                if (x // 64 + y // 64) % 2:
                    draw.rectangle((x, y, x + 64, y + 64), fill=(94, 119, 143))


def make_fixture(fixture: Fixture) -> tuple[Image.Image, Image.Image, int]:
    native_size = native_crop_size(fixture)
    scale = MODEL_SIZE / native_size
    face_radius = FACE_DIAMETER * scale / 2
    strap_width = max(1, round(STRAP_WIDTH * scale))
    guide_length = fixture.guide_length * scale
    angle = math.radians(fixture.angle)
    dx = math.cos(angle) * guide_length / 2
    dy = math.sin(angle) * guide_length / 2
    center = MODEL_SIZE / 2
    endpoints = [(center - dx, center - dy), (center + dx, center + dy)]

    image = Image.new("RGB", (MODEL_SIZE, MODEL_SIZE))
    draw_background(image, fixture)
    mask = Image.new("L", (MODEL_SIZE, MODEL_SIZE), 0)
    image_draw = ImageDraw.Draw(image)
    mask_draw = ImageDraw.Draw(mask)
    image_draw.line(endpoints, fill=(119, 125, 134), width=strap_width)
    mask_draw.line(endpoints, fill=255, width=strap_width)
    face_box = (
        center - face_radius,
        center - face_radius,
        center + face_radius,
        center + face_radius,
    )
    image_draw.ellipse(face_box, fill=(199, 203, 209), outline=(80, 84, 91), width=max(3, round(4 * scale)))
    mask_draw.ellipse(face_box, fill=255)
    return image, mask, native_size


def encode_png(image: Image.Image) -> bytes:
    output = io.BytesIO()
    image.save(output, "PNG")
    return output.getvalue()


def post_watch(endpoint: str, image: Image.Image, mask: Image.Image) -> bytes:
    boundary = f"----watch-{uuid.uuid4().hex}"
    body = bytearray()
    for field, filename, payload in (
        ("image", "watch-input.png", encode_png(image)),
        ("mask", "watch-mask.png", encode_png(mask)),
    ):
        body.extend(f"--{boundary}\r\n".encode())
        body.extend(
            f'Content-Disposition: form-data; name="{field}"; filename="{filename}"\r\n'.encode()
        )
        body.extend(b"Content-Type: image/png\r\n\r\n")
        body.extend(payload)
        body.extend(b"\r\n")
    body.extend(f"--{boundary}--\r\n".encode())
    request = urllib.request.Request(
        endpoint,
        data=bytes(body),
        method="POST",
        headers={"Content-Type": f"multipart/form-data; boundary={boundary}"},
    )
    with urllib.request.urlopen(request, timeout=300) as response:
        return response.read()


def outside_mask_is_unchanged(source: Image.Image, result: Image.Image, mask: Image.Image) -> bool:
    difference = ImageChops.difference(source.convert("RGB"), result.convert("RGB"))
    difference.paste((0, 0, 0), mask=mask)
    return difference.getbbox() is None


def run(endpoint: str, output_dir: Path, resume: bool) -> None:
    output_dir.mkdir(parents=True, exist_ok=True)
    contact_sheet = Image.new("RGB", (600, len(FIXTURES) * 300), "white")
    passed = 0
    for row, fixture in enumerate(FIXTURES):
        source, mask, native_size = make_fixture(fixture)
        source.save(output_dir / f"{fixture.name}-input.png")
        mask.save(output_dir / f"{fixture.name}-mask.png")
        result_path = output_dir / f"{fixture.name}-output.png"
        if resume and result_path.exists():
            result = Image.open(result_path).convert("RGB")
        else:
            result_bytes = post_watch(endpoint, source, mask)
            result = Image.open(io.BytesIO(result_bytes)).convert("RGB")
            result.save(result_path)
        if outside_mask_is_unchanged(source, result, mask):
            passed += 1

        source_native = source.resize((native_size, native_size), Image.Resampling.LANCZOS)
        result_native = result.resize((native_size, native_size), Image.Resampling.LANCZOS)
        source_zoom = source_native.resize((300, 300), Image.Resampling.NEAREST)
        result_zoom = result_native.resize((300, 300), Image.Resampling.NEAREST)
        contact_sheet.paste(source_zoom, (0, row * 300))
        contact_sheet.paste(result_zoom, (300, row * 300))

    contact_sheet.save(output_dir / "native-contact-sheet.png")
    print(f"Outside-mask preservation: {passed}/{len(FIXTURES)}")
    print(output_dir / "native-contact-sheet.png")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Run the fixed watch-render visual benchmark")
    parser.add_argument("--endpoint", default="http://127.0.0.1:8000/watch-render")
    parser.add_argument("--output", type=Path, default=Path("../../generated/watch-benchmark"))
    parser.add_argument("--no-resume", action="store_true", help="Regenerate completed fixture outputs")
    arguments = parser.parse_args()
    run(arguments.endpoint, arguments.output.resolve(), resume=not arguments.no_resume)
