/**
 * 程序化生成 Minecraft 风格 16×16 像素纹理图集。
 * 全部用 Canvas 绘制，不依赖任何外部图片资源。
 * @module world/atlas
 */
import * as THREE from 'three';
import { RNG } from '../core/utils.js';
import { CHARACTERS } from '../core/characters.js';

const TILE = 16;
const PAD = 2;
const CELL = TILE + PAD * 2;
const COLS = 16;
const ATLAS = CELL * COLS;

/** 画笔：在 16×16 像素上作画。 */
class Tile {
  /** @param {CanvasRenderingContext2D} ctx @param {number} ox @param {number} oy */
  constructor(ctx, ox, oy) {
    this.ctx = ctx;
    this.ox = ox;
    this.oy = oy;
  }
  /** @param {number} x @param {number} y @param {string} color */
  px(x, y, color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(this.ox + x, this.oy + y, 1, 1);
  }
  /** @param {number} x @param {number} y @param {number} w @param {number} h @param {string} color */
  rect(x, y, w, h, color) {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(this.ox + x, this.oy + y, w, h);
  }
  /** 整块铺色。 */
  fill(color) {
    this.rect(0, 0, TILE, TILE, color);
  }
  /** @param {string} color */
  border(color) {
    this.rect(0, 0, TILE, 1, color);
    this.rect(0, TILE - 1, TILE, 1, color);
    this.rect(0, 0, 1, TILE, color);
    this.rect(TILE - 1, 0, 1, TILE, color);
  }
}

const hex = (r, g, b) => `rgb(${r | 0},${g | 0},${b | 0})`;

const clamp255 = (v) => Math.max(0, Math.min(255, Math.round(v)));

/**
 * 解析颜色，支持 `#rgb` / `#rrggbb` / `rgb(r,g,b)`。
 * @param {string} color
 * @returns {[number,number,number]}
 */
function parseColor(color) {
  if (color.startsWith('#')) {
    const h = color.slice(1);
    if (h.length === 3) {
      return [
        parseInt(h[0] + h[0], 16),
        parseInt(h[1] + h[1], 16),
        parseInt(h[2] + h[2], 16),
      ];
    }
    if (h.length >= 6) {
      return [
        parseInt(h.slice(0, 2), 16),
        parseInt(h.slice(2, 4), 16),
        parseInt(h.slice(4, 6), 16),
      ];
    }
    return [255, 255, 255];
  }
  const m = color.match(/\d+/g);
  if (!m) return [255, 255, 255];
  return [Number(m[0]), Number(m[1]), Number(m[2])];
}

/** 亮度调整（正数变亮，负数变暗）。 */
function shade(color, amount) {
  const [r, g, b] = parseColor(color);
  const f = amount > 0 ? (v) => v + (255 - v) * amount : (v) => v * (1 + amount);
  return hex(clamp255(f(r)), clamp255(f(g)), clamp255(f(b)));
}

/**
 * 基础噪点铺色：主色 + 随机深浅颗粒。
 * @param {Tile} t @param {string} base @param {number} amount @param {RNG} rng
 */
function speckle(t, base, amount, rng) {
  t.fill(base);
  for (let y = 0; y < TILE; y++) {
    for (let x = 0; x < TILE; x++) {
      if (rng.next() < 0.42) {
        t.px(x, y, shade(base, (rng.next() - 0.5) * amount));
      }
    }
  }
}

/**
 * 随机团块（矿石/苔藓等）。
 * @param {Tile} t @param {string} color @param {number} count @param {number} size @param {RNG} rng
 */
function blobs(t, color, count, size, rng) {
  for (let i = 0; i < count; i++) {
    const cx = rng.int(1, TILE - 2);
    const cy = rng.int(1, TILE - 2);
    const r = rng.int(size, size + 1);
    for (let y = cy - r; y <= cy + r; y++) {
      for (let x = cx - r; x <= cx + r; x++) {
        if (x < 0 || y < 0 || x >= TILE || y >= TILE) continue;
        if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r + 0.4) {
          t.px(x, y, rng.chance(0.25) ? shade(color, 0.18) : color);
        }
      }
    }
  }
}

/** 砖块式交错缝。 */
function brickPattern(t, base, mortar, rng, rows = 4, offset = true) {
  speckle(t, base, 0.22, rng);
  const h = TILE / rows;
  for (let r = 0; r < rows; r++) {
    const y = Math.round(r * h);
    t.rect(0, y, TILE, 1, mortar);
    const shift = offset && r % 2 === 1 ? 8 : 0;
    for (let x = shift; x < TILE; x += 8) {
      t.rect(x % TILE, y, 1, Math.round(h), mortar);
    }
  }
}

/* ------------------------------------------------------------------ */
/*                          防具图标                                  */
/* ------------------------------------------------------------------ */

/**
 * 防具图标配色：底色 + 主色 + 高光 + 暗部。
 * @typedef {{bg:string, main:string, light:string, dark:string}} ArmorPalette
 */

/** @type {Record<string, ArmorPalette>} */
const ARMOR_PALETTE = {
  leather: { bg: '#4a3018', main: '#8a5a34', light: '#a8703f', dark: '#5e3d24' },
  iron: { bg: '#3d4147', main: '#c0c0c0', light: '#e8e8e8', dark: '#8a8a8a' },
  diamond: { bg: '#123c44', main: '#5ad6d6', light: '#a8f0f0', dark: '#2f8f9f' },
};

/**
 * 画头盔：圆顶盔壳 + 中间护鼻 + 两侧护耳。
 * @param {Tile} t @param {ArmorPalette} c
 */
function paintHelmet(t, c) {
  t.fill(c.bg);
  // 盔壳：半圆形的圆顶
  t.rect(7, 1, 2, 1, c.main);
  t.rect(6, 2, 4, 1, c.main);
  t.rect(5, 3, 6, 1, c.main);
  t.rect(4, 4, 8, 1, c.main);
  t.rect(3, 5, 10, 2, c.main);
  // 两侧护耳
  t.rect(3, 7, 2, 3, c.main);
  t.rect(11, 7, 2, 3, c.main);
  // 中间护鼻
  t.rect(7, 7, 2, 4, c.main);
  // 高光：左上受光面
  t.rect(7, 1, 1, 1, c.light);
  t.rect(6, 2, 2, 1, c.light);
  t.rect(5, 3, 3, 1, c.light);
  t.rect(4, 4, 2, 1, c.light);
  t.rect(3, 5, 1, 2, c.light);
  t.rect(3, 7, 1, 3, c.light);
  t.rect(7, 7, 1, 4, c.light);
  // 暗部：右侧弧线与下缘
  t.rect(8, 1, 1, 1, c.dark);
  t.rect(9, 2, 1, 1, c.dark);
  t.rect(10, 3, 1, 1, c.dark);
  t.rect(11, 4, 1, 1, c.dark);
  t.rect(12, 5, 1, 2, c.dark);
  t.rect(3, 6, 10, 1, c.dark);
  t.rect(3, 9, 2, 1, c.dark);
  t.rect(11, 9, 2, 1, c.dark);
  t.rect(7, 10, 2, 1, c.dark);
  // 护鼻两侧的暗缝，让头盔和脸部空隙分得开
  t.rect(6, 7, 1, 3, c.dark);
  t.rect(9, 7, 1, 3, c.dark);
}

/**
 * 画胸甲：两个肩甲 + 梯形躯干 + 中间一道竖缝。
 * @param {Tile} t @param {ArmorPalette} c
 */
function paintChestplate(t, c) {
  t.fill(c.bg);
  // 肩甲（中间留出脖子的空隙）
  t.rect(1, 2, 4, 3, c.main);
  t.rect(11, 2, 4, 3, c.main);
  // 梯形躯干：上宽下窄
  t.rect(3, 4, 10, 1, c.main);
  t.rect(3, 5, 10, 6, c.main);
  t.rect(4, 11, 8, 2, c.main);
  t.rect(5, 13, 6, 1, c.main);
  // 中间竖缝
  t.rect(7, 4, 1, 10, c.dark);
  // 高光：左侧受光面
  t.rect(1, 2, 1, 3, c.light);
  t.rect(3, 4, 2, 1, c.light);
  t.rect(3, 5, 1, 6, c.light);
  // 暗部：右侧与下摆
  t.rect(14, 2, 1, 3, c.dark);
  t.rect(12, 4, 1, 1, c.dark);
  t.rect(12, 5, 1, 6, c.dark);
  t.rect(5, 13, 6, 1, c.dark);
}

/**
 * 画护腿：倒梯形腰头 + 两条裤腿。
 * @param {Tile} t @param {ArmorPalette} c
 */
function paintLeggings(t, c) {
  t.fill(c.bg);
  // 腰头（上宽下窄的倒梯形）
  t.rect(2, 3, 12, 1, c.main);
  t.rect(3, 4, 10, 2, c.main);
  // 两条裤腿，中间留空
  t.rect(3, 6, 4, 7, c.main);
  t.rect(9, 6, 4, 7, c.main);
  // 高光：左侧受光面
  t.rect(2, 3, 1, 1, c.light);
  t.rect(3, 4, 1, 2, c.light);
  t.rect(3, 6, 1, 7, c.light);
  // 暗部：右侧、腰头下缘与裤脚
  t.rect(13, 3, 1, 1, c.dark);
  t.rect(12, 4, 1, 2, c.dark);
  t.rect(12, 6, 1, 7, c.dark);
  t.rect(3, 5, 10, 1, c.dark);
  t.rect(3, 12, 4, 1, c.dark);
  t.rect(9, 12, 4, 1, c.dark);
  // 腰头中缝，和两腿之间的空隙连成一条
  t.rect(7, 4, 1, 2, c.dark);
}

/** 物品图标（16×16 像素画），供第一人称手持模型与快捷栏使用。 */
const ITEM_PAINTERS = {
  item_iron_sword: (t) => {
    t.ctx.clearRect(t.ox, t.oy, TILE, TILE);
    // 握柄
    t.rect(2, 12, 3, 3, '#6b4a2c');
    t.rect(3, 13, 1, 1, '#8a6238');
    // 护手
    t.rect(1, 10, 6, 2, '#8e8e8e');
    // 剑身
    for (let i = 0; i < 9; i++) {
      t.rect(4 + i, 9 - i, 1, 1, '#dcdcdc');
      t.rect(5 + i, 9 - i, 1, 1, '#9a9a9a');
    }
    t.px(13, 0, '#ffffff');
  },
  item_stone_axe: (t) => {
    t.ctx.clearRect(t.ox, t.oy, TILE, TILE);
    t.rect(3, 8, 2, 8, '#6b4a2c');
    for (let i = 0; i < 6; i++) {
      t.rect(2 + i, 2 + i, 1, 1, '#9a9a9a');
      t.rect(3 + i, 2 + i, 1, 1, '#c4c4c4');
    }
    t.rect(5, 3, 4, 6, '#b0b0b0');
    t.rect(6, 4, 2, 4, '#d0d0d0');
  },
  item_bow: (t) => {
    t.ctx.clearRect(t.ox, t.oy, TILE, TILE);
    // 弓臂：上下端靠左，中部向右鼓（弓弦在第一人称模型里单独画，可以做拉弓动画）
    for (let i = 0; i < 14; i++) {
      const x = 4 + Math.round((1 - Math.abs(i - 6.5) / 6.5) * 6);
      t.rect(x, 1 + i, 3, 1, i % 4 === 0 ? '#4d3218' : '#6b4a2c');
      t.rect(x, 1 + i, 1, 1, '#8a6238');
      t.rect(x + 2, 1 + i, 1, 1, '#3f2a14');
    }
    // 握把（弓臂中部）
    t.rect(9, 6, 3, 4, '#8a8a8a');
    t.rect(10, 7, 1, 2, '#5a5a5a');
  },
  item_arrow: (t) => {
    t.ctx.clearRect(t.ox, t.oy, TILE, TILE);
    // 斜向右上方的箭
    for (let i = 0; i < 10; i++) {
      t.rect(2 + i, 13 - i, 1, 1, '#9a9a9a');
      t.rect(3 + i, 13 - i, 1, 1, '#6a6a6a');
    }
    // 箭头
    t.rect(11, 1, 2, 4, '#dcdcdc');
    t.rect(12, 0, 2, 2, '#f4f4f4');
    t.rect(11, 4, 4, 1, '#dcdcdc');
    // 箭羽
    t.rect(1, 11, 4, 2, '#e8e8e8');
    t.rect(0, 12, 3, 3, '#cfcfcf');
    t.rect(2, 10, 2, 1, '#cfcfcf');
  },
  item_bread: (t) => {
    t.fill('#c08a3e');
    t.rect(2, 4, 12, 8, '#d4a054');
    t.rect(3, 5, 3, 2, '#b57c33');
    t.rect(8, 8, 3, 2, '#b57c33');
    t.rect(2, 4, 12, 1, '#e8b96e');
    t.rect(2, 11, 12, 1, '#9a6a2c');
  },
  item_torch: (t) => {
    t.ctx.clearRect(t.ox, t.oy, TILE, TILE);
    t.rect(7, 6, 2, 9, '#7d5733');
    t.rect(6, 2, 4, 4, '#f2a007');
    t.rect(7, 1, 2, 3, '#ffe066');
  },
  item_cobblestone: (t, rng) => {
    speckle(t, '#6a6a6a', 0.16, rng);
    for (let i = 0; i < 6; i++) {
      t.rect(rng.int(1, 11), rng.int(1, 11), rng.int(3, 5), rng.int(3, 5), '#8a8a8a');
    }
  },
  item_iron: (t) => {
    t.fill('#d8d8d8');
    t.rect(2, 6, 12, 5, '#dcdcdc');
    t.rect(2, 6, 12, 1, '#f2f2f2');
    t.rect(2, 10, 12, 1, '#a0a0a0');
    t.rect(4, 5, 8, 1, '#e8e8e8');
  },
  item_gold: (t) => {
    t.fill('#f5e04a');
    t.rect(2, 6, 12, 5, '#f5e04a');
    t.rect(2, 6, 12, 1, '#fff3a0');
    t.rect(2, 10, 12, 1, '#c9a923');
    t.rect(4, 5, 8, 1, '#ffe97a');
  },
  item_potion: (t) => {
    t.ctx.clearRect(t.ox, t.oy, TILE, TILE);
    t.rect(6, 1, 4, 3, '#9a9a9a');
    t.rect(5, 4, 6, 2, '#b0b0b0');
    t.rect(4, 6, 8, 8, '#c8d8e8');
    t.rect(5, 8, 6, 5, '#e04a4a');
    t.rect(5, 8, 6, 1, '#f07070');
    t.px(6, 10, '#ffffff');
  },
  item_ender_pearl: (t) => {
    t.ctx.clearRect(t.ox, t.oy, TILE, TILE);
    t.rect(4, 4, 8, 8, '#1c7a63');
    t.rect(5, 5, 5, 5, '#3fc9a6');
    t.rect(6, 6, 2, 2, '#b8fff0');
  },
  item_bone: (t) => {
    t.ctx.clearRect(t.ox, t.oy, TILE, TILE);
    // 骨头：斜放的一节，两端有骨节
    for (let i = 0; i < 8; i++) {
      t.rect(4 + i, 11 - i, 2, 2, '#e8e8d8');
      t.rect(5 + i, 11 - i, 1, 1, '#ffffff');
    }
    t.rect(3, 10, 3, 3, '#d8d8c8');
    t.rect(4, 11, 1, 1, '#f8f8f0');
    t.rect(11, 3, 3, 3, '#d8d8c8');
    t.rect(12, 4, 1, 1, '#f8f8f0');
  },
  // 防具：头盔 / 胸甲 / 护腿 × 皮革 / 铁 / 钻石
  item_leather_helmet: (t) => paintHelmet(t, ARMOR_PALETTE.leather),
  item_leather_chestplate: (t) => paintChestplate(t, ARMOR_PALETTE.leather),
  item_leather_leggings: (t) => paintLeggings(t, ARMOR_PALETTE.leather),
  item_iron_helmet: (t) => paintHelmet(t, ARMOR_PALETTE.iron),
  item_iron_chestplate: (t) => paintChestplate(t, ARMOR_PALETTE.iron),
  item_iron_leggings: (t) => paintLeggings(t, ARMOR_PALETTE.iron),
  item_diamond_helmet: (t) => paintHelmet(t, ARMOR_PALETTE.diamond),
  item_diamond_chestplate: (t) => paintChestplate(t, ARMOR_PALETTE.diamond),
  item_diamond_leggings: (t) => paintLeggings(t, ARMOR_PALETTE.diamond),
};

/* ------------------------------------------------------------------ */
/*                          各纹理绘制函数                             */
/* ------------------------------------------------------------------ */

const PAINTERS = {
  stone: (t, rng) => {
    speckle(t, '#7c7c7c', 0.28, rng);
    blobs(t, '#6b6b6b', 5, 1, rng);
  },
  cobblestone: (t, rng) => {
    speckle(t, '#6a6a6a', 0.16, rng);
    for (let i = 0; i < 14; i++) {
      const x = rng.int(0, 12);
      const y = rng.int(0, 12);
      const w = rng.int(3, 6);
      const h = rng.int(3, 6);
      t.rect(x, y, w, h, shade('#8a8a8a', (rng.next() - 0.5) * 0.3));
      t.rect(x, y, w, 1, '#9d9d9d');
      t.rect(x, y + h - 1, w, 1, '#5a5a5a');
    }
    t.fill('#4a4a4a');
    for (let i = 0; i < 60; i++) t.px(rng.int(0, 15), rng.int(0, 15), '#3f3f3f');
  },
  stone_bricks: (t, rng) => {
    brickPattern(t, '#7b7b7b', '#5e5e5e', rng, 4, true);
    for (let i = 0; i < 26; i++) {
      t.px(rng.int(0, 15), rng.int(0, 15), shade('#7b7b7b', (rng.next() - 0.5) * 0.4));
    }
  },
  mossy_cobble: (t, rng) => {
    PAINTERS.cobblestone(t, rng);
    blobs(t, '#4e6b3a', 7, 1, rng);
    blobs(t, '#5d7d45', 4, 1, rng);
  },
  deepslate: (t, rng) => {
    speckle(t, '#4b4b50', 0.3, rng);
    blobs(t, '#3a3a40', 6, 1, rng);
    blobs(t, '#5a5a60', 3, 1, rng);
  },
  dirt: (t, rng) => {
    speckle(t, '#866043', 0.3, rng);
    blobs(t, '#72513a', 5, 1, rng);
  },
  grass_top: (t, rng) => {
    speckle(t, '#79c05a', 0.26, rng);
    blobs(t, '#68ab4c', 6, 1, rng);
  },
  grass_side: (t, rng) => {
    speckle(t, '#866043', 0.3, rng);
    for (let x = 0; x < TILE; x++) {
      const h = 3 + Math.floor(rng.next() * 3);
      for (let y = 0; y < h; y++) t.px(x, y, rng.chance(0.3) ? '#6fa94f' : '#7cb85b');
    }
  },
  planks: (t, rng) => {
    speckle(t, '#b08a52', 0.16, rng);
    for (let y = 0; y < TILE; y += 4) t.rect(0, y, TILE, 1, '#8a6a3c');
    for (let i = 0; i < 10; i++) {
      const x = rng.int(0, 15);
      const y = rng.int(0, 15);
      t.rect(x, y, rng.int(2, 5), 1, '#9c7745');
    }
    t.rect(7, 0, 1, 4, '#8a6a3c');
    t.rect(3, 8, 1, 4, '#8a6a3c');
    t.rect(11, 12, 1, 4, '#8a6a3c');
  },
  dark_planks: (t, rng) => {
    speckle(t, '#6b4a2c', 0.2, rng);
    for (let y = 0; y < TILE; y += 4) t.rect(0, y, TILE, 1, '#4f3520');
    for (let i = 0; i < 12; i++) t.rect(rng.int(0, 14), rng.int(0, 15), rng.int(2, 5), 1, '#5b3f26');
  },
  bedrock: (t, rng) => {
    speckle(t, '#565656', 0.6, rng);
    blobs(t, '#2f2f2f', 8, 1, rng);
    blobs(t, '#7d7d7d', 5, 1, rng);
  },
  obsidian: (t, rng) => {
    speckle(t, '#17131f', 0.5, rng);
    blobs(t, '#3b2a5a', 5, 1, rng);
    blobs(t, '#4d3a7a', 2, 0, rng);
  },
  end_stone: (t, rng) => {
    speckle(t, '#dfe3a3', 0.14, rng);
    blobs(t, '#cdd291', 6, 1, rng);
    blobs(t, '#f0f3c4', 3, 0, rng);
  },
  end_portal: (t, rng) => {
    speckle(t, '#0d1412', 0.4, rng);
    for (let i = 0; i < 12; i++) {
      const x = rng.int(1, 12);
      const y = rng.int(1, 12);
      t.rect(x, y, rng.int(1, 3), rng.int(1, 3), rng.chance(0.5) ? '#1d6b5a' : '#12463d');
    }
    t.px(7, 7, '#7fe8d6');
  },
  lava: (t, rng) => {
    speckle(t, '#d95a12', 0.28, rng);
    blobs(t, '#f2a007', 7, 1, rng);
    blobs(t, '#8f2f08', 4, 1, rng);
    blobs(t, '#ffe066', 2, 0, rng);
  },
  torch: (t) => {
    t.fill('#6b4a2c');
    t.rect(7, 6, 2, 10, '#7d5733');
    t.rect(7, 6, 1, 10, '#8f673d');
    t.rect(6, 2, 4, 4, '#f2a007');
    t.rect(7, 1, 2, 3, '#ffe066');
    t.rect(6, 3, 4, 1, '#f2a007');
    t.px(7, 0, '#fff2a8');
  },
  chest: (t, rng) => {
    speckle(t, '#8a6a3c', 0.14, rng);
    t.border('#4e3a1e');
    t.rect(0, 5, TILE, 1, '#3f2f18');
    t.rect(6, 4, 4, 5, '#5a5a5a');
    t.rect(7, 5, 2, 3, '#d8b24a');
    t.px(7, 6, '#7a5f18');
  },
  spawner: (t, rng) => {
    speckle(t, '#3b3b3b', 0.24, rng);
    for (let i = 0; i < TILE; i += 3) {
      t.rect(i, 0, 1, TILE, '#6a6a6a');
      t.rect(0, i, TILE, 1, '#6a6a6a');
    }
    t.rect(5, 5, 6, 6, '#101318');
    t.rect(6, 6, 4, 4, '#2b4a5a');
    blobs(t, '#8a8a8a', 3, 0, rng);
  },
  glass: (t, rng) => {
    t.ctx.clearRect(t.ox, t.oy, TILE, TILE);
    t.border('#cfe6f5');
    t.rect(1, 1, TILE - 2, TILE - 2, 'rgba(190,225,245,0.18)');
    t.rect(3, 3, 4, 4, 'rgba(255,255,255,0.35)');
    t.rect(9, 8, 3, 3, 'rgba(255,255,255,0.25)');
    t.px(12, 3, '#ffffff');
  },
  cobweb: (t) => {
    t.ctx.clearRect(t.ox, t.oy, TILE, TILE);
    t.ctx.strokeStyle = 'rgba(235,235,235,0.85)';
    t.ctx.lineWidth = 1;
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 4;
      t.ctx.beginPath();
      t.ctx.moveTo(t.ox + 8, t.oy + 8);
      t.ctx.lineTo(t.ox + 8 + Math.cos(a) * 12, t.oy + 8 + Math.sin(a) * 12);
      t.ctx.stroke();
    }
    for (let r = 4; r < 12; r += 3) {
      t.ctx.beginPath();
      t.ctx.arc(t.ox + 8, t.oy + 8, r, 0, Math.PI * 2);
      t.ctx.stroke();
    }
  },
  iron_ore: (t, rng) => {
    PAINTERS.stone(t, rng);
    blobs(t, '#d8a679', 5, 1, rng);
    blobs(t, '#f0d0aa', 2, 0, rng);
  },
  gold_ore: (t, rng) => {
    PAINTERS.stone(t, rng);
    blobs(t, '#f2c33c', 5, 1, rng);
    blobs(t, '#fff0a8', 2, 0, rng);
  },
  diamond_ore: (t, rng) => {
    PAINTERS.stone(t, rng);
    blobs(t, '#4fd8d8', 5, 1, rng);
    blobs(t, '#b0fbfb', 2, 0, rng);
  },
  redstone_ore: (t, rng) => {
    PAINTERS.stone(t, rng);
    blobs(t, '#d02020', 5, 1, rng);
    blobs(t, '#ff5050', 2, 0, rng);
  },
  gold_block: (t, rng) => {
    speckle(t, '#f5e04a', 0.14, rng);
    t.border('#c9a923');
    t.rect(1, 1, TILE - 2, 1, '#fff3a0');
    t.rect(1, 1, 1, TILE - 2, '#fff3a0');
    t.rect(1, TILE - 2, TILE - 2, 1, '#b8961c');
  },
  iron_block: (t, rng) => {
    speckle(t, '#dcdcdc', 0.1, rng);
    t.border('#a8a8a8');
    t.rect(1, 1, TILE - 2, 1, '#f5f5f5');
    t.rect(1, 1, 1, TILE - 2, '#f0f0f0');
    t.rect(1, TILE - 2, TILE - 2, 1, '#9a9a9a');
  },
  netherrack: (t, rng) => {
    speckle(t, '#6f3838', 0.3, rng);
    blobs(t, '#572929', 6, 1, rng);
    blobs(t, '#8a4646', 3, 1, rng);
  },
  bricks: (t, rng) => {
    brickPattern(t, '#96604a', '#5f3a2c', rng, 4, true);
  },
  sandstone: (t, rng) => {
    speckle(t, '#dbd3a0', 0.12, rng);
    t.rect(0, 0, TILE, 2, '#c8bf8a');
    t.rect(0, TILE - 2, TILE, 2, '#c8bf8a');
    for (let y = 3; y < TILE - 2; y += 4) t.rect(0, y, TILE, 1, '#cfc68f');
  },
  bookshelf: (t, rng) => {
    speckle(t, '#a87f4a', 0.14, rng);
    t.rect(0, 0, TILE, 2, '#6b4a2c');
    t.rect(0, TILE - 2, TILE, 2, '#6b4a2c');
    const colors = ['#a02a2a', '#2a4fa0', '#c8a22a', '#2f8a3a', '#7a2f9a'];
    for (let shelf = 0; shelf < 2; shelf++) {
      const y0 = 3 + shelf * 6;
      let x = 1;
      while (x < 14) {
        const w = rng.int(1, 2);
        const h = rng.int(3, 4);
        t.rect(x, y0 + (5 - h), w, h, rng.pick(colors));
        x += w + 1;
      }
    }
  },
  crafting_top: (t, rng) => {
    speckle(t, '#a87f4a', 0.14, rng);
    t.border('#6b4a2c');
    t.rect(2, 2, 12, 12, '#c9a267');
    for (let i = 2; i < 14; i += 4) {
      t.rect(i, 2, 1, 12, '#8a6a3c');
      t.rect(2, i, 12, 1, '#8a6a3c');
    }
  },
  crafting_side: (t, rng) => {
    speckle(t, '#a87f4a', 0.14, rng);
    t.rect(0, 0, TILE, 4, '#6b4a2c');
    t.rect(2, 6, 4, 7, '#8a8a8a');
    t.rect(8, 7, 6, 2, '#a0a0a0');
    t.rect(9, 10, 4, 3, '#7a5a2c');
  },
  furnace_top: (t, rng) => {
    speckle(t, '#6f6f6f', 0.2, rng);
    t.rect(3, 3, 10, 10, '#2a2a2a');
    t.rect(4, 4, 8, 8, '#141414');
  },
  furnace_side: (t, rng) => {
    speckle(t, '#6f6f6f', 0.2, rng);
    t.rect(3, 6, 10, 7, '#2a2a2a');
    t.rect(4, 9, 8, 4, '#d95a12');
    t.rect(5, 10, 6, 2, '#f2a007');
  },
  tnt_top: (t) => {
    t.fill('#c33b32');
    t.border('#8a2721');
    t.rect(6, 6, 4, 4, '#2a2a2a');
    t.rect(7, 7, 2, 2, '#e8e8e8');
  },
  tnt_side: (t) => {
    speckle(t, '#c33b32', 0.12, new RNG(9));
    t.rect(0, 5, TILE, 6, '#efefef');
    t.rect(1, 6, 3, 4, '#1a1a1a');
    t.rect(5, 6, 6, 4, '#1a1a1a');
    t.rect(12, 6, 3, 4, '#1a1a1a');
  },
  tnt_bottom: (t) => {
    speckle(t, '#8a2721', 0.16, new RNG(11));
  },
  enchant_top: (t, rng) => {
    // 附魔台顶面：黑曜石底 + 中央紫色宝石
    speckle(t, '#15121f', 0.35, rng);
    t.rect(1, 1, 14, 14, '#0d0b14');
    t.rect(2, 2, 12, 12, '#241a3a');
    t.rect(4, 4, 8, 8, '#3a2560');
    t.rect(6, 6, 4, 4, '#7b3fd4');
    t.rect(7, 7, 2, 2, '#c79bff');
    t.px(7, 7, '#ffffff');
  },
  enchant_side: (t, rng) => {
    // 附魔台侧面：黑曜石 + 紫色符文
    speckle(t, '#15121f', 0.3, rng);
    t.rect(0, 0, TILE, 3, '#0d0b14');
    t.rect(2, 5, 12, 8, '#1d1730');
    t.rect(4, 7, 8, 4, '#3a2560');
    t.rect(6, 8, 4, 2, '#9b5ce8');
    t.rect(7, 8, 2, 1, '#e0c0ff');
    t.rect(0, 14, TILE, 2, '#0d0b14');
  },
  dragon_egg: (t, rng) => {
    speckle(t, '#0e0c18', 0.5, rng);
    blobs(t, '#3a2a55', 6, 1, rng);
    blobs(t, '#5c4488', 2, 0, rng);
    t.px(3, 4, '#7a5fb0');
    t.px(11, 9, '#7a5fb0');
  },
  end_pillar_top: (t, rng) => {
    speckle(t, '#e6e2b4', 0.1, rng);
    t.border('#b9b487');
    t.rect(4, 4, 8, 8, '#c3bf92');
  },
  end_pillar: (t, rng) => {
    speckle(t, '#d9d5a8', 0.1, rng);
    for (let y = 0; y < TILE; y += 4) t.rect(0, y, TILE, 1, '#b9b487');
    t.rect(0, 0, 1, TILE, '#eeeac2');
    t.rect(TILE - 1, 0, 1, TILE, '#a8a47c');
  },
  quartz: (t, rng) => {
    speckle(t, '#ece9de', 0.08, rng);
    t.border('#c9c5b8');
    t.rect(1, 1, TILE - 2, 1, '#ffffff');
  },
  mossy_bricks: (t, rng) => {
    brickPattern(t, '#7b7b7b', '#5e5e5e', rng, 4, true);
    blobs(t, '#4e6b3a', 6, 1, rng);
  },
  missing: (t) => {
    for (let y = 0; y < TILE; y++)
      for (let x = 0; x < TILE; x++)
        t.px(x, y, (x + y) % 2 === 0 ? '#ff00ff' : '#101010');
  },
};

/** 实体用的贴图（不在方块图集里，单独生成）。 */
const ENTITY_PAINTERS = {
  zombie_face: (t, rng) => {
    t.fill('#4a7a3a');
    speckle(t, '#4a7a3a', 0.16, rng);
    t.rect(3, 5, 3, 3, '#101010');
    t.rect(10, 5, 3, 3, '#101010');
    t.rect(4, 6, 1, 1, '#d8d8d8');
    t.rect(11, 6, 1, 1, '#d8d8d8');
    t.rect(6, 11, 4, 1, '#20301a');
  },
  creeper_face: (t, rng) => {
    speckle(t, '#5cb544', 0.18, rng);
    t.rect(3, 4, 3, 4, '#101010');
    t.rect(10, 4, 3, 4, '#101010');
    t.rect(6, 10, 4, 5, '#101010');
    t.rect(7, 11, 1, 1, '#3a3a3a');
    t.rect(8, 12, 1, 1, '#3a3a3a');
  },
  skeleton_face: (t, rng) => {
    speckle(t, '#d8d8d8', 0.12, rng);
    t.rect(3, 5, 3, 3, '#101010');
    t.rect(10, 5, 3, 3, '#101010');
    t.rect(5, 10, 6, 1, '#303030');
  },
  dragon_body: (t, rng) => {
    speckle(t, '#141018', 0.4, rng);
    blobs(t, '#2c2038', 6, 1, rng);
    blobs(t, '#4a2a6a', 2, 0, rng);
  },
  dragon_wing: (t, rng) => {
    speckle(t, '#1b1524', 0.35, rng);
    for (let y = 0; y < TILE; y += 4) t.rect(0, y, TILE, 1, '#3a2a4a');
  },
  crystal: (t) => {
    t.fill('rgba(20,10,30,0.0)');
    t.rect(5, 2, 6, 12, 'rgba(220,235,255,0.9)');
    t.rect(4, 5, 8, 7, 'rgba(200,225,255,0.95)');
    t.rect(6, 4, 4, 9, 'rgba(255,255,255,0.95)');
    t.rect(7, 3, 2, 11, '#ffffff');
  },
  white: (t) => t.fill('#ffffff'),
  black: (t) => t.fill('#101010'),
  /** 第一人称手臂：上端是袖子，下端是皮肤（横向明暗做出圆柱感） */
  arm: (t) => {
    const sleeve = '#4a6b8a';
    const sleeveDark = '#36506b';
    const sleeveLight = '#628cb4';
    const skin = '#c99b6d';
    const skinDark = '#a87f56';
    const skinLight = '#dcb28a';

    // 袖子
    t.rect(0, 0, 16, 5, sleeve);
    t.rect(0, 0, 3, 5, sleeveDark);
    t.rect(13, 0, 3, 5, sleeveLight);
    t.rect(0, 4, 16, 1, sleeveDark);

    // 手臂皮肤
    t.rect(0, 5, 16, 11, skin);
    t.rect(0, 5, 3, 11, skinDark);
    t.rect(13, 5, 3, 11, skinLight);
    // 袖口
    t.rect(0, 5, 16, 1, skinLight);

    // 手部细节
    t.rect(2, 12, 4, 1, skinDark);
    t.rect(9, 13, 5, 1, skinDark);
    t.rect(6, 14, 4, 1, skinDark);
  },
};

/** 各角色的第一人称手臂（配色见 core/characters.js）。 */
const ARM_PAINTERS = {
  arm_steve: CHARACTERS.steve.arm,
  arm_jiejie: CHARACTERS.jiejie.arm,
  arm_maiqi: CHARACTERS.maiqi.arm,
};

/**
 * 按角色配色画一条手臂。
 * @param {Tile} t @param {object} c 配色
 */
function paintArm(t, c) {
  // 袖子
  t.rect(0, 0, 16, 5, c.sleeve);
  t.rect(0, 0, 3, 5, c.sleeveDk);
  t.rect(13, 0, 3, 5, c.sleeveLight);
  t.rect(0, 4, 16, 1, c.sleeveDk);

  // 手臂皮肤
  t.rect(0, 5, 16, 11, c.skin);
  t.rect(0, 5, 3, 11, c.skinDk);
  t.rect(13, 5, 3, 11, c.skinLight);

  // 袖口（杰杰的白袖口最显眼）
  t.rect(0, 5, 16, 1, c.cuff);

  // 手部细节
  t.rect(2, 12, 4, 1, c.skinDk);
  t.rect(9, 13, 5, 1, c.skinDk);
  t.rect(6, 14, 4, 1, c.skinDk);
}

for (const [name, colors] of Object.entries(ARM_PAINTERS)) {
  ENTITY_PAINTERS[name] = (t) => paintArm(t, colors);
}

/**
 * 构建图集。
 * @returns {{texture: THREE.Texture, rect:(name:string)=>{u0:number,v0:number,u1:number,v1:number}|null, entity:(name:string)=>THREE.Texture}}
 */
export function buildAtlas() {
  const canvas = document.createElement('canvas');
  canvas.width = ATLAS;
  canvas.height = ATLAS;
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  ctx.clearRect(0, 0, ATLAS, ATLAS);

  /** @type {Map<string, number>} */
  const index = new Map();
  const names = [...Object.keys(PAINTERS), ...Object.keys(ITEM_PAINTERS)];
  names.forEach((name, i) => {
    const cx = (i % COLS) * CELL;
    const cy = Math.floor(i / COLS) * CELL;
    const tile = new Tile(ctx, cx + PAD, cy + PAD);
    const painter = PAINTERS[name] || ITEM_PAINTERS[name];
    painter(tile, new RNG(1000 + i * 977));
    // 边缘 padding 复制边缘像素，避免 mipmap 采样时相邻图块串色
    for (let p = 0; p < PAD; p++) {
      ctx.drawImage(canvas, cx + PAD, cy + PAD, TILE, 1, cx + PAD, cy + PAD - p, TILE, 1);
      ctx.drawImage(canvas, cx + PAD, cy + PAD + TILE - 1, TILE, 1, cx + PAD, cy + PAD + TILE + p, TILE, 1);
      ctx.drawImage(canvas, cx + PAD, cy + PAD, 1, TILE, cx + PAD - p, cy + PAD, 1, TILE);
      ctx.drawImage(canvas, cx + PAD + TILE - 1, cy + PAD, 1, TILE, cx + PAD + TILE + p, cy + PAD, 1, TILE);
    }
    index.set(name, i);
  });

  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;

  // 同一张画布再生成一份「无 mipmap」贴图：
  // 手持模型与掉落物尺寸很小，若用带 mipmap 的贴图会在缩小时与相邻图块串色。
  const flatTexture = new THREE.CanvasTexture(canvas);
  flatTexture.magFilter = THREE.NearestFilter;
  flatTexture.minFilter = THREE.NearestFilter;
  flatTexture.generateMipmaps = false;
  flatTexture.colorSpace = THREE.SRGBColorSpace;
  flatTexture.needsUpdate = true;

  /** @param {string} name */
  const rect = (name) => {
    const i = index.get(name);
    if (i === undefined) return null;
    const cx = (i % COLS) * CELL + PAD;
    const cy = Math.floor(i / COLS) * CELL + PAD;
    return {
      u0: cx / ATLAS,
      v0: 1 - (cy + TILE) / ATLAS,
      u1: (cx + TILE) / ATLAS,
      v1: 1 - cy / ATLAS,
    };
  };

  /** 供 2D HUD 绘制图标用的像素矩形。 */
  const tileRect = (name) => {
    const i = index.get(name);
    if (i === undefined) return null;
    return {
      sx: (i % COLS) * CELL + PAD,
      sy: Math.floor(i / COLS) * CELL + PAD,
      w: TILE,
      h: TILE,
    };
  };

  // 实体贴图单独生成（16×16，不带 padding 需求）
  /** @type {Map<string, THREE.Texture>} */
  const entityTextures = new Map();
  const entityNames = Object.keys(ENTITY_PAINTERS);
  // 4 列排布，行数按实体数量算，别写死 64×64 不然加多了会画到画布外
  const entityCols = 4;
  const entityRows = Math.max(1, Math.ceil(entityNames.length / entityCols));
  const entityCanvas = document.createElement('canvas');
  entityCanvas.width = entityCols * 16;
  entityCanvas.height = entityRows * 16;
  const ectx = entityCanvas.getContext('2d');
  ectx.imageSmoothingEnabled = false;
  entityNames.forEach((name, i) => {
    const cx = (i % entityCols) * 16;
    const cy = Math.floor(i / entityCols) * 16;
    const tile = new Tile(ectx, cx, cy);
    ENTITY_PAINTERS[name](tile, new RNG(5000 + i * 613));
  });
  for (const name of entityNames) {
    const i = entityNames.indexOf(name);
    const cx = (i % entityCols) * 16;
    const cy = Math.floor(i / entityCols) * 16;
    // 每个实体贴图单独一张 canvas，便于独立设置 offset/repeat
    const c = document.createElement('canvas');
    c.width = 16;
    c.height = 16;
    const cc = c.getContext('2d');
    cc.imageSmoothingEnabled = false;
    cc.drawImage(entityCanvas, cx, cy, 16, 16, 0, 0, 16, 16);
    const t = new THREE.CanvasTexture(c);
    t.magFilter = THREE.NearestFilter;
    t.minFilter = THREE.NearestFilter;
    t.colorSpace = THREE.SRGBColorSpace;
    t.needsUpdate = true;
    entityTextures.set(name, t);
  }

  /** @param {string} name */
  const entity = (name) => entityTextures.get(name) || entityTextures.get('white');

  return { texture, flatTexture, rect, tileRect, canvas, entity };
}
