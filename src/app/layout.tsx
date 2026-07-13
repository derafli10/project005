import type { Metadata } from "next";
import { Inter, Poppins, Geist_Mono } from "next/font/google";
import "./globals.css";

import { LocaleProvider } from "@/i18n/LocaleProvider";
import { getLocaleWithDictionary } from "@/i18n/server";
import { LOCALE_TO_BCP47 } from "@/i18n/config";

/**
 * Inter — body text, labels, UI chrome.
 * High x-height for small sizes; tabular figures for score/date columns.
 * Task 20.3: Typography scale using Inter.
 */
const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

/**
 * Poppins — display headings, hero text, widget titles.
 * Geometric humanist that balances Gen-Z energy with academic readability.
 * Task 20.3: Typography scale using Poppins.
 */
const poppins = Poppins({
  variable: "--font-poppins",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  display: "swap",
});

/**
 * Geist Mono — code, debugging displays.
 */
const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Project005 — Task Management DSS",
  description:
    "Academic task management system with Decision Support System (DSS) capabilities for Gen Z students.",
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const { locale, dictionary } = await getLocaleWithDictionary();
  const htmlLang = LOCALE_TO_BCP47[locale];

  return (
    <html
      lang={htmlLang}
      className={`${inter.variable} ${poppins.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <LocaleProvider locale={locale} dictionary={dictionary}>
          {children}
        </LocaleProvider>
      </body>
    </html>
  );
}

