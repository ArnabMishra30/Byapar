# Byapar — Shop Owner User Guide (LaTeX source)

This folder holds the editable source for the **Complete Shop Owner User Guide**
and everything needed to build the PDF.

```
docs/user-guide/
├── SHOP_OWNER_USER_GUIDE.tex   # the full guide (edit this)
├── README.md                   # this file
└── screenshots/                # real app screenshots + MANIFEST.md
```

> **Why there is no PDF in this folder yet:** the machine this was written on had
> no LaTeX engine installed, so the PDF could not be compiled here. Building it is
> a one‑step job on Overleaf or any local LaTeX install — see below.

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

## Adding the screenshots

The guide is written to work **with or without** screenshots:

- Drop a PNG into `screenshots/` using the **exact filename** the guide expects
  (see `screenshots/MANIFEST.md`), and it appears automatically on recompile.
- Any shot you have **not** added yet renders as a tidy dashed placeholder box
  that says *“place `screenshots/NN-name.png` here”* — so the document always
  compiles and looks finished.

Capture the shots from the real app, crop the browser chrome, and never show
passwords, tokens or real customer phone numbers. See `screenshots/MANIFEST.md`
for the full list and what each one should show.

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
