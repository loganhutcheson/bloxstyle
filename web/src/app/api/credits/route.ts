import { prisma } from "@/lib/prisma";

export async function GET() {
  const globalKey = "global";
  const row = await prisma.credit.upsert({
    where: { email: globalKey },
    update: {},
    create: { email: globalKey, credits: 10000 },
  });
  return new Response(JSON.stringify({ credits: row.credits }), {
    status: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
  });
}


