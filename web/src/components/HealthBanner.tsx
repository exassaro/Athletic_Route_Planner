"use client";
/**
 * Engines down (from /v1/health): checked when the planner opens and after an error that may mean a service is
 * down. Says what does not work, in plain words, or why there is no answer to say it from.
 */
import { useEffect, useState } from "react";
import type { Schemas } from "@/api/client";
import { apiFailure, asFailure } from "@/plan/planClient";
import { planClient } from "@/plan/usePlan";

type Health = Schemas["HealthOut"];

// Not just `in`: something that is not the API answers with a page, which arrives here as a string.
function isHealth(body: unknown): body is Health {
  return typeof body === "object" && body !== null && "services" in body;
}

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
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    planClient().api.GET("/v1/health").then(({ data, error, response }) => {
      if (!live) return;
      const body: unknown = data ?? error;   // 503 still carries the body
      const known = isHealth(body);
      setHealth(known ? body : null);
      setProblem(known ? null : apiFailure(response.status, body).message);
    }, (e: unknown) => {
      if (live) setProblem(asFailure(e).message);
    });
    return () => {
      live = false;
    };
  }, [trigger]);
  if (problem) return <p className="banner warn" role="alert" data-testid="health-banner">{problem}</p>;
  if (!health || health.status === "ok") return null;
  const down = Object.entries(health.services).filter(([, s]) => !s.ok).map(([n]) => n);
  return (
    <div className="banner warn" role="alert" data-testid="health-banner" data-down={down.join(",")}>
      {down.map((n) => <p key={n}>{MEANING[n] ?? `${n} is down.`}</p>)}
    </div>
  );
}
