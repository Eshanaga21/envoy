import { NextResponse } from "next/server";
import { z } from "zod";
import { askMerchantForFact, getProductKnowledge } from "@/lib/db";

const merchantSchema = z.enum(["electrohub", "coolmart", "city", "value", "hometech"]);

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const merchantId = new URL(request.url).searchParams.get("merchantId");
  const parsed = merchantId ? merchantSchema.safeParse(merchantId) : null;
  if (merchantId && !parsed?.success) return NextResponse.json({ error: "Unknown merchant." }, { status: 400 });
  return NextResponse.json({ knowledge: await getProductKnowledge(id, parsed?.success ? parsed.data : undefined) });
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = z.object({ merchantId: merchantSchema, question: z.string().min(3).max(500), channel: z.enum(["WHATSAPP", "VOICE"]).default("WHATSAPP") }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "A merchant and concise question are required." }, { status: 400 });
  try {
    const { id } = await params;
    return NextResponse.json(await askMerchantForFact(id, parsed.data.merchantId, parsed.data.question, parsed.data.channel));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not ask merchant" }, { status: 409 });
  }
}
