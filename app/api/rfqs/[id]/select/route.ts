import { NextResponse } from "next/server";
import { z } from "zod";
import { selectOffer } from "@/lib/db";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const parsed = z.object({ quoteId: z.string().min(1) }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "An eligible quote is required." }, { status: 400 });
  try { const { id } = await params; return NextResponse.json(await selectOffer(id, parsed.data.quoteId)); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Could not select offer" }, { status: 409 }); }
}
