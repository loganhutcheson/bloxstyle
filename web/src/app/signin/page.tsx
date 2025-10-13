"use client";
import { signIn, useSession } from "next-auth/react";
import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";

export default function SignInPage() {
  const { data } = useSession();
  const isAuthed = Boolean(data?.user);
  const router = useRouter();
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") || "/";

  useEffect(() => {
    if (isAuthed) {
      router.replace(callbackUrl);
    }
  }, [isAuthed, callbackUrl, router]);
  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6">
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
  );
}


