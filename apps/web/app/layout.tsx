import { headers } from "next/headers";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { defaultLocale, isLocale } from "@/lib/i18n/routing";
import { planmeOpenGraphImage } from "@/lib/brand-metadata";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Oswald, Poppins } from "next/font/google";
import "./globals.css";
import { ThemeRegistry } from "@/theme/ThemeRegistry";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const homeDisplay = Oswald({ variable: "--font-home-display", subsets: ["latin"], weight: ["500", "600", "700"], display: "swap" });
const homeBody = Poppins({ variable: "--font-home-body", subsets: ["latin"], weight: ["400", "500", "600"], display: "swap" });

export const metadata: Metadata = {
  metadataBase: new URL("https://www.planme.kr"),
  title: {
    default: "PlanME Demo",
    template: "%s | PlanME",
  },
  description: "Create your own travel itinerary with PlanME and explore flights, stays, and activities.",
  openGraph: {
    title: "PlanME Demo",
    description: "Create your own travel itinerary with PlanME and explore flights, stays, and activities.",
    images: [planmeOpenGraphImage],
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestedLocale = (await headers()).get("x-planme-locale") ?? defaultLocale;
  const locale = isLocale(requestedLocale) ? requestedLocale : defaultLocale;
  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} ${homeDisplay.variable} ${homeBody.variable} h-full antialiased`}
    >
      <head />
      <body className="min-h-full flex flex-col">
        <LocaleProvider locale={locale}><ThemeRegistry>{children}</ThemeRegistry></LocaleProvider>
      </body>
    </html>
  );
}
