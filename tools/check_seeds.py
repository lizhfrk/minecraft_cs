"""多种子地牢回归测试：每个种子都必须保证全部房间与竞技场可达。"""
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:5173/"
SEEDS = [20261026, 1, 2, 3, 7, 42, 1337, 99991, 555, 2024, 31337, 8888] + list(range(100, 188))

BFS_JS = r"""
() => {
  const g = window.game;
  const W = g.world;
  const passable = (x, y, z) => !W.isSolid(x, y, z);
  const solid = (x, y, z) => W.isSolid(x, y, z);
  const standable = (x, y, z) =>
    passable(x, y, z) && passable(x, y + 1, z) && solid(x, y - 1, z);
  const key = (x, y, z) => `${x},${y},${z}`;
  const sp = g.dungeon.spawnPoint;
  const start = [Math.floor(sp.x), Math.floor(sp.y), Math.floor(sp.z)];
  const seen = new Set([key(...start)]);
  const queue = [start];
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
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, nz = z + dz;
      if (passable(nx, y, nz) && passable(nx, y + 1, nz)) {
        if (solid(nx, y - 1, nz)) push(nx, y, nz);
        else {
          for (let k = 1; k <= 4; k++) if (solid(nx, y - 1 - k, nz)) { push(nx, y - k, nz); break; }
        }
      } else if (solid(nx, y, nz) && passable(nx, y + 1, nz) && passable(nx, y + 2, nz) && solid(nx, y - 1, nz)) {
        push(nx, y + 1, nz);
      }
    }
    if (passable(x, y - 1, z) && passable(x, y - 2, z)) {
      for (let k = 1; k <= 6; k++) if (solid(x, y - 1 - k, z)) { push(x, y - k, z); break; }
    }
    if (solid(x, y - 1, z) && passable(x, y + 1, z) && passable(x, y + 2, z)) push(x, y + 1, z);
  }
  const near = (tx, ty, tz, r = 3) =>
    Array.from(seen).some((k) => {
      const p = k.split(',').map(Number);
      return Math.abs(p[0] - tx) <= r && Math.abs(p[1] - ty) <= r && Math.abs(p[2] - tz) <= r;
    });
  const badRooms = g.dungeon.rooms
    .filter((r) => !near(r.cx, r.floorY, r.cz, 4))
    .map((r) => `${r.theme}@${r.floorY}`);
  const badStairs = (g.dungeon.stairs || [])
    .filter((s) => !near(s.from.x, s.from.y, s.from.z, 3) || !near(s.to.x, s.to.y, s.to.z, 3))
    .map((s) => `${s.from.x},${s.from.y},${s.from.z}`);
  const ae = g.dungeon.arenaEntrance;
  const arenaOk = ae ? near(ae.x, ae.y, ae.z, 4) && near(80, 12, 80, 6) : false;
  return {
    cells: seen.size,
    rooms: g.dungeon.rooms.length,
    badRooms, badStairs, arenaOk,
    stairs: (g.dungeon.stairs || []).length,
  };
}
"""


def main() -> None:
    failed = []
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        for seed in SEEDS:
            page = browser.new_page(viewport={"width": 800, "height": 600})
            errors: list[str] = []
            page.on("pageerror", lambda e: errors.append(str(e)))
            page.goto(f"{URL}?seed={seed}", wait_until="domcontentloaded")
            try:
                page.wait_for_function(
                    "() => { const el = document.getElementById('loading');"
                    " return el && el.hasAttribute('hidden'); }",
                    timeout=120000,
                )
            except Exception as e:
                print(f"[FAIL] seed={seed} 加载超时: {e}")
                failed.append(seed)
                page.close()
                continue
            res = page.evaluate(BFS_JS)
            ok = not res["badRooms"] and not res["badStairs"] and res["arenaOk"] and not errors
            status = "PASS" if ok else "FAIL"
            print(
                f"[{status}] seed={seed:>9} 房间 {res['rooms']} 竖井 {res['stairs']} "
                f"可达格 {res['cells']:>5} 竞技场 {'OK' if res['arenaOk'] else 'BAD'}"
            )
            if res["badRooms"]:
                print(f"         不可达房间: {res['badRooms']}")
            if res["badStairs"]:
                print(f"         不可达竖井: {res['badStairs']}")
            if errors:
                print(f"         运行时错误: {errors[:2]}")
            if not ok:
                failed.append(seed)
            page.close()
        browser.close()

    print("\n结果:", "全部通过" if not failed else f"失败种子: {failed}")
    sys.exit(0 if not failed else 1)


main()
