"use client";
import { useEffect, useRef, useState } from "react";
import ScrollingBanner from "@/components/ScrollingBanner";
import AvatarViewer from "@/components/AvatarViewer";

export default function Home() {
  const isRecord = (v: unknown): v is Record<string, unknown> =>
    typeof v === "object" && v !== null;

  const [bannerUrls, setBannerUrls] = useState<string[]>([]);
  const [isColdStarting, setIsColdStarting] = useState(false);
  const coldStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [credits, setCredits] = useState<number | null>(null);

  // Client-side prewarm for the same Qwen backend used by the magic edit button.
  useEffect(() => {
    (async () => {
      try {
        await fetch("/api/qwen_edit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ warm: true, source: "homepage_prewarm" }),
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

  // Removed inpaint and classic generation UIs

  return (
    <div className="min-h-screen w-full flex flex-col p-6 gap-6">
      {/* Minimal glowing rings background */}
      <svg
        className="pointer-events-none fixed inset-0 -z-10"
        width="100%"
        height="100%"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        aria-hidden
      >
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2.5" result="coloredBlur" />
            <feMerge>
              <feMergeNode in="coloredBlur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>
          <linearGradient id="ringGrad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#EC4899" />
            <stop offset="50%" stopColor="#A855F7" />
            <stop offset="100%" stopColor="#EC4899" />
          </linearGradient>
        </defs>
        {/* top-right ring */}
        <circle cx="82" cy="18" r="12" fill="none" stroke="url(#ringGrad)" strokeWidth="0.6" opacity="0.6" filter="url(#glow)" />
        {/* mid-right ring */}
        <circle cx="90" cy="56" r="9.5" fill="none" stroke="url(#ringGrad)" strokeWidth="0.5" opacity="0.45" filter="url(#glow)" />
        {/* left ring */}
        <circle cx="18" cy="32" r="14" fill="none" stroke="url(#ringGrad)" strokeWidth="0.6" opacity="0.4" filter="url(#glow)" />
      </svg>

      <div className="w-full max-w-7xl mx-auto flex items-center justify-end gap-2 px-2">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/coin.svg" alt="Credits" width={18} height={18} />
        <span className="text-sm">{typeof credits === "number" ? credits : "—"}</span>
      </div>
      <div className="w-full max-w-7xl mx-auto px-2">
        <p className="text-xs italic text-black/60 dark:text-white/60 text-right">
          these are the free coins for early users, please be kind
        </p>
      </div>
      {/* Hero */}
      <div className="w-full py-10 text-center px-2">
        <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-purple-600 via-pink-500 to-orange-400">
          AI Roblox Clothing Editor
        </h1>
        <p className="mt-4 text-base md:text-lg text-black/70 dark:text-white/70 max-w-2xl mx-auto">
          Generate and apply 2D shirt and pants textures. Edit with an in-view magic prompt and see changes instantly.
        </p>
        <div className="mt-6 flex items-center justify-center gap-3">
          <a href="#editor" className="rounded-md bg-purple-600 hover:bg-purple-700 text-white px-5 py-3 text-base">
            Start designing
          </a>
          <a href="#examples" className="rounded-md border border-black/10 dark:border-white/10 px-5 py-3 text-base hover:bg-black/5 dark:hover:bg-white/10">
            See examples
          </a>
        </div>
      </div>

      <div id="editor" className="w-full max-w-7xl mx-auto px-2">
        <div className="mt-0 flex justify-end items-start">
          <div className="shrink-0">
            <AvatarViewer heightPx={720} />
          </div>
          {/* right-side gutter for comfortable scroll area */}
          <div aria-hidden className="w-8 sm:w-12 md:w-20 lg:w-24 xl:w-28" />
        </div>
      </div>

      {/* Chat UI removed as requested */}

      {/* bottom spacer for scroll buffer (reduced 50%) */}
      <div aria-hidden className="h-20 sm:h-28 lg:h-40" />

      {/* Examples banner removed per request */}
    </div>
  );
}
