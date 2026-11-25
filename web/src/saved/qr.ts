/**
 * A QR code as one SVG path (Step 9). Imported with import() by the "Use on another device" dialog only, so the
 * encoder (uqr, MIT, no dependencies) is never in a page's first load (blueprint Step 9 amendment 9).
 */
import { encode } from "uqr";

export type QrPath = { size: number; d: string };

/**
 * The dark modules of `text`'s QR code, with a 4-module quiet zone, as a path in a `size` × `size` box (one unit a
 * module). Error correction M: a link of about 80 characters stays a small, easily scanned code.
 */
export function qrPath(text: string): QrPath {
  const { data, size } = encode(text, { ecc: "M", border: 4 });
  const runs: string[] = [];
  data.forEach((row, y) => {
    let x = 0;
    while (x < size) {
      if (!row[x]) {
        x++;
        continue;
      }
      const start = x;
      while (x < size && row[x]) x++;
      runs.push(`M${start} ${y}h${x - start}v1h${start - x}z`);
    }
  });
  return { size, d: runs.join("") };
}
