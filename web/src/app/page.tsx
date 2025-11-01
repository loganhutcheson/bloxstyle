"use client";

import { useEffect, useRef, useState } from "react";
import ScrollingBanner from "@/components/ScrollingBanner";

export default function Home() {
  const [promptText, setPromptText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bannerUrls, setBannerUrls] = useState<string[]>([]);
  const [isColdStarting, setIsColdStarting] = useState(false);
  const [dotCount, setDotCount] = useState(1);
  const coldStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [credits, setCredits] = useState<number>(0);

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
      } catch {
        // ignore
      }
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

  // Animate dots while in cold start state
  useEffect(() => {
    if (!isColdStarting) return;
    const id = setInterval(() => {
      setDotCount((d) => (d % 3) + 1);
    }, 500);
    return () => clearInterval(id);
  }, [isColdStarting]);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (credits <= 0) {
      setErrorMessage("You are out of credits.");
      return;
    }
    setIsSubmitting(true);
    setErrorMessage(null);
    setGeneratedImageUrl(null);
    setIsColdStarting(false);
    setDotCount(1);

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
        const maybeJson = await response
          .json()
          .catch(() => ({ message: "Failed to generate image" }));
        throw new Error(maybeJson?.message || "Failed to generate image");
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
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setErrorMessage(message);
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
      setDotCount(1);
      setIsSubmitting(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col p-6 gap-6">
      <div className="flex-1 w-full flex items-center justify-center">
        <div className="w-full max-w-2xl">
          <h1 className="text-2xl font-semibold mb-4">Roblox Shirt Generator</h1>
        <form onSubmit={handleSubmit} className="flex gap-2">
          <input
            type="text"
            value={promptText}
            onChange={(e) => setPromptText(e.target.value)}
            className="flex-1 rounded-md border border-black/10 dark:border-white/10 bg-transparent px-3 py-2"
            placeholder="Describe the shirt you want to generate..."
            required
          />
          <button
            type="submit"
            disabled={isSubmitting || credits <= 0}
            className="rounded-md bg-black text-white px-4 py-2 disabled:opacity-50 dark:bg-white dark:text-black"
          >
            {isSubmitting ? "Generating..." : credits <= 0 ? "Out of credits" : "Generate"}
          </button>
        </form>

        <div className="mt-2 text-sm text-black/60 dark:text-white/60">
          Credits remaining: {credits}
        </div>

        {errorMessage ? (
          <p className="text-red-500 mt-4">{errorMessage}</p>
        ) : null}

          {generatedImageUrl ? (
          <div className="mt-6">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
              src={generatedImageUrl}
              alt="Generated shirt preview"
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
            <div className={isColdStarting ? "text-sm mt-2 text-blue-600 dark:text-blue-400" : "text-sm mt-2 text-black/60 dark:text-white/60"}>
              {isColdStarting ? (
                <>Cold starting{".".repeat(dotCount)}</>
              ) : (
                <>Generating…</>
              )}
            </div>
          </div>
        ) : null}
        </div>
      </div>

      <div>
        {bannerUrls.length > 0 ? (
          <ScrollingBanner imageUrls={bannerUrls} direction="right" heightPx={140} />
        ) : null}
      </div>
    </div>
  );
}
