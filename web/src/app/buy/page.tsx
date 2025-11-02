"use client";

import { useEffect, useState } from "react";

export default function BuyPage() {
  const [loading, setLoading] = useState(false);
  const [credits, setCredits] = useState<number | null>(null);

  useEffect(() => {
    let isMounted = true;
    (async () => {
      try {
        const res = await fetch("/api/credits", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (isMounted && typeof data?.credits === "number") setCredits(data.credits);
      } catch {}
    })();
    return () => { isMounted = false; };
  }, []);

  async function handleBuy() {
    try {
      setLoading(true);
      const res = await fetch("/api/checkout/session", { method: "POST" });
      if (!res.ok) {
        const msg = await res.text().catch(() => "Failed to start checkout");
        throw new Error(msg || "Failed to start checkout");
      }
      const data = await res.json();
      if (data?.url) {
        window.location.href = data.url as string;
      }
    } catch (e) {
      alert(e instanceof Error ? e.message : "Failed to start checkout");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen w-full flex flex-col p-6 gap-6">
      <div className="flex-1 w-full flex items-center justify-center">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-semibold mb-4">Buy credits</h1>
          {typeof credits === "number" ? (
            <div className="mb-4 text-sm text-black/60 dark:text-white/60">Current balance: <span className="font-medium">{credits}</span></div>
          ) : null}
          <div className="mb-6 inline-flex items-center gap-2 rounded-md border border-amber-400/40 bg-amber-50 text-amber-700 px-3 py-1 dark:bg-amber-900/20 dark:text-amber-300 dark:border-amber-300/30">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/coin.svg" alt="coin" className="h-4 w-4" />
            <span className="font-semibold italic">5,000 credits for $5</span>
          </div>
          <div>
            <button
              onClick={handleBuy}
              disabled={loading}
              className="rounded-md bg-black text-white px-4 py-2 disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {loading ? "Redirecting…" : "Buy now"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}


