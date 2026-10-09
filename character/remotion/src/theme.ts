import {loadFont as loadDisplay} from '@remotion/google-fonts/BricolageGrotesque';
import {loadFont as loadText} from '@remotion/google-fonts/InstrumentSans';
import {CAT} from './cat/catParts';
import {littermatePalettes} from './cat/palettes';

const display = loadDisplay('normal', {weights: ['600', '800'], subsets: ['latin']});
const text = loadText('normal', {weights: ['400', '600'], subsets: ['latin']});

export const FONT = {
  display: `${display.fontFamily}, "Arial Rounded MT Bold", system-ui, sans-serif`,
  text: `${text.fontFamily}, "Helvetica Neue", system-ui, sans-serif`,
};

/** Colors come straight from the cat. */
export const COLOR = {
  paper: '#F9F6E7',
  paperDeep: '#F3EBD3',
  ...CAT.palette,
  ink: '#4A2E26',
  muted: '#8A6E62',
  hush: '#B7A8E8',
};

/** Ghost cursors are the same cat in their own colors (SPEC-04: littermates), from the design tokens. */
export const LITTERMATES = littermatePalettes();
