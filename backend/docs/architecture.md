# Architecture

## Layers

```
HTTP request
    |
    v
Route          src/modules/<name>/<name>.routes.js
    |          registers the path, and the middleware chain
    v          (requireAuth -> requireRole -> validate)
Controller     src/modules/<name>/<name>.controller.js
    |          reads the request, calls one service, sends the response
    v
Service        src/modules/<name>/<name>.service.js
    |          business rules, authorization decisions, orchestration
    v
Repository     src/modules/<name>/<name>.repository.js
    |          all Prisma queries
    v
Prisma         src/config/prisma.js  (one shared client)
    |
    v
PostgreSQL
```

## Responsibility of each layer

| Layer | Does | Must never |
|---|---|---|
| **Route** | Declares method, path and middleware order. | Contain logic. |
| **Validation** (`<name>.validation.js`) | Zod schemas for body, params and query. | Touch the database. |
| **Controller** | Translates HTTP to a service call and back. | Contain business rules or Prisma calls. |
| **Service** | Business rules, permissions beyond the route level, tenant scoping, hashing, transactions. | Import Prisma directly, or touch `req` / `res`. |
| **Repository** | Every Prisma query, with explicit named methods. | Decide whether an action is allowed. |
| **Prisma client** | One instance, `src/config/prisma.js`. | Be instantiated anywhere else. |

Deliberately **not** used: DAO, Factory, UseCase, Adapter, Manager, RepositoryFactory,
repository interfaces (`IUserRepository` / `UserRepositoryImpl`). A plain module of exported
functions is enough.

## Rules that keep the layers honest

1. **Only repositories and `src/config/` import the Prisma client.**
   Verify at any time:
   ```bash
   grep -rn "prisma\." src/ --include=*.js | grep -v repository.js
   ```
   The only expected results are `src/config/prisma.js` and `src/config/transaction.js`.

2. **One repository owns one table.** `user.repository.js` owns `users`. The only exception is
   `auth.repository.js`, which owns the three authentication queries (login lookup, token context,
   last-login stamp) because those are the only queries allowed to read `passwordHash` or to run
   before a company is known. No query is duplicated between the two.

3. **Repository methods are explicit and business-oriented** - `findByIdAndCompany(id, companyId)`,
   not `findAnything(where)`. If a repository method takes a raw Prisma `where` object, the tenant
   rule below can no longer be enforced by reading the method name.

4. **Repositories accept an optional Prisma client as the last argument** so they can join a
   transaction. See "Transactions" below.

## Multi-tenancy (the most important rule in this codebase)

Every business record belongs to a company: users, and all eight master-data modules.
Tomorrow it is invoices, stock and ledgers.

**The company is always derived from the authenticated user, never from client input.**

```js
// CORRECT - company comes from the verified token -> database lookup
userRepository.findManyByCompany(req.user.companyId, options);

// WRONG - a client could pass any company id
userRepository.findManyByCompany(req.query.companyId, options);
```

How this is enforced:

- `requireAuth` loads the user from the database on every request and sets `req.user`
  (`id`, `email`, `name`, `role`, `companyId`). The JWT only says *which* user is calling;
  role, company and active status always come from the database, so a deactivated user or a
  role change takes effect immediately instead of when the token expires.
- Services take `currentUser` and read `currentUser.companyId` themselves.
- `companyId` is not part of any request schema. `createUserSchema` deliberately omits it, so a
  client-supplied `companyId` is stripped by Zod before it reaches the service.
- Company-scoped repository methods take `companyId` as a separate, required argument.
- Writes use `updateMany({ where: { id, companyId } })` and check the affected count, rather than
  `update({ where: { id } })`. A record in another company therefore cannot be modified even if the
  id is known.
- A record belonging to another company returns **404, not 403**, so ids cannot be probed by
  comparing error codes.

New modules must follow the same pattern. A repository method that reads or writes tenant data and
does not take a `companyId` should not pass code review.

## Authorization

Three small middlewares, composed in the route definition:

```js
userRoutes.use(requireAuth, requireRole('ADMIN'));
companyRoutes.get('/:id', requireRole('ADMIN'), validate({...}), requireCompanyAccess('id'), handler);
```

- `requireAuth` - authenticates and builds `req.user`.
- `requireRole(...roles)` - role check; roles come from the database via `req.user`.
- `requireCompanyAccess(param)` - for routes that name a company in the URL.

Roles are a Prisma enum (`ADMIN`, `STAFF`), not database tables. That is sufficient for now.
When granular permissions are needed, add a `requirePermission('user.create')` middleware next to
`requireRole` and change route definitions only - controllers and services stay untouched, because
no controller performs its own authorization.

Services re-check authorization-relevant rules (for example "is this user in my company") rather
than trusting that a middleware ran, because services are also called from the seed and from tests.

## Transactions

`withTransaction(fn)` in `src/config/transaction.js` wraps `prisma.$transaction` so services never
import the Prisma client. Repository functions take the transaction client as their last argument:

```js
await withTransaction(async (tx) => {
  const company = await companyRepository.create(data, tx);
  await userRepository.create({ ...userData, companyId: company.id }, tx);
});
```

Used where several writes must succeed together (creating a company plus its first admin).
Not used for simple reads. Later phases - purchases, stock movements, journal entries - will rely
on this heavily.

## Error and response shape

One success shape and one error shape, produced by `src/utils/response.js` and the central error
handler. Controllers never build error responses themselves.

```
{ "success": true, "data": {...} }
{ "success": true, "data": {...}, "message": "..." }
{ "success": true, "data": [...], "pagination": { page, limit, total, totalPages } }
{ "success": false, "message": "..." }
{ "success": false, "message": "Validation failed", "errors": [ { "field": "...", "message": "..." } ] }
```

The error handler converts `ApiError`, Zod errors, malformed JSON, oversized bodies and Prisma
error codes (for example `P2002` unique violation to 409) into safe messages. Raw Prisma errors and
stack traces are never returned; in production the 500 message is generic.

## Audit (future)

Not implemented. The structure is ready for it: every write already goes through a service that
knows `currentUser` (actor), `currentUser.companyId` (tenant) and the entity being changed. An
audit record can therefore be written inside the same service - and inside the same
`withTransaction` block - without changing controllers or repositories.


## Master data

Eight modules follow one identical shape: `categories`, `units`, `taxes`, `warehouses`,
`products`, `suppliers`, `customers` and `company-settings`.

```
Company
 |- CompanySettings   (exactly one, created with the company)
 |- Category ---------\
 |- Unit -------------- Product      (a product needs a category and a unit,
 |- Tax --------------/               and optionally a tax)
 |- Warehouse ---------- InventoryBalance / StockMovement  (see Inventory below)
 |- Supplier
 |- Customer
```

Every one of them is company scoped, uses the repository layer, validates with Zod,
supports `page`/`limit`/`search`/`isActive`, and is deactivated rather than deleted.

### Cross-entity tenant validation

A foreign key guarantees that `Product.categoryId` points at a real category. It cannot
guarantee that the category belongs to the **same company**. That check lives in the
service:

```js
// product.service.js
const category = await categoryRepository.findByIdAndCompany(input.categoryId, companyId);
if (!category) throw ApiError.badRequest('Category not found', [...]);
```

Because the lookup is already company scoped, "does not exist" and "belongs to another
company" produce the same error - the API never confirms that an id exists elsewhere.

Any future module that references another master record must do the same. Referencing a
row by id alone is not enough in a multi-tenant system.

### Soft delete policy

**There are no `DELETE` endpoints for master data**, by design. A category, product,
supplier or tax will soon be referenced by purchases, invoices, stock movements,
accounting entries and AI document mappings. Deleting one would either break those
references or silently rewrite history.

Instead:

- `PATCH /:id/status` with `{ "isActive": false }` deactivates a record.
- Deactivated records stay readable and are still returned by `GET /:id`.
- `?isActive=false` lists them; `?isActive=true` hides them.
- Reactivation is the same endpoint with `true`.

Later phases should exclude inactive records from *selection* lists (a deactivated product
should not be pickable on a new invoice) while keeping them visible on historical documents.

### Money and Decimal convention

This is a financial system, so the rule is absolute:

| Where | Type |
|---|---|
| Database - money | `Decimal @db.Decimal(18, 4)` |
| Database - quantity | `Decimal @db.Decimal(18, 6)` |
| Database - tax rate | `Decimal @db.Decimal(5, 2)` |
| Never | `Float`, `Double`, or a JavaScript `number` in a calculation |

**In JSON, money is always a string** - `"1500.50"`, never `1500.5`. A JSON number is an
IEEE-754 double, so serializing money as a number reintroduces exactly the imprecision the
`Decimal` column exists to prevent, and every client would have to be trusted to handle it
correctly. Strings are unambiguous in every language a mobile or web client may use.

- Input accepts a string or a number, and Zod (`moneySchema`) converts it to a **string**
  before it reaches the service. The value therefore never passes through a JS float.
- Output goes through `toMoneyString()` from `src/utils/money.js`: 2 decimals for money and
  tax rates, 3 for quantities.
- Any arithmetic uses the helpers in `src/utils/money.js` (`add`, `subtract`, `multiply`,
  `round`), which are `Decimal` based.

### Company initialization

`initializeCompanyDefaults(companyId, client)` in
`src/modules/companies/company-defaults.js` gives a company its settings row, 8 default
units and 5 default GST slabs. It is:

- called inside the `POST /api/v1/companies` transaction, so a company never exists
  without settings;
- called by the admin seed, which backfills companies created before this phase;
- idempotent (settings only when missing, `createMany` with `skipDuplicates`), so it never
  overwrites a value a user has edited.

Defaults are **per-company rows**, never global shared records - a shared row would violate
tenant isolation the moment one company renamed it.

## Inventory

Two tables, written together in one transaction:

```
InventoryBalance   the current snapshot   - one row per (company, product, warehouse)
StockMovement      the immutable ledger   - one row per stock change, append only
```

```
Product ---\
            >--- InventoryBalance (quantity, averageCost)
Warehouse -/            ^
                        | every change also writes
                        v
                  StockMovement (type, quantity, unitCost, before/after, who, when)
```

### Why Product has no stockQuantity

Stock is per warehouse: the same product can hold 100 in Main and 50 in Branch, so a
single number on `Product` cannot represent it. A mutable column also cannot answer
"why is it 115?" - and in a pharma business, that question gets asked by auditors.

### Why a balance table as well as a ledger

The ledger alone is the truth, but summing every movement on every read gets slower
with each transaction, forever. The balance is a cache of that sum, maintained inside
the same transaction as the movement, so the two can never disagree.

Reads use the balance. Audits use the ledger. Consistency is guaranteed by the
transaction, not by a background job.

### Why movements are immutable

`StockMovement` has no update or delete path - not in the repository, not in the
service, and not as an API route. Once written, a movement is history.

A mistake is corrected by recording a **new, compensating movement**, which leaves both
the error and the correction visible. Editing history would make stock provable only
by trusting whoever last edited it.

### Movement types

| Type | Direction | Effect on average cost | Used by |
|---|---|---|---|
| `OPENING_STOCK` | in | sets it (no prior stock) | opening stock endpoint |
| `ADJUSTMENT_IN` | in | recalculates it | stock adjustment endpoint |
| `ADJUSTMENT_OUT` | out | unchanged | stock adjustment endpoint |
| `STOCK_IN` | in | recalculates it | reserved for purchases |
| `STOCK_OUT` | out | unchanged | reserved for sales |

`STOCK_IN` and `STOCK_OUT` exist in the enum but no endpoint produces them yet. Future
purchase and sale services will call the same internal `applyMovement()` path rather
than writing balances themselves - that is what keeps the invariant intact.

### Moving weighted average

The only costing method in this system. No FIFO, no LIFO, no cost layers.

```
newAverageCost = (oldQty * oldAvgCost + inQty * inUnitCost) / (oldQty + inQty)
```

Worked example:

```
Opening:    100 @ 10.00                       -> qty 100, avg 10.0000
Adjust in:   50 @ 14.00
            (100*10 + 50*14) / 150 = 1700/150 -> qty 150, avg 11.3333
Adjust out:  50 (valued at 11.3333 = 566.67)  -> qty 100, avg 11.3333  (unchanged)
```

**Stock going out never changes the average cost of what remains.** It is valued at the
current average, and that value is frozen onto the movement as `unitCost`/`totalCost`.
The client cannot supply a cost on an outgoing adjustment - the request is rejected if
it tries, because the cost is a fact of the ledger, not a choice.

### Precision and rounding

| Value | Database | JSON | Notes |
|---|---|---|---|
| `quantity` | `Decimal(18,6)` | 3 dp, string | e.g. `"150.000"` |
| `unitCost`, `averageCost` | `Decimal(18,4)` | 4 dp, string | e.g. `"11.3333"` |
| `totalCost`, `inventoryValue` | `Decimal(18,4)` | 2 dp, string | e.g. `"1700.00"` |

Rules:

- Every calculation uses `src/utils/money.js` (`add`, `subtract`, `multiply`, `divide`,
  `round`), which is `Decimal` based. **`Number()`, `parseFloat()` and `toFixed()` are
  never used on a quantity or a cost.**
- Division keeps full precision; **rounding happens once**, at the boundary where a
  value is stored or serialized. There is no rounding in the middle of a formula.
- Comparisons use `isGreaterThan`/`isLessThan`, not JavaScript operators on numbers.

A known consequence: storing an average at 4 decimal places means `quantity * averageCost`
may differ from the total actually paid by a fraction of a currency unit
(150 x 11.3333 = 1699.995, shown as `1700.00`). This residue is inherent to weighted
average costing at finite precision. It is not an error, and it must not be "fixed" by
adjusting stock - when accounting arrives, any such difference belongs in a rounding
account, not in the inventory quantity.

### Transaction and concurrency strategy

Every stock change runs inside `withRetryableTransaction()` and does exactly this:

```
BEGIN
  SELECT id FROM inventory_balances
   WHERE companyId/productId/warehouseId  FOR UPDATE     -- lock the row
  read quantity + averageCost
  validate (enough stock?)
  compute new quantity + new average cost
  INSERT or UPDATE inventory_balances
  INSERT stock_movements
COMMIT
```

- **`SELECT ... FOR UPDATE`** makes concurrent changes to the same product+warehouse
  queue up instead of both reading the same starting quantity. Without it, two
  simultaneous `+10` on a stock of 100 could both write 110, losing one.
- **When no balance row exists yet** there is nothing to lock. Two requests can then both
  try to insert the first row; the `(companyId, productId, warehouseId)` unique
  constraint lets exactly one win, and the loser's `P2002` is caught by
  `withRetryableTransaction`, which re-runs the whole calculation against the row that
  now exists. Retries are capped at 3.
- **Business errors are never retried.** `INSUFFICIENT_STOCK` throws out of the
  transaction, which rolls back - so a rejected request leaves neither a balance change
  nor a movement.
- PostgreSQL is the only synchronization point. No Redis, no application-level locks,
  no distributed locks.

Verified by three integration tests: 10 concurrent adjustments produce exactly 10
movements and the correct total; 5 concurrent first-inserts create exactly one balance
row; and 5 concurrent outgoing adjustments of 4 against a stock of 10 result in exactly
2 successes, 3 rejections, and never negative stock.

### Business rules

- **No negative stock.** Removing more than is available is rejected with
  `INSUFFICIENT_STOCK` (422) and changes nothing.
- **Opening stock is once per product+warehouse.** A second attempt is rejected with
  `OPENING_STOCK_ALREADY_EXISTS` (409) rather than silently overwriting real stock.
  Adding stock afterwards is a stock adjustment, which is recorded as such.
- **Zero stock keeps its row and its average cost.** The balance is not deleted, so the
  product+warehouse identity and the cost history survive for audit and for the next
  time stock arrives.
- **Master data must be active.** A stock movement against an inactive product or
  warehouse is rejected (`PRODUCT_INACTIVE` / `WAREHOUSE_INACTIVE`, 422). This closes the
  Phase 2 gap where inactive records were still selectable. **Reads are deliberately not
  restricted** - deactivating a product must never hide the stock it still holds.
- **`createdById` always comes from the authenticated user**, never from the body.
- A product+warehouse with no movements has no balance row. Reading it returns a zero
  balance rather than 404, because "no stock" is a valid answer, not a missing record.

### Reference fields (future integration point)

`referenceType` and `referenceId` record what caused a movement. Today they hold
`OPENING_STOCK` or `STOCK_ADJUSTMENT`. Later they will hold `PURCHASE`, `SALE`,
`PURCHASE_RETURN`, `SALE_RETURN` with the id of that document.

`referenceId` is intentionally **not** a foreign key: the tables it will point at do not
exist yet, and one movement table serves every document type. The cost of that choice is
that referential integrity for these two columns is the application's responsibility.

## Purchases

A purchase is a supplier's bill. It has two lives:

```
POST /purchases            -> DRAFT     no inventory effect, freely editable
PATCH /purchases/:id       -> DRAFT     replaces the document, recalculates totals
POST /purchases/:id/post   -> POSTED    stock arrives, document becomes permanent
POST /purchases/:id/cancel -> CANCELLED draft abandoned
```

```
        create            post
 ( - ) ------> DRAFT -------------> POSTED   (terminal: never edited, never cancelled)
                 |
                 | cancel
                 v
             CANCELLED                       (terminal)
```

`POSTED -> DRAFT` does not exist. `POSTED -> CANCELLED` is rejected in this phase.

### Why a draft does not touch inventory

Stock should change when goods are *accepted*, not when a bill is *typed*. Keeping the
two apart buys three things:

1. A half-entered bill never corrupts stock.
2. A bill can be corrected freely until someone commits to it.
3. **The AI bill reader can safely produce drafts.** The planned flow is
   `bill image -> OCR/AI -> DRAFT -> human verification -> POST -> inventory`. The AI
   gets no special path: it creates a draft through the same API and a person posts it.
   Nothing reaches stock without a human decision.

### Why a posted purchase is immutable

Once posted, the bill has moved stock and set an average cost that later sales will be
costed against. Editing it would silently rewrite the arithmetic behind movements that
already happened. Corrections belong in a Purchase Return (see below), which reverses stock with its own
visible movement.

The API enforces this: `PATCH` and `cancel` on a posted purchase return 409.

### Why inventory logic is reused, not copied

The purchase service does **not** calculate moving weighted average. It calls:

```js
inventoryService.applyStockInWithinTransaction(tx, {
  currentUser, productId, warehouseId,
  quantity: item.quantity,
  unitCost: item.unitCost,       // the price on the bill
  referenceType: 'PURCHASE', referenceId: purchase.id,
});
```

That is the same function the inventory module's own endpoints use - it was split out of
`applyMovement` so a caller can pass its own transaction. One copy of the averaging rule
means a purchase and a manual adjustment can never disagree, and a fix applies everywhere.

`Product.purchasePrice` is a **master default** for filling in forms.
`PurchaseItem.unitCost` is the **transaction value** and the only thing inventory costs
against. A product listed at 100 that was bought at 92 enters stock at 92.

### The posting transaction

One transaction. Everything below commits together or not at all:

```
BEGIN
  SELECT ... FROM purchases WHERE id, companyId FOR UPDATE   -- lock the document
  status must be DRAFT                       -> else PURCHASE_ALREADY_POSTED / NOT_DRAFT
  items must not be empty                    -> else PURCHASE_HAS_NO_ITEMS
  re-validate supplier, warehouse, every product and tax (still present, still active)
  for each item:
      applyStockInWithinTransaction(tx, ...)  -- balance + StockMovement, averaged
  UPDATE purchases SET status = POSTED, postedById, postedAt WHERE status = DRAFT
COMMIT
```

Master data is re-validated **at posting**, not only at draft creation, because a
product can be deactivated in between. A draft referencing a deactivated product fails
to post and stays a draft.

The whole thing runs in `withRetryableTransaction`, so a first-insert race on an
inventory balance is retried rather than surfaced to the user.

**Rollback is proven, not assumed:** a test posts a two-item purchase whose *second*
item is invalid and asserts that no movement, no balance and no status change survives -
not even for the valid first item.

### Double-post protection

`SELECT ... FOR UPDATE` on the purchase row is what makes posting idempotent-ish: a
second concurrent request blocks until the first commits, then reads `POSTED` and gets
409 `PURCHASE_ALREADY_POSTED`. The final `UPDATE ... WHERE status = 'DRAFT'` is a second
guard - if it matches zero rows, the transaction throws rather than reporting success.

Verified by a test that fires five simultaneous posts: exactly one 200, four 409s, and
exactly one stock movement.

### Calculation and rounding

Per line, then summed:

```
gross          = quantity * unitCost
discountAmount = NONE -> 0 | PERCENTAGE -> gross * value/100 | FIXED -> value
taxableAmount  = gross - discountAmount
taxAmount      = taxableAmount * taxRate / 100          (tax is on the discounted amount)
lineTotal      = taxableAmount + taxAmount

subtotal      = sum(gross)          discountTotal = sum(discountAmount)
taxTotal      = sum(taxAmount)      grandTotal    = sum(lineTotal)
```

Rules, all in `purchase.calculator.js` (a pure module, unit tested without a database):

- Intermediates keep full Decimal precision. Each stored value is rounded **once**, to
  4 dp, when produced.
- Totals sum the **already-rounded** line values, so the printed lines always add up to
  the printed total. Summing unrounded values and rounding at the end would produce a
  grand total that does not match the visible lines - a support ticket generator.
- A FIXED discount applies to the **whole line**, not per unit, and may not exceed the
  line amount. A PERCENTAGE discount may not exceed 100.
- **Client-sent totals are ignored.** The server recalculates from quantity, cost,
  discount and tax on every create and every update. A client may send `grandTotal: 1`;
  it changes nothing.

Tax is the simple Phase 2 model (one rate per line). CGST/SGST/IGST splitting, place of
supply, reverse charge and HSN rules are later work; the calculator takes a rate, so
adding components later means changing one module.

### Snapshots

A bill is a historical document, so each line stores what things were called at the
time: `productNameSnapshot`, `skuSnapshot`, `unitNameSnapshot`, `taxNameSnapshot`,
`taxRateSnapshot`, plus `supplierNameSnapshot` on the header. Renaming a product does
not rewrite last month's bills. Live ids are still stored, so reports can group by
product; the response returns the snapshot as `name` and the live value as `currentName`.

Only these fields are copied - not whole master records.

### Document numbers

Two different things, deliberately separate:

| Field | Whose | Example | Uniqueness |
|---|---|---|---|
| `purchaseNumber` | ours | `PUR-2026-000001` | `(companyId, purchaseNumber)` |
| `invoiceNumber` | the supplier's | `SUP-INV-1001` | `(companyId, supplierId, invoiceNumber)` |

The supplier's number is unique **per supplier**, not per company: two different
suppliers may both issue "INV-001". Re-entering the same bill for the same supplier is
rejected with `DUPLICATE_INVOICE_NUMBER`, which is the duplicate-bill protection the AI
phase will rely on.

`purchaseNumber` is allocated by `document-numbers/`, which locks a per
`(company, type, year)` counter row `FOR UPDATE`. **Never `COUNT(*) + 1`** - concurrent
requests would read the same count and collide. A test fires six simultaneous drafts and
asserts six distinct numbers.

Numbers are allocated at **draft creation**, so a cancelled draft leaves a gap. That is
acceptable for a purchase, which is an internal record. A gapless series matters for
outgoing tax invoices, and sales should revisit it.

### Supplier payable (foundation only)

Posting a purchase now raises a `SupplierPayable` and a supplier ledger entry inside the
same transaction - see "Supplier payables, ledger and payments" below.

`Supplier.openingBalance` is deliberately **not** touched by posting. It is master data
describing the balance carried in when the business started using the system; turning it
into a running total would destroy that meaning and make the number unauditable.

## Purchase returns

Goods sent back to a supplier. A return is an **independent document that references a
posted purchase** and never modifies it.

```
POST /purchase-returns             -> DRAFT      no stock effect
PATCH /purchase-returns/:id        -> DRAFT      replaces the document
POST /purchase-returns/:id/post    -> POSTED     stock leaves; document permanent
POST /purchase-returns/:id/cancel  -> CANCELLED  drafts only
```

```
        create             post
 ( - ) -------> DRAFT --------------> POSTED    (terminal)
                  |
                  | cancel
                  v
              CANCELLED               (terminal)
```

`POSTED -> DRAFT` does not exist, and a posted return cannot be cancelled: undoing it
would mean putting stock back that may already have been consumed.

### What the server derives, and what the client may send

The client sends only **which purchase, which lines, how much, and why**:

| Client sends | Server derives |
|---|---|
| `purchaseId`, `returnDate`, `reason`, `notes` | `companyId` (from the token) |
| `items[].purchaseItemId`, `items[].quantity` | `warehouseId` (from the purchase) |
| | `productId`, `unitCost` (from the original purchase line) |
| | `lineTotal`, `grandTotal`, `returnNumber`, `createdById` |

A client-supplied `unitCost`, `warehouseId`, `companyId` or total is stripped by Zod and
has no effect. Tests assert this rather than assuming it.

### Costing: the one deliberate exception to stock-out valuation

Everywhere else, stock leaving is valued at the **current moving average**. A purchase
return is valued at the **cost recorded on the original purchase line**, because the
supplier credits what they charged, not what the average has drifted to since.

Rather than write a second costing algorithm, `applyMovementWithinTransaction` gained one
explicit parameter, `outUnitCostOverride`, used only by
`applyStockOutWithinTransaction` for returns:

```js
inventoryService.applyStockOutWithinTransaction(tx, {
  productId, warehouseId, quantity,
  outUnitCostOverride: item.unitCost,   // the original purchase cost
  referenceType: 'PURCHASE_RETURN', referenceId: purchaseReturn.id,
});
```

**The average cost of the remaining stock is unchanged**, exactly as for any other
stock-out. Worked example:

```
Purchase 1:   100 @ 80          -> qty 100, avg 80.0000
Purchase 2:   100 @ 120         -> qty 200, avg 100.0000
Return 10 against purchase 1    -> movement unitCost 80.0000 (NOT 100)
                                -> qty 190, avg 100.0000 (unchanged)
```

**Known consequence, deliberately accepted:** removing 10 units valued at 80 while the
balance is valued at 100 leaves a 200 valuation residue that nothing currently records.
Under full accounting this is a purchase price variance and belongs in a variance
account. Until the accounting phase exists, the residue is simply not posted anywhere -
inventory quantity and average remain correct, but `quantity x averageCost` is not a
perfect reconstruction of cash spent. This is documented rather than hidden, and it is
the main reason returns should be revisited when the ledger is built.

### How much is still returnable

```
remainingReturnable(purchaseItem) = purchaseItem.quantity - sum(POSTED return quantities)
```

**Only POSTED returns count.** A draft reserves nothing, so two drafts may each ask for
the last 20 units; whichever is posted first wins and the other fails at posting. The
alternative - reserving on draft - would let a forgotten draft block a legitimate return
indefinitely.

`GET /purchase-returns/returnable/:purchaseId` exposes purchased / returned / remaining
per line, computed from persisted data, so a UI never has to do this arithmetic.

Every quantity check runs **twice**: at draft time for immediate feedback, and again
inside the posting transaction, which is the authoritative one.

### The posting transaction

```
BEGIN
  SELECT ... FROM purchase_returns WHERE id, companyId FOR UPDATE   -- lock the return
  status must be DRAFT              -> else PURCHASE_RETURN_ALREADY_POSTED / NOT_POSTABLE
  SELECT ... FROM purchases ... FOR UPDATE                          -- lock the parent
  re-read unit costs from the purchase; re-check remaining returnable quantities
  for each line:
      lock the inventory balance row
      quantity must be <= available -> else PURCHASE_RETURN_INSUFFICIENT_STOCK
      applyStockOutWithinTransaction(...)    -- movement + balance, at the original cost
  UPDATE purchase_returns SET status = POSTED, postedById, postedAt WHERE status = DRAFT
COMMIT
```

Three locks, always taken in the same order — **return, then purchase, then balances in
line order** — which is the same order purchase posting uses, so the two document types
cannot deadlock against each other.

Locking the **parent purchase** is what makes competing returns safe: two different
returns against the same purchase serialise there, so they cannot both pass the
"20 units remain" check. Locking the **balance** before checking availability means the
stock check and the deduction cannot be separated by another transaction, and lets the
failure carry `PURCHASE_RETURN_INSUFFICIENT_STOCK` rather than the generic inventory code.

Verified by tests: five simultaneous posts of one return produce one success and four
409s with exactly one movement; two different returns competing for the last 20 units
produce one success and one `PURCHASE_RETURN_EXCEEDS_PURCHASE_QTY`, with total returned
never exceeding 100 and stock never negative.

### Rollback

If any line fails, nothing survives - not even the lines that had already succeeded.
Tested with a two-line return whose *second* product has no stock: the first line's
balance is unchanged, no movement exists, and the return is still `DRAFT`.

### Immutability of the original purchase

The return process only ever *reads* the purchase. Quantities, unit costs and totals on
the purchase and its lines are never written. A test captures the purchase before and
after posting a return and asserts they are identical.

### Business error codes

| Code | Status |
|---|---|
| `PURCHASE_RETURN_NOT_FOUND` | 404 |
| `PURCHASE_NOT_FOUND` / `PURCHASE_ITEM_NOT_FOUND` | 404 |
| `PURCHASE_NOT_POSTED` | 422 |
| `PURCHASE_RETURN_EXCEEDS_PURCHASE_QTY` | 422 |
| `PURCHASE_RETURN_INSUFFICIENT_STOCK` | 422 |
| `PURCHASE_RETURN_HAS_NO_ITEMS` | 422 |
| `PURCHASE_RETURN_PURCHASE_IMMUTABLE` | 422 |
| `PURCHASE_RETURN_ALREADY_POSTED` | 409 |
| `PURCHASE_RETURN_NOT_POSTABLE` | 409 |

Another company's purchase, purchase line or return is always reported exactly as
"not found", so ids cannot be probed across tenants.

### Numbering

`PR-2026-000001`, from the same `document-numbers` module and the same locked-counter
strategy as purchases, under document type `PURCHASE_RETURN`. Counters are per company,
so two companies both start at `000001`.

### Scope note

A return in this phase is a **pure cost reversal**: `quantity x original unitCost`, with
no tax or discount reversal, so `grandTotal` is the sum of the line totals. Reversing
input tax credit is a GST/accounting concern and is deliberately absent.

## Supplier payables, ledger and payments

> **This is an operational supplier sub-ledger, not a full double-entry accounting
> system.** It answers "what do we owe each supplier, and against which bills". There is
> no general ledger, no chart of accounts, no journal entries, no trial balance and no
> GST accounting. Those are a later phase.

### Sign convention

From the supplier account's side, the standard accounting direction:

| | Meaning | Raised by |
|---|---|---|
| **CREDIT** | increases what we owe | posting a purchase |
| **DEBIT** | reduces what we owe | posting a payment, or posting a purchase return |

`balance = sum(credit) - sum(debit)`. **Positive means we owe the supplier**; negative
means we are in credit with them (an advance we have paid).

This is the Tally/Ind-AS direction — a supplier account is credited when you buy and
debited when you pay. Note it is the *opposite* of the illustrative example in the phase
brief; the standard direction was chosen so the real double-entry phase inherits it
unchanged instead of having to unlearn it. Flipping it later would be a serializer change
plus two constants, but every historical row would need re-reading.

### Two structures, one source of truth per question

The same split as inventory (`StockMovement` / `InventoryBalance`):

```
SupplierLedgerEntry   immutable, append-only   -> the supplier's BALANCE
SupplierPayable       one per posted purchase  -> what is left on THAT bill
```

- **"What is this supplier's balance?"** is derived from the ledger, always.
- **"How much can still be allocated to this bill?"** is `SupplierPayable.outstandingAmount`,
  maintained inside the same transaction that changes it.

They answer *different* questions, so they cannot contradict each other. Where they
appear to differ - `billOutstanding` vs `outstandingAmount` on the outstanding summary -
the difference is exactly the unallocated advances, which the response reports as
`unallocatedCredit`.

`Supplier.openingBalance` remains untouched master data. It is never used as a running
total.

### What creates entries

| Event | Payable | Ledger entry |
|---|---|---|
| Purchase posted | created, `outstanding = grandTotal`, status `OPEN` | CREDIT `grandTotal` |
| Purchase return posted | `creditAmount` increases on the *original* purchase's payable | DEBIT `grandTotal` |
| Payment posted | `paidAmount` increases on each allocated payable | DEBIT the **full** payment amount |

A purchase return never creates a payable - it reduces the one the purchase raised. A
payment's ledger entry is for the full amount including any unallocated remainder,
because that money really did leave.

Nothing is created while a document is a draft, and nothing for a cancelled document.

### Payable state machine

```
                       part paid / part credited
        OPEN ─────────────────────────────────────► PARTIALLY_PAID
          │                                                │
          │ fully paid                                     │ fully paid
          └──────────────► PAID ◄──────────────────────────┘
          │
          │ fully settled by returns (no money)
          └──────────────► CREDITED
```

`outstandingAmount = originalAmount - creditAmount - paidAmount`, **clamped at zero**. If
returns and payments together exceed the bill, the surplus does not become a negative
number on that bill - it shows up in the supplier's balance as credit. Status is derived,
never set by hand: nothing settled → `OPEN`; something left → `PARTIALLY_PAID`; nothing
left and money was paid → `PAID`; nothing left and only returns settled it → `CREDITED`.

### Payment lifecycle and allocation

```
POST /supplier-payments             -> DRAFT      nothing settled
PATCH /supplier-payments/:id        -> DRAFT      replaces the document
POST /supplier-payments/:id/post    -> POSTED     balances move; document permanent
POST /supplier-payments/:id/cancel  -> CANCELLED  drafts only
```

A payment carries zero or more **allocations**, each naming a payable and an amount:

- `sum(allocations) <= payment.amount` - money is never invented.
- Each allocation `<= payable.outstandingAmount` - a bill is never overpaid.
- The remainder, `amount - allocated`, is an **advance** held with that supplier. It is
  recorded on the payment as `unallocatedAmount` and appears in the balance.

A payment with **no** allocations is therefore a pure advance, which is why a payment is
not forced to reference a purchase.

### Transaction boundary

Every balance change happens inside one transaction, using the same
`withRetryableTransaction` helper as inventory and purchases.

**Purchase posting** (extended, not rewritten): lock purchase → validate → stock in →
**raise the payable and its ledger entry** → set POSTED. One transaction; if the payable
fails, the stock and the status roll back with it.

**Purchase return posting** (extended): lock return → lock purchase → stock out →
**credit the payable and write its ledger entry** → set POSTED.

**Payment posting**:

```
BEGIN
  SELECT ... FROM supplier_payments ... FOR UPDATE     -- lock the payment
  status must be DRAFT     -> else SUPPLIER_PAYMENT_ALREADY_POSTED / NOT_POSTABLE
  for each allocation, ordered by payableId:
      SELECT ... FROM supplier_payables ... FOR UPDATE -- lock the bill
      bill must belong to this supplier
      amount <= outstandingAmount  -> else PAYMENT_EXCEEDS_OUTSTANDING
      recompute paidAmount, outstandingAmount, status
  INSERT one ledger entry for the full payment amount
  UPDATE supplier_payments SET status = POSTED, allocated/unallocated
COMMIT
```

### Concurrency

- **Row locks, no application locks and no Redis.** The payment row serialises repeat
  posts of the same payment; the payable rows serialise different payments competing for
  the same bill.
- **Payables are locked in id order**, so two payments touching an overlapping set of
  bills can never deadlock.
- **The allocation check is re-run under the lock.** A draft prepared when 100,000 was
  outstanding fails to post with `PAYMENT_EXCEEDS_OUTSTANDING` if only 10,000 is left by
  then - it does not silently pay less.
- **Double-posting cannot double-count a balance even if a guard were bypassed**: the
  ledger has a unique constraint on `(companyId, referenceType, referenceId)`, so one
  source document can only ever produce one entry. `SupplierPayable.purchaseId` is unique
  for the same reason.

Verified by tests: five simultaneous posts of one payment → one success, four 409s, one
ledger entry. Five *different* payments each allocating the same last 10,000 → one
success, four `PAYMENT_EXCEEDS_OUTSTANDING`, outstanding exactly 0 and never negative.

### Rollback

If any allocation fails, nothing survives - not even the allocations that had already
applied. Tested with a two-allocation payment whose second allocation exceeds its bill:
the first bill is unchanged, no ledger entry exists, and the payment is still `DRAFT`.

### Tenant isolation

Every query is company scoped and `companyId` always comes from the token. Another
company's payable, payment or supplier is reported exactly as "not found", so ids cannot
be probed. A payment can only allocate against payables of its own company *and* its own
supplier.

### Immutability and audit

Posted payments cannot be edited or cancelled. Ledger entries are never updated or
deleted. Every entry records who created it, the source document type and id, the
business date, the amount, the supplier and the company.

### Decimal handling

All amounts are `Decimal(18,4)` in the database and **strings with 2 decimals** in JSON,
following the existing convention. Arithmetic uses `src/utils/money.js`; there is no
`Number()`, `parseFloat()` or `toFixed()` anywhere in the money path.

### Known limitation: allocating an existing advance

An advance can be *created* (a payment with an unallocated remainder) and it is visible in
the balance and in `unallocatedCredit`. What does **not** exist yet is applying an existing
advance to a *later* bill - that needs an allocation endpoint that operates on a posted
payment, which would be the first thing to touch a posted financial document. It was left
out deliberately rather than built fragile. Until then, the workaround is to allocate at
payment time.

## Sales and customer receivables

The mirror image of purchases and supplier payables, using the same patterns
throughout: draft to posted, one transaction, immutable ledger plus per-document
balance, row locks in a deterministic order.

```
POST /sales             -> DRAFT      no stock, no receivable, no ledger entry
PATCH /sales/:id        -> DRAFT      replaces the document, totals recalculated
POST /sales/:id/post    -> POSTED     stock out, COGS frozen, receivable raised
POST /sales/:id/cancel  -> CANCELLED  drafts only
```

```
        create            post
 ( - ) ------> DRAFT -------------> POSTED   (terminal)
                 |
                 | cancel
                 v
             CANCELLED               (terminal)
```

A POSTED invoice can never be edited or cancelled: the stock has gone, the
customer owes money and the COGS is recorded. Reversing that is a sales return
(see below), which credits the customer with its own auditable document.

### COGS: the one genuinely new idea in this phase

**Selling price is not cost.** `unitPrice` is what the customer pays;
`cogsUnitCost` is what the goods actually cost us.

At posting, each line calls the existing inventory service for a `STOCK_OUT`
with **no cost override**, so stock leaves at the current moving weighted
average - exactly what COGS should be. The resulting movement is read back and
its `unitCost` is **frozen onto the sales line**:

```js
const movement = await inventoryService.applyStockOutWithinTransaction(tx, {...});
const cogs = calculateCogs(item.quantity, movement.unitCost);   // frozen
await salesRepository.setItemCogs(tx, item.id, cogs);
```

Worked example:

```
Stock:       100 @ 80 average
Sell:        10 @ 120
  revenue    10 * 120 = 1200
  COGS       10 *  80 =  800   <- frozen on the line
  margin                 400
Later:       buy 100 @ 200, average rises to 140
  the posted invoice still reports COGS 800. It does not move.
```

That last line is the whole point, and it is tested: a later dearer purchase
changes the average but not a single historical invoice. `grossMargin` is derived
on read (`subtotal - discount - cogsTotal`), never stored, so it can never drift
from its inputs.

Costing logic is **not duplicated**: sales calls the same
`applyStockOutWithinTransaction` that purchase returns use, and the same
`calculateLine` arithmetic that purchases use (see `sales.calculator.js`, which
explains why it imports rather than copies).

### Customer ledger sign convention

From the customer account's side, standard accounting - and the **opposite** of
the supplier ledger, correctly so, because a customer is a debtor and a supplier
is a creditor:

| | Meaning | Raised by |
|---|---|---|
| **DEBIT** | increases what they owe us | posting a sales invoice |
| **CREDIT** | reduces it | posting a customer payment (later: a sales return) |

`balance = sum(debit) - sum(credit)`. **Positive means the customer owes us**;
negative means we hold their money as credit.

### Two structures, one source of truth per question

Identical to the supplier side:

```
CustomerLedgerEntry   immutable, append-only    -> the customer's BALANCE
CustomerReceivable    one per posted invoice    -> what is left on THAT invoice
```

- "What is this customer's balance?" -> derived from the ledger.
- "How much can still be allocated to this invoice?" -> `outstandingAmount`,
  maintained in the same transaction that changes it.

They answer different questions, so they cannot contradict. The gap between
`invoiceOutstanding` and `outstandingAmount` is exactly the unallocated
advances, reported as `unallocatedCredit`.

`Customer.openingBalance` remains untouched master data.

### The sales posting transaction

```
BEGIN
  SELECT ... FROM sales_invoices ... FOR UPDATE          -- lock the invoice
  status must be DRAFT        -> else SALE_ALREADY_POSTED / SALE_NOT_DRAFT
  items must not be empty     -> else SALE_HAS_NO_ITEMS
  re-validate customer, warehouse, every product and tax (exist, active)
  for each line:
      lock the inventory balance row
      quantity <= available   -> else SALE_INSUFFICIENT_STOCK
      applyStockOutWithinTransaction(...)      -- movement + balance at average
      freeze cogsUnitCost / cogsAmount onto the line
  create CustomerReceivable + SALE ledger entry
  UPDATE sales_invoices SET status = POSTED, postedBy, postedAt, cogsTotal
COMMIT
```

Lock order is **invoice -> inventory balances (line order) -> receivable**, the
same outward order purchases use, so the two document types cannot deadlock
against each other.

**Negative stock is impossible**: the balance is locked *before* it is checked,
so the check and the deduction cannot be separated by another transaction. A
test fires five invoices of 30 against a stock of 100 - exactly three succeed,
two are rejected, and the balance lands on 10, never below zero.

### The payment posting transaction

```
BEGIN
  SELECT ... FROM customer_payments ... FOR UPDATE       -- lock the payment
  status must be DRAFT
  for each allocation, ordered by receivableId:          -- deterministic order
      SELECT ... FROM customer_receivables ... FOR UPDATE
      invoice must belong to this customer and be POSTED
      amount <= outstandingAmount  -> else PAYMENT_EXCEEDS_OUTSTANDING
      recompute paidAmount, outstandingAmount, status
  INSERT one ledger entry for the FULL payment amount
  UPDATE customer_payments SET status = POSTED, allocated/unallocated
COMMIT
```

### Payment allocation

- `sum(allocations) <= payment.amount` - money is never invented.
- Each allocation `<= receivable.outstandingAmount` - an invoice is never overpaid.
- The invoice must belong to the same customer **and** company, and be POSTED.
- The remainder is customer credit (an advance); a payment with no allocations is
  a pure advance.
- `outstandingAmount` is clamped at zero and status is derived
  (`OPEN` -> `PARTIALLY_PAID` -> `PAID`), never set by a client.

The allocation check is re-run **under the lock**, so a draft prepared when
50,000 was outstanding fails to post if only 5,000 is left by then rather than
silently paying less.

### Double-posting is structurally impossible

Two database-level guarantees, matching the supplier side:

- `CustomerReceivable.salesInvoiceId` is unique - one invoice, one receivable.
- `CustomerLedgerEntry` is unique on `(companyId, referenceType, referenceId)` -
  one source document, one entry.

So even if a status guard were bypassed, a balance cannot be double-counted.
Tested: five simultaneous posts of one invoice produce one success, one stock
movement, one receivable and one ledger entry.

### Business error codes

| Code | Status |
|---|---|
| `SALE_NOT_FOUND` | 404 |
| `SALE_NOT_DRAFT` / `SALE_ALREADY_POSTED` | 409 |
| `SALE_HAS_NO_ITEMS` | 422 |
| `SALE_INSUFFICIENT_STOCK` | 422 |
| `CUSTOMER_NOT_FOUND` / `CUSTOMER_INACTIVE` | 404 / 422 |
| `WAREHOUSE_NOT_FOUND` / `WAREHOUSE_INACTIVE` | 404 / 422 |
| `PRODUCT_NOT_FOUND` / `PRODUCT_INACTIVE` | 404 / 422 |
| `TAX_NOT_FOUND` / `TAX_INACTIVE` | 404 / 422 |
| `INVALID_DISCOUNT` | 422 |
| `CUSTOMER_RECEIVABLE_NOT_FOUND` | 404 |
| `CUSTOMER_PAYMENT_NOT_FOUND` | 404 |
| `CUSTOMER_PAYMENT_ALREADY_POSTED` / `_NOT_POSTABLE` | 409 |
| `CUSTOMER_PAYMENT_CUSTOMER_IMMUTABLE` | 422 |
| `PAYMENT_EXCEEDS_OUTSTANDING` | 422 |
| `PAYMENT_ALLOCATION_EXCEEDS_RECEIVABLE` | 422 |
| `INVALID_PAYMENT_ALLOCATION` | 422 |

Another company's record is always reported as "not found".

### Decimal and rounding

Unchanged from purchases: money `Decimal(18,4)`, quantities `Decimal(18,6)`,
serialized as strings (money 2 dp, prices/costs 4 dp, quantities 3 dp). Every
calculation goes through `src/utils/money.js`; intermediates keep full precision
and each stored value is rounded once. Invoice totals sum the already-rounded
lines, so a printed invoice always adds up.

### Tenant isolation and RBAC

`companyId` always comes from the token. Every query is company scoped, and a
cross-company customer, product, warehouse, invoice or receivable is reported as
"not found".

| | Read | Create / edit draft | Post / cancel |
|---|---|---|---|
| Sales invoices | ADMIN, STAFF | ADMIN, STAFF | ADMIN |
| Customer payments | ADMIN, STAFF | ADMIN | ADMIN |
| Receivables and ledger | ADMIN, STAFF | (written only as a side effect) | - |

Sales drafts are open to STAFF because a counter clerk raises invoices; money
movement is ADMIN, matching the RBAC already used for supplier payments.

### Numbering

`INV-2026-000001` for invoices, `RCP-2026-000001` for receipts, both from the
existing `document-numbers` module and its locked-counter strategy, under new
`SALES_INVOICE` and `CUSTOMER_PAYMENT` document types. Counters are per company,
so two companies both start at `000001`.

### Known limitation: allocating an existing advance

As on the supplier side, an advance can be created and is visible in the balance
and in `unallocatedCredit`, but applying an existing advance to a *later* invoice
is not implemented - that needs an endpoint that mutates a posted payment.
Allocate at payment time until then.

## Sales returns / credit notes

Goods coming back from a customer. The mirror of purchase returns, and an
independent document that **references a posted sales invoice and never modifies
it**.

```
POST /sales-returns             -> DRAFT      no stock, no credit
PATCH /sales-returns/:id        -> DRAFT      replaces the document
POST /sales-returns/:id/post    -> POSTED     stock back in, receivable credited
POST /sales-returns/:id/cancel  -> CANCELLED  drafts only
```

```
        create            post
 ( - ) ------> DRAFT -------------> POSTED   (terminal)
                 |
                 | cancel
                 v
             CANCELLED               (terminal)
```

### Stock returns at the FROZEN cost, not today's average

This is the whole point of having frozen `SalesInvoiceItem.cogsUnitCost` since
Phase 7. Posting a return calls the existing inventory service for a `STOCK_IN`
with that exact cost:

```js
await inventoryService.applyStockInWithinTransaction(tx, {
  productId, warehouseId, quantity: row.quantity,
  unitCost: row.cogsUnitCost,          // frozen on the original sale
  referenceType: 'SALES_RETURN', referenceId: salesReturn.id,
});
```

Because the goods re-enter at the cost the sale removed them at, the valuation is
restored exactly:

```
Stock 100 @ 80.  Sell 10 (COGS 80)  -> 90 @ 80.
Return 4 @ 80                        -> 94 @ 80.   average unchanged
```

And when the average has moved on since the sale, the return still uses 80:

```
90 @ 80, then buy 90 @ 200  -> 180 @ 140
Return 4 at the frozen 80    -> 184, average blends the returned lot at ITS cost
```

That is correct weighted-average behaviour: each lot enters at what it actually
cost. No second costing algorithm exists - this is the same
`applyStockInWithinTransaction` a purchase uses.

### The credit is rebuilt from the original invoice line

The client sends only *which invoice, which lines, how much*. The credit is
recomputed server-side from the original line's price, discount and tax rate:

```
gross          = returnQty * originalUnitPrice
discountAmount = originalLineDiscount * (returnQty / soldQty)   <- prorated
taxableAmount  = gross - discountAmount
taxAmount      = taxableAmount * originalTaxRate / 100
lineTotal      = taxableAmount + taxAmount
```

The discount is **prorated by quantity** rather than re-derived from the discount
type. Proration is exact for both PERCENTAGE and FIXED discounts, and it makes
partial returns sum back to the original: returning 4 then 6 of a 10-unit line
credits exactly what the line was charged. Tested.

The original tax rate is taken from `taxRateSnapshot` on the invoice line, so a
later change to the tax master cannot alter a credit note.

### Customer receivable and ledger

Posting a return does two things, in the same transaction as the stock movement:

1. **Reduces the receivable** raised by the original invoice — it never creates a
   new one. `CustomerReceivable.creditAmount` (added in this phase, mirroring
   `SupplierPayable.creditAmount`) increases, and
   `outstandingAmount = original − credit − paid`, clamped at zero.
2. **Writes one `SALES_RETURN` ledger entry** as a **credit**, following the
   customer sign convention (debit increases what they owe, credit reduces it).

```
Invoice 1416 -> receivable OPEN 1416, ledger balance 1416
Return  566.40 -> credit 566.40, outstanding 849.60, PARTIALLY_PAID, balance 849.60
Full return    -> outstanding 0, status CREDITED, balance 0
```

`CREDITED` is the status for an invoice settled by returns rather than by money;
it existed in the enum since Phase 7 and becomes reachable now. If credits and
payments together exceed the invoice, outstanding clamps at zero and the surplus
shows in the customer *balance* as credit — it is never lost, and never a
negative number on the invoice.

### Returnable quantity

```
remainingReturnable = soldQuantity - sum(POSTED sales return quantities)
```

**Only POSTED returns count.** Drafts and cancelled returns reserve nothing, so
two drafts may each ask for the last units; whichever is posted first wins and
the other fails at posting. The alternative — reserving on draft — would let a
forgotten draft block a legitimate credit note indefinitely.

`GET /sales-returns/returnable/:salesInvoiceId` exposes sold / returned /
remaining per line, plus the price and frozen cost, so a credit-note screen never
has to do this arithmetic.

Quantities are checked **twice**: at draft time for feedback, and again inside the
posting transaction, which is authoritative.

### The posting transaction

```
BEGIN
  SELECT ... FROM sales_returns ... FOR UPDATE          -- lock the return
  status must be DRAFT       -> else SALES_RETURN_ALREADY_POSTED / NOT_POSTABLE
  SELECT ... FROM sales_invoices ... FOR UPDATE         -- lock the parent
  re-read prices, tax rates and frozen COGS from the invoice
  re-check remaining returnable quantities
  for each line:
      applyStockInWithinTransaction(...)   -- movement + balance at frozen cost
  SELECT ... FROM customer_receivables ... FOR UPDATE   -- lock the receivable
  credit the receivable + write the SALES_RETURN ledger entry
  UPDATE sales_returns SET status = POSTED, postedBy, postedAt, cogsTotal
COMMIT
```

Lock order is **return → invoice → inventory balances (line order) →
receivable**, the same outward order sales posting uses, so a return and a sale
can never deadlock against each other.

Locking the **parent invoice** is what makes competing returns safe: two returns
against the same invoice serialise there, so they cannot both pass the "6 units
remain" check.

### Immutability and no double effects

A posted return cannot be edited, cancelled or re-posted. Two database
constraints make duplicate financial effects structurally impossible, not merely
guarded in code:

- `SalesReturnItem` is unique on `(salesReturnId, salesInvoiceItemId)` — one line
  per invoice line.
- `CustomerLedgerEntry` is unique on `(companyId, referenceType, referenceId)` —
  one source document, one entry. A second post can never double-credit a
  customer even if the status guard were bypassed.

Verified: five simultaneous posts of one return produce one success, four 409s,
exactly one stock movement and exactly one ledger entry.

### Rollback

If any line fails, nothing survives — not even lines that had already succeeded.
Tested with a two-line return whose second line has nothing left to return: the
first line's stock is unchanged, no ledger entry exists, no movement exists, and
the return is still `DRAFT` with `cogsTotal` still zero.

### Business error codes

| Code | Status |
|---|---|
| `SALES_RETURN_NOT_FOUND` | 404 |
| `SALE_NOT_FOUND` / `SALE_ITEM_NOT_FOUND` | 404 |
| `SALE_NOT_POSTED` | 422 |
| `SALES_RETURN_EXCEEDS_INVOICE_QTY` | 422 |
| `SALES_RETURN_HAS_NO_ITEMS` | 422 |
| `SALES_RETURN_INVOICE_IMMUTABLE` | 422 |
| `SALES_RETURN_ALREADY_POSTED` / `SALES_RETURN_NOT_POSTABLE` | 409 |

Another company's invoice, invoice line or return is always reported as
"not found".

### Numbering and RBAC

`SR-2026-000001`, from the same `document-numbers` module and locked-counter
strategy, under document type `SALES_RETURN`. Counters are per company.

Read, create and edit drafts: `ADMIN` and `STAFF` (matching sales and purchase
returns). Post and cancel: `ADMIN`.

### Known limitations

- **A posted sales return cannot be undone.** Reversing one would take back stock
  the customer no longer has; a mistake needs a manual stock adjustment.
- **No stock condition check on return.** Goods are accepted back unconditionally
  — there is no damaged/saleable distinction or quarantine location.
- **The credit is not a payable.** If a customer had already paid, the return
  produces customer credit visible in the balance, but there is no refund
  document to pay it back.
- **No tax-authority credit note numbering or GST reporting** — that belongs to
  the accounting/GST phase.

## General ledger and chart of accounts

Everything above this section is an **operational sub-ledger**: what one supplier
is owed, what is left on one invoice, what is in one warehouse. This section is
the **double-entry general ledger** those sub-ledgers roll up into.

The sub-ledgers answer *"who owes what"*. The general ledger answers *"is the
business profitable, and what does it own"*. Both are needed; neither replaces
the other.

### The sign convention

One convention, applied everywhere, with no exceptions:

| Account type | Debit | Credit | Balance is |
|---|---|---|---|
| `ASSET` | increases | decreases | `debit − credit` |
| `EXPENSE` | increases | decreases | `debit − credit` |
| `LIABILITY` | decreases | increases | `credit − debit` |
| `EQUITY` | decreases | increases | `credit − debit` |
| `REVENUE` | decreases | increases | `credit − debit` |

A positive balance always means *more of what this account is for*. The single
implementation is `deriveAccountBalance(type, debit, credit)` in
`journal.service.js`; nothing anywhere else decides a sign.

Note this is a *different* convention from the supplier sub-ledger, and
deliberately so. The supplier ledger is written from the supplier account's
point of view (a purchase credits them); the GL is written from the business's
point of view (a purchase debits our inventory). Both are standard; they are
just two different books.

### The journal is the source of truth

`Account` has **no balance column**. Every balance, every report and every
ledger line is aggregated from `JournalLine` at read time.

That is a deliberate trade of a little speed for a guarantee: a balance can
never drift away from the entries that explain it, and a report produced last
month recomputes identically today. If this ever becomes slow, the fix is a
materialised period-summary table that is *rebuilt* from the journal — never a
mutable counter maintained by hand.

### Chart of accounts

```
Account
  code       stable identity, unique per company, NEVER changes
  name       display only, freely editable
  type       ASSET | LIABILITY | EQUITY | REVENUE | EXPENSE, NEVER changes
  parentId   optional grouping, same company, no cycles
  isSystem   seeded, undeletable, cannot be deactivated
  isActive   inactive accounts refuse NEW postings; history stays readable
```

**`code` is the contract.** The posting engine resolves accounts by
`(companyId, code)` — never by a hard-coded id, never by name. That is why a
code can never change and why account ids appear nowhere in the source.

**`type` can never change** either: flipping it would silently invert the sign of
every balance ever derived from the account's existing entries.

Deactivating a normal account stops new postings to it. Its history stays fully
visible in the ledger, the trial balance and every report — hiding posted
entries would make the books stop balancing.

Deletion is only possible for an account that is not a system account, has no
journal lines and has no children. Anything else must be deactivated.

### System accounts

Fourteen accounts, created for every company automatically — by
`initializeCompanyDefaults()` for new companies, and by the Phase 9 migration for
companies that already existed. Both paths insert with `skipDuplicates`, so
seeding is idempotent and never overwrites an account a user has renamed.

```
1000  Cash                            ASSET
1010  Bank                            ASSET
1200  Accounts Receivable             ASSET      control account
1300  Inventory                       ASSET      control account
1400  Advance to Suppliers            ASSET
1500  Input Tax Credit                ASSET
2000  Accounts Payable                LIABILITY  control account
2100  Tax Payable                     LIABILITY
2200  Customer Advances               LIABILITY
3000  Owner's Capital                 EQUITY
4000  Sales Revenue                   REVENUE
4100  Sales Returns                   REVENUE    contra: carries a DEBIT balance
5000  Cost of Goods Sold              EXPENSE
5100  Inventory Valuation Adjustment  EXPENSE    purchase price variance
```

There is also a safety net: if a posting ever finds a system account missing, it
creates the missing ones inside its own transaction and continues. A posting can
therefore never fail with "this company has no chart of accounts".

### The journal

```
JournalEntry            append-only, immutable once posted
  journalNumber         JV-2026-000001, from the shared document-numbers module
  entryDate             the business date of the SOURCE document, not "now"
  sourceType/sourceId   why this entry exists
  status                DRAFT -> POSTED
  totalDebit/totalCredit

JournalLine
  accountId, debit, credit, description, entryDate
```

Five rules, every one of them enforced:

1. at least two lines
2. a line carries a debit **or** a credit, never both
3. neither may be negative
4. a zero-value line is rejected, never silently dropped
5. total debits **must** equal total credits

Rules 2–4 are also **CHECK constraints in PostgreSQL**, so a malformed line is
impossible rather than merely unlikely — no code path, no migration and no
manual SQL can create one.

`status` exists as `DRAFT -> POSTED`, but nothing creates a draft: entries are
written directly as `POSTED` inside a document's posting transaction. The
document's own draft stage *is* the review stage. There is no endpoint that
creates or edits a journal entry by hand, for any role — which is what makes
"users cannot manipulate posted accounting records" true rather than aspirational.

### Document → GL integration

Each document calls one function in `gl-posting.service.js`, as the **last step**
of its existing posting transaction:

```
BEGIN
  lock the document, validate it
  inventory movements        (where applicable)
  sub-ledger effect          (payable / receivable / ledger entry)
  general ledger entry       <- always last
  mark the document POSTED
COMMIT
```

Two consequences, both intentional:

- **Atomicity.** If the journal fails, the document never posts. The stock never
  moved, the payable was never raised, and the draft is still a draft. This is
  tested for every document type by deactivating an account the entry needs.
- **No deadlocks.** Because the journal is always acquired last, every document
  type takes locks in the same global order, so a purchase and a sale posting
  concurrently cannot deadlock against each other.

Two rules hold in every builder:

1. **Amounts come from the server.** Every figure is read from the posted
   document or from the stock movement the inventory service just wrote — never
   from a request body, never from the product master, never recomputed with a
   second costing algorithm.
2. **Inventory is valued at what actually moved.** The inventory amount on a
   journal is the sum of the `totalCost` of the movements *this posting created*,
   so the Inventory control account and the stock ledger cannot disagree by
   construction.

### What each document posts

**Purchase**

```
Dr Inventory                       sum of the stock-in movements
Dr Input Tax Credit                taxTotal
    Cr Accounts Payable            grandTotal  (= what the payable was raised for)
    Cr Inventory Valuation Adj.    the discount, as a price variance
```

Stock is capitalised at the bill's line cost, but only the discounted total is
owed. That gap is a real purchase price variance, and it gets its own account
rather than quietly inflating inventory. A bill with no discount and no tax
produces exactly two lines.

**Purchase return**

```
Dr Accounts Payable                the supplier credit, as the sub-ledger recorded it
    Cr Inventory                   sum of the stock-out movements, at the ORIGINAL cost
```

Same valuation as Phase 5 — no second costing algorithm. Any difference between
the two figures lands in Inventory Valuation Adjustment; see the residue note
below.

**Supplier payment**

```
Dr Accounts Payable                allocatedAmount
Dr Advance to Suppliers            unallocatedAmount
    Cr Bank / Cash                 amount
```

The split is the one the sub-ledger just recorded; it is not recalculated.
`CASH` posts to Cash, every other method to Bank.

**Sales invoice** — two effects, **one entry**, so "exactly one journal per
source document" stays true and both halves commit together:

```
Dr Accounts Receivable             grandTotal
    Cr Sales Revenue               grandTotal − taxTotal
    Cr Tax Payable                 taxTotal
Dr Cost of Goods Sold              the FROZEN cost the stock left at
    Cr Inventory                   the same figure
```

Revenue is derived as `grandTotal − taxTotal` rather than as
`subtotal − discountTotal`. They are the same number, but the first form cannot
drift from the receivable by a rounding unit, so the entry balances by
construction instead of by luck.

**Sales return**

```
Dr Sales Returns                   grandTotal − taxTotal   (contra-revenue)
Dr Tax Payable                     taxTotal
    Cr Accounts Receivable         grandTotal
Dr Inventory                       the FROZEN cost from the original sale
    Cr Cost of Goods Sold          the same figure
```

Sales Revenue is never touched by a credit note. Revenue keeps showing what was
actually sold, and the credit note is its own visible line — which is what a P&L
reader needs.

**Customer payment**

```
Dr Bank / Cash                     amount
    Cr Accounts Receivable         allocatedAmount
    Cr Customer Advances           unallocatedAmount
```

### Duplicate postings are structurally impossible

`JournalEntry` is unique on `(companyId, sourceType, sourceId)`. One source
document can produce exactly one entry — enforced by the database, not by an
application guard. Five simultaneous posts of the same purchase produce one
success, four 409s, one journal entry and three journal lines.

This same constraint is what makes **reversal idempotent**: a reversal is stored
as `sourceType = REVERSAL` with the original entry's id as `sourceId`, so a
second reversal of the same entry cannot exist.

### Reversal

A posted entry is never edited and never deleted. A correction is a **new entry**
that swaps every debit and credit, references the original through
`reversalOfId`, and carries the original's date so the period it belongs to nets
to zero.

`POST /journal-entries/:id/reverse` is `ADMIN` only. It is a correction tool and
**no document flow uses it**: reversing a document's journal without reversing
the document itself makes the GL diverge from the sub-ledger on purpose. A
reversing entry cannot itself be reversed.

### Reports

All three are pure aggregations over `JournalLine`, filtered to `POSTED` entries.

**Trial balance** (`?date=`) — every account with activity up to that date, with
debit total, credit total and natural balance. Reports `isBalanced` explicitly
rather than assuming it: a trial balance whose job is to prove the books balance
should say so out loud.

**Profit and loss** (`?from=&to=`)

```
revenue          REVENUE accounts, excluding 4100
− salesReturns   account 4100, reported positive
= netRevenue
− costOfGoodsSold   account 5000
= grossProfit
− otherExpenses     EXPENSE accounts, excluding 5000
= netProfit
```

COGS is separated from other expenses so gross profit is visible. Both are
identified by their stable system codes, never by name.

**Balance sheet** (`?date=`) — assets, liabilities, equity, and the identity
`assets = liabilities + equity`.

**Retained earnings are derived, not posted.** This system has no period-closing
process, so no journal entry ever moves profit into equity. Rather than fabricate
one, the balance sheet computes earnings since inception directly from the
revenue and expense accounts and reports it as its own equity line. The identity
then holds for a real reason:

```
sum(debits) − sum(credits) = 0   over every posted line
=> Assets + Expenses − Liabilities − Equity − Revenue = 0
=> Assets = Liabilities + Equity + (Revenue − Expenses)
                                    ^^^^^^^^^^^^^^^^^ retained earnings
```

### Reconciliation between the GL and the sub-ledgers

Tested, not assumed:

| Control account | Reconciles with |
|---|---|
| `2000` Accounts Payable | sum of `SupplierPayable.outstandingAmount` |
| `1200` Accounts Receivable | sum of `CustomerReceivable.outstandingAmount` |
| `1300` Inventory | sum of `quantity × averageCost` over `InventoryBalance` |

Advances sit in their own accounts (`1400`, `2200`) rather than making a control
account negative, which is what keeps the first two exact.

**The documented Phase 5 residue.** The inventory reconciliation is exact while
costs are uniform. It is not exact after a purchase return against a blended
average, because a return removes stock at the *original purchase cost* while the
stock left behind keeps *today's average*:

```
buy 100 @ 100, buy 100 @ 200   -> 200 units, average 150, GL inventory 30000
return 5 at the original 100   -> 195 units @ 150 = 29250
                                  GL inventory     = 29500
                                  residue          =   250  (5 × (150 − 100))
```

The residue is real and this is where it becomes visible rather than hidden. The
ledger still balances, because the journal balances line by line; the gap is
between the GL's Inventory account and the stock ledger's valuation. Closing it
properly means posting the difference to Inventory Valuation Adjustment at return
time, which requires the return to know the current average — a change to Phase 5
behaviour, deliberately not made here. There is a test that measures the residue
exactly, so it can never grow unnoticed.

### Tax

The general ledger's own view of tax is simple: input tax is an asset, output tax
is a liability, and both are posted inside the document's transaction.

**The CGST/SGST/IGST split, place of supply, HSN/SAC and GSTIN validation arrived
in the GST phase** — see "GST and tax compliance" below. A company that has not
configured GST still posts to the aggregate accounts described here, which is why
journals written before that phase are still readable and still reconcile.

### Precision

Journal amounts are `Decimal(18,4)` and are rounded **once**, as the line is
built. Nothing downstream re-rounds. Reports sum already-rounded values, so a
report total always equals the sum of its visible lines. There is no
`Number()`, `parseFloat()` or `toFixed()` anywhere in the accounting module's
arithmetic.

### Known limitations

- **No period closing.** Nothing locks a past period, and retained earnings are
  computed rather than posted. A backdated document silently changes a prior
  period's reports.
- **No opening balances.** `Owner's Capital` exists but no flow posts to it, so a
  business migrating in cannot state what it started with. Until then the balance
  sheet describes only what this system has recorded.
- **No manual journal entries.** Every entry comes from a document. Depreciation,
  accruals, payroll and bank charges have nowhere to go yet.
- **Reports are flat.** Accounts are grouped by type, not rolled up through
  `parentId`. The hierarchy is stored and validated but not yet summarised.
- **A reversal can un-balance the GL against a sub-ledger**, by design — it
  reverses the journal without reversing the document.
- **No multi-currency, no bank reconciliation, no cash-flow statement.**

## GST and tax compliance

Indian GST needs three things the earlier phases deliberately did not model:

1. **Who** the parties are, for tax purposes — a GSTIN and a state, on both sides.
2. **Where** the supply happens — the place of supply, which decides whether one
   tax applies or two.
3. **What** is being supplied — an HSN/SAC classification and a tax treatment.

This section adds all three, and the accounting that follows from them.

### GST is opt-in, and the switch is the company's own state code

A company with no `stateCode` has not told the system where it is registered, and
there is **no lawful way to choose between IGST and CGST+SGST without that**.
Rather than guess, such a company keeps exactly the behaviour it had before this
phase: one rate, one tax amount, posted to the aggregate tax accounts.

```
company.stateCode is null   ->  GST off. Tax behaves as it did in Phases 4-9.
company.stateCode is set    ->  GST on.  Every document is classified, and a
                                document with an unknown counterparty state is
                                REFUSED rather than guessed at.
```

That is what lets an existing installation upgrade without a single historical
document changing meaning, while a registered business gets full treatment. It is
also the honest model: an unregistered business genuinely has no CGST/SGST split
to record.

### The one rule that matters

```
seller state == place of supply   ->  INTRA_STATE  ->  CGST + SGST
seller state != place of supply   ->  INTER_STATE  ->  IGST
```

Never both, on the same supply. The decision is made **only** by comparing the two
states, in `determineSupplyType()`, and never from anything a client sends.

Which state is which depends on the direction:

| Document | Seller state | Buyer state | Place of supply |
|---|---|---|---|
| Purchase | the supplier's | the receiving warehouse's, else the company's | the destination — where the goods arrive |
| Sale | the selling warehouse's, else the company's | the customer's | the customer's state, or an explicit override |

A sale accepts an optional `placeOfSupplyStateCode`, which is what a bill-to /
ship-to difference needs. It is the only tax input a client may send, and even
then it is only an input to the decision — never the decision.

When GST is on and a required state is missing, the document is refused with
`GST_STATE_REQUIRED`. Nothing is written.

### GSTIN validation

`src/modules/tax/gstin.js` implements the full check — length, character classes,
the fixed `Z`, a real state code, and the **modulus-36 checksum**:

```
27   AAPFU0939F   1    Z    V
|    |            |    |    checksum over the first 14 characters
|    |            |    fixed
|    |            entity number for this PAN in this state
|    the holder's PAN
state code
```

**A valid checksum is not a registration.** It proves the number is internally
consistent and nothing more. This project makes no external calls, and every
response that reports a GSTIN check says so in as many words. Never present it as
"verified".

The company's **own** GSTIN is validated strictly, including the checksum and a
cross-check that its embedded state matches the state being configured — it is
printed on every invoice the business issues. Supplier and customer GSTINs keep
the format-only rule they have had since Phase 2; see the limitations below.

### HSN / SAC

`TaxClassification` stores the codes a company actually uses — 4 to 8 digits, one
row each, unique per company, with an optional default tax.

The government HSN list runs to tens of thousands of codes and changes with every
budget. Shipping a copy would be a liability rather than a feature: a stale
catalogue that quietly misclassifies goods is worse than no catalogue. A business
uses a handful of codes and keeps them current itself.

A code is **never editable** once created — documents freeze it onto their lines —
and a retired classification cannot be put on a new product or document, while
every document that already froze it stays readable.

### The tax master carries its own split

`Tax` gained `cgstRate`, `sgstRate`, `igstRate`, `cessRate`, a `treatment` and an
effective window. The split is derived from the headline rate unless it is given
explicitly, and either way it is **checked**:

```
cgstRate + sgstRate == rate
igstRate            == rate
```

A tax master that fails that check cannot be saved. Rates that existed before this
phase were backfilled deterministically, with CGST taking the truncated half and
SGST the remainder — so `cgst + sgst == rate` exactly, even for a rate with an odd
number of paise.

`treatment` is explicit, because **a 0% taxable supply and an exempt supply are
different things to a GST return**:

```
TAXABLE     tax at the configured rate (which may be 0%)
EXEMPT      never taxed, whatever rate is configured
NIL_RATED   never taxed
ZERO_RATED  never taxed
```

The treatment is the authority, not the number — a misconfigured rate can never
put tax on an exempt line. And a line with **no tax chosen at all** records no
treatment: it is untaxed, which is not the same as exempt, and the system does not
pretend to know which.

### The calculation, and where it rounds

`src/modules/tax/gst.calculator.js` is pure Decimal arithmetic — no database, no
dates, no HTTP.

```
taxableAmount = gross - discount           (unchanged from earlier phases)

INTRA_STATE:  cgst = round(taxable * cgstRate / 100, 4)
              sgst = round(taxable * sgstRate / 100, 4)
              igst = 0
INTER_STATE:  igst = round(taxable * igstRate / 100, 4)
              cgst = sgst = 0
BOTH:         cess = round(taxable * cessRate / 100, 4)

taxAmount  = cgst + sgst + igst + cess     <- the SUM, not a separate rounding
lineTotal  = taxableAmount + taxAmount
```

**The tax is defined as the sum of its components.** It is not computed
independently and then reconciled, which is what makes

```
cgstAmount + sgstAmount + igstAmount + cessAmount === taxAmount
```

true by construction at every rate and every quantity, rather than true by luck.
Document totals are then the sum of the already-rounded line values, so a printed
invoice always adds up.

Rounding happens **once**, as each component is produced, to 4 decimal places —
the column precision. Nothing downstream re-rounds; serialization to 2 decimals
happens only at the API edge.

### Tax-inclusive pricing

**Every price in this system is tax-exclusive.** `unitCost` and `unitPrice` are
the amount before tax, and tax is added on top. There is no tax-inclusive field
anywhere, and no endpoint accepts one — so there is no ambiguity about what a
price means.

The reverse calculation (`taxableAmountFromInclusive`) is implemented and unit
tested so that when a tax-inclusive price list is introduced there is exactly one
implementation of it, but **no document uses it today**.

### What is frozen onto a document

Every taxable line stores enough to reproduce its own tax forever:

```
hsnCodeSnapshot        taxTreatmentSnapshot
cgstRateSnapshot       sgstRateSnapshot     igstRateSnapshot   cessRateSnapshot
cgstAmount             sgstAmount           igstAmount         cessAmount
```

Only the rates that were **actually applied** are recorded: an intra-state line
stores CGST and SGST with IGST at zero, and an inter-state line the reverse. The
snapshot therefore reproduces the line by itself, without needing to know the
supply type.

The header stores both GSTINs, both states, the place of supply, the supply type
and the four component totals.

A posted document is unaffected by:

- the tax master's rate changing
- the customer or supplier moving state
- the HSN classification being retired
- the company's own GST registration changing

All four are tested.

### Purchase accounting

```
INTRA-STATE                          INTER-STATE
Dr Inventory        10 000           Dr Inventory        10 000
Dr Input CGST          900           Dr Input IGST        1 800
Dr Input SGST          900               Cr Accounts Payable 11 800
    Cr Accounts Payable  11 800
```

**Input GST is not capitalised into inventory.** It is recoverable, so it is its
own asset — inventory carries the goods only. That is why the Inventory control
account still reconciles with the stock ledger after this phase.

A purchase discount still lands in Inventory Valuation Adjustment, exactly as in
Phase 9.

### Purchase return accounting

```
Dr Accounts Payable   1 180
    Cr Inventory              1 000
    Cr Input CGST                90
    Cr Input SGST                90
```

The tax comes from the **original bill's frozen rates**, applied to the returned
line's taxable value. Today's tax master is never consulted, so revising a rate
cannot change a debit note against an old bill.

The supplier is now credited for goods **plus tax**, which is what a debit note
does. `PurchaseReturn.grandTotal` is `taxableTotal + taxTotal`; for a company
without GST the tax is zero and the total is the cost-only figure it has always
been.

### Sales accounting

```
INTRA-STATE                            INTER-STATE
Dr Accounts Receivable  2 360          Dr Accounts Receivable 2 360
    Cr Sales Revenue         2 000         Cr Sales Revenue        2 000
    Cr Output CGST             180         Cr Output IGST            360
    Cr Output SGST             180
Dr Cost of Goods Sold   1 000          (COGS and inventory unchanged)
    Cr Inventory             1 000
```

Output GST is collected on the government's behalf: a liability, never revenue.
**The COGS half is untouched by this phase** — it still uses the cost frozen at
posting, and the inventory credit is still the sum of the movements the posting
created.

### Sales return accounting

```
Dr Sales Returns      800     (contra-revenue)
Dr Output CGST         72
Dr Output SGST         72
    Cr Accounts Receivable  944
Dr Inventory          400     (at the frozen COGS, unchanged)
    Cr Cost of Goods Sold   400
```

The credit note inherits the invoice's GST context wholesale — both states, the
place of supply, the HSN and the frozen rates — so it reverses exactly the tax the
invoice charged.

### GST ledger accounts

Eight new system accounts, hanging under the aggregate accounts the pre-GST phases
used, so a chart of accounts reads as a tree:

```
1500 Input Tax Credit          2100 Tax Payable
 ├─ 1510 Input CGST             ├─ 2110 Output CGST
 ├─ 1520 Input SGST             ├─ 2120 Output SGST
 ├─ 1530 Input IGST             ├─ 2130 Output IGST
 └─ 1540 Input Cess             └─ 2140 Output Cess
```

Resolved by `(companyId, code)` like every other system account — no id is ever
hard-coded — and equally undeletable and impossible to deactivate.

**Journals posted before this phase still point at 1500 and 2100 and are left
completely alone.** Those accounts remain in the chart as the parents of the new
ones, so an old trial balance still reconciles.

### Atomicity

Nothing changed about the transaction boundary: the tax is computed as part of the
document's own line arithmetic, and the journal is still written **last** inside
the same transaction.

```
BEGIN
  lock the document, validate it
  resolve the GST context and split each line     (draft time)
  ...
  inventory movements
  sub-ledger effect
  assert the GST invariants                        <- inside the transaction
  general ledger entry, with the component accounts
  mark the document POSTED
COMMIT
```

If the tax invariants fail, or a GST account is unusable, the whole posting rolls
back — no stock movement, no payable, no journal, no tax. Tested for purchases,
sales, both returns.

### The invariants, asserted at posting

`assertGstTotalsConsistent()` runs inside every posting transaction:

1. A document may never carry CGST/SGST **and** IGST.
2. An inter-state supply is never taxed with CGST/SGST.
3. An intra-state supply is never taxed with IGST.
4. The components must add up to the tax charged.
5. A document with no place of supply may not carry a split at all.

### GST summaries

`/api/v1/tax/...` computes input and output tax from the posted documents, with a
rate-wise and HSN-wise breakdown, and reconciles them against the GST control
accounts in the general ledger. The two are computed **independently** — one from
the documents, one from the journal — precisely so that a disagreement is visible
rather than assumed away.

**These are internal accounting summaries, not filed returns.** Every response
says so. Eligibility rules, reverse charge, ineligible credits and reconciliation
against a supplier's own filing all sit outside this system, and the net figure is
not a legal liability.

### Known limitations

- **No GST portal integration**: no e-invoice IRN, no e-way bill, no filing, and
  no reconciliation against the portal. GSTR-1 and GSTR-3B **preparation datasets**
  are built from posted documents - see "GST return preparation" below - but
  nothing is submitted anywhere and the datasets do not carry every statutory
  field.
- **Supplier and customer GSTINs are validated for format only**, not checksum.
  Tightening them would retroactively invalidate GSTINs already stored by earlier
  phases. The strict check is available at `POST /tax/validate-gstin` and is
  enforced on the company's own GSTIN.
- **All prices are tax-exclusive.** Tax-inclusive price lists are not supported;
  the reverse arithmetic exists but nothing calls it.
- **A purchase return does not prorate the original line's discount** before
  applying tax — it taxes `quantity x unitCost`, consistent with the Phase 5
  valuation. Bills without a line discount are unaffected.
- **Reverse charge is not modelled.** A purchase always books input credit.
- **No composition-scheme arithmetic.** The registration type is recorded but does
  not change how tax is computed.
- **SEZ and export flows are recorded only as a `ZERO_RATED` treatment**; there is
  no LUT/bond handling, no shipping-bill data and no refund workflow.
- **Cess is a single rate**, not the quantity-based cess some goods attract.
- **No tax-period locking.** A back-dated document still changes a past period's
  summary, exactly as it changes a past period's P&L.
- **Place of supply follows the goods.** The special rules for services are not
  modelled.

## GST return preparation (GSTR-1 and GSTR-3B datasets)

The GST phase records tax on documents. This one arranges that record into the
shape a GST return is filed in.

**It prepares data. It does not file anything.** Nothing here contacts the GST
portal, no statutory validation is performed, and several fields a real return
requires are not available in this system at all. Every response says so, in a
`notFiled` field, and the limitations at the end of this section are the honest
list of what is missing.

### No new schema

Phase 11 added **no tables and no columns**. Everything a return needs was already
frozen onto documents by the GST phase: both GSTINs, both states, the place of
supply, the supply type, the HSN, the tax treatment, the rate and the four
component amounts, on every line — plus, on a credit note, the invoice it
reverses.

Persisting a "GSTR-1 row" would have meant storing a second copy of facts the
documents already hold, which could then drift out of step with them. A return is
therefore **derived on demand** and is reproducible from the documents at any
time.

### Period semantics

```
GET /api/v1/tax/returns/gstr-1?fromDate=2026-09-01&toDate=2026-09-30
```

- Both dates are **required**. There is no "everything to date" default: a return
  is always for a stated period, and silently choosing one would be worse than
  refusing.
- Both bounds are **inclusive**. A document dated on the first or the last day is
  inside the period.
- The date compared is the document's **business date** — `invoiceDate` on an
  invoice or a purchase, `returnDate` on either kind of return. These are `DATE`
  columns stored at UTC midnight, so no timezone can shift a document across a
  period boundary.
- A **credit note is placed by its own date**, not by the date of the invoice it
  reverses. A September invoice returned in October appears in September's
  invoices and October's credit notes — which is how it is actually filed. The
  October credit note still names the September invoice.

### Which documents are included

| Status | In a return? |
|---|---|
| `POSTED` | **Yes**, exactly once |
| `DRAFT` | No — it has charged nobody any tax |
| `CANCELLED` | No — it never existed for GST purposes |

The one exception is the **documents-issued table**, which reports the number
series a period consumed. A cancelled number still came out of the series, so it
is counted there and reported separately as cancelled.

### The canonical row set

Both datasets are built the same way:

```
read every posted line of the period, ONCE, with its header
        |
        v
normalise each into one ReturnRow  (gst-return.dataset.js)
        |
        +--> group by GSTIN        -> B2B table
        +--> group by document     -> invoice detail
        +--> group by rate         -> rate summary
        +--> group by HSN          -> HSN summary
        +--> group by place of supply
        +--> group by treatment    -> nil-rated / exempt
```

Every table is a **view of the same rows**. Nothing is recomputed from a different
query, which is what makes the tables agree with each other, and what makes "no
tax was lost in grouping" something the reconciliation can actually prove.

Grouping keys are deterministic strings and results are sorted by them, so the
same set of posted documents always produces byte-identical output. That is
asserted directly: the same request twice must be byte-for-byte equal.

### Classification

Each outward line lands in **exactly one** of three buckets:

| Bucket | Rule |
|---|---|
| `b2b` | the buyer had a GSTIN on the document |
| `b2c` | the buyer had none |
| `unclassified` | the document has **no place of supply** |

The third exists because a company that had not enabled GST wrote documents that
carry a tax amount but no supply type and no split. There is no lawful GSTR-1
table for such a document. Rather than guess it into B2C or drop it, it is listed
under `unclassified` with the reason `NO_PLACE_OF_SUPPLY`.

That is the general principle in this phase: **an explicit "cannot classify" is
worth more than a confident wrong answer.**

### Credit notes

A sales return is a credit note. It appears **only** in the credit-note tables,
never in `b2b` or `b2c`, and always carries `originalInvoiceNumber`,
`originalInvoiceDate` and `originalInvoiceId`.

Its amounts are shown **positive** in its own table — a credit note of 944 reads
as 944 — while every summary **subtracts** it. That is what `sign` on a row is
for: an invoice and the credit note reversing it net to zero in every grouping,
without any table needing to know which is which.

An invoice and its credit note can never be counted as one document: they are
different rows with different ids, and the deduplication test asserts that the
invoice number never appears in a credit-note table and vice versa.

### GSTR-1 dataset

| Section | Contents |
|---|---|
| `b2b` | supplies to registered persons, grouped by GSTIN, then by document, then by rate |
| `b2c` | supplies to unregistered persons: per-document detail **and** a place-of-supply × rate summary |
| `creditNotes` | `registered` and `unregistered`, each naming the original invoice |
| `nilRatedExemptZeroRated` | lines by treatment |
| `hsnSummary` | HSN/SAC-wise, net of credit notes |
| `rateSummary` | rate-wise, net of credit notes |
| `placeOfSupplySummary` | state-wise, net of credit notes |
| `documentsIssued` | the number series consumed, cancellations included |
| `unclassified` | documents with no place of supply, and why |
| `totals` | invoices, credit notes, and the net |

**The statutory B2CL / B2CS split is not applied.** That split turns on an
invoice-value threshold which is a statutory parameter this system does not
store, and hard-coding a figure that changes with the law would be exactly the
kind of invented rule this phase avoids. Both halves of what the split needs are
provided — per-invoice detail and the state-and-rate summary — and the dataset
says in its own `note` field that the split has not been applied.

**Nil-rated and exempt lines stay on their invoices.** The
`nilRatedExemptZeroRated` section is a *view* over the same rows, not a fourth
bucket. Removing lines from an invoice would misrepresent a real document.

### GSTR-3B dataset

| Section | Contents |
|---|---|
| `outwardSupplies.taxableSupplies` | 3.1(a), net, with gross and credit notes shown separately |
| `outwardSupplies.nilRatedExemptSupplies` | 3.1(c) |
| `outwardSupplies.reverseChargeSupplies` | 3.1(d) — reported as **not determined** |
| `interStateSuppliesToUnregistered` | 3.2, by place of supply |
| `inputTaxCredit.allOtherItc` | 4(A)(5) |
| `inputTaxCredit.itcReversed` | 4(B)(2) — purchase returns |
| `inputTaxCredit.netItcAvailable` | 4(C) |
| `inputTaxCredit.notDetermined` | every bucket this system cannot populate, with a reason each |
| `netPosition` | outward tax less net ITC |
| `unclassified` | documents with no place of supply |

**Taxable and non-taxable are separated by treatment, not by rate.** A 0% taxable
supply is not an exempt one, and the two are reported on different lines.

**All input tax goes into one bucket.** ITC eligibility turns on reverse charge,
imports, ISD distribution, blocked credits under section 17(5), the supplier's own
filing, and proportional reversal for exempt supplies. This system records none of
those, so every rupee of recorded input tax is reported as "all other ITC" and
each unavailable bucket is named in `notDetermined` with the reason it cannot be
computed. They are **not** silently reported as zero.

`netPosition` is an internal figure. Interest, late fee, cash-ledger balances and
the actual payment of tax are not modelled, and the field says so.

### Rounding

Amounts are summed as Decimals at the stored precision (4 dp) and rounded **once**,
at serialization, to 2 dp — a return is filed in rupees and paise. There is no
floating-point arithmetic anywhere in this layer.

Because a component can legitimately hold 4 dp, the sum of displayed parts could
in principle differ from the displayed whole by a fraction of a paisa. That is not
swept up:

- `rounding.display` compares the sum of the published rate rows against the
  published total.
- `rounding.precision` compares the full-precision figure against the published
  one, and reports the full-precision value alongside.

Both are ordinary checks in the reconciliation output, so a residue is visible
rather than absorbed.

### Reconciliation

`GET /api/v1/tax/returns/reconciliation` runs roughly thirty checks. Every one
compares two figures **arrived at different ways** — comparing a number with
itself proves nothing:

| Comparison | What it proves |
|---|---|
| line rows vs document header columns | a document agrees with its own lines |
| grouped totals vs ungrouped totals | grouping lost nothing, on every key |
| dataset totals vs source documents | the return agrees with the books |
| GSTR-3B vs the underlying datasets | the summary agrees with its detail |
| dataset totals vs GL tax control accounts | the return agrees with the ledger |
| components vs total tax | CGST + SGST + IGST + Cess adds up |
| b2b + b2c + unclassified vs all invoices | every line is in exactly one table |

The ledger comparison is in **four** parts, not two. Tax carrying a GST split
posted to the component accounts (`1510`–`1540`, `2110`–`2140`); tax written
before GST was enabled posted to the aggregate accounts (`1500`, `2100`). Each is
compared against the accounts it actually posted to, so no rupee escapes the
reconciliation whichever way it was recorded.

Likewise the component-identity check is asked only of rows that **have** a split,
and is paired with its mirror image: a document with no place of supply must not
have acquired a split from somewhere.

**A failing check is reported, not thrown.** A reconciliation endpoint that
refuses to answer when something is wrong is useless exactly when it is needed.
The response carries `summary.isReconciled`, a `failedChecks` array, and both
sides plus the difference for every check. That is tested directly: a tax split
corrupted behind the API's back is detected, named, and the endpoint still
answers.

### Concurrency

This phase is read-only. It takes no locks, opens no transactions and writes
nothing. Determinism comes from ordering, not from locking: the result is stable
for a stable set of posted documents, and concurrent reads return identical
output.

### Known limitations

- **This is not a filing.** No GST portal integration, no GSTR-1 or GSTR-3B
  submission, no JSON/offline-utility export format, no e-invoice IRN, no e-way
  bill, no acknowledgement handling.
- **Not every statutory field is present.** There is no `notFiled` claim to the
  contrary anywhere; the datasets are for preparation and review.
- **The B2CL / B2CS split is not applied** — the threshold is a statutory
  parameter this system does not store.
- **ITC is a single bucket.** Imports, reverse charge, ISD, blocked credits under
  section 17(5) and rule 42/43 reversals are all reported as not determined.
- **Reverse-charge outward liability (3.1(d)) is always zero**, because reverse
  charge is not modelled at all.
- **Amendment tables are not produced** (9A/9C and the like). A posted document is
  never edited in this system, so there is nothing to amend against; a correction
  is a credit note, which appears in the credit-note tables.
- **Advances received and adjusted (tables 11A/11B) are not produced.** Customer
  advances exist in the sub-ledger but are not attributed to a place of supply or
  a rate, so no lawful figure can be derived.
- **Export and SEZ supplies are only visible as a `ZERO_RATED` treatment** — no
  shipping-bill data, no LUT/bond, no refund workflow.
- **HSN reporting has no unit of measure or quantity column.** A real HSN table
  wants both; the document lines carry quantity, but not a UQC code, so it is
  omitted rather than fabricated.
- **No period locking.** A back-dated posted document changes an already-prepared
  period's dataset, exactly as it changes that period's P&L.
- **Nothing is stored.** A prepared return is not snapshotted, so there is no
  record of "what was filed"; re-running the same period after a back-dated
  document will legitimately give a different answer.

## Dashboard, reports and the credit book

The layer a shop owner actually opens the application to look at.

### GST is optional, and this is where that is proved

The product serves two kinds of business: a GST-registered company, and a local
shop that has never registered and never will. **Nothing in this module requires
GST.**

No query in `src/modules/reports/` reads a GSTIN, a place of supply, a supply
type or a tax component. Every figure comes from documents, the sub-ledgers,
inventory or the general ledger — none of which needs GST to exist. A shop with
no registration gets the same dashboard, the same credit book and the same twelve
reports, with the same numbers, as a registered business.

The single GST-related field anywhere in the module is `gstEnabled` on the
dashboard, so a client can decide whether to offer GST screens at all. Nothing
else depends on it, and there is a test that asserts a non-GST company gets a
complete dashboard with every section populated.

Where GST *is* configured, its reporting stays exactly where Phase 10 and 11 put
it: `/api/v1/tax/...`. It is additional, never a prerequisite, and never mixed
into the ordinary business reports. A business report shows tax as one column
among several because an invoice total includes it — that is not GST reporting,
it is arithmetic.

### No second accounting engine

This was the hardest constraint and the one that shaped the module.

```
profit and loss        -> accounting/report.service.js        (the general ledger's own)
general ledger         -> accounting/journal.service.js
customer ledger        -> customer-receivables/...service.js  (delegated whole)
supplier ledger        -> supplier-payables/...service.js     (delegated whole)
customer outstanding   -> the customer sub-ledger's own figures
supplier outstanding   -> the supplier sub-ledger's own figures
inventory valuation    -> quantity x average cost, the inventory module's own arithmetic
cash and bank          -> the journal, on accounts 1000 and 1010
sales / purchases / receipts / payments -> the posted documents themselves
```

Four reports are **pure delegation**: they call the module that owns the
calculation and shape the result. That is deliberate. A report that recomputed a
customer ledger would be a second answer to a question that already has one, and
the two would eventually disagree — usually in front of a customer.

`dashboard.repository.js` is a query layer only: period sums, per-party groupings,
counts. It contains no accounting rule at all.

The dashboard's profit block does not compute profit. It asks the general
ledger's P&L service for the month to date and prints the answer, which is why a
test can assert that the dashboard figure and the P&L report figure are the same
string.

### What "today" means

Business dates are `DATE` columns at UTC midnight. "Today" for a shop in Mumbai
is not the same instant as "today" in UTC: between 00:00 and 05:30 IST the two
disagree by a day, and a morning's sales would land in yesterday's dashboard.

So today is resolved in the **company's own timezone**, from
`CompanySettings.timezone`, and converted back to a UTC-midnight date to match
the stored columns. `Intl` does the timezone arithmetic. An unknown timezone falls
back to UTC rather than taking the dashboard down.

`GET /dashboard?date=YYYY-MM-DD` overrides it, which is what makes the dashboard
testable without freezing the clock.

### Periods

| Period | Range |
|---|---|
| Today | the single day |
| This week | Monday to Sunday, containing today |
| This month | the 1st to the last day |

Each is compared against the **whole** equivalent previous period — last week in
full, last month in full — never a partial one, so a comparison is like for like.

`changePercent` is **null** when the previous period was zero. "Up from nothing"
has no percentage, and reporting infinity or 100% would be a made-up number on a
business dashboard.

### What counts

**Only POSTED documents.** A draft has sold nothing, bought nothing and paid
nobody; a cancelled document never happened. This holds in every figure on the
dashboard, in every report, and in the credit book.

Sales and purchases are reported both gross and **net of returns**, because a
shopkeeper asking "what did I sell today" means what stayed sold.

### The credit book

The six questions a shopkeeper actually asks, answered in those words:

| Question | Answer |
|---|---|
| Who owes me money? | `GET /credit/receivables` — one row per customer, biggest debt first |
| Whom do I owe? | `GET /credit/payables` |
| How much? | `outstanding`, per party and in total |
| Since when? | the oldest unpaid document, its number, its date and its age in days |
| What payments were made? | the last posted receipt or payment, with date and amount |
| What is overdue? | anything past its due date, as an amount and a filter |

Ageing buckets are `0-30`, `31-60`, `61-90`, `90+`, and `UNDATED` for a document
with no date to age from — named rather than guessed into a bucket.

The per-invoice outstanding figures are **not recomputed**. They are the ones the
customer and supplier sub-ledgers maintain inside the posting transaction of every
invoice, credit note, bill, debit note and payment.

A `creditLimit` is stored on a customer and a supplier and is reported, but this
system **never enforces it** — no sale is blocked because a customer is over their
limit.

### Reconciliation

Every report can be checked against something computed a different way, and the
tests do exactly that:

| Report | Reconciles with |
|---|---|
| Customer outstanding | the customer sub-ledger, and the AR control account (`1200`) |
| Supplier outstanding | the supplier sub-ledger, and the AP control account (`2000`) |
| Inventory valuation | the Inventory control account (`1300`) |
| Cash and bank | the Cash and Bank accounts (`1000`, `1010`) |
| Sales report | the ledger's revenue, and the receivables raised |
| Dashboard profit | the P&L report, string for string |

The trial balance is asserted to still balance after a full day of trading
including both kinds of return.

### Rounding

Every amount is `Decimal` throughout and serialized as a 2-decimal string at the
edge. Inventory is valued at `quantity x averageCost` rounded **per balance** —
the identical arithmetic the inventory module publishes for a single balance, so
a line in the valuation report and a line in the inventory list can never
disagree. There is no `Number()`, `parseFloat()` or `toFixed()` anywhere in the
module, including in sort comparators.

### Read-only by construction

There is no `POST`, `PATCH` or `DELETE` anywhere in this module. No role — not
even `ADMIN` — can change a posted document, a balance or a journal entry through
a dashboard or a report, because no such route exists. Reads are open to `ADMIN`
and `STAFF`, matching every other read in the project.

The module takes no locks and opens no transactions. Determinism comes from
ordering: two identical requests against unchanged data return byte-identical
JSON, which is asserted.

### Known limitations

- **There is no expense-entry document.** Rent, salaries, electricity and every
  other operating cost cannot be recorded, so "today's expenses" and the P&L's
  `otherExpenses` contain only what the system generates itself — cost of goods
  sold and purchase price variance. The dashboard's profit block says this in its
  `basis` field rather than presenting a partial figure as complete. This is the
  single biggest gap in the dashboard and the obvious next phase.
- **Profit is month-to-date only** on the dashboard. Any other range is available
  through the P&L report.
- **No cash-flow statement.** The cash and bank report shows movements and
  balances, not a classified cash-flow statement.
- **Credit limits are recorded but never enforced.**
- **No trend series or charts data.** Daily grouping queries exist in the
  repository but no endpoint exposes a time series yet.
- **The cash and bank report caps at 1000 movements per account** before
  pagination is applied, which is ample for a small business but is a cap.
- **No scheduled or emailed reports, no PDF or Excel export.** Every endpoint
  returns structured JSON.
- **`asOfDate` on the credit book defaults to the server's UTC date**, not the
  company timezone — only the dashboard resolves the company's own "today". Pass
  `asOfDate` explicitly for exactness near midnight.

## Expenses and cash/bank operations

The gap Phase 12 exposed: the system could show what a business earned and what
its stock cost, but not what it cost to *run*. Gross profit was reliable, net
profit was not, because there was nowhere to record rent.

An expense is the smallest real document in this codebase — two journal lines,
no items, no stock, no tax, no party balance — and its value is precisely that
it is small enough to be obviously correct.

### The shape

```
Expense
  expenseNumber            EXP-YYYY-NNNNNN, unique per company
  expenseDate              @db.Date
  expenseAccountId         -> Account  (the category)
  categoryNameSnapshot     what it was called when recorded
  amount                   Decimal(18,4), CHECK (amount > 0)
  paymentMode              CASH | BANK
  paymentAccountId         -> Account  (where the money left from)
  paymentAccountNameSnapshot
  supplierId               -> Supplier, nullable, informational only
  supplierNameSnapshot
  status                   DRAFT | POSTED | CANCELLED | REVERSED
  createdById / postedById / cancelledById / reversedById
```

Two snapshots and two live foreign keys, deliberately. The foreign key is how
the ledger reaches the account; the snapshot is what the document *said* at the
time. Renaming an account changes the chart, never the history.

### A category is an account

There is no `ExpenseCategory` table, and there never should be one.

`expenseAccountId` points at an `EXPENSE` account in the company's own chart.
That single decision is what makes three separate reports agree without any
reconciliation logic:

* the expense report groups expense **documents** by category
* the profit and loss sums **journal lines** on expense accounts
* the general ledger lists those same lines

They agree because they are the same rows, not because anything checks that they
match.

It also means custom categories come free. `POST /api/v1/accounts` with type
`EXPENSE` creates one, and it is immediately selectable, postable and reportable
with no further code. Nothing in the posting path matches on a name — the whole
of `buildExpenseLines` takes two account **ids**.

Three expense accounts are excluded, in `NON_CATEGORY_EXPENSE_CODES`:

```js
export const NON_CATEGORY_EXPENSE_CODES = [
  SYSTEM_ACCOUNT.COST_OF_GOODS_SOLD,              // 5000
  SYSTEM_ACCOUNT.INVENTORY_VALUATION_ADJUSTMENT,  // 5100
  SYSTEM_ACCOUNT.OPERATING_EXPENSES,              // 5200
];
```

The first is the one that matters. Cost of goods sold is maintained by sales
postings, and gross profit is the number a shopkeeper trusts most; letting rent
land there would corrupt it silently, in a way no error message would ever
surface. The list is checked by **code**, never by name.

### Posting

```js
Dr  expense.expenseAccountId    amount
      Cr  expense.paymentAccountId    amount
```

`buildExpenseLines` is pure and exported, so the debit/credit shape is unit
tested without a database — the same pattern every other document builder in
`gl-posting.service.js` follows.

This is the first posting in the system whose accounts are not resolvable by
system code: a custom category has no code the code knows. So
`createPostedEntryWithinTransaction` learned to resolve a line by `accountId` as
well as by `accountCode`:

```js
const explicitIds = [...new Set(lines.map((line) => line.accountId).filter(Boolean))];
const byId = new Map(explicitIds.length === 0 ? [] :
  (await accountRepository.findManyByIds(companyId, explicitIds, tx)).map((a) => [a.id, a]));

const account = line.accountId ? byId.get(line.accountId) : accounts.get(line.accountCode);
```

`findManyByIds` is company-scoped, so a line can never name another tenant's
account even if a caller somehow supplied one. Existing builders are untouched
and still resolve by code.

The whole posting is one transaction: lock, re-validate, write the journal,
flip the status. The journal is written **last**, as everywhere else in this
codebase, so the global lock order stays consistent and expenses cannot deadlock
against purchases or sales.

Re-validation at post time is not redundant. A draft can sit for a week, and the
category or the bank account may have been deactivated in between. Posting to a
deactivated account is refused and the whole transaction rolls back — the
expense stays a draft, and nothing claims money left.

### Why reversal exists

Every other document in this system has an undo that is itself a document: a
purchase has a purchase return, a sale has a credit note. An expense has
nothing. Without reversal, a posted expense with a mistyped amount would be
permanently wrong, in the ledger, forever.

So reversal writes a **new** entry that swaps the two sides. The original entry
is never touched, and both remain visible — which is what an auditor wants and
what a deletion would destroy.

Idempotency is structural, not defensive:

```
@@unique([companyId, sourceType, sourceId])   on JournalEntry
```

The reversal is stored as `sourceType: EXPENSE_REVERSAL` with the *expense's own
id*. A second reversal of the same expense cannot exist in the database, even if
two requests arrive in the same millisecond and both pass the status check. The
row lock makes the second request lose cleanly with a `409`; the unique
constraint means that even if the lock were bypassed, the wrong outcome is
impossible rather than unlikely.

The same argument covers double posting, via `sourceType: EXPENSE`.

### GST is absent, on purpose

The expense module contains no GST code. Not "GST that is skipped when
unregistered" — none at all. `expense.validation.js` has no GSTIN, no HSN, no
place of supply, no tax rate and no tax amount, and the posting builds two lines
that never touch an input-tax account.

This is what the product requires. The application serves both GST-registered
businesses and small local shops with no registration, and rent is rent in both.
A registered company's expense produces exactly the same entry as an
unregistered one's, and neither reaches a GST return.

Input tax credit on expenses is a real feature this does **not** implement.
Claiming it needs a tax-bearing expense line, a supplier GSTIN, an HSN/SAC code
and a place of supply — the entire purchase apparatus. A half-built version
would produce a *wrong* GSTR-3B rather than an incomplete one, which is strictly
worse, so the expense carries no tax at all.

### Credit expenses: a documented limitation

Every expense here is already paid. There is no "bill received, pay later"
expense, and this was decided by looking at the existing schema rather than by
preference.

`SupplierPayable` is built around a purchase:

```prisma
purchaseId String   @unique
purchase   Purchase @relation(fields: [purchaseId], references: [id])
```

The foreign key is **required**, and the supplier ledger, the ageing report, the
credit book and the payment-allocation logic all read `payable.purchase` and
assume it is there. Making an expense raise a payable would mean making that
column nullable, adding an `expenseId` beside it, and auditing every reader
built across Phases 6, 9 and 12.

That is a larger change than this phase, and a partial version — a payable whose
`purchase` is sometimes null, feeding reports that dereference it — would break
working credit reporting to add an unfinished feature. It is recorded as a
limitation instead. `supplierId` on an expense is therefore informational only:
it records who was paid and raises nothing.

### What the reports do with it

`expense-report.service.js` reads one filtered row set and groups it four ways —
category, payment mode, payment account, date — so each grouping necessarily
adds back to the same total. There is no second aggregation path to drift.

**Only `POSTED` counts.** A draft has paid nobody; a cancelled one never
happened; a reversed one was undone by an opposite entry and nets to zero in the
ledger, so counting it would overstate the spend. All three appear in
`otherStatuses` with a reason and `includedInTotals: false` — visible, never
totalled. A shopkeeper is far better served by "there is a ₹9,999 draft you have
not posted" than by silence.

The dashboard's profit block can now state a real net profit:

```
Gross profit = net revenue - cost of goods sold
Net profit   = gross profit - operating expenses
```

Both figures come from `accountingReportService.getProfitAndLoss`, which reads
journal entries — so the dashboard and the P&L report cannot disagree, and the
expense report reconciles to both because posting wrote one from the other.

`netCashMovement` subtracts expenses too. It has to: the money genuinely left
Cash or Bank, and a cash figure that ignored rent would be a lie of exactly the
kind this phase existed to fix.

### Cash and bank

The cash/bank report needed no new machinery — it reads journal lines on
accounts `1000` and `1010`, so posted expenses appeared in it the moment
expenses could post, each carrying `sourceType` and `sourceId` back to its
document.

Its `note` was made explicit about something that was previously implied: there
are no opening balances in this system. A balance is everything the ledger has
recorded from the beginning, and a period's `openingBalance` is the sum of every
line dated before the period — not a figure anyone entered.

### Migration

`20260904100000_expenses` is additive: two enums, one table, eight foreign keys,
five indexes, and a `CHECK ("amount" > 0)` constraint. No `DROP`, no column
change, no data deletion.

It also seeds the fifteen new accounts for companies that already exist, with
`INSERT … ON CONFLICT DO NOTHING` followed by an `UPDATE` that links them under
`5200` — so it is safe to run twice and existing charts gain the categories
without anyone touching them. A new company gets them from
`systemAccountRows()`, which is now 37 accounts and 22 parent links.

## Credit, collections and statements

The gap this phase closes is narrow and was stated plainly in the README before
it: *"Credit limits are recorded but never enforced."* `creditLimit` had sat on
every customer since Phase 3, shown in the credit book and checked by nothing.

The important thing about this phase is how little it built. Payment allocation,
the two sub-ledgers, the ageing credit book and the GL postings for receipts and
payments were all already correct. What was missing was a rule, a term, and three
reads.

### What was NOT rebuilt

Before writing anything, the existing machinery was read end to end. All of this
was already right and is untouched:

* **Multi-invoice payment allocation**, both sides. Receivables are locked in id
  order (so overlapping payments cannot deadlock), amounts are re-checked *under
  the lock* rather than trusted from the draft, and the sub-ledger entry carries
  `@@unique([companyId, referenceType, referenceId])` so a repeated post cannot
  double-count a balance.
* **The customer and supplier sub-ledgers**, with opening balance, running
  balance and per-invoice outstanding maintained inside each posting transaction.
* **`Dr Cash/Bank → Cr AR`** and **`Dr AP → Cr Cash/Bank`**, through
  `gl-posting.service.js`, one balanced entry per document.
* **The credit book** — who owes what, since when, what is overdue.

A second allocation engine, a second ageing calculation or a "collections" table
would each have been a way to make two numbers that could disagree. None was
added.

### The credit-limit rule

The policy is stated once, at the top of `credit-limit.service.js`, because a
rule that refuses a sale has to be a rule anyone can read:

**Zero means unlimited.** This is forced, not chosen. `creditLimit Decimal
@default(0)` is what every customer in every existing company already carries.
Reading 0 as "no credit allowed" would refuse every sale that has ever been made.
So 0 — and only 0 — means no limit is set.

The cost is real and is documented: there is now no way to say "this customer
gets no credit". Fixing that needs a nullable `creditLimit` (a destructive
semantics change to live data) or a separate policy flag. Neither was invented
here.

**Exposure is the ledger balance**, `sum(debit) − sum(credit)`, not the sum of
open invoices. That matters in one specific case: a customer who has paid an
advance genuinely has less exposure, and open-invoice totals do not know it. The
credit summary publishes both, and names the difference `unallocatedCredit`.

**Only posted documents count**, and no code enforces that. The sub-ledger is
written only inside a posting transaction, so a draft or a cancelled invoice is
simply not there. A status filter would have been a second thing to keep right.

`deriveCreditPosition` is pure and exported — the same treatment
`deriveReceivableState` and `buildExpenseLines` get. Twenty-six unit tests run
against it with no database.

### Where the check runs, and why there

Inside `SalesService.post`, in the posting transaction, immediately after
`assertGstTotalsConsistent` and **before any inventory lock**:

```js
const lockedCustomer = await creditRepository.lockCustomerForCredit(tx, locked.customerId, companyId);
const credit = await assertWithinCreditLimit(tx, { companyId, customer: lockedCustomer, ... });
```

The lock is the whole point. Without it, two invoices for the same customer
posting at once both read the same balance, both find room under the limit, and
both commit — leaving the customer over their limit with neither posting
individually at fault. That race is tested directly: two 12,000 invoices against
a 20,000 limit produce exactly one `200` and one `422`.

Placing it before the stock locks keeps the order across every sales posting
total: **invoice → customer → stock → journal**. No other flow in the codebase
locks a customer row, so no cycle with another document type is possible. Two
sales for different customers take different locks and neither waits.

At post rather than at draft, because a draft owes nothing. Refusing to *write
down* an order a customer wants is not the system's business; refusing to put it
on the books is.

### The override, and why it is stored

An `ADMIN` may post past a limit. Refusing outright would be wrong — a shopkeeper
who extends credit to a regular customer is making a decision, not a mistake.

The override is the one genuinely new *fact* in this phase, and it is stored
because nothing else records it. Everything else the credit layer reports is
derived; "someone chose to extend credit anyway, and here is why" is not derivable
from any ledger.

Four columns on `SalesInvoice`: the flag, who, why, and `creditLimitOverrideExposure`
— what the customer owed at that moment, frozen. The live balance moves
afterwards; what was known when the call was made must not. A database `CHECK`
refuses an override with no admin attached, so an unattributable decision cannot
exist.

Posting was already `ADMIN`-only, so the override inherits that. No new
permission was created, and the brief's instruction not to invent an
authorization system was taken literally.

### Payment terms

`creditDays Int?` on both parties. When a document carries no explicit due date
and the party has terms, the date is derived.

```
explicit date   ->  always wins; someone typed it on purpose
terms, no date  ->  invoiceDate + creditDays
neither         ->  undated
```

An **undated document is outstanding but never overdue**. Nobody agreed a date,
so nothing has been missed, and saying otherwise would invent a broken promise.
This is why `UNDATED` is its own ageing bucket rather than being folded into
`NOT_DUE`: "not late" and "no date was ever agreed" are different facts, and a
collections clerk needs to tell them apart.

`resolveDueDate` is exported from both the sales and purchase services and unit
tested across month and year boundaries.

### Statements

`statement.service.js` creates no financial fact. Every line is a sub-ledger row
that already existed; the service attaches the document number, runs a balance
down the page, and stops.

Two things are worth naming:

**A window does not lose history.** Everything before `fromDate` is summed into
the opening balance, so the closing figure is the party's real position rather
than the movement inside the window. A statement whose closing balance depended
on which dates you asked for would be worse than useless.

**The document number is fetched, not copied.** A ledger entry carries
`referenceType` and `referenceId`; the number lives on the source document. It
would have been easy to denormalise the number onto the ledger — and then there
would be two copies of it to keep in step. `findDocumentNumbers` loads them in
one query per document type instead.

The two sides mirror deliberately:

| | Positive means | Debit | Credit |
|---|---|---|---|
| Customer | they owe us | Invoice | Receipt, credit note |
| Supplier | we owe them | Payment, debit note | Bill |

### Collections and ageing

**Ageing is by days past due, not document age.** "60 days old" and "60 days
late" are different questions, and a collections list is asking the second. The
existing credit book ages by the oldest *document date*, which is the right
answer to *its* question; this layer answers the other one and both remain.

`ageDocuments` makes one pass over one set of open receivables and produces both
the buckets and the per-party rows. That is why the buckets always add back to
the total — not because anything checks, but because there is only one traversal.
The test asserts it anyway.

Every bucket is always present, even at zero, so a client never has to handle a
missing key.

### Reconciliation

Five integration scenarios prove the invariants independently rather than
asserting that two reports agree with each other:

| Invariant | Proved against |
|---|---|
| customer outstanding == sub-ledger == AR control | credit summary, `CustomerReceivable` sums, `journalLine` totals on 1200 |
| supplier outstanding == sub-ledger == AP control | payables summary, `SupplierPayable` sums, journal totals on 2000 |
| cash report == cash GL balance | `/reports/cash-bank` vs journal lines on 1000 |
| bank report == bank GL balance | same, on 1010 |
| one balanced entry per posted receipt | `journalEntry` count and line-level debits/credits |

The first is the interesting one. With a 15,000 receipt allocated 12,000 against
a 20,000 invoice pair, the invoice-level outstanding is 8,000 and the ledger
balance is 5,000. Both are right: the difference is the 3,000 advance, and the
test asserts it is sitting in Customer Advances (2200) as a 3,000 credit. A
naïve test would have "fixed" one of the two numbers.

### GST

Nothing in this module reads a GSTIN, a state code, an HSN code, a tax rate or a
place of supply. `credit.validation.js` has no GST field and should never grow
one.

A shop with no registration sells on credit, receives and allocates payment,
reads a statement, pays suppliers and watches its cash move — with no GST
configuration at all. The integration suite walks that entire path for a company
whose `gstin` and `stateCode` are both null, then runs the same assertions
against a GST-registered company and gets identical answers.

### Schema

`20260905100000_customer_credit`, additive only — no `DROP`, no type change, no
data touched. Every column is nullable or has a default, so existing rows are
valid the moment it runs.

* `customers.creditDays`, `suppliers.creditDays` — `INTEGER`, with a `CHECK` for
  `0–3650`
* `sales_invoices.creditLimitOverride` + three companion columns, an FK to the
  admin, and a `CHECK` that an override is always attributed
* two composite indexes on `(companyId, partyId, dueDate)` — overdue reporting
  reads receivables by due date *per party*, and the existing indexes were
  `(companyId, dueDate)` only

No new table. There was nothing to store that the sub-ledgers were not already
storing, except the override.

## Opening balances and accounting periods

Two features, joined by one observation about this codebase: there is exactly one
place a posted journal entry can be created, and it has been that way since
Phase 9.

### The single choke point

`createPostedEntryWithinTransaction` in `journal.service.js` is called from one
file — `gl-posting.service.js`, once per document type — plus the journal
reversal path. Purchases, purchase returns, supplier payments, sales, sales
returns, customer receipts, expenses and expense reversals all funnel through it,
always as the LAST step of their own transaction.

That is why the period lock is one line in one function:

```js
await assertPostingAllowed(tx, companyId, input.entryDate, input.description);
```

Every posting route is protected, including routes that do not exist yet. The
brief asked for the enforcement to sit at "the appropriate shared service /
repository / posting boundary so that every route is protected"; this codebase
already had that boundary, so nothing needed inventing.

Because the check runs INSIDE the caller's transaction and before the entry is
written, a refusal rolls the whole posting back — the stock never moved, the
sub-ledger never changed, the document stays a draft.

The two operations that change stock without writing a journal entry — inventory
adjustments and the standalone opening-stock endpoint — do not reach that
function, so they are checked in `applyMovement`, the wrapper those two endpoints
use. Document flows call `applyMovementWithinTransaction` directly with their own
transaction and are guarded at the journal, so nothing is checked twice.

### Why an absent period does not block

The brief's §14 says to reject a posting when no open period covers its date. Read
literally that would have stopped every existing business trading the moment this
deployed: no company created in Phases 1-14 has a single period, so every posting
would begin failing.

So the rule implemented is:

```
CLOSED period  -> refuse
OPEN period    -> allow
no period      -> allow, unless the company opted in
```

Periods are opt-in. A company that never creates one behaves exactly as it did
before they existed. `CompanySettings.requireOpenPeriod` — default FALSE, which
is precisely today's behaviour — turns on the strict rule for a business that
wants it. The flag is only read when there is no period at all, so the common
path costs one indexed lookup and nothing more.

This is the phase's main judgement call, and it is recorded here rather than
buried: the strict reading was available, backward compatibility won, and the
strict reading is kept as a deliberate opt-in.

### Opening balances: no fake documents

The hard constraint was `CustomerReceivable.salesInvoiceId String @unique` — a
REQUIRED foreign key to a sales invoice. An opening receivable has no invoice
behind it, so there were two options: invent one, or relax the column.

Inventing an invoice was refused outright. It would put a sale in the books that
never happened, and it would surface immediately as revenue in the profit and
loss — the exact failure the brief describes.

So `salesInvoiceId` and `purchaseId` became nullable. Three things make that
safe:

* The migration RELAXES a NOT NULL. Every existing row already satisfies it, so
  no data is touched and nothing can be invalidated.
* The `@unique` indexes stay. Postgres allows any number of NULLs under a unique
  index, so "one invoice raises at most one receivable" holds exactly as before,
  while opening rows sit outside the constraint.
* Every unguarded dereference of `receivable.salesInvoice` and `payable.purchase`
  was found and made null-safe, and each now publishes
  `source: 'SALES_INVOICE' | 'OPENING_BALANCE'` so a client never has to infer
  the kind from a missing object.

Phase 13 declined this same change for credit expenses, on the grounds that it
was larger than that phase. The reasoning has not changed — what changed is that
this phase's brief requires opening dues to age, to be chased and to be settled,
and Phase 14's test coverage now protects the sub-ledgers while it is done.

The payoff is that an opening receivable is a REAL receivable. It ages in the
collection report, appears on a statement, and is settled by an ordinary receipt
with an allocation. A parallel "opening dues" table would have given none of that,
and would have been a second place for a customer balance to live.

### No opening-balance table

The opening journal entry IS the initialization record. It carries the as-of
date, who created it, when, and the totals — and it is stored with
`sourceType: OPENING_BALANCE` and the COMPANY'S OWN ID as `sourceId`, so the
existing constraint

```
@@unique([companyId, sourceType, sourceId])
```

makes a second initialization impossible at the database. Not guarded in code,
not racy under two simultaneous requests: impossible.

The service checks first anyway, so a caller gets a clean 409 rather than a
constraint violation. The database is the guarantee; the check is the manners.

`GET /opening-balances/details` reads every figure back from where it lives — the
GL for the journal lines, the two sub-ledgers for the parties, the inventory
module for the stock. Nothing is stored twice, so a later correction to any of
them shows through.

### Capital is derived, never supplied

`buildOpeningLines` is pure and exported, tested by fifteen unit tests with no
database — the same treatment `buildExpenseLines` and `deriveCreditPosition` get.

Owner's Capital is the balancing figure: assets less liabilities. It is not a plug
that hides an arithmetic error, it is the accounting answer, and when liabilities
exceed assets the line reverses to a debit and the entry still balances. The
request schema deliberately has NO `openingEquity` field: letting a caller state
capital would let them state a figure that does not balance.

### Inventory goes through the inventory module

Opening stock calls `applyMovementWithinTransaction` with type `OPENING_STOCK` —
the one place the moving weighted average lives. The Inventory GL line is then the
sum of what those movements actually recorded, so the ledger and the stock module
cannot disagree by construction rather than by a reconciliation step.

`requireNoExistingBalance: true` means an initialization can never silently
overwrite real stock.

The consequence worth stating: opening stock is NOT a purchase and NOT an expense.
It sits on the balance sheet and becomes cost of goods sold only when it is sold,
at the cost it was brought in at. The integration suite checks exactly that — sell
10 of 40 units brought in at 1,100 and COGS is 11,000, not 44,000 and not zero.

### Ordering inside the transaction

Sub-ledgers and stock first, the journal LAST — the same order every document
flow in this codebase uses. That keeps the global lock order identical, so an
initialization cannot deadlock against a sale posting happening at the same
moment.

### Reconciliation

The integration suite proves the invariants independently rather than comparing
one report against another:

| Invariant | Checked against |
|---|---|
| customer outstanding == sub-ledger == AR control | collection report, `CustomerReceivable` sums, journal lines on 1200 |
| supplier outstanding == sub-ledger == AP control | payables summary, `SupplierPayable` sums, journal lines on 2000 |
| cash / bank report == their GL balances | `/reports/cash-bank` vs journal lines on 1000 and 1010 |
| inventory valuation == inventory GL balance | `/reports/inventory-valuation` vs journal lines on 1300 |
| opening journal debits == credits | the entry's own totals, and the whole ledger's |
| no opening balance is revenue or cost | the P&L reads zero on every line |

### A gap this phase exposed

The cash book resolved exactly two accounts, `1000` and `1010`. Supporting
multiple bank accounts in an opening balance — which the brief requires — made a
second bank account invisible to the cash report while being perfectly visible in
the trial balance.

The fix uses the chart hierarchy that already exists: the cash book now covers
Cash, Bank, and any account PARENTED UNDER them. No code-prefix guessing, no new
"is this a bank account?" column, and with no child accounts the behaviour is
byte-identical to before — which is why no existing test moved.

### Dates

Period bounds are inclusive UTC-midnight DATE columns, like every other business
date here. Inventory adjustments carry no business date of their own, so their
period is resolved from the company's OWN timezone through the existing
`todayIn` / `toBusinessDate` helpers rather than a second timezone strategy.

The new schemas validate a date by ROUND TRIP, not merely by NaN:
`new Date("2026-02-30")` does not fail — it rolls forward into March, and the
date silently becomes a different day. Formatting the parsed date back and
comparing is the only way to catch it. The older document schemas still have that
gap; changing eight modules' date validation late in this phase was judged riskier
than recording it.

### Migration

`20260906100000_opening_balances_and_periods` — additive and relaxing only. No
DROP TABLE, no DROP COLUMN, no data deletion, and no constraint narrowed.

* two `ALTER COLUMN ... DROP NOT NULL`, which every existing row already satisfies
* two `ALTER TYPE ... ADD VALUE IF NOT EXISTS` for the new ledger entry types
* `company_settings.requireOpenPeriod`, defaulting to today's behaviour
* the `accounting_periods` table, with `CHECK (startDate <= endDate)` and a
  `CHECK` that a closed period always names who closed it — an unattributable
  close cannot exist

## The SaaS layer (platform, subscriptions, sales team)

This is the first module in the codebase that is **not accounting**, and keeping
that boundary sharp is the whole design.

```
  src/modules/platform/
    permissions.js               the permission catalogue (pure)
    subscription.rules.js        date and status arithmetic (pure, no DB)
    platform.repository.js       ALL Prisma for plans/subs/payments/staff/shops
    subscription.service.js      plans, selling, renewing, cancelling, payments
    onboarding.service.js        registering a shop; the sales team
    subscription-guard.service.js   the posting guard
    platform.controller.js       HTTP only
    platform.routes.js           permission gates
    subscription-status.routes.js   the one route a SHOP calls about itself
```

### Where the two systems touch

Exactly one place: the `Company` row. The SaaS layer points at it to say "this
shop has paid"; the accounting engine points at it to scope every ledger row. No
file in `modules/platform/` reads or writes an accounting table, and no
accounting service imports from it — with a single, deliberate exception, below.

**Subscription money is never posted to a shop's journal.** It is the platform
operator's revenue, not the shop's expense. Writing it into their books would be
inventing a transaction they never recorded.

### Platform users have no company

`User.companyId` became nullable so a `PLATFORM_ADMIN` or `SALES_STAFF` can exist
without one. This is what enforces the separation: every shop route derives its
tenant from `req.user.companyId`, so a platform user's null companyId means there
is no shop they can reach. It is a relaxation, not a destructive change — every
existing user still has theirs.

Conversely, a shop's `ADMIN` holds no entry in `User.permissions`, so
`requirePermission()` refuses them every platform route.

### Snapshots, again

`Subscription` carries `planNameSnapshot`, `priceSnapshot`,
`durationValueSnapshot`, `durationUnitSnapshot` — frozen at the moment of sale.
This is the same reasoning as `supplierNameSnapshot` on a purchase and the frozen
GST context on an invoice: **a later change to a master record must never rewrite
history.** Reprice a plan and every shop already on it keeps what it agreed.

### The one exception: the posting guard

`journal.service.js` imports `assertSubscriptionAllowsPosting` from the platform
module. This is a considered exception to the separation, and it is placed
exactly where the accounting-period guard already sits — inside
`createPostedEntryWithinTransaction`, which every posted document in the system
reaches, last, inside its own transaction.

Guarding there means one check protects sales, purchases, expenses, receipts,
supplier payments, both return types, reversals and opening balances at once, and
a document type added next year inherits it without anyone remembering to. The
alternative — a check in each of the document services, or in a middleware per
route — is a list of places to forget.

**A shop with no subscription at all is allowed to post.** This mirrors the
period guard's opt-in reasoning precisely: every company created before this
phase has no subscription row, and refusing them would stop every existing
business trading the moment this deployed. A shop the funnel never touched is not
an expired shop.

Reading is never guarded. An expired shop keeps full access to its own history,
reports and exports; only *recording new business* stops.

### Concurrency

`createSubscription` takes `SELECT id FROM companies WHERE id = $1 FOR UPDATE`
before reading the current subscription. Two reps selling the same shop a renewal
simultaneously would otherwise both read the same end date and both extend from
it, giving the shop one period instead of two.

The lock is on the **company** row, because that is the thing they are contending
for — the same reasoning behind the row locks in the sub-ledgers.

---

## AI bill import

```
  src/modules/bills/
    bill-storage.service.js      files on disk; nothing else touches the FS
    bill-extraction.service.js   the model call; the ONLY file that reads the key
    bill.repository.js           ALL Prisma for bills
    bill.service.js              the lifecycle, and the bridge to purchases/sales
    bill.validation.js           imports the REAL purchase/sales schemas
    bill.controller.js           HTTP only
    bill.routes.js               multer, RBAC
```

### A Bill is a staging record, not a document

`Bill` holds a file, what a model read from it, and what a human confirmed. It is
**not** an accounting document, has no ledger effect, and appears in no report.

The bridge is `bill.service.confirm()`, and its entire job is to call
`purchaseService.createDraft` + `post`, or `salesService.createDraft` + `post`,
and remember the id. It computes no total, decides no tax rate, writes no journal
line and moves no stock — those services do all of it, exactly as they do for a
typed document.

This is why an imported bill and a typed one produce identical accounting: there
is only one implementation, and bill import is a *caller* of it.

### Untrusted input

The model's response is treated the way a request body is treated: parsed against
a Zod schema, coerced, and rejected if it is not the shape we asked for. A
hallucinated field is dropped; a hedged amount becomes null rather than a number
nobody typed.

That is not caution about one particular model. OCR over a creased photo of a
handwritten bill misreads digits, and a system that posted those directly would
manufacture false accounting records at scale, silently. **The review step is the
product, not an obstacle to it.**

The model reads *text*; posting needs *ids*. Matching "ABC Traders" to a supplier
record is a judgement about the shop's own data, so a human makes it, and their
choice is what gets posted. This is also why the feature cannot be made
fully automatic without changing what it is.

### Double-posting is impossible structurally

`@@unique([companyId, postedSourceType, postedSourceId])` on `Bill` means one
bill produces at most one accounting document — enforced by the database, not by
application code, in the same spirit as `JournalEntry`'s unique
`(companyId, sourceType, sourceId)`.

### The secret

`LLAMA_API_KEY` is read once in `config/env.js` and used in exactly one file. It
appears in no response, no log line and no error message; vendor error bodies are
logged truncated and never returned to a caller. There is no `NEXT_PUBLIC_`
counterpart in either frontend, and both production bundles were checked for it.

The whole feature is **optional**: with no key configured, upload reports plainly
that automatic reading is not set up, the shop types the bill in by hand, and
every other feature is untouched. Nobody should need an AI vendor account to run
an accounting system.

### Files

Three rules, each because the alternative is a real hole:

1. **The client never names a file.** Its filename is display text; the name on
   disk is a server-generated uuid.
2. **Paths derive from the authenticated companyId**, so one shop cannot write
   into or read out of another's subtree.
3. **The browser never sees a path** — only a bill id, streamed back through an
   authenticated endpoint. A static folder would make every uploaded bill public
   to anyone who guessed a filename.

Uploads are also checked against their **magic bytes**, because a `Content-Type`
header is a claim rather than evidence.


## Manual recharges, and who the platform superadmin is

### Two kinds of "admin", and why they must stay apart

| Role | Belongs to | `companyId` | Reaches |
|---|---|---|---|
| `ADMIN` | one shop | required | that shop's books |
| `PLATFORM_ADMIN` | the operator | **null** | the platform; no shop's books |

These are different jobs and must never share an account. A shop's admin who
could also administer the platform would be able to reach every *other* shop —
the multi-tenancy boundary would exist only by accident.

Until this pass, `npm run prisma:seed` created only a shop `ADMIN`, so **nobody
could reach the platform console**: every platform route correctly refused the
one account that existed. `prisma/seed-platform-admin.js` creates the operator's
account instead, and refuses to promote an existing shop user into it.

### A grant is a subscription, not a moved date

`grantSubscription` in `subscription.service.js` creates a real subscription row
through the same path a sale takes: `lockCompanyForSubscription` for the row
lock, `resolvePeriod` for the dates, the same plan snapshots. It differs in three
fields — `origin`, `grantReason`, and who is recorded as `createdById`.

This is the whole design. `UPDATE subscriptions SET endDate = ...` would be less
code and would destroy the only evidence of why a shop has access nobody paid
for. The audit trail is not a separate system bolted alongside; it is the shape
of the record itself, which is what makes it impossible to desynchronise from
what actually happened.

There is **no `AuditLog` table**, and none was added. Every field §10 of the
brief asks for already had a home on `Subscription` and `SubscriptionPayment`; a
second system recording the same facts would be a second thing to keep true.

### The date rules are not reimplemented

`resolvePeriod` already encodes "an early renewal starts the day after the
current one ends". A grant calls it, a sale calls it, and the preview endpoint
calls it. One implementation, three callers.

The preview matters more than it looks: an admin sees "30 Sep → 31 Dec" before
committing. If that were computed in the browser, or by a second function, it
would eventually disagree with the outcome — and the disagreement would surface
only after somebody had clicked. A test asserts the two produce identical dates.

### Free grants write no payment

A ₹0 payment row would dress a gift up as a transaction and inflate every
collections report. So a free grant records `priceSnapshot: 0` and
`origin: ADMIN_GRANT` on the subscription, and writes nothing to the payments
table. `priceSnapshot` is the amount *recorded*, never the plan's list price.

### `SUBSCRIPTION_GRANT` is its own permission

Not folded into `SUBSCRIPTION_CREATE`, and not in the sales-staff defaults.
Selling a shop a plan and giving one away for free are different levels of trust:
whoever holds this can grant unlimited free access to anybody. An operator hands
it out deliberately, or not at all.

### The posting guard and platform users

`assertSubscriptionAllowsPosting` now returns early when `companyId` is null.
Platform staff have no company and never post to a shop's books, so the guard has
nothing to say about them — and must never be the reason a platform operation
fails. The behaviour was already correct by accident (a null company matches no
subscription, so it fell through to "allowed"); accidental correctness in a
security guard is worth replacing with the deliberate kind.

### No payment gateway

Deliberately absent: Razorpay, Stripe, PayPal, webhooks, online payment of any
kind. The grant endpoint rejects a gateway-shaped payload rather than ignoring
it. `MANUAL` means money collected offline and recorded afterwards;
`ADMIN_GRANT` means no money at all.


## Verifying a period before closing it

`period-verification.service.js` answers one question read-only: does everything
in this range agree with everything else? Four checks - the period balances, the
whole ledger balances up to the period end, and each sub-ledger agrees with its
control account.

It reuses the CREDIT module's own queries for the sub-ledger totals rather than
writing private ones, so the check compares the control account against the very
numbers the credit book and dashboard show a user. A check against a privately
written query would prove nothing about what anybody actually sees.

`close()` runs it first and refuses a period that does not reconcile. The
verification happens OUTSIDE the transaction, before the row lock: the checks are
read-only, and holding a lock across them would block postings for no benefit.

Two of the four checks should never fail, because the posting service cannot
write an unbalanced entry. That is deliberate - they are a tripwire for anything
that writes around the posting path, and closing on top of such damage would set
it in stone.

### Why there is still no closing journal entry

The balance sheet DERIVES retained earnings as revenue minus expenses since
inception. That derivation is what makes the accounting identity hold, and it is
exact rather than approximate.

Posting a closing entry that moved profit into equity would double-count against
it. Worse, the P&L is computed from journal lines over a date range, so a closing
entry dated at period end would be swept into the very period it closes and
report that period's profit as zero. A previous period's P&L stays historical
precisely BECAUSE nothing is posted when a period closes.

### Other opening balances

`otherBalances` carries assets, liabilities and equity that have no dedicated
field - a vehicle, a loan, capital already introduced. The debit/credit side is
derived from the ACCOUNT TYPE, never from the request, so a mistake cannot turn a
loan into an asset and still balance.

Revenue and expense accounts are refused outright: they describe what happened
during a period, and an opening balance describes a position at a moment.
Allowing them would let an initialization manufacture profit that was never
earned, which is the one thing the whole module exists to avoid.

The four control accounts are refused too - they are driven by their own fields,
and setting one here as well would double-count it and break the sub-ledger
reconciliation.

## The three applications, and why they are separate

```
  backend/         the API and the accounting engine        :4000
  frontend/        the PLATFORM console (admin panel)       :3001
  business-web/    the SHOP web app + public landing page   :3002
```

Two separate Next.js projects, not one with a role switch. The reasons are worth
stating, because "one app with an `isAdmin` check" is the tempting alternative:

**Different audiences, different risk.** The platform console is used by a
handful of the operator's own staff. The shop app is used by thousands of
shopkeepers on phones. Shipping them together means every shop owner downloads
the JavaScript for managing every other shop's subscription.

**A role check is one bug away from being wrong.** With two builds, a shop owner
cannot reach the platform console's code at all, because it is not in the bundle
their browser was served. That is a stronger guarantee than any `if` statement.

**They ship on different clocks.** A pricing change in the console should not
require re-testing a shopkeeper's sales screen.

Neither frontend talks to PostgreSQL. Neither imports from the other. They meet
only at the API.

### The URL boundary inside the shop project

`business-web/` serves two audiences from one origin, so the split is visible in
the path rather than hidden in a layout file:

```
  /              the public marketing site      (server-rendered, no auth)
  /shop/login    sign in
  /shop/*        the application                (AuthGuard, token required)
```

Nobody has to read a layout to know which is which, and a stray link cannot
quietly drop somebody from one into the other. Paths are defined once in
`lib/constants.ts` (`SHOP_PREFIX`, `ROUTES`) rather than written out at each call
site, and a test asserts every navigation entry lives under the prefix.

### Role display names

The database enum has said `ADMIN` and `STAFF` since the first migration.
Renaming it would mean touching every authorization check in the backend to fix a
wording problem, so the enum stays and the **wording** is mapped, in
`lib/auth/roles.ts` in each frontend:

| Stored | Shown in the shop app | Shown in the console |
|---|---|---|
| `ADMIN` | Shop Owner | Shop Owner |
| `STAFF` | Shop Staff | Shop Staff |
| `PLATFORM_ADMIN` | — | Platform Super Admin |
| `SALES_STAFF` | — | Sales Representative |

Both were previously rendered as "Administrator". A shopkeeper who reads that on
their own profile reasonably concludes they administer the platform, and a
support conversation then begins from a false premise.

The helpers accept `unknown` and fall back to "User" rather than throwing, so a
value nobody anticipated renders as a word instead of crashing a page — and a raw
enum never reaches a screen.

### Why the shop app turns platform accounts away

A `PLATFORM_ADMIN` has no company. Every screen in the shop app derives its data
from `req.user.companyId`, so a platform account signing in there would see a
dashboard of zeroes and a sidebar of empty pages.

The shop login therefore refuses them with a message pointing at the console.
This is a **courtesy, not a control**: the backend already refuses platform
accounts every shop route and shop accounts every platform route, and that is
what actually enforces the boundary. Both directions are proven over real HTTP
rather than by looking at a rendered page — hiding a button proves nothing, a 403
does.

## Adding a new module

1. `src/modules/<name>/` with `<name>.routes.js`, `<name>.controller.js`, `<name>.service.js`,
   `<name>.repository.js`, `<name>.validation.js`.
2. Mount it in `src/app.js`: `app.use('/api/v1/<name>', <name>Routes)`.
3. Every tenant-scoped repository method takes `companyId`.
4. Reuse `src/utils/validation.js` and `src/utils/pagination.js` rather than writing new
   rules for names, GSTINs, money or paging.
5. Export a `toPublicX()` mapper from the service; never return a raw Prisma record.
6. Add the model to `resetDatabase()` in `tests/helpers/db.js`, children before parents.
7. Tests in `tests/integration/<name>.test.js`. For a master-data module, call
   `runMasterDataSuite()` from `tests/helpers/master-data-suite.js` to inherit the shared
   authentication, RBAC, tenant isolation, pagination and deactivation tests, then add the
   module-specific ones.
8. Document the endpoints in `docs/api.md`.
9. If the module posts a business document, write its journal entry LAST inside the
   existing posting transaction, through `gl-posting.service.js`. Never open a second
   transaction for accounting.

Note on JavaScript: this project has no TypeScript, so there are no `*.types.ts` files.
Shapes are documented with JSDoc on service functions and enforced at runtime by Zod, which
is what actually protects the database.
