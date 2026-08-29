import { NextResponse } from "next/server";
import { z } from "zod";
import { advanceRFQ } from "@/lib/db";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = z.object({ step: z.number().int().min(1).max(10) }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Invalid workflow step" }, { status: 400 });
  try { const { id } = await params; return NextResponse.json(await advanceRFQ(id, parsed.data.step)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not advance RFQ" }, { status: 409 }); }
}
