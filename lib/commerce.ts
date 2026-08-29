import type { BuyerRequirement, Quote } from "@/lib/types";

/** Demo-only until connected to an authorised Razorpay merchant-history signal. */
export const merchantTrust = {
  electrohub: { score: 91, transactions: 2840, label: "Excellent fulfilment history" },
  coolmart: { score: 84, transactions: 1910, label: "Reliable transaction history" },
  city: { score: 96, transactions: 6380, label: "Exceptional fulfilment history" },
  value: { score: 78, transactions: 960, label: "Limited history" },
  hometech: { score: 72, transactions: 420, label: "Limited history" },
} as const;

export function rankingBreakdown(quote: Quote, requirement: BuyerRequirement) {
  if (!qualifies(quote, requirement) || !quote.product) return null;
  const weightFor = (terms: string[], fallback: number) => requirement.preferences.find((preference) => terms.some((term) => preference.criterion.toLowerCase().includes(term)))?.priority ?? fallback;
  const priceWeight = weightFor(["price", "cost", "payable", "budget"], 50);
  const deliveryWeight = weightFor(["delivery", "fulfil", "shipping"], 20);
  const warrantyWeight = weightFor(["warranty", "support", "service"], 10);
  const brandWeight = weightFor(["brand", "make"], 20);
  const price = Math.max(0, Math.min(priceWeight, ((requirement.maxBudget - quote.effectivePrice) / Math.max(1, requirement.maxBudget * 0.15)) * priceWeight));
  const delivery = quote.deliveryDate?.toLowerCase().startsWith("by") ? deliveryWeight : deliveryWeight * 0.55;
  const warranty = quote.warranty ? warrantyWeight : 0;
  const brand = quote.product.brand && requirement.preferredBrands.some((item) => item.toLowerCase() === quote.product?.brand?.toLowerCase()) ? brandWeight : 0;
  const trust = merchantTrust[quote.merchantId].score * 0.15;
  return { price, delivery, warranty, brand, trust, trustScore: merchantTrust[quote.merchantId].score, total: Number((price + delivery + warranty + brand + trust).toFixed(2)) };
}

export function isQuoteComplete(quote: Quote) {
  return Boolean(
    quote.product && quote.deliveryDate && quote.warranty && quote.gstIncluded !== undefined && quote.missingFields.length === 0,
  );
}

export function effectivePrice(basePrice: number, exchangeValue: number, deliveryCharge = 0) {
  return Math.max(0, basePrice - exchangeValue + deliveryCharge);
}

export function qualifies(quote: Quote, requirement: BuyerRequirement) {
  if (!isQuoteComplete(quote) || !quote.product) return false;
  if (quote.effectivePrice > requirement.maxBudget) return false;
  const countedItemRequest = /\b(chairs?|units?|pieces?)\b/i.test(
    `${requirement.category} ${requirement.productDescription} ${requirement.specifications.join(" ")}`,
  );
  // `capacityMin`/`capacityMax` are product capacities for items such as
  // refrigerators. Quantity-based requests (for example 4,000 chairs) must
  // not be compared against a product's litre capacity.
  if (!countedItemRequest && requirement.capacityMin && (!quote.product.capacityLitres || quote.product.capacityLitres < requirement.capacityMin)) return false;
  if (!countedItemRequest && requirement.capacityMax && (!quote.product.capacityLitres || quote.product.capacityLitres > requirement.capacityMax)) return false;
  // The seeded demo uses human-readable delivery labels; invalid statuses represent checked delivery rules.
  return quote.status === "VALID";
}

export function scoreQuote(quote: Quote, requirement: BuyerRequirement) {
  return rankingBreakdown(quote, requirement)?.total ?? -Infinity;
}

export function recommendQuote(quotes: Quote[], requirement: BuyerRequirement) {
  return quotes
    .filter((quote) => qualifies(quote, requirement))
    .sort((a, b) => {
      const scoreDelta = scoreQuote(b, requirement) - scoreQuote(a, requirement);
      return scoreDelta || a.effectivePrice - b.effectivePrice;
    })[0];
}

export function canCreatePayment(input: { buyerSelected: boolean; finalTermsConfirmed: boolean; buyerApproved: boolean; amount: number; budgetCap: number; merchantConfirmed?: boolean }) {
  return input.buyerSelected && input.finalTermsConfirmed && input.buyerApproved && input.amount <= input.budgetCap && input.merchantConfirmed !== false;
}

/** A payment callback alone is not a purchase; server-side verification is required. */
export function canCompletePurchase(paymentVerified: boolean) {
  return paymentVerified;
}
