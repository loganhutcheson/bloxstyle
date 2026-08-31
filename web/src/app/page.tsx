"use client";

import { useCallback, useEffect, useState } from "react";
import AvatarViewer from "@/components/AvatarViewer";
import WatchEditor from "@/components/WatchEditor";
import type { ShirtTextureSnapshot } from "@/lib/shirtTexture";

export default function Home() {
  const [shirtTexture, setShirtTexture] = useState<ShirtTextureSnapshot | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const handleTextureCommit = useCallback((snapshot: ShirtTextureSnapshot) => {
    setShirtTexture(snapshot);
  }, []);

  useEffect(() => {
    let isMounted = true;
    const loadCredits = async () => {
      try {
        const response = await fetch("/api/credits", { cache: "no-store" });
        if (!response.ok) return;
        const data = await response.json();
        if (isMounted && typeof data?.credits === "number") setCredits(data.credits);
      } catch {}
    };
    void loadCredits();
    window.addEventListener("credits-changed", loadCredits);
    return () => {
      isMounted = false;
      window.removeEventListener("credits-changed", loadCredits);
    };
  }, []);

  return (
    <div className="min-h-screen w-full flex flex-col p-6 gap-6">
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
        <circle cx="82" cy="18" r="12" fill="none" stroke="url(#ringGrad)" strokeWidth="0.6" opacity="0.6" filter="url(#glow)" />
        <circle cx="90" cy="56" r="9.5" fill="none" stroke="url(#ringGrad)" strokeWidth="0.5" opacity="0.45" filter="url(#glow)" />
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

      <div className="w-full py-10 text-center px-2">
        <h1 className="text-5xl md:text-6xl font-extrabold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-purple-600 via-pink-500 to-orange-400">
          Accessory Mode
        </h1>
        <p className="mt-3 text-sm text-black/60 sm:text-base">Watch only supported now</p>
      </div>

      <div id="editor" className="w-full max-w-7xl mx-auto px-2">
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,585px)_minmax(0,1fr)]">
          <WatchEditor onTextureCommit={handleTextureCommit} />
          <div className="flex justify-center lg:justify-end">
            <AvatarViewer heightPx={680} shirtTexture={shirtTexture} />
          </div>
        </div>
      </div>

      <div aria-hidden className="h-20 sm:h-28 lg:h-40" />
      <p className="w-full max-w-2xl mx-auto px-2 pb-2 text-center text-base md:text-lg text-black/70 dark:text-white/70">
        Generate and apply 2D shirt and pants textures. Edit with an in-view magic prompt and see changes instantly.
      </p>
    </div>
  );
}
