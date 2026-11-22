/**
 * The share page, which is also the saved-route view (section 13; Phase 5 amendment 1: server-rendered; Phase 5b
 * amendment 21: the planner's sheet, SharedView). Read-only: the route on the map, its numbers in the peek bar,
 * the stops with their distance marks, and the ways to take it elsewhere. Public, no token; the plan id stays
 * private (the API leaves it out). Its buttons are secondary (the retro budget: the wordmark, the numerals and
 * the markers are this page's three).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import Link from "next/link";
import type { Schemas } from "@/api/client";
import { OG_IMAGE } from "@/brand/meta";
import { API_BASE } from "@/api/client";
import { serverApi } from "@/api/server";
import { Num } from "@/components/Num";
import { SharedView } from "@/components/SharedView";
import { ShareOpenIn } from "@/components/ShareOpenIn";
import { Sprite } from "@/components/Sprite";
import { Icon } from "@/components/ui";
import { km, metres } from "@/plan/format";

type Shared = Schemas["SharedRouteOut"];
type Props = { params: Promise<{ slug: string }> };

const getShared = cache(async (slug: string): Promise<Shared | null> => {
  const { data, response } = await serverApi.GET("/v1/share/{slug}", { params: { path: { slug } }, cache: "no-store" });
  if (response.status === 404) return null;
  if (!data) throw new Error(`The API answered ${response.status}`);
  return data as Shared;
});

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const shared = await getShared((await params).slug);
  if (!shared) return { title: "Route not found" };
  const p = shared.route.properties as { foot_m: number };
  const name = shared.name ?? `${km(p.foot_m)} run`;   // the layout's template adds " · GATHO"
  return {
    title: name,
    description: shared.summary,
    openGraph: { title: `${name} · GATHO`, description: shared.summary, siteName: "GATHO", type: "article", images: [OG_IMAGE] },
  };
}

export default async function SharePage({ params }: Props) {
  const { slug } = await params;
  const shared = await getShared(slug);
  if (!shared) notFound();
  const p = shared.route.properties as Schemas["CandidateOut"];
  const stops = p.stops ?? [];
  const start = stops.find((s) => s.role === "start");
  const end = stops.find((s) => s.role === "end");
  const checkpoints = stops.filter((s) => s.role === "checkpoint");
  const line = shared.route.geometry.coordinates;
  const lonLat = (point: readonly number[]) => [point[0]!, point[1]!] as const;
  return (
    <SharedView slug={slug} route={shared.route} kmMarks={shared.km_marks}>
      <div className="share-details">
        <h1 className="t-title">{shared.name ?? "A shared run"}</h1>
        <p className="t-body-s muted share-meta" data-testid="share-summary">
          {start?.label ?? "Start"} to {p.end.label ?? "an unnamed road"} · shared {new Date(shared.shared_at).toISOString().slice(0, 10)}
        </p>
        <ol className="timeline share-timeline" aria-label="Start, stops and end">
          {start && (
            <li className="tl-row">
              <span className="tl-node" aria-hidden="true"><Sprite name="sneaker" scale={1} /></span>
              <span className="tl-text"><span className="tl-name">{start.label ?? "Start"}</span><span className="tl-sub t-meta muted">Start</span></span>
              <span className="tl-km"><Num value={start.at_m} format={(m) => km(m)} field="stops.at_m" /></span>
            </li>
          )}
          {checkpoints.map((s, i) => (
            <li key={i} className="tl-row">
              <span className={`tl-node tl-num${s.must_reach ? " must" : ""}`} aria-hidden="true">{i + 1}</span>
              <span className="tl-text">
                <span className="tl-name">{s.label}</span>
                <span className="tl-sub t-meta muted">
                  {s.kind && s.kind !== "place" ? (s.kind === "bridge" ? "Bridge" : "Road") : s.must_reach ? "Must reach" : "Pass near"}
                  {s.how === "via" && s.pass_walk_m != null && <> · <Num value={s.pass_walk_m} format={metres} field="stops.pass_walk_m" /> away on foot</>}
                </span>
              </span>
              <span className="tl-km"><Num value={s.at_m} format={(m) => km(m)} field="stops.at_m" /></span>
            </li>
          ))}
          {end && p.end.kind !== "start" && (
            <li className="tl-row">
              <span className="tl-node" aria-hidden="true"><Icon name="flag" /></span>
              <span className="tl-text"><span className="tl-name">{p.end.label ?? "An unnamed road"}</span><span className="tl-sub t-meta muted">End</span></span>
              <span className="tl-km"><Num value={end.at_m} format={(m) => km(m)} field="stops.at_m" /></span>
            </li>
          )}
        </ol>
        <div className="share-actions">
          <ShareOpenIn slug={slug} start={lonLat(line[0]!)} end={lonLat(line[line.length - 1]!)} kmMarks={shared.km_marks} />
          <a className="btn btn-secondary" href={`${API_BASE}/v1/share/${slug}/gpx`} data-testid="share-gpx">
            <Icon name="download" />Download GPX
          </a>
          <a className="btn btn-quiet" href={`${API_BASE}/v1/share/${slug}/gpx?ele=false`}>GPX without elevation</a>
        </div>
        <p><Link className="btn btn-secondary btn-block" href="/">Plan your own run</Link></p>
      </div>
    </SharedView>
  );
}
