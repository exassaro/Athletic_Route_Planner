"use client";
/**
 * The top bar (blueprint Phase 5b amendment 8): a place search and the menu. During setup it shows the wordmark
 * instead of the search (the setup asks for places itself). A found place offers what can be done with it: start
 * there, run towards it, add it as a stop, or just show it on the map. The menu holds what used to sit in the sheet:
 * versions (undo, redo), saved routes, pace, theme, roads and paths, about, and the map credits.
 */
import { useState, type ReactNode } from "react";
import type { Place } from "@/plan/places";
import { EditorDialog } from "./EditorDialog";
import { PlaceSearch } from "./PlaceSearch";
import { Button, Icon, IconButton } from "./ui";
import { Wordmark } from "./Wordmark";

export type PlaceAction = "start" | "towards" | "stop" | "show";

type Props = {
  setupMode: boolean;
  near: [number, number] | null;
  canAddStop: boolean;
  onPlace: (p: Place, action: PlaceAction) => void;
  /** What the menu holds; a function when an item of it closes the menu. */
  menu: ReactNode | ((close: () => void) => ReactNode);
};

export function TopBar({ setupMode, near, canAddStop, onPlace, menu }: Props) {
  const [searching, setSearching] = useState(false);
  const [found, setFound] = useState<Place | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const close = () => { setSearching(false); setFound(null); };
  const act = (a: PlaceAction) => { if (found) onPlace(found, a); close(); };

  return (
    <header className="topbar">
      {setupMode ? (
        <span className="topbar-brand"><Wordmark height={21} /></span>
      ) : (
        <button type="button" className="topbar-search" onClick={() => setSearching(true)} aria-haspopup="dialog" data-testid="top-search-open">
          <Icon name="search" /><span>Search a place</span>
        </button>
      )}
      <IconButton icon="menu" label="Menu" onClick={() => setMenuOpen(true)} aria-haspopup="dialog" data-testid="menu-open" />

      <EditorDialog open={searching} title={found ? found.label : "Find a place"} onClose={close} testId="top-search">
        {!found ? (
          <PlaceSearch label="Search a place in Kerala" near={near} onPick={(p) => setFound(p)} testId="top-search-box" />
        ) : (
          <div className="place-actions">
            <Button icon="mapPin" onClick={() => act("start")}>Start here</Button>
            <Button icon="pointToPoint" onClick={() => act("towards")}>Run towards it</Button>
            {canAddStop && <Button icon="plus" onClick={() => act("stop")}>Add as a stop</Button>}
            <Button icon="map" onClick={() => act("show")}>Show on the map</Button>
          </div>
        )}
      </EditorDialog>

      <EditorDialog open={menuOpen} title="Menu" onClose={() => setMenuOpen(false)} testId="menu">
        <div className="menu-body">{typeof menu === "function" ? menu(() => setMenuOpen(false)) : menu}</div>
      </EditorDialog>
    </header>
  );
}
