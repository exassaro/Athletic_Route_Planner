"use client";
/**
 * Rename a saved route (blueprint Phase 5c amendment 3): a modal dialog, mounted only while it is open. Enter
 * saves, Esc cancels, the focus stays inside; whoever opened it takes the focus back in onClose.
 */
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { NAME_MAX, nameLength } from "@/saved/name";
import { Button } from "./ui";

type Props = {
  name: string | null;
  /** Saves the trimmed name (null: no name); throws when it could not. */
  onSave: (name: string | null) => Promise<void>;
  onClose: () => void;
};

export function RenameDialog({ name, onSave, onClose }: Props) {
  const dialog = useRef<HTMLDialogElement>(null);
  const field = useRef<HTMLInputElement>(null);
  const ids = useId();
  const [value, setValue] = useState(name ?? "");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(false);
  const length = nameLength(value);
  const tooLong = length > NAME_MAX;

  useEffect(() => {
    const d = dialog.current!;
    if (!d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");       // environments without showModal (tests)
    }
    field.current?.focus();
    field.current?.select();
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (tooLong || sending) return;
    setSending(true);
    setError(false);
    try {
      await onSave(value.trim() || null);
      onClose();
    } catch {
      setError(true);
      setSending(false);
    }
  };

  const onKeyDown = (e: KeyboardEvent<HTMLDialogElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Tab") {
      // showModal makes the page inert, but Tab could still leave for the browser's own bars
      const inside = [...dialog.current!.querySelectorAll<HTMLElement>("input, button:not(:disabled)")];
      const first = inside[0]!;
      const last = inside[inside.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }
  };

  return (
    <dialog ref={dialog} className="editor rename-dialog" aria-labelledby={`${ids}-title`} data-testid="rename-dialog"
      onKeyDown={onKeyDown} onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <form className="editor-inner" onSubmit={submit}>
        <h2 id={`${ids}-title`} className="t-heading">Rename route</h2>
        <div className="rename-field">
          <label htmlFor={`${ids}-name`} className="field-label">Route name</label>
          <input ref={field} id={`${ids}-name`} value={value} onChange={(e) => setValue(e.target.value)} autoComplete="off"
            enterKeyHint="done" aria-invalid={tooLong} aria-describedby={`${ids}-count`} data-testid="rename-input" />
          <span id={`${ids}-count`} className={`t-meta rename-count${tooLong ? " over" : " muted"}`} data-testid="rename-count">
            {length}/{NAME_MAX}
          </span>
        </div>
        {error && <p role="alert" className="error-text">Could not rename. Try again.</p>}
        <div className="rename-actions">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" type="submit" disabled={tooLong || sending} data-testid="rename-save">Save</Button>
        </div>
      </form>
    </dialog>
  );
}
