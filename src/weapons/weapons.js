/**
 * 武器数值：近战 / 弓。
 * @module weapons/weapons
 */

/**
 * @typedef {object} WeaponDef
 * @property {string} kind melee|bow
 * @property {number} damage 满蓄力伤害
 * @property {number} cooldown 攻击间隔（秒）
 * @property {number} range 攻击距离（格）
 * @property {number} [miningSpeed] 挖掘速度倍率
 * @property {number} [swingTime] 挥砍动画时长
 * @property {number} [knockback] 击退强度
 */

/** @type {Record<string, WeaponDef>} */
export const WEAPONS = {
  iron_sword: {
    kind: 'melee',
    damage: 5,
    cooldown: 0.42,
    range: 3.4,
    swingTime: 0.26,
    knockback: 5.5,
    miningSpeed: 1.4,
  },
  stone_axe: {
    kind: 'melee',
    damage: 6.5,
    cooldown: 0.62,
    range: 3.1,
    swingTime: 0.34,
    knockback: 6.5,
    miningSpeed: 2.6,
  },
  bow: {
    kind: 'bow',
    damage: 10,
    cooldown: 0.35,
    range: 60,
    swingTime: 0.2,
    drawTime: 1.0,
    minSpeed: 20,
    maxSpeed: 52,
  },
};

/**
 * @param {string} itemId
 * @returns {WeaponDef|null}
 */
export function weaponOf(itemId) {
  return WEAPONS[itemId] || null;
}

/**
 * 计算弓箭的蓄力系数（0-1）。
 * @param {number} drawTime 已蓄力时长 @param {number} required 需要的时间
 */
export function bowCharge(drawTime, required) {
  if (required <= 0) return 1;
  return Math.min(1, drawTime / required);
}
