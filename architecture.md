# Envoy architecture

Envoy is a buyer-side procurement workflow. It turns a natural-language need into a structured RFQ, gathers and evaluates merchant quotations, and only opens payment after the buyer selects a confirmed offer.

## System overview

```text
Browser (Next.js UI)
  │
  ├── POST /api/agent/parse-requirement ──► OpenAI provider
  │                                         └── structured RFQ + summary title
  │
  ├── /api/rfqs and /api/rfqs/:id ───────► RFQ service + libSQL persistence
  │                                         ├── merchant discovery
  │                                         ├── outreach / conversations
  │                                         ├── quote normalization
  │                                         ├── deterministic qualification + ranking
  │                                         └── audit trail
  │
  ├── /api/rfqs/:id/voice-call ─────────► optional Twilio voice adapter
  ├── /api/rfqs/:id/outreach ───────────► merchant channel adapters
  ├── /api/rfqs/:id/knowledge ──────────► verified merchant/product knowledge
  │
  └── /api/payments/* ──────────────────► Razorpay Orders + signature verification
```

## User-facing routes

| Route | Purpose |
| --- | --- |
| `/` | Start a new requirement and continue the active RFQ. |
| `/quotes` | RFQ history with status and current best offer. |
| `/quotations/[id]` | Request review, final recommendation, and payment approval. |
| `/quotations/[id]/procurement` | Live procurement and merchant-outreach view. |
| `/merchant/verify/[token]` | Merchant confirmation/edit screen for a quotation. |
| `/demo/merchant/[merchantId]` | Demo merchant-side request and reply flow. |

## RFQ lifecycle

`lib/agent-orchestrator.ts` enforces the allowed status transitions:

```text
DRAFT_REQUIREMENT
  → REQUIREMENT_CONFIRMED
  → RFQ_SENT
  → COLLECTING_QUOTES
  → CLARIFYING_QUOTES / NEGOTIATING
  → READY_TO_RECOMMEND
  → BUYER_SELECTED
  → FINAL_TERMS_CONFIRMED
  → AWAITING_PAYMENT_APPROVAL
  → PAYMENT_PROCESSING
  → PURCHASED
```

The UI may render intermediate views, but the server-side state machine is the source of truth for the commercial workflow.

## Core modules

| Module | Responsibility |
| --- | --- |
| `components/quote-ai-app.tsx` | Buyer UI, route-aware view state, RFQ review, live procurement, offer selection, and checkout handoff. |
| `lib/ai/provider.ts` | OpenAI-backed requirement extraction, buyer follow-up support, and optional product-image generation. It has a deterministic fallback when AI is unavailable. |
| `lib/rfq-clarifications.ts` | Determines genuinely missing RFQ details before outreach. |
| `lib/merchant-discovery.ts` | Matches merchants by product/category, selling mode, location, and delivery suitability. |
| `lib/procurement-agent.ts` | Plans permitted procurement actions within buyer guardrails. |
| `lib/merchant-adapter.ts` and `lib/outreach.ts` | Channel-neutral merchant messaging, simulated adapter, and optional WhatsApp/email outreach. |
| `lib/voice-merchant-adapter.ts` | Optional disclosed voice-call workflow; Twilio callbacks are handled by the voice API routes. |
| `lib/quote-factory.ts` | Creates/normalizes demo and merchant quote structures. |
| `lib/commerce.ts` | Deterministic qualification, effective-cost calculation, ranking, and payment eligibility checks. |
| `lib/db.ts` | libSQL persistence, audit events, quote versions, conversations, product knowledge, merchant verification, and payments. |

## Data model

The primary record is an `RFQ`, containing the buyer requirement, original prompt, concise title, budget cap, and lifecycle status. Related rows are stored by RFQ ID:

- `quotes` — normalized commercial offers and their merchant confirmation state.
- `quote_versions` — changes caused by clarification or negotiation.
- `merchant_conversations` and `merchant_calls` — channel-neutral transcript/audit evidence.
- `product_knowledge` and `merchant_knowledge_cache` — sourced merchant facts and Q&A. Answers marked `UNKNOWN` are never presented as merchant-confirmed.
- `merchant_verifications` — secure token flow for a merchant to confirm or request edits.
- `payments` — Razorpay order/payment identifiers and final status.
- `audit_events` — user, agent, merchant, and system decisions.

The default local database is `file:quoteai.db`. Its legacy filename is intentionally retained to preserve existing saved RFQs; a hosted libSQL/Turso URL can be supplied through `DATABASE_URL`.

## Offer evaluation

AI can extract and summarize language, but it does not decide commercial truth. `lib/commerce.ts` evaluates offers deterministically:

1. Reject incomplete or unavailable offers.
2. Check hard requirements: budget, quantity, product constraints, delivery, and applicable exchange conditions.
3. Normalize total delivered cost, including quoted tax, delivery, and exchange adjustments.
4. Rank qualifying offers by executable commercial value, including price, delivery, and merchant trust/rationale where available.
5. Record why an offer won or was excluded.

Merchant facts and Q&A are evidence-bound. Live/captured information is shown as merchant-confirmed; demo fallback content is explicitly labelled; unanswered questions remain unknown.

## Payment boundary

`/api/payments/create-order` will only create a Razorpay order after the buyer has selected an offer, final terms are confirmed, and explicit payment approval is present. The browser receives only the Razorpay key/order details needed for Standard Checkout. `/api/payments/verify` verifies the returned signature server-side before Envoy marks the RFQ as purchased.

## External integrations

| Integration | Use | Configuration |
| --- | --- | --- |
| OpenAI | Requirement extraction, optional buyer assistance, product images. | `OPENAI_API_KEY`, optional `OPENAI_MODEL` |
| Razorpay | Test Mode order creation, Checkout, signature verification. | `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` |
| Twilio | Optional disclosed merchant voice calls and status callbacks. | Twilio account/call configuration |
| WhatsApp / email | Merchant outreach channels, with the simulated adapter available for the demo. | Channel-specific credentials/sender settings |

## Safety and ownership boundaries

- Buyer budgets, merchant-contact limits, retries, and negotiation rounds are server-enforced guardrails.
- Envoy does not disclose one merchant’s identifiable quote to another merchant.
- The agent cannot manufacture stock, price, warranty, delivery, or other commercial confirmation.
- Payment is never initiated autonomously; buyer selection and approval are required.
- Secrets remain server-side and should be stored only in `.env.local` locally or the deployment’s secret manager.
