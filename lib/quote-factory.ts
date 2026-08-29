import type { BuyerRequirement, MerchantId, Quote } from "@/lib/types";

const merchantIds: MerchantId[] = ["electrohub", "city", "value", "coolmart", "hometech"];

const toNearestHundred = (amount: number) => Math.max(100, Math.round(amount / 100) * 100);

export function merchantName(id: MerchantId) {
  return {
    electrohub: "TradeHub",
    city: "MetroSupply",
    value: "ValueSource",
    coolmart: "DealDirect",
    hometech: "QuickFulfil",
  }[id];
}

export function productLabel(product?: Quote["product"]) {
  if (!product) return "Product details pending";
  return [product.brand, product.model, product.title].filter(Boolean).join(" · ");
}

function requestedQuantity(requirement: BuyerRequirement) {
  const match = `${requirement.productDescription} ${requirement.specifications.join(" ")}`.match(/\b(\d{1,5})\s*(?:x\s*)?(?:chairs?|units?|pieces?)\b/i);
  return match ? Number(match[1]) : undefined;
}

function isOfficeChairRequest(requirement: BuyerRequirement) {
  return /\b(office\s+)?chairs?|ergonomic|task chair\b/i.test(
    `${requirement.category} ${requirement.productDescription}`,
  );
}

function quoteProduct(requirement: BuyerRequirement, merchantId: MerchantId): NonNullable<Quote["product"]> {
  if (isOfficeChairRequest(requirement)) {
    const chair = {
      electrohub: { title: "office chairs · ErgoMesh Pro", model: "EMP-740", material: "Breathable mesh, moulded foam, aluminium base", colors: ["Black", "Graphite"], stock: 650 },
      city: { title: "office chairs · WorkFlex Ergo", model: "WFE-820", material: "Mesh back, high-density foam, chrome base", colors: ["Black", "Grey"], stock: 820 },
      value: { title: "office chairs · MeshLite", model: "ML-510", material: "Mesh back, fabric seat, nylon base", colors: ["Black"], stock: 540 },
      coolmart: { title: "office chairs · TaskSeat Plus", model: "TSP-680", material: "Mesh back, foam seat, nylon base", colors: ["Black", "Blue"], stock: 500 },
      hometech: { title: "Ergonomic office chair", model: "EOC-400", material: "To be confirmed", colors: ["To be confirmed"], stock: 0 },
    }[merchantId];
    return {
      category: "office chairs",
      title: chair.title,
      model: chair.model,
      imageUrl: "/products/ergonomic-office-chair.png",
      specifications: [
        "Adjustable seat height and tilt tension",
        "Adjustable lumbar support",
        "5-star caster base",
        ...requirement.specifications.slice(0, 3),
      ],
      material: chair.material,
      dimensions: "Approx. 62W × 62D × 112–122H cm",
      colorOptions: chair.colors,
      availableQuantity: chair.stock,
      minimumOrderQuantity: 10,
    };
  }
  const preferredBrand = requirement.preferredBrands[merchantId === "city" ? 0 : merchantId === "electrohub" ? 1 : 0];
  const capacity = requirement.capacityMin
    ? merchantId === "value" && requirement.capacityMin > 1 ? requirement.capacityMin - 1 : requirement.capacityMin
    : undefined;
  return {
    category: requirement.category,
    title: requirement.productDescription || requirement.category,
    brand: preferredBrand,
    model: `${requirement.category.slice(0, 18).replace(/[^a-z0-9]+/gi, "-").replace(/(^-|-$)/g, "").toUpperCase() || "RFQ"}-${merchantId.toUpperCase()}`,
    capacityLitres: capacity,
    specifications: requirement.specifications.slice(0, 5),
  };
}

/**
 * Predictable, clearly synthetic offers for the product the buyer actually
 * requested. A live merchant connector can replace this factory without
 * changing requirement extraction, scoring, payment gates, or the UI.
 */
export function createQuoteTemplates(requirement: BuyerRequirement): Quote[] {
  const budget = Math.max(requirement.maxBudget, 1000);
  const exchangeEnabled = requirement.exchange?.enabled ?? false;
  const exchange = (rate: number) => exchangeEnabled ? toNearestHundred(budget * rate) : 0;
  const deliveryTarget = requirement.deliveryBy ? `By ${requirement.deliveryBy}` : "3–5 business days";
  const genericWarranty = "Standard manufacturer or seller warranty";

  const templates: Record<MerchantId, Quote> = {
    electrohub: {
      id: "q-electrohub", merchantId: "electrohub", product: quoteProduct(requirement, "electrohub"),
      basePrice: toNearestHundred(budget * 0.97), gstIncluded: true, exchangeValue: exchange(0.025), effectivePrice: 0,
      deliveryDate: deliveryTarget, deliveryCharge: 0, installationIncluded: true, warranty: genericWarranty,
      paymentConditions: "Pay after buyer confirmation", validUntil: "Today, 8:00 PM", confidence: 98, missingFields: [], status: "VALID", version: 1, source: "SIMULATED",
    },
    coolmart: {
      id: "q-coolmart", merchantId: "coolmart", product: quoteProduct(requirement, "coolmart"),
      basePrice: toNearestHundred(budget * 0.95), gstIncluded: true, exchangeValue: exchange(0.01), effectivePrice: 0,
      deliveryDate: requirement.deliveryBy ? `After ${requirement.deliveryBy}` : "7–10 business days", deliveryCharge: 0, installationIncluded: false, warranty: genericWarranty,
      paymentConditions: "Pay on confirmation", validUntil: "Today, 9:00 PM", confidence: 94, missingFields: [], status: "DISQUALIFIED", version: 1, source: "SIMULATED",
    },
    city: {
      id: "q-city", merchantId: "city", product: quoteProduct(requirement, "city"),
      basePrice: toNearestHundred(budget * 0.94), gstIncluded: true, exchangeValue: exchange(0.045), effectivePrice: 0,
      deliveryDate: deliveryTarget, deliveryCharge: 0, installationIncluded: true, warranty: `${genericWarranty} · priority support`,
      paymentConditions: "Pay after buyer confirmation · offer held 30 min", validUntil: "30 minutes after confirmation", confidence: 100, missingFields: [], status: "VALID", version: 2, previousEffectivePrice: toNearestHundred(budget * 0.97) - exchange(0.015), source: "SIMULATED",
    },
    value: {
      id: "q-value", merchantId: "value", product: quoteProduct(requirement, "value"),
      basePrice: toNearestHundred(budget * 0.92), gstIncluded: true, exchangeValue: exchange(0.01), effectivePrice: 0,
      deliveryDate: deliveryTarget, deliveryCharge: 0, installationIncluded: false, warranty: genericWarranty,
      paymentConditions: "Pay on confirmation", validUntil: "Today, 6:30 PM", confidence: 95, missingFields: [], status: "DISQUALIFIED", version: 2, source: "SIMULATED",
    },
    hometech: {
      id: "q-hometech", merchantId: "hometech", basePrice: 0, exchangeValue: 0, effectivePrice: 0,
      confidence: 0, missingFields: ["No merchant response after one retry"], status: "UNAVAILABLE", version: 0, source: "SIMULATED",
    },
  };

  const quantity = requestedQuantity(requirement);
  return merchantIds.map((merchantId) => {
    const quote = templates[merchantId];
    const effectivePrice = Math.max(0, quote.basePrice - quote.exchangeValue + (quote.deliveryCharge ?? 0));
    return {
      ...quote,
      effectivePrice,
      quotedQuantity: quantity,
      unitPrice: quantity && quote.basePrice ? Math.round(quote.basePrice / quantity) : undefined,
    };
  });
}

export function genericProgressStep(step: number, requirement: BuyerRequirement) {
  const product = requirement.productDescription || requirement.category;
  const city = requirement.deliveryCity || "the requested destination";
  const name = (id: MerchantId) => merchantName(id);
  const steps = [
    ["RFQ sent to 5 matching merchants", `Requesting comparable offers for ${product} delivered to ${city}.`, "send"],
    [`${name("electrohub")} replied to the RFQ`, "Commercial fields received and normalized.", "reply"],
    [`${name("city")} replied to the RFQ`, "An eligible offer was received for comparison.", "reply"],
    [`${name("value")} sent an incomplete quote`, "The agent will request the missing commercial terms.", "think"],
    ["Agent requested missing commercial details", "Product match, tax, delivery, warranty, and final payable amount are required.", "think"],
    ["Agent disqualified non-qualifying offers", "Offers that miss a confirmed constraint are excluded from the recommendation.", "warn"],
    [`${name("hometech")} retry failed gracefully`, "No response after the one allowed retry — continuing.", "warn"],
    [`Agent negotiated with ${name("city")}`, "The agent requested an improved final term without exposing competing quotes.", "think"],
    [`${name("city")} improved its final offer`, "The policy-approved final offer was recorded.", "success"],
    ["Best executable offer found", "Comparable eligible offers have been scored; recommendation is ready.", "success"],
  ] as const;
  const selected = steps[step - 1] ?? steps[steps.length - 1];
  return { id: `generic-step-${step}`, title: selected[0], detail: selected[1], kind: selected[2], delay: 650 };
}
