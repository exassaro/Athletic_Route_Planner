"use client";
/**
 * Engines down (from /v1/health): checked when the planner opens and after an error that may mean a service is
 * down. Says what does not work, in plain words, or why there is no answer to say it from. Reads the public body
 * (Step 9 amendment 5): what works, and an opaque id of each engine's map for the "older map" note.
 */
import { useEffect, useState } from "react";
import type { Schemas } from "@/api/client";
import { apiFailure, asFailure } from "@/plan/planClient";
import { planClient } from "@/plan/usePlan";

type Health = Schemas["PublicHealthOut"];
type Feature = keyof Health["features"];

// Not just `in`: something that is not the API answers with a page, which arrives here as a string.
function isHealth(body: unknown): body is Health {
  return typeof body === "object" && body !== null && "features" in body && "map" in body;
}

const MEANING: Record<Feature, string> = {
  planning: "Planning is temporarily unavailable. Try again in a few minutes.",
  recommended: "Only the shortest route is available right now.",
  search: "Place search is down; you can still tap the map.",
};

export function HealthBanner({ trigger, onMap }: { trigger: string | null; onMap?: (map: Health["map"]) => void }) {
  const [health, setHealth] = useState<Health | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    planClient().api.GET("/v1/health").then(({ data, error, response }) => {
      if (!live) return;
      const body: unknown = data ?? error;   // 503 still carries the body
      const known = isHealth(body);
      setHealth(known ? body : null);
      if (known) onMap?.(body.map);
      setProblem(known ? null : apiFailure(response.status, body).message);
    }, (e: unknown) => {
      if (live) setProblem(asFailure(e).message);
    });
    return () => {
      live = false;
    };
  }, [trigger, onMap]);
  if (problem) return <p className="banner warn" role="alert" data-testid="health-banner">{problem}</p>;
  if (!health || health.status === "ok") return null;
  const down = (Object.keys(MEANING) as Feature[]).filter((f) => !health.features[f]);
  if (!down.length) return null;
  return (
    <div className="banner warn" role="alert" data-testid="health-banner" data-down={down.join(",")}>
      {down.map((n) => <p key={n}>{MEANING[n]}</p>)}
    </div>
  );
}
