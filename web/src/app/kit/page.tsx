/**
 * The GATHO component kit (Phase 5b step 2): every base component in its states, for checking both themes, touch
 * targets and Lighthouse accessibility. Off unless the server runs with GATHO_UI_KIT=1; never linked.
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Kit } from "./Kit";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Component kit", robots: { index: false, follow: false } };

export default function KitPage() {
  if (process.env.GATHO_UI_KIT !== "1") notFound();
  return <Kit />;
}
