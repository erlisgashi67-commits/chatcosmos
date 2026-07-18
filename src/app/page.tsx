"use client";
/**
 * ChatCosmos entry route.
 * Dynamically imported with ssr:false to avoid three.js touching the
 * server-side render path.
 */
import dynamic from "next/dynamic";

const ChatCosmos = dynamic(
  () => import("@/components/cosmos/ChatCosmos").then((m) => m.ChatCosmos),
  { ssr: false }
);

export default function Home() {
  return <ChatCosmos />;
}
