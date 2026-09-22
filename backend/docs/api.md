# Pharma ERP API — v1

Base URL (development): `http://localhost:4000/api/v1`

All endpoints live under `/api/v1`. Requests and responses are JSON.

---

## Response format

Every successful response:

```json
{ "success": true, "data": { } }
```

Write operations may add a `message`:

```json
{ "success": true, "data": { }, "message": "User created successfully" }
```

List endpoints return an array plus a `pagination` block:

```json
{
  "success": true,
  "data": [],
  "pagination": { "page": 1, "limit": 20, "total": 50, "totalPages": 3 }
}
```

Every error response:

```json
{ "success": false, "message": "Invalid credentials" }
```

Validation errors add an `errors` array:

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    { "field": "body.email", "message": "Invalid email address" }
  ]
}
```

The health endpoints are the one exception: they return `{ "success": true, "message": "..." }`,
because they are consumed by uptime monitors rather than by the app.

## Authentication

Send the token from `POST /auth/login` on every protected request:

```
Authorization: Bearer <token>
```

Tokens are JWTs and expire after `JWT_EXPIRES_IN` (default `1d`). There is no refresh token yet —
when a token expires, log in again.

The token identifies the user only. Role, company and active status are re-read from the database
on every request, so deactivating a user or changing their role takes effect immediately.

## Roles

| Role | Can do |
|---|---|
| `ADMIN` | Everything: manage users, read and update their own company, create a company, and create/update master data and stock movements. |
| `STAFF` | Log in, read their own profile and company, and **read** master data and inventory. No writes anywhere. |

A `STAFF` user calling an admin endpoint gets **403**.

## Tenant rule

Every request is scoped to the authenticated user's company. `companyId` is never accepted from the
client — it is taken from the authenticated user. A record belonging to another company responds
with **404**, exactly as if it did not exist, so ids cannot be probed.

## Common error codes

| Status | Meaning |
|---|---|
| 400 | Validation failed, or malformed JSON body |
| 401 | Missing, malformed, invalid or expired token; or wrong login credentials |
| 404 | Route or record not found |
| 409 | Record already exists (unique constraint) |
| 413 | Request body larger than 1 MB |
| 429 | Rate limit exceeded |
| 500 | Unexpected server error |

---

# Endpoints

## GET /api/v1/health

Liveness check. Does **not** touch the database.

- **Authentication:** not required
- **Request body:** none

**Example request**

```bash
curl http://localhost:4000/api/v1/health
```

**Success — 200**

```json
{ "success": true, "message": "API is running" }
```

---

## GET /api/v1/health/db

Readiness check. Runs `SELECT 1` against PostgreSQL.

- **Authentication:** not required
- **Request body:** none

**Example request**

```bash
curl http://localhost:4000/api/v1/health/db
```

**Success — 200**

```json
{ "success": true, "message": "Database connection is healthy" }
```

**Error — 503** (database unreachable)

```json
{ "success": false, "message": "Database connection failed" }
```

---

## POST /api/v1/auth/login

Exchanges email and password for a JWT.

- **Authentication:** not required
- **Rate limit:** 20 requests per 15 minutes per IP

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `email` | string | yes | Case-insensitive; trimmed |
| `password` | string | yes | Plain password |

**Example request**

```bash
curl -X POST http://localhost:4000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{ "email": "admin@example.com", "password": "your-password" }'
```

**Success — 200**

```json
{
  "success": true,
  "data": {
    "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
    "user": {
      "id": "4b1f2c9e-1a4c-4a5e-9f77-2b2a1c8d3e10",
      "email": "admin@example.com",
      "name": "Administrator",
      "role": "ADMIN",
      "companyId": "0c7a91b4-33fd-49f9-9a0e-51a2f0f9a111"
    }
  }
}
```

The password hash is never included in any response.

**Error — 401** (unknown email, wrong password, or deactivated user)

```json
{ "success": false, "message": "Invalid credentials" }
```

The same message is used for all three cases on purpose, so the API does not reveal
which email addresses exist.

**Error — 400** (missing or malformed fields)

```json
{
  "success": false,
  "message": "Validation failed",
  "errors": [
    { "field": "body.email", "message": "Email is required" },
    { "field": "body.password", "message": "Password is required" }
  ]
}
```

---

## GET /api/v1/auth/me

Returns the currently authenticated user. The user is re-read from the database on every
request, so a deactivated or deleted user is rejected even if their token is still valid.

- **Authentication:** required

**Example request**

```bash
curl http://localhost:4000/api/v1/auth/me \
  -H "Authorization: Bearer <token>"
```

**Success — 200**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "4b1f2c9e-1a4c-4a5e-9f77-2b2a1c8d3e10",
      "email": "admin@example.com",
      "name": "Administrator",
      "role": "ADMIN",
      "companyId": "0c7a91b4-33fd-49f9-9a0e-51a2f0f9a111"
    }
  }
}
```

**Error — 401** (no header)

```json
{ "success": false, "message": "Missing or invalid Authorization header" }
```

**Error — 401** (bad, forged or expired token)

```json
{ "success": false, "message": "Invalid or expired token" }
```

---

## GET /api/v1/users

Lists users of the authenticated admin's company. Other companies' users are never returned.

- **Authentication:** required
- **Role:** `ADMIN`

**Query parameters**

| Name | Type | Default | Notes |
|---|---|---|---|
| `page` | integer | `1` | Must be positive |
| `limit` | integer | `20` | Maximum `100` |
| `search` | string | – | Matches name or email, case-insensitive |
| `role` | `ADMIN` \| `STAFF` | – | Filter by role |
| `isActive` | `true` \| `false` | – | Filter by status |

**Example request**

```bash
curl "http://localhost:4000/api/v1/users?page=1&limit=20&search=raj" \
  -H "Authorization: Bearer <token>"
```

**Success — 200**

```json
{
  "success": true,
  "data": [
    {
      "id": "4b1f2c9e-1a4c-4a5e-9f77-2b2a1c8d3e10",
      "email": "staff@example.com",
      "name": "Rajesh Kumar",
      "role": "STAFF",
      "isActive": true,
      "lastLoginAt": "2026-08-24T09:30:00.000Z",
      "companyId": "0c7a91b4-33fd-49f9-9a0e-51a2f0f9a111",
      "createdAt": "2026-08-20T06:00:00.000Z",
      "updatedAt": "2026-08-24T09:30:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

**Errors**

| Status | When |
|---|---|
| 400 | `limit` above 100, non-numeric `page`, invalid `role` |
| 401 | Missing or invalid token |
| 403 | Caller is `STAFF` |

---

## GET /api/v1/users/:id

Returns one user from the caller's own company.

- **Authentication:** required
- **Role:** `ADMIN`
- **Path parameter:** `id` — UUID

**Example request**

```bash
curl http://localhost:4000/api/v1/users/4b1f2c9e-1a4c-4a5e-9f77-2b2a1c8d3e10 \
  -H "Authorization: Bearer <token>"
```

**Success — 200**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "4b1f2c9e-1a4c-4a5e-9f77-2b2a1c8d3e10",
      "email": "staff@example.com",
      "name": "Rajesh Kumar",
      "role": "STAFF",
      "isActive": true,
      "lastLoginAt": null,
      "companyId": "0c7a91b4-33fd-49f9-9a0e-51a2f0f9a111",
      "createdAt": "2026-08-20T06:00:00.000Z",
      "updatedAt": "2026-08-20T06:00:00.000Z"
    }
  }
}
```

**Errors**

| Status | When |
|---|---|
| 400 | `id` is not a UUID |
| 401 | Missing or invalid token |
| 403 | Caller is `STAFF` |
| 404 | No such user, **or** the user belongs to another company |

---

## POST /api/v1/users

Creates a user inside the authenticated admin's company.

- **Authentication:** required
- **Role:** `ADMIN`

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `email` | string | yes | Unique across the whole system; lower-cased |
| `password` | string | yes | 8–128 characters; stored Argon2-hashed |
| `name` | string | yes | 2–100 characters |
| `role` | `ADMIN` \| `STAFF` | no | Defaults to `STAFF` |

`companyId` is **not** accepted. The new user always belongs to the authenticated admin's company;
sending a `companyId` has no effect.

**Example request**

```bash
curl -X POST http://localhost:4000/api/v1/users \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "email": "staff@example.com", "password": "password123", "name": "Rajesh Kumar" }'
```

**Success — 201**

```json
{
  "success": true,
  "data": {
    "user": {
      "id": "4b1f2c9e-1a4c-4a5e-9f77-2b2a1c8d3e10",
      "email": "staff@example.com",
      "name": "Rajesh Kumar",
      "role": "STAFF",
      "isActive": true,
      "lastLoginAt": null,
      "companyId": "0c7a91b4-33fd-49f9-9a0e-51a2f0f9a111",
      "createdAt": "2026-08-24T10:00:00.000Z",
      "updatedAt": "2026-08-24T10:00:00.000Z"
    }
  },
  "message": "User created successfully"
}
```

**Errors**

| Status | When |
|---|---|
| 400 | Invalid email, password under 8 characters, name too short, invalid role |
| 401 | Missing or invalid token |
| 403 | Caller is `STAFF` |
| 409 | Email already in use |

---

## PATCH /api/v1/users/:id

Updates a user in the caller's own company.

- **Authentication:** required
- **Role:** `ADMIN`
- **Path parameter:** `id` — UUID

**Request body** (at least one field required)

| Field | Type | Notes |
|---|---|---|
| `name` | string | 2–100 characters |
| `role` | `ADMIN` \| `STAFF` | |

**Example request**

```bash
curl -X PATCH http://localhost:4000/api/v1/users/4b1f2c9e-1a4c-4a5e-9f77-2b2a1c8d3e10 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Rajesh K." }'
```

**Success — 200** — same `user` object as above, with `"message": "User updated successfully"`.

**Errors**

| Status | When |
|---|---|
| 400 | Empty body, invalid field, or an admin trying to change **their own** role |
| 400 | Demoting the last active admin of the company |
| 401 | Missing or invalid token |
| 403 | Caller is `STAFF` |
| 404 | No such user, or the user belongs to another company |

---

## PATCH /api/v1/users/:id/status

Activates or deactivates a user. A deactivated user cannot log in, and any token they already hold
stops working on the next request.

- **Authentication:** required
- **Role:** `ADMIN`
- **Path parameter:** `id` — UUID

**Request body**

| Field | Type | Required |
|---|---|---|
| `isActive` | boolean | yes |

**Example request**

```bash
curl -X PATCH http://localhost:4000/api/v1/users/4b1f2c9e-1a4c-4a5e-9f77-2b2a1c8d3e10/status \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "isActive": false }'
```

**Success — 200** — the updated `user`, with `"message": "User status updated successfully"`.

**Errors**

| Status | When |
|---|---|
| 400 | `isActive` missing or not a boolean; changing **your own** status; deactivating the last active admin |
| 401 | Missing or invalid token |
| 403 | Caller is `STAFF` |
| 404 | No such user, or the user belongs to another company |

---

## GET /api/v1/companies/me

Returns the authenticated user's own company. Available to any authenticated user.

- **Authentication:** required
- **Role:** any

**Example request**

```bash
curl http://localhost:4000/api/v1/companies/me -H "Authorization: Bearer <token>"
```

**Success — 200**

```json
{
  "success": true,
  "data": {
    "company": {
      "id": "0c7a91b4-33fd-49f9-9a0e-51a2f0f9a111",
      "name": "Default Company",
      "gstin": null,
      "isActive": true,
      "createdAt": "2026-08-20T06:00:00.000Z",
      "updatedAt": "2026-08-20T06:00:00.000Z"
    }
  }
}
```

**Errors:** 401 when the token is missing or invalid.

---

## GET /api/v1/companies/:id

Returns a company by id. Only the caller's own company is accessible.

- **Authentication:** required
- **Role:** `ADMIN`
- **Path parameter:** `id` — UUID

**Success — 200** — same shape as `/companies/me`.

**Errors**

| Status | When |
|---|---|
| 400 | `id` is not a UUID |
| 401 | Missing or invalid token |
| 403 | Caller is `STAFF` |
| 404 | Any other company's id, whether or not it exists |

---

## PATCH /api/v1/companies/:id

Updates the caller's own company.

- **Authentication:** required
- **Role:** `ADMIN`
- **Path parameter:** `id` — UUID

**Request body** (at least one field required)

| Field | Type | Notes |
|---|---|---|
| `name` | string | 2–150 characters |
| `gstin` | string \| null | 15-character Indian GSTIN, e.g. `27AAPFU0939F1ZV`. Unique across companies. |
| `isActive` | boolean | |

**Example request**

```bash
curl -X PATCH http://localhost:4000/api/v1/companies/0c7a91b4-33fd-49f9-9a0e-51a2f0f9a111 \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{ "name": "Sunrise Pharma", "gstin": "27AAPFU0939F1ZV" }'
```

**Success — 200** — the updated `company`, with `"message": "Company updated successfully"`.

**Errors**

| Status | When |
|---|---|
| 400 | Empty body, name too short, malformed GSTIN |
| 401 | Missing or invalid token |
| 403 | Caller is `STAFF` |
| 404 | Another company's id |
| 409 | GSTIN already used by another company |

---

## POST /api/v1/companies

Creates a new company (tenant) **together with its first admin user**, in a single transaction —
a company with no admin could never be managed, because users can only be created by an admin of
that same company.

- **Authentication:** required
- **Role:** `ADMIN`

> **Known limitation:** any `ADMIN` of any company can call this. There is no platform-level super
> admin role yet. Restrict this endpoint before exposing the API publicly.

**Request body**

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | 2–150 characters, unique (case-insensitive) |
| `gstin` | string \| null | no | 15-character Indian GSTIN, unique |
| `admin.email` | string | yes | Unique across the whole system |
| `admin.password` | string | yes | 8–128 characters |
| `admin.name` | string | yes | 2–100 characters |

**Example request**

```bash
curl -X POST http://localhost:4000/api/v1/companies \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
        "name": "Sunrise Pharma",
        "gstin": "27AAPFU0939F1ZV",
        "admin": {
          "email": "admin@sunrise.test",
          "password": "password123",
          "name": "Sunrise Admin"
        }
      }'
```

**Success — 201**

```json
{
  "success": true,
  "data": {
    "company": {
      "id": "8f2c1a77-9b21-4a1e-9f3a-6d5b4c3a2b10",
      "name": "Sunrise Pharma",
      "gstin": "27AAPFU0939F1ZV",
      "isActive": true,
      "createdAt": "2026-08-24T10:05:00.000Z",
      "updatedAt": "2026-08-24T10:05:00.000Z"
    },
    "admin": {
      "id": "1a2b3c4d-5e6f-4a7b-8c9d-0e1f2a3b4c5d",
      "email": "admin@sunrise.test",
      "name": "Sunrise Admin",
      "role": "ADMIN",
      "isActive": true,
      "lastLoginAt": null,
      "companyId": "8f2c1a77-9b21-4a1e-9f3a-6d5b4c3a2b10",
      "createdAt": "2026-08-24T10:05:00.000Z",
      "updatedAt": "2026-08-24T10:05:00.000Z"
    }
  },
  "message": "Company created successfully"
}
```

**Errors**

| Status | When |
|---|---|
| 400 | Missing or invalid `name`, missing `admin` block, weak password, malformed GSTIN |
| 401 | Missing or invalid token |
| 403 | Caller is `STAFF` |
| 409 | Company name, GSTIN or admin email already exists |

Nothing is created when the request fails — the company and its admin are written in one
transaction.

---

# Business master data

Eight modules share the same rules, so they are documented once here and then only
their fields are listed below.

| Rule | Behaviour |
|---|---|
| **Authentication** | Required on every endpoint. |
| **Role** | `GET` — `ADMIN` and `STAFF`. `POST` / `PATCH` — `ADMIN` only (403 for `STAFF`). |
| **Tenant** | `companyId` is taken from the authenticated user. Sending `companyId` in a body has no effect. A record of another company returns **404**, exactly as a non-existent one. |
| **Uniqueness** | Always per company. Two companies may use the same category name, SKU, barcode or code. |
| **Deletion** | There is no `DELETE`. Records are deactivated with `PATCH /:id/status` and remain readable. |
| **Money** | Always **strings** in JSON (`"1500.50"`), never floats. Accepted as a string or a number on input. |
| **List query** | `page` (default 1), `limit` (default 20, max 100), `search`, `isActive=true|false`. |
| **List response** | `{ success, data: [...], pagination: { page, limit, total, totalPages } }` |

**Common errors** for every module:

| Status | When |
|---|---|
| 400 | Validation failed (`errors[]` names the field), or a malformed `:id` |
| 401 | Missing or invalid token |
| 403 | `STAFF` attempting a write |
| 404 | Unknown id, or a record belonging to another company |
| 409 | Duplicate value that must be unique within the company |

Each module supports the same five endpoints:

```
GET    /api/v1/<resource>            list, paginated and searchable
GET    /api/v1/<resource>/:id        one record
POST   /api/v1/<resource>            create                      (ADMIN)
PATCH  /api/v1/<resource>/:id        update, at least one field  (ADMIN)
PATCH  /api/v1/<resource>/:id/status { "isActive": boolean }     (ADMIN)
```

---

## Categories — `/api/v1/categories`

Response key: `category`. Search matches name and description.

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | 2–150 chars, unique per company (case-insensitive) |
| `description` | string \| null | no | max 1000 chars |

**Example request**

```bash
curl -X POST http://localhost:4000/api/v1/categories \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{ "name": "Antibiotics", "description": "Antibiotic medicines" }'
```

**Success — 201**

```json
{
  "success": true,
  "data": {
    "category": {
      "id": "9f1c...",
      "name": "Antibiotics",
      "description": "Antibiotic medicines",
      "isActive": true,
      "createdAt": "2026-08-24T10:00:00.000Z",
      "updatedAt": "2026-08-24T10:00:00.000Z"
    }
  },
  "message": "Category created successfully"
}
```

**409** — `{ "success": false, "message": "A category with this name already exists" }`

---

## Units — `/api/v1/units`

Response key: `unit`. Search matches name and short code.
No unit conversion exists in this phase — a unit is a label.

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | 2–50 chars, unique per company |
| `shortCode` | string | yes | 1–10 chars, stored UPPER-CASE, unique per company |

```bash
curl -X POST http://localhost:4000/api/v1/units \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{ "name": "Kilogram", "shortCode": "KG" }'
```

```json
{ "success": true,
  "data": { "unit": { "id": "...", "name": "Kilogram", "shortCode": "KG", "isActive": true } },
  "message": "Unit created successfully" }
```

**409** — separate messages for a duplicate name and a duplicate short code.

---

## Taxes — `/api/v1/taxes`

Response key: `tax`. Extra list filter: `type`. Search matches name.

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | 2–50 chars, unique per company |
| `rate` | string \| number | yes | 0–100, max 2 decimals. Returned as a string: `"18.00"` |
| `type` | `GST` | no | Defaults to `GST` |

```bash
curl -X POST http://localhost:4000/api/v1/taxes \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{ "name": "GST 18%", "rate": "18" }'
```

```json
{ "success": true,
  "data": { "tax": { "id": "...", "name": "GST 18%", "rate": "18.00", "type": "GST", "isActive": true } },
  "message": "Tax created successfully" }
```

This is tax **master data only**. CGST/SGST/IGST splitting, HSN validation,
place of supply and reverse charge are later phases.

---

## Warehouses — `/api/v1/warehouses`

Response key: `warehouse`. Search matches name, code and address.
Master data only — **no stock quantities**.

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | 2–100 chars, unique per company |
| `code` | string | yes | 1–20 chars, UPPER-CASE, unique per company |
| `address` | string \| null | no | max 500 chars |

---

## Products — `/api/v1/products`

Response key: `product`. Search matches name, SKU, barcode and description.

**Extra list filters:** `categoryId`, `unitId`, `taxId` (each a UUID).

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | 2–150 chars |
| `categoryId` | uuid | yes | **must belong to your company** |
| `unitId` | uuid | yes | **must belong to your company** |
| `taxId` | uuid \| null | no | **must belong to your company** when given |
| `sku` | string \| null | no | max 50 chars, UPPER-CASE, unique per company |
| `barcode` | string \| null | no | 4–50 chars, unique per company |
| `description` | string \| null | no | max 1000 chars |
| `purchasePrice` | string \| number | no | default `0`, max 4 decimals |
| `sellingPrice` | string \| number | no | default `0`, max 4 decimals |
| `reorderLevel` | string \| number | no | default `0`, max 6 decimals. A threshold, **not** a stock level |

**Products do not carry stock.** Inventory arrives in a later phase as
Product → Warehouse → InventoryBalance → StockMovement.

```bash
curl -X POST http://localhost:4000/api/v1/products \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{
        "name": "Paracetamol 500mg",
        "sku": "SKU-PARA-500",
        "barcode": "8901234567890",
        "categoryId": "9f1c...",
        "unitId": "2b7e...",
        "taxId": "5d3a...",
        "purchasePrice": "18.50",
        "sellingPrice": "25.00",
        "reorderLevel": "100"
      }'
```

**Success — 201**

```json
{
  "success": true,
  "data": {
    "product": {
      "id": "7c2d...",
      "name": "Paracetamol 500mg",
      "sku": "SKU-PARA-500",
      "barcode": "8901234567890",
      "description": null,
      "purchasePrice": "18.50",
      "sellingPrice": "25.00",
      "reorderLevel": "100.000",
      "category": { "id": "9f1c...", "name": "Tablets" },
      "unit": { "id": "2b7e...", "name": "Strip", "shortCode": "STR" },
      "tax": { "id": "5d3a...", "name": "GST 12%", "rate": "12.00" },
      "isActive": true,
      "createdAt": "2026-08-24T10:00:00.000Z",
      "updatedAt": "2026-08-24T10:00:00.000Z"
    }
  },
  "message": "Product created successfully"
}
```

**400 — cross-company or unknown relationship**

```json
{
  "success": false,
  "message": "Category not found",
  "errors": [ { "field": "body.categoryId", "message": "Category does not exist in this company" } ]
}
```

A category that belongs to **another company** and one that does **not exist** return
an identical response, so the API never confirms that an id exists elsewhere.

**409** — duplicate SKU or duplicate barcode within your company.

---

## Suppliers — `/api/v1/suppliers`

Response key: `supplier`. Search matches name, phone, email and GSTIN.

| Field | Type | Required | Notes |
|---|---|---|---|
| `name` | string | yes | 2–150 chars, unique per company |
| `phone` | string \| null | no | 7–20 chars, digits with optional `+`, spaces, hyphens |
| `email` | string \| null | no | valid email |
| `address` | string \| null | no | max 500 chars |
| `gstin` | string \| null | no | 15-char Indian GSTIN |
| `openingBalance` | string \| number | no | default `0`, returned as `"1500.50"` |
| `creditLimit` | string \| number | no | default `0` |

`openingBalance` is **recorded only**. No payable ledger, purchase or payment
posting exists yet.

```bash
curl -X POST http://localhost:4000/api/v1/suppliers \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{ "name": "Sunrise Distributors", "phone": "9876543210",
        "gstin": "29AAGCB1286Q1ZP", "openingBalance": "2500.75" }'
```

```json
{ "success": true,
  "data": { "supplier": { "id": "...", "name": "Sunrise Distributors", "phone": "9876543210",
    "email": null, "address": null, "gstin": "29AAGCB1286Q1ZP",
    "openingBalance": "2500.75", "creditLimit": "0.00", "isActive": true } },
  "message": "Supplier created successfully" }
```

---

## Customers — `/api/v1/customers`

Response key: `customer`. Identical fields, validation and behaviour to suppliers.
No receivable ledger, sales or payments exist yet.

---

## Company Settings — `/api/v1/company-settings`

Exactly one settings record per company. **There is no `POST`** — settings are created
automatically with the company. If a company predates this feature, the first `GET`
creates its settings from the defaults, so the endpoint always returns a value.

### GET /api/v1/company-settings

- **Authentication:** required
- **Role:** any authenticated user

```json
{
  "success": true,
  "data": {
    "settings": {
      "currency": "INR",
      "timezone": "Asia/Kolkata",
      "dateFormat": "DD/MM/YYYY",
      "invoicePrefix": "INV",
      "purchasePrefix": "PUR",
      "financialYearStartMonth": 4,
      "createdAt": "2026-08-24T10:00:00.000Z",
      "updatedAt": "2026-08-24T10:00:00.000Z"
    }
  }
}
```

### PATCH /api/v1/company-settings

- **Authentication:** required
- **Role:** `ADMIN`

| Field | Type | Notes |
|---|---|---|
| `currency` | string | 3 letters, stored UPPER-CASE |
| `timezone` | string | Any IANA zone, e.g. `Asia/Kolkata` |
| `dateFormat` | enum | `DD/MM/YYYY`, `MM/DD/YYYY`, `YYYY-MM-DD` |
| `invoicePrefix` | string | max 10 chars, `A-Z 0-9 -`, UPPER-CASE |
| `purchasePrefix` | string | same rules |
| `financialYearStartMonth` | integer | 1–12. India defaults to 4 (April) |

At least one field is required. Errors: 400 validation, 401, 403 for `STAFF`.

---

## Defaults created with a new company

`POST /api/v1/companies` creates the company, its first admin, its settings row, and
this default master data, all in one transaction:

**Units:** Piece/PCS, Kilogram/KG, Gram/G, Litre/L, Millilitre/ML, Box/BOX, Pack/PACK, Dozen/DOZ
**Taxes:** GST 0%, GST 5%, GST 12%, GST 18%, GST 28%

These are per-company rows. Renaming or deactivating them affects only that company.

---

# Inventory

Stock is tracked per **product per warehouse**. Two things are recorded for every change:

- the **balance** — current quantity and average cost (what you read)
- the **movement** — an immutable ledger row (why it is that number)

Both are written in one database transaction, so they can never disagree.

| Rule | Behaviour |
|---|---|
| **Authentication** | Required on every endpoint. |
| **Role** | Reads — `ADMIN` and `STAFF`. Writes — `ADMIN` only. |
| **Tenant** | `companyId` comes from the authenticated user. Another company's product, warehouse or movement behaves as if it does not exist. |
| **Immutability** | There is **no** `PUT`, `PATCH` or `DELETE` for movements. Corrections are new compensating movements. |
| **Numbers** | Quantities and money are **strings**. Quantity 3 dp, costs 4 dp, totals 2 dp. |
| **Audit** | `createdById` is taken from the token. Sending it in the body has no effect. |

## Costing: moving weighted average

```
newAverageCost = (oldQty * oldAvgCost + inQty * inUnitCost) / (oldQty + inQty)
```

```
Opening:      100 @ 10.00                        -> qty 100, avg 10.0000
Adjust IN:     50 @ 14.00   (1700 / 150)         -> qty 150, avg 11.3333
Adjust OUT:    50           (valued at 11.3333)  -> qty 100, avg 11.3333 (unchanged)
```

Stock going **out never changes the average cost** of the stock that remains; it is
valued at the current average. FIFO, LIFO and cost layers are not implemented.

## Business error codes

Business failures carry a stable `code` alongside the message:

```json
{ "success": false, "code": "INSUFFICIENT_STOCK", "message": "Insufficient stock: 10.000 available, 15.000 requested" }
```

| Code | Status | Meaning |
|---|---|---|
| `INSUFFICIENT_STOCK` | 422 | The requested quantity exceeds what is in that warehouse. Nothing is changed. |
| `OPENING_STOCK_ALREADY_EXISTS` | 409 | Opening stock was already recorded for this product+warehouse. Use an adjustment. |
| `PRODUCT_INACTIVE` | 422 | The product is deactivated. |
| `WAREHOUSE_INACTIVE` | 422 | The warehouse is deactivated. |

---

## POST /api/v1/inventory/opening-stock

Records the stock a business already had when it started using the system.
**Allowed once per product+warehouse** — a second call is rejected rather than silently
replacing real stock.

- **Authentication:** required · **Role:** `ADMIN`

| Field | Type | Required | Notes |
|---|---|---|---|
| `productId` | uuid | yes | Must exist in your company and be **active** |
| `warehouseId` | uuid | yes | Must exist in your company and be **active** |
| `quantity` | string \| number | yes | Greater than 0, up to 6 decimals |
| `unitCost` | string \| number | yes | 0 or more, up to 4 decimals |
| `notes` | string \| null | no | Max 500 characters |

```bash
curl -X POST http://localhost:4000/api/v1/inventory/opening-stock \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{ "productId": "9f1c...", "warehouseId": "2b7e...",
        "quantity": "100", "unitCost": "10.00", "notes": "Initial stock" }'
```

**Success — 201** (returns the movement that was created)

```json
{
  "success": true,
  "data": {
    "movement": {
      "id": "7c2d...",
      "type": "OPENING_STOCK",
      "product": { "id": "9f1c...", "name": "Paracetamol 500mg", "sku": "SKU-PARA-500" },
      "warehouse": { "id": "2b7e...", "name": "Main Warehouse", "code": "MAIN" },
      "quantity": "100.000",
      "unitCost": "10.0000",
      "totalCost": "1000.00",
      "quantityBefore": "0.000",
      "quantityAfter": "100.000",
      "averageCostBefore": "0.0000",
      "averageCostAfter": "10.0000",
      "referenceType": "OPENING_STOCK",
      "referenceId": null,
      "notes": "Initial stock",
      "createdAt": "2026-08-25T10:00:00.000Z",
      "createdBy": { "id": "4b1f...", "name": "Administrator" }
    }
  },
  "message": "Opening stock recorded successfully"
}
```

**Errors**

| Status | When |
|---|---|
| 400 | Missing/invalid ids, quantity ≤ 0, negative `unitCost` |
| 400 | Product or warehouse belongs to another company (reported as "not found") |
| 401 / 403 | Not authenticated / caller is `STAFF` |
| 409 | `OPENING_STOCK_ALREADY_EXISTS` |
| 422 | `PRODUCT_INACTIVE` / `WAREHOUSE_INACTIVE` |

---

## POST /api/v1/inventory/adjustments

Manual correction: physical count, damage, shrinkage.

- **Authentication:** required · **Role:** `ADMIN`

| Field | Type | Required | Notes |
|---|---|---|---|
| `productId` | uuid | yes | Active, in your company |
| `warehouseId` | uuid | yes | Active, in your company |
| `type` | `ADJUSTMENT_IN` \| `ADJUSTMENT_OUT` | yes | |
| `quantity` | string \| number | yes | Greater than 0 |
| `unitCost` | string \| number | **IN only** | Required for `ADJUSTMENT_IN`; **rejected** for `ADJUSTMENT_OUT` |
| `notes` | string \| null | no | Max 500 characters |

`ADJUSTMENT_OUT` does not accept a `unitCost`: outgoing stock is always valued at the
current average cost, so a client-supplied figure would be misleading.

```bash
# stock in
curl -X POST http://localhost:4000/api/v1/inventory/adjustments \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{ "productId": "9f1c...", "warehouseId": "2b7e...", "type": "ADJUSTMENT_IN",
        "quantity": "50", "unitCost": "14.00", "notes": "Physical count" }'

# stock out
curl -X POST http://localhost:4000/api/v1/inventory/adjustments \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{ "productId": "9f1c...", "warehouseId": "2b7e...", "type": "ADJUSTMENT_OUT",
        "quantity": "5", "notes": "Damaged stock" }'
```

**Success — 201** — same movement shape as above, with
`"message": "Stock adjustment recorded successfully"`.

**Errors** — as opening stock, plus:

| Status | When |
|---|---|
| 400 | `unitCost` missing on `ADJUSTMENT_IN`, or supplied on `ADJUSTMENT_OUT` |
| 422 | `INSUFFICIENT_STOCK` — the balance and the ledger are left untouched |

---

## GET /api/v1/inventory

Current balances for your company.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

| Query | Type | Notes |
|---|---|---|
| `page` | integer | Default 1 |
| `limit` | integer | Default 20, max 100 |
| `productId` | uuid | Filter to one product |
| `warehouseId` | uuid | Filter to one warehouse |

```json
{
  "success": true,
  "data": [
    {
      "id": "5a1b...",
      "product": { "id": "9f1c...", "name": "Paracetamol 500mg", "sku": "SKU-PARA-500" },
      "warehouse": { "id": "2b7e...", "name": "Main Warehouse", "code": "MAIN" },
      "quantity": "150.000",
      "averageCost": "11.3333",
      "inventoryValue": "1700.00",
      "updatedAt": "2026-08-25T10:05:00.000Z"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

`inventoryValue` is `quantity × averageCost`, computed with Decimal arithmetic and
rounded once. Only balances of your own company are ever returned.

---

## GET /api/v1/inventory/:productId/:warehouseId

Stock of one product in one warehouse.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

A product+warehouse that has never had a movement has no balance row. That is **not** an
error — a zero balance is returned, because "no stock" is a valid answer:

```json
{
  "success": true,
  "data": {
    "balance": {
      "id": null,
      "product": { "id": "9f1c...", "name": "Paracetamol 500mg", "sku": "SKU-PARA-500" },
      "warehouse": { "id": "2b7e...", "name": "Main Warehouse", "code": "MAIN" },
      "quantity": "0.000",
      "averageCost": "0.0000",
      "inventoryValue": "0.00",
      "updatedAt": null
    }
  }
}
```

Deactivated products and warehouses **can** still be read here — deactivating a product
must not hide the stock it still holds.

**Errors:** 400 malformed uuid · 401 · 404 when either id is unknown *or belongs to
another company*.

---

## GET /api/v1/inventory/movements

The stock ledger, newest first.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

| Query | Type | Notes |
|---|---|---|
| `page`, `limit` | integer | Default 1 / 20, max 100 |
| `productId`, `warehouseId` | uuid | |
| `type` | enum | `OPENING_STOCK`, `STOCK_IN`, `STOCK_OUT`, `ADJUSTMENT_IN`, `ADJUSTMENT_OUT` |
| `fromDate`, `toDate` | ISO date-time | Filter on `createdAt` |

```bash
curl "http://localhost:4000/api/v1/inventory/movements?productId=9f1c...&type=ADJUSTMENT_IN&fromDate=2026-08-01T00:00:00Z" \
  -H "Authorization: Bearer <token>"
```

Returns the movement objects shown above plus the standard `pagination` block.
`createdBy` exposes only `id` and `name` — never the email or any credential.

**Errors:** 400 invalid `type`, malformed date, `limit` above 100 · 401.

---

## GET /api/v1/inventory/movements/:id

One movement.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`
- **Errors:** 400 malformed uuid · 401 · 404 unknown id or another company's movement.

---

## Movements cannot be edited or deleted

`PUT`, `PATCH` and `DELETE` on `/api/v1/inventory/movements/:id` return **404** — those
routes do not exist, by design. A movement is an audit record.

To correct a mistake, record a compensating movement (an `ADJUSTMENT_OUT` to undo an
`ADJUSTMENT_IN`, for example). Both the error and the correction stay visible in the
ledger.

---

## Not implemented in this phase

Purchases, purchase returns, sales, sales returns, supplier and customer payments,
COGS and accounting entries, stock transfers between warehouses, batch/expiry tracking,
serial numbers, stock reservations, low-stock alerts, and AI document processing.

`STOCK_IN` and `STOCK_OUT` exist in the movement type enum but no endpoint produces them
yet — they are reserved for the purchase and sale services, which will reuse this same
inventory logic rather than writing balances themselves.
---

# Purchases

A purchase is a supplier's bill. It is created as a **draft**, which has **no effect on
stock**, and only moves inventory when it is **posted**.

```
POST /purchases            -> DRAFT      no inventory effect
PATCH /purchases/:id       -> DRAFT      replaces the document, totals recalculated
POST /purchases/:id/post   -> POSTED     stock arrives; document becomes permanent
POST /purchases/:id/cancel -> CANCELLED  drafts only
```

| Rule | Behaviour |
|---|---|
| **Authentication** | Required on every endpoint. |
| **Role** | Reads — `ADMIN` and `STAFF`. Create, edit, post, cancel — `ADMIN` only. |
| **Tenant** | `companyId` comes from the token. Another company's purchase, supplier, warehouse, product or tax behaves as if it does not exist. |
| **Totals** | Always calculated by the server. Totals in the request body are ignored. |
| **Immutability** | A `POSTED` purchase can never be edited or cancelled. |
| **Numbers** | Money and quantities are strings. Quantity 3 dp, costs 4 dp, amounts 2 dp. |
| **Dates** | `invoiceDate` and `dueDate` are business dates: `"2026-08-28"`, never timestamps. |

## Two different numbers

| Field | Whose | Example | Unique per |
|---|---|---|---|
| `purchaseNumber` | ours, generated | `PUR-2026-000001` | company |
| `invoiceNumber` | the supplier's, you supply it | `SUP-INV-1001` | company + **supplier** |

Two different suppliers may both send you "INV-001". The same supplier sending it twice
is rejected as a duplicate bill.

## How totals are calculated

Per line, then summed:

```
gross          = quantity * unitCost
discountAmount = NONE -> 0 | PERCENTAGE -> gross * value/100 | FIXED -> value
taxableAmount  = gross - discountAmount
taxAmount      = taxableAmount * taxRate / 100     <- tax is on the DISCOUNTED amount
lineTotal      = taxableAmount + taxAmount
```

Worked example — 100 units at 10.00, 5% discount, 18% tax:

```
gross          = 1000.00
discountAmount =   50.00
taxableAmount  =  950.00
taxAmount      =  171.00
lineTotal      = 1121.00
```

A `FIXED` discount applies to the whole line and may not exceed it. A `PERCENTAGE`
discount may not exceed 100. Each value is rounded once to 4 dp; purchase totals are the
sum of the already-rounded lines, so lines always add up to the total.

## Business error codes

| Code | Status | Meaning |
|---|---|---|
| `PURCHASE_NOT_FOUND` | 404 | Unknown id, or another company's purchase |
| `PURCHASE_NOT_DRAFT` | 409 | Action needs a draft; this one is posted or cancelled |
| `PURCHASE_ALREADY_POSTED` | 409 | Posting, editing or cancelling something already posted |
| `PURCHASE_HAS_NO_ITEMS` | 422 | Posting a purchase with no lines |
| `DUPLICATE_INVOICE_NUMBER` | 409 | This supplier already has a bill with that number |
| `INVALID_DISCOUNT` | 422 | Discount exceeds the line amount |
| `SUPPLIER_NOT_FOUND` / `SUPPLIER_INACTIVE` | 404 / 422 | |
| `WAREHOUSE_NOT_FOUND` / `WAREHOUSE_INACTIVE` | 404 / 422 | |
| `PRODUCT_NOT_FOUND` / `PRODUCT_INACTIVE` | 404 / 422 | Message names the item number |
| `TAX_NOT_FOUND` / `TAX_INACTIVE` | 404 / 422 | |

---

## POST /api/v1/purchases

Creates a **draft**. **Does not change stock.**

- **Authentication:** required · **Role:** `ADMIN`

| Field | Type | Required | Notes |
|---|---|---|---|
| `supplierId` | uuid | yes | Your company, active |
| `warehouseId` | uuid | yes | Your company, active. Where the stock will land on posting |
| `invoiceNumber` | string | yes | The supplier's bill number, max 50 chars |
| `invoiceDate` | `YYYY-MM-DD` | yes | |
| `dueDate` | `YYYY-MM-DD` \| null | no | Cannot be before `invoiceDate` |
| `notes` | string \| null | no | Max 1000 chars |
| `items` | array | yes | 1–500 lines, one line per product |

Each item:

| Field | Type | Required | Notes |
|---|---|---|---|
| `productId` | uuid | yes | Your company, active. **A product may appear only once** |
| `taxId` | uuid \| null | no | Your company, active. Omit for an untaxed line |
| `quantity` | string \| number | yes | Greater than 0 |
| `unitCost` | string \| number | yes | The price **on the bill**, not the product's master price. 0 is allowed (free goods) |
| `discountType` | `NONE` \| `PERCENTAGE` \| `FIXED` | no | Defaults to `NONE` |
| `discountValue` | string \| number | when type ≠ NONE | |

`companyId`, `purchaseNumber` and all totals are server-controlled and ignored if sent.

```bash
curl -X POST http://localhost:4000/api/v1/purchases \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{
        "supplierId": "9f1c...", "warehouseId": "2b7e...",
        "invoiceNumber": "SUP-INV-1001",
        "invoiceDate": "2026-08-28", "dueDate": "2026-09-27",
        "notes": "Monthly stock purchase",
        "items": [{
          "productId": "7c2d...", "taxId": "5d3a...",
          "quantity": "100", "unitCost": "10.00",
          "discountType": "PERCENTAGE", "discountValue": "5"
        }]
      }'
```

**Success — 201**

```json
{
  "success": true,
  "data": {
    "purchase": {
      "id": "3e8a...",
      "purchaseNumber": "PUR-2026-000001",
      "invoiceNumber": "SUP-INV-1001",
      "status": "DRAFT",
      "supplier": { "id": "9f1c...", "name": "ABC Distributors", "currentName": "ABC Distributors" },
      "warehouse": { "id": "2b7e...", "name": "Main Warehouse", "code": "MAIN" },
      "invoiceDate": "2026-08-28",
      "dueDate": "2026-09-27",
      "items": [
        {
          "id": "aa11...", "lineNumber": 1,
          "productId": "7c2d...", "productName": "Paracetamol 500mg", "sku": "SKU-PARA-500",
          "unitName": "STR", "taxId": "5d3a...", "taxName": "GST 18%", "taxRate": "18.00",
          "quantity": "100.000", "unitCost": "10.0000",
          "discountType": "PERCENTAGE", "discountValue": "5.0000", "discountAmount": "50.00",
          "taxableAmount": "950.00", "taxAmount": "171.00", "lineTotal": "1121.00"
        }
      ],
      "subtotal": "1000.00", "discountTotal": "50.00",
      "taxTotal": "171.00", "grandTotal": "1121.00",
      "notes": "Monthly stock purchase",
      "createdBy": { "id": "4b1f...", "name": "Administrator" },
      "postedBy": null, "postedAt": null,
      "cancelledBy": null, "cancelledAt": null
    }
  },
  "message": "Purchase draft created successfully"
}
```

`productName`, `sku`, `unitName`, `taxName` and `taxRate` are **snapshots** taken when
the line was entered, so renaming a product later does not change historical bills.
`supplier.name` is the snapshot; `supplier.currentName` is the live value.

**Errors:** 400 validation (empty items, quantity ≤ 0, negative cost, duplicate product,
`dueDate` before `invoiceDate`, percentage > 100) · 401 · 403 for `STAFF` ·
404/409/422 with the codes above.

---

## PATCH /api/v1/purchases/:id

Replaces a **draft** and recalculates every total.

- **Authentication:** required · **Role:** `ADMIN`

Takes the **same complete body** as create, including the full `items` array — there is
no per-line patching. Lines are replaced wholesale; `purchaseNumber` never changes.

**Errors:** as create, plus **409 `PURCHASE_ALREADY_POSTED`** when the purchase is
posted, and 404 for another company's purchase.

---

## POST /api/v1/purchases/:id/post

**The only endpoint that changes stock.** Everything below happens in one transaction:

1. The purchase row is locked, and must still be `DRAFT`.
2. Supplier, warehouse, every product and every tax are re-checked — they must still
   exist and still be active. A master record deactivated after the draft was created
   makes posting fail.
3. Each line creates a `STOCK_IN` movement in the purchase's warehouse, at the line's
   `unitCost`, through the inventory service — so the moving weighted average is
   recalculated by the same code a manual adjustment uses.
4. The purchase becomes `POSTED` with `postedBy` and `postedAt`.

If any step fails, **everything** rolls back: no movement, no balance change, and the
purchase stays a draft.

- **Authentication:** required · **Role:** `ADMIN` · **Body:** none

```bash
curl -X POST http://localhost:4000/api/v1/purchases/3e8a.../post \
  -H "Authorization: Bearer <token>"
```

**Success — 200** — the purchase with `"status": "POSTED"`, `postedBy` and `postedAt`
set, and `"message": "Purchase posted successfully"`.

Stock effect for the example above — 100 units at 10.00 into a warehouse that already
held 100 at 10.00 would give 200 at 10.0000. Buying 50 at 14.00 on top of 100 at 10.00
gives 150 at **11.3333**.

**Errors**

| Status | Code | When |
|---|---|---|
| 404 | `PURCHASE_NOT_FOUND` | Unknown, or another company's |
| 409 | `PURCHASE_ALREADY_POSTED` | Posted already — including the loser of two simultaneous requests |
| 409 | `PURCHASE_NOT_DRAFT` | Cancelled |
| 422 | `PURCHASE_HAS_NO_ITEMS` | No lines |
| 422 | `*_INACTIVE` | A referenced master record was deactivated after the draft was created |

**Concurrency:** posting the same purchase twice at the same moment results in exactly
one success and one 409. Stock is never counted twice.

---

## POST /api/v1/purchases/:id/cancel

Cancels a **draft**.

- **Authentication:** required · **Role:** `ADMIN` · **Body:** none

**A posted purchase cannot be cancelled** — 409 `PURCHASE_ALREADY_POSTED`. Reversing a
posted bill would have to reverse stock that may already have been sold. Use a
**purchase return** instead (documented below).

**Success — 200** — the purchase with `"status": "CANCELLED"`, `cancelledBy` and
`cancelledAt` set. A cancelled purchase can no longer be edited or posted.

---

## GET /api/v1/purchases

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

| Query | Type | Notes |
|---|---|---|
| `page`, `limit` | integer | Default 1 / 20, max 100 |
| `search` | string | Matches purchase number, supplier invoice number and supplier name |
| `supplierId`, `warehouseId` | uuid | |
| `status` | `DRAFT` \| `POSTED` \| `CANCELLED` | |
| `fromDate`, `toDate` | `YYYY-MM-DD` | Filter on `invoiceDate` |

Returns purchases newest first, with the standard `pagination` block. **Item lines are
omitted from the list** — fetch one purchase to see them.

---

## GET /api/v1/purchases/:id

One purchase with all of its lines.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`
- **Errors:** 400 malformed uuid · 401 · 404 unknown id or another company's purchase.

---

## Supplier payable

Posting a purchase raises a **supplier payable** and a ledger entry automatically - see
the Supplier Payables section below.

`Supplier.openingBalance` is **not** modified by posting — it is master data describing
the balance carried in when the business started, not a running total.

---

## Not implemented in this phase

Purchase returns, supplier payments and payment allocation, payable ledger, sales,
accounting and journal entries, COGS, GST component splitting, and AI bill extraction.

The AI phase will not get a special path: it will create ordinary drafts through
`POST /purchases`, a human will verify them, and posting will go through the same
endpoint documented here.
---

# Purchase Returns

Goods sent back to a supplier. A return **references a posted purchase and never changes
it**. Like a purchase, it is a draft first and only moves stock when posted.

```
POST /purchase-returns             -> DRAFT      no stock effect
PATCH /purchase-returns/:id        -> DRAFT      replaces the document
POST /purchase-returns/:id/post    -> POSTED     stock leaves; document permanent
POST /purchase-returns/:id/cancel  -> CANCELLED  drafts only
```

| Rule | Behaviour |
|---|---|
| **Authentication** | Required on every endpoint. |
| **Role** | Read, create and edit drafts — `ADMIN` and `STAFF`. **Post and cancel — `ADMIN` only.** |
| **Tenant** | Another company's return, purchase or purchase line behaves as if it does not exist. |
| **Cost** | Always the unit cost from the original purchase line. Never the product master price, never today's average, never a client-supplied value. |
| **Warehouse** | Always the purchase's warehouse. A `warehouseId` in the body is ignored. |
| **Immutability** | A `POSTED` return can never be edited or cancelled, and the original purchase is never modified. |

## What you may send

The client sends only which purchase, which lines, how much, and why. Everything else is
derived: `companyId`, `warehouseId`, `productId`, `unitCost`, `lineTotal`, `grandTotal`,
`returnNumber` and `createdById`. Sending any of them has no effect.

## How much can still be returned

```
remaining = purchased quantity − sum of quantities on POSTED returns
```

**Only posted returns count.** Two drafts may each ask for the last 20 units; the first
one posted wins and the second fails at posting. Use
`GET /purchase-returns/returnable/:purchaseId` to see the live numbers.

A return must also not exceed **current stock** in that warehouse — you cannot send back
goods you no longer hold.

## Costing

A return leaves stock at the **original purchase cost**, and the average cost of the
remaining stock is **unchanged**:

```
Purchase 1:  100 @ 80        -> qty 100, avg 80.0000
Purchase 2:  100 @ 120       -> qty 200, avg 100.0000
Return 10 against purchase 1 -> movement unitCost 80.0000, qty 190, avg 100.0000
```

## Business error codes

| Code | Status | Meaning |
|---|---|---|
| `PURCHASE_RETURN_NOT_FOUND` | 404 | Unknown id, or another company's return |
| `PURCHASE_NOT_FOUND` | 404 | Unknown purchase, or another company's |
| `PURCHASE_ITEM_NOT_FOUND` | 404 | That line does not belong to this purchase |
| `PURCHASE_NOT_POSTED` | 422 | The purchase is still a draft, or cancelled |
| `PURCHASE_RETURN_EXCEEDS_PURCHASE_QTY` | 422 | More than what remains returnable |
| `PURCHASE_RETURN_INSUFFICIENT_STOCK` | 422 | More than is currently in the warehouse |
| `PURCHASE_RETURN_HAS_NO_ITEMS` | 422 | Posting a return with no lines |
| `PURCHASE_RETURN_PURCHASE_IMMUTABLE` | 422 | Editing a draft onto a different purchase |
| `PURCHASE_RETURN_ALREADY_POSTED` | 409 | Posting, editing or cancelling a posted return |
| `PURCHASE_RETURN_NOT_POSTABLE` | 409 | The return is cancelled |

---

## POST /api/v1/purchase-returns

Creates a **draft**. **Does not change stock.**

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

| Field | Type | Required | Notes |
|---|---|---|---|
| `purchaseId` | uuid | yes | Must be a **POSTED** purchase in your company |
| `returnDate` | `YYYY-MM-DD` | yes | A business date |
| `reason` | string \| null | no | Max 200 chars, e.g. "Damaged in transit" |
| `notes` | string \| null | no | Max 1000 chars |
| `items` | array | yes | 1–500 lines |

Each item:

| Field | Type | Required | Notes |
|---|---|---|---|
| `purchaseItemId` | uuid | yes | A line of **that** purchase. Each line may appear only once |
| `quantity` | string \| number | yes | > 0, and ≤ what remains returnable |

```bash
curl -X POST http://localhost:4000/api/v1/purchase-returns \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{
        "purchaseId": "3e8a...",
        "returnDate": "2026-08-30",
        "reason": "Damaged in transit",
        "items": [ { "purchaseItemId": "aa11...", "quantity": "20" } ]
      }'
```

**Success — 201**

```json
{
  "success": true,
  "data": {
    "purchaseReturn": {
      "id": "6f3b...",
      "returnNumber": "PR-2026-000001",
      "status": "DRAFT",
      "returnDate": "2026-08-30",
      "reason": "Damaged in transit",
      "notes": null,
      "grandTotal": "1600.00",
      "purchase": {
        "id": "3e8a...",
        "purchaseNumber": "PUR-2026-000001",
        "invoiceNumber": "SUP-INV-1001",
        "status": "POSTED",
        "supplier": { "id": "9f1c...", "name": "ABC Distributors" }
      },
      "warehouse": { "id": "2b7e...", "name": "Main Warehouse", "code": "MAIN" },
      "items": [
        {
          "id": "bb22...", "lineNumber": 1,
          "purchaseItemId": "aa11...", "productId": "7c2d...",
          "productName": "Paracetamol 500mg", "sku": "SKU-PARA-500",
          "quantity": "20.000", "unitCost": "80.0000", "lineTotal": "1600.00"
        }
      ],
      "createdBy": { "id": "4b1f...", "name": "Administrator" },
      "postedBy": null, "postedAt": null,
      "cancelledBy": null, "cancelledAt": null
    }
  },
  "message": "Purchase return draft created successfully"
}
```

`unitCost` came from the original purchase line — the product master price is irrelevant.

**Errors:** 400 validation (empty items, quantity ≤ 0, duplicate `purchaseItemId`,
malformed date/uuid) · 401 · 404 / 422 with the codes above.

---

## PATCH /api/v1/purchase-returns/:id

Replaces a **draft** and recalculates the total. Takes the same complete body as create,
including the full `items` array.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

`purchaseId` must match the return's existing purchase — a return cannot be moved to a
different purchase (`PURCHASE_RETURN_PURCHASE_IMMUTABLE`). Cancel it and create a new one.

**Errors:** as create, plus 409 `PURCHASE_RETURN_ALREADY_POSTED`, and 404 for another
company's return.

---

## POST /api/v1/purchase-returns/:id/post

**The only endpoint that changes stock.** One transaction covers all of it:

1. The return is locked and must still be `DRAFT`.
2. The parent purchase is locked, so competing returns serialise.
3. Unit costs are re-read from the purchase, and remaining quantities re-checked.
4. Per line: the balance is locked, stock must be sufficient, then a `STOCK_OUT`
   movement is created at the **original purchase cost**.
5. The return becomes `POSTED` with `postedBy` and `postedAt`.

If any line fails, **everything** rolls back — no movement, no balance change, and the
return stays a draft.

- **Authentication:** required · **Role:** `ADMIN` · **Body:** none

```bash
curl -X POST http://localhost:4000/api/v1/purchase-returns/6f3b.../post \
  -H "Authorization: Bearer <token>"
```

**Success — 200** — the return with `"status": "POSTED"`, and
`"message": "Purchase return posted successfully"`.

The resulting stock movement carries `referenceType: "PURCHASE_RETURN"` and
`referenceId` of the return, so it is traceable from
`GET /api/v1/inventory/movements`.

**Errors**

| Status | Code |
|---|---|
| 404 | `PURCHASE_RETURN_NOT_FOUND` |
| 409 | `PURCHASE_RETURN_ALREADY_POSTED` — including the loser of two simultaneous posts |
| 409 | `PURCHASE_RETURN_NOT_POSTABLE` — cancelled |
| 422 | `PURCHASE_RETURN_EXCEEDS_PURCHASE_QTY` — another return was posted first |
| 422 | `PURCHASE_RETURN_INSUFFICIENT_STOCK` |

**Concurrency:** posting the same return twice at once yields exactly one success. Two
different returns competing for the same remaining quantity yield exactly one success and
one 422 — stock is never over-returned and never goes negative.

---

## POST /api/v1/purchase-returns/:id/cancel

Cancels a **draft**.

- **Authentication:** required · **Role:** `ADMIN` · **Body:** none

A posted return cannot be cancelled (409) — reversing it would put back stock that may
already have been consumed.

---

## GET /api/v1/purchase-returns

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

| Query | Type | Notes |
|---|---|---|
| `page`, `limit` | integer | Default 1 / 20, max 100 |
| `search` | string | Return number, purchase number, supplier invoice number, supplier name, reason |
| `purchaseId`, `warehouseId` | uuid | |
| `status` | `DRAFT` \| `POSTED` \| `CANCELLED` | |
| `fromDate`, `toDate` | `YYYY-MM-DD` | Filter on `returnDate` |

Newest first, with the standard `pagination` block. **Item lines are omitted from the
list** — fetch one return to see them.

---

## GET /api/v1/purchase-returns/:id

One return with all of its lines.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`
- **Errors:** 400 malformed uuid · 401 · 404 unknown or another company's return.

---

## GET /api/v1/purchase-returns/returnable/:purchaseId

What is still returnable on each line of a purchase — everything a return form needs.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

```json
{
  "success": true,
  "data": {
    "returnable": {
      "purchaseId": "3e8a...",
      "purchaseNumber": "PUR-2026-000001",
      "status": "POSTED",
      "warehouse": { "id": "2b7e...", "name": "Main Warehouse" },
      "lines": [
        {
          "purchaseItemId": "aa11...",
          "productId": "7c2d...",
          "productName": "Paracetamol 500mg",
          "sku": "SKU-PARA-500",
          "unitCost": "80.0000",
          "purchasedQuantity": "100.000",
          "returnedQuantity": "20.000",
          "remainingQuantity": "80.000"
        }
      ]
    }
  }
}
```

`returnedQuantity` counts **posted** returns only. **Errors:** 401 · 404
`PURCHASE_NOT_FOUND`.

---

## Not implemented in this phase

Tax or discount reversal on returns (a return is a pure cost reversal), supplier debit
notes, refunds and payments, accounting entries for the returned value, sales and sales
returns, and AI bill processing.
---

# Supplier Payables, Ledger and Payments

> An **operational supplier sub-ledger**, not double-entry accounting. It tracks what you
> owe each supplier and against which bills. No general ledger, journal entries or GST
> accounting exist yet.

Nothing here is created by hand. Payables and ledger entries appear as a side effect of
posting documents:

| Event | Effect |
|---|---|
| Purchase posted | Raises a payable for the bill total, and a **credit** ledger entry |
| Purchase return posted | **Reduces** that purchase's payable, and a **debit** ledger entry |
| Supplier payment posted | Reduces the allocated bills, and a **debit** ledger entry for the full amount |

Drafts and cancelled documents change nothing.

## Sign convention

From the supplier account's side:

- **CREDIT** increases what we owe (a purchase).
- **DEBIT** reduces what we owe (a payment or a return).
- `balance = credits − debits`. **Positive = we owe the supplier.** Negative = we are in
  credit with them (an advance).

## Business error codes

| Code | Status | Meaning |
|---|---|---|
| `SUPPLIER_PAYABLE_NOT_FOUND` | 404 | Unknown payable, or another company's |
| `SUPPLIER_PAYMENT_NOT_FOUND` | 404 | Unknown payment, or another company's |
| `SUPPLIER_NOT_FOUND` | 404 | Unknown supplier, or another company's |
| `SUPPLIER_INACTIVE` | 422 | The supplier is deactivated |
| `PAYMENT_EXCEEDS_OUTSTANDING` | 422 | Allocations exceed the payment, or a bill's outstanding at posting time |
| `PAYMENT_ALLOCATION_EXCEEDS_PAYABLE` | 422 | One allocation is larger than that bill's outstanding |
| `INVALID_PAYMENT_ALLOCATION` | 422 | A bill in the payment belongs to a different supplier |
| `SUPPLIER_PAYMENT_ALREADY_POSTED` | 409 | Posting, editing or cancelling a posted payment |
| `SUPPLIER_PAYMENT_NOT_POSTABLE` | 409 | The payment is cancelled |
| `SUPPLIER_PAYMENT_SUPPLIER_IMMUTABLE` | 422 | Editing a draft onto a different supplier |

---

## GET /api/v1/supplier-payables

Bills raised by posted purchases.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

| Query | Type | Notes |
|---|---|---|
| `page`, `limit` | integer | Default 1 / 20, max 100 |
| `supplierId` | uuid | |
| `status` | `OPEN` \| `PARTIALLY_PAID` \| `PAID` \| `CREDITED` | |
| `onlyOutstanding` | `true` \| `false` | Only bills with money still owed |
| `dueDateFrom`, `dueDateTo` | `YYYY-MM-DD` | |

**Success — 200**

```json
{
  "success": true,
  "data": [
    {
      "id": "b1c2...",
      "supplier": { "id": "9f1c...", "name": "ABC Distributors" },
      "purchase": {
        "id": "3e8a...", "purchaseNumber": "PUR-2026-000001",
        "invoiceNumber": "SUP-INV-1001", "invoiceDate": "2026-08-28"
      },
      "originalAmount": "100000.00",
      "creditAmount": "20000.00",
      "paidAmount": "40000.00",
      "outstandingAmount": "40000.00",
      "dueDate": "2026-09-27",
      "status": "PARTIALLY_PAID"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

`outstandingAmount = originalAmount − creditAmount − paidAmount`, never below zero.

---

## GET /api/v1/supplier-payables/:id

One payable. **Errors:** 400 malformed uuid · 401 · 404 `SUPPLIER_PAYABLE_NOT_FOUND`.

---

## GET /api/v1/suppliers/:supplierId/ledger

Every entry for a supplier in date order, with a running balance.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

| Query | Type | Notes |
|---|---|---|
| `fromDate` | `YYYY-MM-DD` | Everything before it is collapsed into `openingBalance` |
| `toDate` | `YYYY-MM-DD` | |

```bash
curl "http://localhost:4000/api/v1/suppliers/9f1c.../ledger?fromDate=2026-08-01" \
  -H "Authorization: Bearer <token>"
```

**Success — 200**

```json
{
  "success": true,
  "data": {
    "ledger": {
      "supplier": { "id": "9f1c...", "name": "ABC Distributors" },
      "openingBalance": "0.00",
      "entries": [
        {
          "id": "e1...", "date": "2026-08-01", "type": "PURCHASE",
          "referenceType": "PURCHASE", "referenceId": "3e8a...",
          "payableId": "b1c2...", "description": "Purchase PUR-2026-000001",
          "debit": "0.00", "credit": "100000.00", "balance": "100000.00",
          "createdBy": { "id": "4b1f...", "name": "Administrator" }
        },
        {
          "id": "e2...", "date": "2026-08-05", "type": "PAYMENT",
          "referenceType": "SUPPLIER_PAYMENT", "referenceId": "p1...",
          "payableId": null, "description": "Payment PAY-2026-000001",
          "debit": "40000.00", "credit": "0.00", "balance": "60000.00"
        },
        {
          "id": "e3...", "date": "2026-08-10", "type": "PURCHASE_RETURN",
          "debit": "10000.00", "credit": "0.00", "balance": "50000.00"
        }
      ],
      "closingBalance": "50000.00"
    }
  }
}
```

**Errors:** 400 malformed uuid or date · 401 · 404 `SUPPLIER_NOT_FOUND`.

---

## GET /api/v1/suppliers/:supplierId/outstanding

A supplier's position at a glance.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

```json
{
  "success": true,
  "data": {
    "outstanding": {
      "supplier": { "id": "9f1c...", "name": "ABC Distributors" },
      "totalPurchases": "100000.00",
      "totalReturns": "10000.00",
      "totalPayments": "60000.00",
      "outstandingAmount": "30000.00",
      "billOutstanding": "30000.00",
      "unallocatedCredit": "0.00"
    }
  }
}
```

- `outstandingAmount` — derived from the ledger: purchases − returns − payments. Negative
  means you are in credit with the supplier.
- `billOutstanding` — the sum of what is still open on individual bills.
- `unallocatedCredit` — the difference, i.e. money paid that is not yet applied to a bill.

**Errors:** 401 · 404 `SUPPLIER_NOT_FOUND`.

---

## GET /api/v1/suppliers/:supplierId/payables

Bills for that supplier that still owe money, oldest due first. Useful for building a
payment screen. Returns the payable objects shown above under `data.payables`.

---

## POST /api/v1/supplier-payments

Creates a **draft** payment. Settles nothing until posted.

- **Authentication:** required · **Role:** `ADMIN`

| Field | Type | Required | Notes |
|---|---|---|---|
| `supplierId` | uuid | yes | Your company, active |
| `paymentDate` | `YYYY-MM-DD` | yes | |
| `amount` | string \| number | yes | Greater than 0 |
| `paymentMethod` | `CASH` \| `BANK_TRANSFER` \| `UPI` \| `CHEQUE` \| `OTHER` | yes | |
| `referenceNumber` | string \| null | no | Max 100 chars, e.g. a UTR |
| `notes` | string \| null | no | Max 1000 chars |
| `allocations` | array | no | Defaults to `[]` — a payment with none is an advance |

Each allocation: `payableId` (uuid, that supplier's bill, each bill once) and `amount`
(> 0, not more than that bill's outstanding).

`companyId`, `createdById`, `paymentNumber`, `allocatedAmount` and `unallocatedAmount` are
server-derived and ignored if sent.

```bash
curl -X POST http://localhost:4000/api/v1/supplier-payments \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{
        "supplierId": "9f1c...", "paymentDate": "2026-09-01",
        "amount": "60000.00", "paymentMethod": "BANK_TRANSFER",
        "referenceNumber": "UTR123456",
        "allocations": [
          { "payableId": "b1c2...", "amount": "50000.00" },
          { "payableId": "b3d4...", "amount": "10000.00" }
        ]
      }'
```

**Success — 201**

```json
{
  "success": true,
  "data": {
    "payment": {
      "id": "p1...",
      "paymentNumber": "PAY-2026-000001",
      "status": "DRAFT",
      "supplier": { "id": "9f1c...", "name": "ABC Distributors" },
      "paymentDate": "2026-09-01",
      "amount": "60000.00",
      "allocatedAmount": "60000.00",
      "unallocatedAmount": "0.00",
      "paymentMethod": "BANK_TRANSFER",
      "referenceNumber": "UTR123456",
      "notes": null,
      "allocations": [
        {
          "id": "a1...", "payableId": "b1c2...",
          "purchase": { "id": "3e8a...", "purchaseNumber": "PUR-2026-000001", "invoiceNumber": "SUP-INV-1001" },
          "amount": "50000.00", "payableOutstandingAmount": "100000.00"
        }
      ],
      "createdBy": { "id": "4b1f...", "name": "Administrator" },
      "postedBy": null, "postedAt": null
    }
  },
  "message": "Supplier payment draft created successfully"
}
```

**Errors:** 400 validation (amount ≤ 0, unknown method, malformed date, duplicate
`payableId`) · 401 · 403 for `STAFF` · 404 / 422 with the codes above.

---

## PATCH /api/v1/supplier-payments/:id

Replaces a **draft**. Same complete body as create, including the full `allocations`
array. `supplierId` must match the payment's existing supplier.

- **Authentication:** required · **Role:** `ADMIN`
- **Errors:** as create, plus 409 `SUPPLIER_PAYMENT_ALREADY_POSTED`, 422
  `SUPPLIER_PAYMENT_SUPPLIER_IMMUTABLE`, 404 for another company's payment.

---

## POST /api/v1/supplier-payments/:id/post

**The only endpoint that moves a balance.** One transaction:

1. The payment is locked and must still be `DRAFT`.
2. Each allocated payable is locked, in id order.
3. Each allocation is re-checked against the bill's **current** outstanding — a draft
   prepared earlier fails if the bill has since been settled.
4. Each bill's `paidAmount`, `outstandingAmount` and `status` are recomputed.
5. One ledger entry is written for the **full** payment amount.
6. The payment becomes `POSTED`.

If any allocation fails, **everything** rolls back — no bill changes, no ledger entry, and
the payment stays a draft.

- **Authentication:** required · **Role:** `ADMIN` · **Body:** none

**Success — 200** — the payment with `"status": "POSTED"`, `postedBy`, `postedAt`, and the
final `allocatedAmount` / `unallocatedAmount` split.

**Errors**

| Status | Code |
|---|---|
| 404 | `SUPPLIER_PAYMENT_NOT_FOUND` |
| 409 | `SUPPLIER_PAYMENT_ALREADY_POSTED` — including the loser of two simultaneous posts |
| 409 | `SUPPLIER_PAYMENT_NOT_POSTABLE` — cancelled |
| 422 | `PAYMENT_EXCEEDS_OUTSTANDING` — a bill has less left than the allocation |
| 422 | `INVALID_PAYMENT_ALLOCATION` — a bill belongs to a different supplier |

**Concurrency:** posting the same payment twice at once yields exactly one success. Five
different payments each allocating the same last 10,000 yield one success and four
422s — outstanding never goes negative and no bill is paid twice.

---

## POST /api/v1/supplier-payments/:id/cancel

Cancels a **draft**. A posted payment cannot be cancelled (409).

- **Authentication:** required · **Role:** `ADMIN` · **Body:** none

---

## GET /api/v1/supplier-payments

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

| Query | Type | Notes |
|---|---|---|
| `page`, `limit` | integer | Default 1 / 20, max 100 |
| `search` | string | Payment number, reference number, supplier name |
| `supplierId` | uuid | |
| `status` | `DRAFT` \| `POSTED` \| `CANCELLED` | |
| `paymentMethod` | enum | |
| `fromDate`, `toDate` | `YYYY-MM-DD` | Filter on `paymentDate` |

Newest first, with the standard `pagination` block. **Allocations are omitted from the
list** — fetch one payment to see them.

---

## GET /api/v1/supplier-payments/:id

One payment with its allocations. **Errors:** 400 · 401 · 404.

---

## Supplier advances

A payment may allocate less than its amount — or nothing at all. The remainder is an
advance held with that supplier:

```
Supplier owes nothing.  Pay 20000 with no allocations.
  -> payment.unallocatedAmount = "20000.00"
  -> supplier outstandingAmount = "-20000.00"   (we are in credit)
  -> unallocatedCredit = "20000.00"
```

**Limitation:** an existing advance cannot yet be applied to a *later* bill — that needs
an allocation endpoint operating on an already-posted payment. Allocate at payment time
until then.

---

## Not implemented in this phase

General ledger, chart of accounts, journal entries, trial balance, P&L, balance sheet, GST
and input-tax-credit accounting, bank reconciliation, TDS, payment gateways, banking APIs,
customer receivables and customer payments, and reversal of posted payments.
---

# Sales, Customer Receivables and Customer Payments

The mirror of purchases and supplier payables. A sales invoice is a draft first
and only moves stock and money when posted.

```
POST /sales             -> DRAFT      no stock, no receivable
PATCH /sales/:id        -> DRAFT      replaces the document
POST /sales/:id/post    -> POSTED     stock out, COGS frozen, receivable raised
POST /sales/:id/cancel  -> CANCELLED  drafts only
```

| Rule | Behaviour |
|---|---|
| **Authentication** | Required on every endpoint. |
| **Role** | Sales — read/create/edit drafts: `ADMIN` and `STAFF`; post/cancel: `ADMIN`. Customer payments — read: both; everything else: `ADMIN`. |
| **Tenant** | `companyId` comes from the token. Another company's record behaves as if it does not exist. |
| **Totals** | Always calculated by the server. Totals in the request body are ignored. |
| **Immutability** | A `POSTED` invoice or payment can never be edited or cancelled. |
| **Numbers** | Money and quantities are strings. Money 2 dp, prices/costs 4 dp, quantities 3 dp. |
| **Dates** | `invoiceDate`, `dueDate`, `paymentDate` are business dates: `"2026-09-01"`. |

## Selling price is not cost

`unitPrice` is what the customer pays. **COGS** is what the goods cost, taken
from the inventory moving average at the moment of posting and **frozen** on the
line forever:

```
Stock 100 @ 80.  Sell 10 @ 120.
  revenue 1200,  COGS 800,  margin 400
Later buy 100 @ 200 (average rises to 140) — the posted invoice still shows COGS 800.
```

`grossMargin` = `subtotal − discountTotal − cogsTotal`, derived on read.

## Customer ledger sign convention

- **DEBIT** increases what the customer owes (a sale).
- **CREDIT** reduces it (a payment).
- `balance = debits − credits`. **Positive = they owe us.** Negative = we hold
  their credit.

(This is the opposite direction to the supplier ledger, which is correct: a
customer is a debtor, a supplier a creditor.)

## Business error codes

| Code | Status | Meaning |
|---|---|---|
| `SALE_NOT_FOUND` | 404 | Unknown invoice, or another company's |
| `SALE_NOT_DRAFT` | 409 | Action needs a draft; this one is posted or cancelled |
| `SALE_ALREADY_POSTED` | 409 | Posting, editing or cancelling a posted invoice |
| `SALE_HAS_NO_ITEMS` | 422 | Posting an invoice with no lines |
| `SALE_INSUFFICIENT_STOCK` | 422 | Not enough stock in that warehouse |
| `INVALID_DISCOUNT` | 422 | Discount exceeds the line amount |
| `CUSTOMER_NOT_FOUND` / `CUSTOMER_INACTIVE` | 404 / 422 | |
| `WAREHOUSE_NOT_FOUND` / `WAREHOUSE_INACTIVE` | 404 / 422 | |
| `PRODUCT_NOT_FOUND` / `PRODUCT_INACTIVE` | 404 / 422 | Message names the item number |
| `TAX_NOT_FOUND` / `TAX_INACTIVE` | 404 / 422 | |
| `CUSTOMER_RECEIVABLE_NOT_FOUND` | 404 | Unknown receivable, or another company's |
| `CUSTOMER_PAYMENT_NOT_FOUND` | 404 | |
| `CUSTOMER_PAYMENT_ALREADY_POSTED` | 409 | |
| `CUSTOMER_PAYMENT_NOT_POSTABLE` | 409 | The payment is cancelled |
| `CUSTOMER_PAYMENT_CUSTOMER_IMMUTABLE` | 422 | Editing a draft onto a different customer |
| `PAYMENT_EXCEEDS_OUTSTANDING` | 422 | Allocations exceed the payment, or an invoice's outstanding at posting |
| `PAYMENT_ALLOCATION_EXCEEDS_RECEIVABLE` | 422 | One allocation is larger than that invoice's outstanding |
| `INVALID_PAYMENT_ALLOCATION` | 422 | The invoice belongs to a different customer, or is not posted |

---

## POST /api/v1/sales

Creates a **draft**. **Does not change stock or any balance.**

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

| Field | Type | Required | Notes |
|---|---|---|---|
| `customerId` | uuid | yes | Your company, active |
| `warehouseId` | uuid | yes | Your company, active. Where the stock leaves from |
| `invoiceDate` | `YYYY-MM-DD` | yes | |
| `dueDate` | `YYYY-MM-DD` \| null | no | Cannot be before `invoiceDate` |
| `notes` | string \| null | no | Max 1000 chars |
| `items` | array | yes | 1–500 lines, one line per product |

Each item:

| Field | Type | Required | Notes |
|---|---|---|---|
| `productId` | uuid | yes | Your company, active. **A product may appear only once** |
| `taxId` | uuid \| null | no | Omit for an untaxed line |
| `quantity` | string \| number | yes | Greater than 0 |
| `unitPrice` | string \| number | yes | 0 allowed (free goods) |
| `discountType` | `NONE` \| `PERCENTAGE` \| `FIXED` | no | Defaults to `NONE` |
| `discountValue` | string \| number | when type ≠ NONE | |

`companyId`, `invoiceNumber`, COGS and all totals are server-controlled.

```bash
curl -X POST http://localhost:4000/api/v1/sales \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{
        "customerId": "9f1c...", "warehouseId": "2b7e...",
        "invoiceDate": "2026-09-01", "dueDate": "2026-09-30",
        "items": [{ "productId": "7c2d...", "taxId": "5d3a...",
                    "quantity": "10", "unitPrice": "120" }]
      }'
```

**Success — 201**

```json
{
  "success": true,
  "data": {
    "sale": {
      "id": "8a1b...",
      "invoiceNumber": "INV-2026-000001",
      "status": "DRAFT",
      "customer": { "id": "9f1c...", "name": "Ravi Medicals", "currentName": "Ravi Medicals" },
      "warehouse": { "id": "2b7e...", "name": "Main Warehouse", "code": "MAIN" },
      "invoiceDate": "2026-09-01",
      "dueDate": "2026-09-30",
      "items": [
        {
          "id": "cc33...", "lineNumber": 1,
          "productId": "7c2d...", "productName": "Paracetamol 500mg", "sku": "SKU-PARA-500",
          "unitName": "STR", "taxId": "5d3a...", "taxName": "GST 18%", "taxRate": "18.00",
          "quantity": "10.000", "unitPrice": "120.0000",
          "discountType": "NONE", "discountValue": "0.0000", "discountAmount": "0.00",
          "taxableAmount": "1200.00", "taxAmount": "216.00", "lineTotal": "1416.00",
          "cogsUnitCost": "0.0000", "cogsAmount": "0.00"
        }
      ],
      "subtotal": "1200.00", "discountTotal": "0.00",
      "taxTotal": "216.00", "grandTotal": "1416.00",
      "cogsTotal": "0.00", "grossMargin": "1200.00",
      "createdBy": { "id": "4b1f...", "name": "Administrator" },
      "postedBy": null, "postedAt": null
    }
  },
  "message": "Sales invoice draft created successfully"
}
```

COGS is `0.00` on a draft — nothing has left stock yet.

**Errors:** 400 validation · 401 · 404 / 422 with the codes above.

---

## PATCH /api/v1/sales/:id

Replaces a **draft** and recalculates every total. Same complete body as create,
including the full `items` array. The customer and warehouse **may** be changed
while it is a draft.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`
- **Errors:** as create, plus 409 `SALE_ALREADY_POSTED`, 404 for another
  company's invoice.

---

## POST /api/v1/sales/:id/post

**The only endpoint that moves stock and money.** One transaction:

1. The invoice is locked and must still be `DRAFT`.
2. Customer, warehouse, every product and tax are re-checked (exist, active).
3. Per line: the inventory balance is locked, stock must be sufficient, a
   `STOCK_OUT` movement is created at the current moving average, and that cost
   is **frozen** onto the line as `cogsUnitCost` / `cogsAmount`.
4. One `CustomerReceivable` and one `SALE` ledger entry are created.
5. The invoice becomes `POSTED` with `cogsTotal` set.

If any line fails, **everything** rolls back — no movement, no receivable, no
ledger entry, and the invoice stays a draft.

- **Authentication:** required · **Role:** `ADMIN` · **Body:** none

**Success — 200** — the invoice with `"status": "POSTED"`, `postedBy`,
`postedAt`, and real `cogsTotal` / `grossMargin`.

**Errors**

| Status | Code |
|---|---|
| 404 | `SALE_NOT_FOUND` |
| 409 | `SALE_ALREADY_POSTED` — including the loser of two simultaneous posts |
| 409 | `SALE_NOT_DRAFT` — cancelled |
| 422 | `SALE_HAS_NO_ITEMS`, `SALE_INSUFFICIENT_STOCK`, `*_INACTIVE` |

**Concurrency:** posting one invoice twice at once yields exactly one success.
Several invoices competing for the last stock never oversell — stock never goes
negative.

---

## POST /api/v1/sales/:id/cancel

Cancels a **draft**. A posted invoice cannot be cancelled (409) — use a
**sales return** instead (documented below).

- **Authentication:** required · **Role:** `ADMIN` · **Body:** none

---

## GET /api/v1/sales · GET /api/v1/sales/:id

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

| Query | Type | Notes |
|---|---|---|
| `page`, `limit` | integer | Default 1 / 20, max 100 |
| `search` | string | Invoice number, customer name |
| `customerId`, `warehouseId` | uuid | |
| `status` | `DRAFT` \| `POSTED` \| `CANCELLED` | |
| `fromDate`, `toDate` | `YYYY-MM-DD` | Filter on `invoiceDate` |

The list omits item lines; fetch one invoice to see them.
**Errors:** 400 malformed uuid · 401 · 404 `SALE_NOT_FOUND`.

---

## GET /api/v1/customer-receivables · GET /api/v1/customer-receivables/:id

Invoices raised by posting a sale.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

| Query | Type | Notes |
|---|---|---|
| `page`, `limit` | integer | |
| `customerId` | uuid | |
| `status` | `OPEN` \| `PARTIALLY_PAID` \| `PAID` \| `CREDITED` \| `CANCELLED` | The last two are reserved for later phases |
| `onlyOutstanding` | `true` \| `false` | Only invoices with money still owed |
| `invoiceNumber` | string | Partial match |
| `dueDateFrom`, `dueDateTo` | `YYYY-MM-DD` | |

```json
{
  "success": true,
  "data": [
    {
      "id": "d4e5...",
      "customer": { "id": "9f1c...", "name": "Ravi Medicals" },
      "salesInvoice": { "id": "8a1b...", "invoiceNumber": "INV-2026-000001",
                        "invoiceDate": "2026-09-01", "status": "POSTED" },
      "originalAmount": "1416.00", "paidAmount": "0.00",
      "outstandingAmount": "1416.00", "dueDate": "2026-09-30", "status": "OPEN"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 1, "totalPages": 1 }
}
```

---

## GET /api/v1/customers/:id/ledger

Every entry for a customer in date order with a running balance.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`
- **Query:** `fromDate`, `toDate` (`YYYY-MM-DD`). Everything before `fromDate` is
  collapsed into `openingBalance`.

```json
{
  "success": true,
  "data": {
    "ledger": {
      "customer": { "id": "9f1c...", "name": "Ravi Medicals" },
      "openingBalance": "0.00",
      "entries": [
        { "date": "2026-09-01", "type": "SALE", "referenceType": "SALES_INVOICE",
          "referenceId": "8a1b...", "description": "Sales invoice INV-2026-000001",
          "debit": "100000.00", "credit": "0.00", "balance": "100000.00" },
        { "date": "2026-09-05", "type": "PAYMENT", "referenceType": "CUSTOMER_PAYMENT",
          "referenceId": "p1...", "description": "Payment RCP-2026-000001",
          "debit": "0.00", "credit": "40000.00", "balance": "60000.00" }
      ],
      "closingBalance": "60000.00"
    }
  }
}
```

**Errors:** 400 · 401 · 404 `CUSTOMER_NOT_FOUND`.

---

## GET /api/v1/customers/:id/outstanding

```json
{
  "success": true,
  "data": {
    "outstanding": {
      "customer": { "id": "9f1c...", "name": "Ravi Medicals" },
      "totalSales": "100000.00",
      "totalPayments": "60000.00",
      "totalReturns": "0.00",
      "outstandingAmount": "40000.00",
      "invoiceOutstanding": "40000.00",
      "unallocatedCredit": "0.00"
    }
  }
}
```

- `outstandingAmount` — derived from the ledger. Negative means we hold customer credit.
- `invoiceOutstanding` — sum of what is still open on individual invoices.
- `unallocatedCredit` — the difference: money received but not applied to an invoice.

---

## GET /api/v1/customers/:id/receivables · GET /api/v1/customers/:id/payments

Outstanding invoices for that customer (oldest due first), and their payment
history (paginated, filterable by `status`). Both `ADMIN` or `STAFF`.

---

## POST /api/v1/customer-payments

Creates a **draft** payment. Settles nothing until posted.

- **Authentication:** required · **Role:** `ADMIN`

| Field | Type | Required | Notes |
|---|---|---|---|
| `customerId` | uuid | yes | Your company, active |
| `paymentDate` | `YYYY-MM-DD` | yes | |
| `amount` | string \| number | yes | Greater than 0 |
| `paymentMethod` | `CASH` \| `BANK` \| `UPI` \| `CHEQUE` \| `OTHER` | yes | |
| `referenceNumber` | string \| null | no | Max 100 chars |
| `notes` | string \| null | no | Max 1000 chars |
| `allocations` | array | no | Defaults to `[]` — a payment with none is an advance |

Each allocation: `receivableId` (that customer's posted invoice, each once) and
`amount` (> 0, not more than that invoice's outstanding).

```bash
curl -X POST http://localhost:4000/api/v1/customer-payments \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{
        "customerId": "9f1c...", "paymentDate": "2026-09-05",
        "amount": "60000", "paymentMethod": "BANK", "referenceNumber": "NEFT-9912",
        "allocations": [ { "receivableId": "d4e5...", "amount": "50000" },
                         { "receivableId": "d6f7...", "amount": "10000" } ]
      }'
```

**Success — 201** — the payment with `paymentNumber` (`RCP-2026-000001`),
`allocatedAmount`, `unallocatedAmount` and its allocation lines.

**Errors:** 400 validation (amount ≤ 0, unknown method, duplicate `receivableId`)
· 401 · 403 for `STAFF` · 404 / 422 with the codes above.

---

## PATCH /api/v1/customer-payments/:id

Replaces a **draft**. `customerId` must match the payment's existing customer.

- **Role:** `ADMIN` · **Errors:** as create, plus 409 if posted.

---

## POST /api/v1/customer-payments/:id/post

One transaction: the payment is locked; each allocated receivable is locked **in
id order**; each allocation is re-checked against the invoice's *current*
outstanding; each invoice's `paidAmount`, `outstandingAmount` and `status` are
recomputed; one ledger entry is written for the **full** payment amount; the
payment becomes `POSTED`.

If any allocation fails, everything rolls back.

- **Role:** `ADMIN` · **Body:** none

**Errors:** 404 `CUSTOMER_PAYMENT_NOT_FOUND` · 409 already posted / not postable ·
422 `PAYMENT_EXCEEDS_OUTSTANDING`, `INVALID_PAYMENT_ALLOCATION`.

**Concurrency:** five payments each claiming the same outstanding 10,000 yield
one success and four 422s. Outstanding never goes negative.

---

## POST /api/v1/customer-payments/:id/cancel

Cancels a **draft**. A posted payment cannot be cancelled (409). **Role:** `ADMIN`.

---

## GET /api/v1/customer-payments · GET /api/v1/customer-payments/:id

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`
- **Query:** `page`, `limit`, `search` (payment/reference number, customer name),
  `customerId`, `status`, `paymentMethod`, `fromDate`, `toDate`.

The list omits allocation lines; fetch one payment to see them.

---

## Customer advances

A payment may allocate less than its amount, or nothing at all. The remainder is
credit held for the customer:

```
Customer owes nothing.  Receive 20000 with no allocations.
  -> payment.unallocatedAmount = "20000.00"
  -> customer outstandingAmount = "-20000.00"   (we hold their money)
  -> unallocatedCredit = "20000.00"
```

**Limitation:** an existing advance cannot yet be applied to a *later* invoice —
that needs an endpoint operating on an already-posted payment. Allocate at
payment time until then.

---

## Not implemented in this phase

Sales returns and credit notes, reversal of posted invoices or payments, general
ledger, journal entries, chart of accounts, trial balance, P&L, GST accounting
and returns, TDS, bank reconciliation, reports and dashboards, and AI/OCR bill
processing.
---

# Sales Returns / Credit Notes

Goods coming back from a customer. A return **references a posted sales invoice
and never changes it**. Like every other document here, it is a draft first and
only moves stock and money when posted.

```
POST /sales-returns             -> DRAFT      no stock, no credit
PATCH /sales-returns/:id        -> DRAFT      replaces the document
POST /sales-returns/:id/post    -> POSTED     stock back in, receivable credited
POST /sales-returns/:id/cancel  -> CANCELLED  drafts only
```

| Rule | Behaviour |
|---|---|
| **Authentication** | Required on every endpoint. |
| **Role** | Read, create and edit drafts — `ADMIN` and `STAFF`. Post and cancel — `ADMIN`. |
| **Tenant** | Another company's invoice, invoice line or return behaves as if it does not exist. |
| **Cost** | Stock returns at the COGS cost **frozen on the original invoice line**. Never today's average, never a client value. |
| **Credit** | Recomputed from the original line's price, discount and tax. Client amounts are ignored. |
| **Warehouse / customer** | Always taken from the invoice. |
| **Immutability** | A `POSTED` return can never be edited, cancelled or re-posted. |

## What you may send

Only *which invoice, which lines, how much, and why*. Everything else is derived:
`companyId`, `customerId`, `warehouseId`, `productId`, `unitPrice`, discount, tax,
line totals, `grandTotal`, COGS, `returnNumber`, `createdById`.

## How the credit is calculated

```
gross          = returnQty × originalUnitPrice
discountAmount = originalLineDiscount × (returnQty / soldQty)   ← prorated
taxableAmount  = gross − discountAmount
taxAmount      = taxableAmount × originalTaxRate / 100
lineTotal      = taxableAmount + taxAmount
```

Prorating means partial returns sum back to exactly the original charge:
returning 4 then 6 of a 10-unit line credits the same total the line was invoiced.

## How stock comes back

At the **frozen** `cogsUnitCost` from the invoice line:

```
Stock 100 @ 80.  Sell 10 (COGS 80) -> 90 @ 80.
Return 4 @ 80                       -> 94 @ 80   (average restored exactly)
```

Even if a later purchase has moved the average, the return still uses the
original 80.

## How much can still be returned

```
remaining = sold quantity − sum of quantities on POSTED returns
```

**Only posted returns count.** Two drafts may each claim the last units; the first
one posted wins and the second fails at posting.

## Business error codes

| Code | Status | Meaning |
|---|---|---|
| `SALES_RETURN_NOT_FOUND` | 404 | Unknown id, or another company's return |
| `SALE_NOT_FOUND` | 404 | Unknown invoice, or another company's |
| `SALE_ITEM_NOT_FOUND` | 404 | That line does not belong to this invoice |
| `SALE_NOT_POSTED` | 422 | The invoice is still a draft, or cancelled |
| `SALES_RETURN_EXCEEDS_INVOICE_QTY` | 422 | More than what remains returnable |
| `SALES_RETURN_HAS_NO_ITEMS` | 422 | Posting a return with no lines |
| `SALES_RETURN_INVOICE_IMMUTABLE` | 422 | Editing a draft onto a different invoice |
| `SALES_RETURN_ALREADY_POSTED` | 409 | Posting, editing or cancelling a posted return |
| `SALES_RETURN_NOT_POSTABLE` | 409 | The return is cancelled |

---

## POST /api/v1/sales-returns

Creates a **draft**. **Does not change stock or any balance.**

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

| Field | Type | Required | Notes |
|---|---|---|---|
| `salesInvoiceId` | uuid | yes | Must be a **POSTED** invoice in your company |
| `returnDate` | `YYYY-MM-DD` | yes | A business date |
| `reason` | string \| null | no | Max 200 chars, e.g. "Damaged on delivery" |
| `notes` | string \| null | no | Max 1000 chars |
| `items` | array | yes | 1–500 lines |

Each item:

| Field | Type | Required | Notes |
|---|---|---|---|
| `salesInvoiceItemId` | uuid | yes | A line of **that** invoice. Each line may appear only once |
| `quantity` | string \| number | yes | > 0, and ≤ what remains returnable |

```bash
curl -X POST http://localhost:4000/api/v1/sales-returns \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{
        "salesInvoiceId": "8a1b...",
        "returnDate": "2026-09-10",
        "reason": "Damaged on delivery",
        "items": [ { "salesInvoiceItemId": "cc33...", "quantity": "4" } ]
      }'
```

**Success — 201**

```json
{
  "success": true,
  "data": {
    "salesReturn": {
      "id": "e5f6...",
      "returnNumber": "SR-2026-000001",
      "status": "DRAFT",
      "returnDate": "2026-09-10",
      "reason": "Damaged on delivery",
      "salesInvoice": { "id": "8a1b...", "invoiceNumber": "INV-2026-000001",
                        "invoiceDate": "2026-09-01", "status": "POSTED" },
      "customer": { "id": "9f1c...", "name": "Ravi Medicals" },
      "warehouse": { "id": "2b7e...", "name": "Main Warehouse", "code": "MAIN" },
      "items": [
        {
          "id": "gg77...", "lineNumber": 1,
          "salesInvoiceItemId": "cc33...", "productId": "7c2d...",
          "productName": "Paracetamol 500mg", "sku": "SKU-PARA-500",
          "taxName": "GST 18%", "taxRate": "18.00",
          "quantity": "4.000", "unitPrice": "120.0000",
          "discountAmount": "0.00", "taxableAmount": "480.00",
          "taxAmount": "86.40", "lineTotal": "566.40",
          "cogsUnitCost": "80.0000", "cogsAmount": "320.00"
        }
      ],
      "subtotal": "480.00", "discountTotal": "0.00",
      "taxTotal": "86.40", "grandTotal": "566.40", "cogsTotal": "0.00",
      "createdBy": { "id": "4b1f...", "name": "Administrator" },
      "postedBy": null, "postedAt": null
    }
  },
  "message": "Sales return draft created successfully"
}
```

`cogsUnitCost` on the line is the frozen cost the stock will return at.
`cogsTotal` on the header stays `0.00` until the return is posted.

**Errors:** 400 validation (empty items, quantity ≤ 0, duplicate line, malformed
date/uuid) · 401 · 404 / 422 with the codes above.

---

## PATCH /api/v1/sales-returns/:id

Replaces a **draft** and recalculates the credit. Same complete body as create.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

`salesInvoiceId` must match the return's existing invoice — a return cannot be
moved to a different invoice (`SALES_RETURN_INVOICE_IMMUTABLE`). Cancel it and
create a new one.

**Errors:** as create, plus 409 `SALES_RETURN_ALREADY_POSTED`, 404 for another
company's return.

---

## POST /api/v1/sales-returns/:id/post

**The only endpoint that changes stock and the receivable.** One transaction:

1. The return is locked and must still be `DRAFT`.
2. The parent invoice is locked, so competing returns serialise.
3. Prices, tax rates, frozen COGS and remaining quantities are re-read from the
   invoice — the draft is not trusted.
4. Each line creates a `STOCK_IN` movement in the invoice's warehouse at the
   **frozen COGS cost**.
5. The receivable is locked and credited; one `SALES_RETURN` ledger entry is
   written as a credit.
6. The return becomes `POSTED` with `cogsTotal` set.

If any line fails, **everything** rolls back — no movement, no credit, no ledger
entry, and the return stays a draft.

- **Authentication:** required · **Role:** `ADMIN` · **Body:** none

**Success — 200** — the return with `"status": "POSTED"`, `postedBy`, `postedAt`
and a real `cogsTotal`.

Effect on the customer:

```
Invoice 1416.00  ->  receivable OPEN, outstanding 1416.00
Return  566.40   ->  creditAmount 566.40, outstanding 849.60, PARTIALLY_PAID
Full return      ->  outstanding 0.00, status CREDITED
```

**Errors**

| Status | Code |
|---|---|
| 404 | `SALES_RETURN_NOT_FOUND` |
| 409 | `SALES_RETURN_ALREADY_POSTED` — including the loser of two simultaneous posts |
| 409 | `SALES_RETURN_NOT_POSTABLE` — cancelled |
| 422 | `SALES_RETURN_HAS_NO_ITEMS`, `SALES_RETURN_EXCEEDS_INVOICE_QTY` |

**Concurrency:** posting the same return twice at once results in exactly one
success, one stock movement and one ledger entry — a customer can never be
double-credited. Two different returns competing for the same remaining quantity
result in one success and one 422.

---

## POST /api/v1/sales-returns/:id/cancel

Cancels a **draft**. A posted return cannot be cancelled (409) — reversing it
would take back stock the customer no longer has.

- **Authentication:** required · **Role:** `ADMIN` · **Body:** none

A cancelled return affects nothing and does **not** consume returnable quantity.

---

## GET /api/v1/sales-returns

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

| Query | Type | Notes |
|---|---|---|
| `page`, `limit` | integer | Default 1 / 20, max 100 |
| `search` | string | Return number, invoice number, customer name, reason |
| `salesInvoiceId`, `customerId` | uuid | |
| `status` | `DRAFT` \| `POSTED` \| `CANCELLED` | |
| `fromDate`, `toDate` | `YYYY-MM-DD` | Filter on `returnDate` |

Newest first, with the standard `pagination` block. **Item lines are omitted from
the list** — fetch one return to see them.

---

## GET /api/v1/sales-returns/:id

One return with all of its lines.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`
- **Errors:** 400 malformed uuid · 401 · 404 unknown or another company's return.

---

## GET /api/v1/sales-returns/returnable/:salesInvoiceId

What is still returnable on each line of an invoice — everything a credit-note
form needs.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

```json
{
  "success": true,
  "data": {
    "returnable": {
      "salesInvoiceId": "8a1b...",
      "invoiceNumber": "INV-2026-000001",
      "status": "POSTED",
      "customer": { "id": "9f1c...", "name": "Ravi Medicals" },
      "warehouse": { "id": "2b7e...", "name": "Main Warehouse" },
      "lines": [
        {
          "salesInvoiceItemId": "cc33...",
          "productId": "7c2d...",
          "productName": "Paracetamol 500mg",
          "sku": "SKU-PARA-500",
          "unitPrice": "120.0000",
          "cogsUnitCost": "80.0000",
          "soldQuantity": "10.000",
          "returnedQuantity": "4.000",
          "remainingQuantity": "6.000"
        }
      ]
    }
  }
}
```

`returnedQuantity` counts **posted** returns only. **Errors:** 401 · 404
`SALE_NOT_FOUND`.

---

## Effect on customer receivables

`CustomerReceivable` gained a `creditAmount` field in this phase, mirroring
`SupplierPayable`:

```
outstandingAmount = originalAmount − creditAmount − paidAmount   (never below zero)
```

Statuses: `OPEN` → `PARTIALLY_PAID` → `PAID` (settled by money) or `CREDITED`
(settled entirely by returns). If credits and payments together exceed the
invoice, outstanding clamps at zero and the surplus appears in the customer
balance as credit — visible on
`GET /api/v1/customers/:id/outstanding` as a negative `outstandingAmount`.

`totalReturns` on that endpoint is now populated.

---

## Not implemented in this phase

Reversal of a posted sales return, refunds against customer credit, damaged /
quarantine stock handling on return, tax-authority credit-note numbering and GST
reporting, and AI/OCR document processing. The accounting effect of a sales
return **is** recorded — see the general ledger section below.
---

---

# General Ledger and Chart of Accounts

Double-entry accounting. Every operational document above — purchase, purchase
return, supplier payment, sales invoice, sales return, customer payment — writes
a balanced journal entry **in the same transaction** that posts it.

| Rule | Behaviour |
|---|---|
| **Authentication** | Required on every endpoint. |
| **Role** | Reads — `ADMIN` and `STAFF`. Creating/editing/deleting an account and reversing a journal — `ADMIN`. |
| **Tenant** | Another company's account or journal entry behaves as if it does not exist (404). |
| **Journals** | Cannot be created, edited or deleted by anyone. They exist only because a document was posted. |
| **Balances** | Always derived from the journal. There is no stored balance column. |
| **Money** | `Decimal(18,4)` internally, serialized as 2-decimal strings. |

## The sign convention

| Type | Debit | Credit | Balance |
|---|---|---|---|
| `ASSET`, `EXPENSE` | increases | decreases | `debit − credit` |
| `LIABILITY`, `EQUITY`, `REVENUE` | decreases | increases | `credit − debit` |

A positive balance always means *more of what the account is for*. Every account
response carries `normalBalance` so a client never has to know the rule.

## System accounts

Created for every company automatically. Resolved by **code**, which never
changes. A system account can be renamed and re-parented, but never deleted and
never deactivated.

| Code | Name | Type |
|---|---|---|
| `1000` | Cash | ASSET |
| `1010` | Bank | ASSET |
| `1200` | Accounts Receivable | ASSET |
| `1300` | Inventory | ASSET |
| `1400` | Advance to Suppliers | ASSET |
| `1500` | Input Tax Credit | ASSET |
| `2000` | Accounts Payable | LIABILITY |
| `2100` | Tax Payable | LIABILITY |
| `2200` | Customer Advances | LIABILITY |
| `3000` | Owner's Capital | EQUITY |
| `4000` | Sales Revenue | REVENUE |
| `4100` | Sales Returns | REVENUE (contra — debit balance) |
| `5000` | Cost of Goods Sold | EXPENSE |
| `5100` | Inventory Valuation Adjustment | EXPENSE |

## What each document posts

| Document | Debit | Credit |
|---|---|---|
| Purchase | Inventory, Input Tax Credit | Accounts Payable, (Valuation Adj. for the discount) |
| Purchase return | Accounts Payable | Inventory |
| Supplier payment | Accounts Payable, Advance to Suppliers | Bank / Cash |
| Sales invoice | Accounts Receivable, COGS | Sales Revenue, Tax Payable, Inventory |
| Sales return | Sales Returns, Tax Payable, Inventory | Accounts Receivable, COGS |
| Customer payment | Bank / Cash | Accounts Receivable, Customer Advances |

`CASH` posts to Cash; every other payment method posts to Bank. COGS always uses
the cost **frozen** on the invoice line — never today's moving average.

## Business error codes

| Code | Status | Meaning |
|---|---|---|
| `ACCOUNT_NOT_FOUND` | 404 | Unknown id, or another company's account |
| `ACCOUNT_PARENT_NOT_FOUND` | 404 | Parent missing, or in another company |
| `ACCOUNT_CODE_TAKEN` | 409 | That code already exists in this company |
| `ACCOUNT_CIRCULAR_PARENT` | 422 | The parent chain would form a loop |
| `ACCOUNT_SYSTEM_PROTECTED` | 422 | Deleting or deactivating a system account |
| `ACCOUNT_IN_USE` | 422 | Deleting an account that has journal entries |
| `ACCOUNT_HAS_CHILDREN` | 422 | Deleting an account with child accounts |
| `ACCOUNT_INACTIVE` | 422 | A posting needs an account that is deactivated |
| `JOURNAL_ENTRY_NOT_FOUND` | 404 | Unknown entry, another company's, or no journal for that document |
| `JOURNAL_ENTRY_ALREADY_REVERSED` | 409 | A reversal for this entry already exists |
| `JOURNAL_ENTRY_IS_REVERSAL` | 422 | A reversing entry cannot itself be reversed |
| `JOURNAL_UNBALANCED` / `JOURNAL_ZERO_LINE` / `JOURNAL_LINE_BOTH_SIDES` / `JOURNAL_NEGATIVE_AMOUNT` / `JOURNAL_TOO_FEW_LINES` | 422 | The posting engine refused a malformed entry |

---

## GET /api/v1/accounts

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

| Query | Type | Notes |
|---|---|---|
| `page`, `limit` | integer | Default 1 / 20, max 100 |
| `search` | string | Code or name |
| `type` | `ASSET` \| `LIABILITY` \| `EQUITY` \| `REVENUE` \| `EXPENSE` | |
| `isActive`, `isSystem` | `true` \| `false` | |
| `parentId` | uuid | Direct children of one account |

Ordered by code, with the standard `pagination` block.

```json
{
  "success": true,
  "data": [
    {
      "id": "1f2e...", "code": "1300", "name": "Inventory", "type": "ASSET",
      "normalBalance": "DEBIT",
      "parent": null, "parentId": null,
      "isSystem": true, "isActive": true,
      "description": "Control account for stock on hand. Mirrors the inventory ledger."
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 14, "totalPages": 1 }
}
```

---

## GET /api/v1/accounts/:id

One account with its balance, derived from the journal at read time.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

```json
{
  "success": true,
  "data": {
    "account": {
      "id": "1f2e...", "code": "2000", "name": "Accounts Payable",
      "type": "LIABILITY", "normalBalance": "CREDIT",
      "isSystem": true, "isActive": true,
      "debitTotal": "5500.00", "creditTotal": "11800.00",
      "balance": "6300.00"
    }
  }
}
```

**Errors:** 400 malformed uuid · 401 · 404 unknown or another company's account.

---

## POST /api/v1/accounts

- **Authentication:** required · **Role:** `ADMIN`

| Field | Type | Required | Notes |
|---|---|---|---|
| `code` | string | yes | 1–20 chars, letters/digits/`.`/`-`/`_`, unique per company, **never changeable** |
| `name` | string | yes | 2–150 chars, need not be unique |
| `type` | enum | yes | `ASSET` \| `LIABILITY` \| `EQUITY` \| `REVENUE` \| `EXPENSE`, **never changeable** |
| `parentId` | uuid \| null | no | Must be an account in your company |
| `description` | string \| null | no | Max 1000 chars |
| `isActive` | boolean | no | Default `true` |

`isSystem` and `companyId` are ignored if sent — a client can never create a
system account or place one in another company.

```bash
curl -X POST http://localhost:4000/api/v1/accounts \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{ "code": "5200", "name": "Rent", "type": "EXPENSE" }'
```

**Errors:** 400 validation · 401 · 403 not `ADMIN` · 404 `ACCOUNT_PARENT_NOT_FOUND`
· 409 `ACCOUNT_CODE_TAKEN`.

---

## PATCH /api/v1/accounts/:id

Updates `name`, `description`, `parentId` or `isActive`. **`code` and `type` are
never editable** — sending them is not an error, they are ignored.

- **Authentication:** required · **Role:** `ADMIN`

Setting `parentId` to `null` detaches the account. A parent that is below this
account in the tree is rejected with `ACCOUNT_CIRCULAR_PARENT`, at any depth.

Deactivating a **system** account is refused (`ACCOUNT_SYSTEM_PROTECTED`): the
document flows depend on it being postable.

**Errors:** 400 · 401 · 403 · 404 · 422 `ACCOUNT_CIRCULAR_PARENT`,
`ACCOUNT_SYSTEM_PROTECTED`.

---

## DELETE /api/v1/accounts/:id

Physically deletes an account that nothing depends on.

- **Authentication:** required · **Role:** `ADMIN`

Refused for a system account, for an account with journal entries
(`ACCOUNT_IN_USE` — deactivate it instead, deleting would orphan history the
trial balance still has to explain) and for an account with children
(`ACCOUNT_HAS_CHILDREN`).

---

## GET /api/v1/accounts/:id/ledger

One account's movements in date order with a running balance in its natural
direction.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

| Query | Type | Notes |
|---|---|---|
| `page`, `limit` | integer | Default 1 / 20, max 100 |
| `dateFrom`, `dateTo` | `YYYY-MM-DD` | |
| `sourceType`, `sourceId` | enum / uuid | Narrow to one kind of document |

`dateFrom` never loses history: everything before it forms `openingBalance`.

```json
{
  "success": true,
  "data": {
    "ledger": {
      "account": { "id": "1f2e...", "code": "2000", "name": "Accounts Payable" },
      "normalBalance": "CREDIT",
      "openingBalance": "0.00",
      "entries": [
        {
          "id": "aa11...", "date": "2026-08-01",
          "journalEntryId": "bb22...", "journalNumber": "JV-2026-000001",
          "sourceType": "PURCHASE", "sourceId": "cc33...",
          "description": "Payable for PUR-2026-000001",
          "debit": "0.00", "credit": "11800.00", "balance": "11800.00"
        },
        {
          "id": "dd44...", "date": "2026-09-12",
          "journalNumber": "JV-2026-000004",
          "sourceType": "PURCHASE_RETURN", "sourceId": "ee55...",
          "debit": "500.00", "credit": "0.00", "balance": "11300.00"
        }
      ],
      "closingBalance": "11300.00",
      "totalEntries": 2
    }
  }
}
```

---

## GET /api/v1/journal-entries

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

| Query | Type | Notes |
|---|---|---|
| `page`, `limit` | integer | Default 1 / 20, max 100 |
| `sourceType` | enum | `PURCHASE`, `PURCHASE_RETURN`, `SUPPLIER_PAYMENT`, `SALES_INVOICE`, `SALES_RETURN`, `CUSTOMER_PAYMENT`, `REVERSAL` |
| `sourceId` | uuid | The document id |
| `journalNumber` | string | Partial match |
| `status` | `DRAFT` \| `POSTED` | |
| `accountId` | uuid | Entries touching this account |
| `dateFrom`, `dateTo` | `YYYY-MM-DD` | On `entryDate` |

Newest first. **Lines are omitted from the list** — fetch one entry to see them.

---

## GET /api/v1/journal-entries/:id

One entry with every line.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

```json
{
  "success": true,
  "data": {
    "journalEntry": {
      "id": "bb22...", "journalNumber": "JV-2026-000002",
      "entryDate": "2026-09-01",
      "description": "Sales invoice INV-2026-000001",
      "sourceType": "SALES_INVOICE", "sourceId": "ff66...",
      "status": "POSTED",
      "totalDebit": "3360.00", "totalCredit": "3360.00", "isBalanced": true,
      "reversalOf": null, "reversedBy": null,
      "lines": [
        { "lineNumber": 1, "account": { "code": "1200", "name": "Accounts Receivable", "type": "ASSET" },
          "description": "Receivable for INV-2026-000001", "debit": "2360.00", "credit": "0.00" },
        { "lineNumber": 2, "account": { "code": "4000", "name": "Sales Revenue", "type": "REVENUE" },
          "description": "Revenue on INV-2026-000001", "debit": "0.00", "credit": "2000.00" },
        { "lineNumber": 3, "account": { "code": "2100", "name": "Tax Payable", "type": "LIABILITY" },
          "description": "Output tax on INV-2026-000001", "debit": "0.00", "credit": "360.00" },
        { "lineNumber": 4, "account": { "code": "5000", "name": "Cost of Goods Sold", "type": "EXPENSE" },
          "description": "COGS on INV-2026-000001", "debit": "1000.00", "credit": "0.00" },
        { "lineNumber": 5, "account": { "code": "1300", "name": "Inventory", "type": "ASSET" },
          "description": "Stock issued on INV-2026-000001", "debit": "0.00", "credit": "1000.00" }
      ],
      "createdBy": { "id": "4b1f...", "name": "Administrator" },
      "postedAt": "2026-09-01T10:14:22.000Z"
    }
  }
}
```

There is **no** `POST`, `PATCH` or `DELETE` on this resource, for any role.

---

## GET /api/v1/journal-entries/source/:sourceType/:sourceId

Source traceability: *"why does this ledger entry exist?"*, answered from the
other end. Give it a document and get back the journal that explains it.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

```bash
curl http://localhost:4000/api/v1/journal-entries/source/PURCHASE/cc33... \
  -H "Authorization: Bearer <token>"
```

**Errors:** 400 unknown source type or malformed uuid · 401 · 404
`JOURNAL_ENTRY_NOT_FOUND` when the document has no journal — which is the correct
answer for a draft.

---

## POST /api/v1/journal-entries/:id/reverse

Creates a **new** entry that swaps every debit and credit. The original is never
touched.

- **Authentication:** required · **Role:** `ADMIN`

| Field | Type | Required | Notes |
|---|---|---|---|
| `description` | string | no | Defaults to "Reversal of JV-…" |

The reversal is stored with `sourceType: "REVERSAL"` and the original entry's id
as `sourceId`, and carries the original's `entryDate` so the period nets to zero.

**Idempotent by construction:** `(companyId, sourceType, sourceId)` is unique, so
a second reversal of the same entry cannot exist. Four simultaneous requests
produce exactly one reversal.

This is a correction tool. **No document flow uses it** — reversing a document's
journal without reversing the document makes the GL diverge from the sub-ledger
on purpose.

**Success — 201.** **Errors:** 401 · 403 not `ADMIN` · 404 · 409
`JOURNAL_ENTRY_ALREADY_REVERSED` · 422 `JOURNAL_ENTRY_IS_REVERSAL`,
`JOURNAL_ENTRY_NOT_POSTED`.

---

## GET /api/v1/general-ledger

Every posted journal **line**, oldest first — the ledger itself rather than the
entries.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

| Query | Type | Notes |
|---|---|---|
| `page`, `limit` | integer | Default 1 / 20, max 100 |
| `accountId` | uuid | |
| `sourceType`, `sourceId` | enum / uuid | |
| `dateFrom`, `dateTo` | `YYYY-MM-DD` | |

```json
{
  "success": true,
  "data": [
    {
      "id": "aa11...", "date": "2026-08-01",
      "account": { "id": "1f2e...", "code": "1300", "name": "Inventory", "type": "ASSET" },
      "journalEntry": { "id": "bb22...", "journalNumber": "JV-2026-000001",
                        "description": "Purchase PUR-2026-000001" },
      "sourceType": "PURCHASE", "sourceId": "cc33...",
      "description": "Stock received on PUR-2026-000001",
      "debit": "10000.00", "credit": "0.00"
    }
  ],
  "pagination": { "page": 1, "limit": 20, "total": 3, "totalPages": 1 }
}
```

---

## GET /api/v1/general-ledger/summary

Per-account debit, credit and balance for a period, plus grand totals.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`
- **Query:** `accountId`, `dateFrom`, `dateTo`

`isBalanced` is `true` when the whole company is in view. Filtering to one
account returns `null` — a slice of the ledger is not expected to balance on its
own, and claiming otherwise would be misleading.

---

## GET /api/v1/accounting/trial-balance

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`
- **Query:** `date` (`YYYY-MM-DD`, optional — omit for everything to date)

```json
{
  "success": true,
  "data": {
    "trialBalance": {
      "asOfDate": "2026-09-30",
      "accounts": [
        { "code": "1300", "name": "Inventory", "type": "ASSET", "normalBalance": "DEBIT",
          "debit": "10000.00", "credit": "1000.00", "balance": "9000.00" },
        { "code": "2000", "name": "Accounts Payable", "type": "LIABILITY", "normalBalance": "CREDIT",
          "debit": "0.00", "credit": "11800.00", "balance": "11800.00" }
      ],
      "totalDebit": "15160.00",
      "totalCredit": "15160.00",
      "difference": "0.00",
      "isBalanced": true
    }
  }
}
```

Accounts with no activity in the window are omitted; including them cannot change
a total. `isBalanced` is reported rather than assumed.

---

## GET /api/v1/accounting/profit-loss

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`
- **Query:** `from`, `to` (`YYYY-MM-DD`, both optional; `from` after `to` is a 400)

```
revenue        − salesReturns = netRevenue
netRevenue     − costOfGoodsSold = grossProfit
grossProfit    − otherExpenses = netProfit
```

```json
{
  "success": true,
  "data": {
    "profitAndLoss": {
      "fromDate": "2026-09-01", "toDate": "2026-09-30",
      "revenue": { "accounts": [ /* ... */ ], "total": "2000.00" },
      "salesReturns": { "accounts": [ /* ... */ ], "total": "800.00" },
      "netRevenue": "1200.00",
      "costOfGoodsSold": { "accounts": [ /* ... */ ], "total": "600.00" },
      "grossProfit": "600.00",
      "otherExpenses": { "accounts": [ /* ... */ ], "total": "0.00" },
      "netProfit": "600.00"
    }
  }
}
```

Revenue **excludes tax** — the tax on an invoice is owed to the authority, not
income. Sales returns are reported as their own positive line rather than hidden
inside a net revenue figure. A purchase discount appears in `otherExpenses` as a
negative amount, which is what a favourable price variance is.

---

## GET /api/v1/accounting/balance-sheet

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`
- **Query:** `date` (`YYYY-MM-DD`, optional)

```json
{
  "success": true,
  "data": {
    "balanceSheet": {
      "asOfDate": "2026-09-30",
      "assets": { "accounts": [ /* ... */ ], "total": "12616.00" },
      "liabilities": { "accounts": [ /* ... */ ], "total": "12016.00" },
      "equity": {
        "accounts": [],
        "capital": "0.00",
        "retainedEarnings": "600.00",
        "total": "600.00"
      },
      "totalAssets": "12616.00",
      "totalLiabilitiesAndEquity": "12616.00",
      "difference": "0.00",
      "isBalanced": true
    }
  }
}
```

**`retainedEarnings` is derived, not posted.** There is no period-closing process
in this system, so no journal entry ever moves profit into equity. Rather than
fabricate one, the figure is computed from the revenue and expense accounts as
earnings since inception. That is what makes `assets = liabilities + equity`
hold.

---

## Not implemented in this phase

Manual journal entries (depreciation, accruals, payroll, bank charges), roll-up
of reports through the account hierarchy, multi-currency, bank reconciliation and
cash-flow statements.

Opening balances, owner capital and period closing WERE added later - see
**Opening Balances and Accounting Periods** below. So were CGST/SGST/IGST
splitting, input-credit reversal on a purchase return, the GST return datasets
and the dashboard.

---

# GST and Tax Compliance

Indian GST: the company's registration, HSN/SAC classification, rate components,
place of supply, and the tax summaries derived from posted documents.

| Rule | Behaviour |
|---|---|
| **Authentication** | Required on every endpoint. |
| **Role** | Reads — `ADMIN` and `STAFF`. GST registration and HSN/SAC master — `ADMIN`. |
| **Tenant** | Another company's classification or summary behaves as if it does not exist. |
| **Tax amounts** | Always computed by the server. **No endpoint accepts a tax amount, a component split or a supply type.** |
| **Prices** | Tax-**exclusive**, everywhere. Tax is added on top. |
| **Money** | `Decimal(18,4)` internally, serialized as 2-decimal strings. Rates are 2-decimal strings. |

## GST is opt-in per company

A company becomes GST-aware the moment its profile has a `stateCode`. Until then
tax behaves exactly as it did before this phase — one rate, one amount, posted to
the aggregate tax accounts — because without your own state there is no way to
tell an intra-state supply from an inter-state one.

Once GST is on, the rules are strict: a document whose counterparty state is
unknown is **refused**, not guessed at.

## Intra-state or inter-state

```
seller state == place of supply   ->  INTRA_STATE  ->  CGST + SGST
seller state != place of supply   ->  INTER_STATE  ->  IGST
```

Never both. Which state is which:

| Document | Seller | Buyer | Place of supply |
|---|---|---|---|
| Purchase | supplier | receiving warehouse, else the company | the destination |
| Sale | selling warehouse, else the company | customer | the customer's state, or an explicit override |

## Tax treatment

A zero rate and an exemption are different things, so the treatment is explicit:

| Treatment | Taxed? | Meaning |
|---|---|---|
| `TAXABLE` | at the configured rate | the normal case, and 0% is still taxable |
| `EXEMPT` | never | exempt supply |
| `NIL_RATED` | never | nil-rated supply |
| `ZERO_RATED` | never | export / SEZ, recorded only |

A line with **no tax chosen at all** records no treatment: untaxed is not the same
as exempt.

## GST ledger accounts

| Code | Name | Parent |
|---|---|---|
| `1510` / `1520` / `1530` / `1540` | Input CGST / SGST / IGST / Cess | `1500` Input Tax Credit |
| `2110` / `2120` / `2130` / `2140` | Output CGST / SGST / IGST / Cess | `2100` Tax Payable |

Input GST is **not** capitalised into inventory: it is recoverable, so it is its
own asset.

## Business error codes

| Code | Status | Meaning |
|---|---|---|
| `INVALID_GSTIN` | 422 | Structure, state code or checksum failed |
| `GSTIN_STATE_MISMATCH` | 422 | The GSTIN's own state is not the state being set |
| `GSTIN_REQUIRED` | 422 | A REGULAR / COMPOSITION / SEZ registration needs a GSTIN |
| `GSTIN_TAKEN` | 409 | That GSTIN belongs to another company |
| `GST_INVALID_STATE` | 422 | Not a GST state code |
| `GST_STATE_REQUIRED` | 422 | GST is on and a required state is missing |
| `GST_MIXED_SUPPLY_TYPE` | 422 | CGST/SGST and IGST on one supply |
| `GST_COMPONENT_TOTAL_MISMATCH` | 422 | The split does not add up to the tax |
| `TAX_COMPONENT_MISMATCH` | 422 | A tax master's components disagree with its rate |
| `TAX_RATE_NOT_SPLITTABLE` | 422 | A rate that cannot be halved evenly; set components explicitly |
| `TAX_NOT_EFFECTIVE` | 422 | The rate's effective window does not cover the document date |
| `TAX_CLASSIFICATION_CODE_TAKEN` | 409 | That HSN/SAC already exists in this company |
| `TAX_CLASSIFICATION_NOT_FOUND` | 404 | Unknown, or another company's |
| `TAX_CLASSIFICATION_INACTIVE` | 422 | A retired HSN/SAC on a new document or product |

---

## GET /api/v1/tax/profile

The company's GST registration.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

```json
{
  "success": true,
  "data": {
    "gstProfile": {
      "companyId": "0c7a...",
      "name": "Alpha Pharma",
      "legalName": "Alpha Pharma Private Limited",
      "gstin": "27AAPFU0939F1ZV",
      "gstinChecksumValid": true,
      "registrationType": "REGULAR",
      "stateCode": "27",
      "stateName": "Maharashtra",
      "registeredAddress": "12 Marine Drive, Mumbai",
      "gstEnabled": true
    }
  }
}
```

`gstEnabled` is the single question every document flow asks. `gstinChecksumValid`
reports format and checksum only — it is **never** a claim that the GSTIN is
registered with the portal.

---

## PATCH /api/v1/tax/profile

- **Authentication:** required · **Role:** `ADMIN`

| Field | Type | Notes |
|---|---|---|
| `gstin` | string \| null | 15 chars. Validated strictly: structure, state code **and** checksum |
| `stateCode` | string \| null | Two digits. **Setting this turns GST on** |
| `legalName` | string \| null | 2–150 chars |
| `registeredAddress` | string \| null | Max 500 chars |
| `registrationType` | enum | `REGULAR` \| `COMPOSITION` \| `UNREGISTERED` \| `SEZ` \| `OTHER` |

```bash
curl -X PATCH http://localhost:4000/api/v1/tax/profile \
  -H "Authorization: Bearer <token>" -H "Content-Type: application/json" \
  -d '{ "stateCode": "27", "gstin": "27AAPFU0939F1ZV", "registrationType": "REGULAR" }'
```

A GSTIN whose embedded state disagrees with `stateCode` is refused: a GSTIN *is* a
state registration, so the two disagreeing means one of them is wrong, and
guessing which would misprint every invoice.

**Errors:** 400 · 401 · 403 · 409 `GSTIN_TAKEN` · 422 `INVALID_GSTIN`,
`GSTIN_STATE_MISMATCH`, `GSTIN_REQUIRED`, `GST_INVALID_STATE`.

---

## POST /api/v1/tax/validate-gstin

Checks a GSTIN without storing it — what a form calls as the user types.

- **Authentication:** required · **Role:** any (it is a pure function of its input)

```json
{
  "success": true,
  "data": {
    "gstin": {
      "gstin": "27AAPFU0939F1ZV",
      "valid": true,
      "reason": null,
      "stateCode": "27",
      "stateName": "Maharashtra",
      "pan": "AAPFU0939F",
      "note": "Format and checksum only. This does not confirm the GSTIN is registered or active."
    }
  }
}
```

An invalid GSTIN returns `valid: false` with a `reason` — wrong length, bad
characters, bad structure, unknown state code, or a failed checksum.

---

## GET /api/v1/tax/states

The GST state codes, for a dropdown.

- **Authentication:** required · **Role:** any

---

## GET /api/v1/tax/classifications

The company's HSN/SAC codes.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`

| Query | Type | Notes |
|---|---|---|
| `page`, `limit` | integer | Default 1 / 20, max 100 |
| `search` | string | Code or description |
| `kind` | `HSN` \| `SAC` | |
| `isActive` | `true` \| `false` | |

This is **not** the government catalogue. A business stores the handful of codes it
actually uses; shipping tens of thousands of rows that go stale every budget would
be a liability rather than a feature.

---

## GET /api/v1/tax/classifications/:id

One classification, with `productCount`.

## POST /api/v1/tax/classifications

- **Authentication:** required · **Role:** `ADMIN`

| Field | Type | Required | Notes |
|---|---|---|---|
| `code` | string | yes | 4–8 digits, unique per company, **never editable** |
| `kind` | `HSN` \| `SAC` | no | Default `HSN` |
| `description` | string \| null | no | |
| `defaultTaxId` | uuid \| null | no | Must be an active tax in your company |
| `isActive` | boolean | no | Default `true` |

## PATCH /api/v1/tax/classifications/:id

Updates `kind`, `description`, `defaultTaxId` or `isActive`. **`code` is never
editable** — documents froze it onto their lines. Sending it is ignored.

Deactivating stops new products and documents using it; every document that
already froze the code stays readable.

---

## Tax rates gained GST components

`POST`/`PATCH /api/v1/taxes` accept the split and the treatment:

| Field | Type | Notes |
|---|---|---|
| `rate` | string | The headline rate, as before |
| `cgstRate`, `sgstRate`, `igstRate` | string | Optional. Derived from `rate` if omitted |
| `cessRate` | string | Optional, default 0 |
| `treatment` | enum | `TAXABLE` (default) \| `EXEMPT` \| `NIL_RATED` \| `ZERO_RATED` |
| `effectiveFrom`, `effectiveTo` | `YYYY-MM-DD` \| null | The window in which the rate may be used |

Whether derived or supplied, the split is checked: `cgst + sgst == rate` and
`igst == rate`, else 422 `TAX_COMPONENT_MISMATCH`.

```json
{
  "id": "aa11...", "name": "GST 18%", "rate": "18.00",
  "cgstRate": "9.00", "sgstRate": "9.00", "igstRate": "18.00", "cessRate": "0.00",
  "treatment": "TAXABLE",
  "effectiveFrom": null, "effectiveTo": null,
  "isActive": true
}
```

## Master data gained a state

`stateCode` and `gstRegistrationType` on suppliers and customers, and `stateCode`
on warehouses — a warehouse in another state supplies from that state.
`taxClassificationId` on products.

All optional, so an existing catalogue stays valid — but once GST is on, a
document whose counterparty has no state is refused.

---

## Tax on documents

Purchases and sales gained a `gst` block and a `taxBreakup`, and every line gained
its frozen split:

```json
{
  "invoiceNumber": "INV-2026-000001",
  "gst": {
    "supplyType": "INTRA_STATE",
    "sellerGstin": "27AAPFU0939F1ZV", "sellerStateCode": "27", "sellerStateName": "Maharashtra",
    "buyerGstin": null, "buyerStateCode": "27", "buyerStateName": "Maharashtra",
    "placeOfSupplyStateCode": "27", "placeOfSupplyStateName": "Maharashtra"
  },
  "subtotal": "2000.00", "taxTotal": "360.00", "grandTotal": "2360.00",
  "taxBreakup": { "cgst": "180.00", "sgst": "180.00", "igst": "0.00", "cess": "0.00" },
  "items": [
    {
      "productName": "Paracetamol 500mg",
      "hsn": "30049011", "taxTreatment": "TAXABLE",
      "taxableAmount": "2000.00",
      "cgstRate": "9.00", "sgstRate": "9.00", "igstRate": "0.00", "cessRate": "0.00",
      "cgstAmount": "180.00", "sgstAmount": "180.00", "igstAmount": "0.00", "cessAmount": "0.00",
      "taxAmount": "360.00", "lineTotal": "2360.00"
    }
  ]
}
```

`gst` is `null` on a document written by a company that has not enabled GST.

**The only tax field a client may send is `placeOfSupplyStateCode` on a sale**
(optional; defaults to the customer's state). It is what a bill-to / ship-to
difference needs — and even then it is an input to the decision, not the decision.
Any `taxTotal`, `cgstAmount` or `supplyType` in a request body is dropped by
validation before a service sees it.

A purchase return now credits the supplier for **goods plus tax**, at the original
bill's frozen rates:

```json
{
  "returnNumber": "PR-2026-000001",
  "taxableTotal": "1000.00",
  "taxTotal": "180.00",
  "grandTotal": "1180.00",
  "taxBreakup": { "cgst": "90.00", "sgst": "90.00", "igst": "0.00", "cess": "0.00" }
}
```

Without GST the tax is zero and `grandTotal` is the cost-only figure it has always
been.

---

## GET /api/v1/tax/gst-summary

Output tax less input tax, with a reconciliation against the GST control accounts.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`
- **Query:** `dateFrom`, `dateTo`, `state`, `gstin`, `hsn`, `rate`, `supplyType`

```json
{
  "success": true,
  "data": {
    "gstSummary": {
      "fromDate": null, "toDate": null,
      "outputTax": {
        "taxableAmount": "2000.00",
        "cgst": "180.00", "sgst": "180.00", "igst": "0.00", "cess": "0.00",
        "totalTax": "360.00",
        "byDocumentType": { "SALES_INVOICE": { }, "SALES_RETURN": { } },
        "byRate": [ { "taxRate": "18.00", "taxableAmount": "2000.00", "totalTax": "360.00" } ]
      },
      "inputTax": { },
      "net": {
        "cgst": "-720.00", "sgst": "-720.00", "igst": "0.00", "cess": "0.00",
        "netTax": "-1440.00",
        "position": "CREDIT"
      },
      "ledgerReconciliation": [
        { "code": "1510", "name": "Input CGST", "debit": "900.00", "credit": "0.00", "balance": "900.00" }
      ],
      "note": "Internal accounting summary computed from posted documents. Not a filed GST return, and not a legal tax liability."
    }
  }
}
```

`position` is `PAYABLE` when the books say tax is owed and `CREDIT` when input
exceeds output. `ledgerReconciliation` is computed **independently**, from the
journal — so if the documents and the ledger ever disagree, it shows.

**This is not a filed return.** Eligibility rules, reverse charge, ineligible
credits and reconciliation against a supplier's own filing are all outside this
system, and `netTax` is not a legal liability.

---

## GET /api/v1/tax/input-tax · GET /api/v1/tax/output-tax

One side each. Input tax is purchases less purchase returns; output tax is sales
less sales returns. Same filters, same shape as the blocks above, with `byRate`
and `byDocumentType`.

---

## GET /api/v1/tax/gst-purchases · GET /api/v1/tax/gst-sales

The document lines behind the figures — this is what makes every number
answerable.

- **Query:** pagination plus `dateFrom`, `dateTo`, `state`, `gstin`, `hsn`, `rate`, `supplyType`

```json
{
  "documentNumber": "PUR-2026-000001", "documentDate": "2026-08-01",
  "product": "Paracetamol 500mg", "hsn": "30049011",
  "taxTreatment": "TAXABLE", "taxRate": "18.00",
  "supplyType": "INTRA_STATE",
  "sellerGstin": "27AAPFU0939F1ZV", "buyerGstin": null,
  "placeOfSupply": "27", "placeOfSupplyName": "Maharashtra",
  "taxableAmount": "10000.00",
  "cgst": "900.00", "sgst": "900.00", "igst": "0.00", "cess": "0.00",
  "totalTax": "1800.00"
}
```

Each row carries `documentId`, so it leads to the document and from there — via
`GET /journal-entries/source/:sourceType/:sourceId` — to the journal entry that
recorded it.

## GET /api/v1/tax/lines/:source

The same, for any document type: `PURCHASE`, `PURCHASE_RETURN`, `SALES_INVOICE`,
`SALES_RETURN`. An unknown type is a 400.

## GET /api/v1/tax/hsn-summary/:source

Totals grouped by HSN/SAC — the shape a GST return's HSN table wants.

---

## Not implemented in this phase

GST portal integration and filing, e-invoice IRN, e-way bills, reverse charge,
composition-scheme arithmetic, LUT/bond and export refund workflows,
quantity-based cess, tax-period locking, tax-inclusive price lists, and checksum
enforcement on supplier and customer GSTINs.

GSTR-1 and GSTR-3B **preparation datasets** are built from these documents - see
"GST Return Preparation" below.

---

# GST Return Preparation (GSTR-1 and GSTR-3B)

Datasets shaped the way a GST return is filed, built from posted documents.

> **These are preparation datasets, not filed returns.** Nothing here contacts the
> GST portal, no statutory validation is performed, and several fields a real
> return requires are not available in this system. Every response carries a
> `notFiled` field saying so. See the limitations at the end.

| Rule | Behaviour |
|---|---|
| **Authentication** | Required on every endpoint. |
| **Role** | `ADMIN` and `STAFF` — the same as every other GST read. |
| **Method** | `GET` only. Nothing in this phase writes anything. |
| **Tenant** | Company scoped. Another company's documents never appear. |
| **Schema** | No new tables. Datasets are derived from the frozen GST snapshots on documents. |
| **Money** | Decimal throughout; serialized as 2-decimal strings. |

## Period semantics

```
?fromDate=2026-09-01&toDate=2026-09-30
```

- Both dates are **required**. There is no default period.
- Both bounds are **inclusive**.
- The date compared is the document's **business date** — `invoiceDate` on an
  invoice or purchase, `returnDate` on either return. Stored as `DATE` at UTC
  midnight, so no timezone shifts a document across a boundary.
- A **credit note is placed by its own date**, not the invoice's. A September
  invoice returned in October is in September's invoices and October's credit
  notes, and the October credit note still names the September invoice.

**Errors:** 400 when a date is missing, malformed, or `fromDate` is after
`toDate`.

## Which documents are included

| Status | Included? |
|---|---|
| `POSTED` | **Yes, exactly once** |
| `DRAFT` | No |
| `CANCELLED` | No |

The one exception is `documentsIssued`, which reports the number series a period
consumed — a cancelled number still came out of the series, so it is counted there
and reported separately as cancelled.

## Classification

Every outward line lands in exactly one bucket:

| Bucket | Rule |
|---|---|
| `b2b` | the buyer had a GSTIN on the document |
| `b2c` | the buyer had none |
| `unclassified` | the document has **no place of supply** — written before GST was enabled |

`unclassified` carries `reason: "NO_PLACE_OF_SUPPLY"`. Such a document is never
guessed into B2C and never silently dropped.

---

## GET /api/v1/tax/returns/gstr-1

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`
- **Query:** `fromDate`, `toDate` (both required, `YYYY-MM-DD`)

```bash
curl "http://localhost:4000/api/v1/tax/returns/gstr-1?fromDate=2026-09-01&toDate=2026-09-30" \
  -H "Authorization: Bearer <token>"
```

```json
{
  "success": true,
  "data": {
    "gstr1": {
      "period": {
        "fromDate": "2026-09-01", "toDate": "2026-09-30",
        "boundsInclusive": true,
        "basis": "Document business date (invoice date / credit note date)",
        "includedStatuses": ["POSTED"],
        "excludedStatuses": ["DRAFT", "CANCELLED"]
      },

      "b2b": {
        "description": "Outward supplies to registered persons (buyer GSTIN present)",
        "parties": [
          {
            "gstin": "27AAACC1206D1ZM",
            "name": "Ravi Medicals",
            "documentCount": 1,
            "documents": [
              {
                "documentId": "8a1b...", "documentNumber": "INV-2026-000001",
                "documentDate": "2026-09-10", "documentValue": "2360.00",
                "counterpartyGstin": "27AAACC1206D1ZM",
                "counterpartyName": "Ravi Medicals",
                "supplyType": "INTRA_STATE",
                "placeOfSupply": { "stateCode": "27", "stateName": "Maharashtra" },
                "items": [
                  { "taxRate": "18.00", "taxTreatment": "TAXABLE",
                    "taxableAmount": "2000.00", "cgst": "180.00", "sgst": "180.00",
                    "igst": "0.00", "cess": "0.00", "totalTax": "360.00" }
                ],
                "taxableAmount": "2000.00", "cgst": "180.00", "sgst": "180.00",
                "igst": "0.00", "cess": "0.00", "totalTax": "360.00"
              }
            ],
            "taxableAmount": "2000.00", "totalTax": "360.00"
          }
        ],
        "totals": { "taxableAmount": "2000.00", "totalTax": "360.00" }
      },

      "b2c": {
        "note": "The statutory B2CL / B2CS split by invoice value is not applied. See the limitations.",
        "documents": [ ],
        "byPlaceOfSupplyAndRate": [
          { "stateCode": "27", "stateName": "Maharashtra", "taxRate": "18.00",
            "taxableAmount": "2000.00", "totalTax": "360.00" }
        ],
        "totals": { }
      },

      "creditNotes": {
        "registered": {
          "parties": [
            {
              "gstin": "27AAACC1206D1ZM",
              "documents": [
                {
                  "documentNumber": "SR-2026-000001", "documentDate": "2026-09-20",
                  "originalInvoiceId": "8a1b...",
                  "originalInvoiceNumber": "INV-2026-000001",
                  "originalInvoiceDate": "2026-09-10",
                  "cgst": "72.00", "sgst": "72.00", "totalTax": "144.00"
                }
              ]
            }
          ],
          "totals": { }
        },
        "unregistered": { "documents": [ ], "totals": { } },
        "totals": { "totalTax": "144.00" }
      },

      "nilRatedExemptZeroRated": {
        "byTreatment": [ { "taxTreatment": "EXEMPT", "taxableAmount": "1000.00", "totalTax": "0.00" } ],
        "totals": { }
      },

      "hsnSummary": {
        "rows": [
          { "hsn": "30049011", "isClassified": true, "description": "Paracetamol 500mg",
            "taxRate": "18.00", "taxableAmount": "1200.00", "totalTax": "216.00" }
        ],
        "totals": { }
      },

      "rateSummary": { "rows": [ { "taxRate": "18.00", "documentCount": 1 } ], "totals": { } },
      "placeOfSupplySummary": { "rows": [ ], "totals": { } },

      "documentsIssued": {
        "rows": [
          { "documentType": "Tax invoice", "from": "INV-2026-000001", "to": "INV-2026-000004",
            "totalIssued": 4, "cancelled": 1, "net": 3 },
          { "documentType": "Credit note", "totalIssued": 1, "cancelled": 0, "net": 1 }
        ]
      },

      "unclassified": {
        "reason": "NO_PLACE_OF_SUPPLY",
        "invoices": [ ], "creditNotes": [ ],
        "invoiceTotals": { }, "creditNoteTotals": { }, "totals": { }
      },

      "totals": {
        "invoices": { "taxableAmount": "2000.00", "totalTax": "360.00" },
        "creditNotes": { "totalTax": "144.00" },
        "net": { "totalTax": "216.00" },
        "invoiceCount": 1,
        "creditNoteCount": 1
      },

      "notFiled": "GSTR-1 preparation dataset built from posted documents in this system. Not a filed return, not validated against the GST portal, and not a legal declaration."
    }
  }
}
```

**Credit notes appear only in `creditNotes`** — never in `b2b` or `b2c` — and
always name the invoice they reverse. Their amounts read **positive** in their own
table; the summaries (`hsnSummary`, `rateSummary`, `placeOfSupplySummary`,
`totals.net`) are **net of them**.

**Nil-rated and exempt lines stay on their invoices.**
`nilRatedExemptZeroRated` is a view over the same rows, not a fourth bucket —
removing lines from an invoice would misrepresent a real document.

---

## GET /api/v1/tax/returns/gstr-3b

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`
- **Query:** `fromDate`, `toDate` (both required)

```json
{
  "success": true,
  "data": {
    "gstr3b": {
      "period": { },

      "outwardSupplies": {
        "taxableSupplies": {
          "label": "(a) Outward taxable supplies, other than zero-rated, nil-rated and exempted",
          "taxableAmount": "1200.00", "cgst": "108.00", "sgst": "108.00",
          "igst": "0.00", "cess": "0.00", "totalTax": "216.00",
          "gross": { "totalTax": "360.00" },
          "lessCreditNotes": { "totalTax": "144.00" }
        },
        "nilRatedExemptSupplies": { "label": "(c) Other outward supplies (nil-rated, exempted, zero-rated)" },
        "reverseChargeSupplies": {
          "label": "(d) Inward supplies liable to reverse charge",
          "totalTax": "0.00",
          "notDetermined": "Reverse charge is not modelled by this system."
        },
        "totals": { }
      },

      "interStateSuppliesToUnregistered": {
        "rows": [ { "stateCode": "29", "stateName": "Karnataka", "igst": "360.00" } ],
        "totals": { }
      },

      "inputTaxCredit": {
        "allOtherItc": {
          "label": "(A)(5) All other ITC",
          "cgst": "900.00", "sgst": "900.00", "totalTax": "1800.00",
          "basis": "All input tax recorded on posted purchases in the period."
        },
        "itcReversed": {
          "label": "(B)(2) ITC reversed - others",
          "totalTax": "180.00",
          "basis": "Input tax given back on posted purchase returns in the period."
        },
        "netItcAvailable": { "label": "(C) Net ITC available (A - B)", "totalTax": "1620.00" },
        "notDetermined": {
          "items": [
            { "item": "Import of goods and services",
              "reason": "The system does not record whether a purchase is an import." },
            { "item": "Inward supplies liable to reverse charge",
              "reason": "Reverse charge is not modelled: every purchase books ordinary input tax." },
            { "item": "Input Service Distributor credit", "reason": "ISD documents are not modelled." },
            { "item": "Ineligible credit under section 17(5)",
              "reason": "Blocked-credit categories are not recorded against a purchase, so no credit is classified ineligible." },
            { "item": "Reversal under rules 42 and 43",
              "reason": "Proportional reversal for exempt supplies and capital goods is not computed; capital goods are not distinguished from stock." }
          ]
        },
        "byRate": [ { "taxRate": "18.00", "totalTax": "1800.00" } ]
      },

      "netPosition": {
        "totalTax": "-1404.00",
        "position": "CREDIT",
        "notDetermined": "Interest, late fee, cash-ledger balances and the actual payment of tax are not modelled."
      },

      "unclassified": { "reason": "NO_PLACE_OF_SUPPLY", "documentCount": 0, "totals": { } },
      "sourceTotals": { },
      "notFiled": "GSTR-3B preparation dataset ..."
    }
  }
}
```

**Taxable and non-taxable are separated by treatment, not by rate** — a 0% taxable
supply is not an exempt one.

**All input tax goes into one bucket.** ITC eligibility turns on reverse charge,
imports, ISD, blocked credits under section 17(5) and rule 42/43 reversals, and
this system records none of them. Each unavailable bucket is named in
`notDetermined` **with a reason**, rather than reported as zero.

`netPosition` is an internal figure, not a payable amount.

---

## GET /api/v1/tax/returns/reconciliation

Around thirty checks, each comparing two figures **arrived at different ways**.

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`
- **Query:** `fromDate`, `toDate` (both required)

```json
{
  "success": true,
  "data": {
    "reconciliation": {
      "period": { },
      "documentCounts": { "SALES_INVOICE": 3, "SALES_RETURN": 1, "PURCHASE": 1, "PURCHASE_RETURN": 1 },
      "summary": { "totalChecks": 46, "passed": 46, "failed": 0, "isReconciled": true },
      "checks": [
        {
          "check": "source.SALES_INVOICE.tax",
          "description": "Sales invoices: document totals vs the sum of their lines - total tax",
          "comparedAtDecimalPlaces": 4,
          "expected": "360.00", "actual": "360.00", "difference": "0.00", "ok": true
        }
      ],
      "failedChecks": [],
      "ledgerComparison": {
        "rows": [ { "code": "1510", "name": "Input CGST", "balance": "900.00" } ],
        "aggregateAccounts": { "balance": "0.00", "isZero": true }
      },
      "note": "Internal reconciliation of the GST return preparation datasets against the documents and the general ledger. Not a filing validation."
    }
  }
}
```

What is checked:

| Check family | What it proves |
|---|---|
| `source.*` | a document's header totals agree with the sum of its own lines |
| `components.*` | CGST + SGST + IGST + Cess equals total tax, on GST-split documents |
| `components.unsplit.*` | a document with no place of supply carries no split |
| `grouping.*` | grouping by rate, HSN, place of supply and document loses nothing |
| `gstr1.*` | the GSTR-1 tables agree with the posted documents |
| `gstr1.classification.*` | every line is in exactly one of b2b / b2c / unclassified |
| `gstr3b.*` | the GSTR-3B summary agrees with the datasets underneath it |
| `ledger.*` | split tax matches the component GST accounts, un-split tax matches the aggregate ones |
| `rounding.display` | the published parts add to the published whole |
| `rounding.precision` | what 2-decimal display costs against the full-precision figure |

**A failing check is reported, not thrown.** The endpoint still answers, with
`isReconciled: false`, a populated `failedChecks`, and both sides plus the
difference for every check — a reconciliation that refuses to respond when
something is wrong is useless exactly when it is needed.

---

## Not implemented in this phase

GST portal integration and filing, GSTR-1/GSTR-3B submission or offline-utility
JSON export, e-invoice IRN, e-way bills, amendment tables (9A/9C), advances
received and adjusted (11A/11B), the statutory B2CL/B2CS split, ITC eligibility
classification, reverse-charge liability, export/SEZ refund workflows, unit of
measure and quantity in the HSN table, tax-period locking, and any storage or
snapshot of a prepared return.

---

# Dashboard, Reports and Credit

The everyday business layer: what happened today, what is owed, what is held.

> **GST is not required for any of it.** No endpoint in this section reads a
> GSTIN, a place of supply or a tax component. A shop that has never registered
> for GST gets the same dashboard, the same credit book and the same reports, with
> the same numbers, as a registered business.

| Rule | Behaviour |
|---|---|
| **Authentication** | Required on every endpoint. |
| **Role** | `ADMIN` and `STAFF` — the same as every other read. |
| **Method** | `GET` only. There is no write endpoint in this section, for any role. |
| **Tenant** | Company scoped. Another company's documents never appear. |
| **Documents** | Only `POSTED` ones count. Drafts and cancelled documents are excluded everywhere. |
| **Money** | Decimal throughout, serialized as 2-decimal strings. |
| **Dates** | Business dates, `YYYY-MM-DD`, both bounds inclusive. |

## Where the numbers come from

Nothing here is a second accounting calculation. Each report calls the module that
owns its figures:

| Report | Source |
|---|---|
| Profit & loss | the general ledger's own P&L service |
| General ledger | the journal |
| Customer / supplier ledger | delegated whole to those sub-ledgers |
| Customer / supplier outstanding | the sub-ledgers' own per-invoice figures |
| Inventory valuation | quantity × average cost, the inventory module's arithmetic |
| Cash & bank | the journal, on accounts `1000` and `1010` |
| Sales / purchases / receipts / payments | the posted documents |

---

## GET /api/v1/dashboard

- **Authentication:** required · **Role:** `ADMIN` or `STAFF`
- **Query:** `date` (`YYYY-MM-DD`, optional)

`date` defaults to **today in the company's own timezone**, from
`CompanySettings.timezone` — not the server's UTC date. For a shop in Mumbai,
sales made at 06:00 IST belong to today, not yesterday.

```json
{
  "success": true,
  "data": {
    "dashboard": {
      "asOf": "2026-09-16",
      "timeZone": "Asia/Kolkata",
      "currency": "INR",
      "gstEnabled": false,

      "today": {
        "period": { "label": "Today", "fromDate": "2026-09-16", "toDate": "2026-09-16" },
        "sales":     { "total": "3000.00", "returns": "400.00", "net": "2600.00",
                       "invoiceCount": 2, "returnCount": 1 },
        "purchases": { "total": "50000.00", "returns": "1000.00", "net": "49000.00",
                       "billCount": 1, "returnCount": 1 },
        "moneyReceived": { "total": "800.00", "againstInvoices": "800.00",
                           "advance": "0.00", "receiptCount": 1 },
        "moneyPaid":     { "total": "20000.00", "againstBills": "20000.00",
                           "advance": "0.00", "paymentCount": 1 },
        "netCashMovement": "-19200.00",
        "costOfGoodsSold": "1300.00",
        "grossMargin": "1300.00"
      },
      "thisWeek": { },
      "thisMonth": { },

      "comparisons": {
        "salesTodayVsYesterday":     { "current": "2600.00", "previous": "0.00",
                                       "change": "2600.00", "changePercent": null,
                                       "direction": "UP" },
        "salesThisWeekVsLast": { },
        "salesThisMonthVsLast": { },
        "purchasesThisMonthVsLast": { },
        "collectionsThisMonthVsLast": { }
      },

      "balances": {
        "customerReceivables": { "total": "3800.00", "invoiceCount": 3,
                                 "overdue": "2000.00", "overdueCount": 1 },
        "supplierPayables":    { "total": "79000.00", "billCount": 2,
                                 "overdue": "0.00", "overdueCount": 0 },
        "netCreditPosition": "-75200.00",
        "cashAndBank": {
          "accounts": [
            { "code": "1000", "name": "Cash", "moneyIn": "800.00", "moneyOut": "0.00",
              "netMovement": "800.00", "balance": "800.00" }
          ],
          "totalBalance": "-19200.00",
          "totalMovement": "-19200.00"
        },
        "inventory": { "totalValue": "48700.00", "itemCount": 1, "lowStockCount": 0 }
      },

      "profit": {
        "period": { "label": "This month", "fromDate": "2026-09-01", "toDate": "2026-09-30" },
        "revenue": "3000.00", "salesReturns": "400.00", "netRevenue": "2600.00",
        "costOfGoodsSold": "1300.00", "grossProfit": "1300.00",
        "otherExpenses": "0.00", "netProfit": "1300.00",
        "basis": "Derived from posted journal entries. Reliable only for what this system records: there is no expense-entry document, so operating costs such as rent and salaries do not appear."
      }
    }
  }
}
```

**`gstEnabled` is the only GST-related field.** It tells a client whether to offer
GST screens; nothing else on the dashboard depends on it.

**Periods** are today, this week (Monday–Sunday) and this month, each compared
against the **whole** previous equivalent period — never a partial one.
`changePercent` is `null` when the previous period was zero: "up from nothing" has
no percentage.

**Profit is not computed here.** It is the general ledger's own P&L for the month
to date, and `basis` states plainly what it can and cannot include.

---

## GET /api/v1/credit

The credit book — *udhaar* — on one screen.

- **Query:** `asOfDate`, `overdueOnly` (`true`/`false`), `minimumAmount`

```json
{
  "credit": {
    "asOf": "2026-09-16",
    "owedToMe": {
      "question": "Who owes me money?",
      "partyCount": 2, "total": "3800.00",
      "overdue": "2000.00", "notYetDue": "1800.00", "overduePartyCount": 1,
      "ageing": [ { "bucket": "0-30", "amount": "3800.00" } ],
      "topCustomers": [ ]
    },
    "owedByMe": { "question": "Whom do I owe?", "total": "79000.00", "topSuppliers": [ ] },
    "netPosition": "-75200.00",
    "netDirection": "OWED_BY_ME"
  }
}
```

## GET /api/v1/credit/receivables · GET /api/v1/credit/payables

One row per party, **biggest debt first** — the order a shopkeeper chases in.

```json
{
  "partyId": "9f1c...",
  "name": "Ravi Medicals",
  "phone": "+91 98200 12345",

  "outstanding": "3200.00",
  "billed": "4000.00",
  "paid": "800.00",
  "credited": "0.00",
  "invoiceCount": 2,

  "oldestDocumentDate": "2026-08-20",
  "oldestDocumentNumber": "INV-2026-000001",
  "ageInDays": 27,
  "ageingBucket": "0-30",

  "overdue": "2000.00",
  "overdueCount": 1,
  "isOverdue": true,
  "earliestDueDate": "2026-09-15",

  "lastPayment": { "number": "RCP-2026-000001", "date": "2026-09-16", "amount": "800.00" },

  "creditLimit": "0.00"
}
```

Ageing buckets are `0-30`, `31-60`, `61-90`, `90+`, and `UNDATED` when there is no
date to age from. `creditLimit` is reported but **never enforced** by this system.

Filters: `overdueOnly=true` keeps only parties past a due date; `minimumAmount`
hides small balances.

## GET /api/v1/credit/customers/:id · GET /api/v1/credit/suppliers/:id

One party's whole position: their balance, their open documents and their full
ledger — each delegated to the sub-ledger that owns it.

**Errors:** 404 for another company's party.

---

## Reports

All under `/api/v1/reports`. All `GET`, all company-scoped, all `POSTED`-only.

| Endpoint | Query |
|---|---|
| `/sales` | `fromDate`, `toDate`, `customerId`, `page`, `limit` |
| `/purchases` | `fromDate`, `toDate`, `supplierId`, `page`, `limit` |
| `/customer-outstanding` | `asOfDate`, `overdueOnly`, `minimumAmount` |
| `/supplier-outstanding` | `asOfDate`, `overdueOnly`, `minimumAmount` |
| `/customer-ledger/:id` | `fromDate`, `toDate` |
| `/supplier-ledger/:id` | `fromDate`, `toDate` |
| `/payments-received` | `fromDate`, `toDate`, `customerId`, `page`, `limit` |
| `/supplier-payments` | `fromDate`, `toDate`, `supplierId`, `page`, `limit` |
| `/expenses` | `fromDate`, `toDate`, `status`, `expenseAccountId`, `paymentMode`, `paymentAccountId`, `supplierId` |
| `/inventory-valuation` | `lowStockOnly` |
| `/profit-loss` | `fromDate`, `toDate` |
| `/general-ledger` | `fromDate`, `toDate`, `accountId`, `page`, `limit` |
| `/cash-bank` | `fromDate`, `toDate`, `page`, `limit` |

Both date bounds are optional and **inclusive** — unlike a GST return, "everything
so far" is a sensible business report. A reversed range is a 400.

**A report's totals always describe exactly the rows it is showing.** Filtering by
customer filters the totals too: a footer that contradicts the body is worse than
no footer. Totals cover the whole period, never just the current page.

### GET /api/v1/reports/sales

```json
{
  "report": {
    "period": { "fromDate": "2026-09-01", "toDate": "2026-09-30" },
    "invoices": [
      {
        "invoiceNumber": "INV-2026-000002", "invoiceDate": "2026-09-16",
        "customer": { "id": "9f1c...", "name": "Ravi Medicals" },
        "subtotal": "2000.00", "discount": "0.00", "tax": "0.00", "total": "2000.00",
        "costOfGoodsSold": "1000.00", "grossMargin": "1000.00",
        "outstanding": "1200.00", "paid": "800.00", "paymentStatus": "PARTIALLY_PAID"
      }
    ],
    "pagination": { "page": 1, "limit": 20, "total": 2, "totalPages": 1 },
    "totals": {
      "description": "The whole period, not just this page.",
      "invoiceCount": 2, "total": "3000.00",
      "returns": "400.00", "returnCount": 1, "netSales": "2600.00",
      "costOfGoodsSold": "1300.00", "grossMargin": "1300.00"
    }
  }
}
```

`outstanding` and `paid` come straight from the receivable the posting transaction
maintains — not recomputed here.

### GET /api/v1/reports/inventory-valuation

Valued at moving weighted average cost, `quantity × averageCost` rounded per
balance — the same figure the Inventory control account carries in the general
ledger.

```json
{
  "items": [
    { "product": "Paracetamol 500mg", "sku": "SKU-PARA-500",
      "warehouse": { "code": "MAIN", "name": "Main Warehouse" },
      "quantity": "487.000", "averageCost": "100.0000", "value": "48700.00",
      "reorderLevel": "20.000", "isLowStock": false }
  ],
  "totals": { "itemCount": 1, "totalValue": "48700.00", "lowStockCount": 0 }
}
```

### GET /api/v1/reports/cash-bank

Built from posted journal entries on the Cash and Bank accounts — so it includes
**every** movement of money, not only customer receipts and supplier payments.

```json
{
  "report": {
    "accounts": [
      { "code": "1000", "name": "Cash", "openingBalance": "0.00",
        "moneyIn": "800.00", "moneyOut": "0.00", "closingBalance": "800.00" }
    ],
    "movements": [
      { "date": "2026-09-16", "account": { "code": "1000", "name": "Cash" },
        "journalNumber": "JV-2026-000005", "description": "Receipt RCP-2026-000001",
        "sourceType": "CUSTOMER_PAYMENT", "sourceId": "aa11...",
        "moneyIn": "800.00", "moneyOut": "0.00" }
    ],
    "totals": { "openingBalance": "0.00", "moneyIn": "800.00", "moneyOut": "20000.00",
                "netMovement": "-19200.00", "closingBalance": "-19200.00" }
  }
}
```

Every movement names its source document, so it traces back through
`GET /journal-entries/source/:sourceType/:sourceId`.

---

## Not implemented in this section

Cash-flow statements, dunning and late-fee interest, trend/chart series, scheduled or
emailed reports, and PDF or Excel export. Every endpoint returns structured JSON.

Operating expenses *are* now recorded — see **Expenses** below — so the P&L's
`otherExpenses` and the dashboard's `profit.operatingExpenses` are real figures
rather than cost of goods sold alone.

---

# Expenses

Rent, the electricity bill, salaries, the boy who delivers. This is the document
the system was missing: before it, the profit and loss could show gross profit
but never net profit, because there was nowhere to record what running the
business costs.

An expense is the simplest document here. No items, no stock, no tax, no party
balance. It has a date, a category, an amount, and where the money came from.

## The lifecycle

```
DRAFT ──post──> POSTED ──reverse──> REVERSED
  │
  └──cancel──> CANCELLED
```

* A **DRAFT** has no accounting effect at all. It has paid nobody. It can be
  edited freely or cancelled.
* **POSTED** is the only status that is money. Posting writes exactly one
  balanced journal entry, in the same transaction as the status change.
* A posted expense is **immutable**. It cannot be edited, re-posted, cancelled
  or deleted. There is no `DELETE` route on this module.
* **REVERSED** undoes a posting with a *new*, opposite journal entry. The
  original entry is never touched.

## The journal entry

One entry, two lines, always:

```
Dr  <expense category account>     amount
      Cr  Cash (1000) or Bank (1010)   amount
```

Reversal swaps the two sides and is stored as source type `EXPENSE_REVERSAL`
against the same expense id. Because `(companyId, sourceType, sourceId)` is
unique on `journal_entries`, a second posting or a second reversal of the same
expense is structurally impossible — not merely guarded against.

## Categories are accounts

There is no category table. An expense category **is** an `EXPENSE` account in
the company's own chart of accounts. That is why the expense report, the profit
and loss and the general ledger can never disagree: they are reading the same
rows.

Fifteen accounts are seeded for every company:

| Code | Name |
|---|---|
| `5200` | Operating Expenses *(parent — not selectable)* |
| `5210` | Rent |
| `5215` | Electricity |
| `5220` | Water |
| `5225` | Internet & Telephone |
| `5230` | Salaries & Wages |
| `5235` | Transportation |
| `5240` | Repairs & Maintenance |
| `5245` | Office Expenses |
| `5250` | Packaging |
| `5255` | Advertising & Marketing |
| `5260` | Bank Charges |
| `5265` | Professional Fees |
| `5270` | Insurance |
| `5290` | Miscellaneous Expenses |

A business that wants its own category creates an `EXPENSE` account through
`POST /api/v1/accounts` and it appears in the category list immediately. Nothing
in the posting logic matches on a category *name*, so renaming Rent to anything
you like changes nothing about the accounting.

Three expense accounts are **refused** as categories, because other document
flows maintain them:

| Code | Why |
|---|---|
| `5000` Cost of Goods Sold | Posting rent here would silently corrupt gross profit |
| `5100` Inventory Valuation Adjustment | Written by inventory postings |
| `5200` Operating Expenses | A grouping parent; nothing posts to it directly |

## GST

**An expense has no tax fields whatsoever.** No GSTIN, no HSN, no place of
supply, no tax rate, no CGST/SGST/IGST. A shop with no GST registration records
rent exactly as a registered company does, and a registered company's expense
produces the same two-line entry — no input tax credit is claimed and nothing
reaches a GST return. See *Known limitations* below.

---

## GET /api/v1/expenses/categories

Every category this company may choose from: active `EXPENSE` accounts, minus
the three protected codes above. Declared before `/:id`, so `categories` is
never read as an expense id.

`ADMIN` and `STAFF`.

```json
{
  "success": true,
  "data": {
    "categories": [
      { "accountId": "uuid", "code": "5210", "name": "Rent", "isSystem": true },
      { "accountId": "uuid", "code": "5296", "name": "Pooja & Festival", "isSystem": false }
    ]
  }
}
```

## POST /api/v1/expenses

Creates a `DRAFT`. `ADMIN` and `STAFF`.

```json
{
  "expenseDate": "2026-09-16",
  "expenseAccountId": "uuid of an EXPENSE account",
  "amount": "20000.00",
  "paymentMode": "CASH",
  "paymentAccountId": null,
  "supplierId": null,
  "description": "September shop rent",
  "referenceNumber": "RCPT-8891",
  "notes": null
}
```

| Field | Rule |
|---|---|
| `expenseDate` | required, `YYYY-MM-DD`, stored at UTC midnight |
| `expenseAccountId` | required, uuid of an active `EXPENSE` account of **this** company |
| `amount` | required, at most 2 decimal places, **must be more than zero** |
| `paymentMode` | required, `CASH` or `BANK` |
| `paymentAccountId` | optional. Omitted, `paymentMode` picks the system Cash (`1000`) or Bank (`1010`) account. Given, it must be an active `ASSET` account of this company — that is how a business with a second bank account names it. |
| `supplierId` | optional and **purely informational**. It records who was paid; it raises no payable and writes nothing to the supplier ledger. |
| `description`, `referenceNumber`, `notes` | optional free text |

Response `201`:

```json
{
  "success": true,
  "message": "Expense draft created successfully",
  "data": {
    "expense": {
      "id": "uuid",
      "expenseNumber": "EXP-2026-000001",
      "expenseDate": "2026-09-16",
      "status": "DRAFT",
      "amount": "20000.00",
      "description": "September shop rent",
      "category": {
        "accountId": "uuid",
        "code": "5210",
        "name": "Rent",
        "currentName": "Rent"
      },
      "paymentMode": "CASH",
      "paidFrom": {
        "accountId": "uuid",
        "code": "1000",
        "name": "Cash",
        "currentName": "Cash"
      },
      "supplier": null,
      "referenceNumber": "RCPT-8891",
      "notes": null,
      "affectsAccounts": false,
      "createdBy": { "id": "uuid", "name": "Ramesh" },
      "postedBy": null,
      "postedAt": null,
      "cancelledBy": null,
      "cancelledAt": null,
      "reversedBy": null,
      "reversedAt": null,
      "createdAt": "2026-09-16T10:12:04.881Z",
      "updatedAt": "2026-09-16T10:12:04.881Z"
    }
  }
}
```

`name` is the **snapshot** taken when the expense was recorded; `currentName` is
what the account is called today. Renaming an account never rewrites history.

`affectsAccounts` is `true` only for `POSTED`.

Errors:

| Status | Code | When |
|---|---|---|
| 400 | — | schema validation (missing field, bad date, three decimal places, unknown payment mode) |
| 404 | `EXPENSE_CATEGORY_NOT_FOUND` | no such account, **or it belongs to another company** |
| 422 | `INVALID_EXPENSE_CATEGORY` | not an `EXPENSE` account, or one of the three protected codes |
| 422 | `EXPENSE_CATEGORY_INACTIVE` | the category is deactivated |
| 404 | `PAYMENT_ACCOUNT_NOT_FOUND` | no such account, or another company's |
| 422 | `INVALID_PAYMENT_ACCOUNT` | money can only leave an `ASSET` account |
| 422 | `PAYMENT_ACCOUNT_INACTIVE` | the payment account is deactivated |
| 404 | `SUPPLIER_NOT_FOUND` | no such supplier, or another company's |
| 422 | `SUPPLIER_INACTIVE` | the supplier is deactivated |
| 422 | `INVALID_EXPENSE_AMOUNT` | amount is zero |

## PATCH /api/v1/expenses/:id

Replaces a draft. Same body and same rules as `POST`. `ADMIN` and `STAFF`.

The expense number never changes. Every other field may, including the category
and the payment mode.

| Status | Code |
|---|---|
| 404 | `EXPENSE_NOT_FOUND` |
| 409 | `EXPENSE_ALREADY_POSTED` |
| 409 | `EXPENSE_NOT_DRAFT` (cancelled or reversed) |

## POST /api/v1/expenses/:id/post

`ADMIN` only. The one call that touches the books.

The row is locked with `SELECT … FOR UPDATE`, the category and payment account
are re-checked (either may have been deactivated since the draft was written),
the journal entry is written, and the status moves to `POSTED` — all in one
transaction. If any step fails, the expense stays a draft and no money is
recorded as having left.

| Status | Code |
|---|---|
| 404 | `EXPENSE_NOT_FOUND` |
| 409 | `EXPENSE_ALREADY_POSTED` |
| 409 | `EXPENSE_NOT_DRAFT` |
| 422 | `EXPENSE_CATEGORY_INACTIVE`, `PAYMENT_ACCOUNT_INACTIVE` |

Two simultaneous posts of the same expense produce one `200` and one `409`, and
exactly one journal entry.

## POST /api/v1/expenses/:id/cancel

`ADMIN` only. Abandons a **draft**. Nothing reaches the ledger, because nothing
ever had.

A posted expense cannot be cancelled: money left the business and the ledger
says so. The `409 EXPENSE_ALREADY_POSTED` message says to reverse it instead.

## POST /api/v1/expenses/:id/reverse

`ADMIN` only. Undoes a **posted** expense.

This exists because an expense has no "return" document. A mistyped posted
amount would otherwise be permanently wrong with no remedy.

A new journal entry swaps the two sides, so the category and the bank balance
both return to where they were, and **both** postings stay visible in the
ledger. The original entry is never modified.

| Status | Code |
|---|---|
| 404 | `EXPENSE_NOT_FOUND` |
| 409 | `EXPENSE_NOT_POSTED` |
| 409 | `EXPENSE_ALREADY_REVERSED` |

## GET /api/v1/expenses

Paginated, newest first. `ADMIN` and `STAFF`.

| Query | Values |
|---|---|
| `status` | `DRAFT`, `POSTED`, `CANCELLED`, `REVERSED` |
| `expenseAccountId` | uuid |
| `paymentMode` | `CASH`, `BANK` |
| `paymentAccountId` | uuid |
| `supplierId` | uuid |
| `fromDate`, `toDate` | `YYYY-MM-DD`, inclusive |
| `search` | free text |
| `page`, `limit` | pagination |

## GET /api/v1/expenses/:id

One expense, in the shape above. Another company's expense is a `404`.

---

## GET /api/v1/reports/expenses

Under the reports module. `fromDate`, `toDate`, `status`, `expenseAccountId`,
`paymentMode`, `paymentAccountId`, `supplierId`. Not paginated.

**Only posted expenses are money.** Every financial total counts `POSTED` and
nothing else: a draft has paid nobody, a cancelled one never happened, and a
reversed one was undone by an opposite entry and nets to zero. Those three are
not hidden — `otherStatuses` reports each with its own count and amount and
`includedInTotals: false`, so a draft sitting unposted is visible rather than
silently missing.

```json
{
  "success": true,
  "data": {
    "report": {
      "period": { "label": "Selected period", "fromDate": "2026-09-01", "toDate": "2026-09-30" },
      "basis": {
        "countedStatus": "POSTED",
        "description": "Financial totals count POSTED expenses only. ..."
      },
      "totals": {
        "totalExpenses": "36500.00",
        "expenseCount": 3,
        "largestCategory": { "category": "Rent", "amount": "20000.00" }
      },
      "byCategory": [
        { "accountId": "uuid", "category": "Rent", "expenseCount": 1, "amount": "20000.00" }
      ],
      "byPaymentMode": [
        { "paymentMode": "BANK", "expenseCount": 1, "amount": "4500.00" },
        { "paymentMode": "CASH", "expenseCount": 2, "amount": "32000.00" }
      ],
      "byPaymentAccount": [
        { "accountId": "uuid", "account": "Cash", "expenseCount": 2, "amount": "32000.00" }
      ],
      "byDate": [
        { "date": "2026-09-05", "expenseCount": 1, "amount": "12000.00" }
      ],
      "otherStatuses": [
        { "status": "DRAFT", "reason": "Prepared but not posted. ...", "count": 1, "amount": "9999.00", "includedInTotals": false }
      ],
      "note": "Every posted expense here is one balanced journal entry ..."
    }
  }
}
```

The four groupings are the same filtered rows grouped four ways, so **each adds
back up to `totals.totalExpenses`** — and to `otherExpenses.total` in the profit
and loss, because both are the same posted journal entries.

## What else changed

**`GET /api/v1/dashboard`** — each period block (`today`, `thisWeek`,
`thisMonth`, `previousMonth`) gained:

```json
"expenses": { "total": "24500.00", "expenseCount": 2 },
"netMargin": "-24500.00"
```

`netCashMovement` now subtracts expenses, because an expense really does take
money out of Cash or Bank. `comparisons` gained `expensesThisMonthVsLast`.

The `profit` block gained `operatingExpenses` (`otherExpenses` is kept under its
old name so nothing reading the previous shape breaks), and its `basis` no
longer says operating costs cannot be recorded:

```
Gross profit  = revenue net of returns and tax, less cost of goods sold
Net profit    = gross profit, less operating expenses
```

**`GET /api/v1/reports/cash-bank`** — posted expenses now appear as movements,
each carrying `sourceType: "EXPENSE"` (or `"EXPENSE_REVERSAL"`) and its
`sourceId`, so every line traces back to the document that caused it. Its `note`
states explicitly that there are no opening balances in this system: a balance
is everything the ledger has recorded, from the beginning.

**`GET /api/v1/journal-entries`** — `sourceType` accepts `EXPENSE` and
`EXPENSE_REVERSAL`.

## Known limitations

**Credit expenses are not supported.** Every expense in this phase is already
paid, by cash or by bank. There is no "bill received, pay later" expense.

This is deliberate rather than overlooked. `SupplierPayable` carries
`purchaseId String @unique` with a **required** foreign key to `Purchase`, and
the supplier ledger, the credit book, the ageing report and the payment
allocation logic all read `payable.purchase` and assume it exists. Supporting a
credit expense would mean making that column nullable, adding an `expenseId`
alongside it, and revisiting every one of those readers — a schema and
business-rule change large enough that a partial version would be worse than
none. It is recorded here rather than half-built.

**No input tax credit on expenses.** An expense carries no tax at all, so
nothing reaches `GET /api/v1/tax/returns/gstr-3b`. Claiming ITC on an expense
would need a tax-bearing expense line, a supplier GSTIN, an HSN/SAC code and a
place of supply — the full purchase apparatus. Until that exists, an expense
that carried tax would produce a *wrong* return rather than an incomplete one,
so it carries none.

Also absent from this module: recurring expenses, expense approval workflows,
attachments or receipt images, per-user expense claims and reimbursement,
budgets, cost centres, petty-cash floats, depreciation and fixed assets, and
bank reconciliation.

---

---

# Credit, Collections and Statements

Selling on credit is the whole business for most shops that will use this. Until
this phase the system recorded a `creditLimit` on every customer, displayed it in
the credit book, and enforced it nowhere. This phase makes it a rule, adds
payment terms, and puts a proper statement and a chase list on top of the
sub-ledgers that were already there.

**No new financial fact is stored by this layer.** Payment allocation, the
customer and supplier sub-ledgers, and the GL postings for receipts and payments
all existed and are unchanged. Statements, ageing and collection summaries are
reads of those same rows.

## The credit-limit policy

### Zero means unlimited

`creditLimit` defaults to `0` on every customer, and always has. Reading that as
"no credit allowed" would refuse every sale ever made in every existing company.
So:

| Limit | Meaning |
|---|---|
| `0` | **No limit.** The check passes without looking further. |
| Positive | Enforced. A sale that would take the customer past it is refused. |

`isUnlimited: true` appears on the customer and in every credit read, so a client
never has to infer it. `availableCredit` and `utilisationPercent` are **null**
rather than `0` when there is no limit — zero would read as "none left", which is
the opposite of the truth.

**Known limitation:** there is consequently no way to express "this customer gets
*no* credit at all". See *Known limitations* below.

### What counts as exposure

Exposure is the **customer ledger balance** — `sum(debit) − sum(credit)` — not
the sum of open invoices.

| Event | Effect on exposure |
|---|---|
| Posted sales invoice | raises it |
| Posted receipt | lowers it, allocated or not |
| Posted credit note (sales return) | lowers it |
| **Draft** invoice | none — never reaches the ledger |
| **Cancelled** invoice | none — never reached the ledger |
| Customer advance | lowers it, and can make it negative |

Using the ledger rather than open-invoice totals means an advance a customer has
paid genuinely reduces their exposure. A customer in advance shows
`utilisationPercent: "0.00"` and the full limit available — their money is not
extra credit, so available never exceeds the limit.

Drafts and cancelled documents are excluded **by construction**: the sub-ledger
is written only inside a posting transaction, so there is no status filter to
forget.

### Every sale is a credit sale

There is no "cash sale" document. A sales invoice always raises a receivable, and
payment arrives later as a receipt. The credit check therefore runs on **every**
posted sale — which changes nothing for anyone who has not set a limit.

### When the check runs

At **post**, inside the posting transaction, after a `SELECT … FOR UPDATE` on the
customer row. Not at draft: a draft owes nothing, and refusing to *write down* an
order a customer wants is not the system's business.

If the check fails, the whole posting rolls back — no receivable, no stock
movement, no journal entry, and the invoice stays a `DRAFT`.

```
422 CREDIT_LIMIT_EXCEEDED
  "Ramesh Traders would owe 23000.00 against a credit limit of 20000.00
   - 3000.00 over. Posting INV-2026-000014 needs an admin override."
```

### The override

An `ADMIN` may post past a limit deliberately. Refusing outright would be wrong:
a shopkeeper who extends credit to a regular customer is making a business
decision, not a mistake.

```http
POST /api/v1/sales/:id/post
{
  "creditLimitOverride": true,
  "creditLimitOverrideReason": "Regular customer, cheque in hand"
}
```

The body is optional and `.strict()`. An absent body still posts normally, a
reason without the flag is a `400`, and an unknown key is a `400`.

The override is recorded on the invoice with **who** made it, **why**, and **what
was owed at that moment** — frozen, because the live balance moves afterwards and
what was known when the call was made must not.

```json
"creditLimitOverride": {
  "reason": "Regular customer, cheque in hand",
  "outstandingAtOverride": "15000.00"
}
```

Ordinary invoices carry `"creditLimitOverride": null`.

Posting is already `ADMIN`-only, so the override inherits that restriction. **No
new permission was invented.**

## Payment terms

`creditDays` on a customer or supplier. When set, a document with **no explicit
due date** gets `invoiceDate + creditDays`.

| Given | Result |
|---|---|
| An explicit `dueDate` | always wins — someone typed it on purpose |
| No date, terms set | `invoiceDate + creditDays` |
| No date, no terms | undated |

An **undated** document is outstanding but **never overdue**: nobody agreed a
date, so nothing has been missed. Saying otherwise would invent a broken promise.

`creditDays` is `0–3650` or null (a database `CHECK` enforces it too). Zero means
"due on the invoice date".

---

## GET /api/v1/customers/:id/credit

One customer's credit position. `ADMIN` and `STAFF`.

Query: `asOfDate` (defaults to today).

```json
{
  "credit": {
    "customer": { "id": "uuid", "name": "Ramesh Traders", "phone": null, "isActive": true },
    "asOf": "2026-10-15",
    "terms": {
      "creditLimit": "20000.00",
      "isUnlimited": false,
      "creditDays": 30,
      "description": "Sales are refused once Ramesh Traders would owe more than 20000.00, unless an admin overrides."
    },
    "position": {
      "outstanding": "15000.00",
      "availableCredit": "5000.00",
      "utilisationPercent": "75.00",
      "isOverLimit": false,
      "invoiceOutstanding": "15000.00",
      "openInvoiceCount": 2
    },
    "overdue": {
      "amount": "12000.00",
      "invoiceCount": 1,
      "oldestDueDate": "2026-09-01",
      "daysPastDue": 44,
      "undated": "0.00"
    },
    "ageing": [ { "bucket": "NOT_DUE", "amount": "3000.00", "documentCount": 1 } ],
    "lifetime": { "collected": "48000.00", "receiptCount": 6 },
    "basis": "Outstanding is the customer sub-ledger balance..."
  }
}
```

`outstanding` is the ledger balance; `invoiceOutstanding` is the sum of open
invoices. They differ **only** by money the customer has paid that no invoice has
claimed — an advance.

`utilisationPercent` clamps at `"100.00"`; how far past is in `availableCredit:
"0.00"` and `isOverLimit: true`.

## GET /api/v1/customers/:id/statement · GET /api/v1/suppliers/:id/statement

The document you hand a party when they ask what they owe and for what. `ADMIN`
and `STAFF`. Query: `fromDate`, `toDate` (both optional, both inclusive).

```json
{
  "statement": {
    "party": { "id": "uuid", "name": "Ramesh Traders", "creditLimit": "20000.00", "isUnlimited": false, "creditDays": 30 },
    "period": { "fromDate": null, "toDate": null, "label": "Everything so far" },
    "openingBalance": "0.00",
    "lines": [
      {
        "date": "2026-09-01",
        "type": "SALE",
        "label": "Invoice",
        "documentNumber": "INV-2026-000012",
        "documentId": "uuid",
        "referenceType": "SALES_INVOICE",
        "reference": null,
        "dueDate": "2026-10-01",
        "description": "Sales invoice INV-2026-000012",
        "debit": "12000.00",
        "credit": "0.00",
        "balance": "12000.00"
      }
    ],
    "closingBalance": "5000.00",
    "totals": {
      "openingBalance": "0.00",
      "totalDebit": "20000.00",
      "totalCredit": "15000.00",
      "closingBalance": "5000.00",
      "entryCount": 3
    },
    "balanceMeaning": "Positive means the customer owes the business...",
    "basis": "Every line is an entry in the customer sub-ledger..."
  }
}
```

**Semantics:**

* One line per sub-ledger entry, oldest first, with a running balance.
* A window **does not lose history**: everything before `fromDate` is summed into
  `openingBalance`, so `closingBalance` is the party's real position, not just
  the movement inside the window.
* `documentNumber` is fetched from the source document, not copied onto the
  ledger — one fact, one home.
* Drafts and cancelled documents never appear; they never reached the ledger.

**Sign, per side:**

| | Positive balance means | Debit | Credit |
|---|---|---|---|
| Customer | they owe the business | Invoice | Receipt, credit note |
| Supplier | the business owes them | Payment, debit note | Bill |

Labels are `Invoice` / `Receipt` / `Credit note` and `Bill` / `Payment` /
`Debit note`.

## GET /api/v1/credit/collections

The chase list. `ADMIN` and `STAFF`.

Query: `asOfDate`, `fromDate`, `toDate`, `dueWithinDays` (0–365, default 7),
`limit` (1–100, default 10).

```json
{
  "collections": {
    "asOf": "2026-10-15",
    "outstanding": {
      "total": "25000.00",
      "overdue": "12000.00",
      "notYetDue": "8000.00",
      "undated": "5000.00",
      "invoiceCount": 3, "customerCount": 2, "overdueCustomerCount": 1
    },
    "dueSoon": {
      "description": "Falling due in the next 7 day(s), not yet paid.",
      "fromDate": "2026-10-15", "toDate": "2026-10-22",
      "total": "8000.00", "invoiceCount": 1, "customerCount": 1
    },
    "collected": {
      "today": { "date": "2026-10-15", "total": "4000.00", "receiptCount": 1 },
      "period": { "total": "4000.00", "allocated": "0.00", "unallocated": "4000.00", "receiptCount": 1 },
      "basis": "Posted receipts only. A draft receipt has collected nothing and a cancelled one never did."
    },
    "ageing": [
      { "bucket": "NOT_DUE", "amount": "8000.00", "documentCount": 1 },
      { "bucket": "1-30",   "amount": "0.00",    "documentCount": 0 },
      { "bucket": "31-60",  "amount": "12000.00","documentCount": 1 },
      { "bucket": "61-90",  "amount": "0.00",    "documentCount": 0 },
      { "bucket": "90+",    "amount": "0.00",    "documentCount": 0 },
      { "bucket": "UNDATED","amount": "5000.00", "documentCount": 1 }
    ],
    "topOverdueCustomers": [
      { "partyId": "uuid", "name": "Ramesh Traders", "outstanding": "12000.00", "overdue": "12000.00",
        "documentCount": 1, "overdueCount": 1, "oldestDueDate": "2026-09-01",
        "daysPastDue": 44, "overdueBucket": "31-60" }
    ]
  }
}
```

**Ageing is by DAYS PAST DUE, not document age.** "60 days old" and "60 days
late" are different questions and a collections list is asking the second.

Every bucket is always present, even at zero, so a client never handles a missing
key. **The buckets always add back to `outstanding.total`** — they are one pass
over one set of rows.

`UNDATED` is its own bucket rather than folded into `NOT_DUE`: "not late" and "no
date was ever agreed" are different facts, and a collections clerk needs to tell
them apart.

`topOverdueCustomers` ranks by overdue amount, ties broken by days late.

## GET /api/v1/credit/payables-summary

The supplier-side mirror: what the business owes, how late, and whom to pay
first. Same query, same ageing ladder, `topOverdueSuppliers` instead.

## GET /api/v1/credit/exposure

Credit headroom across every customer. `ADMIN` and `STAFF`. Query: `asOfDate`.

```json
{
  "exposure": {
    "summary": {
      "customerCount": 2, "customersWithLimit": 1, "customersWithoutLimit": 1,
      "totalOutstanding": "24000.00",
      "totalCreditLimit": "20000.00",
      "totalAvailableCredit": "5000.00",
      "overLimitCount": 0
    },
    "customers": [ { "customerId": "uuid", "name": "...", "creditLimit": "20000.00",
                     "isUnlimited": false, "outstanding": "15000.00",
                     "availableCredit": "5000.00", "utilisationPercent": "75.00",
                     "overdue": "0.00", "isOverLimit": false, "creditDays": 30 } ],
    "policy": "A credit limit of 0 means UNLIMITED..."
  }
}
```

Totals count only customers with a positive limit — adding "no limit" in would
report a total credit line of zero for a business that has set none, the opposite
of the truth. Customers who owe nothing and have no limit are omitted entirely.

## What else changed

**`GET /api/v1/dashboard`** gained two things.

`balances.customerCredit`:

```json
{
  "customersWithLimit": 1, "customersWithoutLimit": 1,
  "totalCreditLimit": "20000.00", "availableCredit": "5000.00",
  "utilisationPercent": "75.00", "overLimitCount": 0,
  "note": "A credit limit of 0 means unlimited and is excluded from these totals."
}
```

and a top-level `collections` block — money **collected and paid** today, not
money billed:

```json
{
  "description": "Posted receipts and supplier payments dated today.",
  "date": "2026-10-15",
  "received": { "total": "5000.00", "allocated": "0.00", "unallocated": "5000.00", "receiptCount": 1 },
  "paid":     { "total": "0.00", "allocated": "0.00", "unallocated": "0.00", "paymentCount": 0 },
  "net": "5000.00"
}
```

Both respect the company's own timezone, like every other dashboard figure.

**Customers and suppliers** now carry `creditDays` and report `isUnlimited`
alongside `creditLimit`, on create, update and read.

**Sales invoices and purchases** derive their due date from the party's terms
when none is given.

## Payment allocation

Allocation was built in earlier phases and is **unchanged**. Restated here
because Phase 14 tests it exhaustively:

```
Invoice A 12,000 + Invoice B 8,000, receipt 15,000
  -> A: 12,000  (settled, status PAID)
  -> B:  3,000  (5,000 open, status PARTIALLY_PAID)
```

Refused, always:

| Condition | Status | Code |
|---|---|---|
| Allocations total > payment amount | 422 | `PAYMENT_EXCEEDS_OUTSTANDING` |
| One allocation > that invoice's outstanding | 422 | `PAYMENT_ALLOCATION_EXCEEDS_RECEIVABLE` |
| Invoice belongs to a different customer | 422 | `INVALID_PAYMENT_ALLOCATION` |
| Invoice not posted | 422 | `INVALID_PAYMENT_ALLOCATION` |
| Another company's invoice | 404 | `CUSTOMER_RECEIVABLE_NOT_FOUND` |

An unallocated remainder is **customer credit**, posted to Customer Advances
(`2200`) — it is real money the customer has paid.

Outstanding is **never negative**: surplus shows in the customer balance, not as
a negative invoice.

## Accounting

Unchanged, and not bypassed. Every posted receipt and payment produces exactly
one balanced journal entry through the existing GL posting service:

```
Customer receipt      Dr Cash (1000) / Bank (1010)      the money that arrived
                          Cr Accounts Receivable (1200)  what it settled
                          Cr Customer Advances (2200)    the remainder

Supplier payment      Dr Accounts Payable (2000)         what it settled
                          Cr Cash / Bank                 the money that left
```

`(companyId, sourceType, sourceId)` is unique on `journal_entries`, so a second
entry for the same receipt cannot exist.

## Concurrency

| Race | Guard |
|---|---|
| Two invoices breaching one limit together | `SELECT … FOR UPDATE` on the customer row, taken before any stock lock |
| Double posting one receipt | row lock on the payment + unique journal source key |
| Two receipts over-allocating one invoice | receivables locked in id order, amounts **re-checked under the lock** |
| Negative outstanding | `deriveReceivableState` floors at zero |

Lock order for a sales posting is total: **invoice → customer → stock →
journal**. No other flow locks a customer row, so no cycle with another document
type is possible.

## RBAC

| Operation | Role |
|---|---|
| Every read in this module (statements, credit, collections, exposure) | `ADMIN`, `STAFF` |
| Draft a sales invoice or a receipt | `ADMIN`, `STAFF` (unchanged) |
| Post / cancel a sale, receipt or supplier payment | `ADMIN` (unchanged) |
| Credit-limit override | `ADMIN` — inherited from posting, no new permission |
| Set a credit limit or terms on a party | `ADMIN`, `STAFF` (same as any customer edit) |

A staff member who takes payments has to be able to see who owes what, which is
why every read is open to both.

## GST

**Nothing in this module reads a GSTIN, a state code, an HSN code, a tax rate or
a place of supply.** A shop with no registration sells on credit, receives
payment, allocates it, reads a statement, pays suppliers and sees its cash move —
with no GST configuration anywhere. A registered company gets byte-identical
credit behaviour.

## Known limitations

**"No credit at all" cannot be expressed.** `0` means unlimited, forced by the
existing default on every customer row. A business that wants to refuse a
customer credit entirely has no way to say so. Fixing it needs either a nullable
`creditLimit` (a destructive semantics change to existing data) or a separate
`creditPolicy` flag — deliberately not invented here.

**Supplier credit limits are reported, never enforced.** Refusing to record a
bill a supplier has already sent would not stop the liability, it would only hide
it. The asymmetry with customers is intentional.

**The limit is checked at post, not at draft.** A draft can be prepared for any
amount; it is refused when it would hit the books. A client wanting to warn
earlier can read `GET /customers/:id/credit` and compare.

**Overdue needs a due date.** Undated documents are reported separately
(`undated`, and the `UNDATED` bucket) and never counted as overdue. Setting
`creditDays` on a party stops new documents being undated; it does not backfill
existing ones.

**No credit-limit history.** Changing a limit changes it; there is no record of
what it used to be. Only the *override* is audited.

**Also absent:** dunning letters and reminder scheduling, interest or late fees
on overdue balances, customer credit ratings or scoring, write-offs and bad-debt
provisioning, promise-to-pay tracking, statement delivery by email or PDF, and
multi-currency exposure.

---

---

# Opening Balances and Accounting Periods

A shop with ₹50,000 in the till, ₹2,00,000 of stock and customers who owe it
money did not acquire any of that here. This is how it starts using the system
with the books it already has — and how it later stops people posting into a
month it has finished.

## Opening balances

### What they are, and what they are not

An opening balance is an **initialization**, not a transaction. Recording one as
a sale, a purchase or a receipt would put revenue in the books that was never
earned, and it would show up immediately in the profit and loss.

So:

* **No fake documents.** There is no opening invoice, no opening purchase and no
  opening expense. A customer's opening due is a receivable with **no**
  `salesInvoiceId`; a supplier's is a payable with **no** `purchaseId`.
* **One balanced journal entry**, through the same GL posting service every
  document uses.
* **Once per company**, enforced by the database.
* **Never revenue or cost.** Opening stock becomes cost only when it is sold.

### The accounting

```
Dr Cash (1000)                     opening cash
Dr Bank (1010) and its children    opening bank balances
Dr Inventory (1300)                opening stock, at its own valuation
Dr Accounts Receivable (1200)      what customers already owed
    Cr Accounts Payable (2000)     what was already owed to suppliers
    Cr Owner's Capital (3000)      the balancing figure
```

Owner's Capital is not a plug that hides an error — it is the accounting answer:
what the owner has put in is the business's assets less its liabilities. If
liabilities exceed assets the entry reverses and capital is **debited**, which is
equally correct and equally balanced.

Worked from the brief's figures:

| | |
|---|---|
| Cash | 50,000 |
| Bank | 1,00,000 |
| Inventory | 2,00,000 |
| Customer dues | 75,000 |
| **Total debits** | **4,25,000** |
| Supplier dues | 60,000 |
| Opening capital | 3,65,000 |
| **Total credits** | **4,25,000** |

### POST /api/v1/opening-balances

`ADMIN` only. Runs once, in one transaction.

```json
{
  "asOfDate": "2026-04-01",
  "cash": "50000",
  "bankAccounts": [
    { "accountId": "uuid-of-hdfc", "amount": "60000" },
    { "accountId": "uuid-of-sbi",  "amount": "40000" }
  ],
  "customers": [
    { "customerId": "uuid", "amount": "12000", "dueDate": "2026-03-01", "reference": "Bill book p14" },
    { "customerId": "uuid", "amount": "63000" }
  ],
  "suppliers": [
    { "supplierId": "uuid", "amount": "60000", "dueDate": "2026-04-15" }
  ],
  "inventory": [
    { "productId": "uuid", "warehouseId": "uuid", "quantity": "40",   "unitCost": "1100" },
    { "productId": "uuid", "warehouseId": "uuid", "quantity": "1200", "unitCost": "130" }
  ]
}
```

Every section is optional; at least one must be present. The body is `.strict()` —
an unknown field is a `400`. In particular **there is no `openingEquity` field**:
capital is derived, and letting a caller state it would let them state a figure
that does not balance.

| Field | Rule |
|---|---|
| `asOfDate` | required, `YYYY-MM-DD`, and **round-trip validated** — `2026-02-30` is refused, not silently rolled into March |
| `cash` | optional, must be more than zero if given |
| `bankAccounts[].accountId` | optional. Omitted, the system Bank account is used — which is what a business with one bank wants. Given, it must be an active `ASSET` account of this company |
| `customers[].amount` / `suppliers[].amount` | more than zero |
| `customers[].dueDate` | optional, and what makes an opening due age like any other |
| `inventory[].quantity` | more than zero |
| `inventory[].unitCost` | zero or more — a free sample is real stock with no cost |

Response `201`:

```json
{
  "openingBalances": {
    "initialized": true,
    "asOfDate": "2026-04-01",
    "journalNumber": "JV-2026-000001",
    "journalEntryId": "uuid",
    "totalDebit": "425000.00",
    "totalCredit": "425000.00",
    "isBalanced": true,
    "customers": [{ "customerId": "uuid", "name": "Ramesh", "amount": "12000.00" }],
    "suppliers": [{ "supplierId": "uuid", "name": "Verma & Co", "amount": "60000.00" }],
    "inventory": [{ "productId": "uuid", "name": "Rice 25kg", "quantity": "40.000", "unitCost": "1100.00", "totalValue": "44000.00" }],
    "bankAccounts": [{ "accountId": "uuid", "code": "1010", "name": "Bank", "amount": "60000.00" }],
    "note": "Opening balances are an initialization, not a transaction..."
  }
}
```

Errors:

| Status | Code | When |
|---|---|---|
| 409 | `OPENING_BALANCES_ALREADY_INITIALIZED` | this company already has opening balances |
| 422 | `EMPTY_OPENING_BALANCES` | nothing was given to record |
| 422 | `INVALID_OPENING_AMOUNT` | an amount is zero or negative |
| 422 | `DUPLICATE_OPENING_ENTRY` | the same customer, supplier, account, or product+warehouse twice |
| 404 | `CUSTOMER_NOT_FOUND` / `SUPPLIER_NOT_FOUND` / `PRODUCT_NOT_FOUND` / `WAREHOUSE_NOT_FOUND` / `ACCOUNT_NOT_FOUND` | unknown, **or belonging to another company** |
| 422 | `INVALID_OPENING_ACCOUNT` | a named bank account is not an `ASSET` account |
| 422 | `ACCOUNTING_PERIOD_CLOSED` | the as-of date falls in a closed period |

### Idempotency is structural

The opening journal is stored as `sourceType: OPENING_BALANCE` with the
**company's own id** as `sourceId`. `JournalEntry` already carries
`@@unique([companyId, sourceType, sourceId])`, so a second initialization is
impossible **at the database** — not merely guarded against in code, and not
defeatable by two simultaneous requests. There is no opening-balance table,
because the journal entry *is* the record: it carries the as-of date, who created
it, when, and the totals.

### GET /api/v1/opening-balances

`ADMIN` and `STAFF`. Whether this company has been initialized, and by whom.

```json
{ "openingBalances": { "initialized": false, "asOfDate": null, "note": "..." } }
```

### GET /api/v1/opening-balances/details

`ADMIN` and `STAFF`. The full breakdown — journal lines, per-customer, per-
supplier, per-product — **read back from where each figure actually lives**: the
GL, the two sub-ledgers, the inventory module. Nothing is stored twice, so a
later correction to any of them shows here. `404` if not initialized.

### What the rest of the system sees

| | |
|---|---|
| Customer credit, statement, ageing, exposure | the opening due, typed `OPENING_BALANCE` |
| `/customer-receivables` | a real receivable, `salesInvoice: null`, `source: "OPENING_BALANCE"` |
| Supplier statement, payables summary | the mirror image |
| Inventory, valuation, COGS | opening stock at the existing moving average |
| Cash/bank report, dashboard, trial balance, GL | the opening entry's lines |
| **Profit and loss** | **nothing** — see below |

An opening receivable is a **real** receivable: it can be aged, chased, and
settled by an ordinary receipt with an allocation. That is why the FK was relaxed
to nullable rather than filled with an invented invoice.

### Opening balances never touch profit

This is the point worth checking. Immediately after initialization the P&L reads
zero revenue, zero cost of goods sold, zero expenses and zero profit. Opening
stock sits on the balance sheet; it becomes **cost of goods sold only when it is
actually sold**, at the opening cost it was brought in at.

---

## Accounting periods

A declared stretch of business dates a company can close. Closing refuses **new**
postings dated inside it. It never touches a posting already made.

### The rule, in three lines

```
date falls in a CLOSED period   -> refuse
date falls in an OPEN period    -> allow
date falls in NO period         -> allow, unless the company opted in
```

**Periods are opt-in.** No company created before this phase has one, and
refusing postings with no period would stop every existing business trading the
moment this deployed. A company that never creates a period behaves exactly as it
always did.

A business that wants the stricter rule — every posting inside a declared period,
no exceptions — sets `requireOpenPeriod` on its company settings. Then a date in
no period is a `422 NO_OPEN_ACCOUNTING_PERIOD`.

### Where the lock lives

At **one** point: `createPostedEntryWithinTransaction`, the single function every
posted journal entry in this system goes through. It is called by
`gl-posting.service.js` once per document type, and by the journal reversal path.

That means one check protects **every** posting route, present and future:

| Path | Protected |
|---|---|
| Sales invoices | ✅ |
| Purchases | ✅ |
| Expenses | ✅ |
| Customer receipts and their allocations | ✅ |
| Supplier payments and their allocations | ✅ |
| Sales returns / credit notes | ✅ |
| Purchase returns / debit notes | ✅ |
| Journal reversals | ✅ |
| Opening balances | ✅ |
| Inventory adjustments and standalone opening stock | ✅ (checked separately — they write no journal entry) |

Because the check runs **inside** the caller's transaction and refuses before the
entry is written, a refusal rolls the whole posting back: the stock never moved,
the sub-ledger never changed, the document stays a `DRAFT`.

### POST /api/v1/accounting-periods

`ADMIN` only.

```json
{ "name": "March 2026", "startDate": "2026-03-01", "endDate": "2026-03-31" }
```

Bounds are inclusive. Overlap is **refused**, not merged: two periods covering
one date would make "is this date closed?" ambiguous, and an ambiguous lock is
not a lock. Adjacent periods are fine.

| Status | Code |
|---|---|
| 400 | validation — backwards range, malformed or impossible date |
| 409 | `ACCOUNTING_PERIOD_NAME_TAKEN` |
| 422 | `ACCOUNTING_PERIOD_OVERLAP` |

### POST /api/v1/accounting-periods/:id/close

`ADMIN` only. The row is locked first, and the status change is conditional at the
database, so two simultaneous closes produce one `200` and one `409`.

```
422 ACCOUNTING_PERIOD_CLOSED
  "This document is dated 2026-03-15, which falls in "March 2026"
   (2026-03-01 to 2026-03-31). That period is closed."
```

The system does **not** modify the old period, does **not** create the document
in the current period instead, and does **not** shift the date. It refuses.

### POST /api/v1/accounting-periods/:id/reopen

`ADMIN` only. Optional `{ "reason": "..." }`.

Closing the wrong month is a mistake a person will make, and the alternative
would be a permanently unusable range. Reopening rewrites nothing — it only makes
the range postable again. The close is **kept** in the record: this period was
closed by someone and reopened by someone, both named and timestamped.

### GET /api/v1/accounting-periods · /:id · /check?date=YYYY-MM-DD

`ADMIN` and `STAFF`. `/check` answers "may I post on this date?" directly, so a
client can grey out a date picker instead of discovering the answer from a failed
posting:

```json
{ "check": { "date": "2026-03-15", "period": { "name": "March 2026", "status": "CLOSED" },
             "canPost": false, "reason": "Inside \"March 2026\", which is closed." } }
```

## Posted history stays immutable

Closing writes no closing entry, rolls no balance forward and rewrites no journal
line. The books already balance; nothing needs adjusting to make them.

Corrections use the mechanisms that already existed — a sales return, a purchase
return, an expense reversal, a journal reversal — and each of those is itself a
new posting subject to the same period rule. **An entry inside a closed period
can no longer be reversed**, which is what closing a period is for.

## Concurrency

| Race | Guard |
|---|---|
| Two initializations at once | `@@unique([companyId, sourceType, sourceId])` on `JournalEntry` — the database refuses the second |
| Two closes at once | row lock on the period + a status-conditional update |
| A posting racing a close | the guard reads the period **inside** the posting transaction; the close holds the row lock. The posting either commits before the close or waits and is refused — there is no window where both succeed |

## RBAC

| Operation | Role |
|---|---|
| Read opening balances, details, periods, date check | `ADMIN`, `STAFF` |
| Initialize opening balances | `ADMIN` |
| Create, close, reopen a period | `ADMIN` |

A staff member must not be able to freeze the books — nor to thaw them.

## GST

**Nothing in either module reads a GSTIN, an HSN code, a place of supply, a tax
rate or a state code.** A shop with no registration initializes cash, bank,
customer dues, supplier dues and stock, and closes its months, with no GST
configuration and without calling a single GST endpoint. A registered company
gets byte-identical behaviour, and no opening entry ever touches a tax account.

## Known limitations and assumptions

**Opening balances cannot be edited or re-run.** They are an initialization, and
this system corrects history with a new entry rather than by editing an old one.
A wrong opening balance is corrected today by a journal reversal plus manual
adjustments; a dedicated correction flow is not built.

**Periods are opt-in, and an absent period does not block.** This is a deliberate
compatibility decision, documented above. `requireOpenPeriod` opts a company into
the strict rule; it is not exposed through a settings endpoint in this phase and
is set directly on `company_settings`.

**Opening balances do not require or create a period.** They are an
initialization, not a period transaction. They are still date-stamped and still
obey the closed-period rule — you cannot initialize into a closed period.

**A period cannot be edited.** Its name and range are fixed once created; the
remedy is to reopen, and create the range you meant.

**Inventory adjustments are dated by the clock**, not by a business date the
caller supplies, because `StockMovement` has no business-date column. Their period
is resolved from the company's own timezone.

**Cash and bank discovery uses the chart hierarchy.** The cash book covers the
system Cash and Bank accounts plus any account **parented under them**. A second
bank account created outside that hierarchy appears in the GL and trial balance
but not in the cash book.

**Round-trip date validation is new code only.** The period and opening-balance
schemas refuse an impossible calendar date such as `2026-02-30`. The older
document schemas (sales, purchases, expenses and the rest) still accept it and
roll it forward, which is a pre-existing gap left untouched rather than changed
across eight modules late in this phase.

**Also absent:** period-end closing entries and retained-earnings posting,
financial-year rollover, multi-level period hierarchies (year/quarter/month), and
opening balances for accounts other than cash, bank, inventory, receivables and
payables.

---

## Not implemented yet

Planned for later phases and **not** available today: credit expenses and input tax
credit on expenses (see **Expenses / Known limitations**), manual journal entries,
period-end closing entries and financial-year rollover, GST portal integration and return *filing* (preparation
datasets exist - see above), e-invoice and e-way bills, reverse charge, TDS, bank
reconciliation, refunds against customer credit, dunning and late-fee interest, cash-flow
statements, report export to PDF or Excel, stock transfers between warehouses, batch and
expiry tracking, AI/OCR bill processing, file uploads, notifications, user registration,
refresh tokens, password reset, 2FA and granular permission tables.

---

# The SaaS Layer: Plans, Sales Team, Businesses and Subscriptions

Everything in this section belongs to the **platform operator**, not to a shop.
It sits *beside* the accounting engine and shares exactly one thing with it: the
`Company` row that both point at.

**No endpoint here reads or writes an accounting table.** Subscription money is
the platform's revenue and is deliberately never posted to a shop's journal —
recording it there would invent a transaction the shop never made.

## Roles

The `UserRole` enum gains two values. The existing two are unchanged.

| Role | Belongs to | `companyId` | What it can reach |
|---|---|---|---|
| `ADMIN` | a shop | required | that shop's books |
| `STAFF` | a shop | required | that shop's books, drafts only |
| `PLATFORM_ADMIN` | the operator | **null** | the whole platform, everything |
| `SALES_STAFF` | the operator | **null** | the platform, per their permission list |

A platform user has **no company**, and that is what keeps them out of every
shop's books: every shop route reads `req.user.companyId`, and theirs is null.
Conversely a shop's `ADMIN` holds no platform permission, so every route below
returns **403** for them.

## Permissions

Stored as a flat `String[]` on the user. A `PLATFORM_ADMIN` bypasses the list
entirely. Enforced by `requirePermission()` in `src/middlewares/require-role.js`.

`BUSINESS_CREATE` · `BUSINESS_VIEW` · `BUSINESS_EDIT` · `SUBSCRIPTION_CREATE` ·
`SUBSCRIPTION_VIEW` · `SUBSCRIPTION_CANCEL` · `PAYMENT_CREATE` · `PAYMENT_VIEW` ·
`PLAN_VIEW`

A new sales rep defaults to everything except `SUBSCRIPTION_CANCEL` and
`BUSINESS_EDIT`.

`GET /api/v1/sales-team/permissions` returns the catalogue so no form hardcodes it.

## Plans — `/api/v1/plans`

**Pricing is data.** Nothing in the codebase knows what "300" or "500" mean;
they are rows an operator creates. Any price and any duration is valid.

| Method | Path | Gate |
|---|---|---|
| GET | `/plans` | `PLAN_VIEW` |
| GET | `/plans/:id` | `PLAN_VIEW` |
| POST | `/plans` | `PLATFORM_ADMIN` |
| PATCH | `/plans/:id` | `PLATFORM_ADMIN` |
| PATCH | `/plans/:id/status` | `PLATFORM_ADMIN` |

```json
POST /api/v1/plans
{ "name": "3 Months", "price": "300", "durationValue": 3, "durationUnit": "MONTH" }
```

`durationUnit` is `DAY`, `MONTH` or `YEAR`.

**There is no DELETE.** A plan subscriptions point at is deactivated
(`/status`), never removed. Changing a plan's price affects *new sales only* —
see snapshots below.

## Businesses — `/api/v1/businesses`

| Method | Path | Gate |
|---|---|---|
| GET | `/businesses` | `BUSINESS_VIEW` |
| GET | `/businesses/:id` | `BUSINESS_VIEW` |
| POST | `/businesses/onboard` | `BUSINESS_CREATE` |
| PATCH | `/businesses/:id/status` | `BUSINESS_EDIT` |

`?mine=true` limits the list to shops the caller signed up.

### `POST /businesses/onboard`

**One request, one transaction**: the company, the owner's login, the chart of
accounts (via the same `initializeCompanyDefaults` the ordinary company path
uses), the subscription and the payment. If any part fails, none of it happened —
there is never a shop that cannot log in, or a payment against a shop that does
not exist.

```json
{
  "name": "Ramesh Medical Store",
  "phone": "9876543210",
  "city": "Pune",
  "owner": { "name": "Ramesh", "email": "ramesh@shop.test", "password": "..." },
  "planId": "<uuid>",
  "payment": { "amount": "300", "method": "CASH" }
}
```

`planId` and `payment` are **optional** — a rep may register a shop today and
sell it a plan next week.

**GST is optional.** Omit `gstin` and `stateCode` entirely and the shop runs in
non-GST mode permanently, which is correct for most small shops.

Errors: `409 BUSINESS_NAME_TAKEN`, `409 EMAIL_TAKEN`, `409 GSTIN_TAKEN`,
`422 PLAN_INACTIVE`.

## Subscriptions — `/api/v1/subscriptions`

| Method | Path | Gate |
|---|---|---|
| GET | `/subscriptions` | `SUBSCRIPTION_VIEW` |
| GET | `/subscriptions/:id` | `SUBSCRIPTION_VIEW` |
| POST | `/subscriptions` | `SUBSCRIPTION_CREATE` |
| POST | `/subscriptions/:id/cancel` | `SUBSCRIPTION_CANCEL` |
| GET | `/subscriptions/:id/payments` | `PAYMENT_VIEW` |
| POST | `/subscriptions/:id/payments` | `PAYMENT_CREATE` |

Filters: `?status=`, `?companyId=`, `?expiringWithinDays=15`.

Cancelling is a **separate permission** from selling, deliberately: a new rep is
often trusted to sign shops up long before they are trusted to switch one off.

### Snapshots — why repricing never rewrites history

A subscription stores `planNameSnapshot`, `priceSnapshot`,
`durationValueSnapshot` and `durationUnitSnapshot`, frozen at the moment of sale.
Raise a plan's price tomorrow and every shop already on it keeps what it agreed.
Same reasoning as the party- and price-snapshots on every accounting document.

### Renewal dates — the rule that protects the shop

If a subscription is still running, a renewal starts **the day after it ends**.
A shop that renews early keeps every day it already paid for; starting "today"
would silently delete the remainder, and the shop would have no way to notice.

If nothing is running (a first purchase, or a lapsed shop returning), the new
period starts today. A **cancelled** subscription grants nothing, however far
away its end date is.

End dates are **inclusive**: 1 June + 3 months ends 31 August. Month arithmetic
is **clamped** — 31 January + 1 month is 28 February, never 3 March.

Concurrency: `createSubscription` takes `SELECT … FOR UPDATE` on the company row,
so two reps selling the same shop a renewal at once cannot both extend from the
same end date.

## Collections — `GET /api/v1/subscription-payments`

Every payment taken, across all subscriptions. Gate: `PAYMENT_VIEW`. Filters:
`?collectedById=`, `?fromDate=`, `?toDate=`.

## Sales team — `/api/v1/sales-team`

**`PLATFORM_ADMIN` only, all of it** — a rep must never be able to widen their
own permissions.

| Method | Path |
|---|---|
| GET | `/sales-team` |
| GET | `/sales-team/permissions` |
| GET | `/sales-team/:id` |
| POST | `/sales-team` |
| PATCH | `/sales-team/:id` |

`GET /sales-team/:id` also returns `shopsOnboarded` and `paymentsCollected`.

## A shop asking about itself — `GET /api/v1/my-subscription`

The only subscription route a shop calls. The company comes from
`req.user.companyId`; **there is no parameter with which to ask about anyone
else**, and a `?companyId=` in the query string is ignored.

```json
{ "isEntitled": true, "status": "ACTIVE", "plan": "3 Months",
  "endDate": "2026-12-03", "daysRemaining": 90, "reason": null }
```

Advisory only — the guard below is what actually refuses a write.

## The subscription posting guard

Enforced inside `createPostedEntryWithinTransaction` — the single point every
posted document in the system passes through, beside the accounting-period
guard. One check covers sales, purchases, expenses, receipts, supplier payments,
both return types, reversals and opening balances, and any document type added
later inherits it.

| Shop's state | Result |
|---|---|
| a current subscription | allowed |
| `EXPIRED` | **402 `SUBSCRIPTION_EXPIRED`** |
| `CANCELLED` | **402 `SUBSCRIPTION_CANCELLED`** |
| **no subscription at all** | **allowed** |

**Why the last row is not "refuse".** Every business that existed before this
feature has no subscription row. Refusing them would stop every one of them
trading the instant this deployed — not because anybody decided to cut them off,
but because a table was added. A shop the SaaS funnel never touched is not an
expired shop.

Judged against **today**, not the document's date, so a lapsed shop cannot carry
on by backdating.

**Reading is never blocked.** An expired shop can still open its books, run every
report and export everything. Only recording new business stops.

A refused posting leaves the document a `DRAFT` with no journal entry, no stock
movement and no sub-ledger change — the whole transaction rolls back.

---

# AI Bill Import — `/api/v1/bills`

Photograph a bill, have it read, check it, record it.

## The one rule

**AI output is never posted.** What the model returns is untrusted input, parsed
and validated exactly the way a request body is. It lands in a `REVIEW` record
that a human confirms, and **the confirmation is what posts** — through the
*existing* purchase and sales services.

```
UPLOADED → PROCESSING → REVIEW → (human confirms) → POSTED
                      ↘ FAILED   (the shop types it in instead)
```

| Direction | Means | Becomes |
|---|---|---|
| `IN` | a bill you received | a **PURCHASE** |
| `OUT` | a bill you issued | a **SALES INVOICE** |

A bill imported from a photo and one typed by hand produce **identical**
accounting. There is no second path into the ledger.

## Endpoints

| Method | Path | RBAC |
|---|---|---|
| GET | `/bills` | ADMIN, STAFF |
| GET | `/bills/summary` | ADMIN, STAFF |
| GET | `/bills/:id` | ADMIN, STAFF |
| GET | `/bills/:id/file` | ADMIN, STAFF |
| POST | `/bills` (multipart) | ADMIN, STAFF |
| POST | `/bills/:id/retry` | ADMIN, STAFF |
| PATCH | `/bills/:id/review` | ADMIN, STAFF |
| **POST** | **`/bills/:id/confirm`** | **ADMIN only** |
| POST | `/bills/:id/cancel` | ADMIN, STAFF |

Confirming **is** posting a purchase or a sale, so it follows the same split
every other document does: staff may prepare, only an admin may post. The camera
is not a way around that.

## `POST /bills` — upload

`multipart/form-data` with `file` and `direction`. JPG, PNG, WEBP, HEIC or PDF,
up to `BILL_MAX_FILE_SIZE` (10 MB default).

The record is written **before** the model is called, so a bill is never lost to
a timeout — it lands in `FAILED` with the reason attached.

Errors: `422 UNSUPPORTED_FILE_TYPE`, `422 FILE_TYPE_MISMATCH`, `422 FILE_TOO_LARGE`,
`422 EMPTY_FILE`, `400 NO_FILE`.

`FILE_TYPE_MISMATCH` comes from checking the file's **magic bytes**. A
`Content-Type` header is a claim, not evidence.

## `POST /bills/:id/confirm` — the bridge

```json
{
  "document": {
    "supplierId": "<uuid>", "warehouseId": "<uuid>",
    "invoiceNumber": "INV-001", "invoiceDate": "2026-06-15",
    "items": [{ "productId": "<uuid>", "quantity": "10", "unitCost": "45" }]
  },
  "postImmediately": true
}
```

`document` is an **ordinary purchase or sales payload**, validated by the *same
imported Zod schema* the ordinary form uses, chosen by the bill's own direction.
A bill that arrived as a photograph gets nothing past validation that a typed one
could not.

The ids are ones a **human chose during review**. The model reads text ("ABC
Traders"); posting needs ids. Matching one to the other is a judgement about the
shop's own records, and that is exactly what the review step is for.

If posting is refused (closed period, expired subscription, insufficient stock),
the bill returns to `REVIEW` and the real error surfaces.

Errors: `409 BILL_ALREADY_POSTED`, `409 BILL_CANCELLED`, `400` validation.

**One bill becomes at most one document** — guaranteed by a database unique
constraint on `(companyId, postedSourceType, postedSourceId)`, not merely by
application code.

## File storage

- The client **never names a file.** Its filename is kept for display only; the
  name on disk is a server-generated uuid. `../../../etc/passwd` is just an odd
  label in a column.
- Paths derive from the **authenticated** `companyId`, so one shop's bills cannot
  be written into or read out of another's folder.
- **The browser never sees a path** — only a bill id. `GET /bills/:id/file`
  streams the bytes, so reading a bill needs a valid token *and* the right
  company. A static folder would make every uploaded bill public to anyone who
  guessed a filename.
- Another company's bill id returns **404**, not 403.

## Extraction — validating what the model says

Every field is nullable, because a real bill often genuinely lacks one and
inventing it would be worse than admitting it.

- **Money stays a string** end to end — never a JavaScript float.
- A hedged amount (`"approximately 4500"`) becomes **null**, not a number nobody
  typed.
- A date that is not `YYYY-MM-DD` becomes null rather than being guessed at.
- Fields the schema does not define are **dropped**.
- `confidence` (`HIGH`/`MEDIUM`/`LOW`) is surfaced so the review screen can warn.

The verbatim model response is kept in `extraction` for audit, even after the
user corrects it, so what the model said and what the human confirmed can always
be compared.

Errors: `503 EXTRACTION_NOT_CONFIGURED`, `504 EXTRACTION_TIMEOUT`,
`502 EXTRACTION_UNAVAILABLE`, `429 EXTRACTION_RATE_LIMITED`,
`422 EXTRACTION_UNREADABLE`, `422 EXTRACTION_INVALID`.

**With no API key configured the feature says so plainly** and every other
feature is untouched. It never pretends, and never fabricates an extraction.

## Configuration

All optional. See `.env.example`.

| Variable | Default | Notes |
|---|---|---|
| `LLAMA_API_KEY` | *(unset)* | **Server secret.** Never sent to a browser. |
| `LLAMA_BASE_URL` | `https://api.llama.com/v1` | |
| `LLAMA_MODEL` | `Llama-4-Maverick-17B-128E-Instruct-FP8` | |
| `LLAMA_TIMEOUT_MS` | `60000` | |
| `BILL_STORAGE_DIR` | `./storage/bills` | Put outside the repo in production. |
| `BILL_MAX_FILE_SIZE` | `10485760` | |

`LLAMA_API_KEY` is read in `src/config/env.js`, used only in
`bill-extraction.service.js`, and appears in no response body, log line or error
message. **There is deliberately no `NEXT_PUBLIC_` counterpart** — anything with
that prefix is compiled into JavaScript every visitor can read.

---

# Manual Recharge and Admin Grants

A shop pays a rep in cash at the counter, or the operator gives a struggling
customer a free month. Neither involves a payment gateway, and this product has
none.

## What a grant is NOT

It is emphatically not `UPDATE subscriptions SET endDate = ...`. Moving a date
leaves no answer to *"who gave this shop four free months, and why?"* — which is
exactly the question somebody will eventually ask about a subscription nobody
paid for.

A grant creates a **real subscription row**, through the same rules as a sale:
plan terms snapshotted, period resolved by the same date arithmetic, chained to
the previous subscription via `previousSubscriptionId`. The only differences are
`origin = ADMIN_GRANT`, a mandatory `grantReason`, and who is recorded.

## `POST /api/v1/subscriptions/grant`

Gate: **`SUBSCRIPTION_GRANT`** — its own permission, deliberately **absent from
the sales-staff defaults**. Whoever holds it can give any shop free access
indefinitely, so an operator hands it out on purpose. A `PLATFORM_ADMIN` passes
implicitly.

```json
{
  "companyId": "<uuid>",
  "planId": "<uuid>",
  "reason": "Cash collected by sales staff",
  "amount": "500",
  "method": "MANUAL",
  "reference": "OFFLINE-ABC-001"
}
```

| Field | Required | Notes |
|---|---|---|
| `companyId`, `planId` | yes | The plan must exist but **need not be on sale** — an operator honouring an old promise should not be blocked because the plan was withdrawn. |
| `reason` | **yes, always** | The only record of why a shop has access. |
| `amount` | no | **Omitted means free.** No payment row is written at all. |
| `method` | no | `MANUAL`, `CASH`, `UPI`, `BANK`, `CARD`, `CHEQUE`, `ADMIN_GRANT`, `OTHER`. None is a gateway. |
| `reference` | no | e.g. an offline receipt number. |
| `durationValue`, `durationUnit` | no | Override the plan's duration (Case D). |

A gateway-shaped payload (`"method": "RAZORPAY"`) is **rejected with 400** rather
than silently ignored.

### Behaviour

| Case | Situation | Result |
|---|---|---|
| **A** | Subscription expired | New period starts **today** — never backdated into the gap |
| **B** | Subscription still running | Starts **the day after** the current end date; the running subscription is not shortened or rewritten |
| **C** | `amount` omitted or `0` | Subscription is ACTIVE, `priceSnapshot` is `0`, and **no payment row exists** |
| **D** | Custom duration given | Flows through the same date arithmetic; no second implementation |

A shop that was switched off is **reactivated** by a recharge (`reactivated: true`
in the response), so an admin does not have to remember a second step.

### Why a free grant writes no payment

A ₹0 "payment" would dress a gift up as a transaction and quietly inflate every
collections report the operator runs. The subscription records `priceSnapshot: 0`
and `origin: ADMIN_GRANT`; the payments table stays honest.

Note also that `priceSnapshot` is the amount **recorded**, not the plan's list
price — a ₹0 promotional grant must not claim the shop was charged ₹500.

## `GET /api/v1/businesses/:id/recharge-preview?planId=…`

Gate: `SUBSCRIPTION_VIEW`. Read-only; it creates nothing.

```json
{
  "current": { "plan": "3 Months", "endDate": "2026-09-30", "status": "ACTIVE" },
  "extending": true,
  "startDate": "2026-10-01",
  "endDate": "2026-12-31",
  "explanation": "This shop is paid up to 2026-09-30. The new period starts the day after, so no paid days are lost."
}
```

The dialog shows "30 Sep → 31 Dec" from this endpoint, so the preview is produced
by the **same arithmetic** as the real thing. A second implementation would
eventually disagree, and the disagreement would only surface after somebody had
already clicked.

## `GET /api/v1/businesses/:id/history`

Gate: `SUBSCRIPTION_VIEW`. The audit trail: every subscription and every payment
this shop has had, newest first, each carrying who did it and why.

## The audit trail

There is **no separate audit system**, and none was added — the records
themselves carry it, which is what makes them impossible to desynchronise from
what actually happened:

| Required | Where it lives |
|---|---|
| Admin user | `Subscription.createdById`, `SubscriptionPayment.collectedById` |
| Shop | `Subscription.companyId` |
| Previous subscription | `Subscription.previousSubscriptionId` |
| New subscription | the row itself |
| Plan | `planNameSnapshot` (+ `planId`) |
| Duration | `durationValueSnapshot` / `durationUnitSnapshot` |
| Amount | `priceSnapshot`, `SubscriptionPayment.amount` |
| Payment method | `SubscriptionPayment.method` |
| Reference | `SubscriptionPayment.reference` |
| Reason | `Subscription.grantReason` |
| Operation type | `Subscription.origin` |
| Start / expiry | `startDate` / `endDate` |
| Timestamp | `createdAt` |

Subscription history is **never silently modified**. A recharge adds a row; it
does not edit one.

## Security

Enforced **server-side**, on the route. Hiding the button in the admin panel is a
courtesy to the user, not a control — anyone can POST to the URL.

| Actor | Can recharge? |
|---|---|
| `PLATFORM_ADMIN` | yes |
| `SALES_STAFF` with `SUBSCRIPTION_GRANT` | yes — granted explicitly |
| `SALES_STAFF` with the defaults | **no, 403** |
| A shop's `ADMIN`, for their own shop | **no, 403** |
| A shop's `ADMIN`, for another shop | **no, 403** |
| Unauthenticated | **401** |

## Platform administration is never blocked by a shop's subscription

An admin opening a lapsed shop must still be able to view it, read its history
and recharge it — otherwise the only person who can fix the problem is locked out
by it. Platform staff have `companyId = null`, and the posting guard now returns
early on a null company **deliberately** rather than by accident.

## The platform superadmin

`npm run seed:platform` creates the operator's own account from
`PLATFORM_ADMIN_EMAIL` / `PLATFORM_ADMIN_PASSWORD`:

- `role: PLATFORM_ADMIN` — passes every platform permission implicitly
- `companyId: null` — so no shop route can resolve a tenant for them

This is **separate from `npm run prisma:seed`**, which seeds a SHOP and its admin.
Keeping them apart is the point: a shop admin who could also administer the
platform would reach every other shop's account.

The seed **refuses to promote an existing shop user** to platform administrator,
and says so, rather than silently escalating their privileges.

---

# Period Verification and Other Opening Balances

Two additions to the opening-balance and period system documented above.

## `GET /api/v1/accounting-periods/:id/verify`

Read-only. Answers "would this period close, and if not, why not?" without
closing anything. Available to ADMIN and STAFF — whether the books reconcile is
not a privileged question inside a company.

```json
{
  "period": { "id": "…", "name": "March 2026", "status": "OPEN" },
  "verification": {
    "ok": true,
    "failed": [],
    "checks": [
      { "key": "PERIOD_BALANCED",       "passed": true, "difference": "0.00" },
      { "key": "LEDGER_BALANCED",       "passed": true, "difference": "0.00" },
      { "key": "RECEIVABLES_RECONCILE", "passed": true, "difference": "0.00" },
      { "key": "PAYABLES_RECONCILE",    "passed": true, "difference": "0.00" }
    ]
  }
}
```

| Check | What it proves |
|---|---|
| `PERIOD_BALANCED` | Debits = credits across every line dated inside the period |
| `LEDGER_BALANCED` | Debits = credits for the whole ledger up to the period end |
| `RECEIVABLES_RECONCILE` | Customer sub-ledger = Accounts Receivable control account |
| `PAYABLES_RECONCILE` | Supplier sub-ledger = Accounts Payable control account |

Checks are made **as of the period's end date**, not today: closing March asks
whether March's books were right on 31 March.

### What it deliberately does not check

**Drafts.** A draft dated inside the period has no accounting effect. Refusing to
close a month because a half-typed invoice exists would be an obstruction, not a
safeguard.

## `POST /api/v1/accounting-periods/:id/close` now verifies first

Closing runs the same checks and **refuses with `409
ACCOUNTING_PERIOD_NOT_RECONCILED`** if any fail, naming each failure and the
amount it is out by. Nothing is changed by a refused close.

The verification runs **outside** the transaction, before the row lock is taken:
the checks are read-only, and holding a lock across them would block postings for
no benefit.

An already-closed period still returns `409 ACCOUNTING_PERIOD_ALREADY_CLOSED`,
checked before any verification work.

Because the posting service cannot write an unbalanced entry, `PERIOD_BALANCED`
and `LEDGER_BALANCED` should never fail. That is the point: if one ever does,
something has written to the database around the posting path, and closing on top
of that would set the damage in stone.

## `otherBalances` on `POST /api/v1/opening-balances`

The dedicated fields (`cash`, `bankAccounts`, `customers`, `suppliers`,
`inventory`) cover what almost every shop has. `otherBalances` covers the rest —
a vehicle, a security deposit, a bank loan, capital already introduced — without
inventing a field per asset class.

```json
{
  "asOfDate": "2026-04-01",
  "cash": "25000",
  "otherBalances": [
    { "accountId": "<uuid>", "amount": "400000", "description": "Delivery van" },
    { "accountId": "<uuid>", "amount": "300000", "description": "Vehicle loan" }
  ]
}
```

**The side is not supplied and cannot be.** It is derived from the account's own
type: `ASSET` opens as a debit, `LIABILITY` and `EQUITY` as credits. Trusting a
caller-supplied side would let a mistake turn a loan into an asset and still
balance.

### What may carry an opening balance

| Account type | Allowed | Why |
|---|---|---|
| `ASSET`, `LIABILITY`, `EQUITY` | yes | Things a business *has* on the day it starts |
| `REVENUE`, `EXPENSE` | **no — 422 `INVALID_OPENING_ACCOUNT`** | They describe what happened *during* a period. Allowing them would let an initialization manufacture profit that was never earned. |

### Control accounts are refused

Cash (1000), Inventory (1300), Accounts Receivable (1200) and Accounts Payable
(2000) are driven by their own dedicated fields. Naming one here as well returns
**422 `CONTROLLED_OPENING_ACCOUNT`**, because it would be counted twice and break
the sub-ledger reconciliation the module guarantees. The error names the field to
use instead.

Also refused: the same account twice, an account that is also named as a bank
balance, an inactive account, and an account belonging to another company (404).

## Known limitations

- **No closing journal entry is written when a period closes**, and none is
  needed. The balance sheet *derives* retained earnings as revenue − expenses
  since inception, which is what makes `Assets = Liabilities + Equity` hold:

  ```
  sum(debits) − sum(credits) = 0  over every posted line
  ⇒ Assets = Liabilities + Equity + (Revenue − Expenses)
  ```

  Posting a closing entry that zeroed revenue and expenses into equity would
  double-count against that derivation, and — because the P&L is computed from
  journal lines over a date range — a closing entry dated at period end would be
  swept into the very period it closes, reporting that period's profit as zero.
  A previous period's P&L is preserved precisely *because* nothing is posted.

- **Closing does not lock the sub-ledgers independently.** It prevents postings
  by business date; it does not freeze a customer's aging or recompute a
  historical balance snapshot.

- **Reopening a closed period is permitted** (ADMIN only, attributed, with a
  reason). Closing the wrong month is a mistake people make, and the alternative
  is a permanently unusable range. It rewrites nothing.

---

# Public Endpoints

Exactly one route in this API requires no authentication.

## `GET /api/v1/public/plans`

The plans currently on sale, for the marketing site's pricing section.

```json
{ "plans": [
  { "id": "…", "name": "3 Months", "description": null,
    "price": "300.00", "currency": "INR",
    "durationValue": 3, "durationUnit": "MONTH", "durationLabel": "3 months" }
] }
```

A price list is public by definition — it is the thing an operator most wants
strangers to read. Everything else about plans (creating, repricing, withdrawing)
stays behind `requireAuth` and a permission, unchanged.

**What it deliberately does not expose:**

- **Withdrawn plans.** Only what is actually sellable today, so a pricing page
  cannot advertise something a rep is unable to sell.
- **Anything about shops.** No counts, no subscribers, no revenue. An anonymous
  caller learns nothing about the operator's business.
- **Anything enumerable.** There is no `/public/plans/:id`, no search and no
  cursor. It is one small list, or nothing.

The response is re-shaped rather than passed through, so adding an internal field
to a plan tomorrow cannot silently publish it to the internet.

Returns `200` with an empty array when nothing is on sale — the marketing page
then asks the visitor to get in touch rather than inventing a price.
