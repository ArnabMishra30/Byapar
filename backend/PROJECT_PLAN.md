# Business Platform — Complete Project Plan (Pre-Implementation)

**Status:** Plan only. No application code written yet.
**Date:** 2026-08-24
**Backend language:** **JavaScript (ESM) — not TypeScript**, per final instruction.
**Frontend language:** TypeScript (unchanged).

---

> **Note.** The plan below was written for the original *Business Platform* product,
> before the build pivoted to a Pharma ERP. It is kept for its architecture, security
> and decision rationale, most of which still applies. What was actually built is
> recorded in the build log immediately below, and in `docs/architecture.md`.

## Build log — Pharma ERP backend

| Phase | Scope | Status |
|---|---|---|
| 0 | Backend foundation: config, errors, validation, logging, auth, health | Complete |
| 1 | Repository layer, identity, tenant isolation, ADMIN/STAFF RBAC | Complete |
| 2 | Master data: categories, units, taxes, warehouses, products, suppliers, customers, company settings | Complete |
| 3 | Inventory foundation: balances, immutable stock movements, moving weighted average | Complete |
| 4 | Purchases: draft to posted, stock in, document numbering | Complete |
| 5 | Purchase returns: stock out at the original purchase cost, partial returns | Complete |
| 6 | **Supplier payables + supplier payments**: payable per bill, immutable supplier ledger, payments with allocation and advances | **Complete** |

Phase 6 explicitly stops short of double-entry accounting: it is an operational
supplier sub-ledger. General ledger, chart of accounts, journal entries and GST
accounting remain future work.

---

## 0. Executive Summary — What I Am *Not* Doing Blindly

The requirements are unusually well-specified. Below are the places where I deviate, and why.
Each is restated as a sign-off item in §34.

| # | Requirement as written | My position | Why |
|---|---|---|---|
| 1 | Backend in TypeScript (§2) → then "fully JS" (final line) | **Plain JavaScript. No `tsc` gate** (decision locked, §39.4). TypeScript is not a dependency at all. Correctness is carried entirely by Zod + `Decimal` + service tests. | Final instruction overrides §2. No build step, no `dist/`, real stack traces, `node src/server.js` runs source. Prisma still emits `.d.ts`, so editor autocomplete on models survives. **The tradeoff is real and accepted:** the "wrong shape passed into a journal line" bug class is now caught by tests, not the compiler — which is why §31's service-test matrix is mandatory rather than aspirational, and why Zod is applied at *internal* service boundaries too (see §2.1). |
| 2 | Status chain `DRAFT → CONFIRMED → POSTED` (§12) | **Collapse to `DRAFT → POSTED`** (+ `CANCELLED`, `VOID`). Keep `CONFIRMED` in the enum, unused in MVP. | Three states only make sense when business approval and ledger posting are separate acts by separate people. You have no maker-checker in MVP. A state that never changes behaviour will eventually be set wrong. Re-enable when approvals arrive. |
| 3 | "Synchronous AI processing" (§8) | **Async but in-process** — no Redis, no BullMQ. DB status column + concurrency-limited in-memory worker + frontend polling + startup reaper for orphaned jobs. | OCR + LLM on a scanned invoice takes 5–40s. A synchronous HTTP request that long dies at the proxy/CDN and gives an awful UX. This honours "no Redis" while keeping the *interface* (`JobQueue.enqueue()`) identical to a future BullMQ swap — a one-file change. |
| 4 | Inventory (§10) — **costing method never specified** | **Blocking decision.** Recommend **Moving Weighted Average**, company+product level. | You cannot compute COGS, gross profit, or stock value without one. FIFO needs cost layers (more tables, painful returns). Weighted average is what Vyapar-class products use and is accepted under Ind AS. Changing later = data migration. Decide before Phase 3. |
| 5 | Tax (§9) — only `Tax` / `TaxRate` | **Add `TaxComponent`.** One 18% GST splits into CGST 9% + SGST 9% (intra-state) or IGST 18% (inter-state), each posting to a *different* ledger account. | A flat rate cannot produce correct journal lines or GSTR filings. |
| 6 | OpenAPI "generated from code where practical" (§17) | **Hand-maintained `openapi.yaml` as the contract, CI-validated against real integration-test responses.** | Comment-generated specs rot silently and are always subtly wrong. A spec that CI asserts against live responses is the only kind that stays true — and it's what makes the mobile dev's life work. |
| 7 | "AI must not modify accounting/inventory" (§1, §13) | **Agreed, and enforced structurally**, not by convention: ESLint `no-restricted-imports` fails the build if `modules/ai-documents/**` imports inventory/accounting internals. | Convention-only boundaries always erode under deadline. |
| 8 | Every table in §9 | **Trimmed.** `Branch`, `StockTransfer`, `ProductPrice`, `AccountGroup`, `Notification` deferred. | §9 itself says do not blindly create them all. Unused tables invite half-correct code. |
| 9 | Not stated anywhere | **Added `Membership`** (User ↔ Company N:M). | SMB owners routinely run 2–3 businesses. Retrofitting this after users exist is a nasty migration. |

Everything else in the brief I accept as written.

### 0.1 Decision Log (locked 2026-08-24)

| Decision | Chosen | Consequences now baked into this plan |
|---|---|---|
| **Inventory costing** | **Moving Weighted Average** | `StockBalance.avgCost` recomputed on IN movements only; OUT consumes at current average and freezes `costAtSale`; no cost-layer tables; returns reverse at their original cost. §13. |
| **Tax regime** | **India GST first** | `Tax` + `TaxComponent` + `Customer/Supplier.placeOfSupply` + `Product.hsnCode` are MVP, not optional. Posting logic picks CGST+SGST vs IGST by comparing company state to place of supply. Separate input/output accounts per component. §17, §39.2. |
| **Status model** | **DRAFT → POSTED** (+ CANCELLED, VOID) | One posting transition per document type; `CONFIRMED` reserved in the enum for a future maker-checker. §10. |
| **Backend types** | **Plain JS, Zod only — no TypeScript at all** | No build step, no `tsconfig`/`jsconfig`, no typecheck in CI. In exchange: Zod validation at internal posting boundaries too, runtime `assertCtx`/`assertTx` guards, a heavier ESLint ruleset, and **enforced coverage floors (100% money utils, 85% services)** as merge gates. §2.1, §31, §38.1. |

Still open, and needed before their phase: §39 rows 5–12, plus the gaps listed under "Missing from the brief".

---

## 1. Product Architecture

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  CLIENTS                                                                     │
│  Next.js web app (primary)  ·  future React Native app  ·  future POS        │
└────────────────────────────────┬─────────────────────────────────────────────┘
                                 │  HTTPS · REST · JSON · /api/v1 · Bearer JWT
┌────────────────────────────────▼─────────────────────────────────────────────┐
│  business-platform-backend   (ONE Express process · modular monolith · JS)    │
│                                                                              │
│  ┌── HTTP edge ──────────────────────────────────────────────────────────┐   │
│  │ helmet · cors · rateLimit · requestId · pino-http · parsers            │   │
│  │ authenticate → resolveTenant → authorize(permission) → validate(zod)   │   │
│  └────────────────────────────────┬───────────────────────────────────────┘   │
│                                   ▼                                          │
│  ┌── MODULES (isolated; cross-module calls go service→service) ──────────┐   │
│  │ auth · users · companies · roles │ products · categories · units       │   │
│  │ customers · suppliers · warehouses │ sales · purchases · payments      │   │
│  │ expenses · taxes · reports · audit · settings                          │   │
│  │                                                                        │   │
│  │  ┌── CORE INVARIANT LAYER — the ONLY writers of ledgers ───────────┐   │   │
│  │  │ InventoryService  → StockMovement + StockBalance                │   │   │
│  │  │ AccountingService → JournalEntry + JournalLine                  │   │   │
│  │  │ PartyLedgerService→ receivable / payable balances               │   │   │
│  │  └─────────────────────────────────────────────────────────────────┘   │   │
│  │                                                                        │   │
│  │ ai-documents ──► produces DRAFTS ONLY ──► PurchaseService.createDraft() │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
│                                   ▼                                          │
│  ┌── PLATFORM ADAPTERS (swappable, interface-first) ─────────────────────┐   │
│  │ StorageAdapter(local│s3) · AiProvider(openai│anthropic│gemini│mock)     │   │
│  │ OcrProvider(none│tesseract│vision) · JobQueue(inProcess│bullmq)         │   │
│  │ Mailer(console│smtp)                                                    │   │
│  └────────────────────────────────────────────────────────────────────────┘   │
└────────────────────────────────┬─────────────────────────────────────────────┘
                                 ▼
              PostgreSQL 16 (single DB · shared schema · companyId scoping)
              ./storage/  (local uploads in dev · S3/R2 later, same interface)
```

**Why a modular monolith:** one deploy unit, and — decisively — **one database transaction can span
purchase + stock + payable + journal**. The §10 requirement ("all succeed or fail together") is *free*
here and would require sagas, an outbox, and compensating transactions in microservices. Do not split
until a module has an independent scaling or team-ownership reason. None does today.

---

## 2. Backend Architecture (JavaScript specifics)

### 2.1 Runtime & language decisions

| Decision | Choice | Why |
|---|---|---|
| Module system | **ESM** (`"type":"module"`, `import`/`export`) | Stable on Node 20+; Prisma, Zod, Express 5 all support it. Avoids permanent CJS/ESM interop tax. |
| Node version | **22 LTS** in prod, pinned via `.nvmrc` + `engines` | You run 25 locally; 25 is not LTS. Pin so prod is never a surprise. |
| Build step | **None.** `node src/server.js` runs source. | The single biggest practical win of dropping TS: instant deploys, honest stack traces, no sourcemaps. |
| Type safety | **None at compile time** — no TypeScript, no `checkJs`. JSDoc comments are encouraged for editor hints but are not enforced or checked. | Decision §39.4. Keeps the codebase plain and the toolchain minimal. Everything below is the compensation for it. |
| Runtime validation | **Zod at every boundary — HTTP input, AI output, env, config — *and* at the entry of every posting service** | With no compile-time checking at all, this is the *only* thing standing between a malformed object and a corrupt ledger. `postPurchase`, `postSale`, `postPayment`, `AccountingService.post` and `InventoryService.applyMovements` each validate their own input with a Zod schema, even though the caller is internal code. Slightly redundant, deliberately. |
| Money | see below — `Decimal` discipline is now enforced by lint + tests rather than by types | |
| Money | **`Prisma.Decimal`**; Postgres `NUMERIC(18,4)` amounts, `NUMERIC(18,6)` qty/rates | JS `number` is IEEE-754. `0.1 + 0.2 !== 0.3` inside an accounting system is a legal problem. **Zero floats in the financial path** — lint-banned. |
| Dates | `timestamptz` UTC for events; `@db.Date` for business dates (`invoiceDate`, fiscal periods) | Prevents the classic "invoice jumped to yesterday in IST" bug. |
| Primary keys | **UUID v7** | Time-sortable (index-friendly, unlike v4), non-enumerable across tenants (unlike serial ints). |
| Errors | `AppError` class + central `errorHandler`, machine-readable `code` | Consistent envelope (§18); never leaks stack traces. |
| Logging | `pino` + `pino-http`; `requestId` carried in `AsyncLocalStorage` | Structured JSON; requestId reaches service/audit layers without parameter drilling. |

### 2.2 Layering — strict, lint-enforced

```
routes/      declares path + middleware chain. Nothing else.
schema/      Zod schemas: params, query, body, response examples.
controller/  parse req → call service → format response.  NO business logic. NO prisma.
service/     ALL business logic. Owns transactions. Calls other modules' SERVICES.
repository/  ALL prisma access. Always tenant-scoped. Returns plain objects.
```

Hard rules (ESLint `no-restricted-imports`, build fails on violation):
- `controller/**` may not import `prisma` / `@prisma/client`.
- `repository/**` may not import another module's repository — cross-module reads go through that
  module's **service**.
- `modules/ai-documents/**` may not import `inventory`, `accounting`, or any `Stock*`/`Journal*` repository.

### 2.3 Transaction ownership rule

> **Only service methods named `post*`, `confirm*`, `cancel*`, or `void*` may open
> `prisma.$transaction`. Every service invoked inside a transaction takes the `tx` client as its
> first argument.**

Convention: `postPurchase(tx, ctx, input)` with `ctx = { companyId, userId, requestId }`.
This makes nested transactions and out-of-transaction ledger writes structurally impossible to write
by accident, and it is trivially checkable in review.

### 2.4 Request context

`AsyncLocalStorage` carries `{ requestId, userId, companyId, permissions }` for logging and audit.
Services still receive `ctx` **explicitly** as an argument — ALS is for cross-cutting concerns only,
never as a hidden input to business logic (that would make services untestable).

---

## 3. Frontend Architecture

Stack as specified: Next.js App Router + TypeScript + Tailwind + shadcn/ui + TanStack Query + RHF + Zod.

Flow: `app/**/page.tsx` (server component: layout, auth gate, metadata) →
`features/<domain>/components/*` (client) → `features/<domain>/hooks/*` (TanStack Query) →
`lib/api/<domain>.ts` (typed client) → backend.

Decisions worth calling out:

- **Access token lives in an httpOnly cookie set by a Next.js Route Handler**, never in localStorage.
  Browser JS never holds the JWT. `lib/api` calls Next Route Handlers, which attach the token as a
  Bearer header when proxying to Express. Cost: one hop. Benefit: XSS cannot exfiltrate credentials.
- **Frontend types are generated from the backend OpenAPI spec** via `openapi-typescript` into
  `types/api.d.ts`. This is how a JS backend still yields a fully typed TS frontend — and it forces the
  spec to stay honest, because a stale spec breaks the frontend build. This is the key compensating
  control for dropping TypeScript on the backend.
- Zod on the frontend is for form UX only. The server is always the authority.
- No business logic in components. Money formatting/rounding lives in `lib/utils/money.ts` and mirrors
  the backend rules documented in `docs/accounting.md`.
- TanStack Query keys are namespaced `['purchases', 'list', filters]` with a shared `queryKeys` factory,
  so a purchase confirmation can invalidate `products`, `inventory`, `reports` in one place.

---

## 4. Database ER Design

One PostgreSQL database, one schema, shared tables, `companyId` discriminator column.

### 4.1 Core relationships

```
Company ─1:N─ Membership ─N:1─ User ─N:M(UserRole)─ Role ─N:M(RolePermission)─ Permission
   │
   ├─1:N─ Warehouse ──1:N─ StockBalance ─N:1─ Product
   ├─1:N─ Category ───1:N─ Product ─N:1─ Unit
   ├─1:N─ Tax ────────1:N─ TaxComponent ─N:1─ Account
   │
   ├─1:N─ Supplier ─1:N─ PurchaseInvoice ─1:N─ PurchaseInvoiceItem ─N:1─ Product
   │                            ├─1:N─ PurchaseReturn ─1:N─ PurchaseReturnItem
   │                            └─1:N─ PaymentAllocation ─N:1─ Payment
   │
   ├─1:N─ Customer ─1:N─ SalesInvoice ─1:N─ SalesInvoiceItem ─N:1─ Product
   │                            ├─1:N─ SalesReturn ─1:N─ SalesReturnItem
   │                            └─1:N─ PaymentAllocation ─N:1─ Payment
   │
   ├─1:N─ StockMovement          (APPEND-ONLY ledger; polymorphic sourceType/sourceId)
   ├─1:N─ Account ─1:N─ JournalLine ─N:1─ JournalEntry (APPEND-ONLY; polymorphic source)
   ├─1:N─ FiscalYear ─1:N─ AccountingPeriod        (period locking)
   ├─1:N─ Expense ─N:1─ ExpenseCategory ─N:1─ Account
   ├─1:N─ DocumentSequence                          (gap-free numbering, row-locked)
   ├─1:N─ AIDocument ─1:1─ AIExtraction ─1:N─ AIExtractionItem ─1:N─ AIProductMatch
   │            └─1:N─ AIProcessingAttempt      AIExtraction ─1:N─ AISupplierMatch
   ├─1:N─ AuditLog · IdempotencyKey · ProductAlias
   └─1:1─ CompanySettings
```

## 5. Complete Entity List  (Y = MVP, LATER = deferred stub)

**Identity & tenancy**

| Entity | | Notes |
|---|---|---|
| `Company` | Y | tenant root — `name, legalName, gstin, address, currency, timezone, fiscalYearStartMonth, status` |
| `CompanySettings` | Y | 1:1 — `allowNegativeStock, costingMethod, roundingMode, defaultWarehouseId, defaultTaxId, invoiceSettings JSONB` |
| `InvoiceSettings` | Y | **merged** into `CompanySettings.invoiceSettings` JSONB (prefixes, terms, logo, footer). A separate table for a 1:1 config blob is premature. |
| `User` | Y | global identity — `email` globally unique, `passwordHash, name, phone, status, lastLoginAt, failedLoginCount, lockedUntil` |
| `Membership` | Y | **added** — `(userId, companyId)` unique, `status, joinedAt, isOwner`. One user, many businesses. |
| `Role` | Y | company-scoped, plus system templates (`companyId = null`) |
| `Permission` | Y | seeded catalogue, `purchase.confirm` naming |
| `RolePermission`, `UserRole` | Y | joins; `UserRole` is scoped by `membershipId`, not raw userId |
| `RefreshToken` | Y | hashed, rotating — `tokenHash, expiresAt, revokedAt, replacedById, userAgent, ip` |
| `Branch` | LATER | `branchId` nullable column reserved on transactions; no table in MVP |

**Master data**

| Entity | | Notes |
|---|---|---|
| `Product` | Y | `sku, barcode, name, description, categoryId, unitId, taxId, hsnCode, purchasePrice, salePrice, isService, trackInventory, reorderLevel, status` |
| `Category` | Y | self-referencing `parentId` |
| `Unit` | Y | `name, symbol, decimalPlaces` (PCS = 0, KG = 3) — drives quantity rounding everywhere |
| `Tax` | Y | `name, totalRate, type(GST_INTRA/GST_INTER/VAT/EXEMPT), isInclusive` |
| `TaxComponent` | Y | **added** — `taxId, name(CGST), rate, outputAccountId, inputAccountId`. Enables correct journal splits and GST returns. |
| `Customer` | Y | `name, phone, email, gstin, billingAddress, shippingAddress, openingBalance, creditLimit, placeOfSupply, status` |
| `Supplier` | Y | same + `paymentTermsDays` |
| `Warehouse` | Y | `name, code, address, isDefault` |
| `ProductPrice` | LATER | price lists / customer-specific pricing |

**Inventory — ledger-based**

| Entity | | Notes |
|---|---|---|
| `StockMovement` | Y | **APPEND-ONLY.** `companyId, productId, warehouseId, direction(IN/OUT), quantity, unitCost, totalCost, movementType, sourceType, sourceId, sourceLineId, occurredAt, createdBy`. Never updated, never deleted. |
| `StockBalance` | Y | **derived cache** — unique `(companyId, productId, warehouseId)`; `quantity, avgCost, totalValue, version`. Fully rebuildable from `StockMovement`. |
| `StockAdjustment` / `Item` | Y | manual corrections with a mandatory `reason`; emits StockMovements on post |
| `StockTransfer` / `Item` | LATER | inter-warehouse, phase 2 |

**Sales / Purchases**

| Entity | | Notes |
|---|---|---|
| `SalesInvoice` | Y | `number, customerId, warehouseId, invoiceDate, dueDate, status, subtotal, discountAmount, taxAmount, roundOff, total, amountPaid, balanceDue, notes, postedAt, cancelledAt, createdBy` |
| `SalesInvoiceItem` | Y | `productId, description, quantity, unitId, unitPrice, discountPercent, discountAmount, taxId, taxAmount, lineTotal, costAtSale` |
| `SalesReturn` / `Item` | Y | links original invoice **and** original line id, for over-return validation |
| `PurchaseInvoice` | Y | same shape + `supplierId, supplierInvoiceNumber, supplierInvoiceDate, aiDocumentId?` |
| `PurchaseInvoiceItem` | Y | |
| `PurchaseReturn` / `Item` | Y | |
| `DocumentSequence` | Y | **added** — `(companyId, docType, fiscalYearId)` to `prefix, nextNumber`. Row-locked inside the posting transaction. |

**Payments & expenses**

| Entity | | Notes |
|---|---|---|
| `Payment` | Y | `direction(RECEIVED/PAID), partyType, partyId, paymentDate, method(CASH/BANK/UPI/CHEQUE/CARD), accountId, amount, unallocatedAmount, reference, status` |
| `PaymentAllocation` | Y | `paymentId, targetType(SALES_INVOICE/PURCHASE_INVOICE/SALES_RETURN/PURCHASE_RETURN), targetId, amount` |
| `Expense` | Y | `expenseCategoryId, expenseDate, paidThroughAccountId, supplierId?, amount, taxAmount, total, status, notes, attachmentKey` |
| `ExpenseCategory` | Y | maps 1:1 to an expense `Account` |

**Accounting**

| Entity | | Notes |
|---|---|---|
| `Account` | Y | `code, name, type(ASSET/LIABILITY/EQUITY/INCOME/EXPENSE), subType, parentId, isSystem, systemKey, isActive`. **`systemKey`** (`AR`, `AP`, `INVENTORY`, `SALES`, `COGS`, `CGST_OUTPUT`, `ROUND_OFF`, `CASH`, ...) is how services resolve accounts — never hardcoded ids, never name lookups. |
| `JournalEntry` | Y | **APPEND-ONLY** — `entryNumber, entryDate, narration, sourceType, sourceId, reversalOfId, reversedById, postedBy, postedAt` |
| `JournalLine` | Y | `journalEntryId, accountId, debit, credit, partyType?, partyId?, description`. DB CHECK: exactly one of debit/credit > 0, both >= 0. |
| `FiscalYear` | Y | `startDate, endDate, status(OPEN/CLOSED)` |
| `AccountingPeriod` | Y | **added** — monthly lock. Posting into a CLOSED period is rejected with `PERIOD_LOCKED`. |
| `AccountGroup` | LATER | `Account.parentId` covers MVP grouping |

**AI**

| Entity | | Notes |
|---|---|---|
| `AIDocument` | Y | `uploadedBy, originalFilename, mimeType, sizeBytes, storageKey, checksumSha256, pageCount, status, documentType, purchaseInvoiceId?, duplicateOfId?` |
| `AIProcessingAttempt` | Y | `attemptNumber, stage(OCR/EXTRACT/MATCH), provider, model, status, startedAt, finishedAt, durationMs, promptTokens, completionTokens, costMicros, errorCode, errorMessage, rawResponseKey` — your cost and reliability telemetry |
| `AIExtraction` | Y | validated structured result + `overallConfidence, fieldConfidences JSONB, rawJson JSONB, reviewStatus, reviewedBy, reviewedAt` |
| `AIExtractionItem` | Y | one per extracted line, with per-field confidence |
| `AIProductMatch` | Y | `aiExtractionItemId, productId, score, reason, method(EXACT_SKU/BARCODE/ALIAS/TRIGRAM/EMBEDDING), status(SUGGESTED/CONFIRMED/REJECTED)` |
| `AISupplierMatch` | Y | same, at extraction header level |
| `ProductAlias` | Y | **added** — `productId, alias, source(AI_CONFIRMED/MANUAL), timesSeen`. Every confirmed AI match writes an alias, so matching measurably improves the more the customer uses it. This is the compounding-value mechanism of the whole product. |

**Cross-cutting**

| Entity | | Notes |
|---|---|---|
| `AuditLog` | Y | `companyId, userId, action, entityType, entityId, before JSONB, after JSONB, metadata JSONB, ip, userAgent, requestId, createdAt` |
| `IdempotencyKey` | Y | **added** — unique `(companyId, key)`; `endpoint, requestHash, responseStatus, responseBody, createdAt` |
| `Notification` | LATER | in-app bell, phase 2 |

## 6. Important Relationships and Invariants

1. **Every tenant table carries `companyId`**, and every index leads with it. Composite uniques are always
   `(companyId, x)` — `@@unique([companyId, sku])`, `@@unique([companyId, docType, number])`. A unique on
   `sku` alone would leak one tenant's data into another tenant's constraint space.
2. **Polymorphic source links.** `StockMovement` and `JournalEntry` reference documents via
   `(sourceType, sourceId)` with a composite index — deliberately not foreign keys, so one ledger serves
   every document type. The lost referential integrity is accepted and covered by the integrity job.
3. **`StockBalance` is a cache, not truth.** `verifyStockIntegrity` recomputes from `StockMovement` and
   reports drift. If they ever disagree, **`StockMovement` wins**.
4. **Journal lines must net to zero per entry** — enforced in `AccountingService.postEntry` *and* by a
   deferred DB constraint trigger. Belt and braces, because every report rests on this one invariant.
5. **No hard deletes of transactional data.** `CANCELLED` / `VOID` plus reversal entries. Master data uses
   `status = ARCHIVED`. Only unposted DRAFTs may be hard-deleted.
6. **`SalesInvoiceItem.costAtSale`** freezes COGS at posting time, so historical gross profit never shifts
   when average cost moves later.
7. **Concurrency:** `SELECT ... FOR UPDATE` on affected `StockBalance` rows inside posting transactions,
   always ordered by `productId` to prevent deadlocks between concurrent posts, plus a `version` column
   for optimistic checks in non-transactional read-modify paths.

---

## 7. Authentication Flow

**Choice: stateless access JWT (15 min) + rotating opaque refresh token (30 days, hashed in DB).**

Why not pure sessions: the same API must serve a future React Native app, where cookies are awkward.
Why not a long-lived JWT: you cannot revoke it, and revocation is mandatory for "remove an employee".
The hybrid gives cheap request-path auth (no DB hit) and real revocation (refresh is DB-backed).

```
POST /api/v1/auth/register        create User + Company + Membership(owner) + seed CoA + fiscal year
POST /api/v1/auth/login           email + password
   -> verify argon2id hash (constant-time; dummy-hash compare on unknown email)
   -> increment failedLoginCount; lock 15 min after 5 failures
   -> return { accessToken (15m), refreshToken (30d), user, memberships[] }
POST /api/v1/auth/select-company  { companyId } -> new accessToken carrying companyId + permissions
POST /api/v1/auth/refresh         rotate: old token revoked, new issued, reuse-detection
POST /api/v1/auth/logout          revoke this refresh token
POST /api/v1/auth/logout-all      revoke every refresh token for the user
GET  /api/v1/auth/me              user + active company + effective permissions
```

**Access token claims:**
```
{ sub: userId, cid: companyId, mid: membershipId, perms: ["purchase.confirm", ...],
  jti, iat, exp, ver: tokenVersion }
```
`perms` is embedded to avoid a permission lookup per request. Cost: a role change takes up to 15 minutes
to take effect. Mitigation: `User.tokenVersion` is bumped on any role/permission/membership change, and
`authenticate` rejects tokens whose `ver` is stale — a single cheap indexed lookup, or cached in-process
for 30s. This is the one place I accept a small stateful check, because silently stale permissions on a
financial system is not acceptable.

**Refresh-token reuse detection:** if a revoked refresh token is presented, revoke the entire token family
and force re-login. Standard defence against stolen refresh tokens.

**Password hashing:** `argon2id` (`@node-rs/argon2` — prebuilt binaries, no node-gyp on Windows),
memoryCost 19456 KiB, timeCost 2, parallelism 1 (OWASP 2024 baseline). bcrypt is the fallback if argon2
install proves painful on the target host.

---

## 8. Multi-Tenancy Strategy

**Model: single database, shared schema, `companyId` column.** Row-level isolation.

Rejected alternatives: schema-per-tenant (migration cost explodes past ~100 tenants); database-per-tenant
(operationally heavy, no shared reporting, overkill for SMB SaaS).

**Three enforcement layers — defence in depth, because one leak is a company-ending bug:**

1. **Token layer.** `companyId` comes *only* from the verified JWT, never from body/query/header.
   `resolveTenant` middleware re-verifies the Membership is still ACTIVE.
2. **Repository layer.** Every repository function takes `ctx` first and injects
   `where: { companyId: ctx.companyId }`. Enforced by a **Prisma client extension** that throws at runtime
   if a query against a tenant model has no `companyId` in its `where` — so a forgotten filter fails loudly
   in dev/test rather than silently leaking in prod.
3. **Write-path check.** On every update/delete by id, the repository uses
   `updateMany({ where: { id, companyId } })` and asserts `count === 1`, rather than `update({ where: { id } })`.
   This makes cross-tenant id guessing return 404, not someone else's data.

**Deferred (documented, not built):** Postgres Row-Level Security with `SET LOCAL app.company_id`.
It is the strongest control but complicates connection pooling and Prisma usage. Revisit at the first
enterprise/compliance customer. The `companyId` column design is already RLS-ready.

**Cross-tenant admin:** a platform-superadmin flag exists on `User` for support, but every superadmin read
is audit-logged with a mandatory reason string. No superadmin *writes* to tenant financial data, ever.

---

## 9. Role and Permission Strategy

**RBAC with a static permission catalogue and company-scoped roles.**

Permission naming: `<resource>.<action>` — `product.create`, `purchase.confirm`, `purchase.cancel`,
`report.pnl.view`, `ai.document.confirm`, `settings.update`, `user.invite`.
The catalogue is a seeded constant in code (`src/common/permissions.js`), mirrored into the `Permission`
table by an idempotent seed, so code and DB cannot drift.

**System role templates** (cloned into each new company at registration, then editable):

| Role | Scope |
|---|---|
| `OWNER` | everything, including settings, users, period close. Cannot be deleted or demoted if last owner. |
| `ACCOUNTANT` | full accounting, reports, payments, posting, period close. No user management. |
| `SALES` | customers, sales invoices, sales returns, receipts. Read-only products/inventory. |
| `PURCHASE` | suppliers, purchases, purchase returns, supplier payments, AI documents. |
| `INVENTORY` | products, stock adjustments, warehouses. No financial posting. |
| `VIEWER` | read-only everything except settings and audit log. |

Enforcement: `authorize('purchase.confirm')` middleware on the route + a service-level re-check for
anything destructive (cancel, void, period close). The double check exists because services are also
called by the AI module and by future jobs that do not pass through routes.

**Separation-of-duties note:** `purchase.create` and `purchase.confirm` are distinct permissions from day
one even though MVP roles grant both together. That is what makes maker-checker a config change later
rather than a schema change.

---

## 10. Transaction Status Model (§12)

```
            create               confirm/post                 cancel
  [ none ] ────────► DRAFT ──────────────────► POSTED ──────────────────► CANCELLED
                       │                          │
                       │ delete (hard)            │ void (reversal entry, immutable)
                       ▼                          ▼
                    [ gone ]                     VOID
```

| State | Inventory | Accounting | Party balance | Editable |
|---|---|---|---|---|
| `DRAFT` | none | none | none | fully editable, hard-deletable |
| `POSTED` | applied | journal entry created | applied | **not editable** |
| `CANCELLED` | reversed | reversal journal entry | reversed | no |
| `VOID` | reversed | reversal journal entry | reversed | no; used when the document itself was erroneous |

**The single rule that keeps this honest:** *nothing* touches inventory, accounting, or party balances
except the `post*` transition and its reversal. Draft edits are pure data.

`CANCELLED` vs `VOID`: cancel = a real transaction that was later called off (return-like semantics,
keeps the number); void = the document should never have existed (number retained for audit, marked void).
Both produce reversal entries, never deletions. If you decide you only need one of them, drop `VOID`.

**Editing a posted document** is done as: `void` the original, then clone into a new DRAFT for correction.
The UI presents this as "Edit", but the ledger sees the truth.

---

## 11. Purchase Workflow

```
1. POST /purchases                      -> DRAFT   (supplier, warehouse, items, taxes, dates)
   - validates supplier belongs to company, products active, quantities > 0
   - computes totals server-side (client totals are IGNORED, only echoed back)
2. PATCH /purchases/:id                 -> DRAFT   (freely editable)
3. POST /purchases/:id/confirm          -> POSTED  [ SINGLE DB TRANSACTION ]
     a. re-load with FOR UPDATE, assert status = DRAFT
     b. assert accounting period is OPEN for invoiceDate
     c. assert no duplicate (companyId, supplierId, supplierInvoiceNumber)
     d. allocate document number from DocumentSequence (row lock)
     e. recompute all totals server-side from lines (never trust stored totals)
     f. InventoryService.applyMovements(tx, IN, lines)   -> StockMovement rows
        -> updates StockBalance qty + recomputes moving average cost:
           newAvg = (oldQty*oldAvg + inQty*inCost) / (oldQty + inQty)
     g. PartyLedgerService: supplier payable += total
     h. AccountingService.post(tx, entry):
              Dr Inventory (or Purchase Expense for services)   subtotal-after-discount
              Dr Input CGST / Input SGST / Input IGST           tax components
              Dr Round Off (or Cr)                              rounding delta
              Cr Accounts Payable / supplier                    total
     i. AuditLog.write(PURCHASE_CONFIRMED, before, after)
4. POST /purchases/:id/cancel           -> CANCELLED [ SINGLE TRANSACTION ]
     - reverse stock movements (OUT at the SAME unit cost as the original IN)
     - reverse the journal entry (mirror entry, linked via reversalOfId)
     - reduce payable; REJECT if payments are already allocated (unallocate first)
     - REJECT if the resulting stock would go negative and the product has since been sold
       (error INSUFFICIENT_STOCK_FOR_REVERSAL, tells the user which sale consumed it)
```

**Why totals are always recomputed server-side:** the client (and the AI) are untrusted. A rounding
mismatch between client and server must fail the request, not silently write the client's number.

## 12. Sales Workflow

```
1. POST /sales                    -> DRAFT
2. POST /sales/:id/confirm        -> POSTED [ SINGLE TRANSACTION ]
     a. stock validation per line against StockBalance FOR UPDATE
        - if insufficient and settings.allowNegativeStock = false -> 409 INSUFFICIENT_STOCK
        - if allowed, proceed and flag the movement (negative stock inflates COGS later; documented)
     b. allocate invoice number
     c. InventoryService.applyMovements(tx, OUT, lines) at CURRENT avgCost
        -> writes costAtSale on each line (frozen forever)
     d. PartyLedgerService: customer receivable += total; credit-limit check (warn or block per settings)
     e. AccountingService.post:
              Dr Accounts Receivable / customer     total
              Cr Sales Revenue                      subtotal-after-discount
              Cr Output CGST / SGST / IGST          tax components
              Dr/Cr Round Off                       rounding delta
        and the COGS entry:
              Dr COGS                               sum(costAtSale)
              Cr Inventory                          sum(costAtSale)
     f. Audit
3. Cancel: mirror reversal, at costAtSale (not current average) so the ledger stays balanced.
```

**Why two journal entries (revenue + COGS) rather than one:** they answer different questions and are
reversed independently in edge cases. Both are created inside the same transaction with the same
`sourceType/sourceId`, so they always travel together.

## 13. Inventory Workflow

**Ledger is truth. Balance is cache.**

```
Current stock = SUM(StockMovement.quantity WHERE direction=IN)
              - SUM(StockMovement.quantity WHERE direction=OUT)
```

| Event | Direction | Unit cost used |
|---|---|---|
| Opening stock | IN | user-entered cost |
| Purchase posted | IN | purchase line unit cost (net of discount, incl. landed cost if enabled later) |
| Purchase return posted | OUT | original purchase unit cost |
| Sale posted | OUT | current moving average -> frozen as `costAtSale` |
| Sales return posted | IN | original `costAtSale` from the source line |
| Adjustment (increase) | IN | current average (or user cost for found goods) |
| Adjustment (decrease) | OUT | current average |

Moving-average recalculation happens **only on IN movements**. OUT movements consume at the current
average and never change it. This is the standard weighted-average rule and it keeps valuation stable.

Guards:
- `trackInventory = false` products (services) never produce StockMovements.
- Negative average cost is impossible: if `qty` hits 0, `avgCost` is retained (not zeroed) so the next
  sale of a re-stocked item is not valued at 0.
- `verifyStockIntegrity(companyId)` recomputes every balance from movements, reports drift, and can
  repair with an audit-logged correction. Runs on demand + nightly via `node-cron` in-process.

## 14. Payment Workflow

```
POST /payments  { direction, partyType, partyId, amount, method, accountId, allocations[] }
  [ SINGLE TRANSACTION ]
  1. validate sum(allocations) <= amount; remainder becomes unallocatedAmount (advance)
  2. validate each target belongs to the same party and company, and is POSTED
  3. validate allocation <= target.balanceDue
  4. update each target: amountPaid += alloc, balanceDue -= alloc,
                         paymentStatus = UNPAID | PARTIAL | PAID
  5. AccountingService.post:
       RECEIVED:  Dr Cash/Bank   amount     Cr Accounts Receivable / customer   amount
       PAID:      Dr Accounts Payable / supplier  amount   Cr Cash/Bank   amount
  6. Audit
```

Advances (unallocated) sit as a credit on the party ledger and can be allocated later via
`POST /payments/:id/allocate`. Deleting a payment is not allowed — reverse it.

## 15. Expense Workflow

```
POST /expenses -> DRAFT -> confirm -> POSTED
  Dr Expense Account (from ExpenseCategory)      amount
  Dr Input tax (if claimable)                    taxAmount
  Cr Cash/Bank (if paid)  OR  Cr Accounts Payable/supplier (if on credit)
```

## 16. Returns

**Sales return:** references the original invoice; per-line quantity may not exceed
(original qty − already returned qty). Stock IN at original `costAtSale`. Receivable decreases.
Journal is the mirror of the sale plus a COGS reversal.

**Purchase return:** references the original purchase. Stock OUT at the original purchase cost.
Payable decreases. Journal mirrors the purchase.

Both are separate documents with their own numbers and their own DRAFT/POSTED lifecycle — never edits to
the original. This is what makes the audit trail defensible.

## 17. Accounting Workflow

- **Double entry, always.** `AccountingService.post(tx, { entryDate, narration, sourceType, sourceId, lines })`
  validates: >= 2 lines, sum(debit) === sum(credit) to the cent, all accounts belong to the company and
  are active, and the period is OPEN. Then it writes `JournalEntry` + `JournalLine` and nothing else.
- **Accounts are resolved by `systemKey`**, never by hardcoded id or name lookup.
- **Chart of accounts** is seeded per company from a template (`prisma/seed/chart-of-accounts.seed.js`),
  Indian-SMB shaped: Assets(Cash, Bank, AR, Inventory, Input GST), Liabilities(AP, Output GST, Duties),
  Equity(Capital, Drawings, Retained Earnings), Income(Sales, Other Income, Discount Received),
  Expenses(COGS, Purchase, Rent, Salaries, Round Off, Discount Allowed).
- **Reversal, never deletion.** `reverseEntry(tx, entryId, reason)` creates a mirrored entry linked by
  `reversalOfId` and stamps `reversedById` on the original.
- **Period locking.** `AccountingPeriod.status = CLOSED` blocks all posting with `PERIOD_LOCKED`.
  Only `accounting.period.close` permission holders can close/reopen; every reopen is audit-logged.
- **Reports derive from JournalLine**, never from denormalised document totals. Trial balance, P&L, and
  balance sheet are all one query shape over `JournalLine` joined to `Account`.
- **Rounding rule (must be identical everywhere):** compute line amounts at 4 dp, round *half away from
  zero* to 2 dp at the line level, sum lines for the subtotal, compute tax per component at 2 dp, and put
  any invoice-level rounding delta into the `ROUND_OFF` account. Documented in `docs/accounting.md` and
  mirrored in the frontend's `money.ts`.

---

## 18. AI Document Workflow

**Governing principle: the AI module is an input device. It produces a DRAFT and stops.**

```
 [Upload]                     [Async pipeline]                       [Human]           [ERP]
    │                                                                   │                │
 POST /ai-documents ──► UPLOADED                                        │                │
    │  validate mime/size/magic-bytes                                   │                │
    │  sha256 -> exact-duplicate check                                  │                │
    │  store via StorageAdapter                                         │                │
    │  JobQueue.enqueue(processDocument)                                │                │
    ▼                                                                   │                │
 QUEUED ─► PROCESSING ─► [1] normalize (pdf->images, downscale, deskew) │                │
                         [2] OcrProvider.extractText()   (optional)     │                │
                         [3] AiProvider.extractInvoice() -> JSON        │                │
                         [4] Zod validate + arithmetic re-check         │                │
                         [5] supplier matching                          │                │
                         [6] product matching per line                  │                │
                         [7] confidence scoring                         │                │
                         [8] duplicate detection (fuzzy)                │                │
                              │                                         │                │
                              ├─ on failure ──► FAILED (attempt logged, retryable)       │
                              ▼                                                          │
                        NEEDS_REVIEW ──────────────────────────────────►│                │
                                        GET /ai-documents/:id/extraction│                │
                                        PATCH .../extraction (corrections)               │
                                        POST .../reject -> REJECTED     │                │
                                        POST .../create-draft ──────────┼───► PurchaseService
                                                                        │      .createDraft()
                                                                   DRAFT_CREATED ──► /purchases/:id
                                                                        │            (normal review)
                                                                        └──► POST /purchases/:id/confirm
                                                                             = the ONE normal posting path
```

**Status enum:** `UPLOADED, QUEUED, PROCESSING, NEEDS_REVIEW, DRAFT_CREATED, CONFIRMED, REJECTED, FAILED, DUPLICATE`.

**Structural guarantee (not just policy):**
`modules/ai-documents/**` is lint-forbidden from importing `inventory`, `accounting`, or any ledger
repository. The only ERP call it can make is `PurchaseService.createDraft()`. Even the final confirmation
is done by the user against the ordinary `/purchases/:id/confirm` endpoint — the AI path and the manual
path converge *before* anything is posted, so there is exactly one posting code path to test and trust.

### 18.1 Async without Redis

`JobQueue` interface: `enqueue(name, payload)`, `process(name, handler, { concurrency })`.
MVP implementation: in-process, `p-limit` concurrency 2, backed by `AIDocument.status` + `AIProcessingAttempt`.
- Crash safety: on boot, a reaper moves `PROCESSING` rows older than 10 minutes back to `QUEUED`
  (bounded by `attemptNumber < 3`, else `FAILED`).
- Frontend polls `GET /ai-documents/:id` every 2s while status is non-terminal (with backoff to 5s).
- Swapping to BullMQ later = implement the same two methods. No business code changes.

**Why not synchronous (deviating from §8):** a 5–40 second HTTP request is killed by most proxies and
gives the user a frozen screen. This design adds no infrastructure — only a status column you already need.

### 18.2 Provider abstraction

```
AiProvider {
  name, model,
  extractInvoice({ images[], text?, hints }) -> { json, usage, raw }
}
OcrProvider { extractText({ images[] }) -> { text, blocks[], confidence } }
```
Implementations: `anthropic` (vision, recommended default), `openai`, `gemini`, `mock` (fixture-driven,
used by every test — **no test ever calls a real provider**). Selected by `AI_PROVIDER` env var through a
factory. Business code depends only on the interface. Prompt templates live in
`modules/ai-documents/prompts/` and are versioned (`invoice-extract.v1.md`); `AIProcessingAttempt` records
which prompt version produced which result, so quality regressions are traceable.

### 18.3 Extraction schema (Zod-validated, AI output is untrusted)

```
{
  documentType: "PURCHASE_INVOICE" | "SALES_INVOICE" | "RECEIPT" | "CREDIT_NOTE" | "UNKNOWN",
  supplier: { name, gstin?, phone?, email?, address? },
  invoiceNumber, invoiceDate, dueDate?, currency,
  items: [{ description, sku?, hsnCode?, quantity, unit?, unitPrice,
            discount?, taxRate?, taxAmount?, amount, confidence }],
  subtotal, discount?, tax?, roundOff?, total, notes?,
  fieldConfidences: { "invoiceNumber": 0.98, "total": 0.91, "items[0].quantity": 0.62, ... }
}
```

Validation layers applied to every AI response, in order:
1. **JSON parse** with repair fallback (strip code fences, trailing commas). If still invalid -> retry once
   with a "return valid JSON only" follow-up, then `FAILED`.
2. **Zod schema** — types, enums, ISO dates, non-negative numbers.
3. **Arithmetic re-check** in `Decimal`: `qty * unitPrice - discount ≈ amount` per line;
   `sum(lines) ≈ subtotal`; `subtotal - discount + tax ≈ total` (tolerance 0.02 for rounding).
   Mismatches do **not** reject the document — they mark the offending fields low-confidence and flag the
   document `NEEDS_REVIEW` with a specific reason. A real invoice's own arithmetic is sometimes odd.
4. **Sanity bounds** — date within [today − 5y, today + 30d]; quantity < 1e6; total < 1e9;
   currency in the allowed list. Out-of-bounds -> field cleared + flagged, never auto-accepted.
5. **Injection defence** — extracted text is data, never instructions. The extraction prompt states this
   explicitly, output is schema-constrained, and no extracted string is ever interpolated into a later
   prompt without delimiting. Extracted strings are stored as text and rendered escaped.

### 18.4 Duplicate detection

Three tiers, cheapest first:
1. **Exact file** — `checksumSha256` match within the company -> `DUPLICATE`, hard stop.
2. **Strong business key** — same `supplierId` + `supplierInvoiceNumber` (normalised: uppercase,
   strip non-alphanumerics) -> block with `DUPLICATE_INVOICE`, link to the existing purchase.
3. **Fuzzy** — same supplier, total within 0.5%, invoice date within 3 days -> warn in the review UI,
   user decides. Never auto-blocks, because genuine repeat invoices exist.

## 19. AI Product Matching Strategy

A **standalone service** (`modules/ai-documents/service/matching.service.js`) so it is independently
testable and reusable by a future "bulk import" or barcode feature.

Cascade — first strong hit wins, but all candidates are retained for the UI:

| # | Method | Score | Notes |
|---|---|---|---|
| 1 | Exact SKU / barcode (normalised) | 1.00 | auto-`SUGGESTED` at top rank |
| 2 | `ProductAlias` exact match | 0.95 | the learned layer — grows with every confirmation |
| 3 | Postgres `pg_trgm` similarity on name (`similarity() > 0.35`), GIN index | 0.35–0.90 | cheap, no external service, handles "Fortune Oil 1 Ltr" vs "Fortune Sunflower Oil 1L" reasonably |
| 4 | Token overlap + numeric/unit-aware boost (1L == 1 Ltr == 1000ml) | +0.05–0.15 | a small hand-written normaliser; disproportionately effective on Indian FMCG naming |
| 5 | Embeddings (`pgvector`) | LATER | only if trigram accuracy proves insufficient in real use. Measure first. |

Output per line: up to 5 candidates as
`{ productId, name, score, reason: "SKU exact" | "alias" | "name similarity 0.72", method, status }`.

**Rules (from §16, and I fully agree):**
- Never auto-create a product on match failure.
- Never auto-confirm below the threshold (default 0.90, per-company configurable).
- User actions per line: **select existing** / **create new product** (opens a prefilled product form) /
  **ignore line** / **edit description and re-match**.
- On confirmation, write a `ProductAlias` from the extracted description -> chosen product
  (or bump `timesSeen`). This is the flywheel: month 3 matches far better than month 1 for the same customer.

**Supplier matching:** GSTIN exact (1.00) -> phone exact (0.95) -> normalised name trigram -> address hint.
Same statuses. Creating a new supplier from the review screen is allowed and encouraged, because a wrong
supplier merge is much more expensive to unwind than a duplicate supplier.

## 20. AI Confidence Strategy

Confidence is **composite**, not just whatever the model reports:

```
fieldConfidence = 0.5 * modelSelfReported
                + 0.3 * validationSignal   (arithmetic consistency, format match, bounds)
                + 0.2 * corroboration      (OCR text contains the value; label found nearby)
```

Thresholds (company-configurable, defaults):

| Band | Behaviour |
|---|---|
| >= 0.90 | shown normally, pre-filled |
| 0.70 – 0.89 | **amber highlight**, field focused in review order |
| < 0.70 | **red highlight**, field is cleared or marked "verify"; the document cannot become a draft until the user touches every red field |
| any critical field missing (`total`, `invoiceDate`, `supplier`) | `NEEDS_REVIEW`, blocking |

Document-level `overallConfidence = min(critical fields) * 0.7 + mean(all fields) * 0.3` — deliberately
pessimistic, because one wrong total is worse than ten right ones.

**Calibration:** every user correction is stored (before/after) in `AuditLog` with the original confidence,
producing a dataset that tells you whether "0.9" actually means 90%. Review this before ever raising a
threshold. Without this data, confidence numbers are decoration.

## 21. Handwritten Documents (phased, per §15)

- **V1** printed/digital/clean scans — vision-LLM direct, no OCR preprocessing beyond downscale + deskew.
- **V2** receipts, poor scans, varied layouts — add OCR text as a second signal, add perspective correction,
  add multi-page. Lower auto-accept thresholds.
- **V3** handwritten — same pipeline, different prompt + model choice, thresholds forced low so effectively
  everything is reviewed. **No schema change is required for V3** — that is the point of designing
  confidence and review in from the start.

Do not attempt V3 until V1 hits a measured >= 90% field accuracy on a held-out set of 100 real invoices.

## 22. AI Review UI (§22)

Two-column, desktop-first:

```
┌───────────────────────────┬───────────────────────────────────────────┐
│  DOCUMENT VIEWER          │  EXTRACTED DATA          [AI EXTRACTED]   │
│  zoom / rotate / pages    │  ┌──────────────────────────────────────┐ │
│  bounding-box highlight   │  │ Supplier   [Acme Traders ▾] 0.94  ✓  │ │
│  on field focus (V2)      │  │ Invoice #  [INV-2291]       0.99  ✓  │ │
│                           │  │ Date       [2026-08-12]     0.71  !  │ │
│                           │  ├── Items ────────────────────────────┤ │
│                           │  │ Fortune Oil 1 Ltr                    │ │
│                           │  │   -> Fortune Sunflower Oil 1L  0.82  │ │
│                           │  │      [change] [new product] [skip]   │ │
│                           │  ├── Totals (recomputed live) ─────────┤ │
│                           │  │ Subtotal 12,400  Tax 2,232           │ │
│                           │  │ Total    14,632   [matches doc ✓]    │ │
│                           │  └──────────────────────────────────────┘ │
│                           │  [Reject] [Reprocess] [Create Purchase Draft]│
└───────────────────────────┴───────────────────────────────────────────┘
```

Non-negotiable UI rules:
- A persistent **"AI EXTRACTED — NOT YET A TRANSACTION"** banner until the draft is created.
- Amber/red confidence highlighting with a legend; red fields block draft creation until touched.
- Totals recompute client-side as the user edits, and a mismatch against the document's stated total is
  shown as a warning, not silently corrected.
- "Create Purchase Draft" navigates to the **normal purchase edit screen** — the user then confirms there,
  using the same UI a manual purchase uses. This makes the "AI never posts" guarantee visible, not just true.

---

## 23. API Architecture

- **Base path `/api/v1`** from commit one. Version lives in the URL (simplest thing a mobile dev can reason
  about). Breaking changes create `/api/v2`; additive changes never bump the version.
- **Resource-oriented REST**, with explicit action sub-resources for state transitions:
  `POST /purchases/:id/confirm`, `/cancel`, `/void`. State changes are *not* modelled as
  `PATCH {status:"POSTED"}` — a transition has preconditions, permissions, and side effects, and deserves
  its own endpoint, its own permission, and its own OpenAPI entry.
- **Idempotency:** every state-changing POST accepts an `Idempotency-Key` header. Required (enforced) on
  `confirm`, `cancel`, `void`, and `payments`. Replay returns the stored response. This is how you survive
  a mobile client retrying on a flaky connection without double-posting a purchase.
- **Filtering/sorting/pagination:** `?page=1&limit=20&sort=-invoiceDate&search=acme&status=POSTED&dateFrom=&dateTo=`.
  `limit` max 100. Offset pagination for MVP; cursor pagination reserved for the mobile list endpoints later.
- **Correlation:** every response carries `X-Request-Id`; the same id appears in logs and `AuditLog`.
  A support ticket becomes one grep.
- **Rate limits:** global 300 req/min/IP; auth endpoints 10/min/IP; AI upload 20/hour/company.
- **Compression, ETag** on report endpoints. `Cache-Control: no-store` on everything financial.

### 23.1 Endpoint map (MVP)

```
auth        POST /auth/register|login|refresh|logout|logout-all|select-company   GET /auth/me
companies   GET|PATCH /companies/:id            GET|PATCH /companies/:id/settings
users       GET|POST /users   GET|PATCH|DELETE /users/:id   POST /users/:id/roles
roles       GET|POST /roles   GET|PATCH|DELETE /roles/:id   GET /permissions
products    GET|POST /products  GET|PATCH|DELETE /products/:id  GET /products/:id/stock
            GET /products/:id/ledger
categories  GET|POST /categories  ...    units GET|POST /units ...
customers   GET|POST /customers  GET|PATCH /customers/:id  GET /customers/:id/ledger
suppliers   GET|POST /suppliers  GET|PATCH /suppliers/:id  GET /suppliers/:id/ledger
warehouses  GET|POST /warehouses ...
sales       GET|POST /sales  GET|PATCH|DELETE /sales/:id
            POST /sales/:id/confirm|cancel|void   GET /sales/:id/pdf
            GET|POST /sales-returns  POST /sales-returns/:id/confirm
purchases   (mirror of sales)  +  GET /purchases?supplierInvoiceNumber=
inventory   GET /inventory/balances  GET /inventory/movements
            GET|POST /inventory/adjustments  POST /inventory/adjustments/:id/confirm
            POST /inventory/verify            (integrity check, admin only)
payments    GET|POST /payments  GET /payments/:id  POST /payments/:id/allocate
            POST /payments/:id/void
expenses    GET|POST /expenses  POST /expenses/:id/confirm
            GET|POST /expense-categories
taxes       GET|POST /taxes  GET|PATCH /taxes/:id
accounting  GET /accounts  POST /accounts  GET /journal-entries  GET /journal-entries/:id
            POST /journal-entries            (manual entry, restricted permission)
            GET /fiscal-years  POST /accounting/periods/:id/close|reopen
reports     GET /reports/dashboard | sales-summary | purchase-summary | stock-summary
            | stock-valuation | receivables-ageing | payables-ageing | profit-loss
            | balance-sheet | trial-balance | general-ledger | tax-summary
ai          POST /ai-documents (multipart)   GET /ai-documents   GET /ai-documents/:id
            GET /ai-documents/:id/file       GET /ai-documents/:id/extraction
            PATCH /ai-documents/:id/extraction
            POST /ai-documents/:id/reprocess|reject|create-draft
audit       GET /audit-logs
```

### 23.2 Response format (§18)

Success:
```json
{ "success": true, "data": { }, "message": "Purchase confirmed successfully",
  "meta": { "requestId": "01J..." } }
```
List:
```json
{ "success": true, "data": [ ],
  "pagination": { "page": 1, "limit": 20, "total": 150, "totalPages": 8, "hasNext": true } }
```
Error:
```json
{ "success": false,
  "error": { "code": "INSUFFICIENT_STOCK",
             "message": "Not enough stock for 2 items",
             "details": [ { "field": "items[1].quantity", "message": "Available 4, requested 10",
                            "productId": "01J...", "available": "4.000" } ] },
  "meta": { "requestId": "01J..." } }
```
`details` is always an array of objects (never a bare string), so mobile clients can map errors onto form
fields without string parsing. Error codes are a documented, stable enum in `docs/api/error-codes.md` —
they are part of the public contract and may not be renamed without a version bump.

HTTP status usage: 400 validation, 401 unauthenticated, 403 unauthorised/tenant mismatch,
404 not found (also used for cross-tenant id probes), 409 business-rule conflict (insufficient stock,
duplicate invoice, period locked), 422 semantically invalid state transition, 429 rate limit, 500 unexpected.

## 24. OpenAPI Documentation Strategy

**`docs/api/openapi.yaml` is the contract, hand-maintained, and CI-verified — not generated from comments.**

Structure: root file + `docs/api/paths/*.yaml` + `docs/api/components/schemas/*.yaml`, bundled by
`redocly bundle` into a single distributable file.

The three mechanisms that keep it from rotting:
1. **Response validation in tests.** Integration tests run every response through
   `express-openapi-validator` in strict mode. A response that does not match the spec fails the test suite.
   This is the whole trick — the spec is tested, so it is true.
2. **Request validation optional-but-available.** The same validator can run as middleware in dev to catch
   spec/implementation drift on the request side.
3. **Frontend codegen.** `openapi-typescript` generates `types/api.d.ts` for the Next.js app. A stale spec
   breaks the frontend build, so drift is discovered by the team, not by the mobile developer.

Also shipped: `docs/api/README.md` (auth walkthrough, pagination, error codes, idempotency, a full
"create a purchase from scratch" worked example), a Postman/Insomnia collection generated from the spec,
and Swagger UI served at `/api/v1/docs` in non-production.

Per §17, every endpoint documents: method, URL, auth requirement, required permission (as a custom
`x-permission` field), params, body schema, response schema, every error code it can emit, and a
request/response example. **Definition of done for any endpoint includes its spec entry.** An endpoint
without spec + example is not finished.

## 25. Backend Folder Structure (JavaScript)

```
business-platform-backend/
├── src/
│   ├── config/
│   │   ├── env.js                 # Zod-validated process.env; throws at boot on missing/invalid
│   │   ├── constants.js
│   │   └── index.js
│   ├── database/
│   │   ├── prisma.js              # PrismaClient singleton + tenant-guard extension
│   │   └── transaction.js         # withTransaction() helper, isolation levels, retry on 40001
│   ├── middlewares/
│   │   ├── authenticate.js  resolveTenant.js  authorize.js  validate.js
│   │   ├── errorHandler.js  notFound.js  requestContext.js  rateLimit.js
│   │   ├── idempotency.js   upload.js (multer + magic-byte check)
│   ├── common/
│   │   ├── errors/AppError.js  errorCodes.js
│   │   ├── http/response.js       # ok(), created(), paginated()
│   │   ├── permissions.js         # the static catalogue
│   │   └── types.d.ts             # shared JSDoc typedefs (ambient, not compiled)
│   ├── utils/
│   │   ├── money.js               # Decimal helpers: add, mul, roundHalfUp, allocate
│   │   ├── date.js  pagination.js  slug.js  logger.js  crypto.js  normalize.js
│   ├── platform/                  # swappable adapters (NOT business logic)
│   │   ├── storage/{index.js,local.storage.js,s3.storage.js}
│   │   ├── ai/{index.js,anthropic.provider.js,openai.provider.js,mock.provider.js}
│   │   ├── ocr/{index.js,none.js,tesseract.js}
│   │   ├── queue/{index.js,inProcess.queue.js}
│   │   └── mailer/{index.js,console.mailer.js,smtp.mailer.js}
│   ├── modules/
│   │   └── <module>/              # auth users companies roles products categories units
│   │       ├── <name>.routes.js   # customers suppliers warehouses sales purchases
│   │       ├── <name>.controller.js #  inventory payments expenses accounting taxes
│   │       ├── <name>.service.js  #   reports ai-documents audit notifications settings
│   │       ├── <name>.repository.js
│   │       ├── <name>.schema.js   # Zod
│   │       ├── <name>.constants.js
│   │       └── __tests__/
│   ├── jobs/
│   │   ├── index.js               # node-cron registrations
│   │   ├── stuckAiDocuments.job.js
│   │   ├── stockIntegrity.job.js
│   │   └── cleanupIdempotency.job.js
│   ├── routes/index.js            # mounts /api/v1/* — the single route registry
│   ├── app.js                     # express app assembly (exported for tests, no listen)
│   └── server.js                  # listen + graceful shutdown (SIGTERM, drain, prisma disconnect)
├── prisma/
│   ├── schema.prisma
│   ├── migrations/
│   └── seed/
│       ├── index.js               # runner: order-aware, idempotent, --only=<name> flag
│       ├── permissions.seed.js
│       ├── system-roles.seed.js
│       ├── admin.seed.js
│       ├── units.seed.js
│       ├── taxes.seed.js
│       ├── chart-of-accounts.seed.js
│       └── demo.seed.js           # dev only; refuses to run when NODE_ENV=production
├── docs/
│   ├── architecture.md  database.md  authentication.md  business-workflows.md
│   ├── accounting.md  inventory.md  ai-document-processing.md
│   ├── development.md  deployment.md
│   └── api/{openapi.yaml, paths/, components/, README.md, error-codes.md}
├── tests/
│   ├── setup.js  helpers/{factory.js,auth.js,db.js}
│   ├── integration/  e2e/  fixtures/ai-invoices/
├── storage/                       # gitignored local uploads (dev)
├── .env.example  eslint.config.js  .prettierrc
├── .nvmrc  .gitignore  package.json  README.md
```

**Notes on the JS-specific bits:**
- **No `jsconfig.json`, no `tsconfig.json`, no `typescript` dependency** (§39.4). There is no typecheck step.
- `src/common/schemas.js` holds the shared Zod schemas reused across modules (`ctxSchema`, `paginationSchema`,
  `moneySchema`, `idSchema`) — this file replaces what `types.d.ts` would have done, but at runtime.
- `src/common/contracts.js` holds `assertCtx()`, `assertTx()` and similar cheap runtime guards used at the
  top of posting services. They cost microseconds and catch the mistakes the compiler would have.
- Flat file naming (`purchases.service.js`) rather than nested `service/` folders — with ~20 modules,
  the extra directory depth costs more navigation time than it buys. §3's structure is honoured in spirit
  (clear layer separation) with less ceremony. Switch to folders if any module exceeds ~5 files per layer.

## 26. Frontend Folder Structure

```
business-platform-frontend/
├── app/
│   ├── (auth)/login|register|forgot-password/page.tsx
│   ├── (app)/layout.tsx                       # shell: sidebar, company switcher, auth guard
│   │   ├── dashboard/  products/  categories/  units/  customers/  suppliers/
│   │   ├── sales/{page,new,[id],returns}/  purchases/{...}/
│   │   ├── inventory/{balances,movements,adjustments}/
│   │   ├── payments/  expenses/  accounting/{accounts,journal,periods}/
│   │   ├── reports/{pnl,balance-sheet,trial-balance,stock,ageing,tax}/
│   │   ├── ai-documents/{page.tsx,[id]/review/page.tsx}
│   │   └── settings/{company,users,roles,invoice,taxes}/
│   └── api/auth/[...]/route.ts                # httpOnly cookie handling + proxy
├── components/ui/ (shadcn)  layout/  tables/(DataTable, columns helpers)
│              forms/(FormField, MoneyInput, DatePicker, ProductPicker, PartyPicker)
│              shared/(StatusBadge, ConfirmDialog, EmptyState, ErrorState, PageHeader)
├── features/<domain>/{components,hooks,api,schemas,types}
├── lib/{api/(client.ts, endpoints per domain), auth/, utils/(money.ts, date.ts), validations/}
├── hooks/(useDebounce, usePagination, useConfirm, usePermissions)
├── types/(api.d.ts  <- GENERATED from openapi.yaml)
├── config/(nav.ts, permissions.ts, constants.ts)
└── .env.example  next.config.mjs  tailwind.config.ts  tsconfig.json
```

Frontend design rules (§21): server-driven tables (sorting/filtering/pagination all hit the API),
`Ctrl+K` command palette, keyboard-first line-item entry on invoice screens (Tab through qty/rate,
Enter adds a row), sticky totals footer, optimistic UI **never** on financial mutations (always await the
server), explicit confirmation dialogs for confirm/cancel/void showing the exact ledger consequences.

## 27. Environment Variables

`src/config/env.js` parses `process.env` through Zod and **throws at boot** if anything is missing or
malformed. No `process.env` access anywhere else in the codebase (lint-enforced).

```
# --- core ---
NODE_ENV=development
PORT=4000
DATABASE_URL=postgresql://postgres:postgres@localhost:5432/business_platform?schema=public
FRONTEND_URL=http://localhost:3000
LOG_LEVEL=debug

# --- auth ---
JWT_SECRET=                       # >= 32 chars, generate: openssl rand -base64 48
JWT_ACCESS_EXPIRES_IN=15m
JWT_REFRESH_EXPIRES_IN=30d
BCRYPT_OR_ARGON=argon2

# --- admin seed (NEVER hardcoded, NEVER committed) ---
ADMIN_EMAIL=admin@example.com
ADMIN_PASSWORD=change-me
ADMIN_NAME=Platform Admin
ADMIN_COMPANY_NAME=Demo Company

# --- AI ---
AI_PROVIDER=anthropic             # anthropic | openai | gemini | mock
AI_API_KEY=
AI_MODEL=
AI_MAX_PAGES=10
AI_TIMEOUT_MS=120000
AI_MAX_FILE_SIZE_MB=15
AI_CONFIDENCE_AUTO_ACCEPT=0.90
OCR_PROVIDER=none                 # none | tesseract

# --- storage ---
STORAGE_PROVIDER=local            # local | s3
STORAGE_LOCAL_PATH=./storage
STORAGE_BUCKET=
STORAGE_REGION=
STORAGE_ACCESS_KEY=
STORAGE_SECRET_KEY=
STORAGE_ENDPOINT=                 # for R2 / MinIO

# --- limits ---
RATE_LIMIT_WINDOW_MS=60000
RATE_LIMIT_MAX=300
```

Frontend `.env.local`: `NEXT_PUBLIC_APP_NAME`, `API_BASE_URL` (server-side only — deliberately *not*
`NEXT_PUBLIC_`, so the browser talks to Next route handlers, not directly to Express),
`NEXT_PUBLIC_APP_URL`, `AUTH_COOKIE_NAME`.

Rules: `.env` is gitignored; `.env.example` is committed and complete; production secrets come from the
host's secret manager; `env.js` refuses to boot in production with `NODE_ENV=production` + a weak/dev
`JWT_SECRET` or a default `ADMIN_PASSWORD`.

## 28. Admin Seed Strategy

`prisma/seed/admin.seed.js`, invoked by `prisma/seed/index.js`, run **only** via `npm run seed`.
Never on application startup (§6) — `server.js` contains no seed import at all.

```
1. Zod-validate ADMIN_EMAIL (email) and ADMIN_PASSWORD (min 12 chars, not "change-me")
   -> on failure: exit(1) with an explicit message naming the missing variable and the fix
2. Ensure permission catalogue + system role templates exist (dependency-ordered seeds)
3. Find user by ADMIN_EMAIL (case-normalised)
     - exists -> log "admin already exists, skipping" and DO NOT change the password
                 (unless --force-password is passed, which is audit-logged)
     - absent -> hash with argon2id, create User
4. Ensure the admin company exists (ADMIN_COMPANY_NAME), plus its CoA, fiscal year, default warehouse,
   default units and taxes
5. Ensure Membership(user, company, isOwner=true) and UserRole -> OWNER
6. Wrap steps 3-5 in ONE transaction; all upserts keyed on natural keys -> safe to re-run any number of times
7. Log a summary; never log the password
```

Idempotency comes from `upsert` on natural keys, not from `deleteMany` + recreate. Re-running the seed on
a live database must be safe — that is the whole requirement in §6.7.

`package.json`: `"seed": "node prisma/seed/index.js"`, `"seed:demo": "node prisma/seed/index.js --only=demo"`.
`demo.seed.js` hard-refuses when `NODE_ENV=production`.

---

## 29. Security Architecture

| Layer | Control |
|---|---|
| Transport | HTTPS everywhere; HSTS at the proxy; `trust proxy` set correctly so rate limiting sees real IPs |
| Headers | `helmet` defaults + strict CSP on the frontend |
| CORS | explicit allowlist from `FRONTEND_URL` (comma-separated), `credentials: true`, no wildcard |
| AuthN | argon2id passwords, 15-min access JWT, rotating hashed refresh tokens, reuse detection, account lockout after 5 failures |
| AuthZ | permission middleware on routes + re-check inside destructive services |
| Tenancy | JWT-only `companyId`; Prisma extension throws on unscoped tenant queries; `updateMany`+count assertion on writes |
| Input | Zod on params/query/body; unknown keys stripped; explicit max lengths; `Decimal` coercion for money strings |
| Output | responses built from explicit serializers — `passwordHash`, `tokenHash`, internal ids never leave the process. Never `res.json(prismaModel)` directly. |
| SQL | Prisma parameterised queries only; the two raw queries we need (trigram search, report aggregates) use `Prisma.sql` tagged templates, never string concatenation |
| Files | extension + declared MIME + **magic-byte** verification (`file-type`), 15 MB cap, 10-page cap, randomised storage keys, stored outside the web root, **never statically served** — delivered through an authorised streaming endpoint. PDFs are rasterised, never rendered in-page. |
| AI | output treated as untrusted input (Zod + arithmetic + bounds); prompt-injection defence documented in §18.3; per-company AI rate limit and monthly spend cap |
| Rate limit | `express-rate-limit`, in-memory store (fine for a single instance; swap to a DB/Redis store when you scale out — the store is a config line) |
| Secrets | env-only, boot-time validation, weak-secret refusal in production, no secrets in logs (pino redact list: `authorization`, `password`, `token`, `apiKey`) |
| Audit | append-only `AuditLog`, no delete endpoint, before/after snapshots |
| Financial integrity | append-only ledgers, reversal-only corrections, period locking, idempotency keys, server-side total recomputation |
| Dependencies | `npm audit` + Dependabot in CI; lockfile committed; no unmaintained packages in the financial path |

**Explicitly out of scope for MVP (documented, not silently ignored):** 2FA, SSO/SAML, field-level
encryption at rest, WAF, penetration test. Recommended before the first paying customer with real books:
2FA for OWNER role, plus a third-party pen test.

## 30. Audit Architecture

`AuditService.record(tx, ctx, { action, entityType, entityId, before, after, metadata })`, called **inside**
the same transaction as the change, so an audit entry can never exist for a rolled-back change (nor vice versa).

Audited actions (per §24): `USER_LOGIN`, `USER_LOGIN_FAILED`, `USER_CREATED`, `USER_ROLE_CHANGED`,
`PRODUCT_CREATED/UPDATED/ARCHIVED`, `PURCHASE_CREATED/CONFIRMED/CANCELLED/VOIDED`,
`SALE_CREATED/CONFIRMED/CANCELLED/VOIDED`, `RETURN_CONFIRMED`, `PAYMENT_CREATED/VOIDED`,
`EXPENSE_CONFIRMED`, `STOCK_ADJUSTED`, `JOURNAL_POSTED/REVERSED`, `PERIOD_CLOSED/REOPENED`,
`SETTINGS_UPDATED`, `AI_DOCUMENT_UPLOADED/REPROCESSED/REJECTED/DRAFT_CREATED/FIELD_CORRECTED`.

Stored: user, company, action, entity type/id, `before`/`after` JSONB diffs (money as strings), metadata
(e.g. the AI confidence at correction time), ip, userAgent, requestId, timestamp.
Retention: indefinite for financial actions. Read-only API (`GET /audit-logs`, filterable), no update or
delete route exists anywhere in the codebase.

`AI_DOCUMENT_FIELD_CORRECTED` doubles as the AI calibration dataset (§20) — this is why user corrections
carry the original confidence value.

## 31. Testing Strategy

**Vitest** (native ESM, fast, no Babel/ts-jest ceremony) + **Supertest** for HTTP.
Real PostgreSQL for integration tests (a separate `business_platform_test` database, migrations applied,
each test wrapped in a transaction that is rolled back). **No mocking of Prisma** — mocked ORMs test your
mocks, not your SQL, and this system's risk lives in the SQL.

| Layer | Coverage target | What it proves |
|---|---|---|
| Unit — money/rounding/tax/average-cost | 100% of `utils/money.js`, tax calc, avg-cost calc | the arithmetic is right |
| Service (integration, real DB) | **the priority**, ~85% | invariants hold |
| API (supertest + OpenAPI response validation) | every endpoint, happy path + 2 error paths | contract is true |
| E2E | ~6 golden flows | it works end to end |

**Mandatory service tests (these are the acceptance criteria for the whole project):**

```
purchase.confirm    -> stock qty increased, avg cost recomputed correctly,
                       payable increased, journal balanced (debits == credits),
                       document number allocated, audit row written
purchase.cancel     -> all of the above reversed, reversal entry linked
sale.confirm        -> stock decreased, costAtSale frozen, receivable increased,
                       revenue + COGS entries both balanced
sale.confirm        -> rejected with 409 when stock insufficient and negative stock disallowed
payment.create      -> allocations applied, balanceDue correct, cash/bank entry balanced
                    -> over-allocation rejected
returns             -> quantity cannot exceed original minus already-returned
period lock         -> posting into a CLOSED period rejected
tenant isolation    -> every endpoint returns 404 for another company's id (parameterised over ALL routes)
idempotency         -> the same Idempotency-Key posts exactly once under concurrent double-submit
concurrency         -> two simultaneous sales of the last unit: exactly one succeeds
integrity           -> after N random posts, recomputed stock == StockBalance,
                       and sum(all journal debits) == sum(all journal credits)
AI: invalid JSON    -> document FAILED, no draft created
AI: arithmetic off  -> fields flagged, NEEDS_REVIEW, no draft created
AI: low confidence  -> draft creation blocked until fields touched
AI: duplicate       -> exact-hash and business-key duplicates detected
AI: product match   -> known fixture pairs match above threshold; unknown ones do NOT auto-create
AI: boundary        -> ai-documents module cannot reach stock/journal (architecture test on imports)
```

The last one is a real test: it walks `src/modules/ai-documents/**` imports and fails on a forbidden edge.
Architecture rules that are only in a document are not rules.

CI (GitHub Actions): install -> lint -> `prisma migrate deploy` on a Postgres service container -> test ->
OpenAPI bundle+lint -> `npm audit`. All required to merge.

**Because there is no typecheck step (§39.4), the lint config carries more weight than usual.** Required rules:
`no-restricted-imports` (layer + AI boundaries), `no-floating-promises` equivalent via
`eslint-plugin-promise`, a custom rule banning arithmetic operators on values derived from `Number(...)`
inside `**/service/**`, `no-restricted-globals` for `process.env` outside `config/env.js`, and
`import/no-cycle`. Coverage thresholds are enforced in CI: 100% on `utils/money.js` and the tax/average-cost
calculators, 85% on `**/service/**`. A PR that drops service coverage fails.

## 32. Development Phases

Each phase ends with the §34 gate: compiles, tests green, migrations apply cleanly from scratch,
API behaviour verified, OpenAPI updated, docs updated. Only then does the next phase start.

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Foundations** | This plan signed off; decisions in §34 closed; repos created; Prisma schema v1 for identity+master data; CI pipeline; error/response/logging/config skeleton | `npm run dev` boots, `/health` green, CI passes on an empty test suite |
| **1. Auth + tenancy** | User, Company, Membership, Role, Permission, RefreshToken; register/login/refresh/logout/select-company; middleware trio; admin seed; permission catalogue seed | tenant-isolation test suite green; auth documented in OpenAPI |
| **2. Master data** | Units, Categories, Taxes+Components, Products, Customers, Suppliers, Warehouses; CoA + fiscal year seed | full CRUD + pagination/search; tenant tests parameterised over all new routes |
| **3. Accounting core** | Account, JournalEntry/Line, FiscalYear, AccountingPeriod, `AccountingService.post/reverse`, period locking, trial balance | balanced-entry invariant test; trial balance always nets to zero |
| **4. Inventory core** | StockMovement, StockBalance, moving average, adjustments, integrity job | integrity test after randomised movement sequences |
| **5. Purchases** | Draft -> confirm -> cancel, wired to inventory + accounting + payable, document numbering, idempotency | the full purchase.confirm test matrix |
| **6. Sales** | Mirror of purchases + stock validation + COGS | full sale.confirm matrix incl. concurrency |
| **7. Returns + payments + expenses** | Both return types, Payment + allocations, Expense | ageing reports reconcile to the ledger |
| **8. Reports** | Dashboard, P&L, balance sheet, trial balance, GL, stock valuation, ageing, tax summary | every report derives from JournalLine/StockMovement; reconciliation test |
| **9. Frontend foundation** | Auth screens, app shell, company switcher, DataTable, form primitives, master-data CRUD screens | a user can log in and manage all master data |
| **10. Frontend transactions** | Purchase/sales/returns/payments/expenses screens, inventory views, reports | MVP items 1-13 fully usable in the browser |
| **11. AI pipeline** | Upload, storage adapter, provider abstraction, queue, extraction, Zod+arithmetic validation, statuses | mock-provider tests green end to end; one real invoice extracted successfully |
| **12. AI matching** | Supplier + product matching, ProductAlias learning, duplicate detection | measured accuracy on a 30-invoice fixture set |
| **13. AI review UI + draft creation** | Two-column review, confidence highlighting, corrections, `create-draft` -> purchase confirm | **the headline demo works end to end** |
| **14. Hardening** | Audit coverage sweep, rate limits, security review, load sanity check, accessibility pass, error/empty/loading states, full OpenAPI + docs | pen-test-style self-review checklist complete |
| **15. Deployment** | Prod DB, backups + restore drill, deploy pipeline, monitoring, error tracking, runbook | restore-from-backup rehearsed at least once |

**Sequencing rationale:** accounting and inventory (3, 4) come *before* the documents that use them (5, 6),
because the invariant layer is what everything else depends on and it is the most expensive thing to
retrofit. AI (11-13) comes last deliberately — it is the differentiator, but it is worth nothing on top of
a purchase workflow that posts wrong journal entries.

Realistic effort for one experienced full-stack developer: phases 0-8 ≈ 8-11 weeks, 9-10 ≈ 5-7 weeks,
11-13 ≈ 3-4 weeks, 14-15 ≈ 2 weeks. **Roughly 4.5-6 months.** Two developers (one backend, one frontend)
compress it to ~3-3.5 months, not half, because phases 3-6 are inherently sequential.

## 33. MVP Scope

**In** (exactly the §27 list): register/login, company setup, users + roles, products/categories/units,
customers, suppliers, single warehouse, purchases, sales, ledger-based inventory, payments with
allocations, receivables/payables, double-entry accounting with auto-generated entries, 8 core reports,
AI upload -> extract -> match -> review -> correct -> confirm -> real purchase.

**Explicitly out of MVP, and I recommend saying so out loud to stakeholders:** multi-warehouse transfers,
branches, POS, barcode scanning, manufacturing/BOM, multi-currency, payroll, e-invoice/e-way bill,
GSTR filing exports, price lists, credit notes as separate instruments, recurring invoices, WhatsApp/SMS
sending, offline mode, handwritten OCR, mobile app.

**MVP definition of done:** a real shopkeeper can run one month of their actual business on it, and the
trial balance at month end matches a manually kept book. That, not feature count, is the bar.

## 34. Future Scope (extension points designed in, not built)

| Future | What in the design already accommodates it |
|---|---|
| React Native app | the API is the contract; OpenAPI spec + Bearer tokens (no cookie dependency in Express) |
| Barcode / POS | `Product.barcode` indexed; matching service reusable |
| Multi-warehouse / branches | `warehouseId` on every movement; `branchId` column reserved |
| Manufacturing / BOM | StockMovement `movementType` enum extends; consumption+production are just movement pairs |
| Multi-currency | `currency` on Company and documents; add `exchangeRate` + a revaluation entry type |
| Redis / BullMQ | `JobQueue` interface already isolates it; rate-limit store is a config line |
| Object storage | `StorageAdapter` already isolates it; only `STORAGE_PROVIDER` changes |
| Embeddings-based matching | matching cascade has a slot for it; add `pgvector` |
| Webhooks / integrations | audit events are already the natural event source |
| AI assistant / forecasting | the ledger tables are the feature store |
| GST returns | `TaxComponent` + `placeOfSupply` + HSN are captured from day one — this is why they are in MVP |

## 35. Local Development Setup

**Prerequisites:** Node 22 LTS (you currently run 25 — install 22 and pin via `.nvmrc`), PostgreSQL 16,
git. No Docker, no Redis, nothing paid. Note: `psql` was not on your PATH — install PostgreSQL 16 and add
its `bin` to PATH, or use pgAdmin.

```
# backend
git clone <backend-repo> && cd business-platform-backend
npm install
cp .env.example .env                 # then edit DATABASE_URL, JWT_SECRET, ADMIN_*
createdb business_platform           # or: CREATE DATABASE business_platform; in pgAdmin
npx prisma migrate dev               # creates schema + generates client
npm run seed                         # permissions, roles, admin, units, taxes, CoA
npm run dev                          # http://localhost:4000  ·  docs at /api/v1/docs

# frontend
git clone <frontend-repo> && cd business-platform-frontend
npm install
cp .env.example .env.local           # API_BASE_URL=http://localhost:4000/api/v1
npm run api:types                    # generate types/api.d.ts from the backend OpenAPI spec
npm run dev                          # http://localhost:3000
```

Backend scripts: `dev` (`node --watch src/server.js`), `start`, `seed`, `seed:demo`, `test`, `test:watch`,
`test:coverage`, `lint`, `format`, `db:migrate`, `db:reset`, `db:studio`, `api:bundle`, `api:lint`.
No `typecheck` script — there is no type checker in this project (§39.4).

AI works with `AI_PROVIDER=mock` and zero API keys, using fixtures in `tests/fixtures/ai-invoices/` — so a
new developer, and the entire test suite, never needs a paid key.

## 36. Deployment Plan

Deliberately boring and portable — no provider lock-in.

| Piece | Choice | Notes |
|---|---|---|
| Backend | single Node process behind nginx/Caddy on a VPS, managed by systemd or PM2. Render/Railway/Fly work identically. | one process is genuinely enough for early scale; scale vertically first |
| Frontend | Vercel (or the same VPS via `next start`) | |
| Database | managed Postgres (Neon/Supabase/RDS) or VPS Postgres with `pg_dump` + WAL archiving | **daily automated backup + a rehearsed restore.** Untested backups are not backups. |
| Files | local disk + backups initially; switch `STORAGE_PROVIDER=s3` (S3/R2) before the first multi-instance deploy | local disk is the one thing that blocks horizontal scaling — a known, deliberate tradeoff |
| Migrations | `prisma migrate deploy` in the release step, never `migrate dev`; expand-then-contract for breaking changes | |
| Secrets | host secret manager / systemd `EnvironmentFile` with 600 perms | |
| Observability | pino JSON -> file/stdout collector; Sentry (free tier) for errors; `/health` (liveness) and `/ready` (DB check) | |
| Zero-downtime | graceful SIGTERM: stop accepting, drain in-flight, `prisma.$disconnect()` | |

Because the app is a single process with local file storage, **run one instance until you move storage to
S3.** That constraint is written into `docs/deployment.md` so nobody scales it horizontally by accident and
loses uploaded invoices.

---

## 37. Recommended npm Packages

**Backend (runtime)** — deliberately small; every dependency in the financial path is a liability.

| Package | Purpose | Why this one |
|---|---|---|
| `express` ^5 | HTTP | v5 handles async errors natively — no `express-async-errors` hack |
| `@prisma/client`, `prisma` | ORM + migrations | migrations, `Decimal`, and generated `.d.ts` that give a JS codebase real editor types |
| `zod` ^3 | validation | the correctness backbone of a JS backend |
| `jsonwebtoken` | JWT | boring and proven (`jose` if you prefer ESM-native) |
| `@node-rs/argon2` | password hashing | prebuilt binaries, no node-gyp pain on Windows; `bcrypt`/`bcryptjs` as fallback |
| `pino`, `pino-http`, `pino-pretty`(dev) | logging | fastest structured logger; redaction built in |
| `helmet`, `cors`, `express-rate-limit`, `compression` | HTTP hardening | standard |
| `multer` + `file-type` | uploads + magic-byte checks | extension/MIME alone is not verification |
| `decimal.js` | money math | re-exported by Prisma; used directly in calculators |
| `date-fns`, `date-fns-tz` | dates | tree-shakeable, no moment.js baggage |
| `uuid` (v7) | ids | time-sortable primary keys |
| `p-limit` | in-process queue concurrency | 20 lines of dependency instead of Redis |
| `node-cron` | in-process schedules | integrity + reaper jobs, no external scheduler |
| `pdfjs-dist` or `pdf-to-img` | PDF -> images for AI | needed for scanned PDFs |
| `sharp` | image downscale/rotate/normalise | cuts AI token cost substantially |
| `@anthropic-ai/sdk` / `openai` | AI providers | behind the `AiProvider` interface, never imported by business code |
| `@aws-sdk/client-s3` | storage (later) | S3 + R2 compatible |
| `nodemailer` | email (later) | |
| `puppeteer` **or** `@react-pdf/renderer` | invoice PDFs | decide in §38; puppeteer is heavy but pixel-accurate |

**Backend (dev):** `vitest`, `supertest`, `eslint` + `eslint-plugin-import` + `eslint-plugin-security`,
`prettier`, `eslint-plugin-promise`, `@redocly/cli`,
`express-openapi-validator`, `@faker-js/faker`, `dotenv-cli`, `husky` + `lint-staged`.

**Frontend:** `next`, `react`, `typescript`, `tailwindcss`, `shadcn/ui` (+ `radix-ui`, `lucide-react`,
`class-variance-authority`, `tailwind-merge`), `@tanstack/react-query`, `@tanstack/react-table`,
`react-hook-form`, `@hookform/resolvers`, `zod`, `date-fns`, `sonner` (toasts), `recharts` (dashboard),
`react-pdf`/`pdfjs-dist` (document viewer), `openapi-typescript` (dev), `nuqs` (URL-synced table filters).

**Explicitly rejected for now:** Redis, BullMQ, Docker (dev), Kafka, tRPC (breaks the mobile-friendly REST
contract), GraphQL, NestJS (heavy DI for a small team), Sequelize/TypeORM, moment.js, lodash (native JS
suffices), any ORM-mocking library.

## 38. Risks and Technical Tradeoffs

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| 1 | **No compile-time type checking on a financial backend** (§39.4) | High — the bug class TS prevents (wrong shape into a journal line, `undefined` silently becoming `NaN` in a total) is exactly the class that corrupts books, and it fails *quietly* | Zod at every external **and internal posting** boundary; `Decimal` everywhere with a lint ban on float arithmetic in services; runtime `assertCtx`/`assertTx` guards; enforced coverage floors (100% money utils, 85% services); the full §31 service-test matrix is a merge gate, not a goal. **This remains the single biggest quality risk in the plan and it is now carried by discipline rather than tooling.** If ledger bugs start reaching main, the cheapest reversal is adding `checkJs` to `service/**` only — no code rewrite required, which is why JSDoc on service signatures is still encouraged. |
| 2 | **Costing method undecided** | High — blocks phases 4-6 | Decide before phase 4 (§39.1). Weighted average recommended. |
| 3 | **Money as floats slipping in** | Critical | `Decimal` only; ESLint ban on arithmetic operators applied to `Number(...)` in `service/**`; property-based tests on the money utils |
| 4 | **Concurrent posting races** (two sales of the last unit) | High | `FOR UPDATE` on balance rows ordered by productId; serializable retry on 40001; explicit concurrency tests |
| 5 | **AI accuracy below user tolerance** | High — it is the differentiator | Review-first UX (never auto-post), confidence gating, alias learning, a 30-invoice measured fixture set before launch. Set expectations: "assisted entry", not "automatic". |
| 6 | **AI cost per document** | Medium — unbounded spend | per-attempt token/cost logging, page cap, image downscaling, per-company monthly cap, cheaper model for re-runs |
| 7 | **In-process queue loses jobs on crash** | Medium | DB-backed status + boot reaper + bounded retries. Documented limitation; BullMQ swap is a one-file change. |
| 8 | **Local file storage blocks horizontal scaling** | Medium | `StorageAdapter` written first; deployment doc states "one instance until S3" |
| 9 | **`StockBalance` cache drifting from the ledger** | High | nightly + on-demand integrity job; movements are always truth; drift alerts |
| 10 | **GST complexity** (place of supply, RCM, e-invoicing, HSN rules) | Medium-High for the Indian market | model `TaxComponent` + `placeOfSupply` + `hsnCode` now; keep filing/e-invoice out of MVP; get one real accountant to review the CoA and tax posting before launch |
| 11 | **Scope size** — 20 modules is a lot for a small team | High — the most likely actual failure mode | strict phase gates, MVP discipline, deferred tables genuinely deferred; resist "while we're in here" additions |
| 12 | **Offset pagination degrades on large tables** | Low now, medium later | keyset pagination reserved for mobile list endpoints |
| 13 | **JWT permission staleness (15 min)** | Medium | `tokenVersion` check on every request (§7) |
| 14 | **No PDF/print engine chosen** | Medium — customers judge you by the invoice they hand a buyer | decide in §39.7 |
| 15 | **Backup/restore never rehearsed** | Critical if it happens | restore drill is a phase-15 exit criterion, not a nice-to-have |

**Consciously accepted tradeoffs:** monolith over microservices (transactional integrity beats independent
scaling at this size); shared-schema tenancy over isolation (cost and operability, mitigated three ways);
weighted average over FIFO (simplicity, at the cost of exact lot tracing); offset pagination over cursor
(simplicity now); hand-written OpenAPI over generated (accuracy over convenience).

## 39. Decisions Required Before Coding

These block or materially reshape work. My recommendation is given for each; I need your confirmation.

| # | Decision | Options | My recommendation | Blocks |
|---|---|---|---|---|
| 1 | ~~**Inventory costing**~~ | — | ✅ **DECIDED: Moving Weighted Average.** Company+product level, recomputed on IN movements only. | resolved |
| 2 | ~~**Tax regime**~~ | — | ✅ **DECIDED: India GST first.** CGST/SGST/IGST via `TaxComponent`, place-of-supply driven, HSN captured. Generic VAT = single-component config. | resolved |
| 3 | ~~**Status model**~~ | — | ✅ **DECIDED: DRAFT → POSTED** (+ CANCELLED/VOID). `CONFIRMED` stays in the enum, unused. | resolved |
| 4 | ~~**Backend type discipline**~~ | — | ✅ **DECIDED: plain JS, Zod only.** No TypeScript, no `checkJs`, no typecheck step. Compensating controls in §2.1, §31, §38.1. | resolved |
| 5 | **Multi-company per user** | one company per user / `Membership` N:M | **`Membership`** — retrofitting after real users exist is painful | Phase 1 |
| 6 | **AI provider default** | Anthropic / OpenAI / Gemini | **Anthropic vision** as default, `mock` for all tests, others behind the same interface | Phase 11 |
| 7 | **Invoice PDF engine** | puppeteer (HTML->PDF) / @react-pdf/renderer / client-side print | **puppeteer server-side** if invoice fidelity matters commercially; otherwise defer PDFs to post-MVP and ship browser print | Phase 10 |
| 8 | **Negative stock default** | block / allow with warning | **block by default**, per-company setting to allow | Phase 6 |
| 9 | **Opening balances** | products/parties opening balance entry method | dedicated "Opening Balance" journal + opening stock movements dated to fiscal-year start — needed for real onboarding | Phase 4 |
| 10 | **Repo hosting + CI** | GitHub / GitLab; Actions config | **GitHub + Actions**, two repos as specified | Phase 0 |
| 11 | **Numbering format** | per fiscal year, resettable, prefix rules | `INV/2026-27/00001`, per company, per doc type, per fiscal year, gap-free | Phase 5 |
| 12 | **`VOID` vs `CANCELLED`** | keep both / keep one | keep both only if you want the distinction in reports; otherwise drop `VOID` | Phase 5 |

**Missing from the brief, flagged now:**
- Password reset / email verification flow (needs an email provider decision — `console` mailer for MVP).
- User invitation flow for adding staff to a company (implied by "create users and assign roles").
- Opening balance onboarding — no real business starts from zero (decision 9).
- Data export (CSV/Excel) — every SMB accounting tool needs it; the accountant will ask on day one.
- GDPR/data-deletion policy vs the append-only audit requirement — these conflict; document the position.
- Currency: single currency per company assumed for MVP.

## 40. Immediate Next Steps

1. ✅ Done — §39 decisions 1–4 are locked (see §0.1). Rows 5–12 can be answered at their phase gates,
   except **#5 (Membership)** and **#10 (repo hosting)**, which I need before Phase 1 and Phase 0 respectively.
2. I create the two repositories with the scaffolding of Phase 0 only:
   config + env validation + logger + error handling + response envelope + Prisma schema v1 +
   health endpoint + CI + the doc skeleton. Nothing else.
3. Phase 0 review, then Phase 1 (auth + tenancy + admin seed), reviewed at its gate.
4. Repeat, one phase at a time, with the §34 checklist enforced at each gate.

Nothing is implemented until step 1 is answered. Correctness > data consistency > security >
maintainability > feature count — especially for accounting and inventory.
