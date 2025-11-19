import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  try {
    const formData = await req.formData();
    const image = formData.get("image") as File | null;
    const prompt = formData.get("prompt") as string | null;
    if (!image) {
      return new NextResponse("Missing image", { status: 400 });
    }
    const qwenUrl =
      process.env.QWEN_EDIT_URL ||
      process.env.NEXT_PUBLIC_QWEN_EDIT_URL ||
      "";
    if (!qwenUrl) {
      return new NextResponse("QWEN_EDIT_URL not configured", { status: 501 });
    }

    // Forward to upstream
    const forward = new FormData();
    forward.append("image", image, "input.png");
    if (prompt && prompt.trim()) forward.append("prompt", prompt.trim());

    const res = await fetch(qwenUrl, {
      method: "POST",
      body: forward,
    });
    if (!res.ok) {
      const t = await res.text().catch(() => "");
      return new NextResponse(`Qwen edit error: ${t || res.status}`, {
        status: 502,
      });
    }
    const buf = await res.arrayBuffer();
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
