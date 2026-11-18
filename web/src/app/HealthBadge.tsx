"use client";

import { useEffect, useState } from "react";
import { api } from "@/api/client";
import type { components } from "@/api/schema";

type Health = components["schemas"]["HealthOut"];

export function HealthBadge() {
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.GET("/v1/health").then(({ data, error: err }) => {
      if (data) setHealth(data);
      else setError(err ? "API answered with an error" : "No answer");
    }, () => setError("API unreachable"));
  }, []);
  if (error) return <p role="status">{error}</p>;
  if (!health) return <p role="status">Checking the API…</p>;
  return (
    <ul aria-label="Services">
      {Object.entries(health.services).map(([name, s]) => (
        <li key={name}>
          {name}: {s.ok ? "up" : `down (${s.detail ?? "no detail"})`}
        </li>
      ))}
    </ul>
  );
}
