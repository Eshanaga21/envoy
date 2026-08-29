import { NextResponse } from "next/server";
import Razorpay from "razorpay";
import { z } from "zod";
import { canCreatePayment } from "@/lib/commerce";
import { getRFQ, recordPaymentOrder } from "@/lib/db";
import { productLabel } from "@/lib/quote-factory";

const schema = z.object({
  rfqId: z.string().min(3),
  buyerApproved: z.literal(true),
});

export async function POST(request: Request) {
  const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "A buyer-approved final offer is required." }, { status: 400 });
  const state = await getRFQ(parsed.data.rfqId);
  if (!state) return NextResponse.json({ error: "RFQ not found." }, { status: 404 });
  const quote = state.quotes.find((item) => item.id === state.rfq.selectedQuoteId);
  const paymentAllowed = Boolean(quote) && canCreatePayment({ buyerSelected: Boolean(state.rfq.selectedQuoteId), finalTermsConfirmed: state.rfq.status === "AWAITING_PAYMENT_APPROVAL", buyerApproved: parsed.data.buyerApproved, amount: quote?.effectivePrice ?? 0, budgetCap: state.rfq.budgetCap, merchantConfirmed: quote?.merchantConfirmed });
  if (!paymentAllowed || !quote) return NextResponse.json({ error: "Payment guardrail blocked this request." }, { status: 403 });
  if (!process.env.RAZORPAY_KEY_ID || !process.env.RAZORPAY_KEY_SECRET) {
    return NextResponse.json({ error: "Razorpay Test Mode keys are not configured.", code: "RAZORPAY_NOT_CONFIGURED" }, { status: 503 });
  }
  try {
    const razorpay = new Razorpay({ key_id: process.env.RAZORPAY_KEY_ID, key_secret: process.env.RAZORPAY_KEY_SECRET });
    const order = await razorpay.orders.create({
      amount: quote.effectivePrice * 100,
      currency: "INR",
      receipt: parsed.data.rfqId,
      notes: { quoteId: quote.id, merchantId: quote.merchantId, product: productLabel(quote.product) },
    });
    await recordPaymentOrder(parsed.data.rfqId, order.id, quote.effectivePrice);
    return NextResponse.json({ order, keyId: process.env.RAZORPAY_KEY_ID });
  } catch {
    return NextResponse.json({ error: "Could not create the Razorpay Test Mode order. Your offer remains reserved." }, { status: 502 });
  }
}
