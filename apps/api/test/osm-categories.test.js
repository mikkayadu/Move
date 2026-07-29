const { strict: assert } = require('node:assert');
const { describe, it } = require('node:test');
const { tierFor, labelFor } = require('../dist/places/osm-categories');

/**
 * OpenStreetMap answers a name query with everything carrying that name. A
 * search for "Accra Mall" returns the mall, the bus stop outside it, its car
 * park, and its food court. These tiers are what float the thing a person
 * would actually travel to above the furniture around it.
 */
describe('tierFor', () => {
  it('treats real destinations as the best tier', () => {
    assert.equal(tierFor('shop', 'mall'), 0);
    assert.equal(tierFor('amenity', 'university'), 0);
    assert.equal(tierFor('amenity', 'school'), 0);
    assert.equal(tierFor('amenity', 'hospital'), 0);
    assert.equal(tierFor('aeroway', 'aerodrome'), 0);
    assert.equal(tierFor('place', 'town'), 0);
  });

  it('demotes the furniture around a destination', () => {
    // These are exactly the rows that crowded out "Accra Mall" in testing.
    assert.equal(tierFor('highway', 'bus_stop'), 2);
    assert.equal(tierFor('amenity', 'parking'), 2);
    assert.equal(tierFor('amenity', 'atm'), 2);
    assert.equal(tierFor('landuse', 'forest'), 2);
    assert.equal(tierFor('man_made', 'adit'), 2);
  });

  it('puts anything unrecognised in the middle', () => {
    assert.equal(tierFor('amenity', 'something_new'), 1);
    assert.equal(tierFor('office', 'company'), 1);
    assert.equal(tierFor(undefined, undefined), 1);
  });

  it('ranks a school above a bus stop of the same name', () => {
    // The "Presec" case: the bus stop matches the query exactly, but the
    // school is what the user means.
    assert.ok(tierFor('amenity', 'school') < tierFor('highway', 'bus_stop'));
  });
});

describe('labelFor', () => {
  it('names the common Ghanaian destination types in plain English', () => {
    assert.equal(labelFor('shop', 'mall'), 'Shopping mall');
    assert.equal(labelFor('amenity', 'university'), 'University');
    assert.equal(labelFor('aeroway', 'aerodrome'), 'Airport');
    assert.equal(labelFor('place', 'town'), 'Town');
    assert.equal(labelFor('tourism', 'hostel'), 'Hostel');
  });

  it('falls back to a tidied OSM value', () => {
    assert.equal(labelFor('amenity', 'fast_food'), 'Fast food');
  });

  it('returns nothing when the type is unknown', () => {
    assert.equal(labelFor(undefined, undefined), undefined);
    assert.equal(labelFor('shop', undefined), undefined);
  });
});
