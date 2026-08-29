import { NextResponse } from "next/server";
import { z } from "zod";
import { recordSimulatedMerchantReply } from "@/lib/db";

const schema = z.object({
  merchantId: z.enum(["electrohub", "coolmart", "city", "value", "hometech"]),
  channel: z.enum(["WHATSAPP", "VOICE"]).default("WHATSAPP"),
});

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json(
      { error: "A merchant and channel are required." },
      { status: 400 },
    );
  const { id } = await params;
  try {
    const state = await recordSimulatedMerchantReply(
      id,
      parsed.data.merchantId,
      parsed.data.channel,
    );
    return NextResponse.json(state);
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "SIMULATION_FAILED" },
      { status: 409 },
    );
  }
}
