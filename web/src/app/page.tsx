"use client";
import { useEffect, useRef, useState } from "react";
import ScrollingBanner from "@/components/ScrollingBanner";
import AvatarViewer from "@/components/AvatarViewer";

export default function Home() {
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null;

  const [promptText, setPromptText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [bannerUrls, setBannerUrls] = useState<string[]>([]);
  const [isColdStarting, setIsColdStarting] = useState(false);
  const coldStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  // Inpaint state
  const [inpaintPrompt, setInpaintPrompt] = useState("");
  const [inpaintImage, setInpaintImage] = useState<File | null>(null);
  const [inpaintMask, setInpaintMask] = useState<File | null>(null);
  const [inpaintSubmitting, setInpaintSubmitting] = useState(false);
  const [inpaintResultUrl, setInpaintResultUrl] = useState<string | null>(null);

  // Client-side prewarm via our own API route so it hits the same host as generate
  useEffect(() => {
    (async () => {
      try {
        await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ warm: true }),
          keepalive: true,
        });
      } catch {}
    })();
  }, []);

  // Fetch showcase images for the scrolling banner
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const res = await fetch("/api/cool_shirts", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        const files: string[] = Array.isArray(data?.files) ? data.files : [];
        const urls = files.map((name) => `/cool_shirts/${encodeURIComponent(name)}`);
        if (isMounted) setBannerUrls(urls);
      } catch {}
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  // Load credits from API
  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const res = await fetch("/api/credits", { cache: "no-store" });
        if (!res.ok) return;
        const data = await res.json();
        if (isMounted && typeof data?.credits === "number") setCredits(data.credits);
      } catch {}
    })();
    return () => {
      isMounted = false;
    };
  }, []);

  // simple progress animation handled by width change only

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (typeof credits === "number" && credits < 100) {
      return;
    }
    setIsSubmitting(true);
    setGeneratedImageUrl(null);
    setIsColdStarting(false);

    // Credits will be decremented server-side only on success

    // If the request hasn't returned within the threshold, assume a cold start
    if (coldStartTimeoutRef.current) {
      clearTimeout(coldStartTimeoutRef.current);
    }
    coldStartTimeoutRef.current = setTimeout(() => {
      setIsColdStarting(true);
    }, 3500);
    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptText })
      });

      if (!response.ok) {
        const maybeJson: unknown = await response
          .json()
          .catch(() => ({ message: "Failed to generate image" }));
        const message =
          isRecord(maybeJson) && typeof maybeJson.message === "string"
            ? maybeJson.message
            : "Failed to generate image";
        throw new Error(message);
      }

      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      setGeneratedImageUrl(objectUrl);
      // Refresh credits after a successful generation
      try {
        const res = await fetch("/api/credits", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (typeof data?.credits === "number") setCredits(data.credits);
      } catch {}
    } catch {
      // Sync credits on error, in case server enforced limits
      try {
        const res = await fetch("/api/credits", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (typeof data?.credits === "number") setCredits(data.credits);
      } catch {}
    } finally {
      if (coldStartTimeoutRef.current) {
        clearTimeout(coldStartTimeoutRef.current);
        coldStartTimeoutRef.current = null;
      }
      setIsColdStarting(false);
      setIsSubmitting(false);
    }
  }

  async function handleInpaintSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (typeof credits === "number" && credits < 100) {
      return;
    }
    if (!inpaintImage) return;
    setInpaintSubmitting(true);
    setInpaintResultUrl(null);
    try {
      const fd = new FormData();
      fd.append("prompt", inpaintPrompt);
      fd.append("image", inpaintImage, inpaintImage.name || "image.png");
      if (inpaintMask) {
        fd.append("mask", inpaintMask, inpaintMask.name || "mask.png");
      }
      const response = await fetch("/api/inpaint", {
        method: "POST",
        body: fd,
      });
      if (!response.ok) {
        const maybeJson: unknown = await response.json().catch(() => ({}));
        const message =
          isRecord(maybeJson) && typeof maybeJson.message === "string"
            ? maybeJson.message
            : "Inpaint failed";
        throw new Error(message);
      }
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      setInpaintResultUrl(url);
      // refresh credits
      try {
        const res = await fetch("/api/credits", { cache: "no-store" });
        const data: unknown = await res.json().catch(() => ({}));
        if (isRecord(data) && typeof data.credits === "number") setCredits(data.credits);
      } catch {}
    } catch {
      try {
        const res = await fetch("/api/credits", { cache: "no-store" });
        const data: unknown = await res.json().catch(() => ({}));
        if (isRecord(data) && typeof data.credits === "number") setCredits(data.credits);
      } catch {}
    } finally {
      setInpaintSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col p-6 gap-6">
      <div className="w-full py-16 text-center">
        <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight">Roblox Clothing</h1>
      </div>

      <div className="w-full max-w-2xl mx-auto">
        <label htmlFor="prompt" className="block text-base font-medium mb-2">
          Text to Shirt (Classic 2D):
        </label>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            id="prompt"
            type="text"
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            className="flex-1 rounded-md border border-black/10 dark:border-white/10 bg-transparent px-3 py-2"
            required
          />
          <button
            type="submit"
            disabled={isSubmitting || (typeof credits === "number" && credits < 100)}
            className="rounded-md bg-black text-white px-4 py-2 disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {isSubmitting ? "Generating" : "Generate"}
          </button>
        </form>

        <p className="mt-2 text-sm text-red-700/80 dark:text-red-400/80">
          Note: short abstract prompts are best i.e. &#39;galactic explosion&#39;.
        </p>

        <div className="mt-6">
          <AvatarViewer heightPx={380} />
        </div>

        {generatedImageUrl ? (
          <div className="mt-6">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={generatedImageUrl}
              alt="2D Roblox shirt generated by AI"
              className="w-full h-auto rounded-md border border-black/10 dark:border-white/10"
            />
          </div>
        ) : null}

        {isSubmitting ? (
          <div className="mt-4">
            <div className="h-2 w-full rounded bg-black/10 dark:bg-white/10 overflow-hidden">
              <div
                className={isColdStarting ? "h-full bg-blue-500" : "h-full bg-black/40 dark:bg-white/40"}
                style={{ width: isColdStarting ? "33%" : "66%" }}
              />
            </div>
          </div>
        ) : null}

        {/* Inpainting (image edit) */}
        <div className="mt-12 pt-8 border-t border-black/10 dark:border-white/10">
          <h2 className="text-xl font-semibold mb-3">Image (Inpainting) Edit</h2>
          <form onSubmit={handleInpaintSubmit} className="flex flex-col gap-3">
            <input
              type="text"
              placeholder="Prompt for edit"
              value={inpaintPrompt}
              onChange={(e) => setInpaintPrompt(e.target.value)}
              className="rounded-md border border-black/10 dark:border-white/10 bg-transparent px-3 py-2"
              required
            />
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => setInpaintImage(e.target.files?.[0] || null)}
                className="flex-1 rounded-md border border-black/10 dark:border-white/10 bg-transparent px-3 py-2"
                required
              />
              <input
                type="file"
                accept="image/png,image/jpeg"
                onChange={(e) => setInpaintMask(e.target.files?.[0] || null)}
                className="flex-1 rounded-md border border-black/10 dark:border-white/10 bg-transparent px-3 py-2"
                placeholder="Optional mask"
              />
            </div>
            <p className="text-sm text-black/60 dark:text-white/60">
              If no mask is provided, the uploaded image must have transparency (alpha) where you want to inpaint.
            </p>
            <button
              type="submit"
              disabled={inpaintSubmitting || (typeof credits === "number" && credits < 100)}
              className="rounded-md bg-black text-white px-4 py-2 disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {inpaintSubmitting ? "Editing..." : "Edit Image"}
            </button>
          </form>
          {inpaintResultUrl ? (
            <div className="mt-4">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={inpaintResultUrl}
                alt="Inpaint result"
                className="w-full h-auto rounded-md border border-black/10 dark:border-white/10"
              />
            </div>
          ) : null}
        </div>
      </div>

      {/* Mobile-friendly scrolling banner */}
      <div className="w-full mt-6 sm:mt-10 px-1 sm:px-2">
        {bannerUrls.length > 0 ? (
          <ScrollingBanner
            imageUrls={bannerUrls}
            heightPx={96}
            gapPx={10}
            speedSeconds={36}
            direction="right"
          />
        ) : null}
      </div>
    </div>
  );
}
