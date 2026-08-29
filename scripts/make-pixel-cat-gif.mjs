/**
 * Builds src/assets/pixel-cat-ball.gif — a looping 8-bit cat batting a ball.
 * Run: node scripts/make-pixel-cat-gif.mjs
 */
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const W = 32;
const H = 24;
const COLORS = [
  [0, 0, 0],
  [18, 18, 18],
  [232, 120, 95],
  [244, 212, 184],
  [193, 74, 52],
  [240, 192, 64],
  [255, 243, 160],
  [255, 255, 255],
  [232, 154, 138],
  [106, 74, 48],
];

const MAP = {
  '.': 0,
  k: 1,
  o: 2,
  c: 3,
  d: 4,
  y: 5,
  h: 6,
  w: 7,
  p: 8,
  n: 9,
};

const CAT = [
  '.kk....kk.....',
  'kook..kook....',
  'konk..knok....',
  '.koppook......',
  '.koodookk.....',
  'koooooooook...',
  'kcooooooock...',
  '.kcooooockk...',
  '..kooooook....',
  '..kd.kd.kk....',
  '..kk.kk.......',
];

const CAT_BAT = [
  '.kk....kk.....',
  'kook..kook....',
  'konk..knok....',
  '.koppook......',
  '.koodookk.....',
  'koooooooookkk.',
  'kcoooooock..k.',
  '.kcooooockk.k.',
  '..kooooookkkk.',
  '..kd.kd.kk....',
  '..kk.kk.......',
];

const BALL = [
  '.hyh.',
  'hyyyh',
  'hyyyy',
  '.yyy.',
  '..n..',
];

function blank() {
  return new Uint8Array(W * H);
}

function blit(canvas, rows, x, y) {
  for (let row = 0; row < rows.length; row++) {
    const line = rows[row];
    for (let col = 0; col < line.length; col++) {
      const px = x + col;
      const py = y + row;
      if (px < 0 || py < 0 || px >= W || py >= H) continue;
      const idx = MAP[line[col]];
      if (idx) canvas[py * W + px] = idx;
    }
  }
}

const BALL_PATH = [
  [22, 16],
  [23, 12],
  [24, 8],
  [25, 5],
  [24, 4],
  [23, 7],
  [22, 11],
  [21, 16],
];

const frames = BALL_PATH.map(([bx, by], i) => {
  const canvas = blank();
  blit(canvas, i === 2 || i === 3 || i === 4 ? CAT_BAT : CAT, 1, 6);
  blit(canvas, BALL, bx, by);
  return canvas;
});

function writeCodesFixed(minCodeSize, indexes) {
  const clear = 1 << minCodeSize;
  const eoi = clear + 1;
  let codeSize = minCodeSize + 1;
  let nextCode = eoi + 1;
  const dict = new Map();
  const bytes = [];
  let acc = 0;
  let bits = 0;

  const emit = (code) => {
    acc |= code << bits;
    bits += codeSize;
    while (bits >= 8) {
      bytes.push(acc & 255);
      acc >>= 8;
      bits -= 8;
    }
  };

  const reset = () => {
    dict.clear();
    codeSize = minCodeSize + 1;
    nextCode = eoi + 1;
  };

  const codeOf = (phrase) => (phrase.length === 1 ? phrase.charCodeAt(0) : dict.get(phrase));

  emit(clear);
  let phrase = String.fromCharCode(indexes[0]);
  for (let i = 1; i < indexes.length; i++) {
    const ch = String.fromCharCode(indexes[i]);
    const joined = phrase + ch;
    if (dict.has(joined)) {
      phrase = joined;
      continue;
    }
    emit(codeOf(phrase));
    if (nextCode < 4096) {
      dict.set(joined, nextCode);
      if (nextCode === 1 << codeSize && codeSize < 12) codeSize += 1;
      nextCode += 1;
    } else {
      emit(clear);
      reset();
    }
    phrase = ch;
  }
  emit(codeOf(phrase));
  emit(eoi);
  if (bits) bytes.push(acc & 255);
  return Uint8Array.from(bytes);
}

function u16(n) {
  return [n & 255, (n >> 8) & 255];
}

function encodeGif(frameList) {
  const minCodeSize = 4;
  const out = [];
  out.push(71, 73, 70, 56, 57, 97);
  out.push(...u16(W), ...u16(H), 0xf3, 0, 0);
  for (let i = 0; i < 16; i++) {
    const rgb = COLORS[i] || [0, 0, 0];
    out.push(rgb[0], rgb[1], rgb[2]);
  }
  out.push(0x21, 0xff, 0x0b, ...Buffer.from('NETSCAPE2.0'), 3, 1, ...u16(0), 0);
  for (const frame of frameList) {
    out.push(0x21, 0xf9, 0x04, 0x09, ...u16(12), 0, 0);
    out.push(0x2c, ...u16(0), ...u16(0), ...u16(W), ...u16(H), 0);
    const packed = writeCodesFixed(minCodeSize, frame);
    out.push(minCodeSize);
    for (let i = 0; i < packed.length; i += 255) {
      const chunk = packed.subarray(i, i + 255);
      out.push(chunk.length, ...chunk);
    }
    out.push(0);
  }
  out.push(0x3b);
  return Buffer.from(out);
}

const dest = join(dirname(fileURLToPath(import.meta.url)), '..', 'src', 'assets', 'pixel-cat-ball.gif');
writeFileSync(dest, encodeGif(frames));
console.log(`wrote ${dest} (${frames.length} frames, ${W}x${H})`);
