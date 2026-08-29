import { initialQuotes } from "@/lib/demo-data";
import { createQuoteTemplates, productLabel } from "@/lib/quote-factory";
import type { FinalOffer, MerchantId, MerchantMessage, Quote, RFQ } from "@/lib/types";

/**
 * Transport-independent merchant boundary. Replace this simulator with an API,
 * WhatsApp, email, ONDC, UAP/ACP, or merchant-agent transport without changing
 * the RFQ flow.
 */
export interface MerchantAdapter {
  sendRFQ(rfq: RFQ, merchantId: MerchantId): Promise<MerchantMessage>;
  sendMessage(merchantId: MerchantId, threadId: string, message: string): Promise<MerchantMessage>;
  confirmOffer(merchantId: MerchantId, quoteId: string): Promise<FinalOffer>;
}

type CommercialPolicy = {
  minimumPrice: number;
  maximumExchange: number;
  maxNegotiationRounds: number;
  timeOut?: boolean;
};

const policies: Record<MerchantId, CommercialPolicy> = {
  electrohub: { minimumPrice: 68000, maximumExchange: 6000, maxNegotiationRounds: 2 },
  coolmart: { minimumPrice: 67500, maximumExchange: 2000, maxNegotiationRounds: 0 },
  city: { minimumPrice: 65500, maximumExchange: 3000, maxNegotiationRounds: 2 },
  value: { minimumPrice: 64500, maximumExchange: 1500, maxNegotiationRounds: 0 },
  hometech: { minimumPrice: 0, maximumExchange: 0, maxNegotiationRounds: 0, timeOut: true },
};

const quoteFor = (merchantId: MerchantId) => initialQuotes.find((quote) => quote.merchantId === merchantId)!;

export class SimulatedMerchantAdapter implements MerchantAdapter {
  private rounds = new Map<MerchantId, number>();

  async sendRFQ(rfq: RFQ, merchantId: MerchantId): Promise<MerchantMessage> {
    if (policies[merchantId].timeOut) throw new Error("MERCHANT_TIMEOUT");
    const quote = createQuoteTemplates(rfq.buyerRequirement).find((candidate) => candidate.merchantId === merchantId)!;
    const incomplete = merchantId === "value";
    return {
      merchantId, threadId: `${rfq.id}-${merchantId}`,
      body: incomplete ? `A preliminary ${rfq.buyerRequirement.category} quote is available; commercial fields still need confirmation.` : `Quote available: ${productLabel(quote.product)} for ₹${quote.basePrice.toLocaleString("en-IN")}.`,
      quote: incomplete ? { basePrice: quote.basePrice, missingFields: ["exact product or SKU", "specification match", "delivery date", "warranty", "final payable amount"] } : quote,
    };
  }

  async sendMessage(merchantId: MerchantId, threadId: string, message: string): Promise<MerchantMessage> {
    if (policies[merchantId].timeOut) throw new Error("MERCHANT_TIMEOUT");
    const round = (this.rounds.get(merchantId) ?? 0) + 1;
    this.rounds.set(merchantId, round);
    const quote = quoteFor(merchantId);
    if (merchantId === "city" && /improve|exchange|pay today/i.test(message) && round <= policies.city.maxNegotiationRounds) {
      const safeQuote = { ...quote, basePrice: Math.max(quote.basePrice, policies.city.minimumPrice), exchangeValue: Math.min(quote.exchangeValue, policies.city.maximumExchange), effectivePrice: Math.max(quote.basePrice, policies.city.minimumPrice) - Math.min(quote.exchangeValue, policies.city.maximumExchange) };
      return { merchantId, threadId, body: "Final policy-approved commercial terms are available for the buyer’s requested product.", quote: safeQuote };
    }
    return { merchantId, threadId, body: "Here are the requested commercially confirmed fields.", quote };
  }

  async confirmOffer(merchantId: MerchantId, quoteId: string): Promise<FinalOffer> {
    const quote = quoteFor(merchantId);
    if (quote.id !== quoteId) throw new Error("QUOTE_NOT_FOUND");
    const policy = policies[merchantId];
    if (quote.basePrice < policy.minimumPrice || quote.exchangeValue > policy.maximumExchange) throw new Error("MERCHANT_POLICY_VIOLATION");
    return { quoteId, merchantId, payableAmount: quote.effectivePrice, validUntil: "30 minutes after confirmation" };
  }
}

/** One retry is the only retry policy permitted for demo merchant communications. */
export async function sendWithOneRetry(adapter: MerchantAdapter, rfq: RFQ, merchantId: MerchantId) {
  try { return await adapter.sendRFQ(rfq, merchantId); }
  catch (firstError) {
    try { return await adapter.sendRFQ(rfq, merchantId); }
    catch { return { merchantId, threadId: `${rfq.id}-${merchantId}`, body: "Merchant unavailable after one retry.", quote: { status: "UNAVAILABLE" as Quote["status"], missingFields: ["No response after one retry"] } }; }
  }
}
