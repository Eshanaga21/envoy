import { NextResponse } from "next/server";
import { z } from "zod";
import { askAgent } from "@/lib/db";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = z.object({ question: z.string().min(1).max(1000) }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "A question is required." }, { status: 400 });
  try { const { id } = await params; return NextResponse.json(await askAgent(id, parsed.data.question)); }
  catch { return NextResponse.json({ error: "RFQ not found" }, { status: 404 }); }
}
