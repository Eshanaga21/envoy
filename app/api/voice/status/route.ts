import { NextResponse } from "next/server";
import { voiceConfiguration } from "@/lib/voice-merchant-adapter";

export async function GET() {
  const configuration = voiceConfiguration();
  return NextResponse.json({ ...configuration, mode: configuration.configured ? "voice_ready" : "mock_only" });
}
