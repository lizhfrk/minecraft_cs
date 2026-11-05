"""地牢连通性检查：BFS 验证入口 → 每层楼梯 → BOSS 竞技场全部可达。"""
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:5173/"

BFS_JS = r"""
() => {
  const g = window.game;
  const W = g.world;
  const air = (x, y, z) => !W.isSolid(x, y, z);
  const solid = (x, y, z) => W.isSolid(x, y, z);

  // 玩家站立的判定：脚下是实体、自身与头顶 1 格是空气
  const standable = (x, y, z) =>
    air(x, y, z) && air(x, y + 1, z) && solid(x, y - 1, z);

  const key = (x, y, z) => `${x},${y},${z}`;
  const sp = g.dungeon.spawnPoint;
  const start = [Math.floor(sp.x), Math.floor(sp.y), Math.floor(sp.z)];
  const seen = new Set();
  const queue = [start];
  seen.add(key(...start));
  const reached = [];

  const push = (x, y, z) => {
    if (x < 1 || z < 1 || y < 1 || x >= W.width - 1 || z >= W.depth - 1 || y >= W.height - 1) return;
    if (!standable(x, y, z)) return;
    const k = key(x, y, z);
    if (seen.has(k)) return;
    seen.add(k);
    queue.push([x, y, z]);
  };

  let guard = 0;
  while (queue.length && guard < 400000) {
    guard++;
    const [x, y, z] = queue.shift();
    reached.push([x, y, z]);
    // 水平移动
    for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = x + dx, nz = z + dz;
      if (air(nx, y, nz) && air(nx, y + 1, nz)) {
        // 同层站立
        if (solid(nx, y - 1, nz)) push(nx, y, nz);
        // 向下掉落（最多 4 格）
        else {
          for (let k = 1; k <= 4; k++) {
            if (solid(nx, y - 1 - k, nz)) { push(nx, y - k, nz); break; }
          }
        }
      }
      // 向上跨 1 格台阶
      else if (solid(nx, y, nz) && air(nx, y + 1, nz) && air(nx, y + 2, nz) && solid(nx, y - 1, nz)) {
        push(nx, y + 1, nz);
      }
    }
    // 向下掉落（原地）
    if (air(x, y - 1, z) && air(x, y - 2, z)) {
      for (let k = 1; k <= 6; k++) {
        if (solid(x, y - 1 - k, z)) { push(x, y - k, z); break; }
      }
    }
    // 向上跳 1 格
    if (solid(x, y - 1, z) && air(x, y + 1, z) && air(x, y + 2, z)) push(x, y + 1, z);
  }

  const near = (tx, ty, tz, radius = 2) =>
    reached.some(([x, y, z]) =>
      Math.abs(x - tx) <= radius && Math.abs(y - ty) <= radius && Math.abs(z - tz) <= radius);

  // 可达区域的 y 分布
  const byY = {};
  for (const [, y] of reached) byY[y] = (byY[y] || 0) + 1;
  // 每个房间的最近可达点
  const nearest = (tx, ty, tz) => {
    let best = null, bd = Infinity;
    for (const [x, y, z] of reached) {
      const d = Math.abs(x - tx) + Math.abs(y - ty) + Math.abs(z - tz);
      if (d < bd) { bd = d; best = [x, y, z]; }
    }
    return { cell: best, dist: bd };
  };
  const results = { totalCells: reached.length, stairs: [], arena: null, spawnOk: reached.length > 0 };
  results.byY = byY;
  results.roomNearest = g.dungeon.rooms.map(r => {
    const n = nearest(r.cx, r.floorY, r.cz);
    return { theme: r.theme, y: r.floorY, center: [r.cx, r.cz], nearest: n.cell, dist: n.dist };
  });
  results.startCell = start;
  results.reachedBounds = [
    Math.min(...reached.map(c => c[0])), Math.max(...reached.map(c => c[0])),
    Math.min(...reached.map(c => c[2])), Math.max(...reached.map(c => c[2])),
  ];

  for (const st of (g.dungeon.stairs || [])) {
    results.stairs.push({
      from: [st.from.x, st.from.y, st.from.z],
      to: [st.to.x, st.to.y, st.to.z],
      fromReachable: near(st.from.x, st.from.y, st.from.z, 3),
      toReachable: near(st.to.x, st.to.y, st.to.z, 3),
    });
  }
  const ae = g.dungeon.arenaEntrance;
  if (ae) {
    results.arena = {
      entrance: [ae.x, ae.y, ae.z],
      entranceReachable: near(ae.x, ae.y, ae.z, 4),
      centerReachable: near(80, 12, 80, 6),
    };
  }
  // 每个房间是否可达
  results.rooms = g.dungeon.rooms.map(r => ({
    theme: r.theme,
    y: r.floorY,
    reachable: near(r.cx, r.floorY, r.cz, 4),
  }));
  return results;
}
"""


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 800, "height": 600})
        page.on("pageerror", lambda e: print("ERR", e))
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_function(
            "() => { const el = document.getElementById('loading');"
            " return el && el.hasAttribute('hidden'); }",
            timeout=120000,
        )
        res = page.evaluate(BFS_JS)
        browser.close()

    print(f"可达格子数: {res['totalCells']}")
    ok = True
    for st in res["stairs"]:
        good = st["fromReachable"] and st["toReachable"]
        ok = ok and good
        print(f"  楼梯 {st['from']} -> {st['to']} : {'OK' if good else '不可达'}")
    if res["arena"]:
        a = res["arena"]
        good = a["entranceReachable"] and a["centerReachable"]
        ok = ok and good
        print(f"  竞技场入口 {a['entrance']} : {'OK' if good else '不可达'}")
    bad = [r for r in res["rooms"] if not r["reachable"]]
    print(f"  房间总数 {len(res['rooms'])}，不可达 {len(bad)}")
    print(f"  可达区域 y 分布: {res['byY']}")
    print(f"  可达区域 x 范围 {res['reachedBounds'][0]}..{res['reachedBounds'][1]}"
          f"  z 范围 {res['reachedBounds'][2]}..{res['reachedBounds'][3]}")
    for r in res["roomNearest"]:
        mark = "OK " if r["dist"] <= 6 else "!! "
        print(f"    {mark}{r['theme']} @y={r['y']} center={r['center']}"
              f" 最近可达点={r['nearest']} 曼哈顿距离={r['dist']}")
    if bad:
        ok = False
    print("连通性:", "PASS" if ok else "FAIL")
    sys.exit(0 if ok else 1)


main()
