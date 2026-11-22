"use client";
/**
 * A card's "..." menu (blueprint Phase 5c amendment 11): the WAI-ARIA menu button. The arrows, Home and End move,
 * Esc closes and gives the focus back, Tab or a press outside closes. A dangerous item is last, after a divider.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent, type Ref } from "react";
import type { IconName } from "@/brand/icons";
import { Icon } from "./ui";

export type MenuItem = { label: string; icon: IconName; onSelect: () => void; danger?: boolean };

type Props = { label: string; items: MenuItem[]; buttonRef?: Ref<HTMLButtonElement> };

export function CardMenu({ label, items, buttonRef }: Props) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const id = useId();

  useEffect(() => {
    if (!open) return;
    const list = menu.current!;
    list.querySelector("button")?.focus({ preventScroll: true });
    list.scrollIntoView?.({ block: "nearest" });        // the last card's menu opens below the screen
    const outside = (e: PointerEvent) => {
      if (!root.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, [open]);

  const focusToggle = () => root.current?.querySelector<HTMLButtonElement>(".card-menu-toggle")?.focus();

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const entries = [...menu.current!.querySelectorAll("button")];
    const at = entries.indexOf(document.activeElement as HTMLButtonElement);
    const to = { ArrowDown: (at + 1) % entries.length, ArrowUp: (at - 1 + entries.length) % entries.length, Home: 0,
      End: entries.length - 1 }[e.key];
    if (to !== undefined) {
      e.preventDefault();
      entries[to]!.focus();
    } else if (e.key === "Escape") {
      e.preventDefault();
      setOpen(false);
      focusToggle();
    } else if (e.key === "Tab") {
      focusToggle();                       // Tab then moves on from the button, not from a menu that is gone
      setOpen(false);
    }
  };

  return (
    <div className="card-menu" ref={root}>
      <button ref={buttonRef} type="button" className="icon-btn card-menu-toggle" aria-label={label} title={label} aria-haspopup="menu"
        aria-expanded={open} aria-controls={open ? id : undefined} onClick={() => setOpen(!open)}>
        <Icon name="more" />
      </button>
      {open && (
        <div ref={menu} id={id} className="card-menu-list" role="menu" aria-label={label} onKeyDown={onKeyDown}>
          {items.map((item) => (
            <div key={item.label} role="none">
              {item.danger && <div className="card-menu-divider" role="separator" />}
              <button type="button" role="menuitem" tabIndex={-1} className={`card-menu-item${item.danger ? " danger" : ""}`}
                onClick={() => { setOpen(false); focusToggle(); item.onSelect(); }}>
                <Icon name={item.icon} />{item.label}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
