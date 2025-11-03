"use client";
import { signIn, useSession } from "next-auth/react";
import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import ScrollingBanner from "@/components/ScrollingBanner";

export default function SignInPage() {
  return (
    <Suspense fallback={null}>
      <SignInPageContent />
    </Suspense>
  );
}

function SignInPageContent() {
  const { data } = useSession();
  const isAuthed = Boolean(data?.user);
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";
  const [bannerUrls, setBannerUrls] = useState<string[]>([]);
  // Generator state (no sign-in required)
  const [promptText, setPromptText] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [generatedImageUrl, setGeneratedImageUrl] = useState<string | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [credits, setCredits] = useState<number | null>(null);
  const [isColdStarting, setIsColdStarting] = useState(false);
  const [dotCount, setDotCount] = useState(1);
  const coldStartTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (isAuthed) {
      router.replace(callbackUrl);
    }
  }, [isAuthed, callbackUrl, router]);

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

  // Prewarm generator and load global credits
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
      try {
        const res = await fetch("/api/credits", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (typeof data?.credits === "number") setCredits(data.credits);
      } catch {}
    })();
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
    setIsSubmitting(true);
    setErrorMessage(null);
    setGeneratedImageUrl(null);
    setIsColdStarting(false);
    setDotCount(1);

    if (coldStartTimeoutRef.current) clearTimeout(coldStartTimeoutRef.current);
    coldStartTimeoutRef.current = setTimeout(() => setIsColdStarting(true), 3500);

    try {
      const response = await fetch("/api/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: promptText }),
      });
      if (!response.ok) {
        const maybeJson = await response.json().catch(() => ({ message: "Failed to generate image" }));
        throw new Error(maybeJson?.message || "Failed to generate image");
      }
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      setGeneratedImageUrl(objectUrl);
      // Refresh global credits
      try {
        const res = await fetch("/api/credits", { cache: "no-store" });
        const data = await res.json().catch(() => ({}));
        if (typeof data?.credits === "number") setCredits(data.credits);
      } catch {}
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unexpected error";
      setErrorMessage(message);
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
          <h1 className="text-2xl font-semibold mb-2">Roblox AI Clothing Generator – Create 2D Roblox Shirt Designs Instantly</h1>
          <p className="text-black/70 dark:text-white/70 mb-4">
            Use our Roblox AI clothing generator to create high‑quality 2D Roblox shirt designs in seconds. Just describe your idea and generate a unique Roblox shirt with AI.
          </p>
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
              disabled={isSubmitting}
              className="rounded-md bg-black text-white px-4 py-2 disabled:opacity-50 dark:bg-white dark:text-black"
            >
              {isSubmitting ? "Generating..." : "Generate"}
            </button>
          </form>

          {typeof credits === "number" ? (
            <div className="mt-3 flex justify-end">
              <div className="text-sm text-black/60 dark:text-white/60 flex items-center">
                <span className="mr-2">Global credits:</span>
                <span className="text-base italic font-semibold text-transparent bg-clip-text bg-gradient-to-br from-yellow-300 via-amber-400 to-orange-500 drop-shadow">{credits}</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src="/coin.svg" alt="credits" className="ml-1 inline-block h-4 w-4" />
              </div>
            </div>
          ) : null}

          {errorMessage ? (
            <p className="text-red-500 mt-4">{errorMessage}</p>
          ) : null}

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
              <div className={isColdStarting ? "text-sm mt-2 text-blue-600 dark:text-blue-400" : "text-sm mt-2 text-black/60 dark:text-white/60"}>
                {isColdStarting ? (
                  <>Cold starting{".".repeat(dotCount)}</>
                ) : (
                  <>Generating…</>
                )}
              </div>
            </div>
          ) : null}

          <div className="mt-8">
            <h3 className="text-sm font-semibold mb-2">Optional: Sign in for more features</h3>
            {isAuthed ? (
              <p className="text-sm text-black/60 dark:text-white/60">You are signed in.</p>
            ) : (
              <button
                onClick={() => signIn("google", { callbackUrl })}
                className="rounded-md bg-black text-white px-4 py-2 dark:bg-white dark:text-black"
              >
                Continue with Google
              </button>
            )}
          </div>
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


