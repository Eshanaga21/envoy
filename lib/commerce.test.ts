import { describe, expect, it } from "vitest";
import { canCompletePurchase, canCreatePayment, effectivePrice, qualifies, recommendQuote } from "@/lib/commerce";
import { demoRequirement, initialQuotes } from "@/lib/demo-data";

describe("commerce guardrails", () => {
  it("calculates effective price", () => expect(effectivePrice(65500, 3000)).toBe(62500));
  it("rejects an over-budget offer", () => expect(qualifies({ ...initialQuotes[2], effectivePrice: 70001 }, demoRequirement)).toBe(false));
  it("does not allow an incomplete or disqualified quote to win", () => {
    expect(qualifies(initialQuotes[3], demoRequirement)).toBe(false);
    expect(recommendQuote(initialQuotes, demoRequirement)?.merchantId).toBe("city");
  });
  it("enforces hard capacity constraints", () => expect(qualifies(initialQuotes[3], demoRequirement)).toBe(false));
  it("does not treat a chair quantity as a litre-capacity constraint", () => {
    const chairRequirement = {
      ...demoRequirement,
      category: "office chairs",
      productDescription: "4,000 ergonomic chairs",
      specifications: ["Quantity: 4,000 chairs"],
      capacityMin: 4000,
      capacityMax: 4000,
    };
    expect(qualifies(initialQuotes[0], chairRequirement)).toBe(true);
  });
  it("makes the final recommendation reproducible", () => {
    expect(recommendQuote(initialQuotes, demoRequirement)?.id).toBe(recommendQuote([...initialQuotes].reverse(), demoRequirement)?.id);
  });
  it("requires explicit buyer approval for payment", () => {
    expect(canCreatePayment({ buyerSelected: true, finalTermsConfirmed: true, buyerApproved: false, amount: 62500, budgetCap: 70000 })).toBe(false);
    expect(canCreatePayment({ buyerSelected: true, finalTermsConfirmed: true, buyerApproved: true, amount: 62500, budgetCap: 70000 })).toBe(true);
  });
  it("does not complete a purchase after payment failure", () => {
    expect(canCompletePurchase(false)).toBe(false);
    expect(canCompletePurchase(true)).toBe(true);
  });
});
