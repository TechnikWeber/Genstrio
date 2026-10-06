import type { GeneratorId, Params } from '../types';
import { buildAdapter } from './adapter';
import type { Build } from './common';
import { buildEnclosure } from './enclosure';
import { buildGridfinity } from './gridfinity';
import { buildHook } from './hook';
import { buildOrganizer } from './organizer';
import { buildText } from './text';

export const BUILDERS: Record<GeneratorId, (p: Params) => Build> = {
  enclosure: (p) => buildEnclosure(p as never),
  adapter: (p) => buildAdapter(p as never),
  organizer: (p) => buildOrganizer(p as never),
  gridfinity: (p) => buildGridfinity(p as never),
  hook: (p) => buildHook(p as never),
  text: (p) => buildText(p as never),
};

export * from './common';
export { loadedFonts } from './text';
