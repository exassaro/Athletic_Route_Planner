import type { Metadata } from "next";
import { SavedRoutes } from "./SavedRoutes";

export const metadata: Metadata = { title: "Saved routes · Athlete Router" };

export default function Page() {
  return <SavedRoutes />;
}
