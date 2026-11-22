import { Planner } from "@/components/Planner";

/**
 * The planner. `/?edit=<saved_id>` opens that saved route in it (blueprint Phase 5c amendment 2) and
 * `/?plan=<id>&v=<n>&r=<card>` a plan (Phase 5e amendment 1); the planner reads both in the browser.
 */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { edit } = await searchParams;
  const id = typeof edit === "string" && edit ? edit : null;
  return <Planner key={id ?? "new"} />;
}
