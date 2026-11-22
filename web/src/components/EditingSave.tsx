"use client";
/**
 * The save control while a saved route is edited (blueprint Phase 5c amendment 2): "Update <name>" keeps the saved
 * route and its share link and points them at the selected route; "Save as new" makes another with its own link.
 */
import { useId, useState } from "react";
import type { Schemas } from "@/api/client";
import { ApiFailure, type RouteRequest } from "@/plan/planClient";
import { planClient, type Editing } from "@/plan/usePlan";
import { patchSaved, saveRoute } from "@/saved/api";
import { changed } from "@/saved/changed";
import { NAME_MAX, nameLength } from "@/saved/name";
import { shareUrl } from "@/saved/share";
import { Button } from "./ui";

type Props = {
  editing: Editing;
  request: RouteRequest;
  cand: Schemas["CandidateOut"];
  /** A solve is running: the route on screen is about to be replaced. */
  solving: boolean;
  onUpdated: (next: Editing, previous: Editing) => void;
  onSavedAsNew: (next: Editing) => void;
};

export function EditingSave({ editing, request, cand, solving, onUpdated, onSavedAsNew }: Props) {
  const [name, setName] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ids = useId();
  const { saved } = editing;
  const isChanged = changed(editing, request, cand);

  const send = async (work: () => Promise<void>, failed: string) => {
    setError(null);
    setSending(true);
    try {
      await work();
    } catch (e) {
      setError(e instanceof ApiFailure && e.status === 404
        ? "This saved route was deleted. Use Save as new to keep this one." : failed);
    } finally {
      setSending(false);
    }
  };
  const update = () => send(async () => {
    const out = await patchSaved(planClient(), saved.saved_id, { route_id: cand.route_id });
    onUpdated({ saved: out, request, route: cand }, editing);
  }, "Could not update. Try again.");
  const saveAsNew = () => send(async () => {
    const out = await saveRoute(planClient(), cand.route_id, name.trim() || null, true);
    setName("");
    onSavedAsNew({ saved: out, request, route: cand });
  }, "Could not save. Try again.");

  return (
    <div className="editing-save" data-testid="editing-save">
      <p className="t-body-s" id={`${ids}-who`}>Anyone with the share link will see the updated route.</p>
      <Button variant="primary" block className="update-button" onClick={update} disabled={!isChanged || solving || sending}
        aria-describedby={`${ids}-who ${ids}-hint`} data-testid="update">
        <span className="ellipsis">Update {saved.name ?? "this route"}</span>
      </Button>
      <p className="t-meta muted" id={`${ids}-hint`} data-testid="update-hint">{isChanged ? "" : "No changes yet"}</p>
      <div className="row">
        <label htmlFor={`${ids}-name`} className="sr-only">Name for the new route</label>
        <input id={`${ids}-name`} placeholder="New name (optional)" value={name} onChange={(e) => setName(e.target.value)}
          aria-invalid={nameLength(name) > NAME_MAX} data-testid="new-name" />
        <Button onClick={saveAsNew} disabled={solving || sending || nameLength(name) > NAME_MAX} data-testid="save-as-new">Save as new</Button>
      </div>
      {nameLength(name) > NAME_MAX && <p role="alert" className="error-text">At most {NAME_MAX} characters.</p>}
      {error && <p role="alert" className="error-text">{error}</p>}
      <p className="share">
        <a href={shareUrl(saved.share_slug)} target="_blank" rel="noreferrer" data-testid="share-link">{shareUrl(saved.share_slug)}</a>
      </p>
    </div>
  );
}
