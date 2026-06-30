import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

function getQwenUrl() {
  return (
    process.env.QWEN_EDIT_URL ||
    process.env.NEXT_PUBLIC_QWEN_EDIT_URL ||
    ""
  );
}

async function warmQwen(qwenUrl: string) {
  const postRes = await fetch(qwenUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({ warm: true }),
  });

  if (postRes.ok) return postRes;

  if (![400, 404, 405, 415, 422].includes(postRes.status)) {
    return postRes;
  }

  return fetch(qwenUrl, {
    method: "GET",
    headers: { Accept: "application/json" },
  });
}

function formatQwenError(prefix: string, text: string, status: number) {
  const message = text || String(status);
  if (message.toLowerCase().includes("invalid modal http call")) {
    return `${prefix}: Modal rejected the HTTP call. Check that QWEN_EDIT_URL is the deployed Modal web endpoint URL and that the Modal app is deployed, not stopped.`;
  }
  return `${prefix}: ${message}`;
}

export async function POST(req: Request) {
  try {
    const qwenUrl = getQwenUrl();
    if (!qwenUrl) {
      return new NextResponse("QWEN_EDIT_URL not configured", { status: 501 });
    }

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = (await req.json().catch(() => null)) as { warm?: boolean } | null;
      if (body?.warm === true) {
        const res = await warmQwen(qwenUrl);
        if (!res.ok) {
          const t = await res.text().catch(() => "");
          return new NextResponse(formatQwenError("Qwen warm error", t, res.status), {
            status: 502,
          });
        }
        const ct = res.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const payload = await res.json().catch(() => ({ ok: true }));
          return NextResponse.json({ ok: true, warmed: true, upstream: payload });
        }
        return NextResponse.json({ ok: true, warmed: true });
      }
    }

    const formData = await req.formData();
    const image = formData.get("image") as File | null;
    const prompt = formData.get("prompt") as string | null;
    if (!image) {
      return new NextResponse("Missing image", { status: 400 });
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
      return new NextResponse(formatQwenError("Qwen edit error", t, res.status), {
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
