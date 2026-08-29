import { NextResponse } from "next/server";
import { z } from "zod";
import { aiProvider } from "@/lib/ai/provider";
import { getClarificationQuestions } from "@/lib/rfq-clarifications";

const inputSchema = z.object({ prompt: z.string().min(8).max(1200) });
const requirementSchema = z.object({ summaryTitle: z.string().min(2).max(80), category: z.string().min(2).max(80), productDescription: z.string().min(2).max(500), specifications: z.array(z.string()).max(12).default([]), capacityMin: z.number().positive().optional(), capacityMax: z.number().positive().optional(), preferredBrands: z.array(z.string()).max(8).default([]), maxBudget: z.number().positive(), deliveryCity: z.string().min(2).max(120), deliveryBy: z.string().max(120).optional(), exchange: z.object({ enabled: z.boolean(), brand: z.string().optional(), capacity: z.number().optional(), ageYears: z.number().optional(), condition: z.string().optional() }).optional(), hardConstraints: z.array(z.string()).min(1).max(12), preferences: z.array(z.object({ criterion: z.string(), priority: z.number().min(0).max(100) })).min(1).max(6) });
const schema = { type: "object", additionalProperties: false, required: ["summaryTitle", "category", "productDescription", "specifications", "preferredBrands", "maxBudget", "deliveryCity", "hardConstraints", "preferences"], properties: { summaryTitle: { type: "string" }, category: { type: "string" }, productDescription: { type: "string" }, specifications: { type: "array", items: { type: "string" } }, capacityMin: { type: "number" }, capacityMax: { type: "number" }, preferredBrands: { type: "array", items: { type: "string" } }, maxBudget: { type: "number" }, deliveryCity: { type: "string" }, deliveryBy: { type: "string" }, exchange: { type: "object", additionalProperties: false, required: ["enabled"], properties: { enabled: { type: "boolean" }, brand: { type: "string" }, capacity: { type: "number" }, ageYears: { type: "number" }, condition: { type: "string" } } }, hardConstraints: { type: "array", items: { type: "string" } }, preferences: { type: "array", items: { type: "object", additionalProperties: false, required: ["criterion", "priority"], properties: { criterion: { type: "string" }, priority: { type: "number" } } } } } };
function fallback(prompt: string): z.infer<typeof requirementSchema> {
  const budget = Number(prompt.match(/(?:₹|rs\.?|inr|under|budget)\s*([0-9,]+)/i)?.[1]?.replaceAll(",", "") ?? 100000);
  const city = prompt.match(/(?:delivered?\s+to|delivery\s+in|\bin|\bto)\s+([a-z ]+?)(?=\s+(?:by|before|budget)|[,.]|$)/i)?.[1]?.trim() ?? "City to be confirmed";
  const deadline = prompt.match(/(?:by|before)\s+([^,.]+)/i)?.[1]?.trim();
  return { summaryTitle: prompt.replace(/additional quotation details.*/i, "").slice(0, 80), category: "product or service", productDescription: prompt, specifications: [], preferredBrands: [], maxBudget: budget, deliveryCity: city, deliveryBy: deadline, exchange: { enabled: /exchange|trade-in/i.test(prompt) }, hardConstraints: [budget === 100000 ? "Budget to be confirmed" : `₹${budget.toLocaleString("en-IN")} or less`, city === "City to be confirmed" ? "Delivery city to be confirmed" : `${city} delivery`], preferences: [{ criterion: "Lowest effective cost", priority: 100 }] };
}

function normalizeModelRequirement(raw: unknown, deterministic: z.infer<typeof requirementSchema>) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return raw;
  const value = raw as Record<string, unknown>;
  const nonEmpty = (field: string, fallbackValue: string) =>
    typeof value[field] === "string" && value[field].trim() ? value[field].trim() : fallbackValue;
  const exchangeSource = value.exchange && typeof value.exchange === "object" && !Array.isArray(value.exchange)
    ? value.exchange as Record<string, unknown>
    : null;
  const exchange = exchangeSource
    ? {
        enabled: Boolean(exchangeSource.enabled),
        ...(typeof exchangeSource.brand === "string" && exchangeSource.brand.trim() ? { brand: exchangeSource.brand } : {}),
        ...(typeof exchangeSource.capacity === "number" && exchangeSource.capacity > 0 ? { capacity: exchangeSource.capacity } : {}),
        ...(typeof exchangeSource.ageYears === "number" && exchangeSource.ageYears > 0 ? { ageYears: exchangeSource.ageYears } : {}),
        ...(typeof exchangeSource.condition === "string" && exchangeSource.condition.trim() ? { condition: exchangeSource.condition } : {}),
      }
    : deterministic.exchange;
  return {
    ...value,
    summaryTitle: nonEmpty("summaryTitle", deterministic.summaryTitle),
    category: nonEmpty("category", deterministic.category),
    productDescription: nonEmpty("productDescription", deterministic.productDescription),
    deliveryCity: nonEmpty("deliveryCity", deterministic.deliveryCity),
    maxBudget: typeof value.maxBudget === "number" && value.maxBudget > 0 ? value.maxBudget : deterministic.maxBudget,
    capacityMin: typeof value.capacityMin === "number" && value.capacityMin > 0 ? value.capacityMin : undefined,
    capacityMax: typeof value.capacityMax === "number" && value.capacityMax > 0 ? value.capacityMax : undefined,
    deliveryBy: typeof value.deliveryBy === "string" && value.deliveryBy.trim() ? value.deliveryBy.trim() : undefined,
    exchange,
    hardConstraints: Array.isArray(value.hardConstraints) && value.hardConstraints.length ? value.hardConstraints : deterministic.hardConstraints,
    preferences: Array.isArray(value.preferences) && value.preferences.length ? value.preferences : deterministic.preferences,
  };
}
export async function POST(request: Request) {
  const input = inputSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: "Please provide a concise product requirement." }, { status: 400 });
  const deterministic = fallback(input.data.prompt);
  let result = deterministic;
  let source = "deterministic_fallback";
  let warning: string | undefined = "AI is not configured. Continuing with prompt-derived fields.";
  if (aiProvider.configured()) try {
    const raw = await aiProvider.generateStructured<unknown>("Extract a procurement RFQ. Preserve explicit constraints, do not invent facts, use a 100000 INR placeholder plus a clarification constraint if budget is absent, and make preferences sum to 100.", input.data.prompt, "buyer_requirement", schema, false);
    const parsed = requirementSchema.safeParse(normalizeModelRequirement(raw, deterministic));
    if (parsed.success) {
      result = parsed.data;
      source = "openai_structured";
      warning = undefined;
    } else {
      warning = "AI extraction returned an incomplete response. Continuing with fields derived from your request.";
    }
  } catch { warning = "AI extraction was unavailable. Continuing with fields derived from your request."; }
  const { summaryTitle, ...requirement } = result;
  return NextResponse.json({ requirement, summaryTitle, source, warning, clarificationQuestions: getClarificationQuestions(requirement, input.data.prompt) });
}
