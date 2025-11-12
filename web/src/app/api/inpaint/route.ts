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

    // Upstream (Modal Comfy inpaint endpoint). Defaults to provided domain.
    const upstreamUrl =
      process.env.INPAINT_API_URL?.trim() ||
      "https://loganchutcheson--api.modal.run/";

    // Rebuild multipart form for upstream
    const upstreamForm = new FormData();
    upstreamForm.append("prompt", prompt);
    upstreamForm.append("image", image, image.name || "image.png");
    if (mask) {
      upstreamForm.append("mask", mask, mask.name || "mask.png");
    }

    const upstream = await fetch(upstreamUrl, {
      method: "POST",
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

    const arrayBuffer = await upstream.arrayBuffer();

    // Decrement on success
    try {
      await prisma.credit.update({
        where: { email: "global" },
        data: { credits: { decrement: costPerGeneration } },
      });
    } catch {}

    return new Response(arrayBuffer, {
      status: 200,
      headers: {
        "Content-Type": upstream.headers.get("content-type") || "image/jpeg",
        "Cache-Control": "no-store",
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



