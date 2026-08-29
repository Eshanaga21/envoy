import { describe, expect, it } from "vitest";
import { answerFromQuote } from "@/lib/db";
import { MockTelephonyProvider, realtimeVoiceAgentInstructions, voiceDisclosure } from "@/lib/voice-merchant-adapter";
import { validateMerchantVoiceToolCall } from "@/lib/merchant-voice-tools";
import type { BuyerRequirement, Quote } from "@/lib/types";

const requirement: BuyerRequirement = { category: "office furniture", productDescription: "40 ergonomic chairs", specifications: [], preferredBrands: [], maxBudget: 200000, deliveryCity: "Chennai", hardConstraints: ["chairs"], preferences: [{ criterion: "price", priority: 100 }] };
const quote: Quote = { id: "quote", merchantId: "city", product: { category: "office furniture", title: "40 ergonomic chairs", model: "CHAIR-40" }, basePrice: 180000, exchangeValue: 0, effectivePrice: 180000, deliveryDate: "By Friday", installationIncluded: true, warranty: "3 years", confidence: 100, missingFields: [], status: "VALID", version: 1 };

describe("merchant knowledge and voice safety", () => {
  it("does not invent an answer for an unverified product capability", () => {
    expect(answerFromQuote("Does this chair have lumbar adjustment?", quote)).toBeNull();
    expect(answerFromQuote("When can it be delivered?", quote)).toContain("Friday");
  });

  it("uses a disclosed, mockable voice transport and protects competitor privacy", async () => {
    expect(voiceDisclosure(requirement)).toContain("AI buying assistant");
    expect(realtimeVoiceAgentInstructions).toContain("Never reveal a competitor name or exact competing price");
    await expect(new MockTelephonyProvider().makeCall({ to: "+910000000000", twimlUrl: "https://example.com", statusCallback: "https://example.com" })).resolves.toMatchObject({ status: "MOCK_COMPLETED" });
    expect(validateMerchantVoiceToolCall({ name: "record_quote_field", arguments: { field: "basePrice", value: 65000, confidence: 100 } }).success).toBe(true);
    expect(validateMerchantVoiceToolCall({ name: "drop_database", arguments: {} }).success).toBe(false);
  });
});
