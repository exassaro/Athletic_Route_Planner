/**
 * About GATHO (blueprint Phase 5b amendment 1; Step 9 item 8): what it is, what is stored and where, linking a
 * device, share links, deleting, credits, and a contact address from NEXT_PUBLIC_CONTACT_EMAIL (left out when
 * unset; never hard-coded). Plain words, no legalese. Reached from the menu and the footer of the other pages.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { contactEmail } from "@/lib/contact";
import { ThemeToggle } from "@/theme/ThemeToggle";

export const metadata: Metadata = { title: "About and privacy" };

export default function AboutPage() {
  const contact = contactEmail();
  return (
    <main className="about-page">
      <h1 className="about-mark"><Wordmark height={42} /><span className="sr-only">About GATHO</span></h1>
      <p className="t-body">
        From Malayalam <span lang="ml">ഗതി</span> (gathi): movement and direction.
      </p>
      <p className="t-body">
        Running routes that are the distance you asked for, heading the way you want, through the places you choose.
        Every distance comes from the routing engines; the time is that distance at your own pace.
      </p>
      <ThemeToggle />

      <h2 className="t-heading" id="privacy">What GATHO keeps</h2>
      <ul className="t-body-s about-list">
        <li>
          <strong>A random token in this browser.</strong> There are no accounts. The first time you plan, GATHO gives
          this browser an anonymous token and keeps it here. It is how GATHO knows which saved routes are yours. GATHO
          stores only a scrambled form of it, so nobody can read it back from our side.
        </li>
        <li>
          <strong>What you plan with:</strong> the start, the distance, the direction and the stops you choose, and the
          routes made from them. That is what the planner needs to make and redo a route.
        </li>
        <li><strong>The routes you save</strong>, with the names you give them.</li>
        <li>
          <strong>Not your location while you run.</strong> In Follow mode your position stays on your phone and is
          never sent.
        </li>
        <li>
          <strong>Nothing sold, no ads, no third-party trackers.</strong> The map is served by GATHO itself, not by a map
          company, and the app loads nothing from anyone else.
        </li>
        <li>
          <strong>Server logs.</strong> Like any website, the servers note your IP address, the page or request and the
          time. GATHO keeps its own log for up to 30 days, to keep the service running and to stop abuse. The web pages
          are hosted by Vercel, which keeps its own request logs as a host.
        </li>
      </ul>

      <h2 className="t-heading">Your saved routes</h2>
      <ul className="t-body-s about-list">
        <li>
          Saved routes belong to this browser. On a phone or another computer you won&apos;t see them, unless you link it:
          open <Link href="/routes">Saved routes</Link> and choose <strong>Use on another device</strong>. If you clear
          this browser&apos;s data without linking another device, GATHO can&apos;t give them back, so keep the GPX of the
          ones you care about.
        </li>
        <li>
          <strong>Share links are public.</strong> Anyone who has a route&apos;s share link can see that route. Only share
          it with people you want to see it.
        </li>
        <li>
          <strong>Deleting:</strong> in <Link href="/routes">Saved routes</Link>, open a route&apos;s &quot;…&quot; menu and
          choose Delete. Its share link stops working at once (you have a few seconds to undo).
        </li>
      </ul>

      {contact && (
        <>
          <h2 className="t-heading">Contact</h2>
          <p className="t-body-s" data-testid="about-contact">
            Questions, or want something removed? Write to <a href={`mailto:${contact}`}>{contact}</a>.
          </p>
        </>
      )}

      <h2 className="t-heading">Credits</h2>
      <ul className="t-body-s about-credits">
        <li>Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, under the ODbL.</li>
        <li>Basemap built with <a href="https://protomaps.com">Protomaps</a> from OpenStreetMap data.</li>
        <li>Routing by <a href="https://valhalla.github.io/valhalla/">Valhalla</a> and <a href="https://www.graphhopper.com">GraphHopper</a>; place search by <a href="https://photon.komoot.io">Photon</a>.</li>
        <li>Numbers in Silkscreen, under the SIL Open Font License 1.1.</li>
      </ul>
      <p><Link href="/">Plan a run</Link></p>
    </main>
  );
}
