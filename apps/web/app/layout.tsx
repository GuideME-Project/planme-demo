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
  metadataBase: new URL("https://planme-demo.vercel.app"),
  title: {
    default: "PlanME Demo",
    template: "%s | PlanME",
  },
  description: "GuideME 스타일의 여정으로 안내하는 PlanME 일정 데모입니다.",
  openGraph: {
    title: "PlanME 오사카 1박 2일 추천 일정",
    description: "Standard / CarryME 동선 비교와 상세 지도를 확인하세요.",
    images: ["/og"],
    type: "website",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <ThemeRegistry>{children}</ThemeRegistry>
      </body>
    </html>
  );
}
