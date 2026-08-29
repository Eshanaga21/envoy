import { describe, expect, it } from "vitest";
import { recommendQuote } from "@/lib/commerce";
import { createQuoteTemplates } from "@/lib/quote-factory";
import type { BuyerRequirement } from "@/lib/types";

const officeChairRequirement: BuyerRequirement = {
  category: "office furniture",
  productDescription: "40 ergonomic mesh office chairs in black",
  specifications: ["Quantity: 40", "Ergonomic mesh", "Black", "3-year warranty"],
  preferredBrands: ["Featherlite", "Godrej"],
  maxBudget: 200000,
  deliveryCity: "Chennai",
  deliveryBy: "Friday",
  hardConstraints: ["40 chairs", "Black", "Chennai delivery", "₹2,00,000 maximum"],
  preferences: [{ criterion: "Lowest effective cost", priority: 50 }, { criterion: "Brand preference", priority: 20 }, { criterion: "Delivery", priority: 20 }, { criterion: "Warranty", priority: 10 }],
};

describe("universal quote factory", () => {
  it("generates category-specific synthetic quotes instead of refrigerator data", () => {
    const quotes = createQuoteTemplates(officeChairRequirement);
    expect(quotes).toHaveLength(5);
    expect(quotes.find((quote) => quote.merchantId === "city")?.product?.title).toContain("office chairs");
    expect(quotes.find((quote) => quote.merchantId === "city")?.deliveryDate).toBe("By Friday");
    expect(quotes.every((quote) => quote.source === "SIMULATED")).toBe(true);
  });

  it("keeps the deterministic recommendation within the buyer's budget", () => {
    const winner = recommendQuote(createQuoteTemplates(officeChairRequirement), officeChairRequirement);
    expect(winner?.merchantId).toBe("city");
    expect(winner?.effectivePrice).toBeLessThanOrEqual(officeChairRequirement.maxBudget);
  });
});
