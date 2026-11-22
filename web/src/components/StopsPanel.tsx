"use client";
/**
 * Stops, vias, must-use roads and avoids (section 13 stops panel; Phase 5 A6). Items are built by the API from
 * OSM data in the pinned extract (/v1/features/item), so a stop the runner adds equals the fixture's for the same
 * place. Bridges and roads have no search entry ("Karuvanthuruthy bridge" is not in OSM by name): tap the map and
 * pick from the ways there (/v1/features/nearby).
 *
 * Reordering with a handle moves the stop and sets the order to "my order". Each stop shows where the selected
 * route meets it (StopOnRoute.at_m, from the API).
 */
import { useEffect, useState } from "react";
import type { Map as MapLibreMap, MapMouseEvent } from "maplibre-gl";
import type { Schemas } from "@/api/client";
import { blocked, type Edit, type ListName, type RouteRequest } from "@/plan/edits";
import type { Place } from "@/plan/places";
import { call, type ApiFailure } from "@/plan/planClient";
import { planClient } from "@/plan/usePlan";
import { PlaceSearch } from "./PlaceSearch";
import { StopsTimeline } from "./StopsTimeline";
import { Button, Chip, IconButton } from "./ui";

type Version = Schemas["PlanVersionOut"];
type Candidate = Schemas["CandidateOut"];
type Role = "checkpoint" | "via" | "must_use" | "avoid";
type Kind = "place" | "bridge" | "road";
type Way = Schemas["NearbyWay"];

const LIST: Record<Role, ListName> = { checkpoint: "checkpoints", via: "via", must_use: "must_use", avoid: "avoid" };

export async function featureItem(role: Role, kind: Kind, placeId: string, place?: { lon: number; lat: number; label: string },
  mustReach = false, label?: string) {
  // the generated type is named: openapi-fetch widens [lon, lat] tuples
  return call<Schemas["FeatureItemOut"]>(() => planClient().api.GET("/v1/features/item", {
    params: { query: { role, kind, place_id: placeId, lon: place?.lon, lat: place?.lat, label: label ?? place?.label,
      must_reach: mustReach } },
  }));
}

type Props = { request: RouteRequest; version: Version; selected: Candidate | null; onEdit: (e: Edit) => void;
  near: [number, number] | null; map?: MapLibreMap | null; onMapPick?: (active: boolean) => void };

export function StopsPanel({ request, selected, onEdit, near, map, onMapPick }: Props) {
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState<Role | null>(null);
  const [tapFor, setTapFor] = useState<Role | null>(null);
  const [ways, setWays] = useState<{ role: Role; list: Way[] } | null>(null);
  const checkpoints = request.checkpoints ?? [];

  const [pending, setPending] = useState<string | null>(null);
  const add = async (role: Role, kind: Kind, placeId: string, place?: { lon: number; lat: number; label: string }) => {
    setError(null);
    setAdding(null);          // close the adder at once: a second tap on "+ Stop" opens a fresh one
    setWays(null);
    setPending(place?.label ?? "the road");
    try {
      const out = await featureItem(role, kind, placeId, place);
      const e = role === "checkpoint" ? { kind: "add" as const, list: "checkpoints" as const, item: out.checkpoint! }
        : role === "via" ? { kind: "add" as const, list: "via" as const, item: out.via! }
          : role === "must_use" ? { kind: "add" as const, list: "must_use" as const, item: out.must_use! }
            : { kind: "add" as const, list: "avoid" as const, item: out.avoid! };
      const why = blocked(request, e);
      if (why) return setError(why);
      onEdit(e);
    } catch (x) {
      setError(String((x as Error).message));
    } finally {
      setPending(null);
    }
  };

  // Tap the map to list the bridges and roads there.
  useEffect(() => {
    if (!map || !tapFor) return;
    onMapPick?.(true);            // on a phone the sheet steps aside so the map can be tapped
    map.getCanvas().style.cursor = "crosshair";
    const onClick = async (e: MapMouseEvent) => {
      map.getCanvas().style.cursor = "";
      const role = tapFor;
      setTapFor(null);
      setError(null);
      try {
        const { ways: here } = await call<Schemas["NearbyOut"]>(() => planClient().api.GET("/v1/features/nearby", {
          params: { query: { lon: e.lngLat.lng, lat: e.lngLat.lat, radius_m: 40 } } }));
        setWays({ role, list: here });
      } catch (x) {
        setWays(null);            // not an empty list: that would say there is no road there
        setError((x as ApiFailure).message);
      } finally {
        onMapPick?.(false);
      }
    };
    map.once("click", onClick);
    return () => {
      map.off("click", onClick);
      map.getCanvas().style.cursor = "";
    };
  }, [map, tapFor, onMapPick]);

  const toggleReach = async (i: number) => {
    const c = checkpoints[i]!;
    if (!c.must_reach) return onEdit({ kind: "must_reach_on", index: i, label: c.label });
    // Back to pass-near: the item needs its boundary again, from the API.
    try {
      const out = await featureItem("checkpoint", (c.kind ?? "place") as Kind, c.place_id ?? "", c, false, c.label);
      onEdit({ kind: "replace_checkpoint", index: i, label: c.label, item: out.checkpoint! });
    } catch (x) {
      setError(String((x as Error).message));
    }
  };

  return (
    <section className="stops" aria-label="Stops" id="stops-panel" tabIndex={-1}>
      <div className="section-head">
        <h2 className="t-heading">Stops</h2>
        {checkpoints.length > 1 && (
          <Chip aria-pressed={request.checkpoint_order === "fixed"}
            title="On: the stops in the order listed. Off: the order that makes the best route."
            onClick={() => onEdit({ kind: "checkpoint_order", value: request.checkpoint_order === "fixed" ? "auto" : "fixed" })}>
            My order
          </Chip>
        )}
      </div>
      <StopsTimeline request={request} selected={selected} onEdit={onEdit} toggleReach={toggleReach} />
      <OtherItems request={request} onEdit={onEdit} />
      {error && <p role="alert" className="error-text">{error}</p>}
      {pending && <p role="status" className="muted">Adding {pending}…</p>}
      <div className="add-row">
        {(["checkpoint", "via", "must_use", "avoid"] as Role[]).map((r) => (
          <Chip key={r} icon="plus" aria-expanded={adding === r} onClick={() => setAdding(adding === r ? null : r)}
            data-testid={`add-${r}`}>
            {{ checkpoint: "Stop", via: "Via", must_use: "Must use", avoid: "Avoid" }[r]}
          </Chip>
        ))}
      </div>
      {adding && (
        <div className="adder">
          {adding !== "must_use" && (
            <PlaceSearch label={{ checkpoint: "Add a stop", via: "Shape the route through", avoid: "Avoid a place", must_use: "" }[adding]}
              near={near} testId={`search-${adding}`}
              onPick={(p: Place) => add(adding, "place", p.place_id, { lon: p.lon, lat: p.lat, label: p.label })} />
          )}
          <Button icon="mapPin" onClick={() => setTapFor(adding)} aria-pressed={tapFor === adding} data-testid={`tap-${adding}`}>
            {tapFor === adding ? "Tap a bridge or road on the map…" : "Pick a bridge or road on the map"}
          </Button>
        </div>
      )}
      {ways && (
        <div className="picker" role="group" aria-label="Roads and bridges here">
          {ways.list.length === 0 && <p className="muted">No road there. Tap closer to a road.</p>}
          <ul>
            {ways.list.map((w) => (
              <li key={w.place_id}>
                {w.bridge && (
                  <button type="button" className="picker-item" data-place-id={w.place_id}
                    onClick={() => add(ways.role, "bridge", w.place_id)}>{w.label} <span className="muted">(this bridge)</span></button>
                )}
                {w.name && (
                  <button type="button" className="picker-item" onClick={() => add(ways.role, "road", w.place_id)}>
                    {w.label} <span className="muted">(the whole road)</span></button>
                )}
                {!w.bridge && !w.name && (
                  <button type="button" className="picker-item" onClick={() => add(ways.role, "road", w.place_id)}>{w.label}</button>
                )}
              </li>
            ))}
          </ul>
          <button type="button" className="link" onClick={() => setWays(null)}>Cancel</button>
        </div>
      )}
    </section>
  );
}

function OtherItems({ request, onEdit }: { request: RouteRequest; onEdit: (e: Edit) => void }) {
  const rows: { list: ListName; i: number; label: string; text: string }[] = [
    ...(request.via ?? []).map((x, i) => ({ list: "via" as const, i, label: x.label ?? "", text: `Via ${x.label ?? "a point"}` })),
    ...(request.must_use ?? []).map((x, i) => ({ list: "must_use" as const, i, label: x.label, text: `Must use ${x.label} (${x.kind})` })),
    ...(request.avoid ?? []).map((x, i) => ({ list: "avoid" as const, i, label: x.label, text: `Avoid ${x.label}` })),
  ];
  if (!rows.length) return null;
  return (
    <ul className="other-items">
      {rows.map((r) => (
        <li key={`${r.list}-${r.i}`}>
          <span>{r.text}</span>
          <IconButton icon="close" label={`Remove ${r.text}`}
            onClick={() => onEdit({ kind: "remove", list: r.list, index: r.i, label: r.label || null })} />
        </li>
      ))}
    </ul>
  );
}
