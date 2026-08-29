import { describe, expect, it } from "vitest";
import { getClarificationQuestions } from "@/lib/rfq-clarifications";
import type { BuyerRequirement } from "@/lib/types";

const incomplete: BuyerRequirement = {
  category: "product or service", productDescription: "product or service", specifications: [], preferredBrands: [], maxBudget: 100000,
  deliveryCity: "City to be confirmed", hardConstraints: ["Product: product or service", "Budget to be confirmed", "Delivery city to be confirmed"], preferences: [{ criterion: "Lowest cost", priority: 100 }],
};

describe("RFQ clarification guard", () => {
  it("asks only the essential, relevant buyer questions before outreach", () => {
    expect(getClarificationQuestions(incomplete, "I need something").map((question) => question.id)).toEqual(["product_scope", "budget", "delivery_city"]);
  });

  it("does not interrupt a quoteable request with all essential details", () => {
    const complete: BuyerRequirement = { ...incomplete, category: "laptop", productDescription: "15 business laptops with 16GB RAM", specifications: ["16GB RAM"], maxBudget: 900000, deliveryCity: "Bengaluru", hardConstraints: ["₹9,00,000 or less", "Bengaluru delivery"] };
    expect(getClarificationQuestions(complete, "15 business laptops with 16GB RAM under ₹9 lakh delivered to Bengaluru")).toEqual([]);
  });

  it("does not let a vague model extraction substitute for an actual quoteable scope", () => {
    const vague: BuyerRequirement = { ...incomplete, category: "Office Equipment", productDescription: "Items or equipment suitable for office use", specifications: ["Office use compatibility"], maxBudget: 200000, deliveryCity: "Pune", hardConstraints: ["₹2,00,000 or less", "Pune delivery"] };
    expect(getClarificationQuestions(vague, "I need something for my office").map((question) => question.id)).toContain("product_scope");
  });

  it("asks for scope when the buyer only asks for a quotation", () => {
    const quoteOnly: BuyerRequirement = { ...incomplete, category: "procurement", productDescription: "I need a quotation", maxBudget: 50000, deliveryCity: "Agra", hardConstraints: ["₹50,000 or less", "Agra delivery"] };
    expect(getClarificationQuestions(quoteOnly, "I need a quotation under ₹50,000 in Agra").map((question) => question.id)).toContain("product_scope");
  });
});
