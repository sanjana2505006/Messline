import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Messline",
  description: "Mess food booking. Plates go down when someone books.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
