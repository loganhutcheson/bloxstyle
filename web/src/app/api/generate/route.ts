// Removed unused imports
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type GenerateBody = { prompt?: string };

export async function POST(request: Request) {
	try {
    const session = await getServerSession(authOptions);
    if (!session?.user) {
      return new Response(JSON.stringify({ message: "Unauthorized" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }
    const email = (session.user.email || "").toLowerCase();
    const costPerGeneration = 100;

		const body = (await request.json()) as GenerateBody & { warm?: boolean };
		const isWarmOnly = body?.warm === true;
		const prompt = (body?.prompt || "").trim();

		if (!isWarmOnly) {
			if (!prompt) {
				return new Response(JSON.stringify({ message: "Missing prompt" }), {
					status: 400,
					headers: { "Content-Type": "application/json" },
				});
			}

    // Ensure user has credits
    if (!email) {
      return new Response(JSON.stringify({ message: "Missing user email" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }
    const creditRow = await prisma.credit.upsert({
      where: { email },
      update: {},
      create: { email, credits: 1000 },
    });
    if (creditRow.credits < costPerGeneration) {
      return new Response(JSON.stringify({ message: "Insufficient credits" }), {
        status: 402,
        headers: { "Content-Type": "application/json" },
      });
    }
    }

		const apiBase = process.env.GENERATOR_API_URL || "http://localhost:8090";
		const jwt = process.env.GENERATOR_JWT || "super-secret-key";

		// Call upstream exactly as provided (Modal endpoint is at root '/')
		const upstream = await fetch(apiBase, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${jwt}`,
			},
			body: JSON.stringify(isWarmOnly ? { warm: true } : { prompt }),
		});

		if (!upstream.ok) {
			let errorMsg = `Upstream error ${upstream.status}`;
			try {
				const ct = upstream.headers.get("content-type") || "";
				if (ct.includes("application/json")) {
					const maybe = await upstream.json();
					if (maybe?.message) errorMsg = String(maybe.message);
				} else {
					const text = await upstream.text();
					if (text) errorMsg = text;
				}
			} catch {}
			return new Response(JSON.stringify({ message: errorMsg }), {
				status: 502,
				headers: { "Content-Type": "application/json" },
			});
		}


		if (isWarmOnly) {
			// Pass through upstream JSON or OK
			let payload: unknown = { ok: true };
			try {
				payload = await upstream.json();
			} catch {}
			return new Response(JSON.stringify(payload), {
				status: upstream.status,
				headers: { "Content-Type": "application/json" },
			});
		}

		const arrayBuffer = await upstream.arrayBuffer();

    // Decrement a credit only on successful upstream response
    try {
      await prisma.credit.update({
        where: { email },
        data: { credits: { decrement: costPerGeneration } },
      });
    } catch {}
		return new Response(arrayBuffer, {
			status: 200,
			headers: {
				"Content-Type": upstream.headers.get("content-type") || "image/png",
				"Cache-Control": "no-store",
			},
		});
	} catch (error) {
		const message = error instanceof Error ? error.message : "Generation failed";
		return new Response(JSON.stringify({ message }), {
			status: 500,
			headers: { "Content-Type": "application/json" },
		});
	}
}


