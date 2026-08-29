import { NextResponse } from "next/server";
import { z } from "zod";
import { aiProvider } from "@/lib/ai/provider";

const inputSchema = z.object({
  title: z.string().min(2).max(240),
  specifications: z.array(z.string().min(1).max(180)).max(8).default([]),
});

const imageCache = new Map<string, string>();

export async function POST(request: Request) {
  const input = inputSchema.safeParse(await request.json());
  if (!input.success) return NextResponse.json({ error: "A product title is required." }, { status: 400 });
  if (!aiProvider.configured()) return NextResponse.json({ error: "Image generation is not configured." }, { status: 503 });

  const key = JSON.stringify(input.data);
  const cached = imageCache.get(key);
  if (cached) return NextResponse.json({ imageUrl: cached, cached: true });

  try {
    const imageUrl = await aiProvider.generateProductImage(
      `Use case: product-mockup. Create a premium B2B catalog product photograph for this procurement request: ${input.data.title}. Key specifications: ${input.data.specifications.join(", ") || "not specified"}. Show only the requested product on a clean, light-neutral studio background. No people, logos, labels, text, price tags, watermarks, or unrelated products.`,
    );
    imageCache.set(key, imageUrl);
    return NextResponse.json({ imageUrl, cached: false });
  } catch {
    return NextResponse.json({ error: "A product image could not be generated." }, { status: 502 });
  }
}
