import tokens from '../../../design/tokens.json';
import type {Palette} from './YumiCat';

type CatColors = {fur: string; markings: string; line: string; cheeks: string};

/** A design-token cat palette in the shape YumiCat draws with. */
export const toPalette = (c: CatColors): Palette => ({orange: c.fur, cream: c.markings, line: c.line, blush: c.cheeks});

export type LittermateName = keyof typeof tokens.cat.littermates;

/** The ghost littermates, in the order ghosts take them. */
export const littermatePalettes = () =>
  Object.fromEntries(Object.entries(tokens.cat.littermates).map(([k, v]) => [k, toPalette(v)])) as Record<LittermateName, Palette>;
