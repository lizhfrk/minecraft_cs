/**
 * 角色像素立绘：主菜单的角色卡片上画的小人。
 *
 * 头部的像素排布照着 MineCrasher 里的同名角色还原（8×8 网格），
 * 配色也来自那边的调色板；躯干则按各角色的标志性特征画：
 * 史蒂夫的青蓝衬衫加棕腰带、杰杰的红卫衣加白内衫、麦琪的龟壳横条纹。
 *
 * @module render/portrait
 */
import { CHARACTERS } from '../core/characters.js';

/** 头部网格宽（像素格）。 */
const HEAD_W = 8;
/** 头部网格高。 */
const HEAD_H = 8;
/** 躯干网格宽。 */
const BODY_W = 10;
/** 躯干网格高。 */
const BODY_H = 5;

/**
 * 史蒂夫的头：深棕发、单行眼睛、小胡子。
 * H=发 S=脸 W=眼白 I=虹膜 N=鼻 B=胡子
 */
const STEVE_HEAD = [
  'HHHHHHHH',
  'HHHHHHHH',
  'HSSSSSSH',
  'SSSSSSSS',
  'SWISSIWS',
  'SSSNNSSS',
  'SSBSSBSS',
  'SSBBBBSS',
];

/**
 * 杰杰的头：厚刘海、蓝色大眼。
 * H=发 S=脸 E=眼角高光 D=深瞳 I=浅瞳 W=眼白
 */
const JIEJIE_HEAD = [
  'HHHHHHHH',
  'HHHHHHHH',
  'HHHHHHHH',
  'HHHHSSSH',
  'HEDSSIEH',
  'HWISSIWH',
  'SSSSSSSS',
  'SSSSSSSS',
];

/**
 * 麦琪的头：绿色龟头、黑眼、红嘴。
 * D=暗绿边 G=绿 K=黑 M=红嘴
 */
const MAIQI_HEAD = [
  'DGGGGGGD',
  'DGGGGGGD',
  'DGGGGGGD',
  'DGGGGGGD',
  'KGGGGGGK',
  'GGKKKKGG',
  'GGGKMMGG',
  'GGGGGGGG',
];

/**
 * 每个角色的「网格字符 → 调色板键」对照。
 * 同一个字母在不同角色里含义不同（杰杰的 D 是深瞳、麦琪的 D 是暗绿边），所以分开写。
 */
const HEAD_KEYS = {
  steve: {
    H: 'hair',
    S: 'skin',
    W: 'eyeWhite',
    I: 'eyeIris',
    N: 'skinDk',
    B: 'beard',
  },
  jiejie: {
    H: 'hair',
    S: 'skin',
    W: 'eyeWhite',
    I: 'eyeIris',
    D: 'eyeIrisDeep',
    E: 'eyeShine',
  },
  maiqi: {
    D: 'skinDk',
    G: 'skin',
    K: 'eye',
    M: 'mouth',
  },
};

/**
 * 把角色画到 canvas 上。
 * @param {HTMLCanvasElement} canvas 目标画布
 * @param {string} charId 角色 id
 * @param {number} [scale] 每个像素格放大几倍
 */
export function drawCharacterPortrait(canvas, charId, scale = 8) {
  const char = CHARACTERS[charId];
  if (!canvas || !char) return;
  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const w = BODY_W * scale;
  const h = (HEAD_H + BODY_H) * scale;
  canvas.width = w;
  canvas.height = h;
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, w, h);

  const p = char.palette;
  const head = charId === 'steve' ? STEVE_HEAD : charId === 'jiejie' ? JIEJIE_HEAD : MAIQI_HEAD;
  const keys = HEAD_KEYS[charId] || {};
  const headX = Math.floor((BODY_W - HEAD_W) / 2) * scale;

  // ---- 头部 ----
  for (let y = 0; y < HEAD_H; y++) {
    const row = head[y];
    for (let x = 0; x < HEAD_W; x++) {
      const paletteKey = keys[row[x]];
      const color = paletteKey ? p[paletteKey] : null;
      if (color) ctx.fillStyle = color;
      ctx.fillRect(headX + x * scale, y * scale, scale, scale);
    }
  }

  // ---- 躯干 ----
  const bodyTop = HEAD_H * scale;
  for (let y = 0; y < BODY_H; y++) {
    for (let x = 0; x < BODY_W; x++) {
      let color = bodyCell(charId, p, x, y);
      if (color) ctx.fillStyle = color;
      ctx.fillRect(x * scale, bodyTop + y * scale, scale, scale);
    }
  }
}

/**
 * 躯干某一格的���色。
 * @param {string} charId @param {object} p @param {number} x @param {number} y
 * @returns {string|null}
 */
function bodyCell(charId, p, x, y) {
  const edge = x === 0 || x === BODY_W - 1;
  if (charId === 'steve') {
    if (y === BODY_H - 1) {
      // 棕腰带 + 金色扣
      if (x === 4 || x === 5) return p.beltBuckle;
      return p.belt;
    }
    return edge ? p.shirtDk : p.shirt;
  }
  if (charId === 'jiejie') {
    if (y === BODY_H - 1) return edge ? p.belt : p.belt;
    if (x === 4 || x === 5) {
      // 卫衣敞开露出的白内衫
      return y <= 2 ? p.inner : p.innerDk;
    }
    if (y === 3 && (x === 0 || x === BODY_W - 1)) return p.shirtCuff;
    return edge ? p.shirtDk : p.shirt;
  }
  // 麦琪：上半身是龟壳，横条纹
  if (y === 0) return edge ? p.skinDk : p.skin;
  const stripe = (y - 1) % 2 === 0;
  const border = x === 0 || x === BODY_W - 1;
  if (border) return p.shell;
  return stripe ? p.shellHi : p.shellDk;
}
