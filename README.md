# Envoy

> Tell us what you need. Envoy gets merchants to compete for your order.

Envoy is an AI buyer agent that handles the work that usually happens between deciding what you want and actually buying it.

A buyer describes what they need in plain language. Envoy turns that into a structured request, reaches out to merchants, collects comparable quotes, asks follow-up questions when information is missing, negotiates where possible, filters out offers that do not meet the buyer's requirements, and recommends the best executable deal.

The buyer stays in control throughout the process and explicitly approves the final payment through Razorpay.

---

## Why Envoy

Buying something that requires comparing multiple sellers is still surprisingly manual.

You usually have to:

- find relevant merchants
- explain the same requirement multiple times
- compare prices that include different taxes or delivery charges
- call back for missing information
- negotiate
- figure out which offer actually satisfies your requirements

Search can help you find sellers. Envoy is designed to do the commercial work after that.

It acts as an agent for the buyer while giving merchants a new way to receive and convert high-intent demand.

---

## How it works

```text
Buyer describes what they need
            ↓
Envoy creates a structured RFQ
            ↓
Relevant merchants are contacted
            ↓
Quotes are collected
            ↓
Missing details are clarified
            ↓
Commercial terms are negotiated
            ↓
Offers are normalized and validated
            ↓
Best qualifying offer is recommended
            ↓
Buyer chooses the merchant
            ↓
Buyer explicitly approves payment
            ↓
Razorpay Test Mode checkout
```

Envoy does not simply choose the cheapest quote.

An offer must first satisfy the buyer's hard requirements such as budget, quantity, product requirements, and delivery deadline. Only qualifying offers are compared.

---

## What the demo shows

The demo walks through an end-to-end procurement request.

1. The buyer describes what they want in natural language.
2. Envoy converts the request into a structured RFQ and asks a clarification question only when something important is genuinely ambiguous.
3. Once the buyer approves merchant outreach, Envoy starts working autonomously across multiple merchants.
4. Envoy collects quotations and converts merchant conversations into structured commercial terms.
5. If a quote is incomplete, Envoy asks the merchant for the missing information instead of making assumptions.
6. If an offer fails a hard requirement, it is excluded even when it is cheaper.
7. Envoy can negotiate within predefined boundaries and record improvements to the merchant's offer.
8. Complete qualifying offers are compared using deterministic application logic.
9. Envoy recommends the best executable offer and explains why it won.
10. The buyer selects a merchant, reviews the final terms, and explicitly approves the transaction.
11. A Razorpay Test Mode order is created and the returned payment signature is verified server-side.

---

## Merchant conversations

One of the core parts of Envoy is that the quotation is backed by an actual merchant interaction.

For every merchant, the buyer can see:

- the current offer
- confirmed commercial terms
- the conversation between Envoy and the merchant
- questions Envoy asked to complete the quote
- negotiation history
- why an offer qualified or was rejected

Merchant-specific facts are only shown as confirmed when they came from merchant data or the merchant conversation. Unknown information stays marked as unverified.

The same interaction can also gradually build a reusable merchant and product knowledge layer for future buyers.

---

## Architecture

```text
                     ┌─────────────────────┐
                     │      Buyer UI       │
                     │       Next.js       │
                     └──────────┬──────────┘
                                │
                                ▼
                     ┌─────────────────────┐
                     │     Buyer Agent     │
                     │ OpenAI Responses API│
                     └──────────┬──────────┘
                                │
              ┌─────────────────┼──────────────────┐
              │                 │                  │
              ▼                 ▼                  ▼
      Merchant Adapter    Quote Processing     Audit / State
              │                 │                  │
              ▼                 ▼                  ▼
       Merchant replies    Normalization      SQLite / libSQL
       + conversations     Qualification
                           + deterministic
                              ranking
                                │
                                ▼
                     ┌─────────────────────┐
                     │      Razorpay       │
                     │ Orders + Checkout   │
                     └─────────────────────┘
```

The AI handles tasks that require language understanding and agent decisions.

Commercial calculations, qualification rules, budgets, merchant limits, and payment gates remain deterministic server-side logic.

See [`architecture.md`](architecture.md) for the detailed sequence and system boundaries.

---

## Guardrails

Envoy is intentionally bounded.

- The buyer's maximum budget is enforced server-side.
- The agent cannot invent merchant prices, inventory, delivery dates, or other commercial terms.
- An incomplete offer cannot qualify.
- Offers that violate hard requirements are rejected.
- Merchant outreach and follow-ups have bounded limits.
- Negotiation has a fixed maximum number of rounds.
- Competing merchants' identifiable quotes are not disclosed during negotiation.
- The agent cannot initiate a purchase on its own.
- Payment requires buyer selection, confirmed final terms, and explicit buyer approval.
- Razorpay secrets never reach the browser.
- Failed payments are never treated as completed purchases.

---

## Tech stack

- **Next.js + TypeScript** — application and API routes
- **OpenAI Responses API** — buyer-agent and merchant interaction intelligence
- **SQLite / libSQL** — RFQs, quotes, conversations, payments, and audit events
- **Razorpay** — Test Mode Orders and Standard Checkout
- **Twilio / Voice adapter** — optional merchant voice-call integration
- **WhatsApp / Email adapters** — optional merchant outreach channels

---

## Running locally

### 1. Install dependencies

```bash
npm install
```

### 2. Create the environment file

```bash
cp .env.example .env.local
```

### 3. Add the required credentials

At minimum, configure:

```env
OPENAI_API_KEY=
OPENAI_MODEL=

RAZORPAY_KEY_ID=
RAZORPAY_KEY_SECRET=

DEMO_MODE=true
```

Additional WhatsApp, email, and voice credentials are optional and documented in `.env.example`.

### 4. Start the app

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

---

## Demo mode

The current MVP uses clearly labelled synthetic merchants so the complete agent workflow can be demonstrated reliably without depending on a live merchant catalogue.

The simulated merchants still operate within deterministic commercial policies. The AI can converse and negotiate with them, but it cannot arbitrarily change their:

- price limits
- inventory
- delivery capability
- commercial constraints

The merchant adapter is designed so these simulated merchants can later be replaced by real merchant integrations through APIs, WhatsApp, email, voice, or other commerce protocols.

If the AI provider is temporarily unavailable, demo mode can fall back to a structured deterministic flow rather than breaking the complete demo.

---

## Razorpay integration

Envoy uses Razorpay in **Test Mode**.

The payment flow is intentionally separated from the agent:

```text
Agent recommends offer
        ↓
Buyer selects merchant
        ↓
Final terms confirmed
        ↓
Buyer clicks Pay
        ↓
Server creates Razorpay Order
        ↓
Razorpay Standard Checkout
        ↓
Server verifies payment signature
        ↓
Purchase confirmed
```

The AI never has permission to autonomously spend the buyer's money.

---

## Testing

Run:

```bash
npm test
```

Tests cover important business rules including:

- effective price calculation
- budget enforcement
- rejection of incomplete offers
- rejection of disqualified offers
- deterministic recommendation
- explicit approval before payment

---

## Current limitations

This is a hackathon MVP.

The current version does not yet have a live merchant catalogue, inventory network, or delivery network. Merchant interactions used in the primary demo are clearly marked as simulated.

A production version would add:

- merchant onboarding and consent
- real merchant discovery
- verified inventory
- live WhatsApp, email, and voice interactions
- merchant-side APIs
- inbound messaging webhooks
- stronger authentication and authorization
- Razorpay payment webhooks
- production-grade idempotency and observability

---

## Where this can go

Today, Envoy starts with a buyer request and returns a merchant-confirmed deal.

The larger idea is to make merchants accessible to AI buyers even when their inventory, pricing, and sales knowledge are not available through a structured API.

Over time, every merchant interaction can make that merchant more AI-readable:

```text
Buyer asks
    ↓
Envoy talks to merchant
    ↓
Merchant confirms information
    ↓
Structured knowledge is created
    ↓
Future AI buyers can transact more easily
```

The end goal is simple:

**A buyer should be able to describe what they want and let an agent handle everything up to the point where they need to make the final decision.**
