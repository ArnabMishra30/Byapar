# Byapar Demo — Known Limitations (don't over‑promise)

Honest boundaries, grounded in the actual application. Demo what's real; for the
rest, say *"let me confirm and come back to you."* Nothing here needs to be
volunteered — it's so **you** don't accidentally promise something that isn't ready.

## Needs activation / configuration
- **AI Bill Import (live reading)** requires the reading service to be switched on for
  the shop (`LLAMA_API_KEY`). It is enabled on your deployed app, but **test it the
  morning of**. If it's off where you demo, show the upload/review screens and call it
  "a capability we enable for your shop" — **never fake a live read**. Each read also
  uses paid credits.
- **Bill image storage:** uploaded bill *photos* are kept on the server's disk and can
  be lost on a redeploy (a move to cloud storage is planned). The posted purchase/sale
  is safe either way — but don't promise permanent retrieval of the original image.

## Not implemented (do not demonstrate or promise)
- **Stock transfer between two stores** — not available. Multi‑store shops move stock
  with Stock In / Stock Out at each store.
- **Offline mode** — Byapar is an online app. You need a connection to record and view.
  If asked, be clear: it's not an offline/sync app today.
- **Barcode *scanning*** — a product has a barcode *field* you can store, but there is
  **no built‑in barcode scanner**. Don't promise "scan to bill."
- **Automated WhatsApp/SMS sending** — you can **download** a PDF/Excel or create a
  **share link** and send it yourself. There is no built‑in auto‑send to WhatsApp.

## Confirm before you quote
- **Subscription & pricing** — Byapar runs on a per‑business subscription, but **share
  your current plan/pricing** rather than quoting numbers from memory. Say "I'll share
  the exact plan that fits your shop."
- **GST reports** appear only when **GST is turned on** for the shop. The demo shop is
  GST‑off, so don't open the GST tab there.
- **Number of users / staff roles** — the owner has full access and staff can be
  limited (e.g. billing only, see only their own sales). If asked about exact seat
  limits for their plan, confirm rather than guess.

## Cosmetic (safe to ignore during the demo)
- The **Money Received** dialog still labels the picker **"Customer"** while the rest
  of the app says **"Party."** It behaves identically — just a wording leftover. No
  need to point it out.

## Golden rules for the meeting
1. Show only what you've **tested that day**.
2. If unsure: **"Good question — let me confirm and come back to you."**
3. Never present a mock‑up or a faked AI read as a live result.
4. Keep real customer data and credentials **off the screen**.
