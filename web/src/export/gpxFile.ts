/**
 * The GPX as a file: downloaded, or shared where the browser allows it (blueprint Phase 5b amendment 20).
 *
 * Chromium, on desktop and Android, refuses `.gpx` in navigator.share even when canShare says yes (its list of
 * permitted extensions has no gpx), so a refusal is expected and ends in a download that says so.
 */

export const GPX_MIME = "application/gpx+xml";

export function fileName(response: Pick<Response, "headers">): string {
  return /filename="([^"]+)"/.exec(response.headers.get("Content-Disposition") ?? "")?.[1] ?? "route.gpx";
}

export function saveFile(file: File) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  // inside an open modal dialog the rest of the page is inert, and a click there would do nothing
  (document.querySelector("dialog[open]") ?? document.body).appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export type Shared = "shared" | "cancelled" | "unsupported" | "refused";

type Sharer = { share?: (data: ShareData) => Promise<void>; canShare?: (data: ShareData) => boolean };

/** Must be called straight from the tap, with the file already fetched: share needs the tap's activation. */
export async function shareOrSave(file: File, browser: Sharer = navigator, save: (f: File) => void = saveFile): Promise<Shared> {
  const data = { files: [file] };
  if (!browser.share || !browser.canShare?.(data)) {
    save(file);
    return "unsupported";
  }
  try {
    await browser.share(data);
    return "shared";
  } catch (e) {
    if ((e as { name?: string } | null)?.name === "AbortError") return "cancelled";
    save(file);
    return "refused";
  }
}

export const SHARE_MESSAGE: Record<Shared, string | null> = {
  shared: null,
  cancelled: null,
  unsupported: "This browser can't share files, so the GPX was downloaded instead.",
  refused: "This browser doesn't allow sharing GPX files, so it was downloaded instead. Open it from your downloads.",
};
