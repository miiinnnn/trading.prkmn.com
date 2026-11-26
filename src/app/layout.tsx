import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "NQ1! — CME E-mini Nasdaq-100 차트",
  description: "CME E-mini Nasdaq-100 선물 근월물 연속 1분봉 차트",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ko">
      <body className="h-screen w-screen overflow-hidden bg-white text-[#131722]">
        {children}
      </body>
    </html>
  );
}
