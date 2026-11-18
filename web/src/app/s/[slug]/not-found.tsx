import Link from "next/link";

export default function NotFound() {
  return (
    <main style={{ padding: 16 }}>
      <h1>Route not found</h1>
      <p>This share link does not exist, or the route was removed.</p>
      <p><Link href="/">Plan a run</Link></p>
    </main>
  );
}
