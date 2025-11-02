import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import Stripe from "stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) {
    return new Response(JSON.stringify({ message: "Unauthorized" }), {
      status: 401,
      headers: { "Content-Type": "application/json" },
    });
  }
  const email = session.user.email.toLowerCase();

  const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
  if (!stripeSecret) {
    return new Response(JSON.stringify({ message: "Stripe not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const body = (await request.json().catch(() => ({}))) as { session_id?: string };
  const sessionId = (body?.session_id || "").trim();
  if (!sessionId) {
    return new Response(JSON.stringify({ message: "Missing session_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  try {
    const stripe = new Stripe(stripeSecret);
    const checkout = await stripe.checkout.sessions.retrieve(sessionId);
    const paid = checkout.payment_status === "paid" || checkout.status === "complete";
    const checkoutEmail = (checkout.customer_email || checkout.metadata?.email || "").toLowerCase();
    const creditAmount = parseInt(checkout.metadata?.credit_amount || "5000", 10) || 5000;

    if (!paid) {
      return new Response(JSON.stringify({ message: "Checkout not paid yet" }), {
        status: 202,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Only credit the signed-in user; require emails to match if available
    if (checkoutEmail && checkoutEmail !== email) {
      return new Response(JSON.stringify({ message: "Email mismatch" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    await prisma.credit.upsert({
      where: { email },
      update: { credits: { increment: creditAmount } },
      create: { email, credits: creditAmount },
    });

    return new Response(JSON.stringify({ ok: true, credited: creditAmount }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to confirm checkout";
    return new Response(JSON.stringify({ message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}


