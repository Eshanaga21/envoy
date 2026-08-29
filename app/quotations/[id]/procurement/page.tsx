import { QuoteAIApp } from "@/components/quote-ai-app";

export default async function ProcurementPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <QuoteAIApp initialRFQId={id} initialView="procurement" />;
}
