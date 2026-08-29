import { NextResponse } from "next/server";
import { z } from "zod";
import { confirmMerchantVerification, getMerchantVerification } from "@/lib/db";

export async function GET(_: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const result = await getMerchantVerification(token);
  return result ? NextResponse.json(result) : NextResponse.json({ error: "Verification link not found." }, { status: 404 });
}

export async function POST(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const parsed = z.object({ action: z.enum(["confirm", "edit"]) }).safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose confirm or edit." }, { status: 400 });
  try {
    const { token } = await params;
    return NextResponse.json(await confirmMerchantVerification(token, parsed.data.action));
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not update verification" }, { status: 404 });
  }
}
