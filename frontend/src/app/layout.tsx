import type { Metadata } from "next";
import { Inter } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const inter = Inter({ subsets: ["latin"], variable: "--font-sans" });

export const metadata: Metadata = {
  title: {
    template: "%s | Byapar Admin & Business Management",
    default: "Byapar - Business Management & SaaS Admin Panel",
  },
  description:
    "Production business management SaaS with sales, purchases, inventory, customer/supplier credit, cash/bank tracking, and optional GST compliance.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className={`${inter.variable} font-sans min-h-screen bg-background antialiased`}>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
