import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    const costPerGeneration = 100;

    const form = await request.formData();
    const prompt = String(form.get("prompt") || "").trim();
    const image = form.get("image") as File | null;
    const mask = form.get("mask") as File | null;

    if (!prompt) {
      return new Response(JSON.stringify({ message: "Missing prompt" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    if (!image) {
      return new Response(JSON.stringify({ message: "Missing image file" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Global credits (same model as /api/generate)
    const globalKey = "global";
    const creditRow = await prisma.credit.upsert({
      where: { email: globalKey },
      update: {},
      create: { email: globalKey, credits: 10000 },
    });
    if (creditRow.credits < costPerGeneration) {
      return new Response(JSON.stringify({ message: "Insufficient global credits" }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      });
    }

    // TODO LOGAN - production security
    // add cryptography to prevent others accessing
    // the modal endpoint

    // Upstream (Modal Comfy inpaint endpoint). Defaults to provided domain.
    const upstreamUrl =
      process.env.INPAINT_API_URL?.trim() ||
      "https://loganchutcheson--api.modal.run/";

    // Rebuild multipart form for upstream
    const upstreamForm = new FormData();
    upstreamForm.append("prompt", prompt);
    // Force materialization to Blob to ensure proper content-type/length
    const imageBlob = new Blob([await image.arrayBuffer()], { type: image.type || "application/octet-stream" });
    upstreamForm.append("image", imageBlob, image.name || "image.png");
    const forwardedImageBytes = imageBlob.size;
    const forwardedImageType = imageBlob.type || "";
    let forwardedMaskBytes = 0;
    let forwardedMaskType = "";
    if (mask) {
      const maskBlob = new Blob([await mask.arrayBuffer()], { type: mask.type || "application/octet-stream" });
      upstreamForm.append("mask", maskBlob, mask.name || "mask.png");
      forwardedMaskBytes = maskBlob.size;
      forwardedMaskType = maskBlob.type || "";
    }

    const upstream = await fetch(upstreamUrl, {
      method: "POST",
      headers: { Accept: "image/*" },
      body: upstreamForm,
      // Don't set Content-Type; fetch will set boundary
    });

    if (!upstream.ok) {
      let errorMsg = `Upstream error ${upstream.status}`;
      try {
        const ct = upstream.headers.get("content-type") || "";
        if (ct.includes("application/json")) {
          const maybe: unknown = await upstream.json();
          const isObject = (v: unknown): v is Record<string, unknown> =>
            typeof v === "object" && v !== null;
          if (isObject(maybe) && typeof maybe.detail === "string") {
            errorMsg = maybe.detail;
          }
          if (isObject(maybe) && typeof maybe.message === "string") {
            errorMsg = maybe.message;
          }
        } else {
          const text = await upstream.text();
          if (text) errorMsg = text;
        }
      } catch {}
      return new Response(JSON.stringify({ message: errorMsg }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    // If upstream responded OK but didn't send an image, surface a clear error
    const upstreamCt = upstream.headers.get("content-type") || "";
    const upstreamCl = upstream.headers.get("content-length") || "";
    if (!upstreamCt.toLowerCase().startsWith("image/")) {
      let payload: unknown = null;
      let textSnippet = "";
      try {
        payload = await upstream.json();
      } catch {
        try {
          const txt = await upstream.text();
          textSnippet = txt.slice(0, 500);
        } catch {}
      }
      const isObject = (v: unknown): v is Record<string, unknown> =>
        typeof v === "object" && v !== null;
      const message =
        (isObject(payload) && typeof payload.message === "string" && payload.message) ||
        (isObject(payload) && typeof payload.detail === "string" && payload.detail) ||
        (textSnippet ? `Upstream returned non-image: ${textSnippet}` : "Upstream returned non-image response");
      return new Response(JSON.stringify({ message }), {
        status: 502,
        headers: {
          "Content-Type": "application/json",
          "X-Upstream-Content-Type": upstreamCt,
          "X-Upstream-Content-Length": upstreamCl,
        },
      });
    }

    // Decrement on success
    try {
      await prisma.credit.update({
        where: { email: "global" },
        data: { credits: { decrement: costPerGeneration } },
      });
    } catch {}

    // Stream upstream body directly to the client to preserve transfer semantics
    return new Response(upstream.body, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "image/jpeg",
        "X-Upstream-Content-Type": upstreamCt,
        "X-Upstream-Content-Length": upstreamCl,
        "X-Upstream-Status": String(upstream.status),
        "X-Forwarded-Image-Bytes": String(forwardedImageBytes),
        "X-Forwarded-Image-Type": forwardedImageType,
        "X-Forwarded-Mask-Bytes": String(forwardedMaskBytes),
        "X-Forwarded-Mask-Type": forwardedMaskType,
        "Cache-Control": "no-store",
        ...(upstreamCl ? { "Content-Length": upstreamCl } : {}),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Inpaint failed";
    return new Response(JSON.stringify({ message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}



