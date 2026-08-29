import { z } from "zod";
import { aiProvider } from "@/lib/ai/provider";
import { executeProcurementAction, getRFQ, type ProcurementAction } from "@/lib/db";

const actionSchema = z.object({
  name: z.enum(["send_rfq", "request_missing_quote_fields", "disqualify_quotes", "negotiate_quote", "compare_quotes", "complete_procurement"]),
  merchantId: z.enum(["electrohub", "city", "value", "coolmart", "hometech"]).optional(),
  merchantIds: z.array(z.enum(["electrohub", "city", "value", "coolmart", "hometech"])).optional(),
  fields: z.array(z.string()).optional(), reason: z.string().optional(), objective: z.string().optional(),
});
const actionSchemaJson = { type: "object", additionalProperties: false, required: ["name"], properties: { name: { type: "string", enum: ["send_rfq", "request_missing_quote_fields", "disqualify_quotes", "negotiate_quote", "compare_quotes", "complete_procurement"] }, merchantId: { type: "string", enum: ["electrohub", "city", "value", "coolmart", "hometech"] }, merchantIds: { type: "array", items: { type: "string" } }, fields: { type: "array", items: { type: "string" } }, reason: { type: "string" }, objective: { type: "string" } } };
const instructions = "You are Envoy's procurement planner. Return exactly one action. Commercial truth, action sequencing, merchant privacy, prices, ranking, and payment remain server-controlled. Never request payment or expose competitor information.";

function parseAction(raw: unknown, quotes: Array<{ merchantId: string; status: string; basePrice: number }>): ProcurementAction {
  const action = actionSchema.parse(raw);
  if (action.name === "send_rfq") {
    const merchantId = (["electrohub", "city", "value", "coolmart", "hometech"] as const).find((id) => quotes.some((quote) => quote.merchantId === id && quote.status === "INCOMPLETE" && quote.basePrice === 0));
    if (!merchantId) throw new Error("AGENT_RETURNED_INVALID_ACTION");
    return { name: "send_rfq", merchantId };
  }
  if (action.name === "request_missing_quote_fields") return { name: action.name, merchantId: "value", fields: action.fields?.slice(0, 5) ?? ["tax and delivery", "final payable amount"] };
  if (action.name === "disqualify_quotes") return { name: action.name, merchantIds: ["coolmart", "value"], reason: action.reason?.slice(0, 300) ?? "Offers do not meet confirmed commercial constraints." };
  if (action.name === "negotiate_quote") return { name: action.name, merchantId: "city", objective: action.objective?.slice(0, 300) ?? "Request a policy-compliant improvement without revealing competitor details." };
  return { name: action.name };
}

export async function runProcurementAgentStep(rfqId: string) {
  const state = await getRFQ(rfqId);
  if (!state) throw new Error("RFQ_NOT_FOUND");
  if (state.rfq.status === "READY_TO_RECOMMEND") return { state, provider: "complete" as const };
  if (!aiProvider.configured()) throw new Error("AI_PROVIDER_NOT_CONFIGURED");
  const compactState = JSON.stringify({ workflowStep: state.rfq.workflowStep, status: state.rfq.status, requirement: state.rfq.buyerRequirement, quotes: state.quotes.map(({ merchantId, status, basePrice, effectivePrice, missingFields }) => ({ merchantId, status, basePrice, effectivePrice, missingFields })) });
  // The action schema has optional fields which the Responses API does not
  // accept in strict JSON-schema mode. Runtime validation below remains the
  // source of truth for every merchant action.
  const raw = await aiProvider.generateStructured<unknown>(instructions, compactState, "procurement_action", actionSchemaJson, false);
  return { state: await executeProcurementAction(rfqId, parseAction(raw, state.quotes)), provider: "openai" as const };
}
