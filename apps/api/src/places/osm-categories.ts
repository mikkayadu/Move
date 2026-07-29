/**
 * Ranking and labelling for OpenStreetMap results.
 *
 * OSM answers a name query with everything carrying that name: the mall, the
 * bus stop outside it, its car park, and its food court all match "Accra
 * Mall". A person searching for a destination means the mall. These tiers
 * encode that, so the thing you would actually travel to floats to the top.
 */

/** Lower is better. */
export const enum Tier {
  Destination = 0,
  Ordinary = 1,
  Incidental = 2,
}

/** `osm_key/osm_value` pairs people actually navigate to. */
const DESTINATION_VALUES: Record<string, string[]> = {
  aeroway: ['aerodrome', 'terminal'],
  amenity: [
    'university',
    'college',
    'school',
    'hospital',
    'clinic',
    'marketplace',
    'bus_station',
    'townhall',
    'library',
    'theatre',
    'cinema',
    'place_of_worship',
    'courthouse',
    'embassy',
    'conference_centre',
  ],
  shop: ['mall', 'supermarket', 'department_store'],
  tourism: ['hotel', 'hostel', 'guest_house', 'museum', 'attraction'],
  leisure: ['park', 'stadium', 'sports_centre'],
  place: ['city', 'town', 'suburb', 'village', 'neighbourhood', 'quarter', 'borough'],
  railway: ['station'],
};

/** Things that share a name with a real destination but are not the point. */
const INCIDENTAL_KEYS = new Set(['highway', 'man_made', 'landuse', 'barrier', 'natural']);
const INCIDENTAL_VALUES = new Set(['parking', 'atm', 'bench', 'toilets', 'waste_basket', 'bicycle_parking']);

export function tierFor(osmKey: string | undefined, osmValue: string | undefined): Tier {
  if (!osmKey) return Tier.Ordinary;

  if (DESTINATION_VALUES[osmKey]?.includes(osmValue ?? '')) return Tier.Destination;
  if (INCIDENTAL_KEYS.has(osmKey)) return Tier.Incidental;
  if (INCIDENTAL_VALUES.has(osmValue ?? '')) return Tier.Incidental;

  return Tier.Ordinary;
}

const LABELS: Record<string, string> = {
  'shop/mall': 'Shopping mall',
  'shop/supermarket': 'Supermarket',
  'shop/department_store': 'Department store',
  'amenity/university': 'University',
  'amenity/college': 'College',
  'amenity/school': 'School',
  'amenity/hospital': 'Hospital',
  'amenity/clinic': 'Clinic',
  'amenity/pharmacy': 'Pharmacy',
  'amenity/bank': 'Bank',
  'amenity/restaurant': 'Restaurant',
  'amenity/cafe': 'Cafe',
  'amenity/fuel': 'Petrol station',
  'amenity/marketplace': 'Market',
  'amenity/place_of_worship': 'Place of worship',
  'amenity/bus_station': 'Bus station',
  'amenity/parking': 'Car park',
  'amenity/library': 'Library',
  'amenity/townhall': 'Town hall',
  'aeroway/aerodrome': 'Airport',
  'aeroway/terminal': 'Airport terminal',
  'tourism/hotel': 'Hotel',
  'tourism/hostel': 'Hostel',
  'tourism/guest_house': 'Guest house',
  'tourism/museum': 'Museum',
  'tourism/attraction': 'Attraction',
  'leisure/park': 'Park',
  'leisure/stadium': 'Stadium',
  'leisure/sports_centre': 'Sports centre',
  'office/government': 'Government office',
  'railway/station': 'Railway station',
  'highway/bus_stop': 'Bus stop',
  'place/city': 'City',
  'place/town': 'Town',
  'place/village': 'Village',
  'place/suburb': 'Suburb',
  'place/neighbourhood': 'Neighbourhood',
  'place/quarter': 'Neighbourhood',
  'boundary/administrative': 'Area',
};

export function labelFor(osmKey?: string, osmValue?: string): string | undefined {
  if (!osmKey || !osmValue) return undefined;

  const exact = LABELS[`${osmKey}/${osmValue}`];
  if (exact) return exact;

  if (osmKey === 'shop') return 'Shop';
  if (osmKey === 'office') return 'Office';
  if (osmKey === 'highway') return 'Road';

  // Fall back to the raw OSM value, tidied: "fast_food" -> "Fast food".
  const words = osmValue.replace(/_/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
}
