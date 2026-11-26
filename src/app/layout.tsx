import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NQ.FUT 백테스터 | 이동평균선 교차 전략",
  description: "CME E-mini Nasdaq-100 선물 근월물 연속 1분봉 데이터 기반 고속 웹 백테스팅 플랫폼",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko" className="dark">
      <body className="min-h-screen bg-[#090d16] text-slate-100 antialiased">
        {children}
      </body>
    </html>
  );
}
