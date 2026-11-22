"use client";
/**
 * The owner's slim bar on the share page (blueprint Phase 5c): Edit, Rename and Delete, by the saved routes page's
 * rules. Visitors never see it. After a delete it goes to Saved routes, where the Undo message waits.
 */
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { planClient } from "@/plan/usePlan";
import { deleteSaved, patchSaved, type SavedRow } from "@/saved/api";
import { newDeleted } from "@/saved/deleted";
import { displayName } from "@/saved/name";
import { RenameDialog } from "./RenameDialog";

type Props = { owned: SavedRow; onChange: (row: SavedRow) => void };

export function OwnerBar({ owned, onChange }: Props) {
  const router = useRouter();
  const [renaming, setRenaming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState(false);
  const renameButton = useRef<HTMLButtonElement>(null);

  const rename = async (name: string | null) => {
    const out = await patchSaved(planClient(), owned.saved_id, { name });
    onChange({ ...owned, ...out });
    router.refresh();              // the name on the page is rendered on the server
  };
  const remove = async () => {
    setError(false);
    setDeleting(true);
    try {
      await deleteSaved(planClient(), owned.saved_id);
      newDeleted(owned.saved_id, displayName(owned.name));
      router.push("/routes");
    } catch {
      setDeleting(false);
      setError(true);
    }
  };

  return (
    <>
      {error && <p role="alert" className="owner-error" data-testid="owner-error">Could not delete. Try again.</p>}
      <section className="owner-bar" aria-label="Your route" data-testid="owner-bar">
        <span className="owner-label">Your route</span>
        <Link className="owner-action" href={`/?edit=${owned.saved_id}`} prefetch={false}>Edit</Link>
        <button ref={renameButton} type="button" className="owner-action" onClick={() => setRenaming(true)}>Rename</button>
        <button type="button" className="owner-action danger" onClick={remove} disabled={deleting}>Delete</button>
      </section>
      {renaming && (
        <RenameDialog name={owned.name} onSave={rename} onClose={() => {
          setRenaming(false);
          setTimeout(() => renameButton.current?.focus());
        }} />
      )}
    </>
  );
}
