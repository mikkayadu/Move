const { strict: assert } = require('node:assert');
const { describe, it } = require('node:test');
const { haversineMeters, pointsAlongRoute } = require('../dist/common/geo.util');

/**
 * Route sampling is what makes Move's weather claim true rather than
 * decorative, so the "midpoint is actually the midpoint" property is worth
 * pinning down.
 */
describe('haversineMeters', () => {
  it('measures a known distance', () => {
    // Accra Central to Achimota, roughly 9 km apart.
    const metres = haversineMeters([-0.1969, 5.556], [-0.2296, 5.6197]);
    assert.ok(metres > 7000 && metres < 9000, `expected ~8 km, got ${Math.round(metres)} m`);
  });

  it('returns zero for a point measured against itself', () => {
    assert.equal(haversineMeters([-0.1969, 5.556], [-0.1969, 5.556]), 0);
  });
});

describe('pointsAlongRoute', () => {
  it('returns the endpoints exactly', () => {
    const geometry = [
      [0, 0],
      [0, 1],
      [0, 2],
    ];
    const [start, end] = pointsAlongRoute(geometry, [0, 1]);

    assert.deepEqual([start.lon, start.lat], [0, 0]);
    assert.deepEqual([end.lon, end.lat], [0, 2]);
  });

  it('samples by distance, not by vertex index', () => {
    // Vertices are deliberately bunched at the start, as a real routing
    // provider does around junctions. Index-based sampling would put the
    // midpoint at [0, 0.02]; distance-based sampling must put it near [0, 1].
    const geometry = [
      [0, 0],
      [0, 0.01],
      [0, 0.02],
      [0, 2],
    ];
    const [middle] = pointsAlongRoute(geometry, [0.5]);

    assert.ok(
      Math.abs(middle.lat - 1) < 0.01,
      `expected the midpoint near lat 1, got ${middle.lat}`,
    );
  });

  it('clamps fractions outside 0-1', () => {
    const geometry = [
      [0, 0],
      [0, 2],
    ];
    const [low, high] = pointsAlongRoute(geometry, [-3, 9]);

    assert.equal(low.fraction, 0);
    assert.equal(high.fraction, 1);
  });

  it('survives a degenerate route where every vertex is identical', () => {
    const geometry = [
      [1, 1],
      [1, 1],
    ];
    const points = pointsAlongRoute(geometry, [0, 0.5, 1]);

    assert.equal(points.length, 3);
    for (const point of points) {
      assert.deepEqual([point.lon, point.lat], [1, 1]);
    }
  });

  it('returns nothing for empty geometry', () => {
    assert.deepEqual(pointsAlongRoute([], [0, 1]), []);
  });
});
