import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "製造管理ツール",
  description: "化粧品・アロマ製品の製造管理ツール",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ja">
      <body className="min-h-screen font-sans antialiased">{children}</body>
    </html>
  );
}
