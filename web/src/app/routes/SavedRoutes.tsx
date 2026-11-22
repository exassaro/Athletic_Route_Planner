"use client";
/**
 * Saved routes of this browser's client (section 13; blueprint Phase 5c): a card opens or edits its route, and the
 * rest is in its "..." menu. Delete runs at once, with Undo; the list changes first and rolls back on an error.
 */
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { CardMenu } from "@/components/CardMenu";
import { DeletedMessage } from "@/components/DeletedMessage";
import { Mascot } from "@/components/Mascot";
import { OpenInDialog } from "@/components/OpenIn";
import { RenameDialog } from "@/components/RenameDialog";
import { downloadGpx } from "@/components/SaveShare";
import { StatNumber } from "@/components/StatNumber";
import { Button, Snackbar } from "@/components/ui";
import { Wordmark } from "@/components/Wordmark";
import { ownRouteGpx, ownRouteOverview, ownRoutePoints } from "@/export/ownRoute";
import { apiSaid, type ApiFailure } from "@/plan/planClient";
import { planClient } from "@/plan/usePlan";
import { deleteSaved, listSaved, patchSaved, restoreSaved, type SavedRow } from "@/saved/api";
import { forgetDeleted, newDeleted, takeDeleted, type Deleted } from "@/saved/deleted";
import { displayName } from "@/saved/name";
import { relativeDate } from "@/saved/relative";
import { shareUrl } from "@/saved/share";

/** As the API orders them: the latest rename or update first. */
const byUpdate = (a: SavedRow, b: SavedRow) => Date.parse(b.updated_at) - Date.parse(a.updated_at) || a.saved_id.localeCompare(b.saved_id);

export function SavedRoutes() {
  const [routes, setRoutes] = useState<SavedRow[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [deleted, setDeleted] = useState<Deleted | null>(null);
  const [renaming, setRenaming] = useState<SavedRow | null>(null);
  const [openingIn, setOpeningIn] = useState<SavedRow | null>(null);
  const removed = useRef(new Map<string, SavedRow>());
  const title = useRef<HTMLHeadingElement>(null);
  const toggles = useRef(new Map<string, HTMLButtonElement>());

  const load = useCallback(() => listSaved(planClient()).then((rows) => {
    setRoutes(rows);
    setLoadError(null);
  }, (e: ApiFailure) => {
    // an unknown token has nothing saved; anything else is a failure, not an empty list
    if (apiSaid(e, 401)) setRoutes([]);
    else setLoadError(e.message);
  }), []);
  useEffect(() => {
    void load();
    // a delete made on the share page just before coming here; storage is readable only after hydration
    setDeleted(takeDeleted()); // eslint-disable-line react-hooks/set-state-in-effect
  }, [load]);

  const clearDeleted = () => {
    forgetDeleted();
    setDeleted(null);
  };

  const remove = async (r: SavedRow) => {
    setError(null);
    setRoutes((list) => list?.filter((x) => x.saved_id !== r.saved_id) ?? null);
    title.current?.focus();           // the card, and the focus with it, has gone
    try {
      await deleteSaved(planClient(), r.saved_id);
      removed.current.set(r.saved_id, r);
      setDeleted(newDeleted(r.saved_id, displayName(r.name)));
    } catch {
      setRoutes((list) => [...(list ?? []).filter((x) => x.saved_id !== r.saved_id), r].sort(byUpdate));
      setError("Could not delete. Try again.");
    }
  };

  const undoDelete = async (d: Deleted) => {
    setError(null);
    clearDeleted();
    title.current?.focus();
    const row = removed.current.get(d.savedId);
    if (row) setRoutes((list) => [...(list ?? []).filter((x) => x.saved_id !== row.saved_id), row].sort(byUpdate));
    try {
      await restoreSaved(planClient(), d.savedId);
      await load();
    } catch {
      setRoutes((list) => list?.filter((x) => x.saved_id !== d.savedId) ?? null);
      setDeleted(newDeleted(d.savedId, d.name));     // so Undo can be tried again
      setError("Could not undo. Try again.");
    }
  };

  const rename = async (r: SavedRow, name: string | null) => {
    const out = await patchSaved(planClient(), r.saved_id, { name });
    setRoutes((list) => list?.map((x) => (x.saved_id === r.saved_id ? { ...x, ...out } : x)).sort(byUpdate) ?? null);
  };

  return (
    <main className="saved-page">
      <p className="brand-row"><Link href="/" aria-label="GATHO: plan a run"><Wordmark height={28} /></Link></p>
      <h1 className="t-title" ref={title} tabIndex={-1}>Saved routes</h1>
      <p><Link href="/">Plan a run</Link></p>
      <p className="t-meta muted" data-testid="device-note">Saved routes live on this device until you sign in</p>
      {loadError ? (
        <div role="alert" className="opening-note">
          <p className="t-body-s">Saved routes didn&apos;t load. {loadError}</p>
          <div className="row"><Button icon="redo" onClick={load}>Try again</Button></div>
        </div>
      ) : routes === null && <p className="muted">Loading…</p>}
      {routes?.length === 0 && !loadError && (
        <div className="saved-empty" data-testid="saved-empty">
          <Mascot />
          <p className="t-heading">Nothing saved yet</p>
        </div>
      )}
      <ul className="saved-list">
        {routes?.map((r) => (
          <li key={r.saved_id} className="saved-card" data-saved-id={r.saved_id}>
            <div className="saved-head">
              <h2 className="t-heading saved-name">{displayName(r.name)}</h2>
              <CardMenu label={`More for ${displayName(r.name)}`}
                buttonRef={(el) => { if (el) toggles.current.set(r.saved_id, el); }}
                items={[
                  { label: "Rename", icon: "edit", onSelect: () => setRenaming(r) },
                  { label: "Open in…", icon: "externalLink", onSelect: () => setOpeningIn(r) },
                  { label: "Download GPX", icon: "download",
                    onSelect: () => downloadGpx(r.route_id, true).catch(() => setError("Could not download. Try again.")) },
                  { label: "Delete", icon: "trash", danger: true, onSelect: () => remove(r) },
                ]} />
            </div>
            <p className="saved-line"><StatNumber kind="km" value={r.foot_m} field="foot_m" size="m" />
              <span className="t-body-s muted"> · ends at {r.end_label ?? "an unnamed road"}</span></p>
            <p className="t-meta muted saved-when">
              Updated <time dateTime={r.updated_at}>{relativeDate(r.updated_at)}</time>
            </p>
            <div className="saved-actions">
              <a className="btn btn-secondary" href={shareUrl(r.share_slug)} data-testid="saved-open">Open</a>
              <Link className="btn btn-secondary" href={`/?edit=${r.saved_id}`} prefetch={false} data-testid="saved-edit">Edit</Link>
            </div>
          </li>
        ))}
      </ul>

      {renaming && (
        <RenameDialog key={renaming.saved_id} name={renaming.name} onSave={(name) => rename(renaming, name)}
          onClose={() => {
            const id = renaming.saved_id;
            setRenaming(null);
            setTimeout(() => toggles.current.get(id)?.focus());     // once the modal is gone
          }} />
      )}
      {openingIn && (
        <OpenInDialog open onClose={() => {
          const id = openingIn.saved_id;
          setOpeningIn(null);
          setTimeout(() => toggles.current.get(id)?.focus());
        }} footM={openingIn.foot_m} loadPoints={() => ownRoutePoints(openingIn.route_id)}
          loadOverview={(max) => ownRouteOverview(openingIn.route_id, max)}
          loadGpx={(ele) => ownRouteGpx(openingIn.route_id, ele)} />
      )}

      <div className="page-messages">
        {error && <Snackbar testId="saved-error" onDismiss={() => setError(null)}>{error}</Snackbar>}
        {deleted && <DeletedMessage key={deleted.at} deleted={deleted} onUndo={() => undoDelete(deleted)} onGone={clearDeleted} />}
      </div>
    </main>
  );
}
