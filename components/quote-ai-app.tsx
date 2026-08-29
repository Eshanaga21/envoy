"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Bot,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleAlert,
  Clock3,
  Copy,
  CreditCard,
  FileText,
  Headphones,
  Info,
  LoaderCircle,
  LockKeyhole,
  Mail,
  MessageCircleMore,
  Mic,
  PackageCheck,
  Menu,
  MoreVertical,
  Pencil,
  RotateCcw,
  Search,
  Send,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Store,
  TriangleAlert,
  X,
} from "lucide-react";
import { demoPrompt, demoRequirement, merchants } from "@/lib/demo-data";
import { merchantTrust, rankingBreakdown, recommendQuote, scoreQuote } from "@/lib/commerce";
import { productLabel } from "@/lib/quote-factory";
import { shareUrl } from "@/lib/outreach";
import { discoverMerchants } from "@/lib/merchant-discovery";
import { MerchantQAPanel } from "@/components/product-knowledge-panel";
import type {
  AgentStep,
  AuditEvent,
  BuyerRequirement,
  MerchantCall,
  MerchantConversation,
  MerchantId,
  Quote,
  QuoteVersion,
  RFQHistoryItem,
} from "@/lib/types";
import type { ClarificationQuestion } from "@/lib/rfq-clarifications";

type View =
  | "dashboard"
  | "home"
  | "clarify"
  | "confirm"
  | "contact"
  | "progress"
  | "offers"
  | "success"
  | "audit";
type ChatMessage = { from: "agent" | "buyer"; text: string };
const landingSampleRequest =
  "Need 40 black stackable plastic chairs delivered to Chennai by Saturday. Budget ₹200 per chair.";
type RFQState = {
  rfq: {
    id: string;
    status: string;
    workflowStep: number;
    buyerRequirement: BuyerRequirement;
    originalPrompt: string;
    summaryTitle: string;
    selectedQuoteId?: string | null;
  };
  quotes: Quote[];
  audit: AuditEvent[];
  messages: ChatMessage[];
  quoteVersions?: QuoteVersion[];
  calls?: MerchantCall[];
  conversations?: MerchantConversation[];
  merchantVerificationToken?: string;
  agentMode?: "openai" | "deterministic_fallback" | "complete";
};
type SpeechRecognitionLike = {
  lang: string;
  interimResults: boolean;
  continuous: boolean;
  start: () => void;
  stop: () => void;
  abort: () => void;
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>;
      }) => void)
    | null;
  onerror: ((event: { error: string }) => void) | null;
  onend: (() => void) | null;
};
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike;

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => {
      open: () => void;
      on: (event: string, cb: () => void) => void;
    };
    SpeechRecognition?: SpeechRecognitionConstructor;
    webkitSpeechRecognition?: SpeechRecognitionConstructor;
  }
}

const MAX_WORKFLOW_STEPS = 10;
const defaultGuardrails = {
  maxMerchants: 5,
  retriesPerMerchant: 1,
  maxFollowUps: 3,
};
const rupees = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});
const formatPrice = (amount: number) => rupees.format(amount);
const merchantById = (id: MerchantId) =>
  merchants.find((merchant) => merchant.id === id)!;
const quoteName = (quote?: Quote) => productLabel(quote?.product);

function Avatar({
  id,
  size = "normal",
}: {
  id: MerchantId;
  size?: "normal" | "small";
}) {
  const merchant = merchantById(id);
  return (
    <span
      className={`${size === "small" ? "h-7 w-7 text-[10px]" : "h-10 w-10 text-xs"} ${merchant.color} inline-flex shrink-0 items-center justify-center rounded-xl font-extrabold`}
    >
      {merchant.initials}
    </span>
  );
}

function Pill({
  children,
  tone = "slate",
}: {
  children: React.ReactNode;
  tone?: "slate" | "blue" | "green" | "amber" | "rose";
}) {
  const tones = {
    slate: "bg-slate-100 text-slate-600",
    blue: "bg-blue-50 text-blue-700",
    green: "bg-emerald-50 text-emerald-700",
    amber: "bg-amber-50 text-amber-700",
    rose: "bg-rose-50 text-rose-700",
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-bold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}

function ProgressDot({ kind }: { kind: AgentStep["kind"] }) {
  const classes = {
    send: "bg-blue-100 text-blue-600",
    reply: "bg-violet-100 text-violet-600",
    think: "bg-amber-100 text-amber-700",
    warn: "bg-rose-100 text-rose-600",
    success: "bg-emerald-100 text-emerald-600",
  };
  return (
    <span
      className={`mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${classes[kind]}`}
    >
      {kind === "success" ? (
        <Check size={14} />
      ) : kind === "warn" ? (
        <TriangleAlert size={13} />
      ) : kind === "think" ? (
        <Sparkles size={13} />
      ) : kind === "reply" ? (
        <MessageCircleMore size={13} />
      ) : (
        <Send size={12} />
      )}
    </span>
  );
}

export function QuoteAIApp({ initialRFQId, initialView }: { initialRFQId?: string; initialView?: "dashboard" | "procurement" } = {}) {
  const [view, setView] = useState<View>(initialView === "dashboard" ? "dashboard" : "home");
  const [prompt, setPrompt] = useState("");
  const [requirement, setRequirement] =
    useState<BuyerRequirement>(demoRequirement);
  const [rfqId, setRfqId] = useState<string | null>(null);
  const [originalPrompt, setOriginalPrompt] = useState("");
  const [summaryTitle, setSummaryTitle] = useState("");
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [quoteVersions, setQuoteVersions] = useState<QuoteVersion[]>([]);
  const [merchantCalls, setMerchantCalls] = useState<MerchantCall[]>([]);
  const [conversations, setConversations] = useState<MerchantConversation[]>(
    [],
  );
  const [merchantVerificationToken, setMerchantVerificationToken] = useState<
    string | null
  >(null);
  const [verificationLinkCopied, setVerificationLinkCopied] = useState(false);
  const [voiceReady, setVoiceReady] = useState(false);
  const [parsing, setParsing] = useState(false);
  const [parseNotice, setParseNotice] = useState<string | null>(null);
  const [clarificationQuestions, setClarificationQuestions] = useState<
    ClarificationQuestion[]
  >([]);
  const [clarificationPrompt, setClarificationPrompt] = useState("");
  const [showGuardrailEditor, setShowGuardrailEditor] = useState(false);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const [listening, setListening] = useState(false);
  const [visibleSteps, setVisibleSteps] = useState(0);
  const [running, setRunning] = useState(false);
  const [audit, setAudit] = useState<AuditEvent[]>([]);
  const [showApproval, setShowApproval] = useState(false);
  const [paymentState, setPaymentState] = useState<
    "idle" | "loading" | "unavailable" | "failed"
  >("idle");
  const [paymentId, setPaymentId] = useState("");
  const [agentMode, setAgentMode] = useState<
    "openai" | "deterministic_fallback" | "complete"
  >("openai");
  const timers = useRef<ReturnType<typeof setTimeout>[]>([]);
  const recognition = useRef<SpeechRecognitionLike | null>(null);
  const parseRequest = useRef<AbortController | null>(null);
  const recommended = useMemo(
    () =>
      quotes.length ? (recommendQuote(quotes, requirement) ?? null) : null,
    [quotes, requirement],
  );

  useEffect(
    () => () => {
      timers.current.forEach(clearTimeout);
      recognition.current?.abort();
    },
    [],
  );

  function hydrate(state: RFQState) {
    setRfqId(state.rfq.id);
    setRequirement(state.rfq.buyerRequirement);
    setOriginalPrompt(state.rfq.originalPrompt);
    setSummaryTitle(state.rfq.summaryTitle);
    setQuotes(state.quotes);
    setAudit(state.audit);
    setQuoteVersions(state.quoteVersions ?? []);
    setMerchantCalls(state.calls ?? []);
    setConversations(state.conversations ?? []);
    setMerchantVerificationToken(state.merchantVerificationToken ?? null);
    setVerificationLinkCopied(false);
    setVisibleSteps(state.rfq.workflowStep);
    if (state.agentMode) setAgentMode(state.agentMode);
  }

  async function resumeRFQ(id: string) {
    const response = await fetch(`/api/rfqs/${id}`);
    if (!response.ok) return;
    const state = (await response.json()) as RFQState;
    hydrate(state);
    window.localStorage.setItem("quoteai-rfq-id", state.rfq.id);
    if (initialView === "procurement") setView("progress");
    else if (state.rfq.status === "PURCHASED") setView("success");
    else if (state.rfq.workflowStep >= MAX_WORKFLOW_STEPS) setView("offers");
    else if (state.rfq.workflowStep > 0) setView("progress");
    else setView("confirm");
  }

  useEffect(() => {
    if (initialRFQId) void resumeRFQ(initialRFQId);
  }, [initialRFQId, initialView]);

  useEffect(() => {
    fetch("/api/voice/status")
      .then((response) => (response.ok ? response.json() : null))
      .then((status) => setVoiceReady(Boolean(status?.configured)))
      .catch(() => undefined);
  }, []);

  function captureVoice() {
    setVoiceNotice(null);
    if (listening) {
      recognition.current?.stop();
      return;
    }
    const Recognition =
      window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!Recognition) {
      setVoiceNotice(
        "Voice input is not supported by this browser. You can still type your request.",
      );
      return;
    }
    const instance = new Recognition();
    recognition.current = instance;
    instance.lang = "en-IN";
    instance.interimResults = false;
    instance.continuous = false;
    instance.onresult = (event) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0]?.transcript ?? "")
        .join(" ")
        .trim();
      if (transcript)
        setPrompt((current) =>
          current === demoPrompt || current === landingSampleRequest
            ? transcript
            : `${current.trim()} ${transcript}`.trim(),
        );
    };
    instance.onerror = (event) =>
      setVoiceNotice(
        event.error === "not-allowed"
          ? "Microphone permission was not granted."
          : "I could not transcribe that audio. Please try again.",
      );
    instance.onend = () => setListening(false);
    setListening(true);
    instance.start();
  }

  async function understandIntent(requestText = prompt) {
    parseRequest.current?.abort();
    const controller = new AbortController();
    parseRequest.current = controller;
    const timeout = window.setTimeout(() => controller.abort(), 15_000);
    setParsing(true);
    setParseNotice(null);
    try {
      const response = await fetch("/api/agent/parse-requirement", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: requestText }),
        signal: controller.signal,
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      setRequirement(data.requirement);
      if (data.source === "deterministic_fallback")
        setParseNotice(
          data.warning ||
            "AI is temporarily unavailable. I extracted only the constraints stated in your request.",
        );
      if (data.clarificationQuestions?.length) {
        setClarificationQuestions(data.clarificationQuestions);
        setClarificationPrompt(requestText);
        setView("clarify");
        return;
      }
      const created = await fetch("/api/rfqs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...data.requirement,
          originalPrompt: requestText,
          summaryTitle: data.summaryTitle,
        }),
      });
      const state = await created.json();
      if (!created.ok && state.clarificationQuestions?.length) {
        setClarificationQuestions(state.clarificationQuestions);
        setClarificationPrompt(requestText);
        setView("clarify");
        return;
      }
      if (!created.ok) throw new Error(state.error);
      hydrate(state);
      window.localStorage.setItem("quoteai-rfq-id", state.rfq.id);
      setView("confirm");
    } catch (error) {
      const detail =
        error instanceof Error ? error.message : "Unknown connection error";
      setParseNotice(
        controller.signal.aborted
          ? "The request took too long. Please try again."
          : /fetch|network/i.test(detail)
          ? "This page cannot reach the Envoy API. Open http://localhost:3000 (not an older preview port) and try again."
          : `Could not start this quotation request: ${detail}`,
      );
    } finally {
      window.clearTimeout(timeout);
      if (parseRequest.current === controller) {
        parseRequest.current = null;
        setParsing(false);
      }
    }
  }

  function goHome() {
    parseRequest.current?.abort();
    parseRequest.current = null;
    setParsing(false);
    setView("home");
  }

  function submitClarifications(answers: Record<string, string>) {
    const additions = clarificationQuestions
      .map((question) => {
        const answer = answers[question.id]?.trim() ?? "";
        if (question.id === "budget") return `Budget ₹${answer}`;
        if (question.id === "budget_inclusion") {
          const unit = clarificationPrompt.match(/(?:₹|rs\.?|inr)\s*([0-9][0-9,]*)\s*(?:per|\/)\s*(?:chair|unit|piece)/i)?.[1]?.replaceAll(",", "");
          const quantity = clarificationPrompt.match(/\b(\d{1,5})\b(?=[^\n]{0,60}\b(?:chairs?|units?|pieces?)\b)/i)?.[1];
          const total = unit && quantity ? Number(unit) * Number(quantity) : undefined;
          return `Budget treatment: ${answer}.${total ? ` Total budget ₹${total.toLocaleString("en-IN")}.` : ""}`;
        }
        if (question.id === "delivery_city") return `Delivery to ${answer}`;
        return `Product scope: ${answer}`;
      })
      .join("\n");
    const completedPrompt =
      `${clarificationPrompt}\n\nAdditional quotation details:\n${additions}`.trim();
    setPrompt(completedPrompt);
    void understandIntent(completedPrompt);
  }

  function runProcurement() {
    if (!rfqId) return;
    window.history.pushState({}, "", `/quotations/${rfqId}/procurement`);
    setView("progress");
    setRunning(true);
    setVisibleSteps(0);
    if (voiceReady) {
      void Promise.all(
        ["electrohub", "city"].map(async (merchantId) => {
          const response = await fetch(`/api/rfqs/${rfqId}/voice-call`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              merchantId,
              objective:
                "Gather a commercially complete quotation. Confirm price, delivery, warranty, installation, and payment terms without revealing competing merchants or prices.",
            }),
          });
          return response.ok
            ? ((await response.json()).call as MerchantCall)
            : null;
        }),
      )
        .then((calls) =>
          setMerchantCalls((current) => [
            ...current,
            ...calls.filter((call): call is MerchantCall => Boolean(call)),
          ]),
        )
        .catch(() => undefined);
    }
    const advance = (turn: number) => {
      const timer = setTimeout(async () => {
        try {
          const response = await fetch(`/api/rfqs/${rfqId}/agent-step`, {
            method: "POST",
          });
          const state = await response.json();
          if (!response.ok) throw new Error(state.error);
          hydrate(state);
          if (
            state.rfq.status !== "READY_TO_RECOMMEND" &&
            turn < MAX_WORKFLOW_STEPS + 1
          )
            advance(turn + 1);
          else setRunning(false);
        } catch {
          setRunning(false);
          setParseNotice(
            "The procurement workflow paused. You can refresh and continue this saved quotation request.",
          );
        }
      }, 650);
      timers.current.push(timer);
    };
    advance(0);
  }

  function resetDemo() {
    timers.current.forEach(clearTimeout);
    timers.current = [];
    recognition.current?.abort();
    window.localStorage.removeItem("quoteai-rfq-id");
    setView("home");
    setPrompt("");
    setRequirement(demoRequirement);
    setRfqId(null);
    setOriginalPrompt("");
    setSummaryTitle("");
    setQuotes([]);
    setQuoteVersions([]);
    setMerchantCalls([]);
    setConversations([]);
    setMerchantVerificationToken(null);
    setVerificationLinkCopied(false);
    setClarificationQuestions([]);
    setClarificationPrompt("");
    setShowGuardrailEditor(false);
    setVisibleSteps(0);
    setRunning(false);
    setAudit([]);
    setShowApproval(false);
    setPaymentState("idle");
    setPaymentId("");
    setAgentMode("openai");
    setVoiceNotice(null);
  }

  function loadRazorpayScript() {
    return new Promise<boolean>((resolve) => {
      if (window.Razorpay) return resolve(true);
      const script = document.createElement("script");
      script.src = "https://checkout.razorpay.com/v1/checkout.js";
      script.onload = () => resolve(true);
      script.onerror = () => resolve(false);
      document.body.appendChild(script);
    });
  }

  async function beginPayment() {
    if (!rfqId || !recommended) return;
    setPaymentState("loading");
    try {
      const response = await fetch("/api/payments/create-order", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rfqId, buyerApproved: true }),
      });
      const data = await response.json();
      if (!response.ok) {
        setPaymentState(
          data.code === "RAZORPAY_NOT_CONFIGURED" ? "unavailable" : "failed",
        );
        return;
      }
      const loaded = await loadRazorpayScript();
      if (!loaded || !window.Razorpay) {
        setPaymentState("failed");
        return;
      }
      const checkout = new window.Razorpay({
        key: data.keyId,
        amount: data.order.amount,
        currency: "INR",
        name: "Envoy",
        description: `${quoteName(recommended)} · ${merchantById(recommended.merchantId).name}`,
        order_id: data.order.id,
        handler: async (result: Record<string, string>) => {
          const verification = await fetch("/api/payments/verify", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ ...result, rfqId }),
          });
          const verified = await verification.json();
          if (verified.verified)
            await completePurchase(result.razorpay_payment_id);
          else setPaymentState("failed");
        },
        modal: { ondismiss: () => setPaymentState("idle") },
        theme: { color: "#315bd6" },
      });
      checkout.on("payment.failed", () => setPaymentState("failed"));
      checkout.open();
      setPaymentState("idle");
    } catch {
      setPaymentState("failed");
    }
  }

  async function completePurchase(id: string) {
    setPaymentId(id);
    setShowApproval(false);
    setPaymentState("idle");
    if (rfqId) {
      const response = await fetch(`/api/rfqs/${rfqId}`);
      if (response.ok) hydrate(await response.json());
    }
    setView("success");
  }

  async function copyMerchantVerificationLink() {
    if (!merchantVerificationToken) return;
    const url = `${window.location.origin}/merchant/verify/${merchantVerificationToken}`;
    try {
      await navigator.clipboard?.writeText(url);
      setVerificationLinkCopied(true);
    } catch {
      window.prompt("Copy this secure merchant verification link", url);
    }
  }

  return (
    <main className="min-h-screen bg-[#f6f9fd] pb-8">
      <header className="mx-auto flex max-w-7xl items-center justify-between border-b border-[#dfe8f5] px-5 py-3.5 lg:px-8">
        <button
          onClick={() =>
            view !== "home" && (view === "audit" ? setView("success") : goHome())
          }
          className="flex items-center gap-2.5 text-left"
        >
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-[#2b84ea] text-white shadow-lg shadow-blue-200">
            <Sparkles size={19} />
          </span>
          <span>
            <span className="block text-[17px] font-extrabold tracking-tight text-slate-900">
              Envoy
            </span>
            <span className="block text-[10px] font-bold uppercase tracking-[.16em] text-slate-400">
              Universal buyer agent
            </span>
          </span>
        </button>
        <div className="flex items-center gap-3">
          {view === "home" ? (
            <button
              onClick={() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth", block: "center" })}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#eaf4ff] px-2.5 py-1 text-xs font-bold text-[#1f6fc4] hover:bg-[#dceeff]"
            >
              <Info size={12} /> How it works
            </button>
          ) : view === "dashboard" || view === "offers" ? (
            <button
              onClick={() => setView("home")}
              className="inline-flex items-center gap-1.5 rounded-full bg-[#eaf4ff] px-2.5 py-1 text-xs font-bold text-[#1f6fc4] hover:bg-[#dceeff]"
            >
              <Info size={12} /> How it works
            </button>
          ) : (
            <Pill tone="blue">
              <ShieldCheck size={12} /> Bounded & gated
            </Pill>
          )}
          <button
            onClick={() => window.location.assign("/quotes")}
            className="hidden items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 sm:flex"
          >
            <FileText size={13} /> Quotes
          </button>
          <button
            onClick={resetDemo}
            className="hidden items-center gap-1.5 rounded-lg px-2.5 py-2 text-xs font-bold text-slate-500 hover:bg-slate-100 sm:flex"
          >
            <RotateCcw size={13} /> Reset
          </button>
        </div>
      </header>
      {view === "dashboard" && (
        <RFQHistoryDashboard
          createQuote={() => window.location.assign("/")}
          openRFQ={(id) => window.location.assign(`/quotations/${id}`)}
        />
      )}
      {view === "home" && (
        <Home
          prompt={prompt}
          setPrompt={setPrompt}
          parsing={parsing}
          understandIntent={understandIntent}
          captureVoice={captureVoice}
          listening={listening}
          voiceNotice={voiceNotice}
          notice={parseNotice}
        />
      )}
      {view === "clarify" && (
        <ClarificationView
          questions={clarificationQuestions}
          originalPrompt={clarificationPrompt}
          parsing={parsing}
          back={() => setView("home")}
          submit={submitClarifications}
        />
      )}
      {view === "confirm" && (
        <RequirementConfirm
          requirement={requirement}
          originalPrompt={originalPrompt}
          summaryTitle={summaryTitle}
          notice={parseNotice}
          back={() => setView("home")}
          proceed={runProcurement}
        />
      )}
      {view === "contact" && (
        <MerchantContactApproval
          requirement={requirement}
          voiceReady={voiceReady}
          back={() => setView("confirm")}
          start={runProcurement}
        />
      )}
      {view === "progress" && (
        <DashboardView
          requirement={requirement}
          agentMode={agentMode}
          audit={audit}
          quotes={quotes}
          conversations={conversations}
          rfqId={rfqId}
          hydrate={hydrate}
          visibleSteps={visibleSteps}
          running={running}
          originalPrompt={originalPrompt}
          summaryTitle={summaryTitle}
          backToDashboard={() => setView("dashboard")}
          finish={() => setView("offers")}
        />
      )}
      {view === "offers" && recommended && (
        <OffersView
          requirement={requirement}
          quotes={quotes}
          recommended={recommended}
          rfqId={rfqId}
          choose={async () => {
            if (!rfqId) return;
            const response = await fetch(`/api/rfqs/${rfqId}/select`, {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ quoteId: recommended.id }),
            });
            if (response.ok) {
              hydrate(await response.json());
              setShowApproval(true);
            }
          }}
        />
      )}
      {view === "offers" && merchantVerificationToken && (
        <div className="mx-auto mt-4 max-w-7xl px-5 lg:px-8">
          <div className="flex flex-col justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50/60 p-4 sm:flex-row sm:items-center">
            <div>
              <p className="text-sm font-extrabold text-blue-950">
                Invite the merchant to verify these final terms
              </p>
              <p className="mt-1 text-xs leading-5 text-blue-800">
                The secure link lets the merchant confirm or request edits. It
                does not expose competing merchants or prices.
              </p>
            </div>
            <button
              onClick={copyMerchantVerificationLink}
              className="inline-flex shrink-0 items-center justify-center gap-2 rounded-xl bg-blue-700 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-800"
            >
              <Copy size={14} />{" "}
              {verificationLinkCopied
                ? "Verification link copied"
                : "Copy merchant link"}
            </button>
          </div>
        </div>
      )}
      {view === "success" && (
        <SuccessView
          paymentId={paymentId}
          quote={recommended}
          audit={() => setView("audit")}
          reset={resetDemo}
        />
      )}
      {view === "audit" && (
        <AuditView
          audit={audit}
          back={() => setView(paymentId ? "success" : "offers")}
        />
      )}
      {showApproval && recommended && (
        <ApprovalModal
          quote={recommended}
          requirement={requirement}
          paymentState={paymentState}
          close={() => {
            if (paymentState !== "loading") {
              setShowApproval(false);
              setPaymentState("idle");
            }
          }}
          pay={beginPayment}
        />
      )}
      {showGuardrailEditor && (
        <GuardrailsEditor
          requirement={requirement}
          close={() => setShowGuardrailEditor(false)}
          save={async (nextRequirement) => {
            if (!rfqId) {
              setRequirement(nextRequirement);
              setShowGuardrailEditor(false);
              return;
            }
            const response = await fetch(`/api/rfqs/${rfqId}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(nextRequirement),
            });
            const state = await response.json();
            if (!response.ok)
              throw new Error(
                state.error || "Could not save quotation guardrails.",
              );
            hydrate(state);
            setShowGuardrailEditor(false);
          }}
        />
      )}
    </main>
  );
}

type DashboardQuote = {
  id: string;
  customer: string;
  date: string;
  quantity: string;
  price: string;
  score: number;
  rank: number;
  status: "Approved invoice" | "Pending" | "Lost";
};

const dashboardQuotes: DashboardQuote[] = [
  {
    id: "7W8r7L7G",
    customer: "ACME corp",
    date: "18-10-25",
    quantity: "12,754",
    price: "₹103,010",
    score: 98,
    rank: 1,
    status: "Approved invoice",
  },
  {
    id: "KcWDO0mPW",
    customer: "ForgeTech",
    date: "14-10-25",
    quantity: "1,434",
    price: "₹41,035",
    score: 35,
    rank: 5,
    status: "Lost",
  },
  {
    id: "P0Qx9N2B",
    customer: "Northstar Labs",
    date: "12-10-25",
    quantity: "4,800",
    price: "₹86,420",
    score: 94,
    rank: 2,
    status: "Approved invoice",
  },
  {
    id: "M4Hj2R8Q",
    customer: "Blue Oak Retail",
    date: "08-10-25",
    quantity: "920",
    price: "₹29,034",
    score: 72,
    rank: 4,
    status: "Pending",
  },
  {
    id: "V6Tn5X1C",
    customer: "Kite Systems",
    date: "04-10-25",
    quantity: "2,106",
    price: "₹57,880",
    score: 89,
    rank: 3,
    status: "Approved invoice",
  },
];

type HistoryStage = "DRAFT" | "CONTACTING" | "NEGOTIATING" | "OFFERS_READY" | "PURCHASED";

function historyStatus(status: RFQHistoryItem["status"]): {
  stage: HistoryStage;
  label: string;
  tone: "slate" | "blue" | "green" | "amber";
} {
  if (status === "PURCHASED")
    return { stage: "PURCHASED", label: "Purchased", tone: "green" };
  if (["READY_TO_RECOMMEND", "AWAITING_PAYMENT_APPROVAL", "PAYMENT_PROCESSING"].includes(status))
    return { stage: "OFFERS_READY", label: "Offers ready", tone: "green" };
  if (["NEGOTIATING", "CLARIFYING_QUOTES", "BUYER_SELECTED", "FINAL_TERMS_CONFIRMED"].includes(status))
    return { stage: "NEGOTIATING", label: "Negotiating", tone: "blue" };
  if (["RFQ_SENT", "COLLECTING_QUOTES"].includes(status))
    return { stage: "CONTACTING", label: "Contacting merchants", tone: "blue" };
  return { stage: "DRAFT", label: "Draft", tone: "slate" };
}

function requestText(value: string) {
  return value
    .split(/additional quotation details\s*:/i)[0]
    .replace(/\s+/g, " ")
    .trim();
}

function requestCity(value: string) {
  const match = requestText(value).match(
    /\b(?:delivered?|delivery)\s+(?:to|in)\s+([a-z][a-z .-]*?)(?=\s+(?:by|before|on|with|under|budget)\b|[,.]|$)|\b(?:in|to)\s+([a-z][a-z .-]*?)(?=\s+(?:by|before|on|with|under|budget)\b|[,.]|$)/i,
  );
  const city = (match?.[1] || match?.[2] || "").trim();
  return city ? city.replace(/\b\w/g, (letter) => letter.toUpperCase()) : "";
}

function requestTitle(item: RFQHistoryItem) {
  const source = requestText(item.summaryTitle || item.originalPrompt);
  const prompt = requestText(item.originalPrompt);
  const city = requestCity(prompt) || requestCity(source);
  let title = source
    .replace(/^(?:need|want|looking for|procurement(?: request)?(?: for| of)?|buy)\s+/i, "")
    .replace(/\s+(?:delivered?|delivery)\s+(?:to|in)\s+.*$/i, "")
    .replace(/\s+(?:by|before|on)\s+[^,.]+$/i, "")
    .replace(/\s+(?:budget|under|up to)\s+₹?.*$/i, "")
    .replace(/\s+in\s+[a-z][a-z .-]*$/i, "")
    .trim();
  if (!title || /^(request|quotation)$/i.test(title)) title = "Procurement request";
  title = title.replace(/\b\w/g, (letter) => letter.toUpperCase());
  return city && !new RegExp(`\\bin\\s+${city}\\b`, "i").test(title)
    ? `${title} in ${city}`
    : title;
}

function requestMetadata(item: RFQHistoryItem) {
  const prompt = requestText(item.originalPrompt);
  const parts: string[] = [];
  const quantity = prompt.match(/\b([0-9][0-9,]*)\s*(?:units?|pieces?|chairs?|tables?|bottles?|shakers?|items?|kg|kgs)\b/i)?.[1];
  const city = requestCity(prompt);
  const deadline = prompt.match(/\b(?:by|before|needed by)\s+([^,.\n]+)/i)?.[1]?.trim();
  const budget = prompt.match(/(?:budget(?:\s+of)?|under|up to)\s*(₹\s*[0-9][0-9,]*(?:\s*(?:per|\/)\s*[a-z]+)?)/i)?.[1]?.replace(/\s+/g, " ");
  if (quantity) parts.push(`${quantity} units`);
  if (city) parts.push(city);
  if (deadline) parts.push(`Needed by ${deadline}`);
  if (budget) parts.push(`Budget ${budget}`);
  return parts;
}

function relativeUpdatedAt(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Recently";
  const difference = Date.now() - date.getTime();
  const minutes = Math.floor(difference / 60_000);
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  if (hours < 48) return "Yesterday";
  return new Intl.DateTimeFormat("en-IN", { month: "short", day: "numeric" }).format(date);
}

function historyProgress(stage: HistoryStage, offers: number) {
  const offerText = `${offers} complete ${offers === 1 ? "offer" : "offers"}`;
  if (stage === "DRAFT") return "Not started";
  if (stage === "CONTACTING") return offers ? `${offerText} received` : "Collecting merchant responses";
  if (stage === "NEGOTIATING") return offers ? `${offerText} · improving terms` : "Negotiating with merchants";
  if (stage === "OFFERS_READY") return offerText;
  return offers ? `Selected from ${offerText}` : "Purchase completed";
}

function historyOffer(stage: HistoryStage, price: number | null) {
  if (price !== null) return { value: formatPrice(price), detail: "Delivered price" };
  if (stage === "DRAFT") return { value: "Not started", detail: "Start outreach to collect offers" };
  if (stage === "CONTACTING") return { value: "Waiting for quotes", detail: "Merchants are being contacted" };
  return { value: "Still improving", detail: "No complete offer yet" };
}

function RFQHistoryDashboard({
  createQuote,
  openRFQ,
}: {
  createQuote: () => void;
  openRFQ: (id: string) => void;
}) {
  const [items, setItems] = useState<RFQHistoryItem[]>([]);
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState<"ALL" | "ACTIVE" | "OFFERS_READY" | "COMPLETED">("ALL");
  const [loading, setLoading] = useState(true);
  useEffect(() => {
    fetch("/api/rfqs")
      .then((response) => (response.ok ? response.json() : []))
      .then((data: RFQHistoryItem[]) => setItems(data))
      .catch(() => setItems([]))
      .finally(() => setLoading(false));
  }, []);
  const filtered = items
    .filter((item) => {
      const searchable = `${requestTitle(item)} ${requestMetadata(item).join(" ")} ${requestText(item.originalPrompt)}`.toLowerCase();
      const stage = historyStatus(item.status).stage;
      const matchesFilter =
        filter === "ALL" ||
        (filter === "ACTIVE" && ["CONTACTING", "NEGOTIATING"].includes(stage)) ||
        (filter === "OFFERS_READY" && stage === "OFFERS_READY") ||
        (filter === "COMPLETED" && stage === "PURCHASED");
      return searchable.includes(query.toLowerCase()) && matchesFilter;
    })
    .sort((first, second) => {
      const order: Record<HistoryStage, number> = { NEGOTIATING: 0, CONTACTING: 1, OFFERS_READY: 2, DRAFT: 3, PURCHASED: 4 };
      const stageDifference = order[historyStatus(first.status).stage] - order[historyStatus(second.status).stage];
      return stageDifference || new Date(second.updatedAt).getTime() - new Date(first.updatedAt).getTime();
    });
  return (
    <section className="mx-auto max-w-7xl px-5 pb-12 pt-7 lg:px-8">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            Your requests
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Track active procurement requests and revisit completed offers.
          </p>
        </div>
        <button
          onClick={createQuote}
          className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#315bd6] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-100 hover:bg-[#294fbe]"
        >
          <Sparkles size={16} /> New request
        </button>
      </div>
      <div className="mt-7 overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-col gap-4 border-b border-slate-100 p-4">
          <div className="flex gap-1 overflow-x-auto" role="tablist" aria-label="Request filters">
            {[
              ["ALL", "All"],
              ["ACTIVE", "Active"],
              ["OFFERS_READY", "Offers ready"],
              ["COMPLETED", "Completed"],
            ].map(([value, label]) => (
              <button
                key={value}
                type="button"
                role="tab"
                aria-selected={filter === value}
                onClick={() => setFilter(value as typeof filter)}
                className={`shrink-0 rounded-lg px-3 py-2 text-xs font-bold transition ${filter === value ? "bg-blue-50 text-blue-700" : "text-slate-500 hover:bg-slate-50 hover:text-slate-700"}`}
              >
                {label}
              </button>
            ))}
          </div>
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <label className="flex max-w-md flex-1 items-center gap-2 rounded-xl border border-slate-200 px-3 py-2 text-slate-400">
            <Search size={16} />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              className="min-w-0 flex-1 bg-transparent text-sm text-slate-700 outline-none placeholder:text-slate-400"
              placeholder="Search requests"
              aria-label="Search requests"
            />
          </label>
          <p className="text-xs font-medium text-slate-400">
            {filtered.length} {filter === "ALL" ? "saved" : "matching"}{" "}
            {filtered.length === 1 ? "request" : "requests"}
          </p>
          </div>
        </div>
        {loading ? (
          <div className="flex h-52 items-center justify-center gap-2 text-sm text-slate-400">
            <LoaderCircle className="animate-spin" size={18} /> Loading
            requests…
          </div>
        ) : filtered.length ? (
          <div className="divide-y divide-slate-100">
            {filtered.map((item) => {
              const status = historyStatus(item.status);
              const metadata = requestMetadata(item);
              const offer = historyOffer(status.stage, item.bestEffectivePrice);
              return (
                <button
                  key={item.id}
                  onClick={() => openRFQ(item.id)}
                  className="group grid w-full gap-4 p-4 text-left transition hover:bg-slate-50 focus-visible:z-10 sm:grid-cols-[minmax(0,1.8fr)_minmax(125px,.8fr)_minmax(120px,.7fr)_minmax(145px,.7fr)_auto] sm:items-center sm:gap-5"
                >
                  <div className="min-w-0">
                    <p className="truncate text-sm font-extrabold text-slate-800 group-hover:text-blue-700">
                      {requestTitle(item)}
                    </p>
                    {metadata.length > 0 && <p className="mt-1 line-clamp-1 text-xs text-slate-500">{metadata.join(" · ")}</p>}
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:hidden">Progress</p>
                    <p className="mt-1 text-xs font-semibold leading-5 text-slate-600 sm:mt-0">
                      {historyProgress(status.stage, item.qualifyingQuoteCount)}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:hidden">Best offer</p>
                    <p className="mt-1 text-sm font-extrabold text-slate-800 sm:mt-0">{offer.value}</p>
                    <p className="mt-0.5 text-[11px] text-slate-400">{offer.detail}</p>
                  </div>
                  <div className="flex items-center justify-between gap-3 sm:block">
                    <div>
                      <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 sm:hidden">Status</p>
                      <div className="mt-1 sm:mt-0"><Pill tone={status.tone}>{status.label}</Pill></div>
                    </div>
                    <p className="text-xs text-slate-400 sm:mt-2">Updated {relativeUpdatedAt(item.updatedAt)}</p>
                  </div>
                  <div className="flex items-center gap-1 text-xs font-bold text-blue-700 sm:justify-end">
                    <span>{status.stage === "DRAFT" ? "Start outreach" : status.stage === "OFFERS_READY" ? "Compare offers" : status.stage === "PURCHASED" ? "View order" : "View progress"}</span>
                    <ChevronRight className="transition group-hover:translate-x-0.5" size={17} />
                  </div>
                </button>
              );
            })}
          </div>
        ) : (
          <div className="flex h-52 flex-col items-center justify-center px-5 text-center">
            <FileText className="mb-3 text-slate-300" size={28} />
            <p className="font-bold text-slate-600">No requests found</p>
            <p className="mt-1 text-sm text-slate-400">
              Start a new request to collect and compare merchant offers.
            </p>
          </div>
        )}
      </div>
    </section>
  );
}

function QuoteDashboard({
  createQuote,
  goHome,
}: {
  createQuote: () => void;
  goHome: () => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<
    DashboardQuote["status"] | "All statuses"
  >("All statuses");
  const filteredQuotes = dashboardQuotes
    .filter((quote) => {
      const searchable = `${quote.id} ${quote.customer}`.toLowerCase();
      return (
        searchable.includes(query.toLowerCase()) &&
        (status === "All statuses" || quote.status === status)
      );
    })
    .sort((a, b) => a.rank - b.rank);

  return (
    <div className="dashboard-shell">
      <aside className="dashboard-sidebar">
        <div className="dashboard-brand">
          <span className="brand-mark">
            <span className="brand-diamond" />
            <span className="brand-diamond brand-diamond-right" />
          </span>
          <span className="brand-name">
            ai buyer
            <br />
            <b>company</b>
          </span>
        </div>
        <nav className="dashboard-nav" aria-label="Main navigation">
          <button
            onClick={goHome}
            className="dashboard-nav-item"
            aria-label="Home"
          >
            <Store size={20} />
          </button>
          <button className="dashboard-nav-item active" aria-label="Quotes">
            <FileText size={20} />
          </button>
          <button className="dashboard-nav-item" aria-label="Products">
            <PackageCheck size={20} />
          </button>
        </nav>
        <button
          className="dashboard-nav-item dashboard-settings"
          aria-label="Settings"
        >
          <Settings size={20} />
        </button>
      </aside>
      <div className="dashboard-content">
        <div className="dashboard-mobile-bar">
          <button aria-label="Open navigation">
            <Menu size={22} />
          </button>
          <span className="mobile-title">ai buyer</span>
          <button
            onClick={createQuote}
            className="mobile-create"
            aria-label="Create quote"
          >
            <Sparkles size={16} />
          </button>
        </div>
        <header className="dashboard-header">
          <div className="dashboard-title">
            <button
              className="dashboard-menu-button"
              aria-label="Collapse navigation"
            >
              <Menu size={24} />
            </button>
            <div>
              <h1>Quote Pricing</h1>
              <p>
                Rapid quotes that increase win rates and maximize profitability
                driven with AI.
              </p>
            </div>
          </div>
          <div className="dashboard-actions">
            <button className="date-button">
              Last 30 days <ChevronDown size={15} />
            </button>
            <button className="settings-button">
              <Settings size={16} /> Settings
            </button>
            <button onClick={createQuote} className="create-button">
              Create quote <span>+</span>
            </button>
          </div>
        </header>
        <section className="dashboard-stats" aria-label="Quote summary">
          <div className="stat-card quote-total">
            <div className="stat-heading">
              <strong>49</strong>
              <span>Total Quotes</span>
            </div>
            <div className="quote-bar">
              <i />
              <i />
              <i />
            </div>
            <div className="quote-legend">
              <span>
                <b className="green-dot" />
                Won 43
              </span>
              <span>
                <b className="blue-dot" />
                Pending 1
              </span>
              <span>
                <b className="amber-dot" />
                Lost 4
              </span>
            </div>
          </div>
          <div className="stat-card">
            <span className="stat-label">Average Price</span>
            <strong className="stat-value">₹29,034</strong>
            <span className="stat-change positive">↑ +10% last 30 days</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Average Margin Change</span>
            <strong className="stat-value">20%</strong>
            <span className="stat-change positive">↑ +2% last 30 days</span>
          </div>
          <div className="stat-card">
            <span className="stat-label">Conversion Rate</span>
            <strong className="stat-value">40%</strong>
            <span className="stat-change positive">↑ +10% last month</span>
          </div>
        </section>
        <section className="quotes-section">
          <div className="quote-toolbar">
            <label className="search-box">
              <Search size={17} />
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find a quote"
              />
            </label>
            <select
              className="filter-button"
              value={status}
              onChange={(event) =>
                setStatus(
                  event.target.value as
                    DashboardQuote["status"] | "All statuses",
                )
              }
              aria-label="Filter quotes"
            >
              <option>All statuses</option>
              <option>Approved invoice</option>
              <option>Pending</option>
              <option>Lost</option>
            </select>
            <span className="showing-count">
              Showing {filteredQuotes.length} of {dashboardQuotes.length}{" "}
              quotes, ranked by AI score
            </span>
            <button className="bulk-button">
              Bulk actions <MoreVertical size={17} />
            </button>
          </div>
          <div className="quotes-table-wrap">
            <table className="quotes-table">
              <thead>
                <tr>
                  <th>
                    <input type="checkbox" aria-label="Select all quotes" />
                  </th>
                  <th>Rank</th>
                  <th>Quote ID</th>
                  <th>Customer</th>
                  <th>
                    Date Created <ChevronDown size={14} />
                  </th>
                  <th>Total Quantity</th>
                  <th>Total Optimized Price</th>
                  <th>AI Score</th>
                  <th>Status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {filteredQuotes.map((quote) => (
                  <tr
                    key={quote.id}
                    className={quote.rank === 1 ? "featured-row" : ""}
                  >
                    <td>
                      <input
                        type="checkbox"
                        aria-label={`Select ${quote.id}`}
                      />
                    </td>
                    <td className="quote-id">#{quote.rank}</td>
                    <td className="quote-id">{quote.id}</td>
                    <td>{quote.customer}</td>
                    <td>{quote.date}</td>
                    <td>{quote.quantity}</td>
                    <td>{quote.price}</td>
                    <td>
                      <strong>{quote.score}</strong>{" "}
                      <span className="text-xs text-slate-400">/ 100</span>
                    </td>
                    <td>
                      <span
                        className={`dashboard-status ${quote.status === "Lost" ? "lost" : quote.status === "Pending" ? "pending" : "approved"}`}
                      >
                        {quote.status === "Approved invoice" && (
                          <Check size={13} />
                        )}
                        {quote.status === "Lost" && <CircleAlert size={13} />}
                        {quote.status}
                      </span>
                    </td>
                    <td>
                      <button
                        className="row-menu"
                        aria-label={`Actions for ${quote.id}`}
                      >
                        <MoreVertical size={18} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {filteredQuotes.length === 0 && (
              <div className="empty-quotes">No quotes match these filters.</div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

function Home({
  prompt,
  setPrompt,
  parsing,
  understandIntent,
  captureVoice,
  listening,
  voiceNotice,
  notice,
}: {
  prompt: string;
  setPrompt: (value: string) => void;
  parsing: boolean;
  understandIntent: () => void;
  captureVoice: () => void;
  listening: boolean;
  voiceNotice: string | null;
  notice: string | null;
}) {
  return (
    <section className="mx-auto grid max-w-7xl gap-12 px-5 pb-12 pt-12 lg:grid-cols-[1.1fr_.9fr] lg:px-8 lg:pt-24">
      <div className="max-w-2xl animate-fade-up">
        <Pill tone="blue">
          <Bot size={12} /> Procurement, done for you
        </Pill>
        <h1 className="mt-5 text-4xl font-extrabold tracking-[-.055em] text-slate-900 sm:text-6xl sm:leading-[1.03]">
          Tell us what you need.<br />
          We&apos;ll get merchants to compete for your business.
        </h1>
        <p className="mt-5 max-w-xl text-base leading-7 text-slate-500 sm:text-lg">
          Envoy contacts merchants, fills in missing details, negotiates the
          terms, and ranks merchant-confirmed offers for you.
        </p>
        <div className="mt-5 flex flex-wrap gap-x-4 gap-y-2 text-xs font-bold text-slate-600">
          <span className="inline-flex items-center gap-1.5"><CheckCircle2 className="text-emerald-500" size={14} /> Genuine merchant quotes</span>
          <span className="inline-flex items-center gap-1.5"><MessageCircleMore className="text-blue-600" size={14} /> Negotiates price &amp; terms</span>
          <span className="inline-flex items-center gap-1.5"><SlidersHorizontal className="text-violet-600" size={14} /> Ranks complete offers</span>
        </div>
        <div className="mt-8 rounded-3xl border border-slate-200 bg-white p-3 shadow-float">
          <textarea
            aria-label="Describe what you need merchants to quote for"
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
            rows={5}
            className="w-full resize-none rounded-2xl border-0 bg-transparent px-4 py-3 text-[15px] font-medium leading-6 text-slate-700 outline-none placeholder:text-slate-300"
            placeholder="Need 40 black stackable plastic chairs delivered to Chennai by Saturday. Budget ₹200 per chair."
          />
          <div className="flex flex-col gap-3 border-t border-slate-100 px-2 pt-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={() => setPrompt(landingSampleRequest)}
                className="flex items-center gap-1.5 text-left text-xs font-bold text-blue-700 hover:text-blue-900"
              >
                <Sparkles size={13} /> Try sample request
              </button>
              <button
                onClick={captureVoice}
                className={`inline-flex items-center gap-1.5 text-xs font-bold ${listening ? "text-rose-600" : "text-slate-600 hover:text-slate-900"}`}
              >
                <Mic className={listening ? "animate-pulse" : ""} size={14} />{" "}
                {listening ? "Listening… click to stop" : "Speak request"}
              </button>
            </div>
            <button
              disabled={parsing || prompt.trim().length < 8}
              onClick={() => understandIntent()}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#315bd6] px-5 py-3 text-sm font-bold text-white shadow-lg shadow-blue-200 transition hover:bg-[#294fbe] disabled:cursor-not-allowed disabled:opacity-60"
            >
              {parsing ? (
                <>
                  <LoaderCircle className="animate-spin" size={17} />{" "}
                  Understanding request
                </>
              ) : (
                <>
                  Get merchant quotes <ArrowRight size={17} />
                </>
              )}
            </button>
          </div>
        </div>
        {notice && (
          <p
            role="alert"
            className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-medium leading-5 text-amber-800"
          >
            {notice}
          </p>
        )}
        {voiceNotice && (
          <p className="mt-3 text-xs font-medium text-amber-700">
            {voiceNotice}
          </p>
        )}
        <p className="mt-4 flex items-center gap-1.5 text-xs text-slate-400">
          <LockKeyhole size={12} /> No purchase happens without your approval.
          Your budget is a hard ceiling.
        </p>
      </div>
      <div id="how-it-works" className="relative scroll-mt-6">
        <div className="absolute left-8 top-5 h-72 w-72 rounded-full bg-blue-300/25 blur-3xl" />
        <div className="glass relative mx-auto max-w-md rounded-[28px] border border-white/90 p-5 shadow-float">
          <div className="flex items-center justify-between">
            <span className="text-sm font-extrabold text-slate-800">
              What Envoy will do
            </span>
            <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-400 ring-4 ring-emerald-100" />
          </div>
          <p className="mt-2 text-sm leading-6 text-slate-500">Envoy does the commercial back-and-forth for you.</p>
          <div className="mt-4 space-y-3">
            {[
              ["01", "Contact relevant merchants"],
              ["02", "Complete missing quote details"],
              ["03", "Negotiate price, delivery & terms"],
              ["04", "Rank the best qualifying offers"],
            ].map(([number, label], index) => (
              <div
                key={label}
                className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-white px-4 py-3"
              >
                <span
                  className={`grid h-8 w-8 place-items-center rounded-lg ${index === 2 ? "bg-emerald-100 text-emerald-700" : "bg-blue-50 text-blue-700"}`}
                >
                  {index === 0 ? (
                    <Store size={15} />
                  ) : index === 1 ? (
                    <MessageCircleMore size={15} />
                  ) : index === 2 ? (
                    <Mic size={15} />
                  ) : (
                    <SlidersHorizontal size={15} />
                  )}
                </span>
                <span>
                  <b className="text-sm text-slate-800">{number}</b>
                  <span className="ml-1.5 text-xs text-slate-500">{label}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

const demoCallTurns = [
  {
    stage: "Verifying the offer",
    speaker: "Envoy",
    text: "Hi, I’m Envoy, an AI assistant calling for a buyer. Is the Samsung 550L refrigerator in stock, and what is your GST-inclusive price?",
  },
  {
    stage: "Merchant response",
    speaker: "Merchant",
    text: "Yes, it is in stock. Our price is ₹65,500 including GST, with delivery available on Saturday.",
  },
  {
    stage: "Checking commercial terms",
    speaker: "Envoy",
    text: "Please confirm the warranty, installation, and whether you can improve the exchange value for a buyer who confirms today.",
  },
  {
    stage: "Merchant counteroffer",
    speaker: "Merchant",
    text: "One-year manufacturer warranty and free installation. I can offer ₹3,000 for an eligible exchange.",
  },
  {
    stage: "Negotiating within guardrails",
    speaker: "Envoy",
    text: "That works. Please confirm the final payable amount and that Saturday delivery is included before I send it to the buyer.",
  },
  {
    stage: "Terms confirmed",
    speaker: "Merchant",
    text: "Confirmed: ₹65,500 less ₹3,000 exchange, Saturday delivery, free installation, and GST included.",
  },
  {
    stage: "Reading back the deal",
    speaker: "Envoy",
    text: "I’ve recorded ₹62,500 after exchange, including GST, delivery, installation, and one-year warranty. I’ll share the confirmed offer with the buyer.",
  },
] as const;

function DemoCallStudio() {
  const [turn, setTurn] = useState(0);
  const [playing, setPlaying] = useState(true);
  const isComplete = turn === demoCallTurns.length - 1;
  const visibleTurns = demoCallTurns.slice(0, turn + 1);

  useEffect(() => {
    if (!playing) return;

    const timer = window.setInterval(() => {
      setTurn((current) => {
        if (current >= demoCallTurns.length - 1) {
          setPlaying(false);
          return current;
        }
        return current + 1;
      });
    }, 2400);

    return () => window.clearInterval(timer);
  }, [playing]);

  const replay = () => {
    if (isComplete) setTurn(0);
    setPlaying(true);
  };

  return (
    <div className="glass relative z-10 mx-auto max-w-md overflow-hidden rounded-[28px] border border-white/90 shadow-float">
      <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
        <div>
          <p className="text-sm font-extrabold text-slate-800">Agent call demo</p>
          <p className="mt-0.5 text-xs text-slate-500">A transparent negotiation, step by step</p>
        </div>
        <span className="rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-extrabold tracking-wide text-blue-700">
          SIMULATED
        </span>
      </div>
      <div className="bg-slate-950 px-5 pb-5 pt-4 text-white">
        <div className="flex items-center gap-3">
          <span className="grid h-10 w-10 place-items-center rounded-full bg-blue-500 text-sm font-black">M</span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-bold">Metro Appliances</p>
            <p className="text-xs text-slate-400">{playing ? "Agent is speaking" : isComplete ? "Call summary ready" : "Demo paused"}</p>
          </div>
          <span className="flex items-center gap-1.5 text-xs font-bold text-emerald-300">
            <span className={`h-2 w-2 rounded-full bg-emerald-400 ${playing ? "animate-pulse" : ""}`} />
            00:{String(14 + turn * 8).padStart(2, "0")}
          </span>
        </div>
        <div className="mt-4 flex items-center gap-2 text-[11px] font-bold text-blue-200">
          <Bot size={14} /> {demoCallTurns[turn].stage}
        </div>
      </div>
      <div className="max-h-64 space-y-3 overflow-y-auto bg-slate-50 px-4 py-4">
        {visibleTurns.map((item, index) => {
          const agent = item.speaker === "Envoy";
          return (
            <div key={`${item.speaker}-${index}`} className={`flex ${agent ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[85%] rounded-2xl px-3.5 py-2.5 text-xs leading-5 shadow-sm ${agent ? "rounded-br-md bg-blue-600 text-white" : "rounded-bl-md border border-slate-200 bg-white text-slate-700"}`}>
                <p className={`mb-0.5 text-[10px] font-extrabold ${agent ? "text-blue-100" : "text-slate-400"}`}>{item.speaker}</p>
                {item.text}
              </div>
            </div>
          );
        })}
      </div>
      <div className="border-t border-slate-100 bg-white p-4">
        <div className="flex items-center justify-between gap-3 rounded-xl bg-emerald-50 px-3 py-2.5">
          <div>
            <p className="text-[10px] font-extrabold uppercase tracking-wide text-emerald-700">{isComplete ? "Confirmed offer" : "Agent is working"}</p>
            <p className="text-xs font-semibold text-emerald-950">{isComplete ? "₹62,500 after exchange · Saturday delivery" : "Every question and decision is logged"}</p>
          </div>
          {isComplete ? <CheckCircle2 className="shrink-0 text-emerald-600" size={19} /> : <LoaderCircle className="shrink-0 animate-spin text-emerald-600" size={19} />}
        </div>
        <button
          onClick={() => (playing ? setPlaying(false) : replay())}
          className="mt-3 w-full rounded-xl border border-slate-200 px-4 py-2.5 text-xs font-extrabold text-slate-700 transition hover:bg-slate-50"
        >
          {isComplete ? "Replay demo call" : playing ? "Pause demo call" : "Resume demo call"}
        </button>
        <p className="mt-2 text-center text-[10px] leading-4 text-slate-400">Demo only — no merchant is contacted. Real calls and WhatsApp messages appear in your quotation timeline.</p>
      </div>
    </div>
  );
}

function ClarificationView({
  questions,
  originalPrompt,
  parsing,
  back,
  submit,
}: {
  questions: ClarificationQuestion[];
  originalPrompt: string;
  parsing: boolean;
  back: () => void;
  submit: (answers: Record<string, string>) => void;
}) {
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [customBudget, setCustomBudget] = useState("");
  const unitBudget = Number(originalPrompt.match(/(?:₹|rs\.?|inr)\s*([0-9][0-9,]*)\s*(?:per|\/)\s*(?:chair|unit|piece)/i)?.[1]?.replaceAll(",", "") ?? 0);
  const quantity = /\bchairs?\b/i.test(originalPrompt) ? Number(originalPrompt.match(/\b(\d{1,5})\b/)?.[1] ?? 0) : 0;
  const inferredTotal = unitBudget && quantity ? unitBudget * quantity : 0;
  const complete =
    questions.length > 0 &&
    questions.every((question) => answers[question.id]?.trim() && (answers[question.id] !== "custom" || customBudget.trim()));
  return (
    <section className="mx-auto max-w-2xl px-5 pb-8 pt-5 sm:pt-8">
      <button
        onClick={back}
        disabled={parsing}
        className="mb-7 inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-900 disabled:opacity-50"
      >
        <ArrowLeft size={16} /> Edit original request
      </button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          if (complete) submit(Object.fromEntries(Object.entries(answers).map(([key, value]) => [key, value === "custom" ? `Custom total budget ₹${customBudget}` : value])));
        }}
        className="animate-fade-up rounded-[28px] border border-slate-200 bg-white p-5 shadow-soft sm:p-6"
      >
        <Pill tone="amber">
          <Info size={12} /> {questions.length} detail{questions.length === 1 ? "" : "s"} needed
        </Pill>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">
          {questions.length === 1 ? "One quick detail before I contact merchants" : `I need ${questions.length} quick details before I contact merchants`}
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          I need this to make sure merchants send you comparable offers.
        </p>
        {inferredTotal > 0 && <p className="mt-4 text-sm leading-6 text-slate-600">You said {quantity} chairs at up to {formatPrice(unitBudget)} each, so I calculated a product budget of {formatPrice(inferredTotal)}.</p>}
        <div className="mt-7 space-y-5">
          {questions.map((question, index) => (
            <label key={question.id} className="block">
              {questions.length > 1 && <span className="mb-2 block text-[11px] font-bold uppercase tracking-wider text-blue-600">{index + 1} of {questions.length}</span>}
              <span className="text-sm font-extrabold text-slate-800">
                {question.question}
              </span>
              <span className="mt-1 block text-xs leading-5 text-slate-400">
                {question.helper}
              </span>
              {question.id === "budget_inclusion" ? <div className="mt-3 space-y-2" role="radiogroup" aria-label={question.question}>{[["all_inclusive", `${formatPrice(inferredTotal)} all-inclusive`, "GST and delivery must fit within the total."], ["gst_extra", "GST can be extra", "Delivery must still fit within the stated budget."], ["delivery_extra", "Delivery can be extra", "GST must still fit within the stated budget."], ["both_extra", "GST + delivery can both be extra", "The item budget is separate from quoted charges."], ["custom", "Set another total budget", "Enter a different maximum purchase amount."]].map(([value, label, detail]) => <label key={value} className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3 ${answers[question.id] === value ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white"}`}><input type="radio" name={question.id} value={value} checked={answers[question.id] === value} onChange={() => setAnswers((current) => ({ ...current, [question.id]: value }))} className="mt-0.5" /><span><b className="text-sm text-slate-800">{label}</b><span className="mt-0.5 block text-xs leading-5 text-slate-500">{detail}</span></span></label>)}{answers[question.id] === "custom" && <input required inputMode="numeric" value={customBudget} onChange={(event) => setCustomBudget(event.target.value)} placeholder="Enter total budget in INR" className="w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm outline-none ring-blue-200 focus:ring-2" />}</div> : <textarea required value={answers[question.id] ?? ""} onChange={(event) => setAnswers((current) => ({ ...current, [question.id]: event.target.value }))} rows={2} className="mt-2 w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 outline-none ring-blue-200 placeholder:text-slate-300 focus:ring-2" placeholder="Type your answer…" />}
            </label>
          ))}
        </div>
        <div className="mt-6 flex items-start gap-2 rounded-xl bg-blue-50 p-3 text-xs leading-5 text-blue-800">
          <ShieldCheck className="mt-0.5 shrink-0" size={14} />
          I&apos;ll show you the completed request before contacting any merchant.
        </div>
        <button
          disabled={!complete || parsing}
          className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-[#315bd6] py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-100 hover:bg-[#294fbe] disabled:cursor-not-allowed disabled:opacity-60"
        >
          {parsing ? (
            <>
              <LoaderCircle className="animate-spin" size={17} /> Updating
              quotation request
            </>
          ) : (
            <>
              Review completed request <ArrowRight size={16} />
            </>
          )}
        </button>
      </form>
    </section>
  );
}

function GuardrailsEditor({
  requirement,
  close,
  save,
}: {
  requirement: BuyerRequirement;
  close: () => void;
  save: (requirement: BuyerRequirement) => Promise<void>;
}) {
  const [budget, setBudget] = useState(String(requirement.maxBudget));
  const [city, setCity] = useState(requirement.deliveryCity);
  const [deliveryBy, setDeliveryBy] = useState(requirement.deliveryBy ?? "");
  const [constraints, setConstraints] = useState(
    requirement.hardConstraints.join("\n"),
  );
  const [preferences, setPreferences] = useState(requirement.preferences);
  const [maxMerchants, setMaxMerchants] = useState(
    String(
      requirement.rfqGuardrails?.maxMerchants ?? defaultGuardrails.maxMerchants,
    ),
  );
  const [retriesPerMerchant, setRetriesPerMerchant] = useState(
    String(
      requirement.rfqGuardrails?.retriesPerMerchant ??
        defaultGuardrails.retriesPerMerchant,
    ),
  );
  const [maxFollowUps, setMaxFollowUps] = useState(
    String(
      requirement.rfqGuardrails?.maxFollowUps ?? defaultGuardrails.maxFollowUps,
    ),
  );
  const [error, setError] = useState("");
  useEffect(() => {
    setBudget(String(requirement.maxBudget));
    setCity(requirement.deliveryCity);
    setDeliveryBy(requirement.deliveryBy ?? "");
    setConstraints(requirement.hardConstraints.join("\n"));
    setPreferences(requirement.preferences);
    setMaxMerchants(
      String(
        requirement.rfqGuardrails?.maxMerchants ??
          defaultGuardrails.maxMerchants,
      ),
    );
    setRetriesPerMerchant(
      String(
        requirement.rfqGuardrails?.retriesPerMerchant ??
          defaultGuardrails.retriesPerMerchant,
      ),
    );
    setMaxFollowUps(
      String(
        requirement.rfqGuardrails?.maxFollowUps ??
          defaultGuardrails.maxFollowUps,
      ),
    );
  }, [requirement]);
  function updatePreference(index: number, priority: string) {
    setPreferences((current) =>
      current.map((item, itemIndex) =>
        itemIndex === index
          ? {
              ...item,
              priority: Math.max(0, Math.min(100, Number(priority) || 0)),
            }
          : item,
      ),
    );
  }
  async function submit() {
    const nextBudget = Math.round(Number(budget));
    const nextCity = city.trim();
    const nextMaxMerchants = Number(maxMerchants);
    const nextRetriesPerMerchant = Number(retriesPerMerchant);
    const nextMaxFollowUps = Number(maxFollowUps);
    const nextConstraints = constraints
      .split("\n")
      .map((constraint) => constraint.trim())
      .filter(Boolean)
      .slice(0, 12);
    const total = preferences.reduce(
      (sum, preference) => sum + preference.priority,
      0,
    );
    if (!Number.isFinite(nextBudget) || nextBudget <= 0) {
      setError("Enter a valid INR payment cap.");
      return;
    }
    if (nextCity.length < 2) {
      setError("Enter the delivery or service city.");
      return;
    }
    if (!nextConstraints.length) {
      setError("Keep at least one hard constraint.");
      return;
    }
    if (
      !Number.isInteger(nextMaxMerchants) ||
      nextMaxMerchants < 1 ||
      nextMaxMerchants > 5
    ) {
      setError("Choose between 1 and 5 merchants.");
      return;
    }
    if (
      !Number.isInteger(nextRetriesPerMerchant) ||
      nextRetriesPerMerchant < 0 ||
      nextRetriesPerMerchant > 1
    ) {
      setError("Choose 0 or 1 retry per merchant.");
      return;
    }
    if (
      !Number.isInteger(nextMaxFollowUps) ||
      nextMaxFollowUps < 0 ||
      nextMaxFollowUps > 3
    ) {
      setError("Choose between 0 and 3 follow-ups.");
      return;
    }
    if (total <= 0) {
      setError("Give at least one scoring priority a value above zero.");
      return;
    }
    const normalized = preferences.map((preference) => ({
      ...preference,
      priority: Math.round((preference.priority / total) * 100),
    }));
    normalized[0].priority +=
      100 -
      normalized.reduce((sum, preference) => sum + preference.priority, 0);
    const budgetConstraint = `₹${nextBudget.toLocaleString("en-IN")} or less`;
    const budgetIndex = nextConstraints.findIndex((constraint) =>
      /(?:₹|budget|price|cost|payable)/i.test(constraint),
    );
    if (budgetIndex >= 0) nextConstraints[budgetIndex] = budgetConstraint;
    else nextConstraints.unshift(budgetConstraint);
    try {
      setError("");
      await save({
        ...requirement,
        maxBudget: nextBudget,
        deliveryCity: nextCity,
        deliveryBy: deliveryBy.trim() || undefined,
        hardConstraints: nextConstraints,
        preferences: normalized,
        rfqGuardrails: {
          maxMerchants: nextMaxMerchants,
          retriesPerMerchant: nextRetriesPerMerchant,
          maxFollowUps: nextMaxFollowUps,
        },
      });
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Could not save quotation guardrails.",
      );
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-5">
      <div className="max-h-[92vh] w-full max-w-2xl overflow-auto rounded-t-[28px] bg-white p-6 shadow-2xl sm:rounded-[28px]">
        <div className="flex items-start justify-between gap-4">
          <div>
            <Pill tone="blue">
              <ShieldCheck size={12} /> Buyer-controlled quotation
            </Pill>
            <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-slate-900">
              Edit quotation guardrails
            </h2>
            <p className="mt-1 text-sm leading-6 text-slate-500">
              These constraints and scoring weights are saved into the quotation
              request before any merchant is contacted.
            </p>
          </div>
          <button
            onClick={close}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label>
            <span className="text-xs font-extrabold text-slate-700">
              Maximum total budget (₹)
            </span>
            <input
              inputMode="numeric"
              value={budget}
              onChange={(event) => setBudget(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none ring-blue-200 focus:ring-2"
            />
          </label>
          <label>
            <span className="text-xs font-extrabold text-slate-700">
              Delivery or service city
            </span>
            <input
              value={city}
              onChange={(event) => setCity(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none ring-blue-200 focus:ring-2"
            />
          </label>
          <label className="sm:col-span-2">
            <span className="text-xs font-extrabold text-slate-700">
              Delivery deadline{" "}
              <span className="font-medium text-slate-400">(optional)</span>
            </span>
            <input
              value={deliveryBy}
              onChange={(event) => setDeliveryBy(event.target.value)}
              className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm text-slate-700 outline-none ring-blue-200 focus:ring-2"
              placeholder="For example: Saturday, 15 September, or within 3 days"
            />
          </label>
        </div>
        <div className="mt-5">
          <p className="text-xs font-extrabold text-slate-700">
            RFQ guardrails
          </p>
          <p className="mt-1 text-xs text-slate-400">
            You can tighten these limits; platform safety ceilings remain in
            force.
          </p>
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <label>
              <span className="text-xs font-bold text-slate-700">
                Merchants
              </span>
              <input
                inputMode="numeric"
                min="1"
                max="5"
                value={maxMerchants}
                onChange={(event) => setMaxMerchants(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none ring-blue-200 focus:ring-2"
              />
            </label>
            <label>
              <span className="text-xs font-bold text-slate-700">
                Retries / merchant
              </span>
              <input
                inputMode="numeric"
                min="0"
                max="1"
                value={retriesPerMerchant}
                onChange={(event) => setRetriesPerMerchant(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none ring-blue-200 focus:ring-2"
              />
            </label>
            <label>
              <span className="text-xs font-bold text-slate-700">
                Follow-ups max
              </span>
              <input
                inputMode="numeric"
                min="0"
                max="3"
                value={maxFollowUps}
                onChange={(event) => setMaxFollowUps(event.target.value)}
                className="mt-1.5 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm font-semibold text-slate-700 outline-none ring-blue-200 focus:ring-2"
              />
            </label>
          </div>
        </div>
        <label className="mt-5 block">
          <span className="text-xs font-extrabold text-slate-700">
            Hard constraints{" "}
            <span className="font-medium text-slate-400">(one per line)</span>
          </span>
          <textarea
            value={constraints}
            onChange={(event) => setConstraints(event.target.value)}
            rows={5}
            className="mt-1.5 w-full resize-none rounded-xl border border-slate-200 px-3 py-2.5 text-sm leading-6 text-slate-700 outline-none ring-blue-200 focus:ring-2"
          />
        </label>
        <div className="mt-5">
          <p className="text-xs font-extrabold text-slate-700">
            Scoring weights
          </p>
          <p className="mt-1 text-xs text-slate-400">
            Weights are automatically normalized to 100% when saved.
          </p>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {preferences.map((preference, index) => (
              <label
                key={preference.criterion}
                className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50 px-3 py-2.5"
              >
                <span className="text-xs font-bold text-slate-700">
                  {preference.criterion}
                </span>
                <span className="flex items-center gap-1">
                  <input
                    inputMode="numeric"
                    value={preference.priority}
                    onChange={(event) =>
                      updatePreference(index, event.target.value)
                    }
                    className="w-12 rounded-lg border border-slate-200 bg-white px-2 py-1 text-right text-xs font-bold outline-none ring-blue-200 focus:ring-2"
                  />
                  <span className="text-xs text-slate-400">%</span>
                </span>
              </label>
            ))}
          </div>
        </div>
        <div className="mt-5 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">
          <b className="text-slate-700">Platform safety limits:</b> up to 5
          merchants, one retry after a failed contact, up to 3 merchant
          follow-ups, and up to 2 negotiation rounds. These cannot be expanded
          by the agent.
        </div>
        {error && (
          <p className="mt-3 text-xs font-semibold text-rose-600">{error}</p>
        )}
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <button
            onClick={close}
            className="rounded-xl border border-slate-200 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            Cancel
          </button>
          <button
            onClick={submit}
            className="rounded-xl bg-[#315bd6] py-3 text-sm font-bold text-white hover:bg-[#294fbe]"
          >
            Save guardrails
          </button>
        </div>
      </div>
    </div>
  );
}

function RequirementConfirm({
  requirement,
  originalPrompt,
  summaryTitle,
  notice,
  back,
  proceed,
}: {
  requirement: BuyerRequirement;
  originalPrompt: string;
  summaryTitle: string;
  notice: string | null;
  back: () => void;
  proceed: () => void;
}) {
  const guardrails = requirement.rfqGuardrails ?? defaultGuardrails;
  const requestText = `${requirement.productDescription} ${requirement.specifications.join(" ")}`;
  const buyerText = originalPrompt || requestText;
  const itemUnitPattern = "(?:chairs?|units?|pieces?|rackets?|tables?|bottles?|bags?|boxes?|sets?|kg|kgs|kilograms?)";
  const quantityMatch = buyerText.match(new RegExp(`\\b([0-9][0-9,]*)\\s*(?:[a-z-]+\\s+)?(${itemUnitPattern})\\b`, "i"))
    ?? requestText.match(new RegExp(`\\b([0-9][0-9,]*)\\s*(?:[a-z-]+\\s+)?(${itemUnitPattern})\\b`, "i"));
  const quantity = Number(quantityMatch?.[1]?.replaceAll(",", "") ?? 0);
  const unitName = quantityMatch?.[2]?.toLowerCase().replace(/s$/, "") ?? "unit";
  const unitBudgetMatch = buyerText.match(new RegExp(`(?:₹|rs\\.?|inr)\\s*([0-9][0-9,]*)\\s*(?:per|\\/)\\s*(?:[a-z-]+\\s+)?${itemUnitPattern}`, "i"));
  const unitBudget = unitBudgetMatch ? Number(unitBudgetMatch[1].replaceAll(",", "")) : undefined;
  const maximumOrder = requirement.maxBudget;
  const requestTitle = summaryTitle.trim() || requirement.productDescription;
  const quantityLabel = quantity ? `${quantity.toLocaleString("en-IN")} ${quantityMatch?.[2] ?? "units"}` : null;
  const mustHaves = [
    /plastic/i.test(requestText) ? "Plastic chairs" : null,
    quantity ? `Quantity: ${quantity}` : null,
    /black/i.test(requestText) ? "Black" : null,
    /stackable/i.test(requestText) ? "Stackable" : null,
    unitBudget ? `${formatPrice(unitBudget)} / ${unitName} or less` : requirement.maxBudget ? `${formatPrice(requirement.maxBudget)} or less` : null,
    requirement.deliveryCity && !/to be confirmed/i.test(requirement.deliveryCity) ? `${requirement.deliveryCity} delivery` : null,
    requirement.deliveryBy ? `Delivered by ${requirement.deliveryBy}` : null,
  ].filter(Boolean) as string[];
  const copied = () =>
    navigator.clipboard?.writeText(
      `${requirement.productDescription}\n${requirement.hardConstraints.join("\n")}`,
    );
  return (
    <section className="mx-auto max-w-3xl px-5 pb-8 pt-5 sm:pt-8">
      <button
        onClick={back}
        className="mb-7 inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft size={16} /> Edit request
      </button>
      <div className="animate-fade-up rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft sm:p-9">
        <div className="flex items-start gap-4">
          <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue-50 text-blue-700">
            <Bot size={21} />
          </span>
          <div>
            <Pill tone="blue">Ready for merchant outreach</Pill>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">
              Review your request
            </h1>
            <p className="mt-2 text-sm leading-6 text-slate-500">
              Make sure these details look right before Envoy starts contacting merchants.
            </p>
          </div>
        </div>
        {notice && (
          <div className="mt-6 flex gap-2 rounded-xl bg-amber-50 p-3 text-xs leading-5 text-amber-800">
            <Info className="mt-0.5 shrink-0" size={14} />
            I inferred some details from your request. Please review them before continuing.
          </div>
        )}
          <div className="mt-7 rounded-2xl border border-slate-200 bg-slate-50 p-5">
          <div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Your request</p><h2 className="mt-1 text-xl font-extrabold text-slate-900">{requestTitle}</h2>{quantityLabel && <Pill tone="blue">Quantity: {quantityLabel}</Pill>}</div><button onClick={back} className="text-xs font-bold text-blue-700 hover:text-blue-900">Edit request</button></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2"><div className="rounded-xl bg-white p-3"><p className="text-[10px] font-bold uppercase text-slate-400">{unitBudget ? "Per-unit budget" : "Maximum purchase"}</p><p className="mt-1 text-sm font-extrabold text-slate-800">{unitBudget ? `${formatPrice(unitBudget)} / ${unitName}` : formatPrice(maximumOrder)}</p></div><div className="rounded-xl bg-white p-3"><p className="text-[10px] font-bold uppercase text-slate-400">Maximum order</p><p className="mt-1 text-sm font-extrabold text-slate-800">{formatPrice(maximumOrder)}</p></div><div className="rounded-xl bg-white p-3"><p className="text-[10px] font-bold uppercase text-slate-400">Deliver to</p><p className="mt-1 text-sm font-extrabold text-slate-800">{requirement.deliveryCity}</p></div><div className="rounded-xl bg-white p-3"><p className="text-[10px] font-bold uppercase text-slate-400">Need by</p><p className="mt-1 text-sm font-extrabold text-slate-800">{requirement.deliveryBy ?? "Flexible"}</p></div></div>
        </div>
        <div className="mt-5 grid gap-5 sm:grid-cols-2">
          <div className="rounded-2xl bg-slate-50 p-5">
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-slate-400">
              Must have
            </h2>
            <ul className="mt-3 space-y-3">
              {mustHaves.map((constraint) => (
                <li
                  key={constraint}
                  className="flex gap-2 text-sm font-semibold text-slate-700"
                >
                  <CheckCircle2
                    className="shrink-0 text-emerald-500"
                    size={17}
                  />
                  {constraint}
                </li>
              ))}
            </ul>
          </div>
          <div className="rounded-2xl border border-blue-100 bg-blue-50/50 p-5">
            <h2 className="text-xs font-extrabold uppercase tracking-wider text-blue-500">
              How I&apos;ll compare offers
            </h2>
            <ol className="mt-3 space-y-3">
              {["Meets all your requirements", "Lowest total delivered cost", "Earlier confirmed delivery", "Better commercial terms"].map((preference, index) => (
                <li
                  key={preference}
                  className="flex items-center justify-between text-sm font-semibold text-slate-700"
                >
                  <span>
                    <span className="mr-2 text-blue-500">
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    {preference}
                  </span>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-[11px] leading-5 text-slate-500">Envoy compares the total delivered cost — including unit price, GST, delivery, and other quoted charges.</p>
          </div>
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-xs font-bold text-slate-500">
                Share RFQ
              </p>
              <p className="hidden">
                Open WhatsApp or your mail client with this quotation request
                pre-filled.
              </p>
            </div>
            <div className="flex gap-2">
              <a
                href={shareUrl("whatsapp", requirement)}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-700 hover:text-emerald-900"
              >
                <MessageCircleMore size={14} /> WhatsApp
              </a>
              <a
                href={shareUrl("email", requirement)}
                className="inline-flex items-center gap-1.5 text-xs font-bold text-blue-700 hover:text-blue-900"
              >
                <Mail size={14} /> Email
              </a>
              <button
                onClick={copied}
                className="text-xs font-bold text-slate-500 hover:text-slate-800"
                title="Copy quotation request"
              >
                <Copy size={14} />
              </button>
            </div>
          </div>
        </div>
        <div className="mt-5 rounded-2xl border border-slate-100 p-4">
          <p className="text-xs font-bold text-slate-400">
            YOU&apos;RE IN CONTROL
          </p>
          <div className="mt-2 flex flex-wrap gap-2">
            <Pill>Up to {guardrails.maxMerchants} merchants</Pill>
            <Pill>Maximum purchase: {formatPrice(maximumOrder)}</Pill>
            <Pill>No payment without approval</Pill>
          </div>
          <details className="mt-3 text-xs text-slate-500"><summary className="cursor-pointer font-bold">View agent limits</summary><p className="mt-2">{guardrails.retriesPerMerchant} retry per merchant · up to {guardrails.maxFollowUps} follow-ups.</p></details>
        </div>
        <p className="mt-5 text-center text-xs text-slate-500">Envoy will contact up to {guardrails.maxMerchants} merchants on your behalf.</p>
        <button
          onClick={proceed}
          className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-[#315bd6] py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-100 hover:bg-[#294fbe]"
        >
          Start merchant outreach <ArrowRight size={16} />
        </button>
      </div>
    </section>
  );
}

function MerchantContactApproval({
  requirement,
  voiceReady,
  back,
  start,
}: {
  requirement: BuyerRequirement;
  voiceReady: boolean;
  back: () => void;
  start: () => void;
}) {
  const shortlist = discoverMerchants(requirement);
  const [sourcingMode, setSourcingMode] = useState<"best" | "local" | "all">("best");
  const includedMerchantIds = new Set(
    shortlist.candidates.filter((candidate) => candidate.included && (sourcingMode === "all" || sourcingMode === "best" || candidate.tier !== "SPECIALIST")).map((candidate) => candidate.merchantId),
  );
  return (
    <section className="mx-auto max-w-3xl px-5 pb-8 pt-5 sm:pt-8">
      <button
        onClick={back}
        className="mb-7 inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft size={16} /> Back to requirements
      </button>
      <div className="animate-fade-up rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft sm:p-9">
        <Pill tone="blue">
          <PhoneCallIcon /> Merchant outreach approval
        </Pill>
        <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">
          I’ll contact these merchants for you
        </h1>
        <p className="mt-2 text-sm leading-6 text-slate-500">
          The AI identifies itself as an AI buying assistant and requests a
          quotation on your behalf. It never reveals another merchant’s name or
          price.
        </p>
        <div className="mt-6 rounded-2xl border border-violet-100 bg-violet-50/50 p-4">
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-violet-600">Step 1 · Understanding your requirement</p>
          <div className="mt-2 grid gap-2 text-xs sm:grid-cols-4"><span className="rounded-lg bg-white px-2.5 py-2"><b>Product</b><br />{shortlist.keywords[0] ?? requirement.category}</span><span className="rounded-lg bg-white px-2.5 py-2"><b>Quantity</b><br />{shortlist.quantity ? `${shortlist.quantity.toLocaleString("en-IN")} ${shortlist.unit}` : "Not specified"}</span><span className="rounded-lg bg-white px-2.5 py-2"><b>Location</b><br />{requirement.deliveryCity}</span><span className="rounded-lg bg-white px-2.5 py-2"><b>Purchase type</b><br />{shortlist.tradeType}</span></div>
          <div className="flex flex-wrap items-center justify-between gap-2"><div><p className="text-xs font-extrabold text-violet-950">AI sourcing shortlist</p><p className="mt-1 text-xs text-violet-800">Understood: {shortlist.keywords.join(" · ")} · {shortlist.tradeType} {shortlist.quantity ? `· ${shortlist.quantity.toLocaleString("en-IN")} requested` : ""}</p></div><Pill tone="blue">{includedMerchantIds.size} matches</Pill></div>
          <p className="mt-3 text-[11px] text-violet-700">Step 2 · {shortlist.scanned} merchants scanned · {shortlist.productMatches} product matches · {shortlist.capable} can fulfil the requested quantity</p>
          <div className="mt-3 space-y-2">{shortlist.candidates.map((candidate) => <div key={candidate.merchantId} className={`flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-xs ${candidate.included ? "bg-white text-slate-700" : "bg-slate-100 text-slate-400"}`}><span className="font-bold">{candidate.name} {candidate.tier === "SPECIALIST" && <span className="ml-1 rounded bg-violet-100 px-1.5 py-0.5 text-[9px] text-violet-700">BEST SPECIALIST</span>}<br /><span className="font-medium text-slate-400">{candidate.city} · {candidate.businessType} · {candidate.minQuantity}–{candidate.maxQuantity} {candidate.unit}</span></span><span className="text-right"><b>{candidate.score}/100 · {candidate.matchLabel}</b><br />{candidate.reason}</span></div>)}</div>
          {shortlist.candidates.some((candidate) => candidate.tier === "SPECIALIST" && candidate.included) && <p className="mt-3 text-[11px] leading-5 text-violet-800">We include a strong out-of-city specialist only when it matches your product and trade type and can ship to {requirement.deliveryCity}; you can compare it beside local options.</p>}
        </div>
        <div className="mt-7 grid gap-3 sm:grid-cols-2">
          {merchants.filter((merchant) => includedMerchantIds.has(merchant.id)).map((merchant, index) => (
            <div
              key={merchant.id}
              className="flex items-center gap-3 rounded-2xl border border-slate-100 bg-slate-50 p-4"
            >
              <Avatar id={merchant.id} />
              <div className="min-w-0">
                <p className="font-extrabold text-slate-800">{merchant.name}</p>
                <p className="mt-0.5 text-xs text-slate-500">
                  {voiceReady && index < 2
                    ? "Voice-call capable when merchant number is configured"
                    : "Simulated merchant for this demo"}
                </p>
              </div>
              {voiceReady && index < 2 && <Pill tone="blue">VOICE</Pill>}
            </div>
          ))}
        </div>
        <div
          className={`mt-6 rounded-2xl p-4 text-xs leading-5 ${voiceReady ? "bg-emerald-50 text-emerald-800" : "bg-amber-50 text-amber-800"}`}
        >
          <div className="flex gap-2">
            <ShieldCheck className="mt-0.5 shrink-0" size={15} />
            <span>
              {voiceReady
                ? "Real voice calling is configured for eligible merchant numbers. Calls begin with AI disclosure and use bounded voice-agent tools."
                : "Voice credentials are not configured, so this run uses clearly labelled mock calls. The same quote, follow-up, negotiation, transcript, and knowledge workflow will run deterministically."}
            </span>
          </div>
        </div>
        <div className="mt-6 rounded-xl border border-slate-100 px-4 py-3 text-xs text-slate-500">
          <b className="text-slate-700">Quotation request:</b>{" "}
          {requirement.productDescription} · delivery to{" "}
          {requirement.deliveryCity}
        </div>
        <div className="mt-4"><p className="text-xs font-extrabold text-slate-700">Step 3 · Choose who the buyer AI should contact</p><div className="mt-2 grid gap-2 sm:grid-cols-3">{[["best", "Best matches", "Local + nearby + the best specialist"], ["local", "Local & nearby", "Keep sourcing close to Agra"], ["all", "All shortlisted", "Contact every qualifying supplier"]].map(([mode, label, detail]) => <button key={mode} onClick={() => setSourcingMode(mode as "best" | "local" | "all")} className={`rounded-xl border p-3 text-left ${sourcingMode === mode ? "border-blue-400 bg-blue-50" : "border-slate-200 bg-white"}`}><b className="text-xs text-slate-800">{label}</b><span className="mt-1 block text-[10px] leading-4 text-slate-500">{detail}</span></button>)}</div></div>
        <button
          onClick={start}
          className="mt-7 flex w-full items-center justify-center gap-2 rounded-xl bg-[#315bd6] py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-100 hover:bg-[#294fbe]"
        >
          Contact {includedMerchantIds.size} approved matches <ArrowRight size={16} />
        </button>
      </div>
    </section>
  );
}

function PhoneCallIcon() {
  return <span className="inline-block h-1.5 w-1.5 rounded-full bg-blue-600" />;
}

function merchantProgressState(id: MerchantId, visible: number) {
  if (id === "electrohub")
    return visible >= 1
      ? { text: "Quote received", tone: "green" as const }
      : { text: "Awaiting reply", tone: "slate" as const };
  if (id === "city")
    return visible >= 2
      ? {
          text: visible >= 8 ? "Final terms ready" : "Quote received",
          tone: "green" as const,
        }
      : { text: "Awaiting reply", tone: "slate" as const };
  if (id === "value")
    return visible >= 5
      ? { text: "Excluded after check", tone: "rose" as const }
      : visible >= 3
        ? { text: "Clarifying details", tone: "amber" as const }
        : { text: "Awaiting reply", tone: "slate" as const };
  if (id === "coolmart")
    return visible >= 5
      ? { text: "Excluded", tone: "rose" as const }
      : { text: "Awaiting reply", tone: "slate" as const };
  return visible >= 6
    ? { text: "No response", tone: "rose" as const }
    : { text: "Awaiting reply", tone: "slate" as const };
}

function negotiationState(
  quote: Quote | undefined,
  turns: MerchantConversation[],
) {
  if (quote?.status === "UNAVAILABLE")
    return {
      label: "No response",
      tone: "rose" as const,
      next: "One permitted retry was exhausted.",
    };
  if (!turns.length)
    return {
      label: "Contacting",
      tone: "blue" as const,
      next: "Waiting for the merchant to acknowledge the RFQ.",
    };
  if (!quote?.product)
    return {
      label: "Awaiting quote",
      tone: "slate" as const,
      next: "The agent is collecting the first commercially usable offer.",
    };
  if (quote.missingFields.length)
    return {
      label: "Clarifying terms",
      tone: "amber" as const,
      next: `Requesting ${quote.missingFields.slice(0, 2).join(" and ")}.`,
    };
  if (quote.status === "DISQUALIFIED")
    return {
      label: "Excluded",
      tone: "rose" as const,
      next: "This offer misses a confirmed buyer constraint.",
    };
  const latest = turns.at(-1);
  if (quote.version >= 2)
    return {
      label: "Final terms ready",
      tone: "green" as const,
      next: "The improved terms are ready for the final comparison.",
    };
  if (
    latest?.direction === "AGENT" &&
    /improve|counter|better/i.test(latest.text)
  )
    return {
      label: "Awaiting counteroffer",
      tone: "amber" as const,
      next: "The merchant is reviewing the agent’s policy-compliant request.",
    };
  return {
    label: "Negotiating",
    tone: "blue" as const,
    next: "The agent is seeking a stronger final commercial term.",
  };
}

function NegotiationBoard({
  quotes,
  conversations,
  rfqId,
  hydrate,
}: {
  quotes: Quote[];
  conversations: MerchantConversation[];
  rfqId: string | null;
  hydrate: (state: RFQState) => void;
}) {
  const [sending, setSending] = useState<MerchantId | null>(null);
  async function simulate(merchantId: MerchantId) {
    if (!rfqId) return;
    setSending(merchantId);
    try {
      const response = await fetch(`/api/rfqs/${rfqId}/negotiation/simulate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ merchantId, channel: "WHATSAPP" }),
      });
      if (response.ok) hydrate(await response.json());
    } finally {
      setSending(null);
    }
  }
  const featuredMerchant = merchants.find((merchant) => conversations.some((turn) => turn.merchantId === merchant.id)) ?? merchants[0];
  const featuredQuote = quotes.find((quote) => quote.merchantId === featuredMerchant.id);
  const featuredTurns = conversations.filter((turn) => turn.merchantId === featuredMerchant.id);
  const featuredState = negotiationState(featuredQuote, featuredTurns);
  return (
    <section className="mb-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-extrabold text-slate-800">
            Live deal negotiations
          </h2>
          <p className="mt-0.5 text-xs text-slate-400">
            Status and current terms are inferred from the latest merchant
            conversation.
          </p>
        </div>
        <Pill tone="blue">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />{" "}
          Live agent view
        </Pill>
      </div>
      <article className="mb-4 overflow-hidden rounded-[24px] border border-blue-100 bg-white shadow-float">
        <div className="flex flex-wrap items-center justify-between gap-3 bg-slate-950 px-5 py-3 text-white"><div className="flex items-center gap-2"><span className="flex h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" /><span className="text-xs font-extrabold uppercase tracking-wider">Agent call studio</span></div><span className="text-[11px] font-bold text-blue-200">{featuredMerchant.name} · {featuredState.label}</span></div>
        <div className="grid gap-0 lg:grid-cols-[.9fr_1.25fr_.95fr]">
          <div className="border-b border-slate-100 p-5 lg:border-b-0 lg:border-r"><p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Call objective</p><div className="mt-4 flex items-center gap-3"><Avatar id={featuredMerchant.id} /><div><p className="font-extrabold text-slate-800">{featuredMerchant.name}</p><p className="text-xs text-slate-500">{featuredTurns.at(-1)?.channel === "VOICE" ? "Voice call fallback" : "WhatsApp-first negotiation"}</p></div></div><div className="mt-5 rounded-2xl bg-blue-50 p-3"><p className="text-xs font-bold leading-5 text-blue-900">Confirm commercial terms, uncover the blocker, and request the strongest permitted improvement.</p></div><button disabled={!rfqId || sending === featuredMerchant.id} onClick={() => simulate(featuredMerchant.id)} className="mt-4 inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 py-2.5 text-xs font-bold text-white hover:bg-blue-700 disabled:opacity-50">{sending === featuredMerchant.id ? <LoaderCircle className="animate-spin" size={14} /> : <Mic size={14} />} Continue agent conversation</button></div>
          <div className="border-b border-slate-100 p-5 lg:border-b-0 lg:border-r"><div className="flex items-center justify-between"><p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Live conversation</p><span className="text-[10px] font-bold text-emerald-600">RECORDED</span></div><div className="mt-4 space-y-3">{featuredTurns.length ? featuredTurns.slice(-4).map((turn) => <div key={turn.id} className={`max-w-[92%] rounded-2xl px-3 py-2.5 text-xs leading-5 ${turn.direction === "MERCHANT" ? "mr-auto rounded-bl-md bg-slate-100 text-slate-700" : "ml-auto rounded-br-md bg-blue-600 text-white"}`}><b>{turn.direction === "MERCHANT" ? featuredMerchant.name : "Envoy"}</b><br />{turn.text}</div>) : <div className="rounded-2xl bg-slate-50 p-4 text-xs leading-5 text-slate-500">The agent will introduce itself, verify the offer, and ask the first commercial question when outreach starts.</div>}</div></div>
          <div className="p-5"><p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Decision visibility</p><div className="mt-4 space-y-3 text-xs"><div className="rounded-xl bg-slate-50 p-3"><span className="font-bold text-slate-400">CURRENT PAYABLE</span><p className="mt-1 text-xl font-extrabold text-slate-900">{featuredQuote?.product ? formatPrice(featuredQuote.effectivePrice) : "Pending quote"}</p></div><div className="rounded-xl border border-amber-100 bg-amber-50 p-3"><span className="font-bold text-amber-700">NEXT ACTION</span><p className="mt-1 font-semibold leading-5 text-amber-950">{featuredState.next}</p></div><div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3"><span className="font-bold text-emerald-700">OUTCOME</span><p className="mt-1 font-semibold leading-5 text-emerald-950">Every answer and counteroffer is saved to the buyer audit trail.</p></div></div></div>
        </div>
      </article>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {merchants.map((merchant) => {
          const quote = quotes.find((item) => item.merchantId === merchant.id);
          const turns = conversations.filter(
            (turn) => turn.merchantId === merchant.id,
          );
          const latest = turns.at(-1);
          const state = negotiationState(quote, turns);
          return (
            <article
              key={merchant.id}
              className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm"
            >
              <header className="flex items-start justify-between gap-3 border-b border-slate-100 p-4">
                <div className="flex min-w-0 items-center gap-3">
                  <Avatar id={merchant.id} />
                  <div>
                    <h3 className="font-extrabold text-slate-800">
                      {merchant.name}
                    </h3>
                    <p className="mt-0.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400">
                      {latest?.channel === "WHATSAPP"
                        ? "WhatsApp"
                        : latest
                          ? "Voice call"
                          : "Outreach queued"}
                    </p>
                  </div>
                </div>
                <Pill tone={state.tone}>{state.label}</Pill>
              </header>
              <div className="space-y-3 p-4">
                <div className="rounded-xl bg-slate-50 p-3">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    Current quotation
                  </p>
                  <p className="mt-1 text-xl font-extrabold text-slate-900">
                    {quote?.product
                      ? formatPrice(quote.effectivePrice)
                      : "Awaiting price"}
                  </p>
                  <p className="mt-1 text-xs font-medium text-slate-500">
                    {quote?.product
                      ? `${formatPrice(quote.basePrice)} − ${formatPrice(quote.exchangeValue)} exchange`
                      : "No commercially usable quote received"}
                  </p>
                  <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-[11px]">
                    <span className="text-slate-400">
                      Delivery{" "}
                      <b className="block text-slate-700">
                        {quote?.deliveryDate ?? "Pending"}
                      </b>
                    </span>
                    <span className="text-slate-400">
                      Warranty{" "}
                      <b className="block text-slate-700">
                        {quote?.warranty ?? "Pending"}
                      </b>
                    </span>
                  </div>
                </div>
                <div>
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    Agent next step
                  </p>
                  <p className="mt-1 text-xs leading-5 text-slate-600">
                    {state.next}
                  </p>
                </div>
                {quote?.missingFields.length ? (
                  <div className="rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-800">
                    Missing: {quote.missingFields.join(", ")}
                  </div>
                ) : null}
                <div className="border-t border-slate-100 pt-3">
                  <p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                    Latest conversation
                  </p>
                  <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-600">
                    {latest
                      ? `${latest.direction === "MERCHANT" ? merchant.name : "Agent"}: ${latest.text}`
                      : "No merchant message recorded yet."}
                  </p>
                </div>
                {turns.length > 0 && (
                  <details className="rounded-xl bg-slate-50 px-3 py-2.5">
                    <summary className="cursor-pointer text-[11px] font-extrabold text-slate-600">
                      View full conversation ({turns.length} messages)
                    </summary>
                    <div className="mt-2 space-y-2 border-t border-slate-200 pt-2">
                      {turns.map((turn) => (
                        <p key={turn.id} className="text-[11px] leading-5 text-slate-600">
                          <b className="text-slate-800">{turn.direction === "MERCHANT" ? merchant.name : turn.direction === "AGENT" ? "Envoy" : "System"}:</b> {turn.text}
                        </p>
                      ))}
                    </div>
                  </details>
                )}
                <button
                  disabled={!rfqId || sending === merchant.id}
                  onClick={() => simulate(merchant.id)}
                  className="inline-flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200 py-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
                >
                  {sending === merchant.id ? (
                    <LoaderCircle className="animate-spin" size={14} />
                  ) : (
                    <MessageCircleMore size={14} />
                  )}{" "}
                  Simulate merchant reply
                </button>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ProgressView({
  agentMode,
  audit,
  quotes,
  visibleSteps,
  running,
  originalPrompt,
  summaryTitle,
  backToDashboard,
  finish,
}: {
  agentMode: "openai" | "deterministic_fallback" | "complete";
  audit: AuditEvent[];
  quotes: Quote[];
  visibleSteps: number;
  running: boolean;
  originalPrompt: string;
  summaryTitle: string;
  backToDashboard: () => void;
  finish: () => void;
}) {
  const visible = audit.slice(0, Math.max(visibleSteps + 2, 0));
  return (
    <section className="mx-auto max-w-7xl px-5 pb-12 pt-7 lg:px-8">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Pill tone={agentMode === "openai" ? "blue" : "amber"}>
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" />{" "}
            {agentMode === "openai"
              ? "AI PROCUREMENT"
              : "STRUCTURED FALLBACK"}
          </Pill>
          <h1 className="mt-3 text-3xl font-black tracking-[-0.035em] text-[#072654] sm:text-4xl">
            Finding your best deal
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Up to 5 merchants contacted · every commercial action stays within
            your approval guardrails
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={backToDashboard}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600 shadow-sm hover:bg-slate-50"
          >
            <ArrowLeft size={16} /> All quotations
          </button>
          {!running && visibleSteps > 0 && (
            <button
              onClick={finish}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-[#2b84ea] px-4 py-3 text-sm font-extrabold text-white shadow-[0_8px_18px_rgba(43,132,234,.25)] hover:bg-[#1f6fc4]"
            >
              See normalized offers <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>
      <div className="grid gap-5 lg:grid-cols-[1.1fr_.9fr]">
        <div className="space-y-3">
          {merchants.map((merchant) => {
            const status = merchantProgressState(merchant.id, visibleSteps);
            const quote = quotes.find(
              (item) => item.merchantId === merchant.id,
            );
            const line = quote?.product
              ? `${quoteName(quote)} · ${formatPrice(quote.effectivePrice)} effective · ${quote.deliveryDate ?? "delivery pending"}`
              : "Waiting for a commercially complete response";
            return (
              <div
                key={merchant.id}
                className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5"
              >
                <div className="flex items-start gap-3">
                  <Avatar id={merchant.id} />
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <h2 className="font-extrabold text-slate-800">
                        {merchant.name}
                      </h2>
                      <Pill tone={status.tone}>{status.text}</Pill>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-slate-500">
                      {visibleSteps
                        ? line
                        : "Secure quotation request delivery queued"}
                    </p>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-extrabold text-slate-800">Agent activity</h2>
              <p className="mt-1 text-xs text-slate-400">
                Persisted reasoning and merchant actions
              </p>
            </div>
            {running && (
              <LoaderCircle className="animate-spin text-blue-600" size={18} />
            )}
          </div>
          <div className="mt-5 max-h-[510px] space-y-1 overflow-auto pr-1 hide-scrollbar">
            {visible.length ? (
              visible.map((event, index) => {
                const kind =
                  event.tone === "success"
                    ? "success"
                    : event.tone === "warning"
                      ? "warn"
                      : event.actor === "MERCHANT"
                        ? "reply"
                        : "think";
                return (
                  <div key={event.id} className="relative flex gap-3 py-3">
                    <ProgressDot kind={kind} />
                    {index !== visible.length - 1 && (
                      <span className="absolute left-[13px] top-10 h-[calc(100%-8px)] w-px bg-slate-100" />
                    )}
                    <div>
                      <p className="text-sm font-bold text-slate-700">
                        {event.action}
                      </p>
                      <p className="mt-0.5 text-xs leading-5 text-slate-500">
                        {event.reason}
                      </p>
                      <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-300">
                        {event.time}
                      </p>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="flex h-56 flex-col items-center justify-center text-center text-sm text-slate-400">
                <LoaderCircle
                  className="mb-3 animate-spin text-blue-500"
                  size={22}
                />
                Envoy is choosing the first permitted action…
              </div>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}

function DashboardView({
  requirement,
  agentMode,
  audit,
  quotes,
  conversations,
  rfqId,
  hydrate,
  visibleSteps,
  running,
  originalPrompt,
  summaryTitle,
  backToDashboard,
  finish,
}: {
  requirement: BuyerRequirement;
  agentMode: "openai" | "deterministic_fallback" | "complete";
  audit: AuditEvent[];
  quotes: Quote[];
  conversations: MerchantConversation[];
  rfqId: string | null;
  hydrate: (state: RFQState) => void;
  visibleSteps: number;
  running: boolean;
  originalPrompt: string;
  summaryTitle: string;
  backToDashboard: () => void;
  finish: () => void;
}) {
  const visible = audit.slice(0, Math.max(visibleSteps + 2, 0));
  const rankedQuotes = [...quotes].sort((a, b) => {
    const aValid = a.status === "VALID";
    const bValid = b.status === "VALID";
    if (aValid !== bValid) return aValid ? -1 : 1;
    return aValid
      ? scoreQuote(b, requirement) - scoreQuote(a, requirement) ||
          a.effectivePrice - b.effectivePrice
      : a.merchantId.localeCompare(b.merchantId);
  });
  const qualifyingQuotes = rankedQuotes.filter(
    (quote) => quote.status === "VALID",
  );
  const ranks = new Map(
    qualifyingQuotes.map((quote, index) => [quote.id, index + 1]),
  );
  const bestPrice = qualifyingQuotes.length
    ? Math.min(...qualifyingQuotes.map((quote) => quote.effectivePrice))
    : null;

  return (
    <section className="mx-auto max-w-7xl px-5 pb-12 pt-7 lg:px-8">
      <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <Pill tone="blue"><span className="h-1.5 w-1.5 animate-pulse rounded-full bg-current" /> Live procurement</Pill>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            Getting merchants to compete for you
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Envoy is collecting complete offers, asking follow-up questions, and negotiating where useful.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={backToDashboard}
            className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600 shadow-sm hover:bg-slate-50"
          >
            <ArrowLeft size={16} /> All quotations
          </button>
          {!running && visibleSteps > 0 && (
            <button
              onClick={finish}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#315bd6] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-100 hover:bg-[#294fbe]"
            >
              Compare offers <ArrowRight size={16} />
            </button>
          )}
        </div>
      </div>
      <ProcurementStages visibleSteps={visibleSteps} running={running} />
      <LiveRequestSummary requirement={requirement} summaryTitle={summaryTitle} />
      {!running && qualifyingQuotes[0] && <RankingExplanation quote={qualifyingQuotes[0]} requirement={requirement} />}
      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <DashboardMetric
          label="Merchant responses"
          value={`${quotes.filter((quote) => quote.product).length} / ${merchants.length}`}
        />
        <DashboardMetric
          label="Complete offers"
          value={String(qualifyingQuotes.length)}
          tone="green"
        />
        <DashboardMetric
          label="Best current offer"
          value={bestPrice === null ? "Waiting for quotes" : formatPrice(bestPrice)}
          tone="blue"
        />
      </div>
      <LiveCallStudio quotes={quotes} conversations={conversations} visibleSteps={visibleSteps} />
      <LiveMerchantCards quotes={quotes} conversations={conversations} visibleSteps={visibleSteps} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.55fr)_minmax(300px,.7fr)]">
        <section className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
            <div>
              <h2 className="font-extrabold text-slate-800">
                Ranked quote details
              </h2>
              <p className="mt-0.5 text-xs text-slate-400">
                Qualified offers are ranked by your price, brand, delivery and
                warranty priorities.
              </p>
            </div>
            {running && (
              <LoaderCircle className="animate-spin text-blue-600" size={18} />
            )}
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[780px] text-left">
              <thead className="bg-slate-50 text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
                <tr>
                  <th className="px-5 py-3">Rank</th>
                  <th className="px-3 py-3">Merchant</th>
                  <th className="px-3 py-3">Effective price</th>
                  <th className="px-3 py-3">Delivery</th>
                  <th className="px-3 py-3">Quote details</th>
                  <th className="px-5 py-3 text-right">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {rankedQuotes.map((quote) => {
                  const rank = ranks.get(quote.id);
                  const merchant = merchantById(quote.merchantId);
                  const unavailable = quote.status === "UNAVAILABLE";
                  return (
                    <tr
                      key={quote.id}
                      className={rank === 1 ? "bg-blue-50/50" : ""}
                    >
                      <td className="px-5 py-4">
                        {rank ? (
                          <span
                            className={`grid h-7 w-7 place-items-center rounded-full text-xs font-extrabold ${rank === 1 ? "bg-blue-600 text-white" : "bg-slate-100 text-slate-600"}`}
                          >
                            {rank}
                          </span>
                        ) : (
                          <span className="pl-2 text-sm text-slate-300">—</span>
                        )}
                      </td>
                      <td className="px-3 py-4">
                        <div className="flex items-center gap-2.5">
                          <Avatar id={quote.merchantId} size="small" />
                          <div>
                            <p className="text-sm font-extrabold text-slate-800">
                              {merchant.name}
                            </p>
                            <p className="mt-0.5 text-[11px] text-slate-400">
                              {quote.product
                                ? quoteName(quote)
                                : "No quote received"}
                            </p>
                            <p className="mt-1 text-[10px] font-bold text-emerald-700">Trust {merchantTrust[quote.merchantId].score}/100 · {merchantTrust[quote.merchantId].transactions.toLocaleString("en-IN")} Razorpay-history records</p>
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-4">
                        {unavailable ? (
                          <span className="text-sm text-slate-300">—</span>
                        ) : (
                          <>
                            <p className="text-sm font-extrabold text-slate-800">
                              {formatPrice(quote.effectivePrice)}
                            </p>
                            <p className="mt-0.5 text-[11px] text-slate-400">
                              {formatPrice(quote.basePrice)} −{" "}
                              {formatPrice(quote.exchangeValue)} exchange
                            </p>
                          </>
                        )}
                      </td>
                      <td className="px-3 py-4 text-xs font-semibold text-slate-600">
                        {quote.deliveryDate ?? "Awaiting response"}
                      </td>
                      <td className="px-3 py-4">
                        <p className="text-xs font-semibold text-slate-600">
                          {quote.warranty ?? "Terms pending"}
                        </p>
                        <p className="mt-1 text-[11px] text-slate-400">
                          {quote.gstIncluded
                            ? "GST included"
                            : unavailable
                              ? "No response after retry"
                              : quote.missingFields.length
                                ? `${quote.missingFields.length} details missing`
                                : "GST to confirm"}
                        </p>
                      </td>
                      <td className="px-5 py-4 text-right">
                        {rank ? (
                          <Pill tone={rank === 1 ? "blue" : "green"}>
                            {rank === 1 ? "Best match" : "Qualifies"}
                          </Pill>
                        ) : (
                          <Pill tone={unavailable ? "slate" : "rose"}>
                            {unavailable ? "No response" : "Excluded"}
                          </Pill>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {!rankedQuotes.length && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-5 py-12 text-center text-sm text-slate-400"
                    >
                      Waiting for merchant quotes to arrive…
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
        <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-extrabold text-slate-800">Agent activity</h2>
              <p className="mt-1 text-xs text-slate-400">
                Decisions and merchant actions
              </p>
            </div>
            {running && (
              <LoaderCircle className="animate-spin text-blue-600" size={18} />
            )}
          </div>
          <div className="mt-5 max-h-[510px] space-y-1 overflow-auto pr-1 hide-scrollbar">
            {visible.length ? (
              visible.map((event, index) => {
                const kind =
                  event.tone === "success"
                    ? "success"
                    : event.tone === "warning"
                      ? "warn"
                      : event.actor === "MERCHANT"
                        ? "reply"
                        : "think";
                return (
                  <div key={event.id} className="relative flex gap-3 py-3">
                    <ProgressDot kind={kind} />
                    {index !== visible.length - 1 && (
                      <span className="absolute left-[13px] top-10 h-[calc(100%-8px)] w-px bg-slate-100" />
                    )}
                    <div>
                      <p className="text-sm font-bold text-slate-700">
                        {event.action}
                      </p>
                      <p className="mt-0.5 text-xs leading-5 text-slate-500">
                        {event.reason}
                      </p>
                      <p className="mt-1 text-[10px] font-bold uppercase tracking-wider text-slate-300">
                        {event.time}
                      </p>
                    </div>
                  </div>
                );
              })
            ) : (
              <div className="flex h-56 flex-col items-center justify-center text-center text-sm text-slate-400">
                <LoaderCircle
                  className="mb-3 animate-spin text-blue-500"
                  size={22}
                />
                Envoy is choosing the first permitted action…
              </div>
            )}
          </div>
        </section>
      </div>
    </section>
  );
}

function RankingExplanation({ quote, requirement }: { quote: Quote; requirement: BuyerRequirement }) {
  const score = rankingBreakdown(quote, requirement);
  if (!score) return null;
  const trust = merchantTrust[quote.merchantId];
  return <section className="mb-5 rounded-2xl border border-emerald-100 bg-emerald-50/60 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="text-[10px] font-extrabold uppercase tracking-wider text-emerald-700">Why #1 ranks first</p><h2 className="mt-1 text-lg font-extrabold text-slate-900">Best balance of price, trust, and delivery</h2><p className="mt-1 text-xs text-slate-600">{merchantById(quote.merchantId).name} stays within your guardrails and leads on the weighted decision factors.</p></div><Pill tone="green">Score {score.total}</Pill></div><div className="mt-4 grid gap-2 sm:grid-cols-4">{[["Price", score.price], ["Trust", score.trust], ["Delivery", score.delivery], ["Warranty & match", score.warranty + score.brand]].map(([label, value]) => <div key={String(label)} className="rounded-xl bg-white px-3 py-2"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{label}</p><p className="mt-1 text-sm font-extrabold text-slate-800">{Number(value).toFixed(1)} pts</p></div>)}</div><p className="mt-3 text-[11px] text-emerald-800">Trust score: {trust.score}/100 from {trust.transactions.toLocaleString("en-IN")} simulated Razorpay transaction records · {trust.label}. Production use requires authorised merchant-history access.</p></section>;
}

function ProcurementStages({ visibleSteps, running }: { visibleSteps: number; running: boolean }) {
  const active = !running ? 3 : visibleSteps < 2 ? 0 : visibleSteps < 6 ? 1 : 2;
  return <div className="mb-5 flex flex-wrap gap-2">{["Find merchants", "Collect quotes", "Negotiate", "Compare"].map((label, index) => <span key={label} className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${index < active ? "bg-emerald-50 text-emerald-700" : index === active ? "bg-blue-50 text-blue-700" : "bg-slate-100 text-slate-400"}`}><b>{index < active ? "✓" : index === active ? "●" : "○"}</b>{label}</span>)}</div>;
}

function LiveRequestSummary({ requirement, summaryTitle }: { requirement: BuyerRequirement; summaryTitle: string }) {
  const item = requirement.productDescription.replace(/\s*Additional quotation details:[\s\S]*/i, "").trim();
  return <section className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 shadow-sm"><div><p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Your request</p><h2 className="mt-1 text-sm font-extrabold text-slate-800">{summaryTitle || item}</h2><p className="mt-1 text-xs text-slate-500">{requirement.deliveryCity} · {requirement.deliveryBy ? `Need by ${requirement.deliveryBy}` : "Flexible delivery"}</p></div><p className="text-sm font-extrabold text-slate-800">{formatPrice(requirement.maxBudget)} <span className="text-[10px] font-semibold text-slate-400">budget</span></p></section>;
}

function LiveCallStudio({ quotes, conversations, visibleSteps }: { quotes: Quote[]; conversations: MerchantConversation[]; visibleSteps: number }) {
  const featuredMerchant = merchants.find((merchant) => conversations.some((turn) => turn.merchantId === merchant.id)) ?? merchants[0];
  const featuredTurns = conversations.filter((turn) => turn.merchantId === featuredMerchant.id).filter((turn) => turn.direction !== "SYSTEM");
  const featuredQuote = quotes.find((quote) => quote.merchantId === featuredMerchant.id);
  const status = merchantProgressState(featuredMerchant.id, visibleSteps);
  const nextAction = featuredQuote?.status === "VALID" && featuredQuote.missingFields.length === 0 ? "Final terms are ready to compare." : featuredQuote?.missingFields.length ? `Confirm ${featuredQuote.missingFields.slice(0, 2).join(" and ")}.` : featuredTurns.length ? "Awaiting the merchant’s next response." : "Waiting for the merchant to acknowledge the RFQ.";
  return <section className="mb-5 overflow-hidden rounded-[18px] border border-[#cfe3fb] bg-white shadow-[0_14px_32px_rgba(7,38,84,.08)]" aria-label="Live merchant conversation">
    <div className="flex flex-wrap items-center justify-between gap-3 bg-[#072654] px-5 py-3 text-white"><div className="flex items-center gap-2"><span className="h-2.5 w-2.5 animate-pulse rounded-full bg-emerald-400" /><span className="text-xs font-extrabold uppercase tracking-[.08em]">Agent call studio</span></div><span className="text-[11px] font-bold text-blue-200">{featuredMerchant.name} · {status.text}</span></div>
    <div className="grid lg:grid-cols-[.82fr_1.2fr_.82fr]">
          <div className="border-b border-[#e7eff9] p-5 lg:border-b-0 lg:border-r"><p className="text-[10px] font-extrabold uppercase tracking-[.1em] text-[#6b83a4]">Call objective</p><div className="mt-4 flex items-center gap-3"><Avatar id={featuredMerchant.id} /><div><p className="font-extrabold text-[#072654]">{featuredMerchant.name}</p><p className="text-xs text-[#5f718d]">{featuredTurns.at(-1)?.channel === "VOICE" ? "Voice conversation" : "WhatsApp-first negotiation"}</p></div></div><div className="mt-5 rounded-xl bg-[#edf6ff] p-3 text-xs font-bold leading-5 text-[#174a8b]">Confirm commercial terms, uncover the blocker, and request the strongest permitted improvement.</div><p className="mt-4 text-xs font-semibold text-[#5f718d]">Envoy is working within your approved limits.</p></div>
      <div className="border-b border-[#e7eff9] p-5 lg:border-b-0 lg:border-r"><div className="flex items-center justify-between"><p className="text-[10px] font-extrabold uppercase tracking-[.1em] text-[#6b83a4]">Live conversation</p><span className="text-[10px] font-bold text-emerald-600">RECORDED</span></div><div className="mt-4 space-y-3">{featuredTurns.length ? featuredTurns.slice(-4).map((turn) => <div key={turn.id} className={`max-w-[92%] rounded-xl px-3 py-2.5 text-xs leading-5 ${turn.direction === "MERCHANT" ? "mr-auto bg-[#f4f7fb] text-[#29415f]" : "ml-auto bg-[#2b84ea] text-white"}`}><b>{turn.direction === "MERCHANT" ? featuredMerchant.name : "Envoy"}</b><br />{turn.text}</div>) : <div className="rounded-xl bg-[#f4f7fb] p-4 text-xs leading-5 text-[#5f718d]">The agent will introduce itself, verify the offer, and ask the first commercial question when outreach starts.</div>}</div></div>
      <div className="p-5"><p className="text-[10px] font-extrabold uppercase tracking-[.1em] text-[#6b83a4]">Decision visibility</p><div className="mt-4 space-y-3 text-xs"><div className="rounded-xl bg-[#f4f7fb] p-3"><span className="font-bold text-[#6b83a4]">CURRENT PAYABLE</span><p className="mt-1 text-xl font-extrabold text-[#072654]">{featuredQuote?.product ? formatPrice(featuredQuote.effectivePrice) : "Pending quote"}</p></div><div className="rounded-xl border border-amber-100 bg-amber-50 p-3"><span className="font-bold text-amber-700">NEXT ACTION</span><p className="mt-1 font-semibold leading-5 text-amber-950">{nextAction}</p></div><div className="rounded-xl border border-emerald-100 bg-emerald-50 p-3"><span className="font-bold text-emerald-700">OUTCOME</span><p className="mt-1 font-semibold leading-5 text-emerald-950">Every answer and counteroffer is saved to the buyer audit trail.</p></div></div></div>
    </div>
  </section>;
}

function LiveMerchantCards({ quotes, conversations, visibleSteps }: { quotes: Quote[]; conversations: MerchantConversation[]; visibleSteps: number }) {
  const [expandedMerchantId, setExpandedMerchantId] = useState<MerchantId | null>(null);
  return (
    <section className="mb-5">
      <div className="mb-3 flex items-end justify-between"><div><h2 className="font-extrabold text-slate-800">Merchant activity</h2><p className="mt-0.5 text-xs text-slate-400">Envoy is handling outreach and follow-ups within your approved limits.</p></div><span className="text-xs font-bold text-blue-700">Finding suitable merchants…</span></div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {merchants.map((merchant) => {
          const quote = quotes.find((item) => item.merchantId === merchant.id);
          const status = merchantProgressState(merchant.id, visibleSteps);
          const turns = conversations.filter((turn) => turn.merchantId === merchant.id);
          const latest = turns.at(-1);
          const expanded = expandedMerchantId === merchant.id;
          const complete = quote?.status === "VALID" && quote.missingFields.length === 0;
          const disqualified = quote?.status === "DISQUALIFIED";
          const confirmedTerms = [quote?.quotedQuantity, quote?.deliveryDate, quote?.gstIncluded].filter(Boolean).length;
          const improvement = quote?.previousEffectivePrice ? Math.max(0, quote.previousEffectivePrice - quote.effectivePrice) : 0;
          const visibleTurns = turns.filter((turn) => turn.direction !== "SYSTEM");
          const priorityPattern = improvement > 0 ? /discount|improv|better|final|best/i : disqualified ? /cannot|can’t|can't|unable|delivery|late|earliest/i : /gst|delivery|include|confirm|quantity|final/i;
          const focusedIndex = visibleTurns.map((turn) => priorityPattern.test(turn.text)).lastIndexOf(true);
          const previewStart = focusedIndex < 0 ? Math.max(0, visibleTurns.length - 2) : visibleTurns[focusedIndex].direction === "MERCHANT" ? Math.max(0, focusedIndex - 1) : focusedIndex;
          const previewTurns = visibleTurns.slice(previewStart, previewStart + (status.text === "Clarifying details" ? 3 : 2));
          const agentStatus = complete ? "Ready to compare" : disqualified ? `Excluded — ${quote?.missingFields[0] ?? "delivery requirement not met"}` : status.text === "No response" ? "No response after one retry" : quote?.missingFields.length ? `Confirming ${quote.missingFields.slice(0, 2).join(" and ")}` : turns.length ? "Confirming delivery and GST" : "Waiting for merchant response";
          return <article key={merchant.id} className={`rounded-2xl border bg-white p-4 shadow-sm ${expanded ? "md:col-span-2 xl:col-span-3" : ""} ${disqualified ? "border-rose-100" : complete ? "border-emerald-200" : "border-slate-200"}`}>
            <div className="flex items-start justify-between gap-3"><div className="flex items-center gap-3"><Avatar id={merchant.id} size="small" /><div><h3 className="font-extrabold text-slate-800">{merchant.name}</h3><p className="mt-0.5 text-[10px] font-bold uppercase tracking-wider text-slate-400">Demo merchant</p></div></div><Pill tone={disqualified ? "rose" : complete ? "green" : status.tone}>{disqualified ? "Doesn’t qualify" : complete ? "Complete offer" : status.text}</Pill></div>
            {quote?.product ? <div className="mt-4 rounded-xl bg-slate-50 p-3"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Current offer</p><p className="mt-1 text-lg font-extrabold text-slate-900">{formatPrice(quote.effectivePrice)} <span className="text-[10px] font-semibold text-slate-400">delivered</span></p><div className="mt-2 flex flex-wrap gap-x-3 gap-y-1 text-xs text-slate-600">{quote.quotedQuantity && <span>✓ {quote.quotedQuantity.toLocaleString("en-IN")} units</span>}<span>✓ {quote.deliveryDate ?? "Delivery being confirmed"}</span><span>✓ {quote.gstIncluded ? "GST included" : "GST to confirm"}</span></div></div> : <div className="mt-4 rounded-xl bg-slate-50 p-3 text-xs text-slate-500">{visibleSteps < 2 ? "Selected for product and delivery fit." : "RFQ sent · waiting for merchant response."}</div>}
            {improvement > 0 && <p className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">{formatPrice(quote!.previousEffectivePrice!)} → {formatPrice(quote!.effectivePrice)} · {formatPrice(improvement)} improvement secured</p>}
            <p className={`mt-3 text-xs font-semibold ${disqualified ? "text-rose-700" : "text-slate-600"}`}>{agentStatus}</p>
            {previewTurns.length ? <div className="mt-3 rounded-xl border border-slate-100 px-3 py-2.5"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Conversation preview</p><div className="mt-2 space-y-1.5">{previewTurns.map((turn) => <p key={turn.id} className={`line-clamp-2 rounded-lg px-2.5 py-1.5 text-[11px] leading-4 ${turn.direction === "MERCHANT" ? "bg-slate-100 text-slate-700" : "bg-blue-50 text-blue-950"}`}><b>{turn.direction === "MERCHANT" ? merchant.name : "Envoy"}:</b> {turn.text}</p>)}</div>{confirmedTerms > 0 && <p className="mt-2 text-[10px] font-semibold text-emerald-700">{confirmedTerms} terms confirmed from this conversation</p>}</div> : null}
            {turns.length ? <><p className="mt-3 text-[11px] text-slate-400">{turns.length} messages · {confirmedTerms} terms confirmed{improvement > 0 ? " · 1 negotiation round" : ""}</p><button type="button" onClick={() => setExpandedMerchantId(expanded ? null : merchant.id)} aria-expanded={expanded} className="mt-3 text-xs font-bold text-blue-700 hover:text-blue-900">{expanded ? "Hide conversation" : `View full conversation · ${turns.length} messages`}</button></> : <div className="mt-3 rounded-xl border border-slate-100 px-3 py-2.5 text-[11px] text-slate-500"><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Outreach sent</p><p className="mt-1">{visibleSteps ? "No merchant response after 1 permitted retry." : "Envoy will send the approved request shortly."}</p></div>}
            {expanded && <div className="mt-4 border-t border-slate-100 pt-4"><p className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Full conversation</p><div className="mt-3 space-y-3">{turns.map((turn) => <div key={turn.id} className={`max-w-3xl rounded-xl px-3 py-2.5 text-xs leading-5 ${turn.direction === "MERCHANT" ? "mr-auto bg-slate-100 text-slate-700" : "ml-auto bg-blue-50 text-blue-950"}`}><b>{turn.direction === "MERCHANT" ? merchant.name : "Envoy"}</b><p>{turn.text}</p><span className="mt-1 block text-[10px] opacity-60">{new Date(turn.at).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit" })}</span></div>)}</div><div className="mt-4 grid gap-2 rounded-xl bg-slate-50 p-3 text-xs sm:grid-cols-3"><span><b>Price:</b> {quote ? `${formatPrice(quote.effectivePrice)} delivered` : "Awaiting quote"}</span><span><b>Delivery:</b> {quote?.deliveryDate ?? "Awaiting confirmation"}</span><span><b>GST:</b> {quote?.gstIncluded ? "Included" : "To confirm"}</span></div></div>}
          </article>;
        })}
      </div>
    </section>
  );
}

function MerchantProductGallery({ quotes }: { quotes: Quote[] }) {
  const proposals = quotes.filter((quote) => quote.product && quote.status !== "UNAVAILABLE");
  if (!proposals.length) return null;
  return (
    <section className="mb-5">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-extrabold text-slate-800">Merchant product proposals</h2>
          <p className="mt-0.5 text-xs text-slate-400">Compare the exact model, product facts, stock, and commercial terms — not only the total price.</p>
        </div>
        <Pill tone="blue"><PackageCheck size={12} /> Structured listings</Pill>
      </div>
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        {proposals.map((quote) => {
          const merchant = merchantById(quote.merchantId);
          return (
            <article key={quote.id} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm">
              <div className="relative h-40 bg-slate-100">
                {quote.product?.imageUrl ? (
                  <img src={quote.product.imageUrl} alt={`${quote.product.title} proposed by ${merchant.name}`} className="h-full w-full object-cover" />
                ) : (
                  <div className="grid h-full place-items-center bg-gradient-to-br from-blue-50 to-slate-100 text-center"><PackageCheck className="text-blue-500" size={28} /><p className="-mt-8 px-6 text-xs font-bold text-slate-500">Merchant image requested with the listing</p></div>
                )}
                <span className="absolute left-3 top-3 rounded-full bg-slate-950/80 px-2 py-1 text-[9px] font-extrabold text-white">{quote.source === "SIMULATED" ? "SIMULATED LISTING" : "MERCHANT LISTING"}</span>
              </div>
              <div className="p-4">
                <div className="flex items-start justify-between gap-2"><div><p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">{merchant.name}</p><h3 className="mt-1 text-sm font-extrabold text-slate-800">{quote.product?.title}</h3></div><Avatar id={quote.merchantId} size="small" /></div>
                <p className="mt-1 text-xs font-semibold text-slate-500">{quote.product?.model ?? "Exact model pending"}</p>
                <div className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 border-t border-slate-100 pt-3 text-[11px]"><div><p className="font-bold text-slate-400">QUANTITY</p><p className="mt-0.5 font-bold text-slate-700">{quote.quotedQuantity?.toLocaleString("en-IN") ?? "—"} units</p></div><div><p className="font-bold text-slate-400">UNIT PRICE</p><p className="mt-0.5 font-bold text-slate-700">{quote.unitPrice ? formatPrice(quote.unitPrice) : "—"}</p></div><div><p className="font-bold text-slate-400">STOCK</p><p className="mt-0.5 font-bold text-slate-700">{quote.product?.availableQuantity?.toLocaleString("en-IN") ?? "To confirm"}</p></div><div><p className="font-bold text-slate-400">MOQ</p><p className="mt-0.5 font-bold text-slate-700">{quote.product?.minimumOrderQuantity ?? "—"} units</p></div></div>
                <p className="mt-3 line-clamp-2 text-[11px] leading-5 text-slate-500">{quote.product?.specifications?.join(" · ") ?? "Merchant is confirming the product specifications."}</p>
                <p className="mt-3 text-sm font-extrabold text-slate-900">{formatPrice(quote.effectivePrice)} <span className="text-[10px] font-semibold text-slate-400">final payable</span></p>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function RequestContextCard({
  summaryTitle,
  originalPrompt,
}: {
  summaryTitle: string;
  originalPrompt: string;
}) {
  const [expanded, setExpanded] = useState(false);
  const request =
    originalPrompt || "Original request is unavailable for this saved RFQ.";
  return (
    <section className="mb-5 rounded-2xl border border-blue-100 bg-blue-50/50 p-4 shadow-sm">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
        <div>
          <p className="text-[10px] font-extrabold uppercase tracking-wider text-blue-600">
            Your request
          </p>
          <h2 className="mt-1 text-lg font-extrabold text-slate-900">
            {summaryTitle || "Quotation request"}
          </h2>
          <p
            className={`mt-2 max-w-3xl text-sm leading-6 text-slate-600 ${expanded ? "" : "line-clamp-2"}`}
          >
            {request}
          </p>
        </div>
        <button
          onClick={() => setExpanded((value) => !value)}
          className="shrink-0 text-xs font-bold text-blue-700 hover:text-blue-900"
        >
          {expanded ? "Show less" : "View original request"}
        </button>
      </div>
    </section>
  );
}

function DashboardMetric({
  label,
  value,
  tone = "slate",
}: {
  label: string;
  value: string;
  tone?: "slate" | "green" | "blue";
}) {
  const colors = {
    slate: "border-slate-200 bg-white text-slate-900",
    green: "border-emerald-100 bg-emerald-50/50 text-emerald-900",
    blue: "border-blue-100 bg-blue-50/50 text-blue-950",
  };
  return (
    <div className={`rounded-2xl border p-4 shadow-sm ${colors[tone]}`}>
      <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">
        {label}
      </p>
      <p className="mt-1 text-2xl font-extrabold">{value}</p>
    </div>
  );
}

function OffersView({
  requirement,
  quotes,
  recommended,
  rfqId,
  choose,
}: {
  requirement: BuyerRequirement;
  quotes: Quote[];
  recommended: Quote;
  rfqId: string | null;
  choose: () => void;
}) {
  const displayQuotes = quotes.filter(
    (quote) => quote.merchantId !== "hometech",
  );
  const merchant = merchantById(recommended.merchantId);
  const qualifyingCount = quotes.filter((quote) => quote.status === "VALID").length;
  const requestName = (requirement.productDescription || requirement.category || "Requested product")
    .replace(/product-or-service-city/gi, "Requested product")
    .replace(/additional quotation details\s*:.*/i, "")
    .trim();
  const quantity = recommended.quotedQuantity ?? Number(`${requirement.productDescription} ${requirement.specifications.join(" ")}`.match(/\b(\d{1,5})\s*(?:units?|pieces?|chairs?|tables?|bottles?|shakers?)\b/i)?.[1] ?? 0);
  const runnerUp = displayQuotes.filter((quote) => quote.status === "VALID" && quote.id !== recommended.id).sort((a, b) => a.effectivePrice - b.effectivePrice)[0];
  const cheaperRejected = displayQuotes.filter((quote) => quote.status === "DISQUALIFIED" && quote.effectivePrice < recommended.effectivePrice).sort((a, b) => a.effectivePrice - b.effectivePrice)[0];
  const negotiatedAmount = recommended.previousEffectivePrice ? Math.max(0, recommended.previousEffectivePrice - recommended.effectivePrice) : 0;
  const [productImage, setProductImage] = useState<string | null>(null);
  const [imageState, setImageState] = useState<"loading" | "ready" | "unavailable">("loading");
  const imageKey = `${requestName}|${requirement.specifications.join("|")}`;

  useEffect(() => {
    let active = true;
    const cached = window.sessionStorage.getItem(`quoteai-product-image:${imageKey}`);
    if (cached) {
      setProductImage(cached);
      setImageState("ready");
      return () => { active = false; };
    }
    setProductImage(null);
    setImageState("loading");
    fetch("/api/agent/product-image", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: requestName, specifications: requirement.specifications }),
    })
      .then((response) => response.ok ? response.json() : Promise.reject())
      .then((data: { imageUrl?: string }) => {
        if (!active || !data.imageUrl) return;
        setProductImage(data.imageUrl);
        setImageState("ready");
        // Product images can exceed browser storage quotas. Rendering must not
        // depend on this optional per-session cache succeeding.
        try {
          window.sessionStorage.setItem(`quoteai-product-image:${imageKey}`, data.imageUrl);
        } catch {
          // The image remains visible for this render even when it cannot be cached.
        }
      })
      .catch(() => active && setImageState("unavailable"));
    return () => { active = false; };
  }, [imageKey, requestName, requirement.specifications]);
  return (
    <section className="mx-auto max-w-7xl px-5 pb-12 pt-7 lg:px-8">
      <div className="flex flex-col justify-between gap-5 sm:flex-row sm:items-end">
        <div>
          <Pill tone="green">
            <Check size={12} />{" "}
            {qualifyingCount}{" "}
            qualifying offers found
          </Pill>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900 sm:text-4xl">
            Best executable offer found
          </h1>
          <p className="mt-2 text-sm text-slate-500">
            Envoy compared merchant-confirmed terms against your approved requirements.
          </p>
        </div>
        <button
          onClick={() =>
            document
              .getElementById("agent-chat")
              ?.scrollIntoView({ behavior: "smooth" })
          }
          className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-bold text-slate-600 shadow-sm hover:bg-slate-50"
        >
          <MessageCircleMore size={16} /> Ask merchant
        </button>
      </div>
      <div className="mt-7">
        <div className="space-y-4">
          <article className="overflow-hidden rounded-[24px] border-2 border-blue-200 bg-white shadow-float">
            <div className="bg-gradient-to-r from-blue-600 to-[#5079e7] px-6 py-4 text-white">
              <div className="flex items-center justify-between gap-3">
                <span className="inline-flex items-center gap-1.5 text-xs font-extrabold uppercase tracking-wider">
                  <Sparkles size={14} /> Recommended
                </span>
                <span className="rounded-full bg-white/15 px-2.5 py-1 text-[11px] font-bold">Merchant-confirmed offer</span>
              </div>
            </div>
            <div className="p-5 sm:p-6">
              <div className="grid gap-5 lg:grid-cols-[190px_1fr_.72fr] lg:items-start">
                <div className="overflow-hidden rounded-2xl border border-slate-100 bg-slate-50">
                  {productImage ? <img src={productImage} alt={requestName} className="h-48 w-full object-cover" /> : <div className="grid h-48 place-items-center bg-gradient-to-br from-blue-50 to-slate-100 px-5 text-center text-xs font-semibold text-slate-500">{imageState === "loading" ? "Loading product image..." : "Product visual unavailable"}</div>}
                </div>
                <div>
                  <p className="text-[11px] font-bold uppercase tracking-wider text-blue-700">Product details</p>
                  <h2 className="mt-1 text-xl font-extrabold text-slate-900">{requestName}</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {requirement.specifications.slice(0, 4).map((specification) => <span key={specification} className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600">{specification}</span>)}
                    {quantity > 0 && <span className="rounded-lg bg-slate-100 px-2.5 py-1.5 text-xs font-semibold text-slate-600">{quantity.toLocaleString("en-IN")} units</span>}
                  </div>
                </div>
                <div className="rounded-2xl bg-slate-50 p-4 lg:text-right">
                  <div className="flex items-center gap-2 lg:justify-end"><Avatar id={recommended.merchantId} size="small" /><span className="text-sm font-extrabold text-slate-800">{merchant.name}</span></div>
                  <p className="mt-4 text-3xl font-extrabold tracking-tight text-slate-900">{formatPrice(recommended.effectivePrice)}</p>
                  <p className="mt-1 text-xs font-semibold text-slate-500">Total delivered cost</p>
                  <div className="mt-3 flex flex-wrap gap-2 lg:justify-end"><Pill tone="green"><PackageCheck size={12} /> {recommended.deliveryDate ?? "Delivery confirmed"}</Pill><Pill>{recommended.gstIncluded ? "GST included" : "GST confirmed separately"}</Pill></div>
                </div>
              </div>
              <div className="mt-5 grid gap-3 border-y border-slate-100 py-4 text-sm sm:grid-cols-3">
                <span className="flex items-center gap-2 font-semibold text-slate-600">
                  <CheckCircle2 size={15} className="text-emerald-500" />{" "}
                  Meets every hard requirement
                </span>
                <span className="flex items-center gap-2 font-semibold text-slate-600">
                  <CheckCircle2 size={15} className="text-emerald-500" />{" "}
                  {quantity ? `${quantity.toLocaleString("en-IN")} units confirmed` : "Quantity confirmed"}
                </span>
                <span className="flex items-center gap-2 font-semibold text-slate-600">
                  <CheckCircle2 size={15} className="text-emerald-500" />{" "}
                  Delivery requirement satisfied
                </span>
              </div>
              {negotiatedAmount > 0 && <div className="mt-4 rounded-xl border border-emerald-100 bg-emerald-50/70 px-4 py-3 text-sm"><p className="font-extrabold text-emerald-900">Envoy negotiated {formatPrice(negotiatedAmount)} off</p><p className="mt-1 text-xs text-emerald-800">Initial offer {formatPrice(recommended.previousEffectivePrice!)} → final offer {formatPrice(recommended.effectivePrice)}</p></div>}
              <div className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <p className="max-w-md text-sm leading-6 text-slate-600">
                  <b className="text-slate-800">Why this wins:</b> {merchant.name} is the lowest-cost offer that satisfies all of your required conditions.
                </p>
                <div className="shrink-0"><button onClick={choose} className="inline-flex w-full items-center justify-center gap-2 rounded-xl bg-[#315bd6] px-4 py-3 text-sm font-bold text-white shadow-lg shadow-blue-100 hover:bg-[#294fbe]">Choose {merchant.name} <ChevronRight size={16} /></button><p className="mt-2 text-center text-[11px] text-slate-400">Next: confirm final terms and approve payment.</p></div>
              </div>
            </div>
          </article>
          {rfqId && <MerchantQAPanel rfqId={rfqId} quote={recommended} merchantName={merchant.name} />}
          {(runnerUp || cheaperRejected) && <section>
            <h2 className="text-lg font-extrabold text-slate-900">Why this wins</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {runnerUp && <div className="rounded-2xl border border-slate-200 bg-white p-4 text-sm text-slate-600"><b className="text-slate-800">{merchant.name}</b> is {formatPrice(runnerUp.effectivePrice - recommended.effectivePrice)} less than {merchantById(runnerUp.merchantId).name}&apos;s other qualifying offer.</div>}
              {cheaperRejected && <div className="rounded-2xl border border-amber-100 bg-amber-50/60 p-4 text-sm text-amber-900"><b>{merchantById(cheaperRejected.merchantId).name}</b> is {formatPrice(recommended.effectivePrice - cheaperRejected.effectivePrice)} cheaper, but doesn&apos;t meet a confirmed requirement.</div>}
            </div>
          </section>}
          <section>
            <h2 className="text-lg font-extrabold text-slate-900">Other offers</h2>
            <p className="mt-1 text-sm text-slate-500">Comparable offers and clear reasons for exclusions.</p>
          <div className="grid gap-4 md:grid-cols-2">
            {displayQuotes
              .filter((quote) => quote.id !== recommended.id)
              .map((quote) => (
                <OfferCard key={quote.id} quote={quote} recommendedPrice={recommended.effectivePrice} />
              ))}
          </div>
          </section>
        </div>
      </div>
    </section>
  );
}

function OfferCard({ quote, recommendedPrice }: { quote: Quote; recommendedPrice: number }) {
  const merchant = merchantById(quote.merchantId);
  const disqualified = quote.status === "DISQUALIFIED";
  return (
    <article
      className={`rounded-2xl border bg-white p-5 shadow-sm ${disqualified ? "border-slate-200 opacity-80" : "border-slate-200"}`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex gap-2.5">
          <Avatar id={quote.merchantId} size="small" />
          <div>
            <h3 className="text-sm font-extrabold text-slate-800">
              {merchant.name}
            </h3>
            <p className="mt-0.5 text-[11px] text-slate-400">Merchant-confirmed terms</p>
          </div>
        </div>
        {disqualified ? (
          <Pill tone="rose">Disqualified</Pill>
        ) : (
          <Pill tone="green">Qualifies</Pill>
        )}
      </div>
      <div className="mt-5 flex items-end justify-between">
        <div>
          <p className="text-2xl font-extrabold tracking-tight text-slate-800">
            {formatPrice(quote.effectivePrice)}
          </p>
          <p className="mt-1 text-[11px] text-slate-400">Total delivered cost</p>
        </div>
        {!disqualified && quote.effectivePrice > recommendedPrice && <span className="text-xs font-bold text-slate-500">{formatPrice(quote.effectivePrice - recommendedPrice)} more</span>}
      </div>
      <p
        className={`mt-4 border-t pt-3 text-xs leading-5 ${disqualified ? "text-rose-600" : "text-slate-500"}`}
      >
        {disqualified
          ? `${quote.effectivePrice < recommendedPrice ? `${formatPrice(recommendedPrice - quote.effectivePrice)} cheaper, but ` : ""}doesn’t meet a confirmed requirement${quote.missingFields.length ? `: ${quote.missingFields[0]}` : "."}`
          : `${quote.deliveryDate ?? "Delivery confirmed"} · All requirements met`}
      </p>
    </article>
  );
}

function ReviewIntelligence({ quote }: { quote: Quote }) {
  const title = quoteName(quote);
  const summary = `AI-generated demo summary for ${title}: reviewers commonly value the product match, capacity, and day-to-day convenience. Before buying, confirm the exact model revision, installation conditions, and service coverage with the merchant. This is a demo synthesis, not verified live review analysis.`;
  const speak = () => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(summary));
  };
  return <section className="rounded-2xl border border-violet-100 bg-violet-50/50 p-5"><div className="flex flex-wrap items-start justify-between gap-3"><div><Pill tone="blue"><Sparkles size={12} /> AI-generated review summary</Pill><h2 className="mt-3 text-lg font-extrabold text-slate-900">What reviewers say about this model</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">{summary}</p></div><button onClick={speak} className="inline-flex items-center gap-2 rounded-xl border border-violet-200 bg-white px-3 py-2 text-xs font-bold text-violet-700 hover:bg-violet-50"><Headphones size={15} /> Play audio digest</button></div><div className="mt-4 grid gap-3 sm:grid-cols-3"><div className="rounded-xl bg-white p-3"><p className="text-[10px] font-bold uppercase text-emerald-600">Positive themes</p><p className="mt-1 text-xs font-semibold text-slate-700">Product match · daily usability</p></div><div className="rounded-xl bg-white p-3"><p className="text-[10px] font-bold uppercase text-amber-600">Confirm before purchase</p><p className="mt-1 text-xs font-semibold text-slate-700">Exact SKU · installation · service</p></div><div className="rounded-xl bg-white p-3"><p className="text-[10px] font-bold uppercase text-slate-500">Sentiment display</p><div className="mt-2 flex h-2 overflow-hidden rounded-full bg-slate-100"><span className="w-[72%] bg-emerald-400" /><span className="w-[18%] bg-amber-400" /><span className="w-[10%] bg-rose-400" /></div><p className="mt-1 text-[10px] text-slate-500">Demo visualization · sources required for live values</p></div></div><div className="mt-4 flex flex-wrap gap-2 text-xs font-bold"><a target="_blank" rel="noreferrer" href="https://www.youtube.com/watch?v=XQRRs89_oko" className="rounded-lg bg-slate-900 px-3 py-2 text-white">Watch RT58 model review</a><a target="_blank" rel="noreferrer" href="https://www.samsung.com/bg/support/model/RT58K710RSL/EO/" className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700">Official model support</a><a target="_blank" rel="noreferrer" href={`https://www.youtube.com/results?search_query=${encodeURIComponent(`${quote.product?.model ?? quote.product?.title ?? ""} review`)}`} className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-slate-700">Find more real review videos</a></div><p className="mt-3 text-[10px] leading-4 text-slate-400">The audio digest uses your browser’s text-to-speech. It is explicitly a generated summary, not a fabricated performance video. Live sentiment needs licensed review sources and citations.</p></section>;
}

function ApprovalModal({
  quote,
  requirement,
  paymentState,
  close,
  pay,
}: {
  quote: Quote;
  requirement: BuyerRequirement;
  paymentState: "idle" | "loading" | "unavailable" | "failed";
  close: () => void;
  pay: () => void;
}) {
  const failure = paymentState === "failed";
  const unavailable = paymentState === "unavailable";
  const merchant = merchantById(quote.merchantId);
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 backdrop-blur-sm sm:items-center sm:p-5">
      <div className="w-full max-w-lg animate-fade-up rounded-t-[28px] bg-white p-6 shadow-2xl sm:rounded-[28px]">
        <div className="flex items-start justify-between">
          <div>
            {failure ? (
              <Pill tone="rose">
                <CircleAlert size={12} /> Payment failure handled
              </Pill>
            ) : (
              <Pill tone="blue">
                <LockKeyhole size={12} /> Buyer approval required
              </Pill>
            )}
            <h2 className="mt-3 text-2xl font-extrabold tracking-tight text-slate-900">
              {failure ? "Payment didn’t go through" : "Confirm purchase"}
            </h2>
            <p className="mt-1 text-sm text-slate-500">
              {failure
                ? "Your offer remains reserved. No purchase was confirmed."
                : unavailable
                  ? "Razorpay Test Mode is not configured. Add server-side test keys to enable live checkout."
                  : "Review final merchant-confirmed terms before payment."}
            </p>
          </div>
          <button
            onClick={close}
            className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"
          >
            <X size={18} />
          </button>
        </div>
        {!failure && (
          <div className="mt-6 rounded-2xl bg-slate-50 p-4">
            <div className="flex items-center gap-3">
              <Avatar id={quote.merchantId} />
              <div>
                <p className="font-extrabold text-slate-800">{merchant.name}</p>
                <p className="text-xs text-slate-500">{quoteName(quote)}</p>
              </div>
              <p className="ml-auto text-xl font-extrabold text-slate-900">
                {formatPrice(quote.effectivePrice)}
              </p>
            </div>
            <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3 border-t border-slate-200 pt-4 text-xs">
              <span className="text-slate-400">
                Delivery{" "}
                <b className="float-right text-slate-700">
                  {quote.deliveryDate}
                </b>
              </span>
              <span className="text-slate-400">
                Exchange{" "}
                <b className="float-right text-slate-700">
                  {formatPrice(quote.exchangeValue)}
                </b>
              </span>
              <span className="text-slate-400">
                Service{" "}
                <b className="float-right text-slate-700">
                  {quote.installationIncluded ? "Included" : "Confirm"}
                </b>
              </span>
              <span className="text-slate-400">
                Offer validity{" "}
                <b className="float-right text-slate-700">30 minutes</b>
              </span>
            </div>
          </div>
        )}
        {failure ? (
          <div className="mt-6 grid gap-3 sm:grid-cols-2">
            <button
              onClick={close}
              className="rounded-xl border border-slate-200 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50"
            >
              Go back to offers
            </button>
            <button
              onClick={pay}
              className="rounded-xl bg-[#315bd6] py-3 text-sm font-bold text-white hover:bg-[#294fbe]"
            >
              Retry payment
            </button>
          </div>
        ) : unavailable ? (
          <button
            onClick={close}
            className="mt-6 w-full rounded-xl border border-slate-200 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50"
          >
            Back to offers
          </button>
        ) : (
          <div className="mt-6">
            <div className="mb-3 rounded-xl border border-blue-100 bg-blue-50 px-3 py-2.5 text-xs text-blue-900"><b>Razorpay Payment Link preview</b><br /><span className="font-mono text-[10px]">rzp.io/i/quote-{quote.id}</span><span className="ml-2 text-[10px] font-bold text-blue-600">DEMO — generated after approval in production</span></div>
            <p className="mb-3 flex gap-2 text-xs leading-5 text-slate-500">
              <ShieldCheck className="shrink-0 text-emerald-500" size={15} />
              This agent cannot initiate payment again without this explicit
              click. Amount is within your {formatPrice(
                requirement.maxBudget,
              )}{" "}
              cap.
            </p>
            <button
              disabled={paymentState === "loading"}
              onClick={pay}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#315bd6] py-3.5 text-sm font-bold text-white shadow-lg shadow-blue-100 hover:bg-[#294fbe] disabled:opacity-60"
            >
              {paymentState === "loading" ? (
                <>
                  <LoaderCircle className="animate-spin" size={17} /> Creating
                  secure order
                </>
              ) : (
                <>
                  <CreditCard size={17} /> Pay{" "}
                  {formatPrice(quote.effectivePrice)} with Razorpay
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function SuccessView({
  paymentId,
  quote,
  audit,
  reset,
}: {
  paymentId: string;
  quote: Quote | null;
  audit: () => void;
  reset: () => void;
}) {
  const merchant = quote ? merchantById(quote.merchantId) : null;
  return (
    <section className="mx-auto max-w-3xl px-5 pb-8 pt-5 sm:pt-8">
      <div className="animate-fade-up overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-float">
        <div className="relative bg-slate-900 px-7 py-10 text-center text-white">
          <div className="absolute left-0 top-0 h-full w-full bg-[radial-gradient(circle_at_center,_rgba(73,121,255,.5),_transparent_45%)]" />
          <div className="relative">
            <span className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-400 text-emerald-950 shadow-lg shadow-emerald-500/30">
              <Check size={30} />
            </span>
            <p className="mt-5 text-sm font-bold uppercase tracking-[.18em] text-emerald-300">
              Deal complete
            </p>
            <h1 className="mt-2 text-4xl font-extrabold tracking-tight">
              Purchase verified
            </h1>
            <p className="mt-2 text-sm text-slate-300">
              Buyer approval and payment verification are recorded.
            </p>
          </div>
        </div>
        <div className="p-6 sm:p-8">
          <div className="flex items-center gap-4">
            {merchant && <Avatar id={quote!.merchantId} />}
            <div>
              <h2 className="text-xl font-extrabold text-slate-900">
                {quoteName(quote ?? undefined)}
              </h2>
              <p className="mt-1 text-sm text-slate-500">
                {merchant?.name ?? "Merchant"} ·{" "}
                {quote?.deliveryDate ?? "delivery confirmed"}
              </p>
            </div>
            <div className="ml-auto text-right">
              <p className="text-2xl font-extrabold text-slate-900">
                {quote ? formatPrice(quote.effectivePrice) : "—"}
              </p>
              <p className="mt-1 text-[11px] text-slate-400">Paid</p>
            </div>
          </div>
          <div className="mt-6 grid gap-3 border-y border-slate-100 py-5 sm:grid-cols-2">
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Razorpay payment
              </p>
              <p className="mt-1 truncate font-mono text-xs font-bold text-slate-700">
                {paymentId || "Payment verified"}
              </p>
            </div>
            <div className="rounded-xl bg-slate-50 p-3">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">
                Merchant offer
              </p>
              <p className="mt-1 text-xs font-bold text-slate-700">
                Locked for this purchase
              </p>
            </div>
          </div>
          <div className="mt-7 grid gap-3 sm:grid-cols-2">
            <button
              onClick={audit}
              className="inline-flex items-center justify-center gap-2 rounded-xl border border-slate-200 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50"
            >
              <FileText size={16} /> View agent audit trail
            </button>
            <button
              onClick={reset}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#315bd6] py-3 text-sm font-bold text-white hover:bg-[#294fbe]"
            >
              <RotateCcw size={15} /> Start another quotation
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function AuditView({ audit, back }: { audit: AuditEvent[]; back: () => void }) {
  return (
    <section className="mx-auto max-w-3xl px-5 pb-12 pt-7">
      <button
        onClick={back}
        className="mb-7 inline-flex items-center gap-1.5 text-sm font-bold text-slate-500 hover:text-slate-900"
      >
        <ArrowLeft size={16} /> Back
      </button>
      <div className="rounded-[28px] border border-slate-200 bg-white p-6 shadow-soft sm:p-8">
        <div className="flex items-start justify-between">
          <div>
            <Pill tone="blue">
              <FileText size={12} /> Immutable decision log
            </Pill>
            <h1 className="mt-3 text-3xl font-extrabold tracking-tight text-slate-900">
              Agent audit trail
            </h1>
            <p className="mt-2 text-sm text-slate-500">
              Every decision, merchant action, and money gate in one place.
            </p>
          </div>
          <span className="grid h-10 w-10 place-items-center rounded-xl bg-slate-100 text-slate-500">
            <Clock3 size={19} />
          </span>
        </div>
        <div className="mt-7 space-y-1">
          {audit.map((event, index) => (
            <div key={event.id} className="relative flex gap-4 py-4">
              <span
                className={`z-10 mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full ${event.actor === "BUYER" ? "bg-violet-100 text-violet-600" : event.tone === "success" ? "bg-emerald-100 text-emerald-600" : event.tone === "warning" ? "bg-amber-100 text-amber-700" : "bg-blue-100 text-blue-600"}`}
              >
                {event.actor === "BUYER" ? (
                  <Headphones size={14} />
                ) : event.actor === "SYSTEM" ? (
                  <ShieldCheck size={14} />
                ) : (
                  <Bot size={14} />
                )}
              </span>
              {index !== audit.length - 1 && (
                <span className="absolute left-4 top-10 h-[calc(100%-8px)] w-px bg-slate-100" />
              )}
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <h2 className="text-sm font-bold text-slate-700">
                    {event.action}
                  </h2>
                  <span className="text-[10px] font-bold uppercase tracking-wider text-slate-300">
                    {event.time}
                  </span>
                </div>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  <b className="text-slate-600">Reason: </b>
                  {event.reason}
                </p>
                {event.requiresApproval && (
                  <p className="mt-2 inline-flex items-center gap-1 rounded-md bg-blue-50 px-2 py-1 text-[10px] font-bold text-blue-700">
                    <LockKeyhole size={10} /> Buyer approved
                  </p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
