import { createHmac, timingSafeEqual } from "crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { completePayment } from "@/lib/db";

const schema = z.object({ rfqId: z.string().min(3), razorpay_order_id: z.string(), razorpay_payment_id: z.string(), razorpay_signature: z.string() });

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success || !process.env.RAZORPAY_KEY_SECRET) return NextResponse.json({ verified: false }, { status: 400 });
  const data = `${parsed.data.razorpay_order_id}|${parsed.data.razorpay_payment_id}`;
  const expected = createHmac("sha256", process.env.RAZORPAY_KEY_SECRET).update(data).digest("hex");
  const verified = expected.length === parsed.data.razorpay_signature.length && timingSafeEqual(Buffer.from(expected), Buffer.from(parsed.data.razorpay_signature));
  await completePayment(parsed.data.rfqId, parsed.data.razorpay_order_id, parsed.data.razorpay_payment_id, verified);
  return NextResponse.json({ verified });
}
