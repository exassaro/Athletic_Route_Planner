/**
 * The way into Follow mode (blueprint Phase 5d amendment 4): a link, so none of Follow's code is in the page that
 * shows it (amendment 15). It never prefetches: that would fetch the code for everyone who sees the button.
 *
 * From the planner it opens its own tab: the plan on screen is held in memory only (until Phase 5e), and following
 * it must not throw it away.
 */
import { Icon } from "./ui";

type Query = { saved: string } | { route: string } | { share: string };

export function FollowButton({ query, newTab, icon = true }: { query: Query; newTab?: boolean; icon?: boolean }) {
  return (
    <a className="btn btn-secondary follow-link" href={`/follow?${new URLSearchParams(query).toString()}`} data-testid="follow"
      target={newTab ? "_blank" : undefined} rel={newTab ? "noreferrer" : undefined}>
      {icon && <Icon name="play" />}Follow
    </a>
  );
}
