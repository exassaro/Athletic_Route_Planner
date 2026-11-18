/**
 * GATHO base components (blueprint Phase 5b amendments 2 and 10). Quiet by default; the retro touches are the
 * pixel icons and, on the primary button only, the 2 px hard shadow it drops into when pressed. Every control is at
 * least 44 px tall; meaning is never colour alone (badges carry an icon and words).
 */
import type { ButtonHTMLAttributes, ReactNode } from "react";
import { ICON_PATHS, type IconName } from "@/brand/icons";

function cx(...parts: (string | false | null | undefined)[]) {
  return parts.filter(Boolean).join(" ");
}

/** A pixel icon at 24 px, on its grid. Decorative: the control around it carries the words. */
export function Icon({ name, className }: { name: IconName; className?: string }) {
  return (
    <svg className={cx("icon", className)} width={24} height={24} viewBox="0 0 24 24" aria-hidden="true" focusable="false"
      fill="currentColor" shapeRendering="crispEdges">
      <path d={ICON_PATHS[name]} />
    </svg>
  );
}

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "quiet";
  size?: "md" | "lg";
  icon?: IconName;
  block?: boolean;
};

/** Primary (accent, hard shadow), secondary (ink outline) or quiet (text only). 48 px; 52 px with size="lg". */
export function Button({ variant = "secondary", size = "md", icon, block, className, children, type = "button", ...rest }: ButtonProps) {
  return (
    <button type={type} className={cx("btn", `btn-${variant}`, size === "lg" && "btn-lg", block && "btn-block", className)} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

type IconButtonProps = Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children" | "aria-label"> & { icon: IconName; label: string };

/** An icon-only button, 48 × 48. The label is required: it is the button's accessible name. */
export function IconButton({ icon, label, className, type = "button", ...rest }: IconButtonProps) {
  return (
    <button type={type} className={cx("icon-btn", className)} aria-label={label} title={label} {...rest}>
      <Icon name={icon} />
    </button>
  );
}

type ChipProps = ButtonHTMLAttributes<HTMLButtonElement> & { icon?: IconName; attention?: boolean };

/** A chip: one constraint of the plan; tapping it opens its editor. "attention" marks the one that needs changing. */
export function Chip({ icon, attention, className, children, type = "button", ...rest }: ChipProps) {
  return (
    <button type={type} className={cx("chip", attention && "chip-attention", className)} {...rest}>
      {icon && <Icon name={icon} />}
      {children}
    </button>
  );
}

type BadgeProps = {
  tone?: "info" | "warn";
  children: ReactNode;
  onClick?: () => void;
  expanded?: boolean;
  testId?: string;
};

/**
 * A short flag on a route card: an icon and words, info (neutral) or warn (amber). With onClick it is a button whose
 * tap area is 44 px tall around the 32 px badge, and it opens the detail.
 */
export function Badge({ tone = "info", children, onClick, expanded, testId }: BadgeProps) {
  const badge = (
    <span className={cx("badge", `badge-${tone}`)}>
      <Icon name={tone === "warn" ? "warning" : "info"} />
      {children}
    </span>
  );
  if (!onClick) return <span className="badge-wrap" data-testid={testId}>{badge}</span>;
  return (
    <button type="button" className="badge-hit" onClick={onClick} aria-expanded={expanded} data-testid={testId}>
      {badge}
    </button>
  );
}

type SnackbarProps = {
  children: ReactNode;
  actionLabel?: string;
  actionIcon?: IconName;
  onAction?: () => void;
  onDismiss?: () => void;
  floating?: boolean;
  testId?: string;
};

/**
 * The message at the bottom of the screen after an edit, with its action (Undo). It stays until the next edit or
 * until dismissed: no timeout, so it can always be read and reached (WCAG 2.2.1).
 */
export function Snackbar({ children, actionLabel, actionIcon, onAction, onDismiss, floating, testId }: SnackbarProps) {
  return (
    <div role="status" className={cx("snackbar", floating && "snackbar-floating")} data-testid={testId}>
      <span className="snackbar-text">{children}</span>
      {actionLabel && onAction && (
        <button type="button" className="snackbar-action" onClick={onAction}>
          {actionIcon && <Icon name={actionIcon} />}
          {actionLabel}
        </button>
      )}
      {onDismiss && (
        <button type="button" className="snackbar-dismiss" onClick={onDismiss} aria-label="Dismiss" title="Dismiss">
          <Icon name="close" />
        </button>
      )}
    </div>
  );
}
