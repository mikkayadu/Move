import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { fetchJson } from '../common/http.util';
import { haversineMeters } from '../common/geo.util';
import { labelFor, Tier, tierFor } from './osm-categories';
import type { Coordinates, Place } from '../common/geo.types';

/**
 * Two results with the same name closer together than this are the same
 * place described twice, e.g. the mall and its car park.
 */
const DUPLICATE_RADIUS_METRES = 400;

interface PhotonFeature {
  geometry?: { coordinates?: [number, number] };
  properties?: {
    name?: string;
    osm_key?: string;
    osm_value?: string;
    countrycode?: string;
    country?: string;
    state?: string;
    county?: string;
    city?: string;
    district?: string;
    locality?: string;
    suburb?: string;
    street?: string;
    housenumber?: string;
    postcode?: string;
  };
}

interface PhotonResponse {
  features?: PhotonFeature[];
}

interface MapboxGeocodeResponse {
  features: Array<{
    properties: {
      name?: string;
      full_address?: string;
      place_formatted?: string;
      coordinates?: { longitude: number; latitude: number };
    };
    geometry?: { coordinates: [number, number] };
  }>;
}

/**
 * Place search and reverse geocoding, backed by OpenStreetMap through Photon.
 *
 * This is a different provider from the routing one on purpose. Mapbox routes
 * Ghana well but barely knows it: searching "Accra Mall" returns the locality
 * of Mallam, "University of Ghana" returns the country, and "Achimota" and
 * "Presec" return nothing at all. OpenStreetMap has all of them, because it is
 * mapped by people who live there.
 *
 * Photon is used rather than Nominatim because it is built for type-ahead and
 * returns richer results, and like Open-Meteo it needs no API key.
 */
@Injectable()
export class PlacesService {
  private readonly logger = new Logger(PlacesService.name);

  constructor(private readonly config: ConfigService) {}

  private get timeout(): number {
    return this.config.get<number>('upstreamTimeoutMs') ?? 8000;
  }

  private get search(): { countryCode: string; bbox: string; photonUrl: string } {
    return (
      this.config.get<{ countryCode: string; bbox: string; photonUrl: string }>('search') ?? {
        countryCode: 'GH',
        bbox: '-3.26,4.71,1.21,11.18',
        photonUrl: 'https://photon.komoot.io',
      }
    );
  }

  /**
   * Free-text destination search, confined to the configured country and
   * biased toward the user's current position.
   */
  async searchPlaces(query: string, near?: Coordinates, limit = 6): Promise<Place[]> {
    try {
      const places = await this.searchPhoton(query, near, limit);
      if (places.length > 0) return places;

      this.logger.debug(`Photon had nothing for "${query}"; trying the routing geocoder.`);
    } catch (error) {
      this.logger.warn(`Photon search failed, falling back to Mapbox: ${String(error)}`);
    }

    // Mapbox knows far less of Ghana, but a thin answer beats an empty box.
    return this.searchMapbox(query, near, limit).catch((error) => {
      this.logger.warn(`Mapbox fallback search also failed: ${String(error)}`);
      return [];
    });
  }

  /** Turns a raw GPS fix into something we can show the user by name. */
  async describeLocation(point: Coordinates): Promise<Place> {
    const fallback: Place = {
      name: 'Current location',
      address: 'Your current position',
      ...point,
    };

    try {
      const url = new URL('/reverse', this.search.photonUrl);
      url.searchParams.set('lat', String(point.lat));
      url.searchParams.set('lon', String(point.lon));
      url.searchParams.set('limit', '1');
      url.searchParams.set('lang', 'en');

      const response = await fetchJson<PhotonResponse>(url.toString(), {
        source: 'photon-reverse',
        timeoutMs: this.timeout,
        retries: 0,
      });

      const place = this.toPlace(response.features?.[0]);
      // Keep the real coordinates: the nearest named feature may be metres away.
      return place ? { ...place, ...point } : fallback;
    } catch (error) {
      this.logger.warn(`Reverse geocode failed, using raw coordinates: ${String(error)}`);
      return fallback;
    }
  }

  private async searchPhoton(
    query: string,
    near: Coordinates | undefined,
    limit: number,
  ): Promise<Place[]> {
    const url = new URL('/api', this.search.photonUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('lang', 'en');
    // Ask for extra, because ranking and de-duplication both discard rows.
    url.searchParams.set('limit', String(limit * 4));
    url.searchParams.set('bbox', this.search.bbox);
    if (near) {
      url.searchParams.set('lat', String(near.lat));
      url.searchParams.set('lon', String(near.lon));
    }

    const response = await fetchJson<PhotonResponse>(url.toString(), {
      source: 'photon',
      timeoutMs: this.timeout,
    });

    return this.rank(response.features ?? [], limit);
  }

  /**
   * Turns raw OSM hits into a list a person can choose from.
   *
   * The bounding box is a geographic filter, so places just over the border
   * slip through; the country code is the actual restriction. After that,
   * results are ordered by how destination-like they are while preserving
   * Photon's relevance order inside each tier, and near-duplicates sharing a
   * name are collapsed.
   */
  private rank(features: PhotonFeature[], limit: number): Place[] {
    const wanted = this.search.countryCode.toUpperCase();

    const scored = features
      .filter((feature) => (feature.properties?.countrycode ?? '').toUpperCase() === wanted)
      .flatMap((feature) => {
        const place = this.toPlace(feature);
        if (!place) return [];
        return [{ place, tier: tierFor(feature.properties?.osm_key, feature.properties?.osm_value) }];
      });

    const kept: Array<{ place: Place; tier: Tier }> = [];

    for (const tier of [Tier.Destination, Tier.Ordinary, Tier.Incidental]) {
      for (const entry of scored.filter((item) => item.tier === tier)) {
        const duplicate = kept.some(
          (existing) =>
            normalise(existing.place.name) === normalise(entry.place.name) &&
            haversineMeters(
              [existing.place.lon, existing.place.lat],
              [entry.place.lon, entry.place.lat],
            ) < DUPLICATE_RADIUS_METRES,
        );

        if (!duplicate) kept.push(entry);
        if (kept.length >= limit) return kept.map((item) => item.place);
      }
    }

    return kept.map((item) => item.place);
  }

  private toPlace(feature: PhotonFeature | undefined): Place | null {
    const properties = feature?.properties;
    const coordinates = feature?.geometry?.coordinates;

    if (!properties?.name || !coordinates) return null;
    const [lon, lat] = coordinates;
    if (typeof lon !== 'number' || typeof lat !== 'number') return null;

    const area =
      properties.suburb ??
      properties.district ??
      properties.locality ??
      properties.city ??
      properties.county;

    const address = [
      [properties.housenumber, properties.street].filter(Boolean).join(' ') || undefined,
      area,
      properties.state,
    ]
      .filter(Boolean)
      .join(', ');

    return {
      name: properties.name,
      address: address || properties.country || properties.name,
      category: labelFor(properties.osm_key, properties.osm_value),
      lat,
      lon,
    };
  }

  /** Last resort when OpenStreetMap is unreachable. */
  private async searchMapbox(
    query: string,
    near: Coordinates | undefined,
    limit: number,
  ): Promise<Place[]> {
    const token = this.config.get<string>('mapboxAccessToken');
    if (!token) return [];

    const url = new URL('https://api.mapbox.com/search/geocode/v6/forward');
    url.searchParams.set('q', query);
    url.searchParams.set('access_token', token);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('country', this.search.countryCode.toLowerCase());
    if (near) url.searchParams.set('proximity', `${near.lon},${near.lat}`);

    const response = await fetchJson<MapboxGeocodeResponse>(url.toString(), {
      source: 'mapbox-geocode',
      timeoutMs: this.timeout,
      retries: 0,
    });

    return (response.features ?? []).flatMap((feature) => {
      const lon = feature.properties.coordinates?.longitude ?? feature.geometry?.coordinates?.[0];
      const lat = feature.properties.coordinates?.latitude ?? feature.geometry?.coordinates?.[1];
      if (typeof lon !== 'number' || typeof lat !== 'number') return [];

      const name = feature.properties.name ?? 'Unnamed place';
      return [
        {
          name,
          address: feature.properties.full_address ?? feature.properties.place_formatted ?? name,
          lat,
          lon,
        },
      ];
    });
  }
}

function normalise(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
}
