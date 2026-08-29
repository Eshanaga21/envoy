import { NextResponse } from "next/server";
import { z } from "zod";
import { createRFQ, listRFQs } from "@/lib/db";
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
  hardConstraints: z.array(z.string()).min(1),
  preferences: z
    .array(z.object({ criterion: z.string(), priority: z.number() }))
    .min(1),
  rfqGuardrails: z
    .object({
      maxMerchants: z.number().int().min(1).max(5),
      retriesPerMerchant: z.number().int().min(0).max(1),
      maxFollowUps: z.number().int().min(0).max(3),
    })
    .optional(),
});

const createSchema = requirementSchema.extend({
  originalPrompt: z.string().min(8).max(1200).optional(),
  summaryTitle: z.string().min(2).max(120).optional(),
});

export async function GET() {
  try {
    return NextResponse.json(await listRFQs());
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Could not load saved RFQs." },
      { status: 500 },
    );
  }
}

export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json());
  if (!parsed.success)
    return NextResponse.json(
      { error: "A complete RFQ requirement is required." },
      { status: 400 },
    );
  // Keep the buyer's original text available to the clarification guard. In
  // particular, answers appended by the clarification screen (for example
  // `Product scope: ergonomic office chairs`) must not be lost after AI
  // extraction turns them into structured fields.
  const clarificationQuestions = getClarificationQuestions(
    parsed.data,
    parsed.data.originalPrompt ?? `${parsed.data.productDescription}\n${parsed.data.hardConstraints.join("\n")}`,
  );
  if (clarificationQuestions.length)
    return NextResponse.json(
      {
        error:
          "The buyer needs to clarify essential RFQ details before merchant outreach.",
        clarificationQuestions,
      },
      { status: 422 },
    );
  const { originalPrompt, summaryTitle, ...requirement } = parsed.data;
  return NextResponse.json(await createRFQ(requirement, { originalPrompt, summaryTitle }), { status: 201 });
}
