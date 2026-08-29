import type { BuyerRequirement } from "@/lib/types";

export type ClarificationQuestion = {
  id: "product_scope" | "budget" | "budget_inclusion" | "delivery_city";
  question: string;
  helper: string;
};

const budgetPattern = /(?:₹|rs\.?|inr|under|below|within|budget(?:\s+of)?|upto|up to)\s*\d/i;
const genericProductValues = new Set(["product", "product or service", "item", "something", "goods", "service", "quote", "quotation", "pricing"]);

function needsProductScope(requirement: BuyerRequirement) {
  const category = requirement.category.trim().toLowerCase();
  const description = requirement.productDescription.trim().toLowerCase();
  const descriptiveWords = description.split(/\s+/).filter(Boolean).length;
  const broadDescription = /\b(items?|equipment|products?|things?|solutions?|services?)\b/.test(description) && /\b(suitable|general|various|any)\b/.test(description);
  const unspecifiedChairType = /\bchairs?\b/.test(description) && !/\b(ergonomic|mesh|executive|visitor|task|training|adjustable|conference|plastic|stackable)\b/.test(description);
  const intentWithoutItem = /^(?:i\s+)?(?:need|want|require|am looking for|help me(?:\s+to)?)(?:\s+to)?\s+(?:get|buy|find)?\s*(?:a\s+)?(?:quote|quotation|price|pricing)(?:\s+please)?[.!]?$/.test(description);
  return genericProductValues.has(description) || /\b(something|anything|a product|product or service)\b/.test(description) || broadDescription || unspecifiedChairType || intentWithoutItem || descriptiveWords < 2 || (genericProductValues.has(category) && genericProductValues.has(description)) || (description === category && requirement.specifications.length === 0 && requirement.preferredBrands.length === 0);
}

/**
 * Keeps merchant outreach honest: an RFQ needs a quoteable item, a spend
 * ceiling, and a destination. The list is deliberately capped at three so a
 * buyer is not sent through a long generic form.
 */
export function getClarificationQuestions(requirement: BuyerRequirement, buyerText = ""): ClarificationQuestion[] {
  const questions: ClarificationQuestion[] = [];
  const inferredBudget = /budget to be confirmed/i.test(requirement.hardConstraints.join(" ")) || (!budgetPattern.test(buyerText) && requirement.maxBudget === 100000);
  const inferredCity = !requirement.deliveryCity.trim() || /city to be confirmed|delivery city to be confirmed/i.test(requirement.deliveryCity) || /delivery city to be confirmed/i.test(requirement.hardConstraints.join(" "));
  const explicitScopeAnswer = /product scope:\s*[^\n]{3,}/i.test(buyerText);
  const perUnitBudget = buyerText.match(/(?:₹|rs\.?|inr)\s*([0-9][0-9,]*)\s*(?:per|\/)\s*(?:chair|unit|piece)/i);
  const quantity = buyerText.match(/\b(\d{1,5})\b(?=[^\n]{0,60}\b(?:chairs?|units?|pieces?)\b)/i);
  const budgetTreatmentAnswered = /budget treatment:\s*[^\n]{3,}/i.test(buyerText);

  if (!explicitScopeAnswer && needsProductScope(requirement)) questions.push({
    id: "product_scope",
    question: "What exactly should merchants quote for?",
    helper: "Share the item or service, quantity, and any must-have specification, model, or scope. For chairs, say whether you need ergonomic, visitor, executive, task, or training chairs.",
  });
  if (inferredBudget) questions.push({
    id: "budget",
    question: "What is the maximum total budget in INR?",
    helper: "Include taxes, delivery, and installation if they must fit inside the cap.",
  });
  if (perUnitBudget && quantity && !budgetTreatmentAnswered) questions.push({
    id: "budget_inclusion",
    question: "Should your total budget also include GST and delivery?",
    helper: "This determines whether quoted tax and delivery charges must fit within your stated per-unit limit.",
  });
  if (inferredCity) questions.push({
    id: "delivery_city",
    question: "Which city should the merchant deliver to or serve?",
    helper: "A city is needed to verify delivery availability and timing.",
  });
  return questions.slice(0, 3);
}
