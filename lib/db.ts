import { createClient } from "@libsql/client";
import { randomUUID } from "crypto";
import { qualifies } from "@/lib/commerce";
import {
  createQuoteTemplates,
  genericProgressStep,
  merchantName,
  productLabel,
} from "@/lib/quote-factory";
import type {
  AuditEvent,
  BuyerRequirement,
  MerchantCall,
  MerchantConversation,
  MerchantId,
  MerchantVerification,
  ProductKnowledge,
  Quote,
  QuoteVersion,
  RFQ,
  RFQHistoryItem,
} from "@/lib/types";
import {
  SimulatedMerchantAdapter,
  sendWithOneRetry,
} from "@/lib/merchant-adapter";
import { voiceDisclosure } from "@/lib/voice-merchant-adapter";
import { aiProvider } from "@/lib/ai/provider";

const db = createClient({ url: process.env.DATABASE_URL || "file:quoteai.db" });
let initialized: Promise<void> | undefined;

export function initDb() {
  if (!initialized)
    initialized = (async () => {
      await db.executeMultiple(`
    CREATE TABLE IF NOT EXISTS rfqs (
      id TEXT PRIMARY KEY,
      requirement_json TEXT NOT NULL,
      original_prompt TEXT,
      summary_title TEXT,
      status TEXT NOT NULL,
      budget_cap INTEGER NOT NULL,
      selected_quote_id TEXT,
      workflow_step INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS quotes (
      id TEXT PRIMARY KEY,
      rfq_id TEXT NOT NULL,
      merchant_id TEXT NOT NULL,
      quote_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(rfq_id) REFERENCES rfqs(id)
    );
    CREATE TABLE IF NOT EXISTS audit_events (
      id TEXT PRIMARY KEY,
      rfq_id TEXT NOT NULL,
      event_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(rfq_id) REFERENCES rfqs(id)
    );
    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      rfq_id TEXT NOT NULL,
      sender TEXT NOT NULL,
      body TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(rfq_id) REFERENCES rfqs(id)
    );
    CREATE TABLE IF NOT EXISTS payments (
      id TEXT PRIMARY KEY,
      rfq_id TEXT NOT NULL,
      razorpay_order_id TEXT,
      razorpay_payment_id TEXT,
      status TEXT NOT NULL,
      amount INTEGER NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(rfq_id) REFERENCES rfqs(id)
    );
    CREATE TABLE IF NOT EXISTS quote_versions (
      id TEXT PRIMARY KEY,
      rfq_id TEXT NOT NULL,
      quote_id TEXT NOT NULL,
      version_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(rfq_id) REFERENCES rfqs(id)
    );
    CREATE TABLE IF NOT EXISTS merchant_calls (
      id TEXT PRIMARY KEY,
      rfq_id TEXT NOT NULL,
      merchant_id TEXT NOT NULL,
      call_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(rfq_id) REFERENCES rfqs(id)
    );
    CREATE TABLE IF NOT EXISTS merchant_conversations (
      id TEXT PRIMARY KEY,
      rfq_id TEXT NOT NULL,
      merchant_id TEXT NOT NULL,
      conversation_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(rfq_id) REFERENCES rfqs(id)
    );
    CREATE TABLE IF NOT EXISTS product_knowledge (
      rfq_id TEXT NOT NULL,
      merchant_id TEXT NOT NULL,
      knowledge_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(rfq_id, merchant_id),
      FOREIGN KEY(rfq_id) REFERENCES rfqs(id)
    );
    CREATE TABLE IF NOT EXISTS merchant_knowledge_cache (
      merchant_id TEXT NOT NULL,
      product_key TEXT NOT NULL,
      knowledge_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY(merchant_id, product_key)
    );
    CREATE TABLE IF NOT EXISTS merchant_verifications (
      token TEXT PRIMARY KEY,
      rfq_id TEXT NOT NULL,
      quote_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at TEXT NOT NULL,
      FOREIGN KEY(rfq_id) REFERENCES rfqs(id)
    );
  `);
      const columns = await db.execute("PRAGMA table_info(rfqs)");
      const names = new Set(columns.rows.map((column) => String(column.name)));
      if (!names.has("original_prompt"))
        await db.execute("ALTER TABLE rfqs ADD COLUMN original_prompt TEXT");
      if (!names.has("summary_title"))
        await db.execute("ALTER TABLE rfqs ADD COLUMN summary_title TEXT");
    })();
  return initialized;
}

const now = () => new Date().toISOString();

function parseEvent(value: string): AuditEvent {
  return JSON.parse(value) as AuditEvent;
}

function fallbackTitle(requirement: BuyerRequirement) {
  return (
    requirement.productDescription?.trim().replace(/\s+/g, " ").slice(0, 96) ||
    `New ${requirement.category || "quotation"} request`
  );
}

export async function createRFQ(
  requirement: BuyerRequirement,
  metadata?: { originalPrompt?: string; summaryTitle?: string },
) {
  await initDb();
  const id = `rfq_${randomUUID().replaceAll("-", "").slice(0, 16)}`;
  const timestamp = now();
  const originalPrompt =
    metadata?.originalPrompt?.trim() || requirement.productDescription;
  const summaryTitle =
    metadata?.summaryTitle?.trim().slice(0, 120) || fallbackTitle(requirement);
  await db.execute({
    sql: "INSERT INTO rfqs (id, requirement_json, original_prompt, summary_title, status, budget_cap, workflow_step, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)",
    args: [
      id,
      JSON.stringify(requirement),
      originalPrompt,
      summaryTitle,
      "REQUIREMENT_CONFIRMED",
      requirement.maxBudget,
      timestamp,
      timestamp,
    ],
  });
  for (const quote of createQuoteTemplates(requirement)) {
    const pendingQuote: Quote = {
      id: `${id}_${quote.id}`,
      merchantId: quote.merchantId,
      basePrice: 0,
      exchangeValue: 0,
      effectivePrice: 0,
      confidence: 0,
      missingFields: ["Awaiting merchant response"],
      status: "INCOMPLETE",
      version: 0,
    };
    await db.execute({
      sql: "INSERT INTO quotes (id, rfq_id, merchant_id, quote_json, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [
        pendingQuote.id,
        id,
        quote.merchantId,
        JSON.stringify(pendingQuote),
        timestamp,
      ],
    });
  }
  await appendAudit(id, {
    id: randomUUID(),
    actor: "BUYER",
    action: `Buyer submitted a ${requirement.category} request`,
    reason: "Natural-language intent was converted into a structured RFQ",
    time: "Now",
  });
  await appendAudit(id, {
    id: randomUUID(),
    actor: "BUYER_AGENT",
    action: "Agent created a bounded RFQ",
    reason: `Budget cap set to ₹${requirement.maxBudget.toLocaleString("en-IN")}; maximum 5 merchants`,
    time: "Now",
  });
  await addMessage(
    id,
    "agent",
    "I’ve confirmed your constraints. When you request quotes, I’ll contact up to five eligible merchants and keep every commercial action within your approved budget.",
  );
  return getRFQ(id);
}

/** Buyer changes are allowed only before merchant outreach starts. */
export async function updateRFQRequirement(
  id: string,
  requirement: BuyerRequirement,
) {
  const state = await getRFQ(id);
  if (!state) throw new Error("RFQ_NOT_FOUND");
  if (state.rfq.status !== "REQUIREMENT_CONFIRMED")
    throw new Error("RFQ_ALREADY_SENT");
  await db.execute({
    sql: "UPDATE rfqs SET requirement_json = ?, budget_cap = ?, updated_at = ? WHERE id = ?",
    args: [JSON.stringify(requirement), requirement.maxBudget, now(), id],
  });
  await appendAudit(id, {
    id: randomUUID(),
    actor: "BUYER",
    action: "Buyer edited RFQ guardrails",
    reason: `Budget cap set to ₹${requirement.maxBudget.toLocaleString("en-IN")}; delivery city is ${requirement.deliveryCity}; scoring priorities were refreshed before merchant outreach.`,
    time: "Now",
    requiresApproval: true,
    approvedByBuyer: true,
  });
  await addMessage(
    id,
    "agent",
    "Your RFQ guardrails were updated. I will use these constraints for every merchant interaction.",
  );
  return getRFQ(id);
}

export async function getRFQ(id: string) {
  await initDb();
  const rfqResult = await db.execute({
    sql: "SELECT * FROM rfqs WHERE id = ?",
    args: [id],
  });
  const row = rfqResult.rows[0];
  if (!row) return null;
  const quoteRows = await db.execute({
    sql: "SELECT quote_json FROM quotes WHERE rfq_id = ? ORDER BY created_at",
    args: [id],
  });
  const eventRows = await db.execute({
    sql: "SELECT event_json FROM audit_events WHERE rfq_id = ? ORDER BY created_at",
    args: [id],
  });
  const messageRows = await db.execute({
    sql: "SELECT sender, body FROM messages WHERE rfq_id = ? ORDER BY created_at",
    args: [id],
  });
  const versionRows = await db.execute({
    sql: "SELECT version_json FROM quote_versions WHERE rfq_id = ? ORDER BY created_at",
    args: [id],
  });
  const callRows = await db.execute({
    sql: "SELECT call_json FROM merchant_calls WHERE rfq_id = ? ORDER BY created_at",
    args: [id],
  });
  const conversationRows = await db.execute({
    sql: "SELECT conversation_json FROM merchant_conversations WHERE rfq_id = ? ORDER BY created_at",
    args: [id],
  });
  const knowledgeRows = await db.execute({
    sql: "SELECT knowledge_json FROM product_knowledge WHERE rfq_id = ? ORDER BY updated_at",
    args: [id],
  });
  const verificationRows = await db.execute({
    sql: "SELECT token FROM merchant_verifications WHERE rfq_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1",
    args: [id, "PENDING"],
  });
  return {
    rfq: {
      id: String(row.id),
      buyerRequirement: JSON.parse(String(row.requirement_json)),
      status: String(row.status) as RFQ["status"],
      originalPrompt: row.original_prompt
        ? String(row.original_prompt)
        : (JSON.parse(String(row.requirement_json)).productDescription ||
          JSON.parse(String(row.requirement_json)).category ||
          "Original request unavailable"),
      summaryTitle: row.summary_title
        ? String(row.summary_title)
        : fallbackTitle(
            JSON.parse(String(row.requirement_json)) as BuyerRequirement,
          ),
      createdAt: String(row.created_at),
      budgetCap: Number(row.budget_cap),
      selectedQuoteId: row.selected_quote_id
        ? String(row.selected_quote_id)
        : null,
      workflowStep: Number(row.workflow_step),
    },
    quotes: quoteRows.rows.map(
      (quote) => JSON.parse(String(quote.quote_json)) as Quote,
    ),
    audit: eventRows.rows.map((event) => parseEvent(String(event.event_json))),
    messages: messageRows.rows.map((message) => ({
      from: String(message.sender) as "agent" | "buyer",
      text: String(message.body),
    })),
    quoteVersions: versionRows.rows.map(
      (version) => JSON.parse(String(version.version_json)) as QuoteVersion,
    ),
    calls: callRows.rows.map(
      (call) => JSON.parse(String(call.call_json)) as MerchantCall,
    ),
    conversations: conversationRows.rows.map(
      (conversation) =>
        JSON.parse(
          String(conversation.conversation_json),
        ) as MerchantConversation,
    ),
    knowledge: knowledgeRows.rows.map(
      (knowledge) =>
        JSON.parse(String(knowledge.knowledge_json)) as ProductKnowledge,
    ),
    merchantVerificationToken: verificationRows.rows[0]
      ? String(verificationRows.rows[0].token)
      : undefined,
  };
}

export async function listRFQs(): Promise<RFQHistoryItem[]> {
  await initDb();
  const [rfqResult, quoteResult] = await Promise.all([
    db.execute(
      "SELECT id, requirement_json, original_prompt, summary_title, status, created_at, updated_at FROM rfqs ORDER BY updated_at DESC",
    ),
    db.execute("SELECT rfq_id, quote_json FROM quotes"),
  ]);
  const quotesByRfq = new Map<string, Quote[]>();
  for (const row of quoteResult.rows) {
    const id = String(row.rfq_id);
    quotesByRfq.set(id, [
      ...(quotesByRfq.get(id) ?? []),
      JSON.parse(String(row.quote_json)) as Quote,
    ]);
  }
  return rfqResult.rows.map((row) => {
    const storedRequirement = JSON.parse(
      String(row.requirement_json),
    ) as Partial<BuyerRequirement>;
    // Older RFQs predate some extracted arrays. Normalise them before quote
    // qualification so one legacy record cannot prevent history from loading.
    const requirement: BuyerRequirement = {
      category: storedRequirement.category ?? "product or service",
      productDescription: storedRequirement.productDescription ?? "",
      maxBudget: storedRequirement.maxBudget ?? 0,
      deliveryCity: storedRequirement.deliveryCity ?? "City to be confirmed",
      ...storedRequirement,
      specifications: storedRequirement.specifications ?? [],
      preferredBrands: storedRequirement.preferredBrands ?? [],
      hardConstraints: storedRequirement.hardConstraints ?? [],
      preferences: storedRequirement.preferences ?? [],
    };
    const quotes = quotesByRfq.get(String(row.id)) ?? [];
    const qualifying = quotes.filter((quote) => qualifies(quote, requirement));
    return {
      id: String(row.id),
      summaryTitle: row.summary_title
        ? String(row.summary_title)
        : fallbackTitle(requirement),
      originalPrompt: row.original_prompt
        ? String(row.original_prompt)
        : requirement.productDescription ||
          requirement.category ||
          "Original request unavailable",
      status: String(row.status) as RFQ["status"],
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at),
      qualifyingQuoteCount: qualifying.length,
      bestEffectivePrice: qualifying.length
        ? Math.min(...qualifying.map((quote) => quote.effectivePrice))
        : null,
    };
  });
}

export async function appendAudit(rfqId: string, event: AuditEvent) {
  await initDb();
  await db.execute({
    sql: "INSERT INTO audit_events (id, rfq_id, event_json, created_at) VALUES (?, ?, ?, ?)",
    args: [event.id, rfqId, JSON.stringify(event), now()],
  });
}

export async function addMessage(
  rfqId: string,
  sender: "agent" | "buyer",
  body: string,
) {
  await initDb();
  await db.execute({
    sql: "INSERT INTO messages (id, rfq_id, sender, body, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [randomUUID(), rfqId, sender, body, now()],
  });
}

async function replaceQuote(
  rfqId: string,
  merchantId: Quote["merchantId"],
  replacement: Quote,
  reasonForChange = "Policy-validated merchant quote update",
) {
  await db.execute({
    sql: "UPDATE quotes SET quote_json = ? WHERE rfq_id = ? AND merchant_id = ?",
    args: [JSON.stringify(replacement), rfqId, merchantId],
  });
  const version: QuoteVersion = {
    id: randomUUID(),
    quoteId: replacement.id,
    version: replacement.version,
    values: {
      basePrice: replacement.basePrice,
      exchangeValue: replacement.exchangeValue,
      effectivePrice: replacement.effectivePrice,
      deliveryDate: replacement.deliveryDate,
      warranty: replacement.warranty,
    },
    reasonForChange,
    timestamp: now(),
  };
  await db.execute({
    sql: "INSERT INTO quote_versions (id, rfq_id, quote_id, version_json, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [version.id, rfqId, replacement.id, JSON.stringify(version), now()],
  });
  if (
    replacement.product &&
    replacement.missingFields.length === 0 &&
    replacement.status !== "UNAVAILABLE"
  )
    await upsertProductKnowledgeFromQuote(rfqId, replacement);
}

function quoteTemplate(
  requirement: BuyerRequirement,
  merchantId: Quote["merchantId"],
) {
  return createQuoteTemplates(requirement).find(
    (quote) => quote.merchantId === merchantId,
  )!;
}

function provisionalOffer(template: Quote, requirement: BuyerRequirement) {
  const basePrice =
    Math.round(
      (template.basePrice + Math.max(100, requirement.maxBudget * 0.035)) / 100,
    ) * 100;
  const exchangeValue = requirement.exchange?.enabled
    ? Math.min(
        template.exchangeValue,
        Math.round((requirement.maxBudget * 0.015) / 100) * 100,
      )
    : 0;
  return {
    ...template,
    basePrice,
    exchangeValue,
    effectivePrice: Math.max(
      0,
      basePrice - exchangeValue + (template.deliveryCharge ?? 0),
    ),
    version: 1,
    previousEffectivePrice: undefined,
  };
}

function incompleteOffer(quote: Quote, requirement: BuyerRequirement) {
  const basePrice = Math.round((requirement.maxBudget * 0.92) / 100) * 100;
  return {
    ...quote,
    product: {
      category: requirement.category,
      title: requirement.productDescription,
      specifications: requirement.specifications.slice(0, 3),
    },
    basePrice,
    effectivePrice: basePrice,
    confidence: 45,
    missingFields: [
      "exact product or SKU",
      "specification match",
      "tax and delivery",
      "warranty",
      "final payable amount",
    ],
    status: "INCOMPLETE" as const,
    version: 1,
    source: "SIMULATED" as const,
  };
}

function productKey(quote: Quote) {
  return [quote.product?.brand, quote.product?.model, quote.product?.title]
    .filter(Boolean)
    .join("|")
    .toLowerCase();
}

function factsFromQuote(
  quote: Quote,
  conversationId: string,
): ProductKnowledge["facts"] {
  const verifiedAt = now();
  const confirmed = Boolean(quote.merchantConfirmed);
  const facts = [
    quote.product?.brand ? ["brand", quote.product.brand, "long"] : null,
    quote.product?.model ? ["model", quote.product.model, "long"] : null,
    quote.product?.capacityLitres
      ? ["capacity", `${quote.product.capacityLitres}L`, "long"]
      : null,
    quote.quotedQuantity
      ? ["quoted quantity", `${quote.quotedQuantity.toLocaleString("en-IN")} units`, "short"]
      : null,
    quote.unitPrice
      ? ["unit price", `₹${quote.unitPrice.toLocaleString("en-IN")} before delivery/tax adjustments`, "short"]
      : null,
    quote.product?.availableQuantity !== undefined
      ? ["available stock", `${quote.product.availableQuantity.toLocaleString("en-IN")} units`, "short"]
      : null,
    quote.product?.minimumOrderQuantity
      ? ["minimum order", `${quote.product.minimumOrderQuantity.toLocaleString("en-IN")} units`, "long"]
      : null,
    quote.product?.material ? ["material", quote.product.material, "long"] : null,
    quote.product?.dimensions ? ["dimensions", quote.product.dimensions, "long"] : null,
    quote.deliveryDate ? ["delivery", quote.deliveryDate, "short"] : null,
    quote.warranty ? ["warranty", quote.warranty, "long"] : null,
    quote.installationIncluded !== undefined
      ? [
          "installation",
          quote.installationIncluded ? "Included" : "Not included",
          "long",
        ]
      : null,
    quote.exchangeValue > 0
      ? [
          "exchange",
          `₹${quote.exchangeValue.toLocaleString("en-IN")}${confirmed ? " guaranteed" : " subject to confirmation"}`,
          "short",
        ]
      : null,
  ].filter(Boolean) as Array<[string, string, "short" | "long"]>;
  return facts.map(([key, value, ttl]) => ({
    key,
    value,
    sourceConversationId: conversationId,
    confidence: confirmed ? 100 : 82,
    merchantConfirmed: confirmed,
    lastVerifiedAt: verifiedAt,
    ttl,
  }));
}

function qaFromQuote(
  quote: Quote,
  conversationId: string,
): ProductKnowledge["qa"] {
  const verifiedAt = now();
  const confirmed = Boolean(quote.merchantConfirmed);
  const items = [
    quote.quotedQuantity
      ? [
          "How many units does this quote cover?",
          `${quote.quotedQuantity.toLocaleString("en-IN")} units are included in this quotation${quote.unitPrice ? ` at ₹${quote.unitPrice.toLocaleString("en-IN")} per unit before delivery/tax adjustments` : ""}.`,
          "short",
        ]
      : null,
    quote.product?.availableQuantity !== undefined
      ? [
          "Is the requested quantity in stock?",
          `${quote.product.availableQuantity.toLocaleString("en-IN")} units are currently listed as available${quote.quotedQuantity && quote.product.availableQuantity < quote.quotedQuantity ? "; the full requested quantity needs confirmation." : "."}`,
          "short",
        ]
      : null,
    quote.product?.material
      ? ["What material is the proposed product made from?", quote.product.material, "long"]
      : null,
    quote.installationIncluded !== undefined
      ? [
          "Does installation cost extra?",
          quote.installationIncluded
            ? "No. Installation is included."
            : "Installation is not included in this quote.",
          "long",
        ]
      : null,
    quote.deliveryDate
      ? ["When can it be delivered?", quote.deliveryDate, "short"]
      : null,
    quote.warranty
      ? ["What warranty is included?", quote.warranty, "long"]
      : null,
    quote.exchangeValue > 0
      ? [
          "Can I exchange my current item?",
          `The current estimated exchange value is ₹${quote.exchangeValue.toLocaleString("en-IN")}${confirmed ? "." : ", pending final merchant confirmation."}`,
          "short",
        ]
      : null,
  ].filter(Boolean) as Array<[string, string, "short" | "long"]>;
  return items.map(([question, answer, ttl]) => ({
    id: randomUUID(),
    question,
    answer,
    sourceConversationId: conversationId,
    merchantConfirmed: confirmed,
    lastVerifiedAt: verifiedAt,
    ttl,
    status: "VERIFIED" as const,
  }));
}

export async function getProductKnowledge(
  rfqId: string,
  merchantId?: MerchantId,
) {
  await initDb();
  const result = await db.execute({
    sql: merchantId
      ? "SELECT knowledge_json FROM product_knowledge WHERE rfq_id = ? AND merchant_id = ?"
      : "SELECT knowledge_json FROM product_knowledge WHERE rfq_id = ?",
    args: merchantId ? [rfqId, merchantId] : [rfqId],
  });
  return result.rows.map(
    (row) => JSON.parse(String(row.knowledge_json)) as ProductKnowledge,
  );
}

export async function upsertProductKnowledgeFromQuote(
  rfqId: string,
  quote: Quote,
) {
  if (!quote.product) return;
  const existing = (await getProductKnowledge(rfqId, quote.merchantId))[0];
  const key = productKey(quote);
  const cachedResult = await db.execute({
    sql: "SELECT knowledge_json FROM merchant_knowledge_cache WHERE merchant_id = ? AND product_key = ?",
    args: [quote.merchantId, key],
  });
  const cached = cachedResult.rows[0]
    ? (JSON.parse(
        String(cachedResult.rows[0].knowledge_json),
      ) as ProductKnowledge)
    : undefined;
  const generatedQa = qaFromQuote(quote, `${rfqId}-${quote.merchantId}`);
  const retainedQa = [...(cached?.qa ?? []), ...(existing?.qa ?? [])].filter(
    (item, index, items) =>
      items.findIndex((candidate) => candidate.question === item.question) ===
      index,
  );
  const knowledge: ProductKnowledge = {
    merchantId: quote.merchantId,
    productKey: key,
    facts: factsFromQuote(quote, `${rfqId}-${quote.merchantId}`),
    qa: retainedQa.filter(
      (item) => !generatedQa.some((next) => next.question === item.question),
    ),
    lastVerifiedAt: now(),
  };
  knowledge.qa.push(...generatedQa);
  await db.execute({
    sql: "INSERT OR REPLACE INTO product_knowledge (rfq_id, merchant_id, knowledge_json, updated_at) VALUES (?, ?, ?, ?)",
    args: [rfqId, quote.merchantId, JSON.stringify(knowledge), now()],
  });
  await db.execute({
    sql: "INSERT OR REPLACE INTO merchant_knowledge_cache (merchant_id, product_key, knowledge_json, updated_at) VALUES (?, ?, ?, ?)",
    args: [quote.merchantId, key, JSON.stringify(knowledge), now()],
  });
}

export async function recordMerchantCall(rfqId: string, call: MerchantCall, channel: MerchantConversation["channel"] = "VOICE") {
  await initDb();
  await db.execute({
    sql: "INSERT OR REPLACE INTO merchant_calls (id, rfq_id, merchant_id, call_json, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [call.id, rfqId, call.merchantId, JSON.stringify(call), now()],
  });
  for (const [index, turn] of call.transcript.entries()) {
    const conversation: MerchantConversation = {
      id: `${call.id}_${index}`,
      merchantId: call.merchantId,
      channel,
      direction: turn.speaker,
      text: turn.text,
      at: turn.at,
    };
    await db.execute({
      sql: "INSERT OR REPLACE INTO merchant_conversations (id, rfq_id, merchant_id, conversation_json, created_at) VALUES (?, ?, ?, ?, ?)",
      args: [
        conversation.id,
        rfqId,
        call.merchantId,
        JSON.stringify(conversation),
        conversation.at,
      ],
    });
  }
  await appendAudit(rfqId, {
    id: randomUUID(),
    actor: call.source === "TWILIO" ? "BUYER_AGENT" : "SYSTEM",
    action: `${channel === "WHATSAPP" ? "WhatsApp assistant" : call.source === "TWILIO" ? "Voice agent" : "Mock voice agent"} contacted ${merchantName(call.merchantId)}`,
    reason: call.objective,
    time: "Now",
    tone:
      call.status === "FAILED" || call.status === "DECLINED"
        ? "warning"
        : "default",
  });
}

/** Demo ingress: future WhatsApp webhooks and voice relays use this timeline shape. */
export async function recordSimulatedMerchantReply(
  rfqId: string,
  merchantId: MerchantId,
  channel: "WHATSAPP" | "VOICE",
) {
  const state = await getRFQ(rfqId);
  if (!state) throw new Error("RFQ_NOT_FOUND");
  const quote = state.quotes.find((item) => item.merchantId === merchantId);
  if (!quote) throw new Error("QUOTE_NOT_FOUND");
  const text =
    quote.status === "UNAVAILABLE"
      ? "I’m unavailable to provide a quotation at this time."
      : quote.missingFields.length
        ? "I’m checking the remaining commercial details and will confirm the missing terms shortly."
        : quote.version >= 2
          ? `I confirm the improved final payable amount of ₹${quote.effectivePrice.toLocaleString("en-IN")} and the quoted commercial terms.`
          : `I can offer a current payable amount of ₹${quote.effectivePrice.toLocaleString("en-IN")}. I’m open to reviewing a policy-compliant improvement request.`;
  const conversation: MerchantConversation = {
    id: randomUUID(),
    merchantId,
    channel,
    direction: "MERCHANT",
    text,
    at: now(),
  };
  await db.execute({
    sql: "INSERT INTO merchant_conversations (id, rfq_id, merchant_id, conversation_json, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [
      conversation.id,
      rfqId,
      merchantId,
      JSON.stringify(conversation),
      conversation.at,
    ],
  });
  await appendAudit(rfqId, {
    id: randomUUID(),
    actor: "MERCHANT",
    action: `${merchantName(merchantId)} replied via ${channel === "WHATSAPP" ? "WhatsApp" : "voice"}`,
    reason: text,
    time: "Now",
    tone: "default",
  });
  return getRFQ(rfqId);
}

export function answerFromQuote(question: string, quote: Quote) {
  const lower = question.toLowerCase();
  if (/install/.test(lower) && quote.installationIncluded !== undefined)
    return quote.installationIncluded
      ? "Installation is included."
      : "Installation is not included in this quote.";
  if (/(deliver|arrival|when)/.test(lower) && quote.deliveryDate)
    return `The confirmed delivery term is ${quote.deliveryDate}.`;
  if (/(warranty|guarantee)/.test(lower) && quote.warranty)
    return quote.warranty;
  if (/(exchange|trade.in|trade in)/.test(lower) && quote.exchangeValue)
    return `The quoted exchange value is ₹${quote.exchangeValue.toLocaleString("en-IN")}${quote.merchantConfirmed ? "." : ", subject to final merchant confirmation."}`;
  if (/(model|sku)/.test(lower) && quote.product?.model)
    return quote.product.model;
  if (
    /(capacity|litre|liter|\bl\b)/.test(lower) &&
    quote.product?.capacityLitres
  )
    return `${quote.product.capacityLitres}L`;
  return null;
}

export async function askMerchantForFact(
  rfqId: string,
  merchantId: MerchantId,
  question: string,
  channel: MerchantConversation["channel"] = "WHATSAPP",
) {
  const state = await getRFQ(rfqId);
  if (!state) throw new Error("RFQ_NOT_FOUND");
  const quote = state.quotes.find((item) => item.merchantId === merchantId);
  if (!quote) throw new Error("QUOTE_NOT_FOUND");
  const answer = answerFromQuote(question, quote);
  const call: MerchantCall = {
    id: `mock_call_${randomUUID()}`,
    merchantId,
    source: "MOCK",
    status: "MOCK_COMPLETED",
    objective: `Answer buyer question: ${question}`,
    disclosure: voiceDisclosure(state.rfq.buyerRequirement),
    transcript: [
      {
        speaker: "AGENT",
        text: voiceDisclosure(state.rfq.buyerRequirement),
        at: now(),
      },
      { speaker: "AGENT", text: question, at: now() },
      {
        speaker: "MERCHANT",
        text:
          answer ??
          "I don’t have a verified answer for that question right now.",
        at: now(),
      },
    ],
    createdAt: now(),
  };
  await recordMerchantCall(rfqId, call, channel);
  const existing = (await getProductKnowledge(rfqId, merchantId))[0] ?? {
    merchantId,
    productKey: productKey(quote),
    facts: [],
    qa: [],
    lastVerifiedAt: now(),
  };
  const qa = {
    id: randomUUID(),
    question,
    answer: answer ?? "I haven't verified that with this merchant yet.",
    sourceConversationId: call.id,
    merchantConfirmed: Boolean(quote.merchantConfirmed) && Boolean(answer),
    lastVerifiedAt: now(),
    ttl: "long" as const,
    status: answer ? ("VERIFIED" as const) : ("UNKNOWN" as const),
  };
  const knowledge: ProductKnowledge = {
    ...existing,
    qa: [
      ...existing.qa.filter(
        (item) => item.question.toLowerCase() !== question.toLowerCase(),
      ),
      qa,
    ],
    lastVerifiedAt: now(),
  };
  await db.execute({
    sql: "INSERT OR REPLACE INTO product_knowledge (rfq_id, merchant_id, knowledge_json, updated_at) VALUES (?, ?, ?, ?)",
    args: [rfqId, merchantId, JSON.stringify(knowledge), now()],
  });
  await db.execute({
    sql: "INSERT OR REPLACE INTO merchant_knowledge_cache (merchant_id, product_key, knowledge_json, updated_at) VALUES (?, ?, ?, ?)",
    args: [merchantId, knowledge.productKey, JSON.stringify(knowledge), now()],
  });
  await appendAudit(rfqId, {
    id: randomUUID(),
    actor: "BUYER_AGENT",
    action: `Agent asked ${merchantName(merchantId)} a buyer follow-up`,
    reason: answer
      ? "Merchant answer was added to reusable product knowledge."
      : "Merchant did not provide a verified answer; the fact remains unknown.",
    time: "Now",
    tone: answer ? "success" : "warning",
  });
  return { answer: qa.answer, status: qa.status, knowledge };
}

export async function advanceRFQ(id: string, expectedStep: number) {
  const state = await getRFQ(id);
  if (!state) throw new Error("RFQ_NOT_FOUND");
  if (state.rfq.workflowStep + 1 !== expectedStep || expectedStep > 10)
    throw new Error("INVALID_WORKFLOW_STEP");
  const step = genericProgressStep(expectedStep, state.rfq.buyerRequirement);
  const persistedQuote = (merchantId: Quote["merchantId"]) =>
    state.quotes.find((quote) => quote.merchantId === merchantId)!;
  if (expectedStep === 2) {
    const pending = persistedQuote("electrohub");
    const template = quoteTemplate(state.rfq.buyerRequirement, "electrohub");
    await replaceQuote(id, "electrohub", { ...template, id: pending.id });
    await recordMerchantCall(id, {
      id: `mock_call_${randomUUID()}`,
      merchantId: "electrohub",
      source: "MOCK",
      status: "MOCK_COMPLETED",
      objective: "Collect a commercially complete quotation.",
      disclosure: voiceDisclosure(state.rfq.buyerRequirement),
      transcript: [
        {
          speaker: "AGENT",
          text: voiceDisclosure(state.rfq.buyerRequirement),
          at: now(),
        },
        {
          speaker: "MERCHANT",
          text: "I can provide a comparable quotation.",
          at: now(),
        },
        {
          speaker: "AGENT",
          text: "Please confirm the delivered price, GST treatment, and earliest delivery date so I can compare it fairly.",
          at: now(),
        },
        {
          speaker: "MERCHANT",
          text: "Confirmed. The quotation includes GST and delivery; I have shared the earliest available delivery window.",
          at: now(),
        },
      ],
      createdAt: now(),
    });
  }
  if (expectedStep === 3) {
    const pending = persistedQuote("city");
    const template = quoteTemplate(state.rfq.buyerRequirement, "city");
    await replaceQuote(id, "city", {
      ...provisionalOffer(template, state.rfq.buyerRequirement),
      id: pending.id,
    });
    await recordMerchantCall(id, {
      id: `mock_call_${randomUUID()}`,
      merchantId: "city",
      source: "MOCK",
      status: "MOCK_COMPLETED",
      objective: "Collect a commercially complete quotation.",
      disclosure: voiceDisclosure(state.rfq.buyerRequirement),
      transcript: [
        {
          speaker: "AGENT",
          text: voiceDisclosure(state.rfq.buyerRequirement),
          at: now(),
        },
        {
          speaker: "MERCHANT",
          text: "Here is my initial quotation.",
          at: now(),
        },
        {
          speaker: "AGENT",
          text: "Thank you. Can you confirm whether this is the delivered price and whether GST is included?",
          at: now(),
        },
        {
          speaker: "MERCHANT",
          text: "I will confirm the final delivered terms and check whether a bulk-order improvement is available.",
          at: now(),
        },
      ],
      createdAt: now(),
    });
  }
  if (expectedStep === 4) {
    const pending = persistedQuote("value");
    await replaceQuote(
      id,
      "value",
      incompleteOffer(pending, state.rfq.buyerRequirement),
    );
    await recordMerchantCall(id, {
      id: `mock_call_${randomUUID()}`,
      merchantId: "value",
      source: "MOCK",
      status: "MOCK_COMPLETED",
      objective: "Collect a commercially complete quotation.",
      disclosure: voiceDisclosure(state.rfq.buyerRequirement),
      transcript: [
        {
          speaker: "AGENT",
          text: voiceDisclosure(state.rfq.buyerRequirement),
          at: now(),
        },
        {
          speaker: "MERCHANT",
          text: "I have a preliminary quote but need to confirm commercial fields.",
          at: now(),
        },
        {
          speaker: "AGENT",
          text: "Please confirm the quantity, GST treatment, delivery date, and any delivery charge before I can compare this offer.",
          at: now(),
        },
      ],
      createdAt: now(),
    });
  }
  if (expectedStep === 5) {
    const pending = persistedQuote("value");
    const template = quoteTemplate(state.rfq.buyerRequirement, "value");
    await replaceQuote(id, "value", { ...template, id: pending.id });
    await recordMerchantCall(id, {
      id: `mock_followup_${randomUUID()}`,
      merchantId: "value",
      source: "MOCK",
      status: "MOCK_COMPLETED",
      objective: "Confirm the missing commercial terms.",
      disclosure: voiceDisclosure(state.rfq.buyerRequirement),
      transcript: [
        { speaker: "AGENT", text: "I’m following up on the missing commercial details. Can you now confirm GST, delivery, and the quoted quantity?", at: now() },
        { speaker: "MERCHANT", text: `Confirmed: the quote covers the requested quantity. GST and delivery terms are now included in the commercial offer of ₹${template.effectivePrice.toLocaleString("en-IN")}.`, at: now() },
      ],
      createdAt: now(),
    });
  }
  if (expectedStep === 6) {
    const pending = persistedQuote("coolmart");
    const template = quoteTemplate(state.rfq.buyerRequirement, "coolmart");
    await replaceQuote(id, "coolmart", { ...template, id: pending.id });
    await recordMerchantCall(id, {
      id: `mock_call_${randomUUID()}`,
      merchantId: "coolmart",
      source: "MOCK",
      status: "MOCK_COMPLETED",
      objective: "Collect a commercially complete quotation.",
      disclosure: voiceDisclosure(state.rfq.buyerRequirement),
      transcript: [
        {
          speaker: "AGENT",
          text: voiceDisclosure(state.rfq.buyerRequirement),
          at: now(),
        },
        {
          speaker: "MERCHANT",
          text: "My delivery window is after the buyer’s deadline.",
          at: now(),
        },
      ],
      createdAt: now(),
    });
  }
  if (expectedStep === 7) {
    const pending = persistedQuote("hometech");
    const template = quoteTemplate(state.rfq.buyerRequirement, "hometech");
    await replaceQuote(id, "hometech", { ...template, id: pending.id });
    await recordMerchantCall(id, {
      id: `mock_call_${randomUUID()}`,
      merchantId: "hometech",
      source: "MOCK",
      status: "FAILED",
      objective: "Collect a commercially complete quotation.",
      disclosure: voiceDisclosure(state.rfq.buyerRequirement),
      transcript: [
        {
          speaker: "SYSTEM",
          text: "No answer after one permitted retry.",
          at: now(),
        },
      ],
      createdAt: now(),
    });
  }
  if (expectedStep === 9) {
    const pending = persistedQuote("city");
    const template = quoteTemplate(state.rfq.buyerRequirement, "city");
    await replaceQuote(id, "city", { ...template, id: pending.id });
    await recordMerchantCall(id, {
      id: `mock_negotiation_${randomUUID()}`,
      merchantId: "city",
      source: "MOCK",
      status: "MOCK_COMPLETED",
      objective: "Request a final policy-compliant bulk-order improvement.",
      disclosure: voiceDisclosure(state.rfq.buyerRequirement),
      transcript: [
        { speaker: "AGENT", text: "The buyer is ready to proceed if you can improve the delivered commercial offer. Can you make one final bulk-order adjustment?", at: now() },
        { speaker: "MERCHANT", text: `I can improve the final delivered offer to ₹${template.effectivePrice.toLocaleString("en-IN")}, with the quoted GST and delivery terms retained.`, at: now() },
        { speaker: "AGENT", text: "Thank you. I’ve recorded the improved final offer and will compare it against the buyer’s approved requirements.", at: now() },
      ],
      createdAt: now(),
    });
  }
  const status: RFQ["status"] =
    expectedStep === 10
      ? "READY_TO_RECOMMEND"
      : expectedStep >= 8
        ? "NEGOTIATING"
        : expectedStep >= 5
          ? "CLARIFYING_QUOTES"
          : "COLLECTING_QUOTES";
  await db.execute({
    sql: "UPDATE rfqs SET workflow_step = ?, status = ?, updated_at = ? WHERE id = ?",
    args: [expectedStep, status, now(), id],
  });
  const tone =
    step.kind === "success"
      ? "success"
      : step.kind === "warn"
        ? "warning"
        : "default";
  await appendAudit(id, {
    id: randomUUID(),
    actor:
      step.kind === "reply"
        ? "MERCHANT"
        : step.kind === "warn"
          ? "SYSTEM"
          : "BUYER_AGENT",
    action: step.title,
    reason: step.detail,
    time: "Now",
    tone,
  });
  return getRFQ(id);
}

export type ProcurementAction =
  | { name: "send_rfq"; merchantId: Quote["merchantId"] }
  | {
      name: "request_missing_quote_fields";
      merchantId: "value";
      fields: string[];
    }
  | {
      name: "disqualify_quotes";
      merchantIds: Array<"coolmart" | "value">;
      reason: string;
    }
  | { name: "negotiate_quote"; merchantId: "city"; objective: string }
  | { name: "compare_quotes" }
  | { name: "complete_procurement" };

async function persistAgentAction(
  rfqId: string,
  state: NonNullable<Awaited<ReturnType<typeof getRFQ>>>,
  event: AuditEvent,
  complete = false,
) {
  const workflowStep = state.rfq.workflowStep + 1;
  await db.execute({
    sql: "UPDATE rfqs SET workflow_step = ?, status = ?, updated_at = ? WHERE id = ?",
    args: [
      workflowStep,
      complete ? "READY_TO_RECOMMEND" : "COLLECTING_QUOTES",
      now(),
      rfqId,
    ],
  });
  await appendAudit(rfqId, event);
  return getRFQ(rfqId);
}

/**
 * Executes only policy-checked effects selected by the Gemini tool call. The
 * model proposes an action; this layer remains the source of commercial truth.
 */
export async function executeProcurementAction(
  rfqId: string,
  action: ProcurementAction,
) {
  const state = await getRFQ(rfqId);
  if (!state) throw new Error("RFQ_NOT_FOUND");
  if (
    state.rfq.status === "READY_TO_RECOMMEND" ||
    state.rfq.status === "PURCHASED"
  )
    throw new Error("PROCUREMENT_ALREADY_COMPLETE");
  const adapter = new SimulatedMerchantAdapter();
  const rfq: RFQ = {
    id: state.rfq.id,
    buyerRequirement: state.rfq.buyerRequirement,
    originalPrompt: state.rfq.originalPrompt,
    summaryTitle: state.rfq.summaryTitle,
    status: state.rfq.status as RFQ["status"],
    createdAt: "",
    budgetCap: state.rfq.buyerRequirement.maxBudget,
  };
  const existing = (merchantId: Quote["merchantId"]) =>
    state.quotes.find((quote) => quote.merchantId === merchantId)!;

  if (action.name === "send_rfq") {
    const quote = existing(action.merchantId);
    if (quote.status !== "INCOMPLETE" || quote.basePrice !== 0)
      throw new Error("MERCHANT_ALREADY_CONTACTED");
    const callObjective = `Gather a comparable quotation for ${state.rfq.buyerRequirement.productDescription || state.rfq.buyerRequirement.category}.`;
    if (action.merchantId === "hometech") {
      await sendWithOneRetry(adapter, rfq, "hometech");
      await recordMerchantCall(rfqId, {
        id: `mock_call_${randomUUID()}`,
        merchantId: "hometech",
        source: "MOCK",
        status: "FAILED",
        objective: callObjective,
        disclosure: voiceDisclosure(state.rfq.buyerRequirement),
        transcript: [
          {
            speaker: "AGENT",
            text: voiceDisclosure(state.rfq.buyerRequirement),
            at: now(),
          },
          {
            speaker: "SYSTEM",
            text: "No answer after one permitted retry.",
            at: now(),
          },
        ],
        createdAt: now(),
      });
      const unavailable = quoteTemplate(state.rfq.buyerRequirement, "hometech");
      await replaceQuote(rfqId, "hometech", { ...unavailable, id: quote.id });
      return persistAgentAction(rfqId, state, {
        id: randomUUID(),
        actor: "SYSTEM",
        action: `${merchantName("hometech")} retry failed gracefully`,
        reason:
          "The merchant timed out, one permitted retry failed, and the RFQ continued.",
        time: "Now",
        tone: "warning",
      });
    }
    const reply = await adapter.sendRFQ(rfq, action.merchantId);
    await recordMerchantCall(rfqId, {
      id: `mock_call_${randomUUID()}`,
      merchantId: action.merchantId,
      source: "MOCK",
      status: "MOCK_COMPLETED",
      objective: callObjective,
      disclosure: voiceDisclosure(state.rfq.buyerRequirement),
      transcript: [
        {
          speaker: "AGENT",
          text: voiceDisclosure(state.rfq.buyerRequirement),
          at: now(),
        },
        { speaker: "MERCHANT", text: reply.body, at: now() },
      ],
      createdAt: now(),
    });
    if (action.merchantId === "value") {
      await replaceQuote(
        rfqId,
        "value",
        incompleteOffer(quote, state.rfq.buyerRequirement),
      );
      return persistAgentAction(rfqId, state, {
        id: randomUUID(),
        actor: "MERCHANT",
        action: `${merchantName("value")} sent an incomplete quote`,
        reason: reply.body,
        time: "Now",
        tone: "warning",
      });
    }
    const template = quoteTemplate(
      state.rfq.buyerRequirement,
      action.merchantId,
    );
    const received =
      action.merchantId === "city"
        ? {
            ...provisionalOffer(template, state.rfq.buyerRequirement),
            id: quote.id,
          }
        : { ...template, id: quote.id };
    await replaceQuote(rfqId, action.merchantId, received);
    return persistAgentAction(rfqId, state, {
      id: randomUUID(),
      actor: "MERCHANT",
      action: `${merchantName(action.merchantId)} replied to the RFQ`,
      reason: reply.body,
      time: "Now",
    });
  }

  if (action.name === "request_missing_quote_fields") {
    const quote = existing("value");
    if (quote.status !== "INCOMPLETE" || quote.basePrice === 0)
      throw new Error("NO_MISSING_VALUE_QUOTE");
    const reply = await adapter.sendMessage(
      "value",
      `${rfqId}-value`,
      `Please confirm: ${action.fields.join(", ")}.`,
    );
    const complete = quoteTemplate(state.rfq.buyerRequirement, "value");
    await replaceQuote(rfqId, "value", { ...complete, id: quote.id });
    return persistAgentAction(rfqId, state, {
      id: randomUUID(),
      actor: "BUYER_AGENT",
      action: `Agent clarified ${merchantName("value")}’s quote`,
      reason: reply.body,
      time: "Now",
    });
  }

  if (action.name === "disqualify_quotes") {
    if (
      action.merchantIds.length !== 2 ||
      !action.merchantIds.includes("coolmart") ||
      !action.merchantIds.includes("value")
    )
      throw new Error("DISQUALIFICATION_POLICY_REJECTED");
    const coolmart = existing("coolmart");
    const value = existing("value");
    if (coolmart.status !== "DISQUALIFIED" || value.status !== "DISQUALIFIED")
      throw new Error("QUOTES_NOT_READY_TO_DISQUALIFY");
    return persistAgentAction(rfqId, state, {
      id: randomUUID(),
      actor: "BUYER_AGENT",
      action: "Agent disqualified non-qualifying offers",
      reason: action.reason,
      time: "Now",
      tone: "warning",
    });
  }

  if (action.name === "negotiate_quote") {
    const quote = existing("city");
    if (quote.status !== "VALID" || quote.version !== 1)
      throw new Error("CITY_NOT_READY_FOR_NEGOTIATION");
    const reply = await adapter.sendMessage(
      "city",
      `${rfqId}-city`,
      action.objective,
    );
    const finalOffer = quoteTemplate(state.rfq.buyerRequirement, "city");
    await replaceQuote(rfqId, "city", { ...finalOffer, id: quote.id });
    return persistAgentAction(rfqId, state, {
      id: randomUUID(),
      actor: "BUYER_AGENT",
      action: `Agent negotiated ${merchantName("city")}’s final offer`,
      reason: reply.body,
      time: "Now",
      tone: "success",
    });
  }

  if (action.name === "compare_quotes") {
    const city = existing("city");
    const electrohub = existing("electrohub");
    if (city.version < 2 || electrohub.status !== "VALID")
      throw new Error("OFFERS_NOT_READY_TO_COMPARE");
    const winner = [city, electrohub]
      .filter((quote) => qualifies(quote, state.rfq.buyerRequirement))
      .sort((a, b) => a.effectivePrice - b.effectivePrice)[0];
    if (!winner || winner.merchantId !== "city")
      throw new Error("DETERMINISTIC_RECOMMENDATION_CHANGED");
    return persistAgentAction(rfqId, state, {
      id: randomUUID(),
      actor: "BUYER_AGENT",
      action: "Agent compared normalized qualifying offers",
      reason: `${merchantName("city")} is the lowest effective offer meeting every confirmed hard constraint.`,
      time: "Now",
      tone: "success",
    });
  }

  const unresolved = state.quotes.some(
    (quote) => quote.status === "INCOMPLETE",
  );
  if (unresolved || state.rfq.workflowStep < 9)
    throw new Error("PROCUREMENT_NOT_READY_TO_COMPLETE");
  return persistAgentAction(
    rfqId,
    state,
    {
      id: randomUUID(),
      actor: "BUYER_AGENT",
      action: "Best executable offer found",
      reason: `All merchant actions are complete; ${merchantName("city")} is ready for buyer selection.`,
      time: "Now",
      tone: "success",
    },
    true,
  );
}

export async function askAgent(id: string, question: string) {
  const state = await getRFQ(id);
  if (!state) throw new Error("RFQ_NOT_FOUND");
  await addMessage(id, "buyer", question);
  let answer =
    "I can explain the stored offers and constraints using the available commercial data. Your budget and payment guardrails remain in force.";
  if (aiProvider.configured()) {
    try {
      answer = await aiProvider.generateText(
        "You are Envoy's buyer-facing procurement assistant. Answer using only the supplied RFQ state in at most 90 words. Do not change merchant terms, start payments, promise an unrecorded negotiation, or reveal confidential competing quotes.",
        `RFQ state: ${JSON.stringify({ requirement: state.rfq.buyerRequirement, quotes: state.quotes, audit: state.audit.map((event) => event.action) })}\n\nBuyer question: ${question}`,
      );
    } catch {
      /* The persisted fallback answer remains visible to the buyer. */
    }
  }
  await addMessage(id, "agent", answer);
  await appendAudit(id, {
    id: randomUUID(),
    actor: "BUYER_AGENT",
    action: "Envoy answered a buyer follow-up",
    reason:
      "Answer bounded to normalized offers and merchant policy constraints",
    time: "Now",
  });
  return getRFQ(id);
}

export async function getMerchantVerification(token: string) {
  await initDb();
  const result = await db.execute({
    sql: "SELECT * FROM merchant_verifications WHERE token = ?",
    args: [token],
  });
  const row = result.rows[0];
  if (!row) return null;
  const state = await getRFQ(String(row.rfq_id));
  const quote = state?.quotes.find((item) => item.id === String(row.quote_id));
  if (!state || !quote) return null;
  return {
    verification: {
      token: String(row.token),
      rfqId: String(row.rfq_id),
      quoteId: String(row.quote_id),
      status: String(row.status) as MerchantVerification["status"],
      createdAt: String(row.created_at),
    },
    quote,
    requirement: state.rfq.buyerRequirement,
    merchantName: merchantName(quote.merchantId),
  };
}

export async function confirmMerchantVerification(
  token: string,
  action: "confirm" | "edit",
) {
  const result = await getMerchantVerification(token);
  if (!result) throw new Error("VERIFICATION_NOT_FOUND");
  const status: MerchantVerification["status"] =
    action === "confirm" ? "CONFIRMED" : "EDIT_REQUESTED";
  await db.execute({
    sql: "UPDATE merchant_verifications SET status = ? WHERE token = ?",
    args: [status, token],
  });
  if (action === "confirm") {
    const confirmed: Quote = {
      ...result.quote,
      merchantConfirmed: true,
      confirmationSource: "MERCHANT_VERIFICATION",
      source: "LIVE",
    };
    await replaceQuote(
      result.verification.rfqId,
      confirmed.merchantId,
      confirmed,
      "Merchant confirmed final terms on verification page",
    );
    await appendAudit(result.verification.rfqId, {
      id: randomUUID(),
      actor: "MERCHANT",
      action: `${result.merchantName} confirmed final quotation`,
      reason: "Merchant completed the secure verification page.",
      time: "Now",
      tone: "success",
    });
  } else {
    await appendAudit(result.verification.rfqId, {
      id: randomUUID(),
      actor: "MERCHANT",
      action: `${result.merchantName} requested quote edits`,
      reason: "Merchant did not confirm the existing final terms.",
      time: "Now",
      tone: "warning",
    });
  }
  return getMerchantVerification(token);
}

export async function selectOffer(id: string, quoteId: string) {
  const state = await getRFQ(id);
  if (!state) throw new Error("RFQ_NOT_FOUND");
  if (state.rfq.status !== "READY_TO_RECOMMEND")
    throw new Error("RFQ_NOT_READY_FOR_SELECTION");
  const quote = state.quotes.find((item) => item.id === quoteId);
  if (!quote || !qualifies(quote, state.rfq.buyerRequirement))
    throw new Error("QUOTE_NOT_ELIGIBLE");
  const confirmedQuote: Quote = {
    ...quote,
    merchantConfirmed: undefined,
    confirmationSource: "SIMULATED",
    source: quote.source ?? "SIMULATED",
  };
  await replaceQuote(
    id,
    confirmedQuote.merchantId,
    confirmedQuote,
    "Final offer reconfirmed before buyer payment approval",
  );
  const verificationToken = randomUUID().replaceAll("-", "");
  await db.execute({
    sql: "INSERT INTO merchant_verifications (token, rfq_id, quote_id, status, created_at) VALUES (?, ?, ?, ?, ?)",
    args: [verificationToken, id, quoteId, "PENDING", now()],
  });
  await db.execute({
    sql: "UPDATE rfqs SET selected_quote_id = ?, status = ?, updated_at = ? WHERE id = ?",
    args: [quoteId, "AWAITING_PAYMENT_APPROVAL", now(), id],
  });
  await appendAudit(id, {
    id: randomUUID(),
    actor: "BUYER",
    action: `Buyer selected ${merchantName(quote.merchantId)}`,
    reason: "Buyer chose the eligible merchant before final payment approval",
    time: "Now",
    requiresApproval: true,
    approvedByBuyer: true,
  });
  await appendAudit(id, {
    id: randomUUID(),
    actor: "MERCHANT",
    action: "Merchant reconfirmed final offer",
    reason: `${productLabel(quote.product)} · ${quote.effectivePrice.toLocaleString("en-IN")} payable · valid for 30 minutes`,
    time: "Now",
    tone: "success",
  });
  const nextState = await getRFQ(id);
  return nextState
    ? { ...nextState, merchantVerificationToken: verificationToken }
    : nextState;
}

export async function recordPaymentOrder(
  rfqId: string,
  razorpayOrderId: string,
  amount: number,
) {
  await initDb();
  const paymentId = `payment_${randomUUID()}`;
  await db.execute({
    sql: "INSERT INTO payments (id, rfq_id, razorpay_order_id, status, amount, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    args: [paymentId, rfqId, razorpayOrderId, "PENDING", amount, now()],
  });
  await db.execute({
    sql: "UPDATE rfqs SET status = ?, updated_at = ? WHERE id = ?",
    args: ["PAYMENT_PROCESSING", now(), rfqId],
  });
  await appendAudit(rfqId, {
    id: randomUUID(),
    actor: "BUYER",
    action: "Buyer approved payment",
    reason: "Explicit approval recorded before Razorpay order creation",
    time: "Now",
    requiresApproval: true,
    approvedByBuyer: true,
  });
}

export async function completePayment(
  rfqId: string,
  orderId: string,
  paymentId: string,
  verified: boolean,
) {
  const state = await getRFQ(rfqId);
  if (!state) throw new Error("RFQ_NOT_FOUND");
  if (!verified) {
    await db.execute({
      sql: "UPDATE payments SET status = ? WHERE rfq_id = ? AND razorpay_order_id = ?",
      args: ["FAILED", rfqId, orderId],
    });
    await db.execute({
      sql: "UPDATE rfqs SET status = ?, updated_at = ? WHERE id = ?",
      args: ["AWAITING_PAYMENT_APPROVAL", now(), rfqId],
    });
    await appendAudit(rfqId, {
      id: randomUUID(),
      actor: "SYSTEM",
      action: "Payment failed — no purchase recorded",
      reason:
        "Payment verification was not successful; the offer remains reserved",
      time: "Now",
      tone: "warning",
    });
    return false;
  }
  await db.execute({
    sql: "UPDATE payments SET razorpay_payment_id = ?, status = ? WHERE rfq_id = ? AND razorpay_order_id = ?",
    args: [paymentId, "VERIFIED", rfqId, orderId],
  });
  await db.execute({
    sql: "UPDATE rfqs SET status = ?, updated_at = ? WHERE id = ?",
    args: ["PURCHASED", now(), rfqId],
  });
  await appendAudit(rfqId, {
    id: randomUUID(),
    actor: "SYSTEM",
    action: "Payment verified — purchase completed",
    reason: "Razorpay signature verified server-side",
    time: "Now",
    tone: "success",
  });
  return true;
}
