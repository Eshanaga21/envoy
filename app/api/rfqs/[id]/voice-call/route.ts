import { NextResponse } from "next/server";
import { z } from "zod";
import { getRFQ, recordMerchantCall } from "@/lib/db";
import { TwilioVoiceMerchantAdapter, voiceConfiguration } from "@/lib/voice-merchant-adapter";
import type { RFQ } from "@/lib/types";

const schema = z.object({ merchantId: z.enum(["electrohub", "coolmart", "city", "value", "hometech"]), objective: z.string().min(10).max(500).optional() });

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "A supported merchant is required." }, { status: 400 });
  if (!voiceConfiguration().configured) return NextResponse.json({ error: "Voice calling requires Twilio, a public media-stream relay, and a server-side OpenAI key.", code: "VOICE_NOT_CONFIGURED" }, { status: 503 });
  const { id } = await params;
  const state = await getRFQ(id);
  if (!state) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
  try {
    const adapter = new TwilioVoiceMerchantAdapter();
    const call = await adapter.requestQuote({ merchantId: parsed.data.merchantId, rfq: { id: state.rfq.id, buyerRequirement: state.rfq.buyerRequirement, originalPrompt: state.rfq.originalPrompt, summaryTitle: state.rfq.summaryTitle, status: state.rfq.status as RFQ["status"], createdAt: state.rfq.createdAt, budgetCap: state.rfq.budgetCap }, objective: parsed.data.objective ?? "Gather a complete, comparable quotation and verbally reconfirm critical commercial terms." });
    await recordMerchantCall(id, call);
    return NextResponse.json({ call });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "VOICE_CALL_FAILED" }, { status: 502 });
  }
}
