"use client";

import { useState } from "react";
import {
  CheckCircle2,
  CircleAlert,
  LoaderCircle,
  ShieldCheck,
} from "lucide-react";
import type {
  BuyerRequirement,
  MerchantVerification,
  Quote,
} from "@/lib/types";
import { productLabel } from "@/lib/quote-factory";

const price = (amount: number) =>
  new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    maximumFractionDigits: 0,
  }).format(amount);

export function MerchantVerificationCard({
  verification,
  quote,
  requirement,
  merchantName,
}: {
  verification: MerchantVerification;
  quote: Quote;
  requirement: BuyerRequirement;
  merchantName: string;
}) {
  const [status, setStatus] = useState(verification.status);
  const [loading, setLoading] = useState<"confirm" | "edit" | null>(null);
  const [error, setError] = useState("");
  async function update(action: "confirm" | "edit") {
    setLoading(action);
    setError("");
    try {
      const response = await fetch(
        `/api/merchant/verify/${verification.token}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ action }),
        },
      );
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setStatus(
        result?.verification?.status ??
          (action === "confirm" ? "CONFIRMED" : "EDIT_REQUESTED"),
      );
    } catch (requestError) {
      setError(
        requestError instanceof Error
          ? requestError.message
          : "Could not update this offer.",
      );
    } finally {
      setLoading(null);
    }
  }
  const done = status !== "PENDING";
  return (
    <main className="min-h-screen bg-slate-50 px-5 py-10 text-slate-800">
      <section className="mx-auto max-w-xl overflow-hidden rounded-[28px] border border-slate-200 bg-white shadow-xl">
        <header className="bg-slate-900 px-7 py-8 text-white">
          <p className="text-xs font-bold uppercase tracking-[.16em] text-blue-300">
            Envoy merchant portal
          </p>
          <h1 className="mt-3 text-3xl font-extrabold tracking-tight">
            Confirm your quotation
          </h1>
          <p className="mt-2 text-sm leading-6 text-slate-300">
            Review the commercial terms captured by the AI buying assistant
            before the buyer can pay.
          </p>
        </header>
        <div className="p-6 sm:p-7">
          {status === "CONFIRMED" ? (
            <div className="mb-6 flex gap-3 rounded-2xl bg-emerald-50 p-4 text-sm font-semibold text-emerald-800">
              <CheckCircle2 className="shrink-0" size={19} /> Your final
              quotation is confirmed and ready for buyer approval.
            </div>
          ) : status === "EDIT_REQUESTED" ? (
            <div className="mb-6 flex gap-3 rounded-2xl bg-amber-50 p-4 text-sm font-semibold text-amber-800">
              <CircleAlert className="shrink-0" size={19} /> You requested an
              edit. Envoy will keep the buyer payment blocked until terms are
              corrected.
            </div>
          ) : null}
          <div className="rounded-2xl bg-slate-50 p-5">
            <p className="text-xs font-bold uppercase tracking-wider text-slate-400">
              {merchantName}
            </p>
            <h2 className="mt-1 text-xl font-extrabold text-slate-900">
              {productLabel(quote.product)}
            </h2>
            <p className="mt-2 text-sm text-slate-500">
              Buyer request: {requirement.productDescription}
            </p>
            <div className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 border-t border-slate-200 pt-4 text-sm">
              <span className="text-slate-400">
                Final payable{" "}
                <b className="float-right text-slate-800">
                  {price(quote.effectivePrice)}
                </b>
              </span>
              <span className="text-slate-400">
                Base price{" "}
                <b className="float-right text-slate-800">
                  {price(quote.basePrice)}
                </b>
              </span>
              <span className="text-slate-400">
                Exchange{" "}
                <b className="float-right text-slate-800">
                  {price(quote.exchangeValue)}
                </b>
              </span>
              <span className="text-slate-400">
                Delivery{" "}
                <b className="float-right text-slate-800">
                  {quote.deliveryDate ?? "—"}
                </b>
              </span>
              <span className="text-slate-400">
                Installation{" "}
                <b className="float-right text-slate-800">
                  {quote.installationIncluded ? "Included" : "Not included"}
                </b>
              </span>
              <span className="text-slate-400">
                Warranty{" "}
                <b className="float-right text-slate-800">
                  {quote.warranty ?? "—"}
                </b>
              </span>
            </div>
          </div>
          {error && (
            <p className="mt-4 text-sm font-semibold text-rose-700">{error}</p>
          )}
          {!done && (
            <div className="mt-6 grid gap-3 sm:grid-cols-2">
              <button
                disabled={Boolean(loading)}
                onClick={() => update("edit")}
                className="rounded-xl border border-slate-200 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 disabled:opacity-60"
              >
                Request edits
              </button>
              <button
                disabled={Boolean(loading)}
                onClick={() => update("confirm")}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-[#315bd6] py-3 text-sm font-bold text-white hover:bg-[#294fbe] disabled:opacity-60"
              >
                {loading === "confirm" ? (
                  <LoaderCircle className="animate-spin" size={16} />
                ) : (
                  <ShieldCheck size={16} />
                )}{" "}
                Confirm quotation
              </button>
            </div>
          )}
          <p className="mt-5 text-xs leading-5 text-slate-400">
            Confirmation is logged with the quotation request. Envoy does not
            expose another merchant’s identity or commercial terms.
          </p>
        </div>
      </section>
    </main>
  );
}
