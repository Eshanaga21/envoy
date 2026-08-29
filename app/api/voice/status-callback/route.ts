import { randomUUID } from "crypto";
import { appendAudit } from "@/lib/db";

export async function POST(request: Request) {
  const url = new URL(request.url);
  const rfqId = url.searchParams.get("rfqId");
  const merchantId = url.searchParams.get("merchantId");
  const form = await request.formData().catch(() => null);
  const status = form?.get("CallStatus")?.toString() ?? "unknown";
  if (rfqId && merchantId) await appendAudit(rfqId, { id: randomUUID(), actor: "SYSTEM", action: `Voice call status: ${status}`, reason: `Twilio reported ${status} for ${merchantId}.`, time: "Now", tone: /failed|busy|no-answer|canceled/i.test(status) ? "warning" : "default" });
  return new Response(null, { status: 204 });
}
