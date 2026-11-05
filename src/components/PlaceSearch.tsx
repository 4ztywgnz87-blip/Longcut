import { useEffect, useRef, useState } from 'react';
import type { LngLat } from '../core/geo';
import type { Place } from '../lib/geocode';
import { searchPlaces } from '../lib/geocode';
import { favorites } from '../lib/storage';
import { Icon } from './Icon';

interface Props {
  title: string; // "Start" or "Finish"
  near: LngLat | null;
  canUseLocation: boolean;
  onPick: (p: Place) => void;
  onUseLocation: () => void;
  onPickOnMap: () => void;
  onClose: () => void;
}

export default function PlaceSearch({ title, near, canUseLocation, onPick, onUseLocation, onPickOnMap, onClose }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [favs, setFavs] = useState<Place[]>(() => favorites.list());
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => input.current?.focus(), []);

  // Your position changes all the time while the GPS is on; it should only bias the
  // ranking, not restart a search that is still running.
  const nearRef = useRef(near);
  nearRef.current = near;

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      setStatus('idle');
      return;
    }
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      setStatus('loading');
      setResults([]);
      try {
        await searchPlaces(query, nearRef.current ?? undefined, ctl.signal, setResults);
        if (!ctl.signal.aborted) setStatus('idle');
      } catch {
        if (!ctl.signal.aborted) setStatus('error');
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [query]);

  const toggleFav = (p: Place) => setFavs(favorites.toggle(p));
  const isFav = (p: Place) => favs.some((f) => f.coord[0] === p.coord[0] && f.coord[1] === p.coord[1]);

  const row = (p: Place, key: string) => (
    <li key={key} className="place-row">
      <button type="button" className="place-main" onClick={() => onPick(p)}>
        <span className="place-name">{p.name}</span>
        {p.detail && <span className="place-detail">{p.detail}</span>}
      </button>
      <button
        type="button"
        className={`icon-btn star ${isFav(p) ? 'on' : ''}`}
        aria-label={isFav(p) ? `Remove ${p.name} from favorites` : `Add ${p.name} to favorites`}
        aria-pressed={isFav(p)}
        onClick={() => toggleFav(p)}
      >
        <Icon name={isFav(p) ? 'star-filled' : 'star'} />
      </button>
    </li>
  );

  return (
    <div className="search" role="dialog" aria-label={`Choose ${title.toLowerCase()}`}>
      <div className="search-bar">
        <button type="button" className="icon-btn" aria-label="Back" onClick={onClose}>
          <Icon name="back" />
        </button>
        <input
          id="place-query"
          ref={input}
          type="search"
          placeholder={`${title}: address or place`}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          autoComplete="off"
          enterKeyHint="search"
        />
      </div>

      <div className="search-body">
        {query.trim().length < 2 && (
          <ul className="quick">
            {canUseLocation && (
              <li>
                <button type="button" className="quick-btn" onClick={onUseLocation}>
                  <Icon name="locate" /> Current location
                </button>
              </li>
            )}
            <li>
              <button type="button" className="quick-btn" onClick={onPickOnMap}>
                <Icon name="pin" /> Choose on map
              </button>
            </li>
          </ul>
        )}

        {status === 'loading' && results.length === 0 && <p className="hint">Searching…</p>}
        {status === 'error' && <p className="hint error">Search is not responding. Check your connection and try again.</p>}
        {status === 'idle' && query.trim().length >= 2 && results.length === 0 && (
          <p className="hint">No places found in Belgium for “{query.trim()}”.</p>
        )}
        {results.length > 0 && <ul className="places">{results.map((p, i) => row(p, `r${i}`))}</ul>}

        {query.trim().length < 2 && (
          <>
            <h3 className="list-title">Favorites</h3>
            {favs.length ? (
              <ul className="places">{favs.map((p, i) => row(p, `f${i}`))}</ul>
            ) : (
              <p className="hint">Tap the star next to a search result to keep it here, like home or your parents’ place.</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
