/**
 * 地牢的楼层信息。
 *
 * 单独成模块是为了能直接测试 —— 层号判定决定「指引指向哪一层」，
 * 不能只靠跑一遍游戏来验证。
 *
 * @module core/floors
 */

/** 每层地板的高度（从上到下）。 */
export const FLOOR_Y = [58, 42, 26, 12];

/**
 * 某个高度属于第几层（0 = 第 1 层，最上层）。
 *
 * 取「离这个高度最近」的一层；两层一样近时算上面那层 —— 这样玩家在竖井里
 * 往下走的时候还算在上一层，指向的阶梯不会提前跳级。
 *
 * @param {number} y 世界高度
 * @returns {number}
 */
export function floorIndexAt(y) {
  let best = 0;
  let bestDist = Infinity;
  for (let i = 0; i < FLOOR_Y.length; i++) {
    const d = Math.abs(FLOOR_Y[i] - y);
    if (d < bestDist) {
      bestDist = d;
      best = i;
    }
  }
  return best;
}
