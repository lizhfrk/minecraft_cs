/**
 * 物品注册表：名称、图标、堆叠上限、类型。
 * @module weapons/items
 */

/**
 * @typedef {object} ItemDef
 * @property {string} label 显示名
 * @property {string} icon 图集内的纹理名
 * @property {string} type weapon|tool|ammo|food|material|block|armor
 * @property {number} maxStack
 * @property {number} [heal] 食物回复的生命值
 * @property {string} [block] 可放置方块的注册名
 * @property {'head'|'chest'|'legs'} [slot] 防具部位（type 为 armor 时才有）
 * @property {number} [defense] 防具提供的防御点数（type 为 armor 时才有）
 * @property {string} desc 用途说明（界面里展示给玩家看）
 */

/** @type {Record<string, ItemDef>} */
export const ITEMS = {
  // ---- 武器 / 工具 ----
  iron_sword: {
    label: '铁剑',
    icon: 'item_iron_sword',
    type: 'weapon',
    maxStack: 1,
    desc: '近战武器，伤害 5，攻击间隔 0.42 秒。挥砍会把敌人打退，适合贴身缠斗。',
  },
  stone_axe: {
    label: '石斧',
    icon: 'item_stone_axe',
    type: 'tool',
    maxStack: 1,
    desc: '近战武器，伤害 6.5（最高），但攻速慢（0.62 秒）。挖方块速度是铁剑的 2 倍。',
  },
  bow: {
    label: '弓',
    icon: 'item_bow',
    type: 'weapon',
    maxStack: 1,
    desc: '远程武器。按住左键蓄力、松开射击；箭会下坠，蓄满时伤害 10。距离越远越要抬高准星。',
  },

  // ---- 防具 ----
  leather_helmet: {
    label: '皮头盔',
    icon: 'item_leather_helmet',
    type: 'armor',
    slot: 'head',
    defense: 1,
    maxStack: 1,
    desc: '皮制头盔。穿在头盔位，防御 1 点。可在附魔台升级。',
  },
  leather_chestplate: {
    label: '皮甲',
    icon: 'item_leather_chestplate',
    type: 'armor',
    slot: 'chest',
    defense: 3,
    maxStack: 1,
    desc: '皮制胸甲。穿在胸甲位，防御 3 点。可在附魔台升级。',
  },
  leather_leggings: {
    label: '皮护腿',
    icon: 'item_leather_leggings',
    type: 'armor',
    slot: 'legs',
    defense: 2,
    maxStack: 1,
    desc: '皮制护腿。穿在护腿位，防御 2 点。可在附魔台升级。',
  },
  iron_helmet: {
    label: '铁头盔',
    icon: 'item_iron_helmet',
    type: 'armor',
    slot: 'head',
    defense: 2,
    maxStack: 1,
    desc: '铁制头盔。穿在头盔位，防御 2 点。可在附魔台升级。',
  },
  iron_chestplate: {
    label: '铁甲',
    icon: 'item_iron_chestplate',
    type: 'armor',
    slot: 'chest',
    defense: 6,
    maxStack: 1,
    desc: '铁制胸甲。穿在胸甲位，防御 6 点。可在附魔台升级。',
  },
  iron_leggings: {
    label: '铁护腿',
    icon: 'item_iron_leggings',
    type: 'armor',
    slot: 'legs',
    defense: 4,
    maxStack: 1,
    desc: '铁制护腿。穿在护腿位，防御 4 点。可在附魔台升级。',
  },
  diamond_helmet: {
    label: '钻石头盔',
    icon: 'item_diamond_helmet',
    type: 'armor',
    slot: 'head',
    defense: 4,
    maxStack: 1,
    desc: '钻石头盔。穿在头盔位，防御 4 点。可在附魔台升级。',
  },
  diamond_chestplate: {
    label: '钻石甲',
    icon: 'item_diamond_chestplate',
    type: 'armor',
    slot: 'chest',
    defense: 9,
    maxStack: 1,
    desc: '钻石胸甲。穿在胸甲位，防御 9 点。可在附魔台升级。',
  },
  diamond_leggings: {
    label: '钻石护腿',
    icon: 'item_diamond_leggings',
    type: 'armor',
    slot: 'legs',
    defense: 6,
    maxStack: 1,
    desc: '钻石护腿。穿在护腿位，防御 6 点。可在附魔台升级。',
  },

  // ---- 弹药 / 消耗品 ----
  arrow: {
    label: '箭',
    icon: 'item_arrow',
    type: 'ammo',
    maxStack: 64,
    desc: '弓的弹药。快捷栏左上角的 ×N 就是余箭数 —— 骷髅、蜘蛛会掉箭，箱子里也有。',
  },
  bread: {
    label: '面包',
    icon: 'item_bread',
    type: 'food',
    heal: 5,
    maxStack: 16,
    desc: '右键食用，回复 5 点生命，同时补充饥饿值。血少时先吃面包再继续打。',
  },
  potion: {
    label: '治疗药水',
    icon: 'item_potion',
    type: 'food',
    heal: 9,
    maxStack: 8,
    desc: '右键食用，回复 9 点生命。比面包强得多，通常在宝箱里。',
  },
  torch: {
    label: '火把',
    icon: 'item_torch',
    type: 'block',
    block: 'torch',
    maxStack: 64,
    desc: '右键插在墙上照明。灯会亮一整条走廊，掉到下层时也能用火把搭路标记。',
  },

  // ---- 材料 ----
  iron: {
    label: '铁锭',
    icon: 'item_iron',
    type: 'material',
    maxStack: 64,
    desc: '附魔材料。锋利、穿透、多重射击这几条附魔都要用铁锭。',
  },
  gold: {
    label: '金锭',
    icon: 'item_gold',
    type: 'material',
    maxStack: 64,
    desc: '附魔材料。火焰、无限这两条附魔要用金锭，苦力怕也会掉落。',
  },
  bone: {
    label: '骨头',
    icon: 'item_bone',
    type: 'material',
    maxStack: 64,
    desc: '附魔材料。亡灵杀手要用骨头，骷髅是主要来源。',
  },
  cobblestone_item: {
    label: '圆石',
    icon: 'item_cobblestone',
    type: 'block',
    block: 'cobblestone',
    maxStack: 64,
    desc: '既是附魔材料（击退要用），也能当建材放置，用来搭路或封堵刷怪笼。',
  },

  // ---- 特殊方块 ----
  block_enchanting_table: {
    label: '附魔台',
    icon: 'enchant_top',
    type: 'block',
    block: 'enchanting_table',
    maxStack: 64,
    desc: '地牢每层都有一座。走近按 E 打开，用经验等级和材料给剑、斧、弓附魔。',
  },
};

/** 可放置方块对应的物品 id（物品 id → 方块注册名）。 */
export const PLACEABLE_BLOCKS = [
  'stone',
  'cobblestone',
  'stone_bricks',
  'mossy_cobble',
  'mossy_bricks',
  'deepslate',
  'dirt',
  'planks',
  'dark_planks',
  'obsidian',
  'end_stone',
  'bricks',
  'sandstone',
  'quartz',
  'glass',
  'netherrack',
  'gold_block',
  'iron_block',
  'iron_ore',
  'gold_ore',
  'diamond_ore',
  'redstone_ore',
  'torch',
  'cobweb',
  'tnt',
  'bookshelf',
  'crafting',
  'furnace',
  'enchanting_table',
];

/** 部分方块的贴图名与方块注册名不一致，需要单独指定图标。 */
const BLOCK_ITEM_ICONS = {
  tnt: 'tnt_top',
  crafting: 'crafting_top',
  furnace: 'furnace_top',
  bookshelf: 'bookshelf',
  grass: 'grass_top',
  enchanting_table: 'enchant_top',
};

/** 方块的中文显示名。 */
const BLOCK_ITEM_LABELS = {
  stone: '石头',
  cobblestone: '圆石',
  stone_bricks: '石砖',
  mossy_cobble: '苔石',
  mossy_bricks: '苔石砖',
  deepslate: '深板岩',
  dirt: '泥土',
  planks: '木板',
  dark_planks: '深色木板',
  obsidian: '黑曜石',
  end_stone: '末地石',
  bricks: '砖块',
  sandstone: '砂岩',
  quartz: '石英块',
  glass: '玻璃',
  netherrack: '下界岩',
  gold_block: '金块',
  iron_block: '铁块',
  iron_ore: '铁矿石',
  gold_ore: '金矿石',
  diamond_ore: '钻石矿石',
  redstone_ore: '红石矿石',
  torch: '火把',
  cobweb: '蜘蛛网',
  tnt: 'TNT',
  bookshelf: '书架',
  crafting: '工作台',
  furnace: '熔炉',
  enchanting_table: '附魔台',
};

/** 方块的用途说明；没有写到的方块用通用说明。 */
const BLOCK_ITEM_DESCS = {
  torch: '右键插在墙上照明。灯会亮一整条走廊，掉到下层时也能用火把搭路标记。',
  tnt: '只是装饰用的炸药桶，目前不会爆炸。可以拿来堵住门口或封住刷怪笼。',
  cobweb: '纯装饰的蜘蛛网，可以贴墙挡视线。目前不会减速敌人。',
  bookshelf: '纯装饰。摆一排书架能布置出书房、藏书架的感觉。',
  crafting: '纯装饰的工作台。地牢里暂时不能合成物品。',
  furnace: '纯装饰的熔炉，暂时不能熔炼矿石。',
  enchanting_table: '地牢每层都有一座。走近按 E 打开，用经验等级和材料给剑、斧、弓附魔。',
  glass: '透明的建材。放上去能挡住怪物视线，又不会把房间封死。',
  obsidian: '非常坚硬的黑曜石（硬度 12），挖不动，适合当永久路障。',
  end_stone: '末地石，末影龙祭坛一带的材质。',
  gold_block: '金块，装饰用的高级建材。',
  iron_block: '铁块，装饰用的高级建材。',
  stone: '最常见的建材。硬度低，挖起来快，适合临时搭路和垫脚。',
  stone_bricks: '石砖，比普通石头好看，硬度也高一点，适合砌墙挡怪。',
  mossy_cobble: '苔石，长了青苔的老石头，硬度和圆石差不多。',
  mossy_bricks: '苔石砖，废墟里常见的旧砖墙。',
  deepslate: '深板岩，比石头硬得多（硬度 3），适合造结实的墙。',
  dirt: '泥土，很软，一挖就碎。垫脚、填坑都行。',
  planks: '木板，常见的建材，硬度 2。',
  dark_planks: '深色木板，比普通木板暗一些，适合做地板。',
  bricks: '砖块，砌墙好看又结实。',
  sandstone: '砂岩，硬度 3，常见于沙漠层。',
  quartz: '石英块，白色的高级建材，硬度 3。',
  netherrack: '下界岩，暗红色的石头，硬度低好挖。',
  iron_ore: '铁矿石。挖了掉铁锭 —— 附魔材料之一。',
  gold_ore: '金矿石。挖了掉金锭 —— 附魔材料之一。',
  diamond_ore: '钻石矿石。战利品里最值钱的一块。',
  redstone_ore: '红石矿石，会微微发光，看起来就很值钱。',
};

/** 通用方块说明。 */
const DEFAULT_BLOCK_DESC = '可以右键放置的建材，用来搭路、封路、挡视线或临时垫脚。';

/**
 * 已经有手写物品条目覆盖的方块：不再重复生成 block_* 条目，
 * 否则物品图鉴里会出现两条同名的「圆石」「火把」。
 * 值是覆盖它的那件物品 id（仅作说明用，判断只看键是否存在）。
 */
const BLOCK_ITEM_ALIASES = {
  torch: 'torch',
  cobblestone: 'cobblestone_item',
};

/** 为可放置方块自动生成物品条目。 */
for (const blockName of PLACEABLE_BLOCKS) {
  const id = `block_${blockName}`;
  if (ITEMS[id] || Object.hasOwn(BLOCK_ITEM_ALIASES, blockName)) continue;
  ITEMS[id] = {
    label: BLOCK_ITEM_LABELS[blockName] || `方块·${blockName}`,
    icon: BLOCK_ITEM_ICONS[blockName] || blockName,
    type: 'block',
    block: blockName,
    maxStack: 64,
    desc: BLOCK_ITEM_DESCS[blockName] || DEFAULT_BLOCK_DESC,
  };
}

/**
 * @param {string} id
 * @returns {ItemDef|null}
 */
export function itemDef(id) {
  return ITEMS[id] || null;
}

/**
 * @param {string} id
 * @returns {string}
 */
export function itemLabel(id) {
  const def = ITEMS[id];
  return def ? def.label : id;
}

/**
 * 物品的用途说明（界面提示与物品图鉴都用它）。
 * @param {string} id
 * @returns {string}
 */
export function itemDesc(id) {
  const def = ITEMS[id];
  return def ? def.desc || '' : '';
}
