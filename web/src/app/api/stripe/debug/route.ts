export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const key = process.env.STRIPE_SECRET_KEY || "";
  const configured = Boolean(key);
  const keyType = !configured ? "none" : key.startsWith("sk_live_") ? "live" : key.startsWith("sk_test_") ? "test" : "unknown";
  const vercelEnv = process.env.VERCEL_ENV || "unknown"; // production | preview | development
  const nodeEnv = process.env.NODE_ENV || "unknown";
  const appUrl = process.env.APP_URL || null;
  const host = request.headers.get("host") || null;
  return new Response(JSON.stringify({ configured, keyType, vercelEnv, nodeEnv, host, appUrl }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}


