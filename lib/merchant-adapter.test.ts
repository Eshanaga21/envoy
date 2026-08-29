import { describe, expect, it } from "vitest";
import { SimulatedMerchantAdapter, sendWithOneRetry } from "@/lib/merchant-adapter";
import { demoRequirement, initialQuotes } from "@/lib/demo-data";
import type { RFQ } from "@/lib/types";

const rfq: RFQ = { id: "rfq-test", buyerRequirement: demoRequirement, originalPrompt: "500–600L refrigerator under ₹70K", summaryTitle: "500–600L refrigerator", status: "RFQ_SENT", createdAt: "2026-08-25", budgetCap: 70000 };

describe("simulated merchant policy", () => {
  it("handles merchant timeout without failing the RFQ", async () => {
    const result = await sendWithOneRetry(new SimulatedMerchantAdapter(), rfq, "hometech");
    expect(result.quote?.status).toBe("UNAVAILABLE");
  });
  it("does not permit City Electronics to confirm an impossible discount", async () => {
    const adapter = new SimulatedMerchantAdapter();
    await expect(adapter.confirmOffer("city", "q-city-final")).resolves.toMatchObject({ payableAmount: 62500 });
    await expect(adapter.confirmOffer("city", initialQuotes[0].id)).rejects.toThrow("QUOTE_NOT_FOUND");
  });
});
