import type { GeneratorId, Params } from '../types';
import { buildAdapter } from './adapter';
import type { Build } from './common';
import { buildEnclosure } from './enclosure';
import { buildOrganizer } from './organizer';

export const BUILDERS: Record<GeneratorId, (p: Params) => Build> = {
  enclosure: (p) => buildEnclosure(p as never),
  adapter: (p) => buildAdapter(p as never),
  organizer: (p) => buildOrganizer(p as never),
};

export * from './common';
