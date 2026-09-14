import { headers } from "next/headers";
import { LocaleProvider } from "@/components/i18n/LocaleProvider";
import { isLocale } from "@/lib/i18n/routing";
import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  metadataBase: new URL("https://www.planme.kr"),
  title: {
    default: "PlanME Demo",
    template: "%s | PlanME",
  },
  description: "GuideME 스타일의 여정으로 안내하는 PlanME 일정 데모입니다.",
  openGraph: {
    title: "PlanME Demo",
    description: "GuideME 스타일의 여정으로 안내하는 PlanME 일정 데모입니다.",
    images: ["/og"],
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const requestedLocale = (await headers()).get("x-planme-locale") ?? "ko";
  const locale = isLocale(requestedLocale) ? requestedLocale : "ko";
  return (
    <html
      lang={locale}
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head />
      <body className="min-h-full flex flex-col">
        <LocaleProvider locale={locale}><ThemeRegistry>{children}</ThemeRegistry></LocaleProvider>
      </body>
    </html>
  );
}
