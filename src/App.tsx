import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type * as maplibregl from 'maplibre-gl';
import type { MapRoute } from './components/MapView';
import PlaceSearch from './components/PlaceSearch';
import ElevationSpark from './components/ElevationSpark';
import Segmented from './components/Segmented';
import PlanningAnimation from './components/PlanningAnimation';
import SheetHandle from './components/SheetHandle';
import { useBottomSheet } from './components/useBottomSheet';
import { Icon } from './components/Icon';
import SwipeRow from './components/SwipeRow';
import { useHold } from './components/useHold';
import type { Place } from './lib/geocode';
import { reverseGeocode } from './lib/geocode';
import { plan, prepare } from './lib/planService';
import { fromRuns, savedRoutes, settings, toRuns } from './lib/storage';
import type { SavedRoute } from './lib/storage';
import { downloadFile, FIT_TYPE } from './lib/share';
import { routeFileName } from './core/gpx';
import { appleMapsUrl, googleMapsUrl } from './core/mapLinks';
import type { LngLat } from './core/geo';
import type { PlannedRoute, RoadKind, RouteStats } from './core/types';
import { RouterError } from './core/types';

// The map library is the biggest part of the app: load it next to the panel, so the
// panel shows up first instead of waiting for the map code.
// Start downloading it right away, but build the map only once the start screen's
// letter animation is done: building it is heavy work that would make that animation stutter.
const mapModule = import('./components/MapView');
const MapView = lazy(() => mapModule);
type Splash = { shapeDone: Promise<void> };
const splash = (window as unknown as { __longcutSplash?: Splash }).__longcutSplash;

// Garmin's FIT library is large: load it only once a route is on screen.
let fitLib: Promise<typeof import('./core/fit')> | null = null;
const loadFit = () => (fitLib ??= import('./core/fit'));

type Field = 'from' | 'to' | 'stop';
const FIELD_NAME: Record<Field, string> = { from: 'start', to: 'finish', stop: 'stop' };
type View =
  | { k: 'edit' }
  | { k: 'search'; field: Field }
  | { k: 'pick'; field: Field }
  | { k: 'planning' }
  | { k: 'results' }
  | { k: 'saved' }
  | { k: 'savedRoute'; route: SavedRoute };

type Problem = { kind: 'too-short'; shortestKm: number } | { kind: 'message'; text: string } | null;

/** What the route screen shows: a freshly planned route or a saved one. */
interface Detail {
  coords: LngLat[];
  elevations: (number | null)[];
  lengthM: number;
  stats?: RouteStats;
  extraM?: number;
  /** With a stop: where it is (meters from the start) and what it's called. */
  stopM?: number;
  stopName?: string;
}

type StatKey = 'busy' | 'unpaved' | 'twice' | 'climb';
const STAT_INFO: Record<StatKey, string> = {
  busy: 'Busy: share of the route on main roads (smaller through roads count half). Red on the map.',
  unpaved: 'Unpaved: share on dirt, grass, sand or forest paths, or paths with no known surface. Gravel and dolomite count as paved. Dashed on the map.',
  twice: 'Twice: share of the route you run more than once, like out and back on the same road.',
  climb: 'Climb: total meters uphill.',
};

const MIN_KM = 1;
const MAX_KM = 100;
const fmtKm = (m: number) => (m / 1000).toFixed(2);
const pct = (x: number) => `${Math.round(x * 100)}%`;
const samePlace = (a: LngLat, b: LngLat) => a[0] === b[0] && a[1] === b[1];
const isLoopRoute = (s: SavedRoute) => s.loop ?? samePlace(s.from.coord, s.to.coord);
/** "Loop · Ten Bos 4", "Ten Bos 4 → Grote Markt" or "Ten Bos 4 → Bakkerij → Grote Markt" */
const tripName = (s: SavedRoute) =>
  isLoopRoute(s) ? `Loop · ${s.from.name}${s.stop ? ` via ${s.stop.name}` : ''}` : [s.from.name, s.stop?.name, s.to.name].filter(Boolean).join(' → ');

export default function App() {
  const initial = settings.get();
  const [view, setView] = useState<View>({ k: 'edit' });
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  // an optional place to pass on the way
  const [stop, setStop] = useState<Place | null>(null);
  const [stopLeaving, setStopLeaving] = useState(false);
  // the stop the routes on screen were planned with
  const [planStop, setPlanStop] = useState<Place | null>(null);
  const [loop, setLoop] = useState(false);
  const [km, setKm] = useState(initial.distanceKm);
  const [kmText, setKmText] = useState(String(initial.distanceKm));
  const [preferGreen, setPreferGreen] = useState(initial.preferGreen);
  // Surface: Mostly paved / Trails welcome / Mostly trail
  const [surface, setSurface] = useState<'paved' | 'mixed' | 'trail'>(initial.surface ?? (initial.unpavedOk ? 'mixed' : 'paved'));
  const unpavedOk = surface !== 'paved';
  const preferTrail = surface === 'trail';
  const [preferLit, setPreferLit] = useState(initial.preferLit);
  const [optionsOpen, setOptionsOpen] = useState(false);
  // Every "New routes" adds a set; you can page back to earlier sets.
  const [sets, setSets] = useState<PlannedRoute[][]>([]);
  const [setIdx, setSetIdx] = useState(0);
  const routes = sets[setIdx] ?? [];
  const [active, setActive] = useState(0);
  const [variation, setVariation] = useState(0);
  const [problem, setProblem] = useState<Problem>(null);
  // A message belongs to the screen it was shown on, and goes away when you leave it.
  const [toastMsg, setToastMsg] = useState<{ text: string; view: View['k'] } | null>(null);
  const [info, setInfo] = useState<StatKey | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [swipeOpen, setSwipeOpen] = useState<string | null>(null);
  const planCtl = useRef<AbortController | null>(null);
  // the first route is shown while the others are still being found
  const [pending, setPending] = useState(false);
  const planBack = useRef<View>({ k: 'edit' });
  const [gps, setGps] = useState<LngLat | null>(null);
  const [accuracy, setAccuracy] = useState(0);
  const flyToMe = useRef(false);
  const [elapsed, setElapsed] = useState(0);
  const [mapsOpen, setMapsOpen] = useState(false);
  // after "Send to Garmin": the next steps stay on screen (a short message is easy to miss)
  const [exported, setExported] = useState(false);
  const [mapOn, setMapOn] = useState(!splash);
  useEffect(() => {
    if (!splash) return;
    let live = true;
    const on = () => live && setMapOn(true);
    splash.shapeDone.then(on);
    const t = setTimeout(on, 3000); // never wait longer than this
    return () => {
      live = false;
      clearTimeout(t);
    };
  }, []);
  const [saved, setSaved] = useState<SavedRoute[]>(() => savedRoutes.list());
  const [savedIds, setSavedIds] = useState<Map<PlannedRoute, string>>(() => new Map());
  const mapRef = useRef<maplibregl.Map | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [wide, setWide] = useState(() => matchMedia('(min-width: 900px)').matches);
  // The panel slides between open and collapsed with your finger (phones only).
  const locateBtn = useRef<HTMLButtonElement>(null);
  const bs = useBottomSheet(sheet, locateBtn, !wide, view.k);
  const collapsed = bs.collapsed;
  const sheetSize = { w: bs.width, h: bs.coveredHeight };
  const sheetStyle: React.CSSProperties = {};
  const sheetClass = collapsed ? 'collapsed' : '';
  const collapsedDrag = collapsed ? bs.handlers : {};
  const handle = <SheetHandle collapsed={collapsed} onToggle={() => bs.setCollapsed(!collapsed)} handlers={bs.handlers} />;

  // --- settings & layout ---------------------------------------------------
  useEffect(() => {
    settings.set({ distanceKm: km, preferGreen, unpavedOk, preferLit, surface });
  }, [km, preferGreen, unpavedOk, preferLit, surface]);

  useEffect(() => {
    const mq = matchMedia('(min-width: 900px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);



  // close menus and explanations when switching screens or routes
  useEffect(() => {
    setMapsOpen(false);
    setExported(false);
    setInfo(null);
    setConfirmDelete(false);
    setSwipeOpen(null);
  }, [view.k, active, setIdx]);

  useEffect(() => {
    if (view.k === 'results' || view.k === 'savedRoute') loadFit();
  }, [view.k]);

  const viewRef = useRef(view.k);
  viewRef.current = view.k;
  /** Shows a short message on the current screen (or on `on`, the screen you go to next). */
  const setToast = useCallback((text: string, on?: View['k']) => setToastMsg({ text, view: on ?? viewRef.current }), []);
  const toast = toastMsg && toastMsg.view === view.k ? toastMsg.text : null;
  useEffect(() => {
    if (!toastMsg) return;
    const t = setTimeout(() => setToastMsg(null), toastMsg.text.length > 40 ? 6000 : 3200);
    return () => clearTimeout(t);
  }, [toastMsg]);

  // --- current location ----------------------------------------------------
  const locate = useCallback((apply: boolean) => {
    if (!('geolocation' in navigator)) return;
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const c: LngLat = [pos.coords.longitude, pos.coords.latitude];
        setGps(c);
        setAccuracy(pos.coords.accuracy);
        if (!apply) return;
        const place: Place = { name: 'Current location', detail: '', coord: c };
        setFrom((f) => f ?? place);
        const named = await reverseGeocode(c);
        setFrom((f) => (f && f.name === 'Current location' && f.coord === c ? { ...place, detail: named.name } : f));
      },
      () => {
        if (apply) setToast('Location is off. Search for your start instead.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 },
    );
  }, [setToast]);

  useEffect(() => locate(true), [locate]);

  // Once location is allowed, keep the blue dot up to date while the app is open.
  const watching = gps !== null;
  useEffect(() => {
    if (!watching || !('geolocation' in navigator)) return;
    const id = navigator.geolocation.watchPosition(
      (pos) => {
        setGps([pos.coords.longitude, pos.coords.latitude]);
        setAccuracy(pos.coords.accuracy);
      },
      () => {},
      { enableHighAccuracy: true, maximumAge: 5000 },
    );
    return () => navigator.geolocation.clearWatch(id);
  }, [watching]);

  const centerOn = (c: LngLat) => {
    const map = mapRef.current;
    if (!map) return;
    map.easeTo({ center: c, zoom: Math.max(map.getZoom(), 15), padding: pad, duration: 700 });
  };

  // The location button: go to where you are (asks for location the first time).
  const goToMe = () => {
    if (gps) return centerOn(gps);
    if (!('geolocation' in navigator)) return setToast('This device cannot share its location.');
    flyToMe.current = true;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const c: LngLat = [pos.coords.longitude, pos.coords.latitude];
        setGps(c);
        setAccuracy(pos.coords.accuracy);
      },
      () => {
        flyToMe.current = false;
        setToast('Location is off. Allow it in your phone settings for this site.');
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };
  useEffect(() => {
    if (gps && flyToMe.current) {
      flyToMe.current = false;
      centerOn(gps);
    }
    // centerOn only reads the latest map and padding
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gps]);

  // --- planning ------------------------------------------------------------
  const end = loop ? from : to;

  // Get ready while start and finish are being chosen: the route planner's profile and the
  // direct route are fetched in the background, so pressing Plan skips those waits.
  const fromC = from?.coord;
  const endC = end?.coord;
  const stopC = stop?.coord;
  useEffect(() => {
    if (view.k !== 'edit') return;
    const t = setTimeout(() => prepare(fromC ?? null, endC ?? null, { unpavedOk, preferGreen, preferLit, preferTrail }, stopC), 400);
    return () => clearTimeout(t);
    // only re-run when the actual places or options change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fromC?.[0], fromC?.[1], endC?.[0], endC?.[1], stopC?.[0], stopC?.[1], surface, preferGreen, preferLit, view.k]);

  /**
   * Plans routes. `more` = "New routes": keep the earlier sets so you can go back.
   * Places and distance are passed in, so a saved route can plan straight away.
   */
  const run = async (opts: { more: boolean; variation: number; from?: Place | null; end?: Place | null; stop?: Place | null; km?: number }) => {
    const start = opts.from !== undefined ? opts.from : from;
    const finish = opts.end !== undefined ? opts.end : end;
    const via = opts.stop !== undefined ? opts.stop : stop;
    const dist = opts.km ?? km;
    setProblem(null);
    if (!start) return setProblem({ kind: 'message', text: 'Choose where you start.' });
    if (!finish) return setProblem({ kind: 'message', text: 'Choose where you finish, or switch on Loop.' });
    if (!(dist >= MIN_KM && dist <= MAX_KM)) return setProblem({ kind: 'message', text: `Distance must be between ${MIN_KM} and ${MAX_KM} km.` });
    planBack.current = opts.more ? view : { k: 'edit' };
    setView({ k: 'planning' });
    setVariation(opts.variation);
    planCtl.current?.abort(); // a search still filling in tabs stops
    const ctl = new AbortController();
    planCtl.current = ctl;
    setPending(false);
    // "New routes" adds a set; a fresh plan starts over
    const baseSets = opts.more && planBack.current.k === 'results' ? sets : [];
    let shownEarly = false;
    const show = (routes: PlannedRoute[], final: boolean) => {
      setPlanStop(via);
      const next = [...baseSets, routes];
      setSets(next);
      setSetIdx(next.length - 1);
      if (!shownEarly) {
        setActive(0);
        setView({ k: 'results' });
      }
      shownEarly = true;
      setPending(!final);
    };
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 250);
    // when "New routes" fails, stay on the routes you had
    const fail = (text: string) => {
      if (opts.more && planBack.current.k !== 'edit') {
        setView(planBack.current);
        setToast(text, planBack.current.k);
      } else {
        setView({ k: 'edit' });
        setProblem({ kind: 'message', text });
      }
    };
    try {
      const r = await plan({
        start: start.coord,
        end: finish.coord,
        ...(via ? { stop: via.coord } : {}),
        distanceKm: dist,
        prefs: { unpavedOk, preferGreen, preferLit, preferTrail },
        variation: opts.variation,
        signal: ctl.signal,
        onProgress: (routes) => {
          if (!ctl.signal.aborted) show(routes, false);
        },
      });
      if (ctl.signal.aborted) return;
      if (r.ok) {
        show(r.routes, true);
      } else if (shownEarly) {
        setPending(false);
      } else if (r.reason === 'too-short') {
        setView({ k: 'edit' });
        setProblem({ kind: 'too-short', shortestKm: r.shortestKm });
      } else {
        fail(
          r.reason === 'busy'
            ? 'Finding routes is taking longer than usual right now. Try again in a minute.'
            : 'No route of this length found around these points. Try a slightly different distance or a nearby start.',
        );
      }
    } catch (e) {
      if (ctl.signal.aborted) return;
      if (shownEarly) {
        // keep the route(s) already on screen
        setPending(false);
        return setToast('Couldn’t find more routes right now.', 'results');
      }
      const busy = e instanceof RouterError && e.busy;
      fail(busy ? 'Finding routes is taking longer than usual right now. Try again in a minute.' : 'Couldn’t reach the route planner. Check your connection and try again.');
    } finally {
      clearInterval(tick);
      setElapsed(0);
      if (planCtl.current === ctl) planCtl.current = null;
    }
  };

  const cancelPlan = () => {
    planCtl.current?.abort();
    setView(planBack.current);
  };

  // Opening the options or getting a message makes the panel taller than a small screen:
  // bring the Plan button (the bottom of the panel) back into view.
  useEffect(() => {
    if (view.k !== 'edit' || (!optionsOpen && !problem)) return;
    const el = sheet.current;
    if (el && el.scrollHeight > el.clientHeight) el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' });
  }, [optionsOpen, problem, view.k]);

  // --- distance input ------------------------------------------------------
  const commitKm = (v: number) => {
    const clamped = Math.min(MAX_KM, Math.max(MIN_KM, Math.round(v * 10) / 10));
    setKm(clamped);
    setKmText(String(clamped));
    setProblem(null);
  };
  const kmRef = useRef(km);
  kmRef.current = km;
  // − and +: one tap = 1 km; hold to keep going
  const less = useHold(() => commitKm(Math.ceil(kmRef.current) - 1));
  const more = useHold(() => commitKm(Math.floor(kmRef.current) + 1));
  const typedKm = parseFloat(kmText.replace(',', '.'));
  const kmValid = typedKm >= MIN_KM && typedKm <= MAX_KM;

  // --- export & save -------------------------------------------------------
  /** Saves a FIT course (Garmin's own format) to the device. Short names: the watch shows ~15 characters. */
  const doExport = async (d: Detail, finishName: string | null) => {
    const name = finishName ? `${fmtKm(d.lengthM)} km ${finishName}` : `${fmtKm(d.lengthM)} km loop`;
    const file = routeFileName(d.lengthM / 1000, finishName ?? 'loop', 'fit');
    // the stop is a course point: the watch shows it on the course and counts down to it
    const points = d.stopM != null ? [{ atM: d.stopM, name: d.stopName || 'Stop' }] : [];
    downloadFile(file, (await loadFit()).toFit(name, d.coords, d.elevations, points), FIT_TYPE);
    setExported(true);
    setToast('Route file downloaded.');
  };

  const saveActive = () => {
    const r = routes[active];
    if (!r || !from || !end) return;
    const id = savedIds.get(r);
    if (id) {
      setSaved(savedRoutes.remove(id));
      setSavedIds((ids) => {
        const next = new Map(ids);
        next.delete(r);
        return next;
      });
      setToast('Removed from saved routes.');
      return;
    }
    // "Current location" means nothing later on: keep the street name instead
    const named = (p: Place) => (p.name === 'Current location' && p.detail ? { ...p, name: p.detail, detail: '' } : p);
    const s = savedRoutes.add({
      from: named(from),
      to: named(end),
      ...(planStop && r.stopM != null ? { stop: named(planStop), stopM: r.stopM } : {}),
      loop: !!isLoopNow,
      requestedKm: km,
      lengthM: r.stats.length,
      ascent: r.stats.ascent,
      coords: r.coords,
      elevations: r.elevations,
      stats: r.stats,
      roads: toRuns(r.roads),
      unpaved: toRuns(r.unpaved),
      extraM: r.extraM,
    });
    if (!s) return setToast('Could not save: storage on this device is full or blocked.');
    setSaved(savedRoutes.list());
    setSavedIds((ids) => new Map(ids).set(r, s.id));
    setToast('Saved. Find it under Saved.');
  };

  const deleteSaved = (id: string) => {
    setSaved(savedRoutes.remove(id));
    setSwipeOpen(null);
    setSavedIds((ids) => new Map([...ids].filter(([, v]) => v !== id)));
    setView({ k: 'saved' });
    setToast('Route deleted.', 'saved');
  };

  /** Plan new routes for the same trip as a saved route. */
  const replanSaved = (s: SavedRoute) => {
    const isLoop = isLoopRoute(s);
    setFrom(s.from);
    setTo(isLoop ? null : s.to);
    setLoop(isLoop);
    setStop(s.stop ?? null);
    commitKm(s.requestedKm);
    run({ more: false, variation: 0, from: s.from, end: isLoop ? s.from : s.to, stop: s.stop ?? null, km: s.requestedKm });
  };

  // --- pick on map ---------------------------------------------------------
  const confirmPick = async (field: Field) => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    const place = await reverseGeocode([c.lng, c.lat]);
    if (field === 'from') setFrom(place);
    else if (field === 'stop') setStop(place);
    else {
      setTo(place);
      setLoop(false);
    }
    setView({ k: 'edit' });
  };

  const choose = (field: Field, p: Place) => {
    if (field === 'from') setFrom(p);
    else if (field === 'stop') setStop(p);
    else {
      setTo(p);
      setLoop(false);
    }
    setProblem(null);
    setView({ k: 'edit' });
  };

  // --- map content ---------------------------------------------------------
  let mapRoutes: MapRoute[] = [];
  let mapStart = from?.coord ?? null;
  let mapEnd = end?.coord ?? null;
  let mapStop = stop?.coord ?? null;
  if (view.k === 'results') mapRoutes = routes;
  if (view.k === 'savedRoute') {
    const sr = view.route;
    mapRoutes = [{ coords: sr.coords, roads: sr.roads && fromRuns<RoadKind>(sr.roads), unpaved: sr.unpaved && fromRuns(sr.unpaved) }];
    mapStart = view.route.from.coord;
    mapEnd = view.route.to.coord;
    mapStop = view.route.stop?.coord ?? null;
  }
  const pad = wide
    ? { top: 48, bottom: 48, left: sheetSize.w + 64, right: 48 }
    : { top: 88, bottom: sheetSize.h + 24, left: 32, right: 32 };

  const r = routes[active];
  const isLoopNow = loop || (from && to && samePlace(from.coord, to.coord));

  /** The route screen, shared by fresh and saved routes, so both can do the same things. */
  const routeBody = (d: Detail, o: { title?: string; finishName: string | null; actions: React.ReactNode }) => (
    <>
      <div className="headline">
        <div className="big-km">
          <b>{fmtKm(d.lengthM)}</b>
          <span>km</span>
        </div>
        {o.title && <span className="dev">{o.title}</span>}
      </div>
      {d.stats && (
        <div className="stats">
          {(
            [
              ['busy', 'Busy', pct(d.stats.busyShare), d.stats.busyShare > 0.05],
              ['unpaved', 'Unpaved', pct(d.stats.unpavedShare), false],
              ['twice', 'Twice', pct(d.stats.overlapShare), false],
              ['climb', 'Climb', `${d.stats.ascent} m`, false],
            ] as [StatKey, string, string, boolean][]
          ).map(([key, label, value, warn]) => (
            <button key={key} type="button" className={`stat ${info === key ? 'on' : ''}`} aria-expanded={info === key} onClick={() => setInfo(info === key ? null : key)}>
              <span className="stat-label">
                {label} <Icon name="info" size={11} />
              </span>
              <span className={`stat-value ${warn ? 'warn' : ''}`}>{value}</span>
            </button>
          ))}
        </div>
      )}
      {info && <p className="hint stat-info">{STAT_INFO[info]}</p>}
      {d.stopM != null && (
        <p className="stop-note">
          <span className="dot dot-stop" aria-hidden="true" />
          <span>
            Stop at <b>km {(d.stopM / 1000).toFixed(1)}</b>
            {d.stopName ? ` · ${d.stopName}` : ''}
          </span>
        </p>
      )}
      {!!d.extraM && d.extraM >= 20 && (
        <p className="hint extra-note">Includes {Math.round(d.extraM / 10) * 10} m out and back at the finish to make the distance.</p>
      )}
      <ElevationSpark coords={d.coords} elevations={d.elevations} />
      <button type="button" className="btn primary big" onClick={() => doExport(d, o.finishName)}>
        <Icon name="download" /> Send to Garmin
      </button>
      {exported && (
        <p className="hint export-note">
          Next: open the file in Downloads, tap Share and choose Connect. It opens there as a course you can send to your watch.
        </p>
      )}
      {o.actions}
      {mapsOpen && (
        <div className="maps-menu">
          <a className="btn ghost" href={googleMapsUrl(d.coords)} target="_blank" rel="noreferrer">
            Google Maps
          </a>
          <a className="btn ghost" href={appleMapsUrl(d.coords)} target="_blank" rel="noreferrer">
            Apple Maps
          </a>
          <p className="hint">Maps apps take only a few points, so the route there is close but not exact.</p>
        </div>
      )}
    </>
  );
  const mapsButton = (
    <button type="button" className="btn ghost" aria-expanded={mapsOpen} onClick={() => setMapsOpen(!mapsOpen)}>
      <Icon name="map" /> Maps
    </button>
  );

  return (
    <div className={`app view-${view.k}`}>
      {mapOn ? (
      <Suspense fallback={<div className="map" />}>
      <MapView
        routes={mapRoutes}
        active={view.k === 'results' ? active : 0}
        start={view.k === 'pick' ? null : mapStart}
        end={view.k === 'pick' ? null : mapEnd}
        stop={view.k === 'pick' ? null : mapStop}
        padding={pad}
        onReady={(m) => {
          mapRef.current = m;
          (window as unknown as { __longcutMap?: unknown }).__longcutMap = m; // handy for testing
          // the start screen (index.html) leaves once the map is ready
          (window as unknown as { __longcutReady?: () => void }).__longcutReady?.();
        }}
        onSelectRoute={(i) => setActive(i)}
        me={gps ? { coord: gps, accuracy } : null}
      />
      </Suspense>
      ) : (
        <div className="map" />
      )}

      {view.k !== 'search' && (
        <button
          type="button"
          className="locate-btn"
          aria-label="Show my location"
          ref={locateBtn}
          style={wide ? undefined : { bottom: sheetSize.h + 12 }}
          onClick={goToMe}
        >
          <Icon name="my-location" />
        </button>
      )}

      <header className="topbar">
        <span className="brand">
          <span className="brand-l">L</span>ongcut
        </span>
        {(view.k === 'edit' || view.k === 'results') && (
          <button type="button" className="pill-btn" onClick={() => setView({ k: 'saved' })}>
            <Icon name="list" size={18} /> Saved{saved.length ? ` · ${saved.length}` : ''}
          </button>
        )}
      </header>

      {view.k === 'pick' && (
        <>
          <div className="crosshair" aria-hidden="true">
            <span className={`dot ${view.field === 'from' ? 'dot-start' : view.field === 'stop' ? 'dot-stop' : 'dot-end'}`} />
          </div>
          <div className="sheet pick-sheet" ref={sheet}>
            <p className="pick-text">Move the map until the dot is on your {FIELD_NAME[view.field]}.</p>
            <div className="row-2">
              <button type="button" className="btn ghost" onClick={() => setView({ k: 'search', field: view.field })}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={() => confirmPick(view.field)}>
                Set {FIELD_NAME[view.field]}
              </button>
            </div>
          </div>
        </>
      )}

      {view.k === 'search' && (
        <PlaceSearch
          title={view.field === 'from' ? 'Start' : view.field === 'stop' ? 'Stop' : 'Finish'}
          near={gps ?? from?.coord ?? null}
          canUseLocation={'geolocation' in navigator}
          onPick={(p) => choose(view.field, p)}
          onUseLocation={() => {
            if (gps) choose(view.field, { name: 'Current location', detail: '', coord: gps });
            else {
              if (view.field === 'from') setFrom(null);
              if (view.field === 'stop') return setToast('Location is off. Search for your stop instead.');
              locate(view.field === 'from');
              setView({ k: 'edit' });
            }
          }}
          onPickOnMap={() => setView({ k: 'pick', field: view.field })}
          onClose={() => setView({ k: 'edit' })}
        />
      )}

      {view.k === 'edit' && (
        <form
          className={`sheet edit-sheet ${sheetClass}`}
          style={sheetStyle}
          {...collapsedDrag}
          ref={sheet as React.RefObject<HTMLFormElement & HTMLDivElement>}
          onSubmit={(e) => {
            e.preventDefault();
            if (kmValid) run({ more: false, variation: 0, km: typedKm });
          }}
        >
          {handle}
          {/* one-line summary that fades in as the panel slides down */}
          <button
            type="button"
            className="sheet-summary"
            data-peek
            style={{ pointerEvents: collapsed ? 'auto' : 'none' }}
            aria-hidden={!collapsed}
            tabIndex={collapsed ? 0 : -1}
            onClick={() => bs.setCollapsed(false)}
          >
            <span className="dot dot-start" aria-hidden="true" />
            <span className="summary-text">
              {from?.name ?? 'Choose start'} → {stop ? `${stop.name} → ` : ''}
              {loop ? (stop ? 'back' : 'loop') : to?.name ?? 'choose finish'}
            </span>
            <span className="summary-km">{km} km</span>
          </button>
          <div className="sheet-body" inert={collapsed}>
          <div className="fields">
            <div className="field-stack">
              <button type="button" className="field" onClick={() => setView({ k: 'search', field: 'from' })}>
                <span className="dot dot-start" aria-hidden="true" />
                <span className="field-text">
                  <span className="field-label">Start</span>
                  <span className={`field-value ${from ? '' : 'empty'}`}>{from ? from.name : 'Choose start'}</span>
                </span>
              </button>
              {stop ? (
                <div
                  className={`stop-row ${stopLeaving ? 'leaving' : ''}`}
                  onTransitionEnd={(e) => {
                    if (stopLeaving && e.target === e.currentTarget) {
                      setStop(null);
                      setStopLeaving(false);
                    }
                  }}
                >
                  <div className="stop-inner">
                    <button type="button" className="field" onClick={() => setView({ k: 'search', field: 'stop' })}>
                      <span className="dot dot-stop" aria-hidden="true" />
                      <span className="field-text">
                        <span className="field-label">Stop</span>
                        <span className="field-value">{stop.name}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      className="stop-remove"
                      aria-label="Remove stop"
                      onClick={() => {
                        setProblem(null);
                        // fold the row away, then drop the stop (see onTransitionEnd)
                        if (matchMedia('(prefers-reduced-motion: reduce)').matches) setStop(null);
                        else setStopLeaving(true);
                      }}
                    >
                      <Icon name="close" size={16} />
                    </button>
                  </div>
                </div>
              ) : (
                <button type="button" className="add-stop" aria-label="Add a stop" onClick={() => setView({ k: 'search', field: 'stop' })}>
                  <Icon name="plus" size={14} />
                </button>
              )}
              <button
                type="button"
                className="field"
                onClick={() => setView({ k: 'search', field: 'to' })}
              >
                <span className="dot dot-end" aria-hidden="true" />
                <span className="field-text">
                  <span className="field-label">Finish</span>
                  <span className={`field-value ${to || loop ? '' : 'empty'}`}>
                    {loop ? 'Back to start' : to ? to.name : 'Choose finish'}
                  </span>
                </span>
              </button>
            </div>
            <div className="field-actions">
              <button
                type="button"
                className="icon-btn"
                aria-label="Swap start and finish"
                disabled={loop || !from || !to}
                onClick={() => {
                  setFrom(to);
                  setTo(from);
                }}
              >
                <Icon name="swap" />
              </button>
              <button
                type="button"
                className={`icon-btn toggle loop-btn ${loop ? 'on' : ''}`}
                aria-label="Loop: finish where you start"
                aria-pressed={loop}
                onClick={() => {
                  setLoop(!loop);
                  setProblem(null);
                }}
              >
                <Icon name="loop" size={20} />
                <span className="loop-label">Loop</span>
              </button>
            </div>
          </div>

          <div className="distance-row">
            <label htmlFor="km" className="field-label">
              Distance
            </label>
            <div className="stepper">
              <button type="button" className="step" aria-label="1 km less" {...less}>
                <Icon name="minus" />
              </button>
              <div className="km-box">
                <input
                  id="km"
                  className="km-input"
                  inputMode="decimal"
                  value={kmText}
                  onChange={(e) => {
                    setKmText(e.target.value);
                    const v = parseFloat(e.target.value.replace(',', '.'));
                    if (v >= MIN_KM && v <= MAX_KM) setKm(v);
                  }}
                  onBlur={() => commitKm(parseFloat(kmText.replace(',', '.')) || km)}
                  aria-describedby="km-unit"
                />
                <span id="km-unit" className="km-unit">km</span>
              </div>
              <button type="button" className="step" aria-label="1 km more" {...more}>
                <Icon name="plus" />
              </button>
            </div>
          </div>

          <button
            type="button"
            className={`options-row ${optionsOpen ? 'open' : ''}`}
            aria-expanded={optionsOpen}
            aria-controls="route-options"
            onClick={() => setOptionsOpen(!optionsOpen)}
          >
            <span className="field-label">Options</span>
            <span className="options-summary">
              <span className={unpavedOk ? 'on' : ''}>{surface === 'trail' ? 'Trail' : surface === 'mixed' ? 'Mixed' : 'Paved'}</span>
              <span className={preferGreen ? 'on' : ''}>{preferGreen ? 'Green' : 'Any scenery'}</span>
              <span className={preferLit ? 'on' : ''}>{preferLit ? 'Lit' : 'Daylight'}</span>
            </span>
            <Icon name="chevron" size={18} />
          </button>
          <div className="prefs" id="route-options" hidden={!optionsOpen}>
            <Segmented
              label="Surface"
              value={surface}
              onChange={setSurface}
              options={[
                ['paved', 'Paved'],
                ['mixed', 'Mixed'],
                ['trail', 'Trail'],
              ]}
            />
            <Segmented
              label="Scenery"
              value={preferGreen}
              onChange={setPreferGreen}
              options={[
                [false, 'Any'],
                [true, 'Green'],
              ]}
            />
            <Segmented
              label="Light"
              value={preferLit}
              onChange={setPreferLit}
              options={[
                [false, 'Daylight'],
                [true, 'Lit streets'],
              ]}
            />
          </div>

          {problem && (
            <div className="problem" role="alert">
              {problem.kind === 'too-short' ? (
                <>
                  <p>
                    The shortest route{stop ? ' via your stop' : ''} is already <b>{problem.shortestKm.toFixed(1)} km</b>, longer than {km} km.
                  </p>
                  <button
                    type="button"
                    className="btn small"
                    onClick={() => {
                      const n = Math.ceil(problem.shortestKm * 1.02);
                      commitKm(n);
                      run({ more: false, variation: 0, km: n });
                    }}
                  >
                    Plan {Math.ceil(problem.shortestKm * 1.02)} km instead
                  </button>
                </>
              ) : (
                <p>{problem.text}</p>
              )}
            </div>
          )}

          <button type="submit" className="btn primary big" disabled={!kmValid}>
            {kmValid ? `Plan ${typedKm} km ${isLoopNow ? 'loop' : 'route'}` : `Distance: ${MIN_KM}–${MAX_KM} km`}
          </button>
          </div>
        </form>
      )}

      {view.k === 'planning' && (
        <div className="sheet planning-sheet" ref={sheet} role="status" aria-live="polite">
          <PlanningAnimation />
          <p className="planning-title">Finding your longcut</p>
          <p className="hint planning-step" key={elapsed < 1 ? 1 : elapsed < 4 ? 2 : elapsed < 10 ? 3 : 4}>
            {elapsed < 1
              ? 'Measuring the direct way'
              : elapsed < 4
                ? `Trying detours for ${km} km`
                : elapsed < 10
                  ? 'Picking the quietest ones'
                  : 'Taking a bit longer than usual…'}
          </p>
          <button type="button" className="btn ghost cancel-plan" onClick={cancelPlan}>
            Cancel
          </button>
        </div>
      )}

      {view.k === 'results' && r && (
        <div className={`sheet results-sheet ${sheetClass}`} style={sheetStyle} ref={sheet} {...collapsedDrag}>
          {handle}
          <div className="sheet-head" data-peek>
            <button
              type="button"
              className="link-btn"
              onClick={() => {
                if (pending) {
                  planCtl.current?.abort();
                  setPending(false);
                }
                setView({ k: 'edit' });
              }}
            >
              <Icon name="back" size={18} /> Edit
            </button>
            <div className="tabs" role="tablist" aria-label="Routes">
              {routes.map((x, i) => (
                <button
                  key={i}
                  type="button"
                  role="tab"
                  aria-selected={i === active}
                  className={`tab ${i === active ? 'on' : ''}`}
                  onClick={() => setActive(i)}
                >
                  {fmtKm(x.stats.length)}
                </button>
              ))}
              {pending && setIdx === sets.length - 1 &&
                Array.from({ length: Math.max(0, 3 - routes.length) }, (_, i) => (
                  <span key={`p${i}`} className="tab pending" aria-label="Finding more routes">
                    <i />
                    <i />
                    <i />
                  </span>
                ))}
            </div>
          </div>

          <div className="sheet-body results-body" inert={collapsed}>
            {routeBody(
              { coords: r.coords, elevations: r.elevations, lengthM: r.stats.length, stats: r.stats, extraM: r.extraM, stopM: r.stopM, stopName: planStop?.name },
              {
                finishName: isLoopNow || !end ? null : end.name,
                actions: (
                  <div className="row-3">
                    <button type="button" className={`btn ghost ${savedIds.has(r) ? 'on' : ''}`} aria-pressed={savedIds.has(r)} onClick={saveActive}>
                      <Icon name="bookmark" /> {savedIds.has(r) ? 'Saved' : 'Save'}
                    </button>
                    {mapsButton}
                    <button type="button" className="btn ghost" onClick={() => run({ more: true, variation: variation + 1 })}>
                      <Icon name="again" /> New routes
                    </button>
                  </div>
                ),
              },
            )}
            {sets.length > 1 && (
              <div className="set-pager">
                <button type="button" className="link-btn" disabled={setIdx === 0} onClick={() => (setSetIdx(setIdx - 1), setActive(0))}>
                  <Icon name="back" size={18} /> Earlier
                </button>
                <span>
                  Set {setIdx + 1} of {sets.length}
                </span>
                <button type="button" className="link-btn" disabled={setIdx === sets.length - 1} onClick={() => (setSetIdx(setIdx + 1), setActive(0))}>
                  Later <Icon name="forward" size={18} />
                </button>
              </div>
            )}
          </div>
        </div>
      )}

      {view.k === 'saved' && (
        <div className="sheet saved-sheet" ref={sheet}>
          <div className="sheet-head">
            <button type="button" className="link-btn" onClick={() => setView(routes.length ? { k: 'results' } : { k: 'edit' })}>
              <Icon name="back" size={18} /> Back
            </button>
            <h2 className="sheet-title">Saved routes</h2>
          </div>
          {saved.length === 0 ? (
            <p className="hint">Routes you save show up here, so you can send them to your watch again later.</p>
          ) : (
            <>
              <ul className="saved-list">
                {saved.map((s) => (
                  <SwipeRow
                    key={s.id}
                    open={swipeOpen === s.id}
                    onOpenChange={(o) => setSwipeOpen(o ? s.id : null)}
                    onSelect={() => (swipeOpen ? setSwipeOpen(null) : setView({ k: 'savedRoute', route: s }))}
                    onDelete={() => deleteSaved(s.id)}
                  >
                    <span className="saved-km">{fmtKm(s.lengthM)}</span>
                    <span className="saved-text">
                      <span className="place-name">{tripName(s)}</span>
                      <span className="place-detail">{new Date(s.savedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                    </span>
                  </SwipeRow>
                ))}
              </ul>
              <p className="hint saved-tip">Swipe a route to the left to delete it.</p>
            </>
          )}
        </div>
      )}

      {view.k === 'savedRoute' && (
        <div className={`sheet results-sheet ${sheetClass}`} style={sheetStyle} ref={sheet} {...collapsedDrag}>
          {handle}
          <div className="sheet-head" data-peek>
            <button type="button" className="link-btn" onClick={() => setView({ k: 'saved' })}>
              <Icon name="back" size={18} /> Saved
            </button>
            {collapsed && <span className="summary-km">{fmtKm(view.route.lengthM)} km</span>}
          </div>
          <div className="sheet-body results-body" inert={collapsed}>
            {routeBody(
              {
                coords: view.route.coords,
                elevations: view.route.elevations,
                lengthM: view.route.lengthM,
                stats: view.route.stats,
                extraM: view.route.extraM,
                stopM: view.route.stopM,
                stopName: view.route.stop?.name,
              },
              {
                title: tripName(view.route),
                finishName: isLoopRoute(view.route) ? null : view.route.to.name,
                actions: confirmDelete ? (
                  <div className="confirm">
                    <p>Delete this route?</p>
                    <div className="row-2">
                      <button type="button" className="btn ghost" onClick={() => setConfirmDelete(false)}>
                        Cancel
                      </button>
                      <button type="button" className="btn danger-fill" onClick={() => deleteSaved(view.route.id)}>
                        <Icon name="trash" /> Delete
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="row-3">
                    {mapsButton}
                    <button type="button" className="btn ghost" onClick={() => replanSaved(view.route)}>
                      <Icon name="again" /> New routes
                    </button>
                    <button type="button" className="btn ghost danger" onClick={() => setConfirmDelete(true)}>
                      <Icon name="trash" /> Delete
                    </button>
                  </div>
                ),
              },
            )}
          </div>
        </div>
      )}

      {toast && (
        <div className="toast" role="status">
          {toast}
        </div>
      )}
    </div>
  );
}
