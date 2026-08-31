import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function watchRenderUrl(): string {
  return (
    process.env.WATCH_RENDER_URL?.trim() ||
    "https://loganchutcheson--watch-render.modal.run"
  );
}

export async function POST(request: Request) {
  try {
    const incoming = await request.formData();
    const image = incoming.get("image");
    const mask = incoming.get("mask");
    if (!(image instanceof File) || !(mask instanceof File)) {
      return new NextResponse("Missing image or mask", { status: 400 });
    }

    const forward = new FormData();
    forward.append("image", image, "watch-input.png");
    forward.append("mask", mask, "watch-mask.png");

    const response = await fetch(watchRenderUrl(), { method: "POST", body: forward });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      return new NextResponse(`Watch renderer failed: ${detail || response.status}`, { status: 502 });
    }

    return new NextResponse(await response.arrayBuffer(), {
      status: 200,
      headers: {
        "content-type": response.headers.get("content-type") || "image/png",
        "cache-control": "no-store",
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    return new NextResponse(`Watch renderer unavailable: ${message}`, { status: 502 });
  }
}
