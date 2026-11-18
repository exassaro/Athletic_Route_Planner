/**
 * The share page (section 13; Phase 5 amendment 1: server-rendered). Read-only: the route on the map, its stats
 * and the GPX download. Public, no token; the plan id stays private (the API leaves it out).
 */
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache } from "react";
import type { Schemas } from "@/api/client";
import { API_BASE } from "@/api/client";
import { serverApi } from "@/api/server";
import { Num } from "@/components/Num";
import { ShareMap } from "@/components/ShareMap";
import { km, metres } from "@/plan/format";
import { ShareTime } from "./ShareTime";
import Link from "next/link";

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
  if (!shared) return { title: "Route not found · Athlete Router" };
  const p = shared.route.properties as { foot_m: number };
  const title = `${shared.name ?? `${km(p.foot_m)} run`} · Athlete Router`;
  return { title, description: shared.summary, openGraph: { title, description: shared.summary } };
}

export default async function SharePage({ params }: Props) {
  const { slug } = await params;
  const shared = await getShared(slug);
  if (!shared) notFound();
  const p = shared.route.properties as Schemas["CandidateOut"];
  const stops = (p.stops ?? []).filter((s) => s.role === "checkpoint");
  return (
    <main className="share-page">
      <div className="share-map"><ShareMap route={shared.route} /></div>
      <section className="share-panel" aria-label="Shared route">
        <h1>{shared.name ?? "A shared run"}</h1>
        <p className="muted small">Shared {new Date(shared.shared_at).toISOString().slice(0, 10)}</p>
        <dl className="stats">
          <div><dt>Distance</dt><dd><Num value={p.foot_m} format={(m) => km(m)} field="foot_m" className="big" /></dd></div>
          <div><dt>Time at your pace</dt><dd><ShareTime footM={p.foot_m} /></dd></div>
          <div>
            <dt>Climb</dt>
            <dd>
              {p.gain_m == null ? "not known" : (
                <>
                  +<Num value={p.gain_m} format={metres} field="gain_m" /> / −<Num value={p.loss_m ?? 0} format={metres} field="loss_m" />
                  {p.climb_approximate && <span className="approx">approx.</span>}
                </>
              )}
            </dd>
          </div>
          <div><dt>End</dt><dd>{p.end.label ?? "an unnamed road"}</dd></div>
        </dl>
        <p data-testid="share-summary">{shared.summary}</p>
        {stops.length > 0 && (
          <ol className="detail-stops">
            {stops.map((s, i) => <li key={i}>{s.label} · <Num value={s.at_m} format={(m) => km(m)} field="stops.at_m" /></li>)}
          </ol>
        )}
        <p className="row">
          <a className="button primary" href={`${API_BASE}/v1/share/${slug}/gpx`} data-testid="share-gpx">Download GPX</a>
          <a className="button" href={`${API_BASE}/v1/share/${slug}/gpx?ele=false`}>GPX without elevation</a>
        </p>
        <p className="row"><Link href="/">Plan your own run</Link></p>
      </section>
    </main>
  );
}
