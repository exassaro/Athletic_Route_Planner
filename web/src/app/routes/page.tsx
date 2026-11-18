import type { Metadata } from "next";
import { SavedRoutes } from "./SavedRoutes";

export const metadata: Metadata = { title: "Saved routes" };

export default function Page() {
  return <SavedRoutes />;
}
