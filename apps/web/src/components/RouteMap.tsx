import { useState } from 'react';
import { absoluteUrl } from '../lib/api';
import type { RouteWeather } from '../lib/types';

interface Props {
  mapUrl: string;
  weather: RouteWeather;
}

/**
 * The route drawn as a single static image, coloured by the weather you will
 * meet along it.
 *
 * It renders inside the "why" drawer rather than on the answer card, so the
 * headline stays the hero and this stays evidence. Because the drawer is
 * closed by default, the image is only ever fetched by someone who asked to
 * see it - most sessions never pay for it at all.
 */
export function RouteMap({ mapUrl, weather }: Props) {
  const [state, setState] = useState<'loading' | 'ready' | 'failed'>('loading');

  if (state === 'failed') return null;

  const hasWet = weather.samples.some((sample) => sample.wet);

  return (
    <div className="why__block">
      <h3 className="why__title">Your route</h3>

      <figure className="route-map">
        {state === 'loading' && <span className="route-map__placeholder" aria-hidden="true" />}

        <img
          className={`route-map__image${state === 'ready' ? ' is-ready' : ''}`}
          src={absoluteUrl(mapUrl)}
          alt={`Map of your route. ${weather.summary}`}
          loading="lazy"
          decoding="async"
          width={640}
          height={360}
          onLoad={() => setState('ready')}
          onError={() => setState('failed')}
        />

        <figcaption className="route-map__legend">
          <span className="route-map__key">
            <span className="route-map__swatch route-map__swatch--dry" />
            Clear
          </span>
          {hasWet && (
            <span className="route-map__key">
              <span className="route-map__swatch route-map__swatch--wet" />
              Rain expected
            </span>
          )}
        </figcaption>
      </figure>
    </div>
  );
}
