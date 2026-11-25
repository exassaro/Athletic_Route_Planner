import type { Metadata } from "next";
import { LinkClaim } from "./LinkClaim";

export const metadata: Metadata = { title: "Link this device", referrer: "no-referrer", robots: { index: false } };

export default function Page() {
  return <LinkClaim />;
}
