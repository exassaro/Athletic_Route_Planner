"use client";
/**
 * A chip's small editor (blueprint Phase 5b amendment 8): a native modal <dialog>, so focus stays inside, Escape
 * closes it and focus goes back to the chip. Anchored to the bottom on a phone, centred on a desktop. Every control
 * inside sends its own patch, so "Done" only closes. It is the primary button unless the content has its own.
 */
import { useEffect, useId, useRef, type ReactNode } from "react";
import { Button, IconButton } from "./ui";

type Props = { open: boolean; title: string; onClose: () => void; children: ReactNode; testId?: string;
  doneVariant?: "primary" | "secondary" };

export function EditorDialog({ open, title, onClose, children, testId, doneVariant = "primary" }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const id = useId();
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) {
      if (typeof d.showModal === "function") d.showModal();
      else d.setAttribute("open", "");          // environments without showModal (tests)
    } else if (!open && d.open) {
      if (typeof d.close === "function") d.close();
      else d.removeAttribute("open");
    }
  }, [open]);
  return (
    <dialog ref={ref} className="editor" aria-labelledby={id} data-testid={testId}
      onClose={onClose}
      onCancel={(e) => { e.preventDefault(); onClose(); }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>   {/* a tap on the backdrop */}
      {open && (
        <div className="editor-inner">
          <header className="editor-head">
            <h2 id={id} className="t-heading">{title}</h2>
            <IconButton icon="close" label="Close" onClick={onClose} />
          </header>
          <div className="editor-body">{children}</div>
          <Button variant={doneVariant} block onClick={onClose}>Done</Button>
        </div>
      )}
    </dialog>
  );
}
