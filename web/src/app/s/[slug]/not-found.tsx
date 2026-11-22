import Link from "next/link";
import { Mascot } from "@/components/Mascot";
import { Wordmark } from "@/components/Wordmark";

/** A share link that is not live: deleted or never issued, the same page for both (Phase 5c amendment 1). */
export default function NotFound() {
  return (
    <main className="dead-link" data-testid="dead-link">
      <p className="brand-row"><Link href="/" aria-label="GATHO: plan a run"><Wordmark height={28} /></Link></p>
      <Mascot />
      <h1 className="t-title">This link doesn&apos;t work any more</h1>
      <Link className="btn btn-primary" href="/" data-testid="dead-link-plan">Plan a run</Link>
    </main>
  );
}
