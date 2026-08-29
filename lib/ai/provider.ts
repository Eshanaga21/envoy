import OpenAI from "openai";
import { loadEnvConfig } from "@next/env";

// API routes can also run outside the `next dev` bootstrap (for example in a
// locally restarted worker), so explicitly load the project's server env.
loadEnvConfig(process.cwd(), process.env.NODE_ENV !== "production", console, true);

function configuredApiKey() {
  // Bracket access intentionally keeps this server-only value dynamic in Next's
  // development bundler, so a restarted dev server picks up `.env.local`.
  return process.env["OPENAI_API_KEY"]?.trim();
}

function configuredModel() {
  return process.env["OPENAI_MODEL"]?.trim() || "gpt-5.6-luna";
}

function clientForRequest() {
  const apiKey = configuredApiKey();
  return apiKey ? new OpenAI({ apiKey }) : null;
}

export type AIProviderError = "AI_RATE_LIMITED" | "AI_PROVIDER_ERROR" | "AI_INVALID_OUTPUT";

async function retry<T>(work: () => Promise<T>): Promise<T> {
  let failure: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try { return await work(); } catch (error) {
      failure = error;
      const status = typeof error === "object" && error !== null && "status" in error ? Number((error as { status?: number }).status) : 0;
      if (attempt === 2 || (status && status !== 429 && status < 500)) break;
      await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
    }
  }
  const status = typeof failure === "object" && failure !== null && "status" in failure ? Number((failure as { status?: number }).status) : 0;
  throw new Error(status === 429 ? "AI_RATE_LIMITED" : "AI_PROVIDER_ERROR");
}

export const aiProvider = {
  configured: () => Boolean(configuredApiKey()),
  async generateText(instructions: string, input: string) {
    const client = clientForRequest();
    if (!client) throw new Error("AI_PROVIDER_ERROR");
    const response = await retry(() => client.responses.create({ model: configuredModel(), instructions, input, max_output_tokens: 400 }));
    return response.output_text.trim();
  },
  async generateStructured<T>(instructions: string, input: string, name: string, schema: Record<string, unknown>, strict = true): Promise<T> {
    const client = clientForRequest();
    if (!client) throw new Error("AI_PROVIDER_ERROR");
    const response = await retry(() => client.responses.create({ model: configuredModel(), instructions, input, max_output_tokens: 700, text: { format: { type: "json_schema", name, strict, schema } } } as any));
    try { return JSON.parse(response.output_text) as T; } catch { throw new Error("AI_INVALID_OUTPUT"); }
  },
  async generateProductImage(prompt: string) {
    const client = clientForRequest();
    if (!client) throw new Error("AI_PROVIDER_NOT_CONFIGURED");
    const response = await retry(() => client.images.generate({
      model: process.env["OPENAI_IMAGE_MODEL"]?.trim() || "gpt-image-1",
      prompt,
      size: "1024x1024",
      quality: "low",
    } as any));
    const image = response.data?.[0];
    if (image?.b64_json) return `data:image/png;base64,${image.b64_json}`;
    if (image?.url) return image.url;
    throw new Error("AI_INVALID_OUTPUT");
  },
};
