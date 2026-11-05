import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type * as maplibregl from 'maplibre-gl';
import MapView from './components/MapView';
import type { MapRoute } from './components/MapView';
import PlaceSearch from './components/PlaceSearch';
import ElevationSpark from './components/ElevationSpark';
import Segmented from './components/Segmented';
import { Icon } from './components/Icon';
import type { Place } from './lib/geocode';
import { reverseGeocode } from './lib/geocode';
import { plan } from './lib/planService';
import { savedRoutes, settings } from './lib/storage';
import type { SavedRoute } from './lib/storage';
import { exportGpx } from './lib/share';
import { gpxFileName, toGpx } from './core/gpx';
import { appleMapsUrl, googleMapsUrl } from './core/mapLinks';
import type { LngLat } from './core/geo';
import type { PlannedRoute } from './core/types';

type Field = 'from' | 'to';
type View =
  | { k: 'edit' }
  | { k: 'search'; field: Field }
  | { k: 'pick'; field: Field }
  | { k: 'planning' }
  | { k: 'results' }
  | { k: 'saved' }
  | { k: 'savedRoute'; route: SavedRoute };

type Problem = { kind: 'too-short'; shortestKm: number } | { kind: 'message'; text: string } | null;

const MIN_KM = 1;
const MAX_KM = 100;
const fmtKm = (m: number) => (m / 1000).toFixed(2);
const pct = (x: number) => `${Math.round(x * 100)}%`;

export default function App() {
  const initial = settings.get();
  const [view, setView] = useState<View>({ k: 'edit' });
  const [from, setFrom] = useState<Place | null>(null);
  const [to, setTo] = useState<Place | null>(null);
  const [loop, setLoop] = useState(false);
  const [km, setKm] = useState(initial.distanceKm);
  const [kmText, setKmText] = useState(String(initial.distanceKm));
  const [preferGreen, setPreferGreen] = useState(initial.preferGreen);
  const [unpavedOk, setUnpavedOk] = useState(initial.unpavedOk);
  const [routes, setRoutes] = useState<PlannedRoute[]>([]);
  const [active, setActive] = useState(0);
  const [variation, setVariation] = useState(0);
  const [problem, setProblem] = useState<Problem>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [gps, setGps] = useState<LngLat | null>(null);
  const [accuracy, setAccuracy] = useState(0);
  const flyToMe = useRef(false);
  const [elapsed, setElapsed] = useState(0);
  const [mapsOpen, setMapsOpen] = useState(false);
  const [saved, setSaved] = useState<SavedRoute[]>(() => savedRoutes.list());
  const [savedIds, setSavedIds] = useState<Record<number, string>>({});
  const mapRef = useRef<maplibregl.Map | null>(null);
  const sheet = useRef<HTMLDivElement>(null);
  const [sheetSize, setSheetSize] = useState({ w: 0, h: 0 });
  const [wide, setWide] = useState(() => matchMedia('(min-width: 900px)').matches);

  // --- settings & layout ---------------------------------------------------
  useEffect(() => {
    settings.set({ distanceKm: km, preferGreen, unpavedOk });
  }, [km, preferGreen, unpavedOk]);

  useEffect(() => {
    const mq = matchMedia('(min-width: 900px)');
    const on = () => setWide(mq.matches);
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);

  useLayoutEffect(() => {
    const el = sheet.current;
    if (!el) return;
    // h = how much of the screen the panel covers, measured from its top edge to the
    // bottom of the app, so padding for the phone's home bar is included
    const measure = () => {
      const r = el.getBoundingClientRect();
      const bottom = el.parentElement?.getBoundingClientRect().bottom ?? innerHeight;
      setSheetSize({ w: r.width, h: Math.max(0, bottom - r.top) });
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el, { box: 'border-box' });
    addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      removeEventListener('resize', measure);
    };
  }, [view.k]);

  // close the Garmin and Maps panels when switching screens or routes
  useEffect(() => {
    setMapsOpen(false);
  }, [view.k, active]);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

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
  }, []);

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
    map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
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

  const run = async (nextVariation: number) => {
    setProblem(null);
    if (!from) return setProblem({ kind: 'message', text: 'Choose where you start.' });
    if (!end) return setProblem({ kind: 'message', text: 'Choose where you finish, or switch on Loop.' });
    if (!(km >= MIN_KM && km <= MAX_KM)) return setProblem({ kind: 'message', text: `Distance must be between ${MIN_KM} and ${MAX_KM} km.` });
    setView({ k: 'planning' });
    setVariation(nextVariation);
    const t0 = Date.now();
    const tick = setInterval(() => setElapsed(Math.floor((Date.now() - t0) / 1000)), 250);
    try {
      const r = await plan({
        start: from.coord,
        end: end.coord,
        distanceKm: km,
        prefs: { unpavedOk, preferGreen },
        variation: nextVariation,
      });
      if (r.ok) {
        setRoutes(r.routes);
        setActive(0);
        setSavedIds({});
        setView({ k: 'results' });
      } else {
        setView({ k: 'edit' });
        setProblem(
          r.reason === 'too-short'
            ? { kind: 'too-short', shortestKm: r.shortestKm }
            : { kind: 'message', text: 'No route of this length found around these points. Try a slightly different distance or a nearby start.' },
        );
      }
    } catch {
      setView({ k: 'edit' });
      setProblem({ kind: 'message', text: 'The route service did not answer. Check your connection and try again in a moment.' });
    } finally {
      clearInterval(tick);
      setElapsed(0);
    }
  };

  // --- distance input ------------------------------------------------------
  const commitKm = (v: number) => {
    const clamped = Math.min(MAX_KM, Math.max(MIN_KM, Math.round(v * 10) / 10));
    setKm(clamped);
    setKmText(String(clamped));
    setProblem(null);
  };

  // --- export & save -------------------------------------------------------
  const routeName = (target: Place | null, meters: number) =>
    loop || !target ? `LONGCUT ${fmtKm(meters)} km loop` : `LONGCUT ${fmtKm(meters)} km to ${target.name}`;

  const doExport = async (
    coords: LngLat[],
    elevations: (number | null)[],
    meters: number,
    target: Place | null,
  ) => {
    const name = routeName(target, meters);
    const outcome = await exportGpx(gpxFileName(meters / 1000, loop || !target ? 'loop' : target.name), toGpx(name, coords, elevations));
    if (outcome === 'downloaded') setToast('GPX saved to your downloads.');
  };

  const saveActive = () => {
    const r = routes[active];
    if (!r || !from || !end) return;
    if (savedIds[active]) {
      setSaved(savedRoutes.remove(savedIds[active]));
      setSavedIds(({ [active]: _, ...rest }) => rest);
      setToast('Removed from saved routes.');
      return;
    }
    // "Current location" means nothing later on: keep the street name instead
    const named = (p: Place) => (p.name === 'Current location' && p.detail ? { ...p, name: p.detail, detail: '' } : p);
    const s = savedRoutes.add({
      from: named(from),
      to: named(end),
      requestedKm: km,
      lengthM: r.stats.length,
      ascent: r.stats.ascent,
      coords: r.coords,
      elevations: r.elevations,
    });
    if (!s) return setToast('Could not save: storage on this device is full or blocked.');
    setSaved(savedRoutes.list());
    setSavedIds((ids) => ({ ...ids, [active]: s.id }));
    setToast('Saved. Find it under Saved.');
  };

  // --- pick on map ---------------------------------------------------------
  const confirmPick = async (field: Field) => {
    const map = mapRef.current;
    if (!map) return;
    const c = map.getCenter();
    const place = await reverseGeocode([c.lng, c.lat]);
    if (field === 'from') setFrom(place);
    else {
      setTo(place);
      setLoop(false);
    }
    setView({ k: 'edit' });
  };

  const choose = (field: Field, p: Place) => {
    if (field === 'from') setFrom(p);
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
  if (view.k === 'results') mapRoutes = routes;
  if (view.k === 'savedRoute') {
    mapRoutes = [{ coords: view.route.coords }];
    mapStart = view.route.from.coord;
    mapEnd = view.route.to.coord;
  }
  const pad = wide
    ? { top: 48, bottom: 48, left: sheetSize.w + 64, right: 48 }
    : { top: 88, bottom: sheetSize.h + 24, left: 32, right: 32 };

  const r = routes[active];
  const isLoopNow = loop || (from && to && from.coord[0] === to.coord[0] && from.coord[1] === to.coord[1]);

  return (
    <div className={`app view-${view.k}`}>
      <MapView
        routes={mapRoutes}
        active={view.k === 'results' ? active : 0}
        start={view.k === 'pick' ? null : mapStart}
        end={view.k === 'pick' ? null : mapEnd}
        padding={pad}
        onReady={(m) => {
          mapRef.current = m;
          (window as unknown as { __longcutMap?: unknown }).__longcutMap = m; // handy for testing
        }}
        onSelectRoute={(i) => setActive(i)}
        me={gps ? { coord: gps, accuracy } : null}
      />

      {view.k !== 'search' && (
        <button
          type="button"
          className="locate-btn"
          aria-label="Show my location"
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
            <span className={`dot ${view.field === 'from' ? 'dot-start' : 'dot-end'}`} />
          </div>
          <div className="sheet pick-sheet" ref={sheet}>
            <p className="pick-text">Move the map until the dot is on your {view.field === 'from' ? 'start' : 'finish'}.</p>
            <div className="row-2">
              <button type="button" className="btn ghost" onClick={() => setView({ k: 'search', field: view.field })}>
                Cancel
              </button>
              <button type="button" className="btn primary" onClick={() => confirmPick(view.field)}>
                Set {view.field === 'from' ? 'start' : 'finish'}
              </button>
            </div>
          </div>
        </>
      )}

      {view.k === 'search' && (
        <PlaceSearch
          title={view.field === 'from' ? 'Start' : 'Finish'}
          near={gps ?? from?.coord ?? null}
          canUseLocation={'geolocation' in navigator}
          onPick={(p) => choose(view.field, p)}
          onUseLocation={() => {
            if (gps) choose(view.field, { name: 'Current location', detail: '', coord: gps });
            else {
              if (view.field === 'from') setFrom(null);
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
          className="sheet edit-sheet"
          ref={sheet as React.RefObject<HTMLFormElement & HTMLDivElement>}
          onSubmit={(e) => {
            e.preventDefault();
            run(0);
          }}
        >
          <div className="fields">
            <div className="field-stack">
              <button type="button" className="field" onClick={() => setView({ k: 'search', field: 'from' })}>
                <span className="dot dot-start" aria-hidden="true" />
                <span className="field-text">
                  <span className="field-label">Start</span>
                  <span className={`field-value ${from ? '' : 'empty'}`}>{from ? from.name : 'Choose start'}</span>
                </span>
              </button>
              <button
                type="button"
                className="field"
                onClick={() => (loop ? setLoop(false) : setView({ k: 'search', field: 'to' }))}
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
                className={`icon-btn toggle ${loop ? 'on' : ''}`}
                aria-label="Loop: finish where you start"
                aria-pressed={loop}
                onClick={() => {
                  setLoop(!loop);
                  setProblem(null);
                }}
              >
                <Icon name="loop" />
              </button>
            </div>
          </div>

          <div className="distance-row">
            <label htmlFor="km" className="field-label">
              Distance
            </label>
            <div className="stepper">
              <button type="button" className="step" aria-label="1 km less" onClick={() => commitKm(Math.ceil(km) - 1)}>
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
                    if (!Number.isNaN(v)) setKm(v);
                  }}
                  onBlur={() => commitKm(parseFloat(kmText.replace(',', '.')) || km)}
                  aria-describedby="km-unit"
                />
                <span id="km-unit" className="km-unit">km</span>
              </div>
              <button type="button" className="step" aria-label="1 km more" onClick={() => commitKm(Math.floor(km) + 1)}>
                <Icon name="plus" />
              </button>
            </div>
          </div>

          <div className="prefs">
            <Segmented
              label="Surface"
              value={unpavedOk}
              onChange={setUnpavedOk}
              options={[
                [false, 'Mostly paved'],
                [true, 'Trails welcome'],
              ]}
            />
            <Segmented
              label="Scenery"
              value={preferGreen}
              onChange={setPreferGreen}
              options={[
                [false, 'Any'],
                [true, 'Parks & forest'],
              ]}
            />
          </div>

          {problem && (
            <div className="problem" role="alert">
              {problem.kind === 'too-short' ? (
                <>
                  <p>
                    The shortest route is already <b>{problem.shortestKm.toFixed(1)} km</b>, longer than {km} km.
                  </p>
                  <button type="button" className="btn small" onClick={() => commitKm(Math.ceil(problem.shortestKm * 1.02))}>
                    Use {Math.ceil(problem.shortestKm * 1.02)} km
                  </button>
                </>
              ) : (
                <p>{problem.text}</p>
              )}
            </div>
          )}

          <button type="submit" className="btn primary big">
            Plan {km} km {isLoopNow ? 'loop' : 'route'}
          </button>
        </form>
      )}

      {view.k === 'planning' && (
        <div className="sheet planning-sheet" ref={sheet} role="status" aria-live="polite">
          <div className="progress" aria-hidden="true">
            <span />
          </div>
          <p className="planning-title">Finding your longcut</p>
          <p className="hint">
            Trying detours for {km} km{elapsed >= 3 ? ` · ${elapsed}s` : ''}
          </p>
        </div>
      )}

      {view.k === 'results' && r && (
        <div className="sheet results-sheet" ref={sheet}>
          <div className="sheet-head">
            <button type="button" className="link-btn" onClick={() => setView({ k: 'edit' })}>
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
            </div>
          </div>

          <div className="headline">
            <div className="big-km">
              <b>{fmtKm(r.stats.length)}</b>
              <span>km</span>
            </div>
          </div>

          <dl className="stats">
            <div>
              <dt>Busy</dt>
              <dd className={r.stats.busyShare > 0.05 ? 'warn' : ''}>{pct(r.stats.busyShare)}</dd>
            </div>
            <div>
              <dt>Unpaved</dt>
              <dd>{pct(r.stats.unpavedShare)}</dd>
            </div>
            <div>
              <dt>Twice</dt>
              <dd>{pct(r.stats.overlapShare)}</dd>
            </div>
            <div>
              <dt>Climb</dt>
              <dd>{r.stats.ascent} m</dd>
            </div>
          </dl>
          <ElevationSpark coords={r.coords} elevations={r.elevations} />

          <button type="button" className="btn primary big" onClick={() => doExport(r.coords, r.elevations, r.stats.length, end)}>
            <Icon name="download" /> Send GPX to Garmin
          </button>
          <div className="row-3">
            <button type="button" className={`btn ghost ${savedIds[active] ? 'on' : ''}`} aria-pressed={!!savedIds[active]} onClick={saveActive}>
              <Icon name="bookmark" /> {savedIds[active] ? 'Saved' : 'Save'}
            </button>
            <button type="button" className="btn ghost" aria-expanded={mapsOpen} onClick={() => setMapsOpen(!mapsOpen)}>
              <Icon name="map" /> Maps
            </button>
            <button type="button" className="btn ghost" onClick={() => run(variation + 1)}>
              <Icon name="again" /> New routes
            </button>
          </div>
          {mapsOpen && (
            <div className="maps-menu">
              <a className="btn ghost" href={googleMapsUrl(r.coords)} target="_blank" rel="noreferrer">
                Google Maps
              </a>
              <a className="btn ghost" href={appleMapsUrl(r.coords)} target="_blank" rel="noreferrer">
                Apple Maps
              </a>
              <p className="hint">Maps apps take only a few points, so the route there is close but not exact. Use GPX for the exact route.</p>
            </div>
          )}
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
            <ul className="saved-list">
              {saved.map((s) => (
                <li key={s.id}>
                  <button type="button" className="saved-item" onClick={() => setView({ k: 'savedRoute', route: s })}>
                    <span className="saved-km">{fmtKm(s.lengthM)}</span>
                    <span className="saved-text">
                      <span className="place-name">
                        {s.from.name} → {s.from.coord[0] === s.to.coord[0] && s.from.coord[1] === s.to.coord[1] ? 'loop' : s.to.name}
                      </span>
                      <span className="place-detail">{new Date(s.savedAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {view.k === 'savedRoute' && (
        <div className="sheet results-sheet" ref={sheet}>
          <div className="sheet-head">
            <button type="button" className="link-btn" onClick={() => setView({ k: 'saved' })}>
              <Icon name="back" size={18} /> Saved
            </button>
          </div>
          <div className="headline">
            <div className="big-km">
              <b>{fmtKm(view.route.lengthM)}</b>
              <span>km</span>
            </div>
            <span className="dev">
              {view.route.from.name} → {view.route.to.name}
            </span>
          </div>
          <ElevationSpark coords={view.route.coords} elevations={view.route.elevations} />
          <button
            type="button"
            className="btn primary big"
            onClick={() => doExport(view.route.coords, view.route.elevations, view.route.lengthM, view.route.to)}
          >
            <Icon name="download" /> Send GPX to Garmin
          </button>
          <div className="row-2">
            <a className="btn ghost" href={googleMapsUrl(view.route.coords)} target="_blank" rel="noreferrer">
              <Icon name="map" /> Google Maps
            </a>
            <button
              type="button"
              className="btn ghost danger"
              onClick={() => {
                setSaved(savedRoutes.remove(view.route.id));
                setView({ k: 'saved' });
                setToast('Route deleted.');
              }}
            >
              <Icon name="trash" /> Delete
            </button>
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
