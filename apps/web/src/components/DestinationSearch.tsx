import { useEffect, useId, useRef, useState } from 'react';
import { api } from '../lib/api';
import { SearchIcon } from './icons';
import type { Coordinates, Place } from '../lib/types';

interface Props {
  near: Coordinates | null;
  disabled?: boolean;
  onPick: (place: Place) => void;
}

const DEBOUNCE_MS = 280;

/**
 * Type-ahead destination picker.
 *
 * Debounced rather than per-keystroke because every request is a paid geocoder
 * call over what may be a slow mobile link, and because a list that reshuffles
 * on every character is harder to hit with a thumb.
 */
export function DestinationSearch({ near, disabled, onPick }: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listId = useId();
  const latestQuery = useRef('');

  useEffect(() => {
    const trimmed = query.trim();
    latestQuery.current = trimmed;

    if (trimmed.length < 3) {
      setResults([]);
      setError(null);
      return;
    }

    setSearching(true);
    const timer = setTimeout(async () => {
      try {
        const places = await api.searchPlaces(trimmed, near ?? undefined);
        // A slower earlier request must not overwrite newer results.
        if (latestQuery.current !== trimmed) return;
        setResults(places);
        setError(places.length === 0 ? 'No places matched that search.' : null);
      } catch {
        if (latestQuery.current !== trimmed) return;
        setError('Could not reach the search service.');
        setResults([]);
      } finally {
        if (latestQuery.current === trimmed) setSearching(false);
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query, near]);

  const choose = (place: Place): void => {
    setQuery('');
    setResults([]);
    onPick(place);
  };

  return (
    <div className="search">
      <div className="search__field">
        <SearchIcon className="search__icon" />
        <input
          type="search"
          className="search__input"
          placeholder="Where are you going?"
          value={query}
          disabled={disabled}
          onChange={(event) => setQuery(event.target.value)}
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          enterKeyHint="search"
          aria-label="Destination"
          aria-controls={listId}
          aria-expanded={results.length > 0}
        />
        {searching && <span className="search__spinner" aria-label="Searching" />}
      </div>

      {error && <p className="search__error">{error}</p>}

      {results.length > 0 && (
        <ul className="search__results" id={listId} role="listbox">
          {results.map((place) => (
            <li key={`${place.lat},${place.lon},${place.name}`}>
              <button type="button" className="search__result" onClick={() => choose(place)}>
                <span className="search__result-top">
                  <span className="search__result-name">{place.name}</span>
                  {place.category && (
                    <span className="search__result-kind">{place.category}</span>
                  )}
                </span>
                <span className="search__result-address">{place.address}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
