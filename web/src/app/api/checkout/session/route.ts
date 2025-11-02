import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
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
  const stripeSecret = process.env.STRIPE_SECRET_KEY || "";
  if (!stripeSecret) {
    return new Response(JSON.stringify({ message: "Stripe is not configured" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const stripe = new Stripe(stripeSecret);

  const origin = request.headers.get("origin") || process.env.APP_URL || "http://localhost:3000";
  const email = session.user.email.toLowerCase();

  try {
    const checkout = await stripe.checkout.sessions.create({
      mode: "payment",
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "usd",
            unit_amount: 500, // $5.00
            product_data: {
              name: "5,000 Credits",
              description: "Roblox AI credits",
            },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/buy/success?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${origin}/buy/cancel`,
      customer_email: email,
      metadata: {
        email,
        credit_amount: "5000",
      },
    });

    return new Response(JSON.stringify({ url: checkout.url }), {
      status: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Failed to create checkout session";
    return new Response(JSON.stringify({ message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}


