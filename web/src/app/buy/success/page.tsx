"use client";

import { Suspense, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";

export default function BuySuccessPage() {
  return (
    <Suspense fallback={null}>
      <BuySuccessContent />
    </Suspense>
  );
}

function BuySuccessContent() {
  const params = useSearchParams();
  const sessionId = params.get("session_id") || "";
  const [status, setStatus] = useState<"idle" | "crediting" | "credited" | "error">("idle");
  const [message, setMessage] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!sessionId) return;
      setStatus("crediting");
      try {
        const res = await fetch("/api/checkout/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ session_id: sessionId }),
        });
        const data = await res.json().catch(() => ({}));
        if (!cancelled) {
          if (res.ok) {
            setStatus("credited");
            setMessage(`Added ${data?.credited ?? 0} credits to your account.`);
          } else {
            setStatus("error");
            setMessage(data?.message || "Could not confirm payment.");
          }
        }
      } catch {
        if (!cancelled) {
          setStatus("error");
          setMessage("Could not confirm payment.");
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId]);

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6">
      <div className="text-center">
        <h1 className="text-2xl font-semibold mb-2">Payment successful</h1>
        <p className="text-black/60 dark:text-white/60">
          {status === "credited"
            ? message || "Your credits were added."
            : status === "crediting"
            ? "Finalizing your purchase…"
            : message || "Your credits will appear shortly."}
        </p>
      </div>
    </div>
  );
}



