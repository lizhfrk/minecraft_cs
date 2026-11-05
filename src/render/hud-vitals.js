/**
 * HUD 血条 / 饥饿条的纯逻辑：图标掩码、填充状态、布局计算。
 *
 * 单独拆出来是为了能脱离画布直接断言 —— 满血必须是满格、小数血量不能画成
 * 空条、血条变长时不能压到经验条，这些都能靠这里的纯函数测出来。
 *
 * @module render/hud-vitals
 */

/** 每颗心 / 每根鸡腿代表的点数。 */
export const POINTS_PER_ICON = 2;
/** 生命主行最多画几颗心（10 颗 = 20 点生命，和 Minecraft 一致）。 */
export const HEART_ROW_ICONS = 10;
/** 生命上限高于主行时，溢出那行最多画几颗心（防御性上限，当前用不到）。 */
export const OVERFLOW_MAX_ICONS = 8;
/** 饥饿上限（点）。 */
export const MAX_HUNGER = 20;

/** 心形掩码（9×8）。 */
export const HEART_MASK = [
  '.XX...XX.',
  'XXXXXXXXX',
  'XXXXXXXXX',
  'XXXXXXXXX',
  '.XXXXXXX.',
  '..XXXXX..',
  '...XXX...',
  '....X....',
];

/** 鸡腿掩码（9×8）。 */
export const FOOD_MASK = [
  '...XXX...',
  '..XXXXX..',
  '.XXXXXXX.',
  '.XXXXXXX.',
  '..XXXXX..',
  '...XXXX..',
  '....XX...',
  '.........',
];

/**
 * 计算一行「半格图标」的填充状态。
 *
 * 每颗心 / 每根鸡腿代表 **2 点**数值，所以参数传的是原始点数而不是格子数。
 * 返回值每项是一个格子的状态：2 = 满格，1 = 半格，0 = 空。
 *
 * 护甲减伤会让血量变成小数（比如 17.9），所以「半格」的判定用 `> 0`
 * 而不是 `=== 1` —— 否则 1.5 血会被画成一颗空心，看着像已经阵亡。
 *
 * @param {number} value 当前点数（生命 / 饥饿）
 * @param {number} maxValue 最大点数，决定画几格
 * @returns {number[]} 每格 2（满）/ 1（半）/ 0（空）
 */
export function rowFill(value, maxValue) {
  const v = Number.isFinite(value) ? value : 0;
  const max = Number.isFinite(maxValue) ? Math.max(0, maxValue) : 0;
  const icons = Math.max(1, Math.ceil(max / POINTS_PER_ICON));
  const fills = [];
  for (let i = 0; i < icons; i++) {
    const remaining = v - i * POINTS_PER_ICON;
    fills.push(remaining >= POINTS_PER_ICON ? 2 : remaining > 0 ? 1 : 0);
  }
  return fills;
}

/**
 * 生命条的分行填充状态。
 *
 * 主行固定 {@link HEART_ROW_ICONS} 颗心（20 点生命）；超过 20 点的部分
 * （护甲「生命」附魔）单独放进 overflow 行，画在防具槽上方一行 ——
 * 这样血条变长时不会伸进中间的经验条里被盖住。
 *
 * 行宽按 `max(maxHealth, health)` 计算：血量高于上限时（正常不会发生，
 * 因为穿脱护甲都会夹紧血量）溢出行会把超出的部分也显示出来，
 * 也就是「显示真实血量」而不是「按上限截断」。
 *
 * @param {number} health 当前生命点数（不是心数）
 * @param {number} maxHealth 生命上限点数
 * @returns {{main: number[], overflow: number[]}} 每项为 2（满）/ 1（半）/ 0（空）
 */
export function heartRowFills(health, maxHealth) {
  const hp = Number.isFinite(health) ? health : 0;
  const cap = Number.isFinite(maxHealth) ? Math.max(maxHealth, hp) : hp;
  const mainPoints = POINTS_PER_ICON * HEART_ROW_ICONS;
  const overflowMax = Math.max(0, Math.min(cap - mainPoints, OVERFLOW_MAX_ICONS * POINTS_PER_ICON));
  return {
    main: rowFill(hp, mainPoints),
    overflow: overflowMax > 0 ? rowFill(Math.max(0, hp - mainPoints), overflowMax) : [],
  };
}

/**
 * 饥饿行的填充状态（每根鸡腿 2 点饥饿）。
 * @param {number} hunger 当前饥饿点数
 * @returns {number[]}
 */
export function foodRowFill(hunger) {
  return rowFill(hunger, MAX_HUNGER);
}

/**
 * 计算 HUD 血条 / 饥饿条 / 经验条 / 防具槽 / 箭矢行的布局。
 *
 * 抽成纯函数是为了能直接断言几何关系（比如血条不能压到经验条上），
 * 不用再靠截图去猜。
 *
 * @param {{health:number, maxHealth:number, hunger:number}} player
 * @param {number} width 画布宽度（CSS 像素）
 * @param {number} height 画布高度（CSS 像素）
 * @param {number} scale 像素缩放
 * @returns {object} 布局数据
 */
export function computeVitalsLayout(player, width, height, scale) {
  const s = scale;
  const slot = 40 * s;
  const gap = 2 * s;
  const total = slot * 9 + gap * 8;
  const hotbarX = (width - total) / 2;
  const hotbarY = height - slot - 14 * s;
  const iconSize = 9 * s;
  const rowGap = 1 * s;
  const armorSlotSize = 16 * s;
  const armorSlotGap = 2 * s;
  const armorRight = hotbarX + total;
  // 槽子比原来的 8px 护甲图标高，这里让底边与原护甲行对齐，避免压到生命 hearts
  const armorY = hotbarY - iconSize * 2 - 6 * s - (armorSlotSize - 8 * s);
  const xpBarW = 160 * s;

  /** 右对齐一排图标：右边缘与快捷栏右边缘一致。 */
  const rightAlign = (count) =>
    hotbarX + total - rowGap - (count - 1) * (iconSize + rowGap) - iconSize;

  const hearts = heartRowFills(player.health, player.maxHealth);
  const food = foodRowFill(player.hunger);
  const vitalsY = hotbarY - iconSize - 4 * s;
  const arrowY = hotbarY - iconSize * 2 - 6 * s;

  return {
    hotbarX,
    hotbarY,
    total,
    iconSize,
    rowGap,
    heart: { fills: hearts.main, x: rightAlign(hearts.main.length), y: vitalsY },
    // 溢出生命画在防具槽上方一行，避免主行伸长后压到经验条
    overflow: {
      fills: hearts.overflow,
      x: rightAlign(hearts.overflow.length),
      y: armorY - 10 * s,
    },
    food: { fills: food, x: hotbarX, y: vitalsY },
    armor: { y: armorY, size: armorSlotSize, gap: armorSlotGap, right: armorRight },
    // 「护甲 N」文字画在三个槽位左边
    armorText: {
      x: armorRight - 3 * armorSlotSize - 2 * armorSlotGap - 6 * s,
      y: armorY + armorSlotSize * 0.75,
    },
    arrow: { x: hotbarX, y: arrowY },
    xp: {
      x: hotbarX + total / 2 - xpBarW / 2,
      y: hotbarY - iconSize - 2 * s,
      w: xpBarW,
      h: 5 * s,
    },
  };
}
