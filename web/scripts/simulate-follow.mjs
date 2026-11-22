// Phase 5d step 5: the Follow rules under simulated GPS, on the modules that ship (src/follow, run by Node's
// type stripping). Nothing is measured on a real device.
//
//   npm run sim:follow [-- routes.json]      A01, S02 and the out-and-back -> docs/reports/phase5d/follow_sim_data.json
//
// With a file of other follow responses ({routes: {name: {points, along_m}}}) it prints and writes nothing.
//
// GPS models: "clean" is independent noise, 5 m sigma; "drift" is correlated noise (5 m sigma, 20 s), which is
// closer to a phone; "poor" is correlated, 10 m sigma. Accuracy is reported as 1.5 sigma (the 68 % radius).
import { readFileSync, writeFileSync } from "node:fs";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

registerHooks({
  resolve(specifier, context, next) {
    if (/^\.\/\w+$/.test(specifier) && context.parentURL?.endsWith(".ts")) return next(`${specifier}.ts`, context);
    return next(specifier, context);
  },
});
const { createLine, pointAt, nearestOnRoute, segmentAt } = await import("../src/follow/line.ts");
const { reduceRun, startRun } = await import("../src/follow/run.ts");

const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const extra = process.argv[2];
const source = extra ?? join(root, "tests", "fixtures", "follow", "routes.json");
const routes = Object.fromEntries(Object.entries(JSON.parse(readFileSync(source, "utf8")).routes)
  .map(([name, r]) => [name, createLine(r.points, r.along_m)]));
const RUNS = extra ? 2 : 20;
const TRIALS = extra ? 20 : 500;

const GPS = { clean: { sigma: 5, tau: 0 }, drift: { sigma: 5, tau: 20 }, poor: { sigma: 10, tau: 20 } };
const PACE = 2.8;

function random(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  next.gauss = () => Math.sqrt(-2 * Math.log(1 - next())) * Math.cos(2 * Math.PI * next());
  next.between = (lo, hi) => lo + next() * (hi - lo);
  return next;
}

/** A phone: feeds the run noisy fixes of wherever the runner truly is (metres on the plane). */
function phone(line, r, model, doneM = 0) {
  const { sigma, tau } = GPS[model];
  const metre = [line.toXY([line.points[0][0] + 1, line.points[0][1]])[0], line.toXY([line.points[0][0], line.points[0][1] + 1])[1]];
  let run = startRun(0);
  run = { ...run, track: { ...run.track, doneM } };
  let noise = [r.gauss() * sigma, r.gauss() * sigma];
  let last = 0;
  return {
    get run() { return run; },
    send(event) { run = reduceRun(line, run, event); },
    fix(seconds, xy) {
      const keep = tau ? Math.exp(-(seconds - last) / tau) : 0;
      noise = noise.map((n) => n * keep + r.gauss() * sigma * Math.sqrt(1 - keep * keep));
      last = seconds;
      const point = [line.points[0][0] + (xy[0] + noise[0]) / metre[0], line.points[0][1] + (xy[1] + noise[1]) / metre[1]];
      const at = seconds * 1000 + 1;
      run = reduceRun(line, run, { type: "fix", point, accuracy: 1.5 * sigma, at, now: at });
      return run;
    },
  };
}

const onRoute = (line, m) => line.toXY(pointAt(line, m));
const round = (x, d = 0) => Number(x.toFixed(d));
const pct = (n, of) => (of ? round((100 * n) / of, 2) : 0);
const quantile = (xs, q) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.min(xs.length - 1, Math.floor(q * xs.length))] : null);

/** 1. A whole run from start to end. */
function wholeRuns(line, model, every) {
  const worst = [];
  let over100 = 0; let reached = 0; let banners = 0;
  for (let seed = 0; seed < RUNS; seed++) {
    const r = random(seed + 1);
    const gps = phone(line, r, model);
    const speed = r.between(1.8, 4.2);
    let error = 0; let banner = false;
    for (let t = 1; t * speed < line.totalM + 60; t += every) {
      const truth = Math.min(line.totalM, t * speed);
      const run = gps.fix(t, onRoute(line, truth));
      error = Math.max(error, Math.abs(run.track.doneM - truth));
      banner ||= run.off.shown;
    }
    worst.push(error);
    over100 += error > 100;
    reached += gps.run.track.doneM === line.totalM;
    banners += banner;
  }
  return { runs: RUNS, every_s: every, median_worst_m: round(quantile(worst, 0.5)), worst_m: round(Math.max(...worst)),
    runs_over_100_m: over100, reached_end: reached, runs_with_false_banner: banners };
}

/** 2. Standing still for five minutes. */
function standing(line, model) {
  const crept = []; let banners = 0;
  for (let i = 0; i < TRIALS / 5; i++) {
    const r = random(i + 100);
    const at = r.between(0, Math.max(1, line.totalM - 300));
    const gps = phone(line, r, model, at);
    const xy = onRoute(line, at);
    let banner = false;
    for (let t = 1; t <= 300; t++) banner ||= gps.fix(t, xy).off.shown;
    crept.push(gps.run.track.doneM - at);
    banners += banner;
  }
  return { trials: crept.length, median_creep_m: round(quantile(crept, 0.5)), worst_creep_m: round(Math.max(...crept)), false_banners: banners };
}

/** 3. Locked for T seconds, then awake. The runner covered 0 to 4 m/s, and moves on (or stands) after waking. */
function afterLock(line, model, seconds, movesOn) {
  let n = 0; let wrong = 0; let wrongAt = []; let undecided = 0; let banners = 0; let atOnce = 0;
  const wait = [];
  for (let i = 0; i < TRIALS; i++) {
    const r = random(i + 1000);
    const covered = r.between(0, 4) * seconds;
    const speed = movesOn ? r.between(1.5, 4) : 0;
    const last = line.totalM - covered - speed * 130;
    if (last <= 20) continue;
    const start = r.between(10, last);
    const gps = phone(line, r, model, start);
    gps.send({ type: "hidden", at: 1 });
    gps.send({ type: "visible", at: seconds * 1000 });
    n++;
    let found = false; let banner = false;
    for (let t = 0; t <= 120; t++) {
      const truth = start + covered + speed * t;
      const run = gps.fix(seconds + t, onRoute(line, truth));
      banner ||= run.off.shown;
      if (found || run.track.status !== "route") continue;
      found = true;
      wait.push(t);
      atOnce += t === 0;
      if (Math.abs(run.track.doneM - truth) > 50) {
        wrong++;
        wrongAt.push(Math.round(truth));
      }
    }
    undecided += !found;
    banners += banner;
  }
  return { trials: n, wrong_pct: pct(wrong, n), at_once_pct: pct(atOnce, n), wait_p50_s: quantile(wait, 0.5),
    wait_p99_s: quantile(wait, 0.99), undecided_pct: pct(undecided, n), false_banner_pct: pct(banners, n) };
}

/** 4. A loop's start, locked for T seconds without moving: then standing, then setting off. */
function heldAtStart(line, model, seconds) {
  let jumped = 0; let found = 0; let banners = 0;
  const wait = [];
  for (let i = 0; i < TRIALS; i++) {
    const r = random(i + 5000);
    const gps = phone(line, r, model);
    gps.send({ type: "hidden", at: 1 });
    gps.send({ type: "visible", at: seconds * 1000 });
    const xy = onRoute(line, 0);
    let jump = false; let banner = false;
    for (let t = 0; t < 300; t++) {
      const run = gps.fix(seconds + t, xy);
      jump ||= run.track.doneM > 100;
      banner ||= run.off.shown;
    }
    let ok = false;
    for (let t = 1; t <= 120 && !ok; t++) {
      const truth = PACE * t;
      const run = gps.fix(seconds + 300 + t, onRoute(line, truth));
      jump ||= run.track.doneM > truth + 100;
      banner ||= run.off.shown;
      if (run.track.status === "route" && Math.abs(run.track.doneM - truth) <= 50) {
        ok = true;
        wait.push(t);
      }
    }
    jumped += jump;
    found += ok;
    banners += banner;
  }
  return { trials: TRIALS, jumped_pct: pct(jumped, TRIALS), found_after_setting_off_pct: pct(found, TRIALS),
    wait_p50_s: quantile(wait, 0.5), wait_p99_s: quantile(wait, 0.99), false_banner_pct: pct(banners, TRIALS) };
}

/** 5. A shortcut that skips `skip` metres: straight across, then along the route again. */
function rejoin(line, model, skip) {
  let n = 0; let found = 0; let wrong = 0;
  const wait = [];
  for (let i = 0; i < TRIALS * 3 && n < TRIALS / 2; i++) {
    const r = random(i + 9000);
    if (line.totalM < skip + 1600) break;
    const from = r.between(20, line.totalM - skip - 1500);
    const [a, b] = [onRoute(line, from), onRoute(line, from + skip)];
    const chord = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const half = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    if (chord < 120 || nearestOnRoute(line, half).offM < 60) continue;     // not a shortcut that leaves the route
    n++;
    const gps = phone(line, r, model, from);
    const back = chord / PACE;
    let ok = false;
    for (let t = 1; t < back; t++) gps.fix(t, [a[0] + ((b[0] - a[0]) * t) / back, a[1] + ((b[1] - a[1]) * t) / back]);
    for (let t = Math.ceil(back); ; t++) {
      const truth = from + skip + PACE * (t - back);
      if (truth > line.totalM || t - back > 1800) break;
      const run = gps.fix(t, onRoute(line, truth));
      if (run.track.status !== "route") continue;
      if (Math.abs(run.track.doneM - truth) <= 50) {
        ok = true;
        wait.push(Math.round(t - back));
        break;
      }
      if (run.track.doneM > truth + 100) {
        wrong++;
        break;
      }
    }
    found += ok;
  }
  return { trials: n, found_pct: pct(found, n), jumped_too_far_pct: pct(wrong, n), wait_p50_s: quantile(wait, 0.5),
    wait_p95_s: quantile(wait, 0.95) };
}

/** 6. Off the route, straight across a later part of it: progress must not jump there. */
function crossing(line, model) {
  let n = 0; let jumped = 0;
  for (let i = 0; i < TRIALS * 3 && n < TRIALS / 2; i++) {
    const r = random(i + 13000);
    const at = r.between(0.4, 0.95) * line.totalM;
    const k = segmentAt(line, at);
    const [p, q] = [line.flat[k], line.flat[k + 1]];
    const size = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (size < 30) continue;
    const across = [-(q[1] - p[1]) / size, (q[0] - p[0]) / size];
    const mid = [(p[0] + q[0]) / 2, (p[1] + q[1]) / 2];
    const from = [mid[0] - across[0] * 150, mid[1] - across[1] * 150];
    const to = [mid[0] + across[0] * 150, mid[1] + across[1] * 150];
    if (nearestOnRoute(line, from).offM < 100 || nearestOnRoute(line, to).offM < 100) continue;
    const doneM = line.alongM[k] * 0.5;
    const gps = phone(line, r, model, doneM);
    n++;
    // long enough off the route that the window reaches the crossing
    const since = Math.ceil((line.alongM[k + 1] - doneM) / 5) + 30;
    for (let t = since - 60; t < since; t++) gps.fix(t, from);
    for (let t = 0; t <= 300 / PACE; t++) gps.fix(since + t, [from[0] + across[0] * PACE * t, from[1] + across[1] * PACE * t]);
    jumped += gps.run.track.doneM > doneM + 100;
  }
  return { trials: n, jumped_pct: pct(jumped, n) };
}

/** 7. A detour 60 m to the side: how soon the banner shows. */
function detour(line, model) {
  let n = 0; let shown = 0;
  const wait = [];
  for (let i = 0; i < TRIALS * 3 && n < TRIALS / 2; i++) {
    const r = random(i + 17000);
    const at = r.between(0.05, 0.9) * line.totalM;
    const k = segmentAt(line, at);
    const [p, q] = [line.flat[k], line.flat[k + 1]];
    const size = Math.hypot(q[0] - p[0], q[1] - p[1]);
    if (size < 30) continue;
    const xy = [(p[0] + q[0]) / 2 - ((q[1] - p[1]) / size) * 60, (p[1] + q[1]) / 2 + ((q[0] - p[0]) / size) * 60];
    if (nearestOnRoute(line, xy).offM < 59) continue;
    const gps = phone(line, r, model, line.alongM[k]);
    n++;
    for (let t = 1; t <= 120; t++) {
      if (gps.fix(t, xy).off.shown) {
        shown++;
        wait.push(t);
        break;
      }
    }
  }
  return { trials: n, shown_pct: pct(shown, n), wait_p50_s: quantile(wait, 0.5), wait_p95_s: quantile(wait, 0.95) };
}

/** 8. Back 100 m for water, then on again. */
function backtrack(line, model) {
  let banners = 0; let lost = 0;
  const n = TRIALS / 5;
  for (let i = 0; i < n; i++) {
    const r = random(i + 21000);
    const turn = r.between(200, line.totalM - 600);
    const gps = phone(line, r, model, turn - 50);
    let truth = turn - 50; let banner = false; let t = 0;
    const walk = (to, speed) => {
      const step = to > truth ? speed : -speed;
      while (Math.abs(to - truth) > speed) {
        truth += step;
        banner ||= gps.fix(++t, onRoute(line, truth)).off.shown;
      }
    };
    walk(turn, PACE);
    walk(turn - 100, 1.5);
    for (let k = 0; k < 60; k++) banner ||= gps.fix(++t, onRoute(line, truth)).off.shown;
    walk(turn + 300, PACE);
    banners += banner;
    lost += Math.abs(gps.run.track.doneM - truth) > 50;
  }
  return { trials: n, false_banner_pct: pct(banners, n), not_back_on_pct: pct(lost, n) };
}

function measure(name, line) {
  const closed = Math.hypot(line.flat[0][0] - line.flat.at(-1)[0], line.flat[0][1] - line.flat.at(-1)[1]) < 5;
  const out = { length_m: line.totalM };
  for (const model of Object.keys(GPS)) {
    const full = Math.ceil((line.totalM - 100) / 5) + 30;        // the lock after which the window holds the whole route
    out[model] = {
      whole_run: wholeRuns(line, model, 1),
      whole_run_sparse: wholeRuns(line, model, 5),
      standing: standing(line, model),
      after_lock: Object.fromEntries([15, 60, 300, 900].map((T) => [T, afterLock(line, model, T, true)])),
      after_lock_standing: afterLock(line, model, 300, false),
      ...(closed ? { held_at_start: heldAtStart(line, model, full) } : {}),
      rejoin: Object.fromEntries([300, 1000, 2000].map((skip) => [skip, rejoin(line, model, skip)])),
      crossing: crossing(line, model),
      detour: detour(line, model),
      backtrack: backtrack(line, model),
    };
    console.log(`\n## ${name}, ${model}`);
    for (const [test, result] of Object.entries(out[model])) console.log(`${test.padEnd(20)} ${JSON.stringify(result)}`);
  }
  return out;
}

const results = {};
for (const [name, line] of Object.entries(routes)) results[name] = measure(name, line);
if (!extra) {
  const file = join(root, "docs", "reports", "phase5d", "follow_sim_data.json");
  writeFileSync(file, `${JSON.stringify({ measured_on: "simulated GPS on the development laptop; no real device",
    gps: GPS, trials: TRIALS, runs: RUNS, routes: results }, null, 1)}\n`);
  console.log("\ndocs/reports/phase5d/follow_sim_data.json");
}
