import Stripe from "stripe";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: Request) {
  const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET || "";
  if (!stripeSecret || !webhookSecret) {
    return new Response("Stripe not configured", { status: 500 });
  }
  const stripe = new Stripe(stripeSecret);

  const signature = request.headers.get("stripe-signature");
  if (!signature) return new Response("Missing signature", { status: 400 });

  const rawBody = await request.text();
  let event: unknown;
  try {
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    return new Response(`Webhook Error: ${(err as Error).message}`, { status: 400 });
  }

  type CheckoutCompleted = {
    type: string;
    data: { object: { customer_email?: string | null; metadata?: Record<string, string> | null } };
  };

  const isCheckoutCompleted = (e: unknown): e is CheckoutCompleted => {
    if (typeof e !== "object" || e === null) return false;
    const anyE = e as Record<string, unknown>;
    if (anyE["type"] !== "checkout.session.completed") return false;
    const data = anyE["data"] as Record<string, unknown> | undefined;
    const obj = data && (data["object"] as Record<string, unknown> | undefined);
    return Boolean(obj);
  };

  if (isCheckoutCompleted(event)) {
    const session = event.data.object;
    const email = (session.customer_email || session.metadata?.email || "").toLowerCase();
    const creditAmount = parseInt(session.metadata?.credit_amount || "5000", 10) || 5000;
    if (email) {
      try {
        await prisma.credit.upsert({
          where: { email },
          update: { credits: { increment: creditAmount } },
          create: { email, credits: creditAmount },
        });
      } catch {}
    }
  }

  return new Response("ok", { status: 200 });
}


