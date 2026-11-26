import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "TRADING DESK — 경제지표 · 마켓뉴스 · 트레이더 포지션 추적",
  description: "트레이딩 중 상시 열어두는 클래식 화이트 트레이딩 데스크: 레벨3 경제지표 캘린더, 실시간 뉴스, 하이퍼리퀴드 & 유튜브 라이브 트레이더 포지션 추적",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="min-h-screen bg-white text-[#111827]">{children}</body>
    </html>
  );
}
