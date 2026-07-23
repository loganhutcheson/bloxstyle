import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type MagicCallKind = "warm" | "image_edit";

function logMagicCall(
  req: Request,
  kind: MagicCallKind,
  phase: "started" | "completed",
  details: Record<string, unknown> = {},
) {
  console.info(
    JSON.stringify({
      event: "magic_endpoint_call",
      kind,
      phase,
      userAgent: req.headers.get("user-agent") || null,
      referer: req.headers.get("referer") || null,
      ...details,
    }),
  );
}

function getMagicUrl() {
  return (
    process.env.MAGIC_EDIT_URL ||
    process.env.SHIRT_GENERATOR_URL ||
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
  const lower = message.toLowerCase();
  if (lower.includes("invalid modal http call") || lower.includes("invalid function call")) {
    return `${prefix}: Modal rejected the HTTP call. Check that MAGIC_EDIT_URL or QWEN_EDIT_URL is the deployed Modal web endpoint URL and that the Modal app is deployed, not stopped.`;
  }
  return `${prefix}: ${message}`;
}

export async function POST(req: Request) {
  const startedAt = Date.now();
  let creditReserved = false;
  try {
    const qwenUrl = getMagicUrl();
    if (!qwenUrl) {
      return new NextResponse("MAGIC_EDIT_URL or QWEN_EDIT_URL not configured", { status: 501 });
    }

    const contentType = req.headers.get("content-type") || "";
    if (contentType.includes("application/json")) {
      const body = (await req.json().catch(() => null)) as {
        warm?: boolean;
        source?: string;
      } | null;
      if (body?.warm === true) {
        logMagicCall(req, "warm", "started", {
          source: body.source || "unknown",
        });
        const res = await warmQwen(qwenUrl);
        if (!res.ok) {
          logMagicCall(req, "warm", "completed", {
            source: body.source || "unknown",
            ok: false,
            upstreamStatus: res.status,
            durationMs: Date.now() - startedAt,
          });
          const t = await res.text().catch(() => "");
          return new NextResponse(formatQwenError("Qwen warm error", t, res.status), {
            status: 502,
          });
        }
        const ct = res.headers.get("content-type") || "";
        logMagicCall(req, "warm", "completed", {
          source: body.source || "unknown",
          ok: true,
          upstreamStatus: res.status,
          durationMs: Date.now() - startedAt,
        });
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

    const globalKey = "global";
    await prisma.credit.upsert({
      where: { email: globalKey },
      update: {},
      create: { email: globalKey, credits: 10000 },
    });
    const reservation = await prisma.credit.updateMany({
      where: { email: globalKey, credits: { gte: 1 } },
      data: { credits: { decrement: 1 } },
    });
    if (reservation.count === 0) {
      return NextResponse.json(
        { message: "Insufficient global credits" },
        { status: 402 },
      );
    }
    creditReserved = true;

    logMagicCall(req, "image_edit", "started", {
      hasPrompt: Boolean(prompt?.trim()),
      imageBytes: image.size,
    });

    // Forward to upstream
    const forward = new FormData();
    forward.append("image", image, "input.png");
    if (prompt && prompt.trim()) forward.append("prompt", prompt.trim());

    const res = await fetch(qwenUrl, {
      method: "POST",
      body: forward,
    });
    if (!res.ok) {
      await prisma.credit.update({
        where: { email: globalKey },
        data: { credits: { increment: 1 } },
      });
      creditReserved = false;
      logMagicCall(req, "image_edit", "completed", {
        ok: false,
        upstreamStatus: res.status,
        durationMs: Date.now() - startedAt,
      });
      const t = await res.text().catch(() => "");
      return new NextResponse(formatQwenError("Qwen edit error", t, res.status), {
        status: 502,
      });
    }
    const buf = await res.arrayBuffer();
    const ct = res.headers.get("content-type") || "image/png";
    logMagicCall(req, "image_edit", "completed", {
      ok: true,
      upstreamStatus: res.status,
      durationMs: Date.now() - startedAt,
      outputBytes: buf.byteLength,
    });
    return new NextResponse(Buffer.from(buf), {
      status: 200,
      headers: {
        "content-type": ct,
        "cache-control": "no-store",
      },
    });
  } catch (err: unknown) {
    if (creditReserved) {
      await prisma.credit
        .update({
          where: { email: "global" },
          data: { credits: { increment: 1 } },
        })
        .catch((refundError: unknown) => {
          console.error("Failed to refund image-edit credit", refundError);
        });
    }
    const message = err instanceof Error ? err.message : "unknown";
    return new NextResponse(`Server error: ${message}`, { status: 500 });
  }
}
