import { describe, expect, it } from 'vitest';
import { ridgeMetrics } from '../src/qa/metrics';
import { QA_SEEDS, world } from './worlds';

// The ridge graph comes from the inverted heightmap. These checks compare it against the forward
// hydrology, computed independently: real crests are drainage divides and never carry rivers.
describe('ridge graph plausibility on 20 QA seeds', () => {
  it.each(QA_SEEDS)('%s', (seed) => {
    const m = ridgeMetrics(world(seed));
    expect(m.ridgeCells).toBeGreaterThan(50);
    expect(m.heightLift, 'ridges should sit above the average high ground').toBeGreaterThan(0.04);
    expect(m.coherence, 'ridge cells should be cross-section maxima').toBeGreaterThanOrEqual(0.75);
    expect(m.onDivide, 'ridge cells should lie on drainage divides').toBeGreaterThanOrEqual(0.93);
    expect(m.onRiver, 'ridges should not run along rivers').toBeLessThanOrEqual(0.02);
    expect(m.uphillSteps, 'paths should climb towards the summit').toBeGreaterThanOrEqual(0.8);
  });

  it('every peak is the highest cell within peakRadius', () => {
    for (const seed of QA_SEEDS) {
      const w = world(seed);
      const n = w.config.size, R = w.config.peakRadius, H = w.hydro.height;
      for (const p of w.ridges.peaks) {
        const px = p.cell % n, py = Math.floor(p.cell / n);
        for (let dy = -R; dy <= R; dy++) {
          for (let dx = -R; dx <= R; dx++) {
            const x = px + dx, y = py + dy;
            if (x < 0 || y < 0 || x >= n || y >= n || dx * dx + dy * dy > R * R || (dx === 0 && dy === 0)) continue;
            expect(H[y * n + x]).toBeLessThanOrEqual(p.height);
          }
        }
      }
    }
  });
});
