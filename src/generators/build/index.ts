import type { GeneratorId, Params } from '../types';
import { buildAdapter } from './adapter';
import type { Build } from './common';
import { buildCutter } from './cutter';
import { buildEnclosure } from './enclosure';
import { buildGear } from './gear';
import { buildGridfinity } from './gridfinity';
import { buildHingeGenerator } from './hinge';
import { buildHook } from './hook';
import { buildLithophane } from './lithophane';
import { buildOrganizer } from './organizer';
import { buildQr } from './qr';
import { buildRelief } from './relief';
import { buildText } from './text';

export const BUILDERS: Record<GeneratorId, (p: Params) => Build> = {
  enclosure: (p) => buildEnclosure(p as never),
  adapter: (p) => buildAdapter(p as never),
  organizer: (p) => buildOrganizer(p as never),
  gridfinity: (p) => buildGridfinity(p as never),
  hook: (p) => buildHook(p as never),
  text: (p) => buildText(p as never),
  gear: (p) => buildGear(p as never),
  qr: (p) => buildQr(p as never),
  relief: (p) => buildRelief(p as never),
  cutter: (p) => buildCutter(p as never),
  lithophane: (p) => buildLithophane(p as never),
  hinge: (p) => buildHingeGenerator(p as never),
};

export * from './common';
export { loadedFonts } from './text';
