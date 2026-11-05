/**
 * HUD：全部用 2D Canvas 绘制，模仿 Minecraft 的界面质感。
 * @module render/hud
 */
import { ITEMS, itemDesc } from '../weapons/items.js';
import { ENCHANTS } from '../weapons/enchants.js';
import {
  HEART_MASK,
  FOOD_MASK,
  computeVitalsLayout,
  heartRowFills,
  foodRowFill,
} from './hud-vitals.js';
import { drawMinimap, drawObjectiveBar, drawEdgeMarker } from './hud-minimap.js';
import { objectiveBearingAngle } from './hud-nav.js';

// 血条 / 饥饿条的纯逻辑在 hud-vitals.js，这里原样再导出，方便外部直接引用。
export {
  HEART_MASK,
  FOOD_MASK,
  computeVitalsLayout,
  heartRowFills,
  foodRowFill,
} from './hud-vitals.js';

/** 附魔等级 → 罗马数字。 */
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V'];

/** 不能出现在行首的收尾标点。 */
const CLOSING_PUNCTUATION = '。，、；：？！）」》】…·';

const ARROW_MASK = [
  '....X....',
  '...XX....',
  '..XXX....',
  '.XXXX....',
  'XXXXX....',
  '..XXX....',
  '.XXXXX...',
  'XX...XX..',
];

export class HUD {
  /**
   * @param {HTMLCanvasElement} canvas
   * @param {{canvas:HTMLCanvasElement, tileRect:(name:string)=>any}} atlas
   */
  constructor(canvas, atlas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.atlas = atlas;
    this.width = 0;
    this.height = 0;
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.scale = 1;
    this.resize();
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    this.width = window.innerWidth;
    this.height = window.innerHeight;
    this.canvas.width = this.width * this.dpr;
    this.canvas.height = this.height * this.dpr;
    this.canvas.style.width = `${this.width}px`;
    this.canvas.style.height = `${this.height}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.scale = Math.max(1, Math.min(2, Math.round(this.height / 480)));
  }

  /* -------------------------------------------------------------- */
  /*                            绘制工具                             */
  /* -------------------------------------------------------------- */

  /**
   * 绘制像素图标。
   * @param {string[]} mask @param {number} x @param {number} y @param {number} s @param {string} color
   * @param {number} [clipRight] 只绘制右半边（半颗心）
   */
  drawMask(mask, x, y, s, color, clipRight = 0) {
    const ctx = this.ctx;
    ctx.fillStyle = color;
    for (let r = 0; r < mask.length; r++) {
      const row = mask[r];
      for (let c = 0; c < row.length; c++) {
        if (row[c] !== 'X') continue;
        if (clipRight === 1 && c < row.length / 2) continue;
        if (clipRight === 2 && c >= row.length / 2) continue;
        ctx.fillRect(x + c * s, y + r * s, s, s);
      }
    }
  }

  /**
   * 从图集绘制物品图标。
   * @param {string} icon @param {number} x @param {number} y @param {number} size
   */
  drawItemIcon(icon, x, y, size) {
    const rect = this.atlas.tileRect(icon);
    if (!rect) return;
    const ctx = this.ctx;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.atlas.canvas, rect.sx, rect.sy, rect.w, rect.h, x, y, size, size);
  }

  /** 带描边的文字。 */
  text(str, x, y, size = 13, color = '#ffffff', align = 'left', shadow = true) {
    const ctx = this.ctx;
    ctx.font = `${size}px "Courier New", "PingFang SC", monospace`;
    ctx.textAlign = align;
    ctx.textBaseline = 'alphabetic';
    if (shadow) {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.fillText(str, x + 2, y + 2);
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
  }

  /**
   * 量一段文字的像素宽度。
   * @param {string} str @param {number} size
   * @returns {number}
   */
  textWidth(str, size) {
    this.ctx.font = `${size}px "Courier New", "PingFang SC", monospace`;
    return this.ctx.measureText(str).width;
  }

  /**
   * 按像素宽度折行（中文按字断行）。
   *
   * 收尾标点（。，、）」等）会粘在前一个字上不拆开 —— 这样任何一行都不会以标点开头，
   * 也不会出现「。」独占一行的孤行。断行只发生在单元之间，因此也不会超出 maxWidth。
   *
   * @param {string} str @param {number} maxWidth @param {number} size
   * @returns {string[]}
   */
  wrapText(str, maxWidth, size) {
    if (!str) return [];
    const ctx = this.ctx;
    ctx.font = `${size}px "Courier New", "PingFang SC", monospace`;

    // 拆成「不可分割的单元」：一个字 + 它后面跟着的所有收尾标点
    const units = [];
    for (const ch of str) {
      if (CLOSING_PUNCTUATION.includes(ch) && units.length > 0) {
        units[units.length - 1] += ch;
      } else {
        units.push(ch);
      }
    }

    const lines = [];
    let line = '';
    for (const unit of units) {
      const test = line + unit;
      if (line && ctx.measureText(test).width > maxWidth) {
        lines.push(line);
        line = unit;
      } else {
        line = test;
      }
    }
    if (line) lines.push(line);
    return lines;
  }

  /* -------------------------------------------------------------- */
  /*                              主绘制                              */
  /* -------------------------------------------------------------- */

  /**
   * @param {object} state 游戏状态快照
   */
  render(state) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.width, this.height);
    ctx.imageSmoothingEnabled = false;

    if (state.damageFlash > 0) this.drawVignette(state.damageFlash);
    if (state.lowHealth > 0) this.drawLowHealth(state.lowHealth);

    this.drawCrosshair(state);
    this.drawHotbar(state);
    this.drawHeldItem(state);
    this.drawVitals(state);
    this.drawBossBar(state);
    this.drawNotifications(state);
    this.drawKillFeed(state);
    this.drawObjective(state);
    drawObjectiveBar(this, state);
    drawMinimap(this, state);
    // 边缘箭头最后画：万一和小地图重叠，也要看得见
    drawEdgeMarker(this, state);
    if (state.hint) this.drawHint(state.hint);
  }

  /** 底部提示条。 */
  drawHint(text) {
    const ctx = this.ctx;
    const size = 13;
    ctx.font = `${size}px "Courier New", "PingFang SC", monospace`;
    const w = ctx.measureText(text).width + 28;
    const x = (this.width - w) / 2;
    // 提示条最后画，会盖住下面的东西 —— 血条（含「生命」附魔时多出来的那行）
    // 最高能到 height - 96 * scale，所以这里取两者中更靠上的那个位置。
    const y = Math.min(this.height - 210, this.height - 96 * this.scale - 30);
    ctx.fillStyle = 'rgba(12,14,18,0.78)';
    ctx.fillRect(x, y, w, 26);
    ctx.strokeStyle = 'rgba(255,216,61,0.5)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x + 1, y + 1, w - 2, 24);
    this.text(text, this.width / 2, y + 18, size, '#ffd83d', 'center');
  }

  /** 受击红晕。 */
  drawVignette(amount) {
    const ctx = this.ctx;
    const g = ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      this.height * 0.28,
      this.width / 2,
      this.height / 2,
      this.height * 0.78
    );
    g.addColorStop(0, 'rgba(180,0,0,0)');
    g.addColorStop(1, `rgba(180,0,0,${Math.min(0.65, amount)})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  /** 低血量心跳边框。 */
  drawLowHealth(amount) {
    const ctx = this.ctx;
    const pulse = 0.18 + Math.sin(performance.now() / 260) * 0.1;
    const g = ctx.createRadialGradient(
      this.width / 2,
      this.height / 2,
      this.height * 0.3,
      this.width / 2,
      this.height / 2,
      this.height * 0.8
    );
    g.addColorStop(0, 'rgba(120,0,0,0)');
    g.addColorStop(1, `rgba(120,0,0,${pulse * amount})`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.width, this.height);
  }

  /** 准星（CS 风格，随移动/开火扩散）。 */
  drawCrosshair(state) {
    const ctx = this.ctx;
    const cx = this.width / 2;
    const cy = this.height / 2;
    const gap = 3 + state.crosshairSpread * 12;
    const len = 5;
    const thickness = 2;
    const color = state.crosshairOnEnemy ? '#ff4444' : '#e8f4ff';

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    for (const [dx, dy] of [
      [0, -1],
      [0, 1],
      [-1, 0],
      [1, 0],
    ]) {
      ctx.fillRect(cx + dx * gap - thickness, cy + dy * gap - thickness, len + thickness * 2, len + thickness * 2);
    }
    ctx.fillStyle = color;
    ctx.fillRect(cx - thickness / 2, cy - gap - len, thickness, len);
    ctx.fillRect(cx - thickness / 2, cy + gap, thickness, len);
    ctx.fillRect(cx - gap - len, cy - thickness / 2, len, thickness);
    ctx.fillRect(cx + gap, cy - thickness / 2, len, thickness);
    ctx.fillRect(cx - 1, cy - 1, 2, 2);

    // 命中标记
    if (state.hitmarker > 0) {
      const a = Math.min(1, state.hitmarker);
      ctx.strokeStyle = state.hitmarkerKill ? `rgba(255,80,80,${a})` : `rgba(255,255,255,${a})`;
      ctx.lineWidth = 2;
      const d = 5 + (1 - a) * 4;
      const l = 6;
      ctx.beginPath();
      ctx.moveTo(cx - d, cy - d);
      ctx.lineTo(cx - d - l, cy - d - l);
      ctx.moveTo(cx + d, cy - d);
      ctx.lineTo(cx + d + l, cy - d - l);
      ctx.moveTo(cx - d, cy + d);
      ctx.lineTo(cx - d - l, cy + d + l);
      ctx.moveTo(cx + d, cy + d);
      ctx.lineTo(cx + d + l, cy + d + l);
      ctx.stroke();
    }
  }

  /** 快捷栏。 */
  drawHotbar(state) {
    const ctx = this.ctx;
    const s = this.scale;
    const slot = 40 * s;
    const gap = 2 * s;
    const total = slot * 9 + gap * 8;
    const x0 = (this.width - total) / 2;
    const y0 = this.height - slot - 14 * s;
    const player = state.player;

    // 背板
    ctx.fillStyle = 'rgba(16,16,16,0.78)';
    ctx.fillRect(x0 - 3 * s, y0 - 3 * s, total + 6 * s, slot + 6 * s);
    ctx.fillStyle = 'rgba(90,90,90,0.9)';
    ctx.fillRect(x0 - 3 * s, y0 - 3 * s, total + 6 * s, 2 * s);

    for (let i = 0; i < 9; i++) {
      const x = x0 + i * (slot + gap);
      const selected = i === player.selected;
      ctx.fillStyle = selected ? 'rgba(255,255,255,0.22)' : 'rgba(60,60,60,0.55)';
      ctx.fillRect(x, y0, slot, slot);
      ctx.strokeStyle = selected ? '#ffffff' : 'rgba(30,30,30,0.9)';
      ctx.lineWidth = selected ? 3 : 2;
      ctx.strokeRect(x + 1, y0 + 1, slot - 2, slot - 2);

      const item = player.hotbar[i];
      if (item) {
        const def = ITEMS[item.id];
        const icon = def ? def.icon : 'item_iron';
        this.drawItemIcon(icon, x + 4 * s, y0 + 4 * s, slot - 8 * s);
        if (item.count > 1) {
          this.text(String(item.count), x + slot - 4 * s, y0 + slot - 4 * s, 12 * s, '#ffffff', 'right');
        }
      }
    }
  }

  /**
   * 手持物品说明面板：图标 + 名称 + 用途 + 附魔。
   * 光看图标认不出东西，所以把手上的物品信息常驻显示出来。
   * 面板放在快捷栏左侧的空白处，避免和血条、经验条、小地图挤在一起。
   */
  drawHeldItem(state) {
    const ctx = this.ctx;
    const s = this.scale;
    const player = state.player;
    const slot = player.hotbar[player.selected];
    if (!slot) return;
    const def = ITEMS[slot.id];
    if (!def) return;

    // 快捷栏左侧能用的宽度
    const slotSize = 40 * s;
    const hotbarGap = 2 * s;
    const hotbarTotal = slotSize * 9 + hotbarGap * 8;
    const hotbarX = (this.width - hotbarTotal) / 2;
    const marginW = hotbarX - 3 * s - 10;
    if (marginW < 130) return; // 屏幕太窄就不画了，指南里仍能查到

    const ps = Math.min(s, 1.25); // 面板用略小的字号，免得在高分辨率下糊满屏幕
    const panelW = Math.min(258, marginW);
    const padX = 8 * ps;
    const iconSize = 28 * ps;
    const titleSize = 13 * ps;
    const descSize = 10.5 * ps;
    const rowH = 14 * ps;

    const descLines = this.wrapText(itemDesc(slot.id), panelW - padX * 2, descSize).slice(0, 4);
    const enchantLines = (player.getEnchants ? player.getEnchants(slot.id) : [])
      .map((e) => {
        const ed = ENCHANTS[e.id];
        if (!ed) return null;
        return `${ed.name} ${ROMAN[e.level] || e.level} · ${ed.desc(e.level)}`;
      })
      .filter(Boolean)
      .slice(0, 2);
    const enchantWrapped = enchantLines.flatMap((line) =>
      this.wrapText(line, panelW - padX * 2, descSize)
    );

    const titleY = padX + titleSize;
    const bodyY = padX + iconSize + 8 * ps;
    const panelH = bodyY + descLines.length * rowH + enchantWrapped.length * rowH + padX;

    // 贴着快捷栏左下角
    const x = 10;
    const y = this.height - 16 * s - panelH;

    // 背板
    ctx.fillStyle = 'rgba(10,13,18,0.76)';
    ctx.fillRect(x, y, panelW, panelH);
    ctx.strokeStyle = 'rgba(255,216,61,0.35)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(x + 0.75, y + 0.75, panelW - 1.5, panelH - 1.5);

    // 图标
    this.drawItemIcon(def.icon, x + padX, y + padX, iconSize);

    // 名称 + 数量
    this.text(def.label, x + padX + iconSize + 7 * ps, y + titleY, titleSize, '#ffd83d');
    if (slot.count > 1) {
      this.text(
        `×${slot.count}`,
        x + padX + iconSize + 7 * ps + this.textWidth(def.label, titleSize) + 6 * ps,
        y + titleY,
        descSize,
        '#ffffff'
      );
    }

    // 用途说明
    let lineY = y + bodyY + descSize;
    for (const line of descLines) {
      this.text(line, x + padX, lineY, descSize, '#a9b5c5');
      lineY += rowH;
    }

    // 附魔
    for (const line of enchantWrapped) {
      this.text(line, x + padX, lineY + descSize, descSize, '#7ee01a');
      lineY += rowH;
    }
  }

  /** 生命 / 护甲 / 饥饿 / 经验。 */
  drawVitals(state) {
    const ctx = this.ctx;
    const s = this.scale;
    const player = state.player;
    const layout = computeVitalsLayout(player, this.width, this.height, s);
    const { hotbarX, total, iconSize, rowGap } = layout;

    const drawRow = (mask, fills, x, y, color, emptyColor) => {
      for (let i = 0; i < fills.length; i++) {
        const px = x + i * (iconSize + rowGap);
        if (fills[i] >= 2) {
          this.drawMask(mask, px, y, s, color);
        } else if (fills[i] === 1) {
          this.drawMask(mask, px, y, s, emptyColor);
          this.drawMask(mask, px, y, s, color, 1);
        } else {
          this.drawMask(mask, px, y, s, emptyColor);
        }
      }
    };

    // 生命：快捷栏右上方（主行固定 10 颗；超出部分画在防具槽上方一行）
    drawRow(
      HEART_MASK,
      layout.heart.fills,
      layout.heart.x,
      layout.heart.y,
      '#e02b2b',
      'rgba(30,30,30,0.85)'
    );
    if (layout.overflow.fills.length > 0) {
      drawRow(
        HEART_MASK,
        layout.overflow.fills,
        layout.overflow.x,
        layout.overflow.y,
        '#e02b2b',
        'rgba(30,30,30,0.85)'
      );
    }

    // 防具槽：生命正上方，左→右是 legs / chest / head
    const { size: armorSlotSize, gap: armorSlotGap, right: armorRight, y: armorY } =
      layout.armor;
    const armorSlots = player.armorSlots || {};
    // 从右往左排：head 最右、chest 居中、legs 最左
    const slotOrder = ['head', 'chest', 'legs'];
    for (let i = 0; i < slotOrder.length; i++) {
      const slotName = slotOrder[i];
      const sx = armorRight - armorSlotSize - i * (armorSlotSize + armorSlotGap);
      const item = armorSlots[slotName];

      // 空槽底色（有没有装备都画，保证槽位轮廓清楚）
      ctx.fillStyle = 'rgba(20,22,26,0.85)';
      ctx.fillRect(sx, armorY, armorSlotSize, armorSlotSize);

      if (item) {
        const def = ITEMS[item.id];
        if (def) {
          this.drawItemIcon(def.icon, sx + 1 * s, armorY + 1 * s, armorSlotSize - 2 * s);
        }
      }

      ctx.strokeStyle = item ? 'rgba(170,180,195,0.95)' : 'rgba(120,120,120,0.7)';
      ctx.lineWidth = 1;
      ctx.strokeRect(sx + 0.5, armorY + 0.5, armorSlotSize - 1, armorSlotSize - 1);
    }

    // 总防御点数
    const armorPoints = Math.round(player.armorPoints ?? 0);
    this.text(
      `护甲 ${armorPoints}`,
      layout.armorText.x,
      layout.armorText.y,
      12 * s,
      '#dcdcdc',
      'right'
    );

    // 饥饿：快捷栏左上方
    drawRow(
      FOOD_MASK,
      layout.food.fills,
      layout.food.x,
      layout.food.y,
      '#c8873c',
      'rgba(30,30,30,0.85)'
    );

    // 箭矢数量（永远显示，0 时置红，方便随时确认还剩多少箭）
    const arrows = player.hotbar.reduce((sum, slotItem) => {
      if (slotItem && slotItem.id === 'arrow') return sum + slotItem.count;
      return sum;
    }, 0);
    const hasBow = player.hotbar.some((slotItem) => slotItem && slotItem.id === 'bow');
    if (hasBow || arrows > 0) {
      const ax = layout.arrow.x;
      const ay = layout.arrow.y;
      this.drawMask(ARROW_MASK, ax, ay, s, arrows > 0 ? '#e8e8e8' : 'rgba(120,120,120,0.5)');
      this.text(
        `×${arrows}`,
        ax + 10 * s,
        ay + 7 * s,
        12 * s,
        arrows > 0 ? '#ffffff' : '#ff6b6b'
      );
    }

    // 经验条与等级（快捷栏正上方的中间空位，Minecraft 风格）
    const { x: barX, y: barY, w: barW, h: barH } = layout.xp;
    ctx.fillStyle = 'rgba(16,16,16,0.85)';
    ctx.fillRect(barX - 1 * s, barY - 1 * s, barW + 2 * s, barH + 2 * s);
    ctx.fillStyle = 'rgba(45,45,45,0.95)';
    ctx.fillRect(barX, barY, barW, barH);
    const xpRatio = Math.max(0, Math.min(1, player.xp / Math.max(1, player.xpToNext())));
    ctx.fillStyle = '#7ee01a';
    ctx.fillRect(barX, barY, barW * xpRatio, barH);
    ctx.fillStyle = 'rgba(255,255,255,0.35)';
    ctx.fillRect(barX, barY, barW * xpRatio, 1 * s);
    // 等级数字画在经验条上方
    this.text(
      String(player.level),
      hotbarX + total / 2,
      barY - 3 * s,
      12 * s,
      '#9cff4d',
      'center'
    );
  }

  /** BOSS 血条。 */
  drawBossBar(state) {
    if (!state.dragon || !state.dragon.alive) return;
    const ctx = this.ctx;
    const s = this.scale;
    const w = 420 * s;
    const h = 14 * s;
    const x = (this.width - w) / 2;
    const y = 22 * s;
    const ratio = Math.max(0, state.dragon.hp / state.dragon.maxHp);

    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(x - 3, y - 3, w + 6, h + 6);
    ctx.fillStyle = 'rgba(30,0,0,0.9)';
    ctx.fillRect(x, y, w, h);
    const grad = ctx.createLinearGradient(x, y, x + w, y);
    grad.addColorStop(0, '#8b1b8b');
    grad.addColorStop(1, '#e040e0');
    ctx.fillStyle = grad;
    ctx.fillRect(x, y, w * ratio, h);
    ctx.strokeStyle = 'rgba(255,255,255,0.55)';
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
    this.text('末影龙', x + w / 2, y - 8 * s, 13 * s, '#e9c0ff', 'center');

    // 水晶剩余数量
    const crystals = state.dragon.aliveCrystals;
    this.text(`末影水晶 ${crystals}/10`, x + w / 2, y + h + 16 * s, 11 * s, '#cfc0e0', 'center');
  }

  /** 提示消息。 */
  drawNotifications(state) {
    const s = this.scale;
    let y = 40 * s;
    for (const n of state.notifications) {
      const alpha = Math.min(1, n.life / 0.6);
      const ctx = this.ctx;
      ctx.globalAlpha = alpha;
      this.text(n.text, 16 * s, y, 13 * s, n.color || '#ffffff');
      ctx.globalAlpha = 1;
      y += 18 * s;
    }
  }

  /** 击杀信息。 */
  drawKillFeed(state) {
    const s = this.scale;
    // 小地图占住了右上角，击杀信息放到它下面，否则会被整块盖住
    let y = 210 * s;
    for (const k of state.killFeed) {
      const ctx = this.ctx;
      ctx.globalAlpha = Math.min(1, k.life / 0.6);
      this.text(k.text, this.width - 16 * s, y, 12 * s, k.color || '#ffd0d0', 'right');
      ctx.globalAlpha = 1;
      y += 17 * s;
    }
  }

  /** 目标指引箭头（只表示相对朝向，文字信息在下面的目标条里）。 */
  drawObjective(state) {
    if (!state.objective) return;
    const s = this.scale;
    const ctx = this.ctx;
    const player = state.player;
    const dx = state.objective.x - player.pos.x;
    const dz = state.objective.z - player.pos.z;
    // 目标在地图平面上的方位角（0 = -z 方向），减去玩家自己的朝向就是相对角度。
    const angle = objectiveBearingAngle(dx, dz, player.yaw);
    const cx = this.width / 2;
    const cy = 92 * s;

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(angle);
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.beginPath();
    ctx.moveTo(0, -16 * s);
    ctx.lineTo(11 * s, 10 * s);
    ctx.lineTo(0, 3 * s);
    ctx.lineTo(-11 * s, 10 * s);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#ffd83d';
    ctx.beginPath();
    ctx.moveTo(0, -13 * s);
    ctx.lineTo(8 * s, 8 * s);
    ctx.lineTo(0, 2 * s);
    ctx.lineTo(-8 * s, 8 * s);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  }
}
