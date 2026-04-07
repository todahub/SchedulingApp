import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Awase Scheduler MVP",
  description: "曖昧な参加可否も扱える日程調整アプリのMVP",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ja">
      <body>{children}</body>
    </html>
  );
}
