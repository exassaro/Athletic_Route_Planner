/** Follow mode: `/follow?saved=<saved_id>`, `?route=<route_id>` or `?share=<slug>` (blueprint Phase 5d amendment 4). */
import type { Metadata } from "next";
import { FollowPage } from "@/components/follow/FollowPage";
import { followTarget } from "@/components/follow/target";

export const metadata: Metadata = { title: "Follow", robots: { index: false } };

export default async function Page({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  return <FollowPage target={followTarget(await searchParams)} />;
}
