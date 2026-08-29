import { randomUUID } from "crypto";
import type { BuyerRequirement, MerchantCall, MerchantId, Quote, RFQ } from "@/lib/types";

export type TelephonyCall = { id: string; status: MerchantCall["status"] };

export interface TelephonyProvider {
  makeCall(input: { to: string; statusCallback: string; twimlUrl: string }): Promise<TelephonyCall>;
  endCall(callId: string): Promise<void>;
  getCallStatus(callId: string): Promise<MerchantCall["status"]>;
}

export interface VoiceMerchantAdapter {
  requestQuote(input: { merchantId: MerchantId; rfq: RFQ; objective: string }): Promise<MerchantCall>;
  continueConversation(input: { merchantId: MerchantId; conversationId: string; objective: string }): Promise<MerchantCall>;
  confirmFinalOffer(input: { merchantId: MerchantId; quote: Quote }): Promise<{ confirmed: boolean; quote: Quote }>;
}

export const voiceDisclosure = (requirement: BuyerRequirement) =>
  `Hello. I’m an AI buying assistant calling on behalf of a customer looking for ${requirement.productDescription || requirement.category}. Is it okay if I ask a few questions to collect a quotation?`;

const twilioStatuses: Record<string, MerchantCall["status"]> = {
  queued: "QUEUED", ringing: "IN_PROGRESS", "in-progress": "IN_PROGRESS", completed: "COMPLETED", busy: "DECLINED", "no-answer": "FAILED", failed: "FAILED", canceled: "FAILED",
};

const twilioStatus = (status: string): MerchantCall["status"] => twilioStatuses[status] ?? "FAILED";

export class MockTelephonyProvider implements TelephonyProvider {
  async makeCall(): Promise<TelephonyCall> { return { id: `mock_call_${randomUUID()}`, status: "MOCK_COMPLETED" }; }
  async endCall(): Promise<void> { /* Mock calls are already complete. */ }
  async getCallStatus(): Promise<MerchantCall["status"]> { return "MOCK_COMPLETED"; }
}

/**
 * Twilio REST transport only. The media stream itself must be handled by a
 * publicly deployed WebSocket relay that bridges Twilio Media Streams to the
 * Realtime API; Next.js route handlers are not a durable WebSocket host.
 */
export class TwilioTelephonyProvider implements TelephonyProvider {
  private accountSid = process.env.TWILIO_ACCOUNT_SID;
  private authToken = process.env.TWILIO_AUTH_TOKEN;
  private from = process.env.TWILIO_FROM_NUMBER;

  private get authHeader() {
    if (!this.accountSid || !this.authToken) throw new Error("TWILIO_NOT_CONFIGURED");
    return `Basic ${Buffer.from(`${this.accountSid}:${this.authToken}`).toString("base64")}`;
  }

  async makeCall(input: { to: string; statusCallback: string; twimlUrl: string }): Promise<TelephonyCall> {
    if (!this.from) throw new Error("TWILIO_NOT_CONFIGURED");
    const body = new URLSearchParams({ To: input.to, From: this.from, Url: input.twimlUrl, StatusCallback: input.statusCallback, StatusCallbackEvent: "initiated ringing answered completed" });
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Calls.json`, { method: "POST", headers: { Authorization: this.authHeader, "Content-Type": "application/x-www-form-urlencoded" }, body });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "TWILIO_CALL_FAILED");
    return { id: String(payload.sid), status: twilioStatus(String(payload.status)) };
  }

  async endCall(callId: string) {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Calls/${callId}.json`, { method: "POST", headers: { Authorization: this.authHeader, "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ Status: "completed" }) });
    if (!response.ok) throw new Error("TWILIO_END_CALL_FAILED");
  }

  async getCallStatus(callId: string) {
    const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${this.accountSid}/Calls/${callId}.json`, { headers: { Authorization: this.authHeader } });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error("TWILIO_STATUS_FAILED");
    return twilioStatus(String(payload.status));
  }
}

export function voiceConfiguration() {
  const hasTwilio = Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER);
  const hasMediaRelay = Boolean(process.env.VOICE_MEDIA_STREAM_URL && process.env.PUBLIC_APP_URL);
  const hasRealtime = Boolean(process.env.OPENAI_API_KEY);
  return { configured: hasTwilio && hasMediaRelay && hasRealtime, hasTwilio, hasMediaRelay, hasRealtime };
}

export const realtimeVoiceAgentInstructions = `You are Envoy's merchant voice agent. Start with the exact AI disclosure supplied by the server. If the merchant declines, acknowledge and finish the call without retrying.

Run a concise, buyer-beneficial negotiation: (1) confirm the exact model/SKU, in-stock status, base price and taxes; (2) ask one focused question at a time about delivery, warranty, installation, payment terms, and exchange; (3) state the buyer's approved outcome without revealing a competitor or their exact price; (4) ask whether the merchant can improve a permitted commercial term, such as payable price, delivery, installation, warranty, or exchange value; (5) handle accept, counter, or reject calmly, with at most the server-approved negotiation rounds; (6) read back every final commercial term and ask the merchant to confirm it.

Never invent inventory, price, delivery, warranty, exchange, EMI, payment terms, or product capability. Never claim authority outside the buyer's RFQ guardrails. Never reveal a competitor name or exact competing price. When an answer is unavailable, say it is unverified, ask to follow up on the same channel, and record it as unknown. Keep the transcript decision-ready: each question, merchant answer, counteroffer, reason for the next step, and final outcome must be explicit.`;

function merchantPhone(merchantId: MerchantId) {
  return process.env[`VOICE_MERCHANT_${merchantId.toUpperCase()}_PHONE`];
}

export class TwilioVoiceMerchantAdapter implements VoiceMerchantAdapter {
  constructor(private readonly provider: TelephonyProvider = new TwilioTelephonyProvider()) {}

  async requestQuote(input: { merchantId: MerchantId; rfq: RFQ; objective: string }): Promise<MerchantCall> {
    const to = merchantPhone(input.merchantId);
    const baseUrl = process.env.PUBLIC_APP_URL;
    if (!to || !baseUrl || !voiceConfiguration().configured) throw new Error("VOICE_CALL_NOT_CONFIGURED");
    const callback = `${baseUrl}/api/voice/status-callback?rfqId=${encodeURIComponent(input.rfq.id)}&merchantId=${input.merchantId}`;
    const call = await this.provider.makeCall({ to, twimlUrl: `${baseUrl}/api/voice/twiml?rfqId=${encodeURIComponent(input.rfq.id)}&merchantId=${input.merchantId}`, statusCallback: callback });
    return { id: call.id, merchantId: input.merchantId, source: "TWILIO", status: call.status, objective: input.objective, disclosure: voiceDisclosure(input.rfq.buyerRequirement), transcript: [{ speaker: "SYSTEM", text: "Twilio call started; the media relay will stream the AI conversation.", at: new Date().toISOString() }], createdAt: new Date().toISOString() };
  }

  async continueConversation(input: { merchantId: MerchantId; conversationId: string; objective: string }): Promise<MerchantCall> {
    return { id: input.conversationId, merchantId: input.merchantId, source: "TWILIO", status: "QUEUED", objective: input.objective, disclosure: "AI disclosure was completed during the prior call.", transcript: [], createdAt: new Date().toISOString() };
  }

  async confirmFinalOffer(input: { merchantId: MerchantId; quote: Quote }) {
    return { confirmed: false, quote: input.quote };
  }
}
