/** The GATHO wordmark (blueprint Phase 5b amendments 1 and 3): the pixel font, the last O in the accent colour. */
export function Wordmark({ size = 26 }: { size?: number }) {
  return (
    <span className="t-wordmark wordmark" style={{ fontSize: size }}>
      GATH<span className="wordmark-o">O</span>
    </span>
  );
}
