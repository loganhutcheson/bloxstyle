import { NextResponse } from "next/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const prompt = formData.get("prompt") as string | null;
    const image = formData.get("image") as File | null;
    if (!image) {
      return new NextResponse("Missing image", { status: 400 });
    }
    const fluxUrl = process.env.FLUX_INLINE_URL || process.env.NEXT_PUBLIC_FLUX_INLINE_URL;
    if (!fluxUrl) {
      return new NextResponse("FLUX_INLINE_URL not configured", { status: 500 });
    }

    // Build forward form-data
    const forward = new FormData();
    forward.append("prompt", prompt || "roblox shirt texture, high quality, clean edges");
    forward.append("image", image, "input.png");

    const res = await fetch(fluxUrl, {
      method: "POST",
      body: forward,
    });
    if (!res.ok) {
      const t = await res.text();
      return new NextResponse(`Flux error: ${t}`, { status: 502 });
    }
    const buf = await res.arrayBuffer();
    // Try to infer content type from Flux output; default to image/png
    const ct = res.headers.get("content-type") || "image/png";
    return new NextResponse(Buffer.from(buf), {
      status: 200,
      headers: {
        "content-type": ct,
        "cache-control": "no-store",
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "unknown";
    return new NextResponse(`Server error: ${message}`, { status: 500 });
  }
}


