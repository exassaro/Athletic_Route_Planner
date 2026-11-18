/**
 * About GATHO (blueprint Phase 5b amendment 1): the name and its meaning, what the app does, and the credits and
 * licences, OpenStreetMap first. Reached from the menu (step 8); until then from the planner.
 */
import type { Metadata } from "next";
import Link from "next/link";
import { Wordmark } from "@/components/Wordmark";
import { ThemeToggle } from "@/theme/ThemeToggle";

export const metadata: Metadata = { title: "About" };

export default function AboutPage() {
  return (
    <main className="about-page">
      <h1 className="about-mark"><Wordmark size={40} /></h1>
      <p className="t-body">
        From Malayalam <span lang="ml">ഗതി</span> (gathi): movement and direction.
      </p>
      <p className="t-body">
        Running routes that are the distance you asked for, heading the way you want, through the places you choose.
        Every distance comes from the routing engines; the time is that distance at your own pace.
      </p>
      <ThemeToggle />
      <h2 className="t-heading">Credits</h2>
      <ul className="t-body-s about-credits">
        <li>Map data © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, under the ODbL.</li>
        <li>Basemap built with <a href="https://protomaps.com">Protomaps</a> from OpenStreetMap data.</li>
        <li>Routing by <a href="https://valhalla.github.io/valhalla/">Valhalla</a> and <a href="https://www.graphhopper.com">GraphHopper</a>; place search by <a href="https://photon.komoot.io">Photon</a>.</li>
        <li>Numbers and the wordmark in Pixelify Sans, under the SIL Open Font License 1.1.</li>
      </ul>
      <p><Link href="/">Plan a run</Link></p>
    </main>
  );
}
