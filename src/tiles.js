// The eight tile types: names, colours, how often they turn up, and a one-line rule
// for the logbook. The scoring itself lives in scoring.js.

export const PALETTE = {
  paper: '#f4ecd8',
  ink: '#2b2a33',
  sea: '#7fa7b5',
  meadow: '#a8c38a',
  forest: '#5f7f5a',
  field: '#e2c77a',
  roof: '#c46a4a',
  sand: '#e9dcb5',
  stone: '#b9ae9a',
  wood: '#9a7656',
  cream: '#fbf5e6',
  dusk: '#8a7fa6',
};

export const TILE_TYPES = ['meadow', 'forest', 'field', 'cottage', 'harbour', 'lighthouse', 'windmill', 'market'];

export const TILES = {
  meadow: {
    name: 'Meadow',
    color: PALETTE.meadow,
    weight: 17,
    directional: false,
    pattern: 'dots',
    emoji: '🌿',
    rule: '1 point, +1 if it touches the sea. Cottages love meadows.',
  },
  forest: {
    name: 'Forest',
    color: PALETTE.forest,
    weight: 15,
    directional: false,
    pattern: 'cross',
    emoji: '🌲',
    rule: '1 point, +1 for each Forest next to it.',
  },
  field: {
    name: 'Field',
    color: PALETTE.field,
    weight: 15,
    directional: false,
    pattern: 'diagonal',
    emoji: '🌾',
    rule: '2 points. Windmills turn fields into more.',
  },
  cottage: {
    name: 'Cottage',
    color: PALETTE.roof,
    weight: 16,
    directional: true,
    front: 'door',
    pattern: 'bricks',
    emoji: '🏠',
    rule: '1 point, +1 per Meadow, +2 per Market next to it. Door facing a Meadow or Market: +1.',
  },
  harbour: {
    name: 'Harbour',
    color: PALETTE.wood,
    weight: 9,
    directional: true,
    front: 'pier',
    pattern: 'waves',
    emoji: '⚓',
    rule: 'Must touch water. 2 points, +1 per Cottage or Market next to it. Pier facing water: +2.',
  },
  lighthouse: {
    name: 'Lighthouse',
    color: PALETTE.cream,
    weight: 5,
    directional: true,
    front: 'lamp',
    pattern: 'rings',
    emoji: '🗼',
    rule: 'Keeps the tide off the coast within 2 hexes. 1 point, +1 per water side (max 3). Lamp facing water: +1.',
  },
  windmill: {
    name: 'Windmill',
    color: PALETTE.stone,
    weight: 7,
    directional: false,
    pattern: 'xcross',
    emoji: '🌀',
    rule: '2 points for each Field next to it.',
  },
  market: {
    name: 'Market',
    color: '#d9a35c',
    weight: 8,
    directional: true,
    front: 'awning',
    pattern: 'checks',
    emoji: '🧺',
    rule: '1 point for each different kind of tile next to it. Awning facing a Cottage: +1.',
  },
};

export const FRONT_LABEL = {
  door: 'door',
  pier: 'pier',
  lamp: 'lamp',
  awning: 'awning',
};
