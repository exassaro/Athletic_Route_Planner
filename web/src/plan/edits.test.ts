/**
 * Each control produces the right JSON Patch (Phase 5 plan, step 8). The base request is A01 as the API returns
 * it (the OpenAPI example, real solver output), and every patch is also applied with the RFC 6902 reference
 * semantics below to check the result is what the control means.
 */
import { describe, expect, it } from "vitest";
import spec from "@/api/openapi.json";
import { blocked, patchFor, type Edit, type PatchOp, type RouteRequest } from "./edits";
import { km, pace, parsePace, runningTime, signedKm } from "./format";

type Example = { value: { request: RouteRequest; conflict: { fixes: { action: string; patch: PatchOp[] | null }[] } } };
const examples = (spec as unknown as { paths: Record<string, Record<string, { responses: Record<string, { content: Record<string, { examples: Record<string, Example> }> }> }>> }).paths;
const createExamples = examples["/v1/plans"]!.post!.responses["201"]!.content["application/json"]!.examples;
const A01: RouteRequest = createExamples["plan_A01"]!.value.request;

/** Minimal RFC 6902 apply (add/remove/replace/move/test on objects and arrays), for checking results only. */
function apply(doc: unknown, ops: PatchOp[]): unknown {
  let root = structuredClone(doc);
  const parse = (p: string) => (p === "" ? [] : p.slice(1).split("/").map((s) => s.replace(/~1/g, "/").replace(/~0/g, "~")));
  const parent = (path: string[]) => {
    let cur: any = root;
    for (const k of path.slice(0, -1)) cur = cur[k];
    return [cur, path[path.length - 1]!] as const;
  };
  const get = (p: string) => parse(p).reduce((cur: any, k) => cur[k], root);
  for (const op of ops) {
    const path = parse(op.path);
    if (op.op === "test") {
      expect(get(op.path)).toEqual(op.value);
      continue;
    }
    if (path.length === 0) {
      root = structuredClone(op.value);
      continue;
    }
    if (op.op === "move") {
      const value = get(op.from!);
      const [fp, fk] = parent(parse(op.from!));
      if (Array.isArray(fp)) fp.splice(Number(fk), 1); else delete fp[fk];
      const [tp, tk] = parent(path);
      if (Array.isArray(tp)) tp.splice(Number(tk), 0, value); else tp[tk] = value;
      continue;
    }
    const [p, k] = parent(path);
    if (op.op === "remove") {
      if (Array.isArray(p)) p.splice(Number(k), 1); else delete p[k];
    } else if (op.op === "add" && Array.isArray(p)) {
      if (k === "-") p.push(op.value); else p.splice(Number(k), 0, op.value);
    } else {
      p[k] = op.value;
    }
  }
  return root;
}

const run = (edit: Edit) => {
  const ops = patchFor(A01, edit);
  return { ops, after: apply(A01, ops) as RouteRequest };
};
const labels = (r: RouteRequest) => (r.checkpoints ?? []).map((c) => c.label);

describe("each control's patch", () => {
  it("distance stepper and free entry", () => {
    const { ops, after } = run({ kind: "distance", meters: 26000 });
    expect(ops).toEqual([{ op: "replace", path: "/target_distance_m", value: 26000 }]);
    expect(after.target_distance_m).toBe(26000);
  });

  it("route type", () => {
    expect(run({ kind: "route_type", value: "loop" }).after.route_type).toBe("loop");
  });

  it("start from search, tap or location", () => {
    const point = { lon: 75.8, lat: 11.2, label: "Tapped point", place_id: null };
    expect(run({ kind: "start", point }).ops).toEqual([{ op: "replace", path: "/start", value: point }]);
  });

  it("towards a place, a bearing, or no direction", () => {
    const place = A01.start;
    expect(run({ kind: "towards_place", place }).after.direction).toEqual({ kind: "towards_place", place });
    expect(run({ kind: "bearing", degrees: 370 }).after.direction).toEqual({ kind: "bearing", degrees: 10 });
    expect(run({ kind: "bearing", degrees: -90 }).after.direction).toEqual({ kind: "bearing", degrees: 270 });
    expect(run({ kind: "no_direction" }).after.direction).toBeNull();
  });

  it("add a checkpoint, a via, a must-use, an avoid", () => {
    const cp = { ...A01.checkpoints![0]!, label: "New stop", lon: 75.9 };
    const { ops, after } = run({ kind: "add", list: "checkpoints", item: cp });
    expect(ops).toEqual([{ op: "add", path: "/checkpoints/-", value: cp }]);
    expect(labels(after).at(-1)).toBe("New stop");
    const avoid = { kind: "place" as const, label: "Market", lon: 75.78, lat: 11.25, radius_m: 300 };
    expect(run({ kind: "add", list: "avoid", item: avoid }).after.avoid).toEqual([avoid]);
  });

  it("remove a stop, guarded by its label", () => {
    const { ops, after } = run({ kind: "remove", list: "checkpoints", index: 2, label: "Chaliyam" });
    expect(ops).toEqual([{ op: "test", path: "/checkpoints/2/label", value: "Chaliyam" },
      { op: "remove", path: "/checkpoints/2" }]);
    expect(labels(after)).not.toContain("Chaliyam");
    expect(() => apply(A01, patchFor(A01, { kind: "remove", list: "checkpoints", index: 2, label: "Beypore" }))).toThrow();
  });

  it("must-reach toggle drops the boundary; pass-near replaces the item", () => {
    const i = labels(A01).indexOf("Kadalundi");
    expect(A01.checkpoints![i]!.boundary).toBeTruthy();
    const on = run({ kind: "must_reach_on", index: i, label: "Kadalundi" }).after.checkpoints![i]!;
    expect(on.must_reach).toBe(true);
    expect(on.boundary).toBeNull();
    const back = run({ kind: "replace_checkpoint", index: i, label: "Kadalundi", item: A01.checkpoints![i]! });
    expect(back.after).toEqual(A01);
  });

  it("reordering with a handle moves the stop and fixes the order", () => {
    const { ops, after } = run({ kind: "move_checkpoint", from: 5, to: 0, label: "Kallai" });
    expect(ops).toEqual([{ op: "test", path: "/checkpoints/5/label", value: "Kallai" },
      { op: "move", from: "/checkpoints/5", path: "/checkpoints/0" },
      { op: "replace", path: "/checkpoint_order", value: "fixed" }]);
    expect(labels(after)).toEqual(["Kallai", "Kottakkadavu", "Kadalundi", "Chaliyam", "Karuvanthuruthy bridge", "Beypore"]);
    expect(after.checkpoint_order).toBe("fixed");
  });

  it("paths preference and auto order", () => {
    expect(run({ kind: "paths", value: "allow" }).after.preferences!.paths).toBe("allow");
    expect(run({ kind: "checkpoint_order", value: "auto" }).ops)
      .toEqual([{ op: "replace", path: "/checkpoint_order", value: "auto" }]);
  });

  it("undo and redo replace the whole request", () => {
    const earlier = { ...A01, target_distance_m: 20000 };
    const { ops, after } = run({ kind: "restore", request: earlier });
    expect(ops).toEqual([{ op: "replace", path: "", value: earlier }]);
    expect(after).toEqual(earlier);
  });

  it("the over_budget fix buttons send the API's own patch", () => {
    const patchExamples = examples["/v1/plans/{plan_id}"]!.patch!.responses["200"]!.content["application/json"]!.examples;
    const v2 = patchExamples["plan_A01_20km"]!.value;
    const raise = v2.conflict.fixes.find((f) => f.action === "set_distance")!;
    expect(raise.patch).not.toBeNull();
    expect((apply(v2.request, raise.patch!) as RouteRequest).target_distance_m).toBeGreaterThan(20000);
  });
});

describe("controls the solver would reject are blocked first", () => {
  it("out-and-back with stops, too many stops, a repeated label", () => {
    expect(blocked(A01, { kind: "route_type", value: "out_and_back" })).toMatch(/stops/);
    const dup = { ...A01.checkpoints![0]! };
    expect(blocked(A01, { kind: "add", list: "checkpoints", item: dup })).toMatch(/already a stop/);
    const full = { ...A01, checkpoints: Array.from({ length: 8 }, (_, k) => ({ ...dup, label: `S${k}` })) };
    expect(blocked(full, { kind: "add", list: "checkpoints", item: { ...dup, label: "Ninth" } })).toMatch(/At most 8/);
    expect(blocked(A01, { kind: "distance", meters: 120000 })).toMatch(/100 km/);
    expect(blocked(A01, { kind: "distance", meters: 25000 })).toBeNull();
  });
});

describe("formatting API numbers", () => {
  it("distance, deviation, pace and time at your pace", () => {
    expect(km(24999.99241178757)).toBe("25.0 km");
    expect(signedKm(52.69)).toBe("+0.1 km");
    expect(signedKm(-928.4)).toBe("−0.9 km");
    expect(signedKm(-0.0076)).toBe("±0.0 km");
    expect(pace(360)).toBe("6:00 /km");
    expect(parsePace("5:45")).toBe(345);
    expect(parsePace("abc")).toBeNull();
    expect(runningTime(25000, 360)).toBe("2 h 30 min");
    expect(runningTime(8000, 330)).toBe("44 min");
  });
});
