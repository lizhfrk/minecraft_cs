"""物理回归测试：验证实体不会「飞起来」。

曾经的 bug：自动上台阶在 X / Z 两个轴上各抬一次。
斜着撞到台阶拐角时，第二个轴会基于「已经抬高后的 y」再抬 1 格，
一帧就升 2 格；实体在楼梯 / 拐角处会持续爬升，看起来像飞起来。

测试里用合成世界精确复现该场景，并且用旧实现跑一遍作为对照，
确认这个用例确实能抓住回归。
"""
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:5173/"
failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}")
    if not ok:
        failures.append(name)


# 在页面里跑的合成场景：地面 + 一处 1 格高的台阶拐角
SCENARIO = """
  const solid = (x, y, z) => {
    if (y === -1) return true;                       // 地面
    if (x === 1 && z === 1 && y === 0) return true;  // 台阶角
    if (x === 2 && z === 1 && y === 0) return true;
    if (x === 1 && z === 2 && y === 0) return true;
    return false;
  };
  const world = { isSolid: solid };
  const pos = { x: 0.5, y: 0, z: 0.5 };
  const vel = { x: 3, y: 0, z: 3 };
"""

OLD_MOVE_BODY = """
function (correctAxis, bodyCollides) {
  return function oldMoveBody(world, pos, vel, dt, hw, h, opts) {
    const gravity = opts.gravity ?? 26;
    const stepUp = opts.stepUp !== false;
    vel.y -= gravity * dt;
    if (vel.y < -45) vel.y = -45;
    let stepped = false;
    let dx = vel.x * dt;
    if (dx !== 0) {
      const beforeX = pos.x;
      pos.x += dx;
      if (correctAxis(world, pos, 'x', dx, hw, h) !== null) {
        pos.x = beforeX;
        if (stepUp) {
          const beforeY = pos.y;
          pos.y = beforeY + 1.0;
          if (correctAxis(world, pos, 'x', dx, hw, h) === null) stepped = true;
          else { pos.x = beforeX; pos.y = beforeY; vel.x = 0; }
        } else { vel.x = 0; }
      }
    }
    let dz = vel.z * dt;
    if (dz !== 0) {
      const beforeZ = pos.z;
      pos.z += dz;
      if (correctAxis(world, pos, 'z', dz, hw, h) !== null) {
        pos.z = beforeZ;
        if (stepUp) {
          const beforeY = pos.y;
          pos.y = beforeY + 1.0;
          if (correctAxis(world, pos, 'z', dz, hw, h) === null) stepped = true;
          else { pos.z = beforeZ; pos.y = beforeY; vel.z = 0; }
        } else { vel.z = 0; }
      }
    }
    const beforeY = pos.y;
    const dy = vel.y * dt;
    pos.y += dy;
    let onGround = false;
    if (correctAxis(world, pos, 'y', dy, hw, h) !== null) {
      if (dy < 0) onGround = true;
      vel.y = 0;
    } else if (dy < 0) {
      if (bodyCollides(world, pos.x, pos.y - 0.08, pos.z, hw, h)) {
        pos.y = beforeY; onGround = true; vel.y = 0;
      }
    }
    return { onGround, stepped };
  };
}
"""


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 640})
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_function(
            "() => { const el = document.getElementById('loading');"
            " return el && el.hasAttribute('hidden'); }",
            timeout=120000,
        )

        # ---------- 1. 新实现：一帧最多抬 1 格 ----------
        result = page.evaluate(
            """async () => {
              const phys = await import('/src/world/physics.js');
              const run = (fn) => {
                const solid = (x, y, z) => {
                  if (y === -1) return true;
                  if (x === 1 && z === 1 && y === 0) return true;
                  if (x === 2 && z === 1 && y === 0) return true;
                  if (x === 1 && z === 2 && y === 0) return true;
                  return false;
                };
                const world = { isSolid: solid };
                const pos = { x: 0.5, y: 0, z: 0.5 };
                const vel = { x: 3, y: 0, z: 3 };
                let grounded = true;
                let maxY = 0;
                for (let i = 0; i < 240; i++) {
                  const res = fn(world, pos, vel, 1 / 60, 0.3, 1.8, {
                    gravity: 26, stepUp: true, grounded,
                  });
                  grounded = res.onGround;
                  maxY = Math.max(maxY, pos.y);
                }
                return { maxY, endY: pos.y, endX: pos.x, endZ: pos.z };
              };
              const now = run(phys.moveBody);
              const oldFactory = OLD_FACTORY;
              const old = run(oldFactory(phys.correctAxis, phys.bodyCollides));
              return { now, old };
            }""".replace("OLD_FACTORY", OLD_MOVE_BODY)
        )
        check(
            "新实现：撞台阶拐角时最多抬 1 格",
            result["now"]["maxY"] <= 1.05,
            f"最高 y = {result['now']['maxY']:.3f}",
        )
        check(
            "对照：旧实现确实会一帧抬 2 格（用例能抓住回归）",
            result["old"]["maxY"] >= 1.95,
            f"旧实现最高 y = {result['old']['maxY']:.3f}",
        )

        # ---------- 2. 1 格台阶仍然可以自动跨上 ----------
        step = page.evaluate(
            """async () => {
              const { moveBody } = await import('/src/world/physics.js');
              const solid = (x, y, z) => {
                if (y === -1 && x >= 0 && x <= 8 && z >= 0 && z <= 8) return true;
                if (x === 4 && z >= 3 && z <= 5 && y === 0) return true;
                return false;
              };
              const world = { isSolid: solid };
              const pos = { x: 1.5, y: 0, z: 4.5 };
              const vel = { x: 3, y: 0, z: 0 };
              let grounded = true;
              let maxY = 0;
              for (let i = 0; i < 120; i++) {
                const res = moveBody(world, pos, vel, 1 / 60, 0.3, 1.8, {
                  gravity: 26, stepUp: true, grounded,
                });
                grounded = res.onGround;
                maxY = Math.max(maxY, pos.y);
              }
              return { maxY, endX: pos.x };
            }"""
        )
        check(
            "1 格高的台阶仍然能自动跨上",
            step["maxY"] >= 0.99 and step["maxY"] <= 1.05 and step["endX"] > 4.5,
            f"最高 y = {step['maxY']:.3f}，终点 x = {step['endX']:.2f}",
        )

        # ---------- 3. 腾空时不能凭空升高 ----------
        air = page.evaluate(
            """async () => {
              const { moveBody } = await import('/src/world/physics.js');
              const solid = (x, y, z) => {
                if (y === -1 && x >= 0 && x <= 6 && z >= 0 && z <= 6) return true;
                if (x === 4 && z >= 0 && z <= 6 && y === 0) return true;
                return false;
              };
              const world = { isSolid: solid };
              const pos = { x: 1.5, y: 6, z: 3.5 };
              const vel = { x: 3, y: 0, z: 0 };
              let grounded = false;
              const startY = pos.y;
              for (let i = 0; i < 60; i++) {
                const res = moveBody(world, pos, vel, 1 / 60, 0.3, 1.8, {
                  gravity: 26, stepUp: true, grounded,
                });
                grounded = res.onGround;
              }
              return { startY, endY: pos.y };
            }"""
        )
        check(
            "腾空时不会凭空升高",
            air["endY"] < air["startY"],
            f"y {air['startY']:.2f} -> {air['endY']:.2f}（应当自由下落）",
        )

        # ---------- 4. 真实地牢：骷髅不会飞起来 ----------
        page.evaluate("window.game.startGame()")
        page.wait_for_timeout(600)
        skel = page.evaluate(
            """() => {
              const g = window.game;
              const spawn = g.dungeon.spawnPoint;
              const e = g.enemies.spawn('skeleton', spawn.x + 2, spawn.y, spawn.z + 2);
              const startY = e.pos.y;
              let maxY = startY;
              for (let i = 0; i < 240; i++) {
                g.enemies.update(1 / 60, g.player, g);
                maxY = Math.max(maxY, e.pos.y);
              }
              return { startY, maxY };
            }"""
        )
        check(
            "骷髅不会离地飞起",
            skel["maxY"] - skel["startY"] <= 1.05,
            f"y {skel['startY']:.2f} -> 最高 {skel['maxY']:.2f}",
        )

        # ---------- 5. 真实地牢：玩家顶住墙不会往上爬 ----------
        wall = page.evaluate(
            """() => {
              const g = window.game;
              const w = g.world;
              for (const room of g.dungeon.rooms) {
                for (const c of room.cells) {
                  const x = c.x, z = c.z, y = room.floorY;
                  if (!w.isSolid(x, y - 1, z)) continue;
                  if (w.get(x, y, z) !== 0) continue;
                  for (const [dx, dz] of [[1,0],[-1,0],[0,1],[0,-1]]) {
                    if (!w.isSolid(x + dx, y, z + dz)) continue;
                    g.player.setPosition(x + 0.5, y, z + 0.5);
                    g.player.yaw = Math.atan2(-dx, -dz);
                    g.player.vel.set(0, 0, 0);
                    g.player.syncCamera();
                    return { x, y, z, dx, dz };
                  }
                }
              }
              return null;
            }"""
        )
        climb = page.evaluate(
            """() => {
              const g = window.game;
              const startY = g.player.pos.y;
              const inp = g.input;
              inp.keys.add('KeyW');
              for (let i = 0; i < 180; i++) g.player.update(1 / 60, inp);
              inp.keys.delete('KeyW');
              return { startY, endY: g.player.pos.y };
            }"""
        )
        check(
            "玩家顶住墙不会往上爬",
            wall is not None and climb["endY"] - climb["startY"] <= 1.05,
            f"墙位置 {wall} · y {climb['startY']:.2f} -> {climb['endY']:.2f}",
        )

        browser.close()

    if errors:
        print("\n运行时错误:")
        for e in errors[:5]:
            print(" ", e)
        failures.append("runtime errors")
    print("\n结果:", "全部通过" if not failures else f"失败: {failures}")
    sys.exit(0 if not failures else 1)


main()
