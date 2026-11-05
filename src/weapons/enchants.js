/**
 * 附魔系统：附魔定义、消耗与效果汇总。
 * 武器升级通过地牢中的「附魔台」进行，消耗经验等级与材料。
 * @module weapons/enchants
 */

import { ITEMS } from './items.js';

/**
 * @typedef {object} EnchantDef
 * @property {string} id 唯一 id
 * @property {string} name 显示名
 * @property {'melee'|'bow'|'armor'} kind 适用的对象类型：近战武器 / 弓 / 防具
 * @property {number} maxLevel 最高等级
 * @property {(level:number)=>number} levelCost 消耗的经验等级
 * @property {string} material 材料物品 id
 * @property {(level:number)=>number} materialCount 材料数量
 * @property {(level:number)=>string} desc 效果说明
 */

/** 每件武器最多附魔数量。 */
export const MAX_ENCHANTS = 2;

/** @type {Record<string, EnchantDef>} */
export const ENCHANTS = {
  sharpness: {
    id: 'sharpness',
    name: '锋利',
    kind: 'melee',
    maxLevel: 3,
    levelCost: (lv) => lv,
    material: 'iron',
    materialCount: (lv) => lv,
    desc: (lv) => `近战伤害 +${(1.25 * lv).toFixed(2)}`,
  },
  fire: {
    id: 'fire',
    name: '火焰',
    kind: 'melee',
    maxLevel: 2,
    levelCost: (lv) => lv + 1,
    material: 'gold',
    materialCount: (lv) => lv,
    desc: (lv) => `点燃敌人，${lv * 3} 秒内每秒灼烧 ${lv} 点`,
  },
  knockback: {
    id: 'knockback',
    name: '击退',
    kind: 'melee',
    maxLevel: 2,
    levelCost: (lv) => lv,
    material: 'cobblestone_item',
    materialCount: (lv) => lv + 1,
    desc: (lv) => `击退力 +${(0.8 * lv).toFixed(1)}`,
  },
  undead_bane: {
    id: 'undead_bane',
    name: '亡灵杀手',
    kind: 'melee',
    maxLevel: 2,
    levelCost: (lv) => lv + 1,
    material: 'bone',
    materialCount: (lv) => lv,
    desc: (lv) => `对僵尸与骷髅额外造成 ${2 * lv} 点伤害`,
  },
  infinity: {
    id: 'infinity',
    name: '无限',
    kind: 'bow',
    maxLevel: 1,
    levelCost: () => 4,
    material: 'gold',
    materialCount: () => 3,
    desc: () => '射箭不再消耗箭矢',
  },
  pierce: {
    id: 'pierce',
    name: '穿透',
    kind: 'bow',
    maxLevel: 2,
    levelCost: (lv) => lv + 1,
    material: 'iron',
    materialCount: (lv) => lv,
    desc: (lv) => `箭可以额外穿透 ${lv} 个敌人`,
  },
  multishot: {
    id: 'multishot',
    name: '多重射击',
    kind: 'bow',
    maxLevel: 1,
    levelCost: () => 3,
    material: 'iron',
    materialCount: () => 2,
    desc: () => '一次射出 3 支箭',
  },
  protection: {
    id: 'protection',
    name: '保护',
    kind: 'armor',
    maxLevel: 3,
    levelCost: (lv) => lv + 1,
    material: 'iron',
    materialCount: (lv) => lv + 1,
    desc: (lv) => `受到的所有伤害降低 ${lv * 8}%`,
  },
  toughness: {
    id: 'toughness',
    name: '坚韧',
    kind: 'armor',
    maxLevel: 3,
    levelCost: (lv) => lv + 1,
    material: 'cobblestone_item',
    materialCount: (lv) => lv + 2,
    desc: (lv) => `护甲防御 +${lv}`,
  },
  thorns: {
    id: 'thorns',
    name: '荆棘',
    kind: 'armor',
    maxLevel: 2,
    levelCost: (lv) => lv + 1,
    material: 'bone',
    materialCount: (lv) => lv + 1,
    desc: (lv) => `反弹 ${lv * 2} 点伤害给攻击者`,
  },
  vitality: {
    id: 'vitality',
    name: '生命',
    kind: 'armor',
    maxLevel: 2,
    levelCost: (lv) => lv + 1,
    material: 'gold',
    materialCount: (lv) => lv + 1,
    desc: (lv) => `最大生命 +${lv * 2}`,
  },
};

/**
 * 物品 id → 附魔类别。防具（type 为 'armor'）走 'armor' 分支。
 * @param {string|null} itemId
 * @returns {'melee'|'bow'|'armor'|null}
 */
export function enchantKind(itemId) {
  if (ITEMS[itemId]?.type === 'armor') return 'armor';
  if (itemId === 'bow') return 'bow';
  if (itemId === 'iron_sword' || itemId === 'stone_axe') return 'melee';
  return null;
}

/**
 * 某类别可用的附魔列表。
 * @param {'melee'|'bow'|'armor'} kind
 */
export function enchantsForKind(kind) {
  return Object.values(ENCHANTS).filter((e) => e.kind === kind);
}

/**
 * 已附魔列表中某个附魔的等级（没有则 0）。
 * @param {{id:string, level:number}[]} list @param {string} id
 */
export function enchantLevel(list, id) {
  if (!list) return 0;
  const found = list.find((e) => e.id === id);
  return found ? found.level : 0;
}

/**
 * 汇总一件装备所有附魔的数值效果。
 * @param {{id:string, level:number}[]} list
 */
export function enchantSummary(list) {
  const s = {
    damage: 0,
    knockback: 0,
    burn: 0,
    undeadBonus: 0,
    pierce: 0,
    infinite: false,
    multishot: 1,
    armorBonus: 0, // 坚韧提供的额外防御点数
    protection: 0, // 保护提供的减伤百分比（0~1）
    thorns: 0, // 荆棘反弹的伤害
    vitality: 0, // 生命提供的最大生命加成
  };
  if (!list) return s;
  for (const e of list) {
    switch (e.id) {
      case 'sharpness':
        s.damage += 1.25 * e.level;
        break;
      case 'fire':
        s.burn = Math.max(s.burn, e.level);
        break;
      case 'knockback':
        s.knockback += 0.8 * e.level;
        break;
      case 'undead_bane':
        s.undeadBonus += 2 * e.level;
        break;
      case 'pierce':
        s.pierce += e.level;
        break;
      case 'infinity':
        s.infinite = true;
        break;
      case 'multishot':
        s.multishot = 3;
        break;
      case 'toughness':
        s.armorBonus += e.level;
        break;
      case 'protection':
        s.protection += e.level * 0.08;
        break;
      case 'thorns':
        s.thorns += e.level * 2;
        break;
      case 'vitality':
        s.vitality += e.level * 2;
        break;
      default:
        break;
    }
  }
  return s;
}

/**
 * 随机生成附魔台的三个选项。
 * @param {import('../core/utils.js').RNG} rng
 * @param {'melee'|'bow'|'armor'} kind
 * @param {{id:string, level:number}[]} current 当前已附魔
 * @param {number} [count] 选项数量
 */
export function rollOptions(rng, kind, current, count = 3) {
  const pool = enchantsForKind(kind).filter((def) => {
    const lv = enchantLevel(current, def.id);
    return lv < def.maxLevel;
  });
  const picked = [];
  const used = new Set();
  let guard = 0;
  while (picked.length < count && pool.length > 0 && guard++ < 64) {
    const def = rng.pick(pool);
    if (used.has(def.id)) {
      // 该附魔已选过：换一个不重复的
      const alt = pool.find((p) => !used.has(p.id));
      if (!alt) break;
      used.add(alt.id);
      picked.push(alt);
      continue;
    }
    used.add(def.id);
    picked.push(def);
  }
  return picked.map((def) => {
    const cur = enchantLevel(current, def.id);
    const level = Math.min(def.maxLevel, cur + 1);
    return {
      id: def.id,
      name: def.name,
      level,
      levelCost: def.levelCost(level),
      material: def.material,
      materialCount: def.materialCount(level),
      desc: def.desc(level),
    };
  });
}
