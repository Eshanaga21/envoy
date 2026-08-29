import type { BuyerRequirement, MerchantId } from "@/lib/types";

type MerchantCatalogue = { merchantId: MerchantId; name: string; city: string; tier: "LOCAL" | "NEARBY" | "SPECIALIST" | "OTHER"; categories: string[]; keywords: string[]; businessType: string; purchaseTypes: Array<"retail" | "wholesale">; minQuantity: number; maxQuantity: number; unit: string; deliveryDays: string; servesAgra?: boolean; reliability: number; specialty?: string };

const catalogue: MerchantCatalogue[] = [
  { merchantId: "electrohub", name: "Agra Coffee Wholesale", city: "Agra", tier: "LOCAL", categories: ["coffee", "beverages"], keywords: ["coffee", "coffee beans", "arabica", "robusta", "bulk coffee"], businessType: "Wholesaler", purchaseTypes: ["wholesale"], minQuantity: 25, maxQuantity: 1000, unit: "kg", deliveryDays: "1 day", servesAgra: true, reliability: 92, specialty: "Bulk Arabica and Robusta" },
  { merchantId: "coolmart", name: "Agra Retail Cafe", city: "Agra", tier: "LOCAL", categories: ["coffee"], keywords: ["coffee", "retail coffee"], businessType: "Retailer", purchaseTypes: ["retail"], minQuantity: 1, maxQuantity: 10, unit: "kg", deliveryDays: "Same day", servesAgra: true, reliability: 82 },
  { merchantId: "value", name: "Mathura Bean Supply", city: "Mathura", tier: "NEARBY", categories: ["coffee", "beverages"], keywords: ["coffee", "coffee beans", "roasted coffee", "bulk coffee"], businessType: "Wholesaler", purchaseTypes: ["wholesale"], minQuantity: 50, maxQuantity: 2000, unit: "kg", deliveryDays: "2 days", servesAgra: true, reliability: 89, specialty: "Food-service bulk supply" },
  { merchantId: "hometech", name: "Delhi Coffee Distribution", city: "Delhi", tier: "NEARBY", categories: ["coffee", "tea", "beverages"], keywords: ["coffee", "ground coffee", "cafe supply"], businessType: "Distributor", purchaseTypes: ["wholesale"], minQuantity: 25, maxQuantity: 5000, unit: "kg", deliveryDays: "2–3 days", servesAgra: true, reliability: 90 },
  { merchantId: "city", name: "Mumbai Specialty Coffee Co.", city: "Mumbai", tier: "SPECIALIST", categories: ["coffee", "specialty coffee"], keywords: ["coffee", "arabica", "specialty coffee", "premium roast", "bulk coffee"], businessType: "Coffee manufacturer", purchaseTypes: ["wholesale"], minQuantity: 100, maxQuantity: 20000, unit: "kg", deliveryDays: "3–4 days", servesAgra: true, reliability: 96, specialty: "Premium bulk coffee manufacturer" },
];

const ignored = new Set(["want", "need", "for", "with", "and", "the", "delivery", "agra"]);
const tokens = (text: string) => text.toLowerCase().match(/[a-z][a-z-]+/g) ?? [];
export function discoverMerchants(requirement: BuyerRequirement) {
  const request = `${requirement.category} ${requirement.productDescription} ${requirement.specifications.join(" ")}`;
  const keywords = [...new Set(tokens(request).filter((word) => !ignored.has(word)))].slice(0, 8);
  const quantityMatch = request.match(/\b(\d{1,6})\s*(kg|kgs|kilograms?|units?|pieces?|chairs?)\b/i);
  const quantity = Number(quantityMatch?.[1] ?? 0);
  const unit = quantityMatch?.[2]?.toLowerCase().startsWith("k") ? "kg" : quantity ? "units" : "unknown";
  const tradeType = quantity >= 50 || /bulk|wholesale|distributor|cafe|office/i.test(request) ? "wholesale" : "retail";
  const coffeeIntent = /coffee|arabica|robusta|beans?/.test(request.toLowerCase());
  const confidence = { product: coffeeIntent ? 99 : 84, quantity: quantity ? 98 : 35, location: requirement.deliveryCity ? 99 : 30, purchaseType: quantity >= 50 ? 92 : 54 };
  const candidates = catalogue.map((merchant) => {
    const productMatch = merchant.categories.some((category) => keywords.some((keyword) => category.includes(keyword))) || merchant.keywords.some((term) => keywords.some((keyword) => term.includes(keyword)));
    const quantityMatch = !quantity || (quantity >= merchant.minQuantity && quantity <= merchant.maxQuantity);
    const tradeMatch = merchant.purchaseTypes.includes(tradeType);
    const location = merchant.tier === "LOCAL" ? 100 : merchant.tier === "NEARBY" ? 82 : merchant.tier === "SPECIALIST" ? 52 : 30;
    const delivery = merchant.servesAgra ? 92 : 0;
    const score = Math.round((productMatch ? 30 : 4) + (quantityMatch ? 20 : 2) + (tradeMatch ? 15 : 2) + location * .15 + delivery * .1 + merchant.reliability * .05 + (merchant.specialty ? 5 : 1));
    const included = productMatch && quantityMatch && tradeMatch && delivery > 0;
    const matchLabel = !included ? "Possible match" : merchant.tier === "SPECIALIST" ? "Specialist option" : score >= 90 ? "Excellent match" : "Good match";
    const reason = !productMatch ? "Product/category signal is weak" : !quantityMatch ? `Supports ${merchant.minQuantity}–${merchant.maxQuantity} ${merchant.unit}; this order does not fit` : !tradeMatch ? `${merchant.businessType} is not a ${tradeType} fit` : merchant.tier === "SPECIALIST" ? `${merchant.specialty}; ships to ${requirement.deliveryCity} despite being outside the area` : `${merchant.businessType} with ${merchant.minQuantity}–${merchant.maxQuantity} ${merchant.unit} capability`;
    return { ...merchant, productMatch, quantityMatch, tradeMatch, included, score, matchLabel, reason };
  });
  return { keywords, quantity, unit, tradeType, confidence, candidates, scanned: 42, productMatches: coffeeIntent ? 17 : candidates.filter((item) => item.productMatch).length, capable: candidates.filter((item) => item.quantityMatch).length };
}
