import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ChatCosmos — Fly through your AI chat history in 3D",
  description:
    "ChatCosmos turns thousands of AI conversations into a navigable 3D galaxy. Each star is a chat, clustered by topic. Fly through your own thoughts.",
  keywords: ["ChatCosmos", "3D", "visualization", "AI chats", "UMAP", "HDBSCAN", "React Three Fiber"],
  authors: [{ name: "ChatCosmos" }],
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
  },
  openGraph: {
    title: "ChatCosmos",
    description: "Fly through your AI chat history as a 3D galaxy of stars.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "ChatCosmos",
    description: "Fly through your AI chat history as a 3D galaxy of stars.",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-background text-foreground`}
      >
        {children}
        <Toaster />
      </body>
    </html>
  );
}
