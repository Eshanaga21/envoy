import { NextResponse } from "next/server";
import { runProcurementAgentStep } from "@/lib/procurement-agent";
import { advanceRFQ, appendAudit, getRFQ } from "@/lib/db";
import { randomUUID } from "crypto";

async function fallbackStep(id: string, message: string) {
  const state = await getRFQ(id);
  if (!state) return NextResponse.json({ error: message }, { status: 404 });
  if (state.rfq.status === "READY_TO_RECOMMEND") return NextResponse.json({ ...state, agentMode: "complete" });
  if (state.rfq.workflowStep >= 10) return NextResponse.json({ error: message }, { status: 422 });
  if (!state.audit.some((event) => event.action === "AI reasoning temporarily unavailable")) {
    await appendAudit(id, { id: randomUUID(), actor: "SYSTEM", action: "AI reasoning temporarily unavailable", reason: "The agent provider did not complete a tool call. Continuing with the same bounded, structured merchant workflow.", time: "Now", tone: "warning" });
  }
  const fallback = await advanceRFQ(id, state.rfq.workflowStep + 1);
  return NextResponse.json({ ...fallback, agentMode: "deterministic_fallback", warning: message });
}

export async function POST(_: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const current = await getRFQ(id);
  if (current?.audit.some((event) => event.action === "AI reasoning temporarily unavailable")) return fallbackStep(id, "Agent provider remains unavailable");
  try {
    const result = await runProcurementAgentStep(id);
    return NextResponse.json({ ...result.state, agentMode: result.provider });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Agent step failed";
    return fallbackStep(id, message);
  }
}
