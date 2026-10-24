import { describe, expect, it } from 'vitest';
import { accumulate, topoOrder } from '../src/worldgen/flow';
import { assertAcyclic } from '../src/worldgen/hydrology';
import { checkHydrology, orderViolations } from '../src/qa/metrics';
import { QA_SEEDS, world } from './worlds';

describe('flow order', () => {
  it('topoOrder puts every receiver before its donors on a hand-made graph', () => {
    // 0 is the outlet; 3 → 1 → 0, 2 → 0, 4 → 3.
    const receiver = Int32Array.from([-1, 0, 0, 1, 3]);
    const { order, position } = topoOrder(receiver, null);
    expect(order.length).toBe(5);
    for (let c = 0; c < 5; c++) if (receiver[c] >= 0) expect(position[receiver[c]]).toBeLessThan(position[c]);
    const acc = accumulate(order, receiver, new Float32Array(5).fill(1));
    expect(Array.from(acc)).toEqual([5, 3, 1, 2, 1]);
  });

  it('a pop order that is valid for the flood tree breaks once receivers are rerouted', () => {
    // Pop order 0,1,2,3 is valid while 1, 2 and 3 all drain to 0. Rerouting 1 → 3 (as the lake
    // outlet BFS does) leaves the pop order wrong, while topoOrder still finds a valid order.
    const pop = Int32Array.from([0, 1, 2, 3]);
    expect(orderViolations(pop, Int32Array.from([-1, 0, 0, 0]))).toBe(0);
    const receiver = Int32Array.from([-1, 3, 0, 0]);
    expect(orderViolations(pop, receiver)).toBeGreaterThan(0);
    const { order } = topoOrder(receiver, null);
    expect(orderViolations(order, receiver)).toBe(0);
  });

  it('detects cycles instead of silently dropping cells', () => {
    const receiver = Int32Array.from([-1, 2, 1]); // 1 ↔ 2
    const { position } = topoOrder(receiver, null);
    expect(() => assertAcyclic(position, null, 'test')).toThrow(/cycle/);
  });
});

describe('hydrology invariants on 20 QA seeds', () => {
  it.each(QA_SEEDS)('%s', (seed) => {
    const report = checkHydrology(world(seed));
    expect(report.problems).toEqual([]);
    expect(report.lakesWithoutOutlet).toBe(0);
    expect(report.crossings).toBe(0);
  });

  it('pop order of the flood is not a valid topological order on real maps (why topoOrder exists)', () => {
    // Diagnostic: if this ever reaches 0 everywhere the explicit order is still correct, just redundant.
    const total = QA_SEEDS.reduce((sum, s) => sum + checkHydrology(world(s)).popOrderViolations, 0);
    expect(total).toBeGreaterThan(0);
  });
});
