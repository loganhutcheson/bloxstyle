import fs from "node:fs/promises";
import { spawn } from "node:child_process";

export const runtime = "nodejs";

type GenerateBody = { prompt?: string };

export async function POST(request: Request) {
	try {
		const body = (await request.json()) as GenerateBody;
		const prompt = (body?.prompt || "").trim();
		if (!prompt) {
			return new Response(JSON.stringify({ message: "Missing prompt" }), {
				status: 400,
				headers: { "Content-Type": "application/json" },
			});
		}

		const apiBase = process.env.GENERATOR_API_URL || "http://localhost:8090";
		const jwt = process.env.GENERATOR_JWT || "super-secret-key";

		const upstream = await fetch(`${apiBase.replace(/\/$/, "")}/generate`, {
			method: "POST",
			headers: {
				"Content-Type": "application/json",
				"Authorization": `Bearer ${jwt}`,
			},
			body: JSON.stringify({ prompt }),
		});

		if (!upstream.ok) {
			let errorMsg = `Upstream error ${upstream.status}`;
			try {
				const maybe = await upstream.json();
				if (maybe?.message) errorMsg = String(maybe.message);
			} catch {}
			return new Response(JSON.stringify({ message: errorMsg }), {
				status: 502,
				headers: { "Content-Type": "application/json" },
			});
		}

		const arrayBuffer = await upstream.arrayBuffer();
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


