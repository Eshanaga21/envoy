import type { BuyerRequirement } from "@/lib/types";

export type OutreachChannel = "whatsapp" | "email";

export function rfqSummary(requirement: BuyerRequirement) {
  const lines = [
    `RFQ: ${requirement.productDescription || requirement.category}`,
    `Category: ${requirement.category}`,
    `Budget cap: ₹${requirement.maxBudget.toLocaleString("en-IN")}`,
    `Delivery: ${requirement.deliveryCity}${requirement.deliveryBy ? ` by ${requirement.deliveryBy}` : ""}`,
    requirement.specifications.length ? `Specifications: ${requirement.specifications.join("; ")}` : null,
    requirement.preferredBrands.length ? `Preferred brands: ${requirement.preferredBrands.join(", ")}` : null,
    requirement.exchange?.enabled ? "Exchange / trade-in requested" : null,
    requirement.hardConstraints.length ? `Must have: ${requirement.hardConstraints.join("; ")}` : null,
  ].filter(Boolean);
  return lines.join("\n");
}

export function shareUrl(channel: OutreachChannel, requirement: BuyerRequirement) {
  const summary = rfqSummary(requirement);
  if (channel === "whatsapp") return `https://wa.me/?text=${encodeURIComponent(`Hello, please quote for the following requirement:\n\n${summary}`)}`;
  return `mailto:?subject=${encodeURIComponent(`Envoy RFQ — ${requirement.category}`)}&body=${encodeURIComponent(`Hello,\n\nPlease quote for the following requirement:\n\n${summary}`)}`;
}

export function channelConfiguration() {
  return {
    whatsapp: Boolean(process.env.WHATSAPP_ACCESS_TOKEN && process.env.WHATSAPP_PHONE_NUMBER_ID),
    email: Boolean(process.env.RESEND_API_KEY && process.env.OUTREACH_FROM_EMAIL),
  };
}

export async function sendOutreach(input: { channel: OutreachChannel; recipient: string; requirement: BuyerRequirement; idempotencyKey: string }) {
  const text = `Hello,\n\nPlease quote for the following requirement:\n\n${rfqSummary(input.requirement)}`;
  if (input.channel === "whatsapp") {
    if (!process.env.WHATSAPP_ACCESS_TOKEN || !process.env.WHATSAPP_PHONE_NUMBER_ID) throw new Error("WHATSAPP_NOT_CONFIGURED");
    const response = await fetch(`https://graph.facebook.com/${process.env.WHATSAPP_GRAPH_API_VERSION || "v21.0"}/${process.env.WHATSAPP_PHONE_NUMBER_ID}/messages`, {
      method: "POST",
      headers: { Authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}`, "Content-Type": "application/json" },
      body: JSON.stringify({ messaging_product: "whatsapp", recipient_type: "individual", to: input.recipient.replace(/\D/g, ""), type: "text", text: { preview_url: false, body: text } }),
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) throw new Error(typeof payload?.error?.message === "string" ? payload.error.message : "WHATSAPP_SEND_FAILED");
    return { provider: "whatsapp", id: String(payload?.messages?.[0]?.id ?? "sent") };
  }

  if (!process.env.RESEND_API_KEY || !process.env.OUTREACH_FROM_EMAIL) throw new Error("EMAIL_NOT_CONFIGURED");
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json", "User-Agent": "Envoy/0.1", "Idempotency-Key": input.idempotencyKey },
    body: JSON.stringify({ from: process.env.OUTREACH_FROM_EMAIL, to: [input.recipient], subject: `Envoy RFQ — ${input.requirement.category}`, text }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) throw new Error(typeof payload?.message === "string" ? payload.message : "EMAIL_SEND_FAILED");
  return { provider: "resend", id: String(payload?.id ?? "sent") };
}
