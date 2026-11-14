# Byapar — Shop Owner User Guide (LaTeX source)

This folder holds the editable source for the **Complete Shop Owner User Guide**
and everything needed to build the PDF.

```
docs/user-guide/
├── SHOP_OWNER_USER_GUIDE.tex   # the full guide (edit this)
├── README.md                   # this file
└── screenshots/                # real app screenshots + MANIFEST.md
```

> **Status:** all **15 screenshots are captured** from the real running app (demo
> shop, Shop Owner account) and are in `screenshots/`. The only thing left is to
> **compile the PDF** — the machine this was prepared on has no LaTeX engine, so
> the compile happens on Overleaf or a local LaTeX install (one step, below).

---

## Build the PDF

### Engine
Compile with **XeLaTeX** (preferred) or **LuaLaTeX** — *not* pdfLaTeX. The guide
uses `fontspec`, and the ₹ (rupee) symbol is drawn from **DejaVu Sans**, which
ships with every standard TeX Live / MiKTeX / Overleaf install.

### Option A — Overleaf (easiest, ~2 minutes)
1. Go to <https://overleaf.com> → **New Project → Upload Project**.
2. Upload this whole `user-guide` folder (so `screenshots/` comes along).
3. Open **Menu → Settings → Compiler** and choose **XeLaTeX**.
4. Press **Recompile**. The PDF appears on the right. Download it as
   `SHOP_OWNER_USER_GUIDE.pdf`.

### Option B — Local (TeX Live or MiKTeX)
From inside `docs/user-guide/`:
```bash
xelatex SHOP_OWNER_USER_GUIDE.tex
xelatex SHOP_OWNER_USER_GUIDE.tex      # run twice: table of contents + cover positions
```
or, if you have `latexmk`:
```bash
latexmk -xelatex SHOP_OWNER_USER_GUIDE.tex
```
Run it **twice** — the first pass builds the table of contents and places the
cover banner; the second pass settles the page numbers and links.

---

## Screenshots

All **15 screenshots are already included** in `screenshots/`, captured from the
real running application (the seeded demo shop, signed in as the Shop Owner) at
1440×900 retina, with no browser chrome and demo data only. They are wired into
the guide and render automatically when you compile.

The guide is also resilient: if any screenshot file is ever removed, that spot
renders as a tidy dashed placeholder box instead of breaking the build. To
re-capture or replace one, just overwrite the PNG of the same name (see
`screenshots/MANIFEST.md` for what each shows).

One note: figure 13 (**Bill Import**) shows the real upload/start screen. The
live “review a read bill” screen needs the AI reading service (`LLAMA_API_KEY`),
which is not enabled on the local instance used for capture — so it was not
staged rather than faked.

---

## Editing the guide

- All content is in `SHOP_OWNER_USER_GUIDE.tex`. It is organised chapter by
  chapter; search for `\chapter{` to jump around.
- Reusable building blocks (use these to keep the look consistent):
  | Command / environment | Use for |
  |---|---|
  | `\begin{notebox}…\end{notebox}` | a helpful “good to know” note |
  | `\begin{tipbox}…\end{tipbox}` | a quick tip |
  | `\begin{warnbox}…\end{warnbox}` | an important warning |
  | `\begin{examplebox}…\end{examplebox}` | a worked example / calculation |
  | `\begin{faqbox}{Question?}…\end{faqbox}` | one FAQ entry |
  | `\begin{steps}\item …\end{steps}` | numbered step‑by‑step instructions |
  | `\ui{Save \& complete}` | a button / field name chip |
  | `\rupee` | the ₹ symbol (e.g. `\rupee140`) |
  | `\shot{1}{01-login.png}{Caption.}` | a captioned screenshot (or placeholder) |
- **Brand colours** are defined near the top (`brandgreen = #1C7D59`, taken from
  the app’s own primary colour, plus `navy`, `panel`, `amber`). Change them in
  one place.

---

## Troubleshooting the build

| Symptom | Fix |
|---|---|
| `Package fontspec Error` / `! Undefined control sequence \setmainfont` | You compiled with **pdfLaTeX**. Switch the compiler to **XeLaTeX**. |
| `! fontspec error: font-not-found` for *DejaVu Sans* | Rare; DejaVu ships with TeX Live. On a minimal install run `tlmgr install dejavu`, or replace `DejaVu Sans` in the `\newfontfamily\rupeefont{…}` line with any installed font that has ₹ (e.g. *Noto Sans*). |
| The ₹ sign shows as a box | Same as above — the chosen `\rupeefont` has no ₹; point it at a font that does. |
| Table of contents / cover banner looks off | Compile **twice** (see above). |
| A screenshot is missing | It just shows a placeholder; add the PNG named in `MANIFEST.md`. |

---

## What this guide covers

17 chapters, written against the **real Byapar app** (no invented features):
Welcome · Login & Dashboard · First‑time setup · Products & Inventory ·
Unified Parties · Quick Billing · Sales & Invoices · Purchases & Purchase Bills ·
Money Received & Paid · Credit Book & Payables · AI Bill Import ·
Expenses, Cash & Bank · Reports & Party Statements · Daily routine ·
Common mistakes · FAQ · Quick Reference.
