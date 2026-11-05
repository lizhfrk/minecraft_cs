/**
 * 难度预设：控制刷怪频率、同屏怪物上限与怪物伤害。
 * @module core/difficulty
 */

/**
 * @typedef {object} DifficultyDef
 * @property {string} id 唯一 id
 * @property {string} label 显示名
 * @property {string} desc 一句话说明
 * @property {number} maxNearby 玩家身边同时存在的怪物上限（刷怪笼受此限制）
 * @property {number} maxPerSpawner 单个刷怪笼附近（12 米内）的怪物上限
 * @property {number} spawnInterval 刷怪笼的刷怪间隔（秒）
 * @property {number} spawnJitter 刷怪间隔的随机浮动（秒）
 * @property {number} spawnRadius 刷怪笼的生效半径（米）
 * @property {number} damageScale 怪物造成的伤害倍率
 */

/** 判定「身边」的半径（米）。 */
export const NEARBY_RADIUS = 30;

/**
 * 「身边」的垂直容差（米）。
 * 楼层间距 14~16 米，取 12 是为了只统计同一层的怪，
 * 不让楼上楼下的怪白白占掉玩家身边的额度。
 */
export const NEARBY_Y_TOLERANCE = 12;

/**
 * 初始怪物的分配规则。
 * budget = 整座地牢预置怪物的目标总数（会尽量分配满）。
 * denseMax / sparseMax = 刷怪间与墓穴 / 其余房间各自最多放几只；
 * 预算还有剩时这个上限会被放宽，保证 budget 是硬性目标。
 */
export const ROOM_POP = {
  easy: { budget: 5, denseMax: 1, sparseMax: 1 },
  normal: { budget: 11, denseMax: 2, sparseMax: 1 },
  hard: { budget: 19, denseMax: 3, sparseMax: 1 },
};

/** @type {Record<string, DifficultyDef>} */
export const DIFFICULTIES = {
  easy: {
    id: 'easy',
    label: '简单',
    desc: '身边最多 4 只怪，伤害只有六成。适合先熟悉地形和武器。',
    maxNearby: 4,
    maxPerSpawner: 2,
    spawnInterval: 30,
    spawnJitter: 12,
    spawnRadius: 12,
    damageScale: 0.6,
  },
  normal: {
    id: 'normal',
    label: '普通',
    desc: '身边最多 7 只怪，刷怪笼每十几秒补一只，但不会无限堆积。',
    maxNearby: 7,
    maxPerSpawner: 3,
    spawnInterval: 18,
    spawnJitter: 8,
    spawnRadius: 16,
    damageScale: 1,
  },
  hard: {
    id: 'hard',
    label: '困难',
    desc: '身边最多 11 只怪，刷怪笼频繁补怪，怪物伤害也更高。',
    maxNearby: 11,
    maxPerSpawner: 4,
    spawnInterval: 11,
    spawnJitter: 6,
    spawnRadius: 22,
    damageScale: 1.4,
  },
};

/** 默认难度。 */
export const DEFAULT_DIFFICULTY = 'normal';

/** 难度在本地存储里的键。 */
const STORAGE_KEY = 'mc-cs-difficulty';

/**
 * 读取玩家上次选择的难度。
 * @returns {DifficultyDef}
 */
export function loadDifficulty() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    // 用 hasOwn 判断，避免 'constructor' 之类的原型属性被当成合法难度
    if (saved && Object.hasOwn(DIFFICULTIES, saved)) return DIFFICULTIES[saved];
  } catch {
    // localStorage 不可用（隐私模式等），退回默认难度
  }
  return DIFFICULTIES[DEFAULT_DIFFICULTY];
}

/**
 * 记住玩家选择的难度。
 * @param {string} id
 */
export function saveDifficulty(id) {
  try {
    localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // 存不进去也不影响本次游戏
  }
}
