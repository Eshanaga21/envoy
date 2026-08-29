import { randomUUID, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { appendAudit, getRFQ } from "@/lib/db";
import { sendOutreach } from "@/lib/outreach";

const schema = z.object({ channel: z.enum(["whatsapp", "email"]), recipient: z.string().min(3).max(180) });

function authorized(request: Request) {
  const token = process.env.OUTREACH_API_TOKEN;
  const supplied = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
  if (!token || supplied.length !== token.length) return false;
  return timingSafeEqual(Buffer.from(supplied), Buffer.from(token));
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  if (!authorized(request)) return NextResponse.json({ error: "A configured outbound-service token is required." }, { status: 401 });
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "A supported channel and recipient are required." }, { status: 400 });
  const { id } = await params;
  const state = await getRFQ(id);
  if (!state) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
  try {
    const delivery = await sendOutreach({ ...parsed.data, requirement: state.rfq.buyerRequirement, idempotencyKey: `${id}-${parsed.data.channel}-${Date.now()}` });
    await appendAudit(id, { id: randomUUID(), actor: "BUYER_AGENT", action: `RFQ sent by ${parsed.data.channel}`, reason: `Explicitly sent to ${parsed.data.recipient}; provider message ${delivery.id} recorded.`, time: "Now", tone: "success" });
    return NextResponse.json({ delivered: true, ...delivery });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "OUTREACH_SEND_FAILED" }, { status: 502 });
  }
}
