"use client";
import { signIn, useSession } from "next-auth/react";
import { Suspense, useEffect, useState } from "react";
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

  return (
    <div className="min-h-screen w-full flex flex-col p-6 gap-6">
      <div className="flex-1 w-full flex items-center justify-center">
        <div className="w-full max-w-sm text-center">
          <h1 className="text-2xl font-semibold mb-6">Sign in</h1>
          {isAuthed ? (
            <p className="text-sm text-black/60 dark:text-white/60">
              You are already signed in.
            </p>
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

      <div>
        {bannerUrls.length > 0 ? (
          <ScrollingBanner imageUrls={bannerUrls} direction="right" heightPx={140} />
        ) : null}
      </div>
    </div>
  );
}


