/**
 * 小地图与导航指引的绘制。
 *
 * 单独放一个文件是因为 HUD 已经接近项目 800 行的红线；
 * 这里只负责「把 hud-nav.js 算好的坐标画出来」，不做任何布局计算。
 *
 * @module render/hud-minimap
 */
import {
  MAP_SPAN,
  OBJECTIVE_COLOR,
  OBJECTIVE_COLOR_OTHER,
  buildMinimapLayout,
  buildEdgeMarker,
  floorArrow,
} from './hud-nav.js';

/** 小地图面板的边长（CSS 像素，乘以 scale）。 */
const PANEL_SIZE = 150;

/**
 * 画小地图。
 * @param {import('./hud.js').HUD} hud
 * @param {object} state
 */
export function drawMinimap(hud, state) {
  const map = state.minimap;
  if (!map) return;
  const ctx = hud.ctx;
  const s = hud.scale;
  const size = PANEL_SIZE * s;
  const x0 = hud.width - size - 16 * s;
  const y0 = 16 * s;
  const scale = size / MAP_SPAN;

  const layout = buildMinimapLayout(map, state.objective, {
    x0,
    y0,
    size,
    scale,
    uiScale: s,
    time: performance.now(),
  });

  // 面板外框
  ctx.fillStyle = 'rgba(8,10,14,0.82)';
  ctx.fillRect(x0 - 4, y0 - 4, size + 8, size + 8);
  ctx.strokeStyle = 'rgba(120,130,150,0.6)';
  ctx.lineWidth = 2;
  ctx.strokeRect(x0 - 4, y0 - 4, size + 8, size + 8);

  ctx.save();
  ctx.beginPath();
  ctx.rect(x0, y0, size, size);
  ctx.clip();

  drawCorridors(hud, layout, s);
  drawRooms(hud, layout, s);
  drawShafts(hud, layout, s);
  drawArena(hud, layout, s);
  drawPoints(hud, layout, s);
  drawObjectiveOnMap(hud, layout, s);
  drawPlayer(hud, layout, s);
  drawCompass(hud, layout, s);

  ctx.restore();

  // 面板下方：楼层 + 当前房间名
  hud.text(
    `${layout.floorIndex + 1}F / ${layout.floorCount} 层`,
    x0 + size / 2,
    y0 + size + 16 * s,
    11 * s,
    '#9fb0c4',
    'center'
  );
  if (layout.currentRoomName) {
    hud.text(
      layout.currentRoomName,
      x0 + size / 2,
      y0 + size + 30 * s,
      11 * s,
      '#e8f0ff',
      'center'
    );
  }
}

/**
 * 走廊：把房间连起来，地图才看得出「怎么走过去」。
 * @param {import('./hud.js').HUD} hud @param {object} layout @param {number} s
 */
function drawCorridors(hud, layout, s) {
  const ctx = hud.ctx;
  ctx.strokeStyle = 'rgba(120,132,155,0.5)';
  ctx.lineWidth = 5 * s;
  ctx.lineCap = 'square';
  for (const c of layout.corridors) {
    ctx.beginPath();
    ctx.moveTo(c.x1, c.y1);
    ctx.lineTo(c.x2, c.y2);
    ctx.stroke();
  }
}

/**
 * 房间：当前所在的高亮，目标的房间画名字。
 * @param {import('./hud.js').HUD} hud @param {object} layout @param {number} s
 */
function drawRooms(hud, layout, s) {
  const ctx = hud.ctx;
  for (const r of layout.rooms) {
    ctx.fillStyle = r.isCurrent ? 'rgba(150,168,195,0.55)' : 'rgba(120,132,155,0.38)';
    ctx.fillRect(r.x, r.y, r.w, r.h);
    ctx.strokeStyle = r.isCurrent ? 'rgba(255,255,255,0.85)' : 'rgba(170,185,210,0.5)';
    ctx.lineWidth = (r.isCurrent ? 1.5 : 1) * s;
    ctx.strokeRect(r.x, r.y, r.w, r.h);
    if (r.name && (r.isCurrent || r.isObjective)) {
      hud.text(
        r.name,
        r.x + r.w / 2,
        r.y + r.h / 2 + 3 * s,
        9 * s,
        r.isObjective ? OBJECTIVE_COLOR : '#e8f0ff',
        'center'
      );
    }
  }
}

/**
 * 竖井入口（当前层通往下一层的地方）。
 * @param {import('./hud.js').HUD} hud @param {object} layout @param {number} s
 */
function drawShafts(hud, layout, s) {
  const ctx = hud.ctx;
  for (const sh of layout.shafts) {
    ctx.fillStyle = '#ffc850';
    ctx.beginPath();
    ctx.moveTo(sh.x, sh.y - 5 * s);
    ctx.lineTo(sh.x + 5 * s, sh.y);
    ctx.lineTo(sh.x, sh.y + 5 * s);
    ctx.lineTo(sh.x - 5 * s, sh.y);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.lineWidth = 1 * s;
    ctx.stroke();
  }
}

/**
 * 末影龙竞技场（只有最底层有）。
 * @param {import('./hud.js').HUD} hud @param {object} layout @param {number} s
 */
function drawArena(hud, layout, s) {
  if (!layout.arena) return;
  const ctx = hud.ctx;
  ctx.fillStyle = 'rgba(150,60,200,0.4)';
  ctx.fillRect(layout.arena.x, layout.arena.y, layout.arena.w, layout.arena.h);
}

/**
 * 敌人 / 箱子 / 附魔台。
 * @param {import('./hud.js').HUD} hud @param {object} layout @param {number} s
 */
function drawPoints(hud, layout, s) {
  const ctx = hud.ctx;
  ctx.fillStyle = '#ff5555';
  for (const e of layout.enemies) {
    ctx.fillRect(e.x - 2 * s, e.y - 2 * s, 4 * s, 4 * s);
  }
  ctx.fillStyle = '#e8a33a'; // 箱子用琥珀色，别和目标的黄色撞色
  for (const c of layout.chests) {
    ctx.fillRect(c.x - 2 * s, c.y - 2 * s, 4 * s, 4 * s);
  }
  ctx.fillStyle = '#8f6bff'; // 附魔台用蓝紫，别和「异层目标」的紫撞色
  for (const e of layout.enchants) {
    ctx.fillRect(e.x - 2 * s, e.y - 2 * s, 4 * s, 4 * s);
  }
}

/**
 * 目标：脉冲圆环 + 指向它的虚线 + 距离。
 * @param {import('./hud.js').HUD} hud @param {object} layout @param {number} s
 */
function drawObjectiveOnMap(hud, layout, s) {
  const obj = layout.objective;
  if (!obj) return;
  const ctx = hud.ctx;
  const color = obj.onSameFloor ? OBJECTIVE_COLOR : OBJECTIVE_COLOR_OTHER;

  // 玩家 → 目标的虚线
  ctx.strokeStyle = obj.onSameFloor ? 'rgba(255,216,61,0.45)' : 'rgba(200,139,255,0.4)';
  ctx.lineWidth = 1.5 * s;
  ctx.setLineDash([6 * s, 4 * s]);
  ctx.beginPath();
  ctx.moveTo(layout.player.x, layout.player.y);
  ctx.lineTo(obj.x, obj.y);
  ctx.stroke();
  ctx.setLineDash([]);

  // 脉冲圆环
  const radius = (4 + 2.5 * obj.pulse) * s;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 * s;
  ctx.beginPath();
  ctx.arc(obj.x, obj.y, radius, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.fillRect(obj.x - 1.5 * s, obj.y - 1.5 * s, 3 * s, 3 * s);

  // 距离
  const arrow = obj.onSameFloor ? '' : floorArrow(obj.floorIndex, layout.floorIndex);
  hud.text(
    `${Math.round(obj.distance)}m${arrow}`,
    obj.x,
    obj.y - radius - 3 * s,
    9 * s,
    color,
    'center'
  );
}

/**
 * 玩家：白点 + 朝向线。
 * @param {import('./hud.js').HUD} hud @param {object} layout @param {number} s
 */
function drawPlayer(hud, layout, s) {
  const ctx = hud.ctx;
  const p = layout.player;
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(p.x, p.y, 3.5 * s, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 1.5 * s;
  ctx.beginPath();
  ctx.moveTo(p.x, p.y);
  ctx.lineTo(p.x + Math.sin(p.angle) * 8 * s, p.y - Math.cos(p.angle) * 8 * s);
  ctx.stroke();
}

/**
 * 指北针（北 = -z = 地图上方）。
 * @param {import('./hud.js').HUD} hud @param {object} layout @param {number} s
 */
function drawCompass(hud, layout, s) {
  const ctx = hud.ctx;
  const c = layout.compass;
  ctx.fillStyle = 'rgba(255,255,255,0.75)';
  ctx.beginPath();
  ctx.moveTo(c.x, c.y - 6 * s);
  ctx.lineTo(c.x + 4 * s, c.y + 4 * s);
  ctx.lineTo(c.x - 4 * s, c.y + 4 * s);
  ctx.closePath();
  ctx.fill();
  hud.text('N', c.x, c.y + 14 * s, 9 * s, 'rgba(255,255,255,0.75)', 'center');
}

/**
 * 顶部目标条：第几层 · 目标是什么 · 有多远。
 * @param {import('./hud.js').HUD} hud @param {object} state
 */
export function drawObjectiveBar(hud, state) {
  const objective = state.objective;
  const map = state.minimap;
  if (!objective || !map) return;
  const ctx = hud.ctx;
  const s = hud.scale;

  let level = '';
  if (!objective.sameFloor) {
    level = objective.floorIndex > map.floorIndex ? '（在下面）' : '（在上面）';
  }
  const text = `第 ${map.floorIndex + 1} 层 / ${map.floorCount} 层 · 目标：${objective.label} · ${Math.round(
    objective.distance
  )} 米${level}`;
  const size = 12 * s;
  const w = hud.textWidth(text, size) + 22 * s;
  const h = 21 * s;
  // 居中放，但别被右上角的小地图压住 —— 窄屏时整体往左挪
  const minimapLeft = hud.width - PANEL_SIZE * s - 16 * s;
  let x = (hud.width - w) / 2;
  if (x + w > minimapLeft - 12 * s) x = Math.max(12 * s, minimapLeft - 12 * s - w);
  const y = 110 * s;

  ctx.fillStyle = 'rgba(10,12,16,0.72)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = 'rgba(255,216,61,0.45)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
  hud.text(text, x + w / 2, y + h - 6 * s, size, '#ffe9a0', 'center');
}

/**
 * 屏幕边缘的目标箭头（目标不在画面里时出现）。
 * @param {import('./hud.js').HUD} hud @param {object} state
 */
export function drawEdgeMarker(hud, state) {
  const s = hud.scale;
  const panelSize = PANEL_SIZE * s;
  const marker = buildEdgeMarker(state.objective, {
    width: hud.width,
    height: hud.height,
    scale: s,
    // 小地图面板是实心的，箭头落在上面会被吃掉 —— 当成障碍物避开
    obstacles: [
      {
        x: hud.width - panelSize - 16 * s,
        y: 16 * s,
        w: panelSize + 8,
        h: panelSize + 8,
      },
    ],
  });
  if (!marker) return;
  const ctx = hud.ctx;

  ctx.save();
  ctx.translate(marker.x, marker.y);
  ctx.rotate(marker.angle);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  ctx.beginPath();
  ctx.moveTo(0, -12 * s);
  ctx.lineTo(9 * s, 8 * s);
  ctx.lineTo(0, 2 * s);
  ctx.lineTo(-9 * s, 8 * s);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = OBJECTIVE_COLOR;
  ctx.beginPath();
  ctx.moveTo(0, -9 * s);
  ctx.lineTo(6 * s, 6 * s);
  ctx.lineTo(0, 1 * s);
  ctx.lineTo(-6 * s, 6 * s);
  ctx.closePath();
  ctx.fill();
  ctx.restore();

  hud.text(
    `${Math.round(marker.distance)}m`,
    marker.x,
    marker.y + 20 * s,
    11 * s,
    OBJECTIVE_COLOR,
    'center'
  );
}
