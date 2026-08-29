export type MerchantId =
  "electrohub" | "coolmart" | "city" | "value" | "hometech";
export type QuoteStatus =
  "INCOMPLETE" | "VALID" | "DISQUALIFIED" | "UNAVAILABLE";

export type BuyerRequirement = {
  /** A buyer-defined category such as "laptop", "solar inverter" or "office chairs". */
  category: string;
  /** The product or service the buyer asked for, kept verbatim enough for an RFQ. */
  productDescription: string;
  /** Normalized specifications extracted from the buyer's request. */
  specifications: string[];
  capacityMin?: number;
  capacityMax?: number;
  preferredBrands: string[];
  maxBudget: number;
  deliveryCity: string;
  deliveryBy?: string;
  exchange?: {
    enabled: boolean;
    brand?: string;
    capacity?: number;
    ageYears?: number;
    condition?: string;
  };
  hardConstraints: string[];
  preferences: Array<{ criterion: string; priority: number }>;
  rfqGuardrails?: {
    maxMerchants: number;
    retriesPerMerchant: number;
    maxFollowUps: number;
  };
};

export type RFQ = {
  id: string;
  buyerRequirement: BuyerRequirement;
  /** Exact buyer wording retained for review and future RFQ history. */
  originalPrompt: string;
  /** Concise label generated when the buyer's request is parsed. */
  summaryTitle: string;
  status:
    | "DRAFT_REQUIREMENT"
    | "REQUIREMENT_CONFIRMED"
    | "RFQ_SENT"
    | "COLLECTING_QUOTES"
    | "CLARIFYING_QUOTES"
    | "NEGOTIATING"
    | "READY_TO_RECOMMEND"
    | "BUYER_SELECTED"
    | "FINAL_TERMS_CONFIRMED"
    | "AWAITING_PAYMENT_APPROVAL"
    | "PAYMENT_PROCESSING"
    | "PURCHASED";
  createdAt: string;
  budgetCap: number;
};

export type RFQHistoryItem = {
  id: string;
  summaryTitle: string;
  originalPrompt: string;
  status: RFQ["status"];
  createdAt: string;
  updatedAt: string;
  qualifyingQuoteCount: number;
  bestEffectivePrice: number | null;
};

export type MerchantMessage = {
  merchantId: MerchantId;
  threadId: string;
  body: string;
  quote?: Partial<Quote>;
};

export type FinalOffer = {
  quoteId: string;
  merchantId: MerchantId;
  payableAmount: number;
  validUntil: string;
};

export type Merchant = {
  id: MerchantId;
  name: string;
  initials: string;
  color: string;
  statusLabel: string;
  voiceEnabled?: boolean;
};

export type Quote = {
  id: string;
  merchantId: MerchantId;
  product?: {
    category: string;
    title: string;
    brand?: string;
    model?: string;
    /** Merchant-supplied listing image. Simulation assets are visibly labelled in the UI. */
    imageUrl?: string;
    capacityLitres?: number;
    specifications?: string[];
    material?: string;
    dimensions?: string;
    colorOptions?: string[];
    availableQuantity?: number;
    minimumOrderQuantity?: number;
  };
  basePrice: number;
  /** Quantity covered by this quotation, where the merchant supplied it. */
  quotedQuantity?: number;
  /** Price for one unit before delivery, tax adjustments, or exchange. */
  unitPrice?: number;
  gstIncluded?: boolean;
  exchangeValue: number;
  effectivePrice: number;
  deliveryDate?: string;
  deliveryCharge?: number;
  installationIncluded?: boolean;
  warranty?: string;
  paymentConditions?: string;
  validUntil?: string;
  confidence: number;
  missingFields: string[];
  status: QuoteStatus;
  version: number;
  previousEffectivePrice?: number;
  /** Synthetic quotes are visibly labelled until a live merchant adapter is connected. */
  source?: "SIMULATED" | "LIVE";
  merchantConfirmed?: boolean;
  confirmationSource?: "SIMULATED" | "VOICE_CALL" | "MERCHANT_VERIFICATION";
};

export type QuoteVersion = {
  id: string;
  quoteId: string;
  version: number;
  values: Pick<
    Quote,
    | "basePrice"
    | "exchangeValue"
    | "effectivePrice"
    | "deliveryDate"
    | "warranty"
  >;
  reasonForChange: string;
  timestamp: string;
};

export type CallStatus =
  | "QUEUED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "DECLINED"
  | "FAILED"
  | "MOCK_COMPLETED";

export type MerchantCall = {
  id: string;
  merchantId: MerchantId;
  source: "MOCK" | "TWILIO";
  status: CallStatus;
  objective: string;
  disclosure: string;
  transcript: Array<{
    speaker: "AGENT" | "MERCHANT" | "SYSTEM";
    text: string;
    at: string;
  }>;
  createdAt: string;
};

/** A channel-neutral turn used to keep WhatsApp and voice negotiations in one timeline. */
export type MerchantConversation = {
  id: string;
  merchantId: MerchantId;
  channel: "WHATSAPP" | "VOICE";
  direction: "AGENT" | "MERCHANT" | "SYSTEM";
  text: string;
  at: string;
};

export type NegotiationState =
  | "CONTACTING"
  | "AWAITING_QUOTE"
  | "CLARIFYING_TERMS"
  | "NEGOTIATING"
  | "AWAITING_COUNTEROFFER"
  | "FINAL_TERMS_READY"
  | "EXCLUDED"
  | "UNRESPONSIVE";

export type ProductFact = {
  key: string;
  value: string;
  sourceConversationId: string;
  confidence: number;
  merchantConfirmed: boolean;
  lastVerifiedAt: string;
  ttl: "short" | "long";
};

export type ProductQA = {
  id: string;
  question: string;
  answer: string;
  sourceConversationId: string;
  merchantConfirmed: boolean;
  lastVerifiedAt: string;
  ttl: "short" | "long";
  status: "VERIFIED" | "UNKNOWN";
};

export type ProductKnowledge = {
  merchantId: MerchantId;
  productKey: string;
  facts: ProductFact[];
  qa: ProductQA[];
  lastVerifiedAt: string;
};

export type MerchantVerification = {
  token: string;
  rfqId: string;
  quoteId: string;
  status: "PENDING" | "CONFIRMED" | "EDIT_REQUESTED";
  createdAt: string;
};

export type AuditActor = "BUYER" | "BUYER_AGENT" | "MERCHANT" | "SYSTEM";

export type AuditEvent = {
  id: string;
  actor: AuditActor;
  action: string;
  reason: string;
  time: string;
  tone?: "default" | "success" | "warning" | "danger";
  requiresApproval?: boolean;
  approvedByBuyer?: boolean;
};

export type AgentStep = {
  id: string;
  merchantId?: MerchantId;
  title: string;
  detail: string;
  kind: "send" | "reply" | "think" | "warn" | "success";
  delay: number;
};
