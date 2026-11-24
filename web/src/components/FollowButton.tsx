/**
 * The way into Follow mode (blueprint Phase 5d amendment 4): a link, so none of Follow's code is in the page that
 * shows it (amendment 15). It never prefetches: that would fetch the code for everyone who sees the button.
 */
import { Icon } from "./ui";

type Query = { saved: string } | { route: string } | { share: string };

export function FollowButton({ query, icon = true }: { query: Query; icon?: boolean }) {
  return (
    <a className="btn btn-secondary follow-link" href={`/follow?${new URLSearchParams(query).toString()}`} data-testid="follow">
      {icon && <Icon name="play" />}Follow
    </a>
  );
}
