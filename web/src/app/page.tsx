import { MapView } from "@/map/MapView";

export default function Home() {
  return (
    <main style={{ position: "fixed", inset: 0 }}>
      <MapView />
    </main>
  );
}
