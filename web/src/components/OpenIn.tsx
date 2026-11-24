"use client";
/**
 * "Open in..." (blueprint Phase 5d amendment 3): the button and the sheet. What the sheet holds (OpenInOptions) is
 * loaded when it opens, so it is not in any page's first load (amendment 15). A failed load says so in the sheet
 * instead of taking the page down.
 */
import { useEffect, useState, type ComponentType } from "react";
import type { Overview, RoutePoints } from "@/export/googleMaps";
import { EditorDialog } from "./EditorDialog";
import { Button } from "./ui";

export type OpenInProps = {
  /** The API's foot length, shown as "Our route". */
  footM: number;
  loadPoints: () => Promise<RoutePoints>;
  loadOverview: (max: number) => Promise<Overview>;
  loadGpx: (ele: boolean) => Promise<File>;
};

export function OpenIn(props: OpenInProps) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button icon="externalLink" onClick={() => setOpen(true)} aria-haspopup="dialog" data-testid="open-in">Open in…</Button>
      <OpenInDialog open={open} onClose={() => setOpen(false)} {...props} />
    </>
  );
}

/** The sheet alone, for where something else opens it (a menu). Its primary button is the GPX, so Done is not. */
export function OpenInDialog({ open, onClose, ...props }: OpenInProps & { open: boolean; onClose: () => void }) {
  return (
    <EditorDialog open={open} title="Open in…" onClose={onClose} testId="open-in-sheet" doneVariant="secondary">
      <Contents {...props} />
    </EditorDialog>
  );
}

function Contents(props: OpenInProps) {
  const [Options, setOptions] = useState<ComponentType<OpenInProps> | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    import("./OpenInOptions").then(
      (m) => { if (live) setOptions(() => m.default); },
      () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);
  if (Options) return <Options {...props} />;
  return failed
    ? <p role="alert" className="error-text">This didn&apos;t load. Check your connection, then reload the page.</p>
    : <p className="t-body-s muted open-in-loading">Loading…</p>;
}
