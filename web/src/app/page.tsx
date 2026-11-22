import { Planner } from "@/components/Planner";

/** The planner; `/?edit=<saved_id>` opens that saved route in it (blueprint Phase 5c amendment 2). */
export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { edit } = await searchParams;
  const id = typeof edit === "string" && edit ? edit : null;
  return <Planner key={id ?? "new"} editSavedId={id} />;
}
