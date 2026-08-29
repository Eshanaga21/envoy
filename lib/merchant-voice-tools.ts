import { z } from "zod";

const fieldSchema = z.enum(["brand", "model", "capacityLitres", "basePrice", "gstIncluded", "exchangeValue", "deliveryDate", "deliveryCharge", "installationIncluded", "warranty", "paymentTerms"]);

export const merchantVoiceToolCallSchema = z.discriminatedUnion("name", [
  z.object({ name: z.literal("get_buyer_requirement"), arguments: z.object({}) }),
  z.object({ name: z.literal("get_known_quote"), arguments: z.object({}) }),
  z.object({ name: z.literal("record_quote_field"), arguments: z.object({ field: fieldSchema, value: z.union([z.string(), z.number(), z.boolean()]), confidence: z.number().min(0).max(100) }) }),
  z.object({ name: z.literal("record_product_fact"), arguments: z.object({ key: z.string().min(1).max(80), value: z.string().min(1).max(300), confidence: z.number().min(0).max(100) }) }),
  z.object({ name: z.literal("record_question_answer"), arguments: z.object({ question: z.string().min(3).max(500), answer: z.string().min(1).max(1000), merchantConfirmed: z.boolean() }) }),
  z.object({ name: z.literal("record_negotiation_result"), arguments: z.object({ basePrice: z.number().positive().optional(), exchangeValue: z.number().nonnegative().optional(), reason: z.string().min(3).max(300) }) }),
  z.object({ name: z.literal("get_missing_information"), arguments: z.object({}) }),
  z.object({ name: z.literal("mark_information_uncertain"), arguments: z.object({ field: fieldSchema, reason: z.string().min(3).max(300) }) }),
  z.object({ name: z.literal("confirm_final_quote"), arguments: z.object({ readback: z.string().min(10).max(1200), merchantAgreed: z.literal(true) }) }),
  z.object({ name: z.literal("finish_call"), arguments: z.object({ outcome: z.enum(["COMPLETED", "DECLINED", "FAILED"]), summary: z.string().min(3).max(500) }) }),
]);

export type MerchantVoiceToolCall = z.infer<typeof merchantVoiceToolCallSchema>;

/** The external Realtime media relay must call this before any database effect. */
export function validateMerchantVoiceToolCall(value: unknown) {
  return merchantVoiceToolCallSchema.safeParse(value);
}

export const merchantVoiceToolDefinitions = [
  "get_buyer_requirement", "get_known_quote", "record_quote_field", "record_product_fact", "record_question_answer", "record_negotiation_result", "get_missing_information", "mark_information_uncertain", "confirm_final_quote", "finish_call",
] as const;
