// Common pipe, hose and thread sizes an adapter end can be set to.
// d: diameter of the mating part in mm. For threads, d is the major diameter.

export interface Fitting {
  d: number;
  fit: 'inside' | 'over';
  /** Parallel pipe thread (ISO 228, "G"): pitch in mm, male or female on the adapter. */
  thread?: { pitch: number; male: boolean };
}

const g = (d: number, tpi: number, male: boolean): Fitting => ({ d, fit: male ? 'inside' : 'over', thread: { pitch: 25.4 / tpi, male } });

export const FITTINGS: Record<string, Fitting> = {
  // Garden and general hoses, by inner diameter: the adapter plugs in
  hose13: { d: 13, fit: 'inside' },
  hose16: { d: 16, fit: 'inside' },
  hose19: { d: 19, fit: 'inside' },
  hose25: { d: 25, fit: 'inside' },
  hose32: { d: 32, fit: 'inside' },
  // G threads, as on taps, garden fittings and pumps
  g14m: g(13.157, 19, true),
  g38m: g(16.662, 19, true),
  g12m: g(20.955, 14, true),
  g34m: g(26.441, 14, true),
  g1m: g(33.249, 11, true),
  g14f: g(13.157, 19, false),
  g38f: g(16.662, 19, false),
  g12f: g(20.955, 14, false),
  g34f: g(26.441, 14, false),
  g1f: g(33.249, 11, false),
  // HT drain pipe, by outer diameter: the adapter slides over
  ht32: { d: 32, fit: 'over' },
  ht40: { d: 40, fit: 'over' },
  ht50: { d: 50, fit: 'over' },
  ht75: { d: 75, fit: 'over' },
  ht110: { d: 110, fit: 'over' },
  // PVC pressure pipe, by outer diameter
  pvc20: { d: 20, fit: 'over' },
  pvc25: { d: 25, fit: 'over' },
  pvc32: { d: 32, fit: 'over' },
  pvc40: { d: 40, fit: 'over' },
  pvc50: { d: 50, fit: 'over' },
  // Vacuum cleaner nozzles and dust extraction ports, by outer diameter
  vac32: { d: 32, fit: 'over' },
  vac35: { d: 35, fit: 'over' },
  vac38: { d: 38, fit: 'over' },
  dust50: { d: 50, fit: 'over' },
  dust63: { d: 63, fit: 'over' },
  dust100: { d: 100, fit: 'over' },
};
