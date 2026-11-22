"use client";
/**
 * Search a place through the API (Photon, Kerala only) and let the runner pick. The API never picks
 * (Phase 4 amendment 8), and neither does this: even a single result is shown for a tap. Ambiguous names show the
 * picker: groups by name and district, each member with its kind, and a mini-map of every candidate.
 */
import { useEffect, useId, useRef, useState } from "react";
import type { Map as MapLibreMap, Marker } from "maplibre-gl";
import { MapView } from "@/map/MapView";
import { groupPlaces, kindName, type Place } from "@/plan/places";
import type { Schemas } from "@/api/client";
import { apiSaid, call, type ApiFailure } from "@/plan/planClient";
import { planClient } from "@/plan/usePlan";

type Props = {
  label: string;
  placeholder?: string;
  near?: [number, number] | null;
  onPick: (place: Place) => void;
  testId?: string;
};

export function PlaceSearch({ label, placeholder, near, onPick, testId }: Props) {
  const id = useId();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[] | null>(null);
  const [ambiguous, setAmbiguous] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [focus, setFocus] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const text = q.trim();
    const mine = ++seq.current;       // also when the box is cleared: an answer still on its way is stale
    if (text.length < 2) {
      setResults(null); // eslint-disable-line react-hooks/set-state-in-effect
      setError(null);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const found = await call<Schemas["PlaceSearchOut"]>(() => planClient().api.GET("/v1/places/search", {
          params: { query: { q: text, lon: near?.[0], lat: near?.[1], limit: 10 } },
        }));
        if (mine !== seq.current) return;
        setError(null);
        setResults(found.candidates);
        setAmbiguous(found.ambiguous);
      } catch (e) {
        if (mine !== seq.current) return;
        setError(apiSaid(e, 503) ? "Place search is down right now." : (e as ApiFailure).message);
        setResults(null);
      }
    }, 350);
    return () => clearTimeout(t);
  }, [q, near]);

  const pick = (p: Place) => {
    onPick(p);
    setQ("");
    setResults(null);
  };
  const groups = results ? groupPlaces(results) : [];
  const ordered = groups.flatMap((g) => g.members);       // the numbers on the list and on the mini-map

  return (
    <div className="place-search" data-testid={testId}>
      <label htmlFor={id} className="field-label">{label}</label>
      <input id={id} type="search" value={q} placeholder={placeholder ?? "Search a place in Kerala"} autoComplete="off"
        onChange={(e) => setQ(e.target.value)} aria-describedby={error ? `${id}-err` : undefined} />
      {error && <p id={`${id}-err`} role="alert" className="error-text">{error}</p>}
      {results && results.length === 0 && <p className="muted">No place in Kerala by that name.</p>}
      {results && results.length > 0 && (
        <div className="picker" role="group" aria-label={ambiguous ? `Which ${q.trim()}? Pick one.` : "Results"}>
          {ambiguous && <p className="picker-title">Which {q.trim()}? Pick one.</p>}
          <ul className="picker-list">
            {groups.map((g) => (
              <li key={g.key} className="picker-group">
                <div className="picker-group-head">
                  <strong>{g.label}</strong>
                  {g.county && <span className="muted"> · {g.county}</span>}
                </div>
                <ul>
                  {g.members.map((m) => (
                    <li key={m.place_id}>
                      <button type="button" className="picker-item" onClick={() => pick(m)}
                        onMouseEnter={() => setFocus(m.place_id)} onFocus={() => setFocus(m.place_id)}
                        data-place-id={m.place_id}>
                        {ambiguous && <span className="picker-num">{ordered.indexOf(m) + 1}</span>}
                        {kindName(m.kind)}{m.city && m.city !== g.label ? `, ${m.city}` : ""}
                      </button>
                    </li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
          {ambiguous && <MiniMap places={ordered} focus={focus} />}
        </div>
      )}
    </div>
  );
}

function MiniMap({ places, focus }: { places: Place[]; focus: string | null }) {
  const [map, setMap] = useState<MapLibreMap | null>(null);
  const markers = useRef<Map<string, Marker>>(new Map());
  useEffect(() => {
    if (!map) return;
    let live = true;
    (async () => {
      const maplibregl = await import("maplibre-gl");
      if (!live) return;
      markers.current.forEach((m) => m.remove());
      markers.current.clear();
      const bounds = new maplibregl.LngLatBounds();
      places.forEach((p, i) => {
        const el = document.createElement("div");
        el.className = "mini-marker";
        el.textContent = String(i + 1);
        markers.current.set(p.place_id, new maplibregl.Marker({ element: el }).setLngLat([p.lon, p.lat]).addTo(map));
        bounds.extend([p.lon, p.lat]);
      });
      if (!bounds.isEmpty()) map.fitBounds(bounds, { padding: 30, maxZoom: 13, duration: 0 });
    })();
    return () => {
      live = false;
    };
  }, [map, places]);
  useEffect(() => {
    markers.current.forEach((m, id) => m.getElement().classList.toggle("focus", id === focus));
  }, [focus]);
  return (
    <div className="mini-map" aria-hidden="true">
      <MapView onReady={setMap} interactive={false} />
    </div>
  );
}
