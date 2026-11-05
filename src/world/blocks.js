/**
 * 方块注册表：材质、硬度、光照、碰撞属性。
 * 面顺序统一为 [+X, -X, +Y, -Y, +Z, -Z]。
 * @module world/blocks
 */

/** @typedef {{name:string, solid:boolean, opaque:boolean, light:number, tex:string[], hardness:number, tint?:number[], shape?:string}} BlockDef */

/** @type {BlockDef[]} */
export const BLOCKS = [];

function def(name, opts) {
  const b = {
    name,
    solid: opts.solid !== false,
    opaque: opts.opaque !== false,
    light: opts.light || 0,
    hardness: opts.hardness ?? 1,
    tex: opts.tex,
    tint: opts.tint || null,
    shape: opts.shape || 'cube',
  };
  BLOCKS.push(b);
  return b;
}

const all = (t) => [t, t, t, t, t, t];
const column = (top, side, bottom) => [side, side, top, bottom, side, side];

export const BLOCK = {
  AIR: 0,
  STONE: 1,
  COBBLESTONE: 2,
  STONE_BRICKS: 3,
  MOSSY_COBBLE: 4,
  DEEPSLATE: 5,
  DIRT: 6,
  GRASS: 7,
  PLANKS: 8,
  DARK_PLANKS: 9,
  BEDROCK: 10,
  OBSIDIAN: 11,
  END_STONE: 12,
  END_PORTAL: 13,
  LAVA: 14,
  TORCH: 15,
  CHEST: 16,
  SPAWNER: 17,
  GLASS: 18,
  COBWEB: 19,
  IRON_ORE: 20,
  GOLD_ORE: 21,
  DIAMOND_ORE: 22,
  GOLD_BLOCK: 23,
  NETHERRACK: 24,
  BRICKS: 25,
  SANDSTONE: 26,
  BOOKSHELF: 27,
  CRAFTING: 28,
  FURNACE: 29,
  TNT: 30,
  DRAGON_EGG: 31,
  END_PILLAR: 32,
  QUARTZ: 33,
  MOSSY_BRICKS: 34,
  IRON_BLOCK: 35,
  REDSTONE_ORE: 36,
  STEP: 37,
  ENCHANTING_TABLE: 38,
};

def('air', { solid: false, opaque: false, hardness: 0, tex: all('missing') });
def('stone', { tex: all('stone'), hardness: 1.5 });
def('cobblestone', { tex: all('cobblestone'), hardness: 2 });
def('stone_bricks', { tex: all('stone_bricks'), hardness: 2 });
def('mossy_cobble', { tex: all('mossy_cobble'), hardness: 2 });
def('deepslate', { tex: all('deepslate'), hardness: 3 });
def('dirt', { tex: all('dirt'), hardness: 0.5 });
def('grass', { tex: column('grass_top', 'grass_side', 'dirt'), hardness: 0.6 });
def('planks', { tex: all('planks'), hardness: 2 });
def('dark_planks', { tex: all('dark_planks'), hardness: 2 });
def('bedrock', { tex: all('bedrock'), hardness: -1 });
def('obsidian', { tex: all('obsidian'), hardness: 12 });
def('end_stone', { tex: all('end_stone'), hardness: 3 });
def('end_portal', { tex: all('end_portal'), hardness: -1, light: 11 });
def('lava', { tex: all('lava'), hardness: -1, light: 15, solid: false, opaque: false });
def('torch', {
  tex: all('torch'),
  hardness: 0.1,
  light: 14,
  solid: false,
  opaque: false,
  shape: 'torch',
});
def('chest', { tex: all('chest'), hardness: 2.5, shape: 'chest' });
def('spawner', { tex: all('spawner'), hardness: 5 });
def('glass', { tex: all('glass'), hardness: 0.3, opaque: false });
def('cobweb', {
  tex: all('cobweb'),
  hardness: 1,
  solid: false,
  opaque: false,
  shape: 'cross',
});
def('iron_ore', { tex: all('iron_ore'), hardness: 3 });
def('gold_ore', { tex: all('gold_ore'), hardness: 3 });
def('diamond_ore', { tex: all('diamond_ore'), hardness: 3.5 });
def('gold_block', { tex: all('gold_block'), hardness: 3 });
def('netherrack', { tex: all('netherrack'), hardness: 0.4 });
def('bricks', { tex: all('bricks'), hardness: 2 });
def('sandstone', { tex: all('sandstone'), hardness: 0.8 });
def('bookshelf', { tex: column('planks', 'bookshelf', 'planks'), hardness: 1.5 });
def('crafting', { tex: column('crafting_top', 'crafting_side', 'planks'), hardness: 2.5 });
def('furnace', { tex: column('furnace_top', 'furnace_side', 'furnace_top'), hardness: 3.5 });
def('tnt', { tex: column('tnt_top', 'tnt_side', 'tnt_bottom'), hardness: 0.5 });
def('dragon_egg', { tex: all('dragon_egg'), hardness: 3 });
def('end_pillar', { tex: column('end_pillar_top', 'end_pillar', 'end_pillar_top'), hardness: -1 });
def('quartz', { tex: all('quartz'), hardness: 0.8 });
def('mossy_bricks', { tex: all('mossy_bricks'), hardness: 2 });
def('iron_block', { tex: all('iron_block'), hardness: 5 });
def('redstone_ore', { tex: all('redstone_ore'), hardness: 3 });
def('step', { tex: all('stone_bricks'), hardness: 2 });
def('enchanting_table', {
  tex: column('enchant_top', 'enchant_side', 'enchant_top'),
  hardness: 3,
  light: 4,
});

/** 每种方块的挖掘掉落物（物品 id 字符串）。 */
export const BLOCK_DROPS = {
  stone: 'cobblestone',
  cobblestone: 'cobblestone',
  stone_bricks: 'stone_bricks',
  mossy_cobble: 'mossy_cobble',
  deepslate: 'deepslate',
  dirt: 'dirt',
  grass: 'dirt',
  planks: 'planks',
  dark_planks: 'dark_planks',
  obsidian: 'obsidian',
  end_stone: 'end_stone',
  glass: null,
  iron_ore: 'iron_ore',
  gold_ore: 'gold_ore',
  diamond_ore: 'diamond_ore',
  redstone_ore: 'redstone_ore',
  netherrack: 'netherrack',
  bricks: 'bricks',
  sandstone: 'sandstone',
  quartz: 'quartz',
  gold_block: 'gold_block',
  iron_block: 'iron_block',
};

/** 便捷判定。 */
export const isSolid = (id) => id !== 0 && BLOCKS[id].solid;
export const isOpaque = (id) => id !== 0 && BLOCKS[id].opaque;
export const lightOf = (id) => (id === 0 ? 0 : BLOCKS[id].light);
