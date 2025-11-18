"use client";
import { signIn, useSession } from "next-auth/react";
import { Suspense, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";

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

  useEffect(() => {
    if (isAuthed) {
      router.replace(callbackUrl);
    }
  }, [isAuthed, callbackUrl, router]);

  return (
    <div className="min-h-screen w-full flex flex-col p-6 gap-6">
      <div className="w-full max-w-2xl mx-auto flex justify-start">
        <Link href="/" className="text-sm underline underline-offset-2 hover:opacity-80">
          Home
        </Link>
      </div>
      <div className="flex-1 w-full flex items-center justify-center">
        {isAuthed ? (
          <button
            onClick={() => router.replace(callbackUrl)}
            className="rounded-md bg-black text-white px-5 py-2.5 dark:bg-white dark:text-black"
          >
            Go to app
          </button>
        ) : (
          <button
            onClick={() => signIn("google", { callbackUrl })}
            className="rounded-md bg-black text-white px-5 py-2.5 dark:bg-white dark:text-black"
          >
            Continue with Google
          </button>
        )}
      </div>
    </div>
  );
}


