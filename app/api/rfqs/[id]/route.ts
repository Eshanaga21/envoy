import { NextResponse } from "next/server";
import { z } from "zod";
import { getRFQ, updateRFQRequirement } from "@/lib/db";
import { getClarificationQuestions } from "@/lib/rfq-clarifications";

const requirementSchema = z.object({
  category: z.string().min(2).max(80),
  productDescription: z.string().min(2).max(500),
  specifications: z.array(z.string().min(1).max(180)).max(12).default([]),
  capacityMin: z.number().positive().optional(),
  capacityMax: z.number().positive().optional(),
  preferredBrands: z.array(z.string().min(1).max(80)).max(8),
  maxBudget: z.number().int().positive(),
  deliveryCity: z.string().min(2).max(120),
  deliveryBy: z.string().max(120).optional(),
  exchange: z
    .object({
      enabled: z.boolean(),
      brand: z.string().optional(),
      capacity: z.number().optional(),
      ageYears: z.number().optional(),
      condition: z.string().optional(),
    })
    .optional(),
  hardConstraints: z.array(z.string().min(1).max(180)).min(1).max(12),
  preferences: z
    .array(
      z.object({
        criterion: z.string().min(1).max(80),
        priority: z.number().min(0).max(100),
      }),
    )
    .min(1)
    .max(6),
  rfqGuardrails: z
    .object({
      maxMerchants: z.number().int().min(1).max(5),
      retriesPerMerchant: z.number().int().min(0).max(1),
      maxFollowUps: z.number().int().min(0).max(3),
    })
    .optional(),
});

export async function GET(
  _: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const state = await getRFQ(id);
  return state
    ? NextResponse.json(state)
    : NextResponse.json({ error: "RFQ not found" }, { status: 404 });
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const parsed = requirementSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json(
      { error: "A complete RFQ requirement is required." },
      { status: 400 },
    );
  const clarificationQuestions = getClarificationQuestions(
    parsed.data,
    `${parsed.data.productDescription}\n${parsed.data.hardConstraints.join("\n")}`,
  );
  if (clarificationQuestions.length)
    return NextResponse.json(
      {
        error: "Complete the essential RFQ details before saving guardrails.",
        clarificationQuestions,
      },
      { status: 422 },
    );
  try {
    const { id } = await params;
    const state = await updateRFQRequirement(id, parsed.data);
    return NextResponse.json(state);
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : "Could not update RFQ guardrails.";
    return NextResponse.json(
      {
        error:
          message === "RFQ_ALREADY_SENT"
            ? "Guardrails can no longer be edited after merchant outreach begins."
            : message,
      },
      { status: message === "RFQ_NOT_FOUND" ? 404 : 409 },
    );
  }
}
