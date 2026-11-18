"use client";
/**
 * Engines down (from /v1/health): checked when the planner opens and after an error that may mean a service is
 * down. Says what does not work, in plain words.
 */
import { useEffect, useState } from "react";
import type { Schemas } from "@/api/client";
import { planClient } from "@/plan/usePlan";

type Health = Schemas["HealthOut"];

const MEANING: Record<string, string> = {
  valhalla: "Routes can't be made right now (the routing engine is down).",
  graphhopper: "Only the shortest route is available right now.",
  photon: "Place search is down; you can still tap the map.",
  postgres: "Plans can't be saved right now.",
  redis: "The planner is not fully available right now.",
  osm_features: "Bridges, roads and place areas can't be added right now.",
};

export function HealthBanner({ trigger }: { trigger: string | null }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [unreachable, setUnreachable] = useState(false);
  useEffect(() => {
    let live = true;
    planClient().api.GET("/v1/health").then(({ data, error }) => {
      if (!live) return;
      const h = (data ?? (error as Health | undefined)) ?? null;   // 503 still carries the body
      setHealth(h && "services" in h ? h : null);
      setUnreachable(!h);
    }, () => live && setUnreachable(true));
    return () => {
      live = false;
    };
  }, [trigger]);
  if (unreachable) return <p className="banner warn" role="alert" data-testid="health-banner">The planner can&apos;t reach its server. Check your connection.</p>;
  if (!health || health.status === "ok") return null;
  const down = Object.entries(health.services).filter(([, s]) => !s.ok).map(([n]) => n);
  return (
    <div className="banner warn" role="alert" data-testid="health-banner" data-down={down.join(",")}>
      {down.map((n) => <p key={n}>{MEANING[n] ?? `${n} is down.`}</p>)}
    </div>
  );
}
