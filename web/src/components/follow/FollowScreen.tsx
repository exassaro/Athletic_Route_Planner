"use client";
/**
 * Follow's screens (blueprint Phase 5d amendments 11 and 12): start, running or paused, the questions at Stop, and
 * the summary. Foreground only, and nothing about a run is saved.
 *
 * The retro budget (Phase 5b amendment 2): before a run the wordmark, the markers and the primary button's shadow;
 * during and after one the numerals, the markers and at most that shadow, so there is no wordmark then.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { Num } from "@/components/Num";
import { Button, IconButton } from "@/components/ui";
import { Wordmark } from "@/components/Wordmark";
import { gapText } from "@/follow/clock";
import { turnsOf } from "@/follow/cues";
import { createLine } from "@/follow/line";
import { mayHaveFinished } from "@/follow/run";
import { km } from "@/plan/format";
import { useTheme } from "@/theme/useTheme";
import { FollowMap } from "./FollowMap";
import { AwayLine, CueLine, OffRouteBanner, Stats } from "./Hud";
import type { Followed } from "./load";
import { useBackGuard } from "./useBackGuard";
import { useFollowRun, type Access } from "./useFollowRun";
import { useWakeLock, WAKE_NOTICE } from "./useWakeLock";

type Props = { followed: Followed; onLeave: () => void };
type Question = "stop" | "finished" | null;

function NoAccess({ access }: { access: Access }) {
  if (access === "denied") {
    return (
      <>
        <h1 className="t-title">Location is off for GATHO</h1>
        <p className="t-body-s">
          That&apos;s fine. To follow the route here, allow location for this site in your browser&apos;s settings,
          then try again. The GPX works without it, in Organic Maps or on a watch.
        </p>
      </>
    );
  }
  if (access === "insecure") {
    return (
      <>
        <h1 className="t-title">Follow needs a secure page</h1>
        <p className="t-body-s">Browsers give a location only over https. Open https://{window.location.hostname} and tap Follow there.</p>
      </>
    );
  }
  return (
    <>
      <h1 className="t-title">This browser has no location</h1>
      <p className="t-body-s">The GPX works without it, in Organic Maps or on a watch.</p>
    </>
  );
}

export function FollowScreen({ followed: { route, name }, onLeave }: Props) {
  const line = useMemo(() => createLine(route.points, route.along_m), [route]);
  const turns = useMemo(() => turnsOf(route.cues), [route]);
  const { run, access, noPosition, now, start, cancel, pause, resume, stop, dismissGap } = useFollowRun(line);
  const [question, setQuestion] = useState<Question>(null);
  const [saver, setSaver] = useState(false);
  const [theme] = useTheme();
  const root = useRef<HTMLElement>(null);
  const sheet = useRef<HTMLElement>(null);

  const stopped = run?.phase === "stopped";
  const live = !!run && !stopped;
  const blocked = access === "denied" || access === "insecure" || access === "unsupported";
  const screenLock = useWakeLock(live || access === "asking");
  const askStop = () => setQuestion(run && mayHaveFinished(line, run, Date.now()) ? "finished" : "stop");
  const guard = useBackGuard(() => {
    if (live) askStop();
    else if (access === "asking") cancel();
  });
  const view = stopped ? "finished" : live ? (question ? "question" : run.phase)
    : blocked ? access : access === "idle" ? "start" : "asking";

  // the OSM credit and the map's notices sit above the sheet, whatever it holds
  useEffect(() => {
    if (!sheet.current || typeof ResizeObserver === "undefined") return;
    const watch = new ResizeObserver(() => root.current?.style.setProperty("--snap-h", `${sheet.current?.offsetHeight ?? 0}px`));
    watch.observe(sheet.current);
    return () => watch.disconnect();
  }, []);

  // the controls that had the focus are gone with each screen
  const shown = useRef(view);
  useEffect(() => {
    if (shown.current === view) return;
    shown.current = view;
    const target = sheet.current?.querySelector<HTMLElement>("h1") ?? sheet.current?.querySelector<HTMLElement>("button");
    if (!target) return;
    if (target.tagName === "H1") target.tabIndex = -1;
    target.focus({ preventScroll: true });
  }, [view]);

  const answer = (finished: boolean) => {
    setQuestion(null);
    stop(finished);
    guard.disarm();
  };
  const follow = () => {
    start();
    if (window.isSecureContext && navigator.geolocation) guard.arm();
  };
  const keepGoing = () => {
    setQuestion(null);
    guard.arm();
  };
  const giveUp = () => {
    cancel();
    guard.disarm();
  };

  const away = stopped ? run.gaps.reduce((sum, gap) => sum + gap.ms, 0) : 0;

  return (
    <main ref={root} className={`planner follow${saver ? " saver" : ""}`} data-testid="follow-screen" data-view={view}
      data-screen-lock={screenLock} data-theme={saver ? "dark" : undefined}>
      <FollowMap line={line} doneM={run?.track.doneM ?? 0} here={run?.here ?? null} following={live} theme={theme} saver={saver} />
      {live && (
        <IconButton icon="battery" label="Battery saver" aria-pressed={saver} className="icon-btn follow-saver"
          onClick={() => setSaver(!saver)} data-testid="follow-saver" />
      )}
      {!run && (
        <header className="topbar">
          <span className="topbar-brand"><Wordmark height={21} /></span>
          <Button icon="chevronLeft" className="follow-back" style={{ marginLeft: "auto" }} onClick={onLeave} data-testid="follow-back">
            Back
          </Button>
        </header>
      )}
      <section ref={sheet} className="sheet" aria-label="Follow" data-snap="peek">
        {live && ((run.off.shown && run.back) || run.away !== null) && (
          <div className="sheet-banner follow-banners">
            {run.away !== null && <AwayLine ms={run.away} onDismiss={dismissGap} />}
            {run.off.shown && run.back && <OffRouteBanner back={run.back} />}
          </div>
        )}
        <div className="sheet-body">
          {(view === "start" || view === "asking") && (
            <div className="follow-copy">
              <h1 className="t-title">{name ?? "Follow this route"}</h1>
              <p className="t-body-s muted">
                <Num value={line.totalM} format={(m) => km(m)} field="along_m" /> along the route
              </p>
              <p className="t-body-s follow-lock" data-testid="follow-lock">
                Locking your phone pauses GATHO&apos;s tracking. Keep the screen on, or use the GPX in Organic Maps or
                on a watch for long runs.
              </p>
              {view === "start" ? (
                <>
                  <p className="t-body-s" data-testid="follow-why">
                    GATHO uses your location to show you on the route. It stays on this phone.
                  </p>
                  {route.cue_source === "geometry" && (
                    <p className="t-body-s muted" data-testid="follow-bare-cues">
                      Road names aren&apos;t available right now, so turn cues have no names.
                    </p>
                  )}
                  <label className="toggle follow-saver-choice">
                    <input type="checkbox" checked={saver} onChange={(e) => setSaver(e.target.checked)} data-testid="follow-saver-choice" />
                    <span>Battery saver: a near-black screen, no map animation</span>
                  </label>
                  <Button variant="primary" size="lg" block icon="play" onClick={follow} data-testid="follow-start">Follow</Button>
                </>
              ) : (
                <>
                  <p className="t-body-s" role="status" data-testid="follow-asking">
                    {noPosition
                      ? "No position yet. It comes sooner outside, under open sky."
                      : "Waiting for your location. Allow it if your browser asks."}
                  </p>
                  <Button block onClick={giveUp}>Cancel</Button>
                </>
              )}
            </div>
          )}

          {!run && blocked && (
            <div className="follow-copy" data-testid="follow-blocked">
              <NoAccess access={access} />
              <div className="follow-actions">
                {access === "denied" && <Button icon="redo" onClick={follow}>Try again</Button>}
                <Button icon="chevronLeft" onClick={onLeave}>Back</Button>
              </div>
            </div>
          )}

          {live && !question && (
            <>
              <h1 className="sr-only">Following the route</h1>
              {access === "denied"
                ? <p className="t-body-s follow-lock" role="status" data-testid="follow-lost">Location was turned off, so progress has stopped.</p>
                : <CueLine run={run} turns={turns} noPosition={noPosition} />}
              {(screenLock === "refused" || screenLock === "unsupported") && (
                <p className="t-meta muted follow-wake" role="status" data-testid="follow-wake">{WAKE_NOTICE[screenLock]}</p>
              )}
              <Stats line={line} run={run} now={now} />
              <div className="follow-actions">
                {access === "denied"
                  ? <Button icon="redo" onClick={start}>Try again</Button>
                  : run.phase === "paused"
                    ? <Button icon="play" onClick={resume} data-testid="follow-resume">Resume</Button>
                    : <Button icon="pause" onClick={pause} data-testid="follow-pause">Pause</Button>}
                <Button icon="stop" onClick={askStop} data-testid="follow-stop">Stop</Button>
              </div>
            </>
          )}

          {live && question && (
            <div className="follow-copy" data-testid="follow-question">
              <h1 className="t-title">{question === "finished" ? "Did you finish the route?" : "Stop this run?"}</h1>
              <p className="t-body-s">
                {question === "finished"
                  ? "GATHO couldn't track all of it, and the end is within reach of where it last saw you."
                  : "Nothing is saved, so a stopped run can't be carried on."}
              </p>
              <div className={`follow-actions${question === "finished" ? " follow-question-actions" : ""}`}>
                {question === "finished" ? (
                  <>
                    <Button icon="check" onClick={() => answer(true)} data-testid="follow-finished-yes">Yes, I finished</Button>
                    <Button icon="stop" onClick={() => answer(false)} data-testid="follow-finished-no">No, stop here</Button>
                  </>
                ) : (
                  <Button icon="stop" onClick={() => answer(false)} data-testid="follow-stop-confirm">Stop</Button>
                )}
                <Button icon="play" onClick={keepGoing} data-testid="follow-keep-going">Keep going</Button>
              </div>
            </div>
          )}

          {stopped && (
            <div className="follow-copy" data-testid="follow-summary">
              <h1 className="t-title">{run.track.arrived ? "Route finished" : "Run stopped"}</h1>
              <Stats line={line} run={run} now={now} summary />
              {run.track.skipped && (
                <p className="t-body-s" data-testid="follow-skipped">The distance includes a skipped part.</p>
              )}
              {run.gaps.length > 0 && (
                <p className="t-body-s" data-testid="follow-gaps">
                  Screen locked or GATHO hidden {run.gaps.length === 1 ? "once" : <><span data-value={run.gaps.length}>{run.gaps.length}</span> times</>},
                  {" "}for <Num value={away} format={gapText} field="follow.away_ms" /> in all. The time counts it.
                </p>
              )}
              <p className="t-body-s muted">Nothing was saved.</p>
              <Button variant="primary" block icon="check" onClick={onLeave} data-testid="follow-done">Done</Button>
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
