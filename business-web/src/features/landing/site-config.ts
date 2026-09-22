import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  BarChart3,
  BookOpen,
  Boxes,
  CheckCircle2,
  Clock,
  FolderCheck,
  HandCoins,
  Landmark,
  MonitorSmartphone,
  PencilLine,
  Receipt,
  ScanLine,
  ShoppingCart,
  Smartphone,
  Sparkles,
  Truck,
  Upload,
  UserCheck,
  Wallet,
} from "lucide-react";
import { APP_CONFIG, ROUTES } from "@/lib/constants";
import type { PublicPlan } from "@/lib/api/public";

/**
 * EVERYTHING THE MARKETING SITE SAYS, IN ONE PLACE.
 *
 * Copy, links, plans and contact details live here rather than scattered through
 * JSX, so renaming the product, changing a price or correcting a sentence is an
 * edit to one file.
 *
 * THE RULE FOR EVERY LINE BELOW: it describes something that actually ships.
 * No payment gateway, no mobile app, no "instant" or "100% accurate" AI. A
 * landing page that oversells is a support ticket with a delay on it.
 */

// --- brand ---------------------------------------------------------------------

export const SITE = {
  /** Comes from the app's own config, so the product is named once. */
  brand: APP_CONFIG.name,
  tagline: "Simple books. Stronger business.",
  description:
    "Business management for shops, retailers and small businesses — sales, purchases, stock, credit, expenses and reports in one place.",
  /**
   * Public contact details. Not secrets, so NEXT_PUBLIC_ is correct here.
   *
   * Deliberately empty by default: an invented phone number on a live site is
   * worse than none. Anything left unset is simply not rendered.
   */
  contact: {
    email: process.env.NEXT_PUBLIC_CONTACT_EMAIL?.trim() || null,
    phone: process.env.NEXT_PUBLIC_CONTACT_PHONE?.trim() || null,
  },
};

// --- navigation ----------------------------------------------------------------

/** Absolute "/#section" links, so they also work from /register and /terms. */
export const NAV_LINKS = [
  { label: "Features", href: ROUTES.features },
  { label: "How It Works", href: ROUTES.howItWorks },
  { label: "Pricing", href: ROUTES.pricing },
  { label: "FAQ", href: ROUTES.faq },
] as const;

export const CTA = {
  /** There is no self-service sign-up: this page explains how onboarding works. */
  getStarted: ROUTES.register,
  /** The existing shop owner login. */
  login: ROUTES.login,
  howItWorks: ROUTES.howItWorks,
} as const;

export const LEGAL_LINKS = [
  { label: "Privacy Policy", href: "/privacy" },
  { label: "Terms of Service", href: "/terms" },
] as const;

// --- hero ----------------------------------------------------------------------

export interface IconItem {
  icon: LucideIcon;
  title: string;
  description: string;
}

export const TRUST_POINTS: IconItem[] = [
  { icon: Sparkles, title: "Easy to use", description: "Built for shop owners" },
  { icon: MonitorSmartphone, title: "Access anywhere", description: "Phone, tablet or computer" },
  { icon: FolderCheck, title: "Your data, organised", description: "Kept separate for every business" },
];

// --- feature strip -------------------------------------------------------------

export const STRIP_FEATURES: IconItem[] = [
  { icon: ArrowLeftRight, title: "Sales & Purchases", description: "Every transaction, organised" },
  { icon: Boxes, title: "Stock Management", description: "Know what you have in stock" },
  { icon: UserCheck, title: "Customer Credit", description: "Track what customers owe" },
  { icon: Truck, title: "Supplier Dues", description: "Know what you need to pay" },
  { icon: BarChart3, title: "Business Reports", description: "See how your business is doing" },
];

// --- features grid -------------------------------------------------------------

export type FeatureTone = "emerald" | "sky" | "amber" | "violet" | "rose";

export interface Feature extends IconItem {
  tone: FeatureTone;
}

export const FEATURES: Feature[] = [
  {
    icon: Receipt,
    title: "Sales Management",
    description: "Record sales with or without GST. Stock and customer dues update on their own.",
    tone: "emerald",
  },
  {
    icon: ShoppingCart,
    title: "Purchase Management",
    description: "Enter supplier bills, track what you owe, and keep your stock correctly costed.",
    tone: "sky",
  },
  {
    icon: Boxes,
    title: "Inventory / Stock",
    description: "Quantity and value for every item, costed on a moving average as you buy and sell.",
    tone: "amber",
  },
  {
    icon: UserCheck,
    title: "Customer Credit",
    description: "See who owes you, how much and for how long — with statements and ageing.",
    tone: "violet",
  },
  {
    icon: Truck,
    title: "Supplier Dues",
    description: "Every bill you still have to pay, with the balance always up to date.",
    tone: "rose",
  },
  {
    icon: Wallet,
    title: "Expenses",
    description: "Rent, electricity, salaries and more — categorised and reflected in your profit.",
    tone: "rose",
  },
  {
    icon: Landmark,
    title: "Cash & Bank",
    description: "What is in the till and what is in the bank, kept in step with your books.",
    tone: "emerald",
  },
  {
    icon: BarChart3,
    title: "Reports & Accounting",
    description: "Profit and loss, balance sheet, trial balance and ledgers when you need them.",
    tone: "sky",
  },
  {
    icon: ScanLine,
    title: "AI Bill Import",
    description: "Photograph a bill. It is read for you, you check it, and only then is it recorded.",
    tone: "emerald",
  },
];

// --- AI bill import ------------------------------------------------------------

export const BILL_STEPS: IconItem[] = [
  { icon: Upload, title: "Upload Bill", description: "Take a photo, or upload an image or PDF." },
  { icon: ArrowLeftRight, title: "Choose Type", description: "IN for a purchase, OUT for a sale." },
  { icon: Sparkles, title: "AI Extraction", description: "Party, date, items and amounts are read for you." },
  { icon: PencilLine, title: "Review & Edit", description: "Check every detail and correct anything misread." },
  { icon: CheckCircle2, title: "Confirm & Save", description: "Your stock, ledgers and reports update." },
];

// --- benefits ------------------------------------------------------------------

export const BENEFITS: IconItem[] = [
  { icon: Clock, title: "Spend less time on data entry", description: "Upload bills instead of typing them." },
  { icon: HandCoins, title: "Know who owes you — and whom you owe", description: "Credit and dues at a glance." },
  { icon: BookOpen, title: "Keep records organised", description: "Every document in one place." },
  { icon: Smartphone, title: "Access from anywhere", description: "On your phone, tablet or computer." },
  { icon: BarChart3, title: "Decide with reports", description: "Profit, stock and cash, clearly." },
];

// --- pricing -------------------------------------------------------------------

/**
 * The plans shown when the backend has none to offer.
 *
 * The backend's own plan records are the source of truth and always win when
 * present - see usePlans(). These exist so a fresh install, or a moment when the
 * API is unreachable, still shows the current price list rather than nothing.
 */
export const CONFIGURED_PLANS: PublicPlan[] = [
  {
    id: "configured-3-months",
    name: "3 Months",
    description: null,
    price: "300",
    currency: "INR",
    durationValue: 3,
    durationUnit: "MONTH",
    durationLabel: "3 months",
  },
  {
    id: "configured-6-months",
    name: "6 Months",
    description: null,
    price: "500",
    currency: "INR",
    durationValue: 6,
    durationUnit: "MONTH",
    durationLabel: "6 months",
  },
];

/**
 * What every plan includes. Plans differ only in length - the backend gates no
 * feature by plan - so the list is honestly the same for all of them.
 */
export const PLAN_INCLUDES = [
  "Access to the business platform",
  "Sales, purchases and stock",
  "Customer credit and supplier dues",
  "AI bill import",
  "Reports and ledgers",
];

// --- FAQ -----------------------------------------------------------------------

export interface Faq {
  id: string;
  question: string;
  answer: string;
}

export const FAQS: Faq[] = [
  {
    id: "who",
    question: "Who is this platform for?",
    answer:
      "Shop owners and small businesses — kirana stores, medical shops, retailers, wholesalers and distributors — who want sales, purchases, stock, credit and expenses in one place without having to learn accounting.",
  },
  {
    id: "upload",
    question: "Can I upload bills instead of entering everything manually?",
    answer:
      "Yes. Photograph a bill or upload a PDF, choose IN for a purchase or OUT for a sale, and the details are read for you. Clear, well-lit photos read best, and anything that cannot be read clearly is left blank for you to fill in.",
  },
  {
    id: "edit",
    question: "Can I edit extracted bill information before saving?",
    answer:
      "Always. Every extracted field is shown to you and can be corrected, and you match the party and items to your own records. Nothing is saved to your books until you confirm it — AI can misread a creased or blurry bill, which is exactly why you review it first.",
  },
  {
    id: "credit",
    question: "Can I track customer credit and supplier dues?",
    answer:
      "Yes. You can see what each customer owes you and what you owe each supplier, record money received and paid, and view statements and ageing for both.",
  },
  {
    id: "subscriptions",
    question: "How do subscriptions work?",
    answer:
      "You choose a plan and our team activates it for your business. Your sales representative records the payment. When a plan ends it can be renewed the same way, and renewing early adds time rather than replacing what you have left.",
  },
  {
    id: "phone",
    question: "Can I use it on my phone?",
    answer:
      "Yes. It is a website built for phones first, so it works in your phone's browser with nothing to install, and equally well on a desktop at the counter.",
  },
  {
    id: "gst",
    question: "Do I need a GST registration?",
    answer:
      "No. GST is entirely optional. A shop with no registration records everything the same way, with no tax fields on screen. If you are registered, switch it on and the tax is worked out for you.",
  },
  {
    id: "expiry",
    question: "What happens when my subscription ends?",
    answer:
      "You keep full access to everything already recorded — every sale, ledger and report stays available to read. What stops is recording new business until you renew.",
  },
  {
    id: "separate",
    question: "Is my data separate from other shops?",
    answer:
      "Yes. Every record belongs to your business and only your business. This is enforced on the server for every request, not merely hidden in the interface.",
  },
];
