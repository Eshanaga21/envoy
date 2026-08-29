"use client";

import { useEffect, useMemo, useState } from "react";
import { Bot, CheckCircle2, Download, FileQuestion, ImageDown, LoaderCircle, MessageCircleMore, PhoneCall, ShieldCheck, Sparkles } from "lucide-react";
import { productLabel } from "@/lib/quote-factory";
import type { MerchantCall, ProductKnowledge, Quote, QuoteVersion } from "@/lib/types";

const price = (amount: number) => new Intl.NumberFormat("en-IN", { style: "currency", currency: "INR", maximumFractionDigits: 0 }).format(amount);
const safe = (value: string) => value.replace(/[<>&"]/g, (character) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "\"": "&quot;" })[character] ?? character);

function posterSvg(quote: Quote, merchantName: string) {
  const title = productLabel(quote.product);
  const delivery = quote.deliveryDate ?? "Delivery to confirm";
  const warranty = quote.warranty ?? "Warranty to confirm";
  const simulated = quote.source === "SIMULATED";
  const banner = simulated ? "ENVOY DEMO OFFER" : "ENVOY VERIFIED OFFER";
  const status = simulated ? "SIMULATED OFFER" : quote.merchantConfirmed ? "MERCHANT CONFIRMED" : "AWAITING CONFIRMATION";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350"><defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#1d4ed8"/><stop offset="1" stop-color="#0f172a"/></linearGradient></defs><rect width="1080" height="1350" fill="url(#g)"/><circle cx="900" cy="170" r="240" fill="#60a5fa" opacity=".22"/><text x="86" y="110" fill="#bfdbfe" font-family="Arial" font-size="28" font-weight="700" letter-spacing="4">${banner}</text><text x="86" y="245" fill="white" font-family="Arial" font-size="68" font-weight="700">${safe(title).slice(0, 42)}</text><text x="86" y="340" fill="#cbd5e1" font-family="Arial" font-size="36">${safe(merchantName)}</text><rect x="86" y="430" width="908" height="310" rx="34" fill="white"/><text x="140" y="510" fill="#64748b" font-family="Arial" font-size="28" font-weight="700">FINAL PAYABLE</text><text x="140" y="635" fill="#0f172a" font-family="Arial" font-size="102" font-weight="700">${price(quote.effectivePrice)}</text><text x="140" y="695" fill="#64748b" font-family="Arial" font-size="28">Base ${price(quote.basePrice)} · Exchange ${price(quote.exchangeValue)}</text><text x="106" y="855" fill="white" font-family="Arial" font-size="36">✓ ${safe(delivery)}</text><text x="106" y="935" fill="white" font-family="Arial" font-size="36">✓ ${quote.installationIncluded ? "Installation included" : "Installation to confirm"}</text><text x="106" y="1015" fill="white" font-family="Arial" font-size="36">✓ ${safe(warranty).slice(0, 48)}</text><rect x="86" y="1130" width="440" height="74" rx="37" fill="#34d399"/><text x="126" y="1178" fill="#052e1b" font-family="Arial" font-size="26" font-weight="700">${status}</text><text x="86" y="1280" fill="#94a3b8" font-family="Arial" font-size="24">Built from structured merchant facts · ${simulated ? "Simulation" : "Voice / verification"}</text></svg>`;
}

export function ProductKnowledgePanel({ rfqId, quote, merchantName, versions, calls }: { rfqId: string; quote: Quote; merchantName: string; versions: QuoteVersion[]; calls: MerchantCall[] }) {
  const [knowledge, setKnowledge] = useState<ProductKnowledge | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState("");
  const quoteVersions = useMemo(() => versions.filter((version) => version.quoteId === quote.id).sort((a, b) => a.version - b.version), [versions, quote.id]);
  const call = useMemo(() => calls.filter((item) => item.merchantId === quote.merchantId).at(-1), [calls, quote.merchantId]);
  async function load() {
    const response = await fetch(`/api/rfqs/${rfqId}/knowledge?merchantId=${quote.merchantId}`);
    const result = await response.json(); if (response.ok) setKnowledge(result.knowledge?.[0] ?? null);
  }
  useEffect(() => { void load(); }, [rfqId, quote.merchantId]);
  async function askMerchant() {
    if (!question.trim()) return;
    setAsking(true); setNotice("");
    try {
      const response = await fetch(`/api/rfqs/${rfqId}/knowledge`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ merchantId: quote.merchantId, question, channel: "WHATSAPP" }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setNotice(result.status === "UNKNOWN" ? "I haven’t verified that with this merchant yet. The question is recorded as unknown." : "Merchant answer added to reusable product knowledge."); setQuestion(""); await load();
    } catch (error) { setNotice(error instanceof Error ? error.message : "Could not ask merchant."); }
    finally { setAsking(false); }
  }
  function downloadPoster() {
    const blob = new Blob([posterSvg(quote, merchantName)], { type: "image/svg+xml" }); const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = `${merchantName.toLowerCase().replaceAll(" ", "-")}-offer.svg`; link.click(); URL.revokeObjectURL(url);
  }
  return <section className="rounded-[24px] border border-slate-200 bg-white p-5 shadow-sm"><div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start"><div><span className="inline-flex items-center gap-1 rounded-full bg-violet-50 px-2.5 py-1 text-[10px] font-extrabold uppercase tracking-wider text-violet-700"><Sparkles size={11} /> Product profile created from merchant conversation</span><h2 className="mt-3 text-xl font-extrabold text-slate-900">{productLabel(quote.product)}</h2><p className="mt-1 text-sm text-slate-500">{merchantName} · <span className={quote.merchantConfirmed ? "font-bold text-emerald-700" : "font-medium text-amber-700"}>{quote.merchantConfirmed ? "Merchant confirmed" : quote.source === "SIMULATED" ? "Simulated merchant result" : "Awaiting merchant confirmation"}</span></p></div><button onClick={downloadPoster} className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"><Download size={14} /> Download poster</button></div><div className="mt-5 grid gap-4 lg:grid-cols-[.8fr_1.2fr]"><div className="overflow-hidden rounded-2xl bg-gradient-to-br from-blue-700 to-slate-950 p-5 text-white"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-blue-200">WhatsApp poster</p><p className="mt-3 text-lg font-extrabold">{productLabel(quote.product)}</p><p className="mt-5 text-3xl font-extrabold">{price(quote.effectivePrice)}</p><p className="mt-1 text-xs text-slate-300">Expected final payable</p><div className="mt-5 space-y-2 text-xs font-semibold text-blue-50"><p>✓ {quote.deliveryDate ?? "Delivery pending"}</p><p>✓ {quote.installationIncluded ? "Installation included" : "Installation to confirm"}</p><p>✓ {quote.warranty ?? "Warranty pending"}</p></div><span className="mt-5 inline-flex rounded-full bg-emerald-300 px-2.5 py-1 text-[10px] font-extrabold text-emerald-950">{quote.merchantConfirmed ? "MERCHANT CONFIRMED" : "SIMULATED OFFER"}</span></div><div><h3 className="text-sm font-extrabold text-slate-800">Verified product facts</h3><div className="mt-3 grid gap-2 sm:grid-cols-2">{knowledge?.facts.length ? knowledge.facts.map((fact) => <div key={fact.key} className="rounded-xl bg-slate-50 px-3 py-2.5"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{fact.key}</p><p className="mt-1 text-xs font-bold text-slate-700">{fact.value}</p><p className="mt-1 text-[10px] text-slate-400">{fact.merchantConfirmed ? "Merchant confirmed" : "Captured in simulation"} · {fact.ttl} TTL</p></div>) : <p className="text-xs text-slate-400">Knowledge is being created from this merchant conversation…</p>}</div>{quoteVersions.length > 1 && <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3"><p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700">Negotiation history</p><div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold text-emerald-900">{quoteVersions.map((version, index) => <span key={version.id}>{index ? "→" : ""} {price(version.values.effectivePrice)}</span>)}<span className="text-emerald-700">Agent secured {price(Math.max(0, quoteVersions[0].values.effectivePrice - quoteVersions.at(-1)!.values.effectivePrice))} improvement</span></div></div>}</div></div><div className="mt-5 border-t border-slate-100 pt-5"><div className="flex items-center justify-between gap-3"><div><h3 className="text-sm font-extrabold text-slate-800">Merchant Q&A</h3><p className="mt-1 text-xs text-slate-400">Only answers captured from the merchant/quote are shown. Unknown stays unknown.</p></div>{call && <span className="inline-flex items-center gap-1 text-[10px] font-bold text-slate-400"><PhoneCall size={12} /> {call.status === "MOCK_COMPLETED" ? "Mock call transcript" : "Voice call transcript"}</span>}</div><div className="mt-3 space-y-2">{knowledge?.qa.length ? knowledge.qa.map((item) => <div key={item.id} className={`rounded-xl border p-3 ${item.status === "UNKNOWN" ? "border-amber-100 bg-amber-50" : "border-slate-100 bg-slate-50"}`}><p className="flex items-center gap-1.5 text-xs font-bold text-slate-700"><FileQuestion size={13} className={item.status === "UNKNOWN" ? "text-amber-600" : "text-blue-600"} /> {item.question}</p><p className="mt-1.5 text-xs leading-5 text-slate-600">{item.answer}</p><p className="mt-1 text-[10px] font-bold text-slate-400">{item.status === "UNKNOWN" ? "Not verified" : item.merchantConfirmed ? "Merchant confirmed" : "Simulated merchant response"}</p></div>) : <p className="text-xs text-slate-400">No verified answers yet.</p>}</div><div className="mt-4 flex gap-2"><input value={question} onChange={(event) => setQuestion(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 text-xs outline-none ring-blue-200 focus:ring-2" placeholder="Does this need an external stabilizer?" /><button disabled={asking || !question.trim()} onClick={askMerchant} className="inline-flex shrink-0 items-center gap-1.5 rounded-xl bg-slate-900 px-3 py-2.5 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-60">{asking ? <LoaderCircle className="animate-spin" size={14} /> : <MessageCircleMore size={14} />} Ask merchant</button></div>{notice && <p className="mt-2 flex gap-1.5 text-xs leading-5 text-slate-500"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-600" />{notice}</p>}</div><div className="mt-5 flex items-center gap-2 rounded-xl bg-slate-50 px-3 py-2 text-[10px] font-semibold text-slate-500"><ImageDown size={13} /> Sales assets: product card and WhatsApp poster ready · product video remains experimental</div></section>;
}

const fallbackQuestions = [
  { question: "Does installation cost extra?", answer: "No. Installation is included." },
  { question: "When can it be delivered?", answer: "By 4th September" },
  { question: "What warranty is included?", answer: "Standard manufacturer or seller warranty · priority support" },
];

export function MerchantQAPanel({ rfqId, quote, merchantName }: { rfqId: string; quote: Quote; merchantName: string }) {
  const [knowledge, setKnowledge] = useState<ProductKnowledge | null>(null);
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [notice, setNotice] = useState("");

  async function load() {
    const response = await fetch(`/api/rfqs/${rfqId}/knowledge?merchantId=${quote.merchantId}`);
    const result = await response.json();
    if (response.ok) setKnowledge(result.knowledge?.[0] ?? null);
  }

  useEffect(() => { void load(); }, [rfqId, quote.merchantId]);

  async function askMerchant() {
    if (!question.trim()) return;
    setAsking(true);
    setNotice("");
    try {
      const response = await fetch(`/api/rfqs/${rfqId}/knowledge`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantId: quote.merchantId, question, channel: "WHATSAPP" }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setNotice(result.status === "UNKNOWN" ? "Unknown — this has not been verified with the merchant." : "Merchant answer captured.");
      setQuestion("");
      await load();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Could not ask merchant.");
    } finally {
      setAsking(false);
    }
  }

  const verifiedAnswers = knowledge?.qa.filter((item) => item.status !== "UNKNOWN") ?? [];
  const unansweredQuestions = knowledge?.qa.filter((item) => item.status === "UNKNOWN") ?? [];
  const hasLiveAnswers = verifiedAnswers.length > 0;
  return <section id="agent-chat" className="overflow-hidden rounded-[24px] border border-slate-200 bg-white shadow-sm">
    <div className="flex items-start justify-between gap-4 border-b border-slate-100 p-5">
      <div className="flex items-center gap-3"><span className="grid h-11 w-11 place-items-center rounded-xl bg-blue-50 text-blue-700"><Bot size={20} /></span><div><h2 className="text-base font-extrabold text-slate-800">Merchant Q&amp;A</h2><p className="mt-0.5 text-xs text-slate-400">Only answers captured from the merchant/quote are shown. Unknown stays unknown.</p></div></div>
      <span className="hidden items-center gap-1 text-[10px] font-bold text-slate-400 sm:inline-flex"><PhoneCall size={12} /> {hasLiveAnswers ? "Merchant transcript" : "Mock call transcript"}</span>
    </div>
    <div className="p-5">
      <div className="grid gap-3 md:grid-cols-3">
        {hasLiveAnswers ? verifiedAnswers.map((item) => <article key={item.id} className="rounded-xl border border-slate-100 bg-slate-50 p-3"><p className="flex items-center gap-1.5 text-xs font-extrabold text-slate-700"><FileQuestion size={13} className="text-blue-600" />{item.question}</p><p className="mt-2 text-xs leading-5 text-slate-600">{item.answer}</p><p className="mt-2 text-[10px] font-bold text-slate-400">{item.merchantConfirmed ? "Merchant confirmed" : "Simulated merchant response"}</p></article>) : fallbackQuestions.map((item) => <article key={item.question} className="rounded-xl border border-slate-100 bg-slate-50 p-3"><p className="flex items-center gap-1.5 text-xs font-extrabold text-slate-700"><FileQuestion size={13} className="text-blue-600" />{item.question}</p><p className="mt-2 text-xs leading-5 text-slate-600">{item.answer}</p><p className="mt-2 text-[10px] font-bold text-slate-400">Simulated merchant response</p></article>)}
      </div>
      {unansweredQuestions.length > 0 && <div className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2.5 text-xs text-amber-900"><b>Awaiting merchant confirmation:</b> {unansweredQuestions.map((item) => item.question).join(" · ")}. No answer is shown until the merchant confirms it.</div>}
      <div className="mt-5 flex flex-col gap-2 sm:flex-row"><input value={question} onChange={(event) => setQuestion(event.target.value)} className="min-w-0 flex-1 rounded-xl border border-slate-200 px-3 py-3 text-xs outline-none ring-blue-200 focus:ring-2" placeholder={`Ask ${merchantName} about the offer, delivery, warranty, or payment terms`} /><button disabled={asking || !question.trim()} onClick={askMerchant} className="inline-flex shrink-0 items-center justify-center gap-1.5 rounded-xl bg-slate-900 px-4 py-3 text-xs font-bold text-white hover:bg-slate-700 disabled:opacity-60">{asking ? <LoaderCircle className="animate-spin" size={14} /> : <MessageCircleMore size={14} />} Ask merchant</button></div>
      {notice && <p className="mt-2 flex gap-1.5 text-xs leading-5 text-slate-500"><ShieldCheck size={14} className="mt-0.5 shrink-0 text-emerald-600" />{notice}</p>}
    </div>
  </section>;
}
