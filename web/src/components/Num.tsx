/**
 * A number from the API, formatted for people. data-value carries the API's raw value (and data-field what it
 * is), so the end-to-end test can check every number on screen against the response (Phase 5 acceptance).
 */
export function Num({ value, format, field, className }: {
  value: number; format: (v: number) => string; field: string; className?: string;
}) {
  return <span className={className} data-value={value} data-field={field}>{format(value)}</span>;
}
