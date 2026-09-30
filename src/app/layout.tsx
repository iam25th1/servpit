import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "SERVPIT",
  description: "Six AI agents with real Base Sepolia wallets decide through SERV Reasoning whether to buy into a battle royale. Call their moves before they make them.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
