"use client";
/**
 * The frame of the share page, which is also the saved-route view (blueprint Phase 5b amendment 21): the planner's
 * map and bottom sheet, opening at peek so the map shows, with the stats in the peek bar and a "Map" button that
 * drops the sheet back there. On a desktop the side panel collapses. What the sheet holds is rendered on the server.
 * The route's owner also gets a slim bar above the sheet (Phase 5c).
 */
import Link from "next/link";
import { useState, type ReactNode } from "react";
import type { Schemas } from "@/api/client";
import { usePace } from "@/plan/pace";
import { useOwner } from "@/saved/useOwner";
import { BottomSheet, type Snap } from "./sheet/BottomSheet";
import { OwnerBar } from "./OwnerBar";
import { PeekBar } from "./PeekBar";
import { ShareMap } from "./ShareMap";
import { Button } from "./ui";
import { Wordmark } from "./Wordmark";

type Props = {
  slug: string;
  route: Schemas["RouteFeature"];
  kmMarks: Schemas["KmMark"][];
  children: ReactNode;
};

export function SharedView({ slug, route, kmMarks, children }: Props) {
  const [sheet, setSheet] = useState<Snap>("peek");
  const [collapsed, setCollapsed] = useState(false);
  const [pace] = usePace();
  const [owned, setOwned] = useOwner(slug);
  return (
    <main className={`planner share-view sheet-${sheet}${collapsed ? " panel-collapsed" : ""}`}>
      <ShareMap slug={slug} route={route} kmMarks={kmMarks} covering={owned ? "owner" : ""} />
      <header className="topbar">
        <Link className="topbar-brand" href="/" aria-label="GATHO: plan your own run"><Wordmark height={21} /></Link>
        <Button icon="map" className="to-map" onClick={() => setSheet("peek")} data-testid="to-map">Map</Button>
        <Button icon={collapsed ? "chevronRight" : "chevronLeft"} className="panel-toggle" aria-expanded={!collapsed}
          onClick={() => setCollapsed(!collapsed)} data-testid="panel-toggle">
          {collapsed ? "Show details" : "Hide"}
        </Button>
      </header>
      <BottomSheet snap={sheet} onSnap={setSheet} label="Shared route"
        banner={owned && <OwnerBar owned={owned} onChange={setOwned} />}>
        <PeekBar cand={route.properties as Schemas["CandidateOut"]} pace={pace} />
        {children}
      </BottomSheet>
    </main>
  );
}
