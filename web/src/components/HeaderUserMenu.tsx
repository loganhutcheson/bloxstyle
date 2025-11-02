"use client";

import { useState } from "react";
import { useSession, signIn, signOut } from "next-auth/react";
import Link from "next/link";

export default function HeaderUserMenu() {
  const { data } = useSession();
  const user = data?.user;
  const [open, setOpen] = useState(false);

  return (
    <div className="relative">
      {user ? (
        <button
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-2 rounded-md border border-black/10 dark:border-white/10 px-3 py-1 hover:bg-black/5 dark:hover:bg-white/10"
        
        >
          {user.image ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={user.image} alt={user.name || user.email || "user"} className="h-6 w-6 rounded-full object-cover" />
          ) : (
            <div className="h-6 w-6 rounded-full bg-black/20 dark:bg-white/20 flex items-center justify-center text-xs">
              {(user.name || user.email || "?")?.slice(0, 1).toUpperCase()}
            </div>
          )}
          <span className="text-sm max-w-[140px] truncate">{user.name || user.email}</span>
        </button>
      ) : (
        <button
          onClick={() => signIn("google")}
          className="rounded-md bg-black text-white px-3 py-1 text-sm dark:bg-white dark:text-black"
        >
          Sign in
        </button>
      )}

      {open ? (
        <div className="absolute right-0 mt-2 w-40 rounded-md border border-black/10 dark:border-white/10 bg-white dark:bg-black shadow-md overflow-hidden">
          <Link
            href="/"
            className="block px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => setOpen(false)}
          >
            Home
          </Link>
          <Link
            href="/buy"
            className="block px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => setOpen(false)}
          >
            Buy credits
          </Link>
          <Link
            href="/settings"
            className="block px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
            onClick={() => setOpen(false)}
          >
            Settings
          </Link>
          <button
            onClick={() => {
              setOpen(false);
              signOut({ callbackUrl: "/signin" });
            }}
            className="block w-full text-left px-3 py-2 text-sm hover:bg-black/5 dark:hover:bg-white/10"
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}


