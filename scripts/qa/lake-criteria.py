"""Wave 2 lake criteria L2–L6 from analyze.ts output (L1, L7 come from the tests).
   python3 scripts/qa/lake-criteria.py qa-out/wave1/analysis/analysis.json qa-out/wave2-b2/analysis/analysis.json"""
import json, sys

def stats(path):
    seeds = json.load(open(path))
    lakes = [dict(L, seed=s['seed']) for s in seeds for L in s['lakes']]
    n = len(lakes)
    hooks = [L for L in lakes if L['solidity'] < 0.7]
    long_nat = [L for L in lakes if L['elongation'] >= 2.2 and L['solidity'] >= 0.75]
    valley = [L for L in lakes if L['kind'] == 'valley']
    valley_long = [L for L in valley if L['elongation'] >= 1.8]
    low_catch = [L for L in lakes if 'catchment' in L and L['catchment'] < 4 * L['area']]
    ratio = [L['renderedAreaRatio'] for L in lakes]
    out_ratio = [L for L in lakes if not 0.85 <= L['renderedAreaRatio'] <= 1.4]
    kinds = {k: sum(1 for L in lakes if L['kind'] == k) for k in ('mountain', 'valley', 'plain')}
    outlets = {}
    for L in lakes: outlets[L.get('outletType', '?')] = outlets.get(L.get('outletType', '?'), 0) + 1
    no_inflow = sum(1 for L in lakes if L['inflowRivers'] == 0)
    shallow = sum(1 for L in lakes if L['maxDepth'] < 0.02)
    area = sorted(L['area'] for L in lakes)
    return {
        'lakes': n, 'kinds': kinds, 'outletTypes': outlets,
        'L2_hooks': len(hooks), 'L2_hookShare': round(len(hooks) / max(1, n), 3),
        'L3_longNatural': len(long_nat),
        'L4_lowCatchment': len(low_catch) if 'catchment' in lakes[0] else None,
        'L5_outOfRange': [(L['seed'], L['id'], L['renderedAreaRatio']) for L in out_ratio],
        'L5_range': (min(ratio), max(ratio)),
        'L6_valleyLong': len(valley_long), 'valleyLakes': len(valley),
        'noInflowRiver': no_inflow, 'shallow_lt_0.02': shallow,
        'area_p10_p50_p90': (area[n // 10], area[n // 2], area[9 * n // 10]),
        'perSeed': {s['seed']: len(s['lakes']) for s in seeds},
    }

for p in sys.argv[1:]:
    print(p)
    for k, v in stats(p).items(): print(f'  {k}: {v}')
