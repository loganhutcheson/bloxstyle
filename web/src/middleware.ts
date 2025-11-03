import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/auth") ||
    pathname.startsWith("/api/stripe") ||
    pathname === "/signin" ||
    pathname.startsWith("/favicon") ||
    pathname.startsWith("/public")
  ) {
    return NextResponse.next();
  }

  // Only protect sensitive pages; generator and home are public now
  const isProtected = pathname.startsWith("/settings");
  if (!isProtected) return NextResponse.next();

  const token = await getToken({ req: request, secret: process.env.AUTH_SECRET });
  if (token) return NextResponse.next();

  const url = new URL("/signin", request.url);
  url.searchParams.set("callbackUrl", request.nextUrl.pathname + request.nextUrl.search);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/auth|public).*)"],
};


