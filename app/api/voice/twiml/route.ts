import { getRFQ } from "@/lib/db";
import { voiceDisclosure } from "@/lib/voice-merchant-adapter";

const escapeXml = (value: string) => value.replace(/[<>&'\"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", "\"": "&quot;" })[character] ?? character);

export async function GET(request: Request) {
  const url = new URL(request.url);
  const state = await getRFQ(url.searchParams.get("rfqId") ?? "");
  const mediaStreamUrl = process.env.VOICE_MEDIA_STREAM_URL;
  const disclosure = state ? voiceDisclosure(state.rfq.buyerRequirement) : "Hello. I am an AI buying assistant. Is it okay if I ask a few questions to collect a quotation?";
  const body = mediaStreamUrl
    ? `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escapeXml(disclosure)}</Say><Connect><Stream url="${escapeXml(mediaStreamUrl)}" /></Connect></Response>`
    : `<?xml version="1.0" encoding="UTF-8"?><Response><Say>${escapeXml(disclosure)}</Say><Say>The voice service is not configured. Goodbye.</Say><Hangup/></Response>`;
  return new Response(body, { headers: { "Content-Type": "text/xml" } });
}
