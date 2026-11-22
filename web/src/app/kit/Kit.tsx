"use client";
import { useState } from "react";
import { ICON_PATHS, type IconName } from "@/brand/icons";
import { Badge, Button, Chip, Icon, IconButton, Snackbar } from "@/components/ui";
import { Wordmark } from "@/components/Wordmark";
import { ThemeToggle } from "@/theme/ThemeToggle";

export function Kit() {
  const [undone, setUndone] = useState(0);
  const [open, setOpen] = useState(false);
  const [shape, setShape] = useState("point_to_point");
  return (
    <main className="kit-page">
      <h1 className="kit-title"><Wordmark height={28} /> <span className="t-heading">components</span></h1>
      <ThemeToggle />

      <section aria-labelledby="k-buttons">
        <h2 id="k-buttons" className="t-heading">Buttons</h2>
        <div className="kit-row">
          <Button variant="primary">Plan my run</Button>
          <Button variant="primary" icon="bookmark">Save</Button>
          <Button variant="primary" disabled>Planning…</Button>
        </div>
        <div className="kit-row">
          <Button icon="share">Share</Button>
          <Button icon="download">GPX</Button>
          <Button>Skip</Button>
          <Button variant="quiet" icon="chevronRight">Why this route?</Button>
        </div>
        <Button variant="primary" size="lg" block>Next</Button>
      </section>

      <section aria-labelledby="k-iconbuttons">
        <h2 id="k-iconbuttons" className="t-heading">Icon buttons</h2>
        <div className="kit-row">
          <IconButton icon="menu" label="Menu" />
          <IconButton icon="fit" label="Fit the route" />
          <IconButton icon="gps" label="Use my location" />
          <IconButton icon="more" label="Options for Kallai" />
          <IconButton icon="chevronLeft" label="Back" />
        </div>
      </section>

      <section aria-labelledby="k-chips">
        <h2 id="k-chips" className="t-heading">Chips</h2>
        <div className="kit-row">
          <Chip>25.0 km</Chip>
          <Chip>Heading north-west, towards Kozhikode</Chip>
          <Chip attention>20.0 km</Chip>
          <Chip icon="plus">Add stop</Chip>
        </div>
        <div className="kit-row" role="group" aria-label="Route shape">
          {([["point_to_point", "Point to point", "pointToPoint"], ["out_and_back", "Out and back", "outAndBack"], ["loop", "Loop", "loop"]] as const)
            .map(([v, label, icon]) => (
              <Chip key={v} icon={icon} aria-pressed={shape === v} onClick={() => setShape(v)}>{label}</Chip>
            ))}
        </div>
      </section>

      <section aria-labelledby="k-badges">
        <h2 id="k-badges" className="t-heading">Badges</h2>
        <div className="kit-row">
          <Badge>Ends mid-road</Badge>
          <Badge tone="warn" onClick={() => setOpen(!open)} expanded={open}>Uses a national highway</Badge>
        </div>
        {open && <p className="t-body-s muted">The detail of a flag opens here, in the API&apos;s own words.</p>}
      </section>

      <section aria-labelledby="k-snack">
        <h2 id="k-snack" className="t-heading">Undo message</h2>
        <Snackbar actionLabel="Undo" actionIcon="undo" onAction={() => setUndone(undone + 1)} onDismiss={() => setUndone(0)}>
          −2.7 km, new end, over budget{undone > 0 && ` (undo tapped ${undone}×)`}
        </Snackbar>
      </section>

      <section aria-labelledby="k-icons">
        <h2 id="k-icons" className="t-heading">Icons (pixelarticons, MIT)</h2>
        <ul className="kit-icons">
          {(Object.keys(ICON_PATHS) as IconName[]).map((n) => (
            <li key={n}><Icon name={n} /><span className="t-meta muted">{n}</span></li>
          ))}
        </ul>
      </section>
    </main>
  );
}
