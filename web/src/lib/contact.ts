/**
 * The contact address on the About page: NEXT_PUBLIC_CONTACT_EMAIL, read at build time (set it in Vercel and
 * redeploy). Never hard-coded. A plain address only: anything else is left out rather than shown as a broken link.
 */
export function contactEmail(value = process.env.NEXT_PUBLIC_CONTACT_EMAIL): string | null {
  const v = value?.trim();
  return v && /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/.test(v) ? v : null;
}
