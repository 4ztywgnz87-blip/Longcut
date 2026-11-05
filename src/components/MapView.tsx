import { useEffect, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// Bundle the map's background worker with its dependencies and tell the library where it is.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url';

maplibregl.setWorkerUrl(workerUrl);
import type { LngLat } from '../core/geo';
import type { RoadKind } from '../core/types';
import type { Feature, FeatureCollection } from 'geojson';

export interface MapRoute {
  coords: LngLat[];
  roads?: RoadKind[];
}

interface Props {
  routes: MapRoute[];
  active: number;
  start: LngLat | null;
  end: LngLat | null;
  /** Bottom space covered by the panel, so routes are fitted above it. */
  padding: { top: number; bottom: number; left: number; right: number };
  onReady?: (map: maplibregl.Map) => void;
  onSelectRoute?: (index: number) => void;
  /** The user's own position (blue dot), with GPS accuracy in meters. */
  me?: { coord: LngLat; accuracy: number } | null;
}

const STYLE = 'https://tiles.openfreemap.org/styles/dark';
const EMPTY: FeatureCollection = { type: 'FeatureCollection', features: [] };
const HOME: LngLat = [4.18, 51.19]; // Waasland

function cssVar(name: string, fallback: string) {
  return getComputedStyle(document.documentElement).getPropertyValue(name).trim() || fallback;
}

export default function MapView({ routes, active, start, end, padding, onReady, onSelectRoute, me }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const loaded = useRef(false);
  const latest = useRef({ routes, active, start, end, padding });
  latest.current = { routes, active, start, end, padding };
  const selectRef = useRef(onSelectRoute);
  selectRef.current = onSelectRoute;
  const meRef = useRef(me);
  meRef.current = me;

  useEffect(() => {
    if (!el.current) return;
    const map = new maplibregl.Map({
      container: el.current,
      style: STYLE,
      center: start ?? HOME,
      zoom: 11.5,
      attributionControl: { compact: true },
      pitchWithRotate: false,
      dragRotate: false,
    });
    map.touchZoomRotate.disableRotation();
    mapRef.current = map;

    map.on('load', () => {
      const accent = cssVar('--accent', '#D7FF3A');
      const alt = cssVar('--route-alt', '#8A8A99');
      const busy = cssVar('--busy', '#FF5A4E');
      for (const id of ['alt', 'main']) {
        map.addSource(id, { type: 'geojson', data: EMPTY });
        map.addLayer({
          id: `${id}-casing`, type: 'line', source: id,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: { 'line-color': '#000', 'line-width': id === 'main' ? 9 : 7, 'line-opacity': 0.55 },
        });
        map.addLayer({
          id, type: 'line', source: id,
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: id === 'main'
            ? { 'line-color': accent, 'line-width': 5 }
            : { 'line-color': alt, 'line-width': 3.5, 'line-opacity': 0.85 },
        });
      }
      map.addSource('busy', { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: 'busy', type: 'line', source: 'busy',
        layout: { 'line-cap': 'round' },
        paint: { 'line-color': busy, 'line-width': 5 },
      });
      map.addSource('pts', { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: 'pts', type: 'circle', source: 'pts',
        paint: {
          'circle-radius': 8,
          'circle-color': ['match', ['get', 'k'], 'start', '#FFFFFF', '#111113'],
          'circle-stroke-color': '#FFFFFF',
          'circle-stroke-width': 3,
        },
      });
      // your own position: blue dot with a soft accuracy circle, like Google Maps
      map.addSource('me', { type: 'geojson', data: EMPTY });
      map.addLayer({
        id: 'me-accuracy', type: 'circle', source: 'me',
        paint: { 'circle-color': '#4C8DFF', 'circle-opacity': 0.15, 'circle-stroke-color': '#4C8DFF', 'circle-stroke-opacity': 0.3, 'circle-stroke-width': 1, 'circle-radius': 0 },
      });
      map.addLayer({
        id: 'me', type: 'circle', source: 'me',
        paint: { 'circle-radius': 7, 'circle-color': '#4C8DFF', 'circle-stroke-color': '#FFFFFF', 'circle-stroke-width': 2.5 },
      });
      // tapping an alternative selects it
      map.on('click', 'alt', (e) => {
        const i = e.features?.[0]?.properties?.i;
        if (typeof i === 'number') selectRef.current?.(i);
      });
      map.on('mouseenter', 'alt', () => (map.getCanvas().style.cursor = 'pointer'));
      map.on('mouseleave', 'alt', () => (map.getCanvas().style.cursor = ''));
      // start with the attribution collapsed to the (i) button
      el.current?.querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
      loaded.current = true;
      draw(map, latest.current, true);
      drawMe(map, meRef.current);
      onReady?.(map);
    });
    return () => {
      loaded.current = false;
      map.remove();
      mapRef.current = null;
    };
    // the map is created once; later prop changes are handled below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Redraw on any change; fit the view when the routes, points or the panel size change.
  const padKey = `${Math.round(padding.bottom / 20)}|${Math.round(padding.left / 20)}`;
  const fitKey = `${routes.map((r) => r.coords.length).join(',')}|${start}|${end}|${padKey}`;
  const lastFit = useRef('');
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !loaded.current) return;
    const refit = lastFit.current !== fitKey;
    lastFit.current = fitKey;
    draw(map, latest.current, refit);
  }, [routes, active, start, end, fitKey]);

  useEffect(() => {
    if (mapRef.current && loaded.current) drawMe(mapRef.current, me ?? null);
  }, [me]);

  return <div ref={el} className="map" aria-label="Map" />;
}

function drawMe(map: maplibregl.Map, me: Props['me']) {
  const src = map.getSource('me') as maplibregl.GeoJSONSource | undefined;
  if (!src) return;
  src.setData(me ? { type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: me.coord } } : EMPTY);
  if (!me) return;
  // meters → pixels: one pixel covers 78271.517·cos(lat) / 2^zoom meters
  const atZoom0 = me.accuracy / (78271.517 * Math.cos((me.coord[1] * Math.PI) / 180));
  map.setPaintProperty('me-accuracy', 'circle-radius', ['interpolate', ['exponential', 2], ['zoom'], 0, atZoom0, 22, atZoom0 * 2 ** 22]);
}

function draw(map: maplibregl.Map, s: Omit<Props, 'onReady' | 'onSelectRoute'>, fit: boolean) {
  const line = (coords: LngLat[], props: Record<string, unknown> = {}): Feature => ({
    type: 'Feature', properties: props, geometry: { type: 'LineString', coordinates: coords },
  });
  const main = s.routes[s.active];
  (map.getSource('main') as maplibregl.GeoJSONSource).setData(main ? line(main.coords) : EMPTY);
  (map.getSource('alt') as maplibregl.GeoJSONSource).setData({
    type: 'FeatureCollection',
    features: s.routes.map((r, i) => (i === s.active ? null : line(r.coords, { i }))).filter(Boolean) as Feature[],
  });

  const busy: Feature[] = [];
  if (main?.roads) {
    // join consecutive busy pieces into one line
    let run: LngLat[] = [];
    main.roads.forEach((road, i) => {
      if (road === 'main' || road === 'secondary') {
        if (!run.length) run.push(main.coords[i]);
        run.push(main.coords[i + 1]);
      } else if (run.length) {
        busy.push(line(run));
        run = [];
      }
    });
    if (run.length) busy.push(line(run));
  }
  (map.getSource('busy') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: busy });

  const pts: Feature[] = [];
  if (s.end) pts.push({ type: 'Feature', properties: { k: 'end' }, geometry: { type: 'Point', coordinates: s.end } });
  if (s.start) pts.push({ type: 'Feature', properties: { k: 'start' }, geometry: { type: 'Point', coordinates: s.start } });
  (map.getSource('pts') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: pts });

  if (!fit) return;
  // MapLibre adds padding from earlier camera moves to new ones, so start from zero.
  map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
  // Keep the padding smaller than the map itself, or MapLibre refuses to fit.
  const c = map.getContainer();
  const scaleY = Math.min(1, (c.clientHeight - 120) / Math.max(1, s.padding.top + s.padding.bottom));
  const scaleX = Math.min(1, (c.clientWidth - 120) / Math.max(1, s.padding.left + s.padding.right));
  const padding = {
    top: s.padding.top * scaleY,
    bottom: s.padding.bottom * scaleY,
    left: s.padding.left * scaleX,
    right: s.padding.right * scaleX,
  };
  const all: LngLat[] = [...s.routes.flatMap((r) => r.coords), ...(s.start ? [s.start] : []), ...(s.end ? [s.end] : [])];
  if (!all.length) return;
  if (all.length === 1 || (s.routes.length === 0 && s.start && s.end && s.start[0] === s.end[0] && s.start[1] === s.end[1])) {
    map.easeTo({ center: all[0], zoom: Math.max(map.getZoom(), 13), padding, duration: 600 });
    return;
  }
  const b = new maplibregl.LngLatBounds(all[0], all[0]);
  all.forEach((c) => b.extend(c));
  map.fitBounds(b, { padding, duration: 700, maxZoom: 15 });
}
