#!/usr/bin/env node
/* Generates assets/chat-bg.svg: an original, seamlessly tiling sheet of line-art doodles
   used as the chat wallpaper. Run: node tools/make-doodles.js */
'use strict';

const fs = require('fs');
const path = require('path');

const W = 374, H = 666; // tile size in px; doodles are drawn in a 24x24 box

const c = (x, y, r) => `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0`;
const rr = (x, y, w, h, r) =>
  `M${x + r} ${y}h${w - 2 * r}a${r} ${r} 0 0 1 ${r} ${r}v${h - 2 * r}a${r} ${r} 0 0 1 ${-r} ${r}h${-(w - 2 * r)}a${r} ${r} 0 0 1 ${-r} ${-r}v${-(h - 2 * r)}a${r} ${r} 0 0 1 ${r} ${-r}z`;

// Every doodle is a list of stroke paths inside a 24x24 box.
const DOODLES = {
  heart: ['M12 20C4 14 3 9 6 6.5C8.5 4.5 11 5.5 12 8C13 5.5 15.5 4.5 18 6.5C21 9 20 14 12 20Z'],
  star: ['M12 3L14.6 9L21 9.6L16.2 13.9L17.6 20.3L12 17L6.4 20.3L7.800 13.9L3 9.6L9.4 9Z'],
  bubble: [rr(3, 4, 18, 13, 4), 'M8 17L6.5 21L12 17', 'M8 9H16M8 12.5H13'],
  camera: [rr(3, 7, 18, 13, 3), 'M8 7L9.5 4.500H14.5L16 7', c(12, 13.5, 3.8), c(17.5, 10, 0.5)],
  handset: ['M6 4C4.5 4 3.5 5 4 7C5.5 13 11 18.5 17 20C19 20.500 20 19.5 20 18V16L16 14.500L14.5 16.5C11.5 15.5 8.5 12.5 7.5 9.5L9.5 8L8 4Z'],
  mobile: [rr(7, 2.5, 10, 19, 2.5), 'M10.5 18.500H13.5', 'M10 5.5H14'],
  note: ['M9 18V6L19 4V16', c(6.5, 18, 2.5), c(16.5, 16, 2.5), 'M9 9.500L19 7.500'],
  cup: ['M5 8H16V14A5 5 0 0 1 11 19H10A5 5 0 0 1 5 14Z', 'M16 9.500H18A2.5 2.5 0 0 1 18 14.500H16', 'M8 5Q9 3.500 8 2M12 5Q13 3.500 12 2'],
  pizza: ['M4 6Q12 2 20 6L12 21Z', 'M5.5 9Q12 6 18.5 9', c(10, 12, 1.2), c(13.5, 10.5, 1), c(12, 16, 1)],
  plane: ['M3 11L21 3L14 21L11 13Z', 'M11 13L21 3'],
  umbrella: ['M3 12A9 9 0 0 1 21 12Z', 'M12 12V19A2 2 0 0 1 8 19', 'M12 3V2', 'M9 12Q9 6 12 3Q15 6 15 12'],
  sun: [c(12, 12, 4), 'M12 2.5V5M12 19V21.500M2.5 12H5M19 12H21.500M5.3 5.300L7 7M17 17L18.7 18.700M18.7 5.300L17 7M7 17L5.3 18.700'],
  moon: ['M19 14.500A8 8 0 1 1 9.5 5A6.5 6.500 0 0 0 19 14.500Z', 'M17 4V7M15.5 5.500H18.5'],
  cloud: ['M7 18A4 4 0 0 1 7 10A5.5 5.500 0 0 1 17.6 11A3.5 3.500 0 0 1 17 18Z'],
  bolt: ['M13 2L5 13H11L10 22L19 10H13Z'],
  gift: [rr(4, 10, 16, 10, 1.5), rr(3, 6.5, 18, 3.5, 1), 'M12 6.500V20', 'M12 6.500C9 2 6 4 8 6.500M12 6.500C15 2 18 4 16 6.500'],
  balloon: ['M12 3A6 7 0 0 1 12 17A6 7 0 0 1 12 3Z', 'M12 17L11 19H13Z', 'M12 19Q10 20.500 12 22.500'],
  bike: [c(6, 16, 4), c(18, 16, 4), 'M6 16L10 8H15L18 16', 'M10 8L13 16H6', 'M14 5.500H17', 'M9 8H11'],
  cat: ['M5 9V3L10 6Q12 5.500 14 6L19 3V9Q21 16 12 20Q3 16 5 9Z', c(9, 11, 0.6), c(15, 11, 0.6), 'M11 14L12 15L13 14', 'M3 13L7 13.500M21 13L17 13.500'],
  fish: ['M3 12Q9 5 16 12Q9 19 3 12Z', 'M16 12L21 8V16Z', c(7, 11, 0.5), 'M10 9.500Q11.5 12 10 14.500'],
  icecream: ['M7 10A5 5 0 0 1 17 10Z', 'M7 10L12 22L17 10', 'M9 14L14.5 16M11 18.500L15.5 12.500'],
  key: [c(7, 12, 4), 'M11 12H21M17 12V15M20 12V14.500', c(6, 12, 0.8)],
  bulb: ['M8 14A6 6 0 1 1 16 14Q15 15 15 17H9Q9 15 8 14Z', 'M9.5 19.500H14.5M10.5 22H13.5', 'M10 11L12 13L14 11'],
  mail: [rr(3, 5, 18, 14, 2), 'M3 7L12 13.500L21 7'],
  book: ['M12 6Q8 3.500 3 5V19Q8 17.500 12 20Q16 17.500 21 19V5Q16 3.500 12 6Z', 'M12 6V20', 'M6 9H9M6 12H9M15 9H18M15 12H18'],
  glasses: [c(7, 13, 3.5), c(17, 13, 3.5), 'M10.5 13Q12 11.500 13.5 13', 'M3.5 12L2 9M20.5 12L22 9'],
  headphones: ['M4 14A8 8 0 0 1 20 14', rr(3, 13, 4, 7, 1.5), rr(17, 13, 4, 7, 1.5)],
  rocket: ['M12 2Q17 7 15 16H9Q7 7 12 2Z', c(12, 9, 1.8), 'M9 13L5.5 17L9 16M15 13L18.5 17L15 16', 'M11 19L12 22L13 19'],
  leaf: ['M5 19Q4 8 19 5Q20 18 8 19Z', 'M5 19L14 10', 'M9 15H13M10.5 11.500V14'],
  flower: [c(12, 12, 2.5), c(12, 6.5, 2.8), c(17.2, 10.3, 2.8), c(15.2, 16.4, 2.8), c(8.8, 16.4, 2.8), c(6.8, 10.3, 2.8)],
  clock: [c(12, 12, 8.5), 'M12 7V12L15.5 14'],
  pencil: ['M4 20L5 15L16 4L20 8L9 19Z', 'M14 6L18 10M5 15L9 19'],
  gamepad: [rr(3, 8, 18, 10, 5), 'M7 11.500V14.500M5.5 13H8.5', c(15.5, 12, 0.7), c(17.5, 14, 0.7)],
  ball: [c(12, 12, 8.5), 'M12 8.500L15.3 10.900L14 14.800H10L8.7 10.900Z', 'M12 8.500V3.500M15.3 10.900L20 9.300M14 14.800L17 18.800M10 14.800L7 18.800M8.7 10.900L4 9.300'],
  cherry: [c(7.5, 17, 3.5), c(16.5, 16, 3.5), 'M7.5 13.500Q9 6 16 4Q14 9 16.5 12.500', 'M16 4Q19 3.500 20 6Q17 7 16 4'],
  crown: ['M3 18L4.5 7L9 12L12 5L15 12L19.5 7L21 18Z', 'M3 21H21'],
  gem: ['M6 4H18L22 9.500L12 21L2 9.500Z', 'M2 9.500H22M9 4L7.5 9.500L12 21L16.5 9.500L15 4'],
  anchor: [c(12, 5, 2), 'M12 7V21M5 13A7 8 0 0 0 19 13M8 10.500H16'],
  tree: ['M12 3L18 11H15L19.5 17H4.5L9 11H6Z', 'M12 17V21'],
  house: ['M3 11.500L12 4L21 11.500', 'M5.5 9.500V20H18.5V9.500', 'M10 20V14H14V20'],
  car: ['M3 16V12L6 11L8 7H16L18 11L21 12V16H19M5 16H3M10 16H14', c(7.5, 16.5, 2), c(16.5, 16.5, 2), 'M8.5 11H15.5'],
  smile: [c(12, 12, 8.5), c(9, 10, 0.6), c(15, 10, 0.6), 'M8 14Q12 18 16 14'],
  drop: ['M12 3Q19 12 17.5 16A5.8 5.800 0 0 1 6.5 16Q5 12 12 3Z', 'M9 15A3 3 0 0 0 12 18'],
  bell: ['M6 17V11A6 6 0 0 1 18 11V17L20 19H4Z', 'M10.5 21A1.5 1.500 0 0 0 13.5 21', 'M12 5V3.500'],
  scissors: [c(6, 7, 2.5), c(6, 17, 2.5), 'M8 8.500L20 17M8 15.500L20 7'],
  mic: [rr(9, 3, 6, 11, 3), 'M5.5 11A6.5 6.500 0 0 0 18.5 11', 'M12 17.500V21M9 21H15'],
  pin: ['M12 21Q5 13 5 9A7 7 0 0 1 19 9Q19 13 12 21Z', c(12, 9, 2.5)],
  donut: [c(12, 12, 8.5), c(12, 12, 3), 'M7 8L8 9M16 7L15 8.500M18 13H16.5M8 16L9 15M14 17.500L15 16.500'],
  burger: ['M4 11A8 6 0 0 1 20 11Z', 'M3.5 14H20.5', 'M5 17V18A2 2 0 0 0 7 20H17A2 2 0 0 0 19 18V17Z', 'M9 8V8.500M12 7V7.500M15 8V8.500'],
  wifi: ['M5 10A10 10 0 0 1 19 10', 'M8 13A6 6 0 0 1 16 13', c(12, 16.5, 1)],
  kite: ['M12 2L19 9L12 18L5 9Z', 'M12 2V18M5 9H19', 'M12 18Q10 20 12 22'],
  mushroom: ['M3 12A9 8 0 0 1 21 12Z', 'M9 12V18A3 3 0 0 0 15 18V12', c(8, 8.5, 1.2), c(14.5, 7, 1.4)],
  apple: ['M12 7C8 4 3 7 4 13C5 19 9 22 12 20C15 22 19 19 20 13C21 7 16 4 12 7Z', 'M12 7Q12 4 14 2', 'M14 4Q17 2.500 18 5Q15 6 14 4'],
  paw: [c(12, 15.5, 4), c(6, 10, 1.8), c(10, 6.5, 1.8), c(14.5, 6.5, 1.8), c(18.5, 10, 1.8)],
  boat: ['M3 15H21L18 20H6Z', 'M12 15V3L19 12H12', 'M12 5L7 12H12'],
  cactus: ['M10 21V6A2 2 0 0 1 14 6V21', 'M10 13H7A2 2 0 0 1 5 11V9M14 15H17A2 2 0 0 0 19 13V10', 'M7 21H17'],
  popsicle: [rr(7, 2.5, 10, 13, 5), 'M12 15.500V21.500', 'M10 6V11'],
  planet: [c(12, 12, 6), 'M5 15Q0 19 7 16.500Q16 13 21 8Q24 5 18.5 8'],
  tag: ['M3 12V4H11L21 14L14 21Z', c(7, 8, 1.3)],
  trophy: ['M7 4H17V10A5 5 0 0 1 7 10Z', 'M7 6H4Q4 10 7.5 11M17 6H20Q20 10 16.5 11', 'M12 15V19M8 20.500H16'],
};

// Small fillers for the gaps between doodles.
const FILLERS = [
  [c(12, 12, 1.6)],
  ['M12 9V15M9 12H15'],
  ['M12 8L13 11L16 12L13 13L12 16L11 13L8 12L11 11Z'],
  ['M8 12Q10 9 12 12T16 12'],
  [c(12, 12, 0.7)],
  ['M9 9L15 15M15 9L9 15'],
  ['M9 14L12 9L15 14Z'],
];

// Small deterministic PRNG so the sheet is the same on every run.
let seed = 20261111;
const rnd = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const shuffle = a => { for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const f = n => String(Math.round(n * 100) / 100);

const out = [];
function place(paths, cx, cy, scale, rot) {
  const half = 12 * scale * 1.45; // generous bounds, rotation included
  const xs = [0], ys = [0];
  if (cx - half < 0) xs.push(W); if (cx + half > W) xs.push(-W);
  if (cy - half < 0) ys.push(H); if (cy + half > H) ys.push(-H);
  for (const dx of xs) for (const dy of ys) {
    out.push(`<g transform="translate(${f(cx + dx)} ${f(cy + dy)}) rotate(${f(rot)}) scale(${f(scale)}) translate(-12 -12)" stroke-width="${f(1.15 / scale)}">` +
      paths.map(d => `<path d="${d}"/>`).join('') + '</g>');
  }
}

// Pack doodles like a hand-drawn sheet: a few large ones first, then medium and small ones
// wherever they fit, then tiny fillers in the leftover gaps. Distances wrap around the tile
// edges so the sheet repeats without a seam.
const placed = [];
const fits = (x, y, r) => placed.every(p => {
  let dx = Math.abs(p.x - x), dy = Math.abs(p.y - y);
  if (dx > W / 2) dx = W - dx;
  if (dy > H / 2) dy = H - dy;
  return dx * dx + dy * dy >= (p.r + r) * (p.r + r);
});
function scatter(pool, minScale, maxScale, pad, limit, rotRange) {
  let bag = [], misses = 0, count = 0;
  while (misses < 2600 && count < limit) {
    const scale = minScale + rnd() * (maxScale - minScale);
    const r = 12 * scale * 0.8 + pad;
    const x = rnd() * W, y = rnd() * H;
    if (!fits(x, y, r)) { misses++; continue; }
    if (!bag.length) bag = shuffle(pool.slice());
    placed.push({ x, y, r });
    place(bag.pop(), x, y, scale, (rnd() - 0.5) * rotRange);
    count++;
  }
  return count;
}

const all = Object.keys(DOODLES);
const detailed = ['camera', 'bike', 'book', 'burger', 'cat', 'car', 'gamepad', 'ball', 'donut', 'house', 'gift', 'rocket', 'cup',
  'flower', 'planet', 'boat', 'pizza', 'bubble', 'umbrella', 'trophy', 'mushroom', 'headphones', 'cherry', 'apple', 'sun'];
const big = scatter(detailed.map(n => DOODLES[n]), 2.1, 3, 1.5, 26, 50);
const mid = scatter(all.map(n => DOODLES[n]), 1.3, 1.75, 1, 400, 70);
const small = scatter(all.map(n => DOODLES[n]), 0.85, 1.1, 0.8, 400, 90);
const tiny = scatter(FILLERS, 0.5, 0.85, -2, 900, 360);
const total = big + mid + small;

const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round">` +
  out.join('') + '</svg>\n';
const file = path.join(__dirname, '..', 'assets', 'chat-bg.svg');
fs.writeFileSync(file, svg);
console.log('Wrote', path.relative(process.cwd(), file), '(' + Math.round(svg.length / 1024) + ' kB,', total, 'doodles,', tiny, 'fillers)');
