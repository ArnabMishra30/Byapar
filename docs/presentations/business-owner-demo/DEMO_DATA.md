# Byapar Demo — Dataset & Consistent Numbers

Use these names and figures throughout the demo so the story stays consistent.

> **Two kinds of numbers below.** "Teaching figures" are the clean examples you say
> aloud to explain a concept. The **live screen** shows the demo shop's own seeded
> values — that's fine: narrate the concept over whatever is on screen. Never read a
> teaching figure as if it were the live total if they differ.

---

## The demo business
- **Shop:** "Demo Kirana Store" (a general/grocery shop). *The seeded demo shop may be
  named differently on your instance — that's cosmetic; the flows are identical.*
- **GST:** this demo shop runs **without GST**, so bills show no tax. If the owner is
  GST‑registered, say "Byapar adds the tax automatically."
- **Login:** your demo **Shop Owner** account.
  *Local dev stack only: `owner@demoshop.test` / `Demo@12345` (do not show credentials on screen).*

## Products
| Product | Unit | Purchase price | Selling price | Min stock |
|---|---|---|---|---|
| Sunflower Oil 1L | Litre | ₹115 | ₹140 | 10 |
| Dove Soap 100g | Piece | ₹45 | ₹55 | 10 |
| Maggi Noodles 70g | Piece | ₹12 | ₹14 | 20 |
| Coca‑Cola 750ml | Piece | ₹38 | ₹45 | 12 |

## Parties
| Party | Used in the demo for |
|---|---|
| **XYZ Traders** | The star example — buys from you **and** sells to you (both balances). |
| **Rahul Store** | The Quick Billing customer (the sale you make live). |
| **ABC Distributors** | A supplier for the purchase flow. |

---

## Teaching figures (say these aloud)

### Unified party — XYZ Traders (Part 4)
| Direction | What happens | Amount |
|---|---|---|
| Sell to them | You sell goods | ₹8,000 |
| They pay you | Received | − ₹2,000 |
| **Receivable (Owes You)** | | **₹6,000** |
| Buy from them | You purchase goods | ₹20,000 |
| You pay them | Paid | − ₹5,000 |
| **Payable (You Owe)** | | **₹15,000** |

**The point:** ₹6,000 and ₹15,000 are kept **separate** — Byapar does **not** net them
to ₹9,000. Verified arithmetic: 8,000 − 2,000 = 6,000; 20,000 − 5,000 = 15,000.

### Quick Billing — Rahul Store sale (Part 5)
| Item | Qty | Rate | Line amount |
|---|---|---|---|
| Sunflower Oil 1L | 2 | ₹140 | ₹280 |
| Dove Soap 100g | 3 | ₹55 | ₹165 |
| Maggi Noodles 70g | 5 | ₹14 | ₹70 |
| **Total (GST off)** | | | **₹515** |

Verified: 2×140 = 280; 3×55 = 165; 5×14 = 70; total = **515**. (If GST is on, tax is
added on save — don't quote a GST total unless you know the shop's rate.)

### Payment allocation (Part 6)
> Example: a customer owes ₹515. You receive ₹515 → the bill is marked paid and their
> "Owes you" drops to ₹0. Receive ₹600 → ₹515 clears the bill and ₹85 is kept as an
> **advance** for next time.

---

## Phrases to reuse (keep the language consistent)
- **Party** = anyone you deal with (customer, supplier, or both).
- **Receivable / "Owes you"** = money a customer still has to pay you.
- **Payable / "You owe"** = money you still have to pay a supplier.
- **Draft** = saved but nothing has moved yet.
- **Completed** = final; stock and money have moved.
- **Advance** = extra money received, kept for the next bill.
