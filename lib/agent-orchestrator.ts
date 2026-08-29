import { z } from "zod";
import { canCreatePayment } from "@/lib/commerce";
import type { RFQ } from "@/lib/types";

export const agentToolDefinitions = [
  "create_rfq", "list_eligible_merchants", "send_rfq", "message_merchant", "record_quote",
  "request_missing_quote_fields", "negotiate_quote", "compare_quotes", "confirm_final_offer",
] as const;

export const stateTransitions: Partial<Record<RFQ["status"], RFQ["status"][]>> = {
  DRAFT_REQUIREMENT: ["REQUIREMENT_CONFIRMED"],
  REQUIREMENT_CONFIRMED: ["RFQ_SENT"],
  RFQ_SENT: ["COLLECTING_QUOTES"],
  COLLECTING_QUOTES: ["CLARIFYING_QUOTES", "NEGOTIATING", "READY_TO_RECOMMEND"],
  CLARIFYING_QUOTES: ["NEGOTIATING", "READY_TO_RECOMMEND"],
  NEGOTIATING: ["READY_TO_RECOMMEND"],
  READY_TO_RECOMMEND: ["BUYER_SELECTED"],
  BUYER_SELECTED: ["FINAL_TERMS_CONFIRMED"],
  FINAL_TERMS_CONFIRMED: ["AWAITING_PAYMENT_APPROVAL"],
  AWAITING_PAYMENT_APPROVAL: ["PAYMENT_PROCESSING"],
  PAYMENT_PROCESSING: ["PURCHASED"],
};

export function transition(rfq: RFQ, next: RFQ["status"]) {
  if (!stateTransitions[rfq.status]?.includes(next)) throw new Error(`Illegal state transition: ${rfq.status} → ${next}`);
  return { ...rfq, status: next };
}

export const paymentApprovalSchema = z.object({
  buyerSelected: z.literal(true),
  finalTermsConfirmed: z.literal(true),
  buyerApproved: z.literal(true),
  amount: z.number().int().positive(),
  budgetCap: z.number().int().positive(),
});

export function assertPaymentCanStart(input: unknown) {
  const parsed = paymentApprovalSchema.parse(input);
  if (!canCreatePayment(parsed)) throw new Error("PAYMENT_GUARDRAIL_BLOCKED");
  return parsed;
}
