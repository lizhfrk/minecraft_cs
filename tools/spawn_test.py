"""刷怪压力测试：确认怪物数量有上限、不会无限堆积、也不会叠在一起。"""
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:5173/"
failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}")
    if not ok:
        failures.append(name)


NEARBY_JS = """() => {
  const g = window.game;
  const p = g.player.pos;
  // 与游戏内一致：水平 30 米、垂直 12 米
  return g.enemies.countNear(p.x, p.y, p.z, 30, 12);
}"""


def run_difficulty(page, diff_id: str, seconds: int = 60) -> tuple[int, int, int]:
    """在刷怪笼旁站定，记录身边怪物数量的峰值。"""
    page.evaluate("(id) => window.game.setDifficulty(id)", diff_id)
    page.evaluate(
        """() => {
          const g = window.game;
          // 挑刷怪笼最多的房间，多个笼子才测得到「身边总数」上限
          const roomOf = (s) => g.dungeon.rooms.find(
            (r) => Math.abs(r.cx - s.x) < r.halfW && Math.abs(r.cz - s.z) < r.halfD
          );
          const counts = new Map();
          for (const s of g.world.spawners) {
            const r = roomOf(s);
            if (!r) continue;
            const k = `${r.cx},${r.cz}`;
            counts.set(k, (counts.get(k) || 0) + 1);
          }
          let bestRoom = null;
          let bestCount = -1;
          for (const [k, n] of counts) {
            if (n > bestCount) {
              bestCount = n;
              bestRoom = g.dungeon.rooms.find(
                (r) => `${r.cx},${r.cz}` === k
              );
            }
          }
          const inRoom = g.world.spawners.filter((s) => {
            const r = roomOf(s);
            return r && bestRoom && r.cx === bestRoom.cx && r.cz === bestRoom.cz;
          });
          const s = inRoom[0] || g.world.spawners[0];

          // 找一个离刷怪笼 8~12 格、且脚下是空的落点：
          // 太近的话刷怪笼不会在玩家脸上刷怪，就测不到上限了
          let spot = null;
          for (let r = 8; r <= 12 && !spot; r++) {
            for (let a = 0; a < 24; a++) {
              const ang = (a / 24) * Math.PI * 2;
              const x = Math.floor(s.x + Math.cos(ang) * r);
              const z = Math.floor(s.z + Math.sin(ang) * r);
              if (g.world.get(x, s.y, z) !== 0) continue;
              if (g.world.get(x, s.y - 1, z) === 0) continue;
              spot = { x: x + 0.5, y: s.y, z: z + 0.5 };
              break;
            }
          }
          if (!spot) spot = { x: s.x + 8, y: s.y, z: s.z + 8 };
          g.player.setPosition(spot.x, spot.y, spot.z);
          g.player.syncCamera();
        }"""
    )
    page.wait_for_timeout(1000)

    peak = 0
    for _ in range(seconds):
        page.wait_for_timeout(1000)
        # 不死之身：站着不动测刷怪，不然会被怪打死、游戏循环停掉
        page.evaluate(
            "() => { const p = window.game.player;"
            " p.health = 999; p.hunger = 20; }"
        )
        peak = max(peak, page.evaluate(NEARBY_JS))

    limit = page.evaluate("() => window.game.difficulty.maxNearby")
    total = page.evaluate("() => window.game.enemies.enemies.length")
    return peak, limit, total


def start_and_count(page, diff: str | None) -> int:
    """（可选地先在菜单里选难度）开局，返回房间里的初始怪物数。"""
    page.goto(URL, wait_until="domcontentloaded")
    page.wait_for_function(
        "() => { const el = document.getElementById('loading');"
        " return el && el.hasAttribute('hidden'); }",
        timeout=120000,
    )
    if diff:
        page.click(f'.diff-btn[data-diff="{diff}"]')
        page.wait_for_timeout(200)
    page.evaluate("window.game.startGame()")
    page.wait_for_timeout(600)
    return page.evaluate("() => window.game.enemies.enemies.length")


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1024, "height": 640})
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))

        # ---------- 难度必须对「这一局」立即生效 ----------
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_function(
            "() => { const el = document.getElementById('loading');"
            " return el && el.hasAttribute('hidden'); }",
            timeout=120000,
        )
        page.evaluate("() => localStorage.removeItem('mc-cs-difficulty')")
        normal_count = start_and_count(page, None)
        hard_count = start_and_count(page, "hard")
        easy_count = start_and_count(page, "easy")
        print(f"  初始怪物数 easy={easy_count} normal={normal_count} hard={hard_count}")
        check(
            "菜单选的难度对这一局立即生效",
            hard_count > normal_count and normal_count > easy_count,
            f"easy={easy_count} normal={normal_count} hard={hard_count}",
        )

        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_function(
            "() => { const el = document.getElementById('loading');"
            " return el && el.hasAttribute('hidden'); }",
            timeout=120000,
        )
        page.evaluate("window.game.startGame()")
        page.wait_for_timeout(800)

        spawners = page.evaluate("() => window.game.world.spawners.length")
        check("地牢里有刷怪笼", spawners > 0, f"count={spawners}")

        # 初始怪物数量：不应超过当前难度的预算
        initial = page.evaluate("() => window.game.enemies.enemies.length")
        budget = page.evaluate(
            "() => ({easy: 5, normal: 11, hard: 19})[window.game.difficulty.id]"
        )
        check(
            "初始怪物数量不超过当前难度预算",
            initial <= budget,
            f"initial={initial} budget={budget}",
        )

        # 有没有几只怪叠在同一格
        stacked = page.evaluate(
            """() => {
              const m = new Map();
              for (const e of window.game.enemies.enemies) {
                const k = `${Math.floor(e.pos.x)},${Math.floor(e.pos.y)},${Math.floor(e.pos.z)}`;
                m.set(k, (m.get(k) || 0) + 1);
              }
              return [...m.values()].filter((n) => n > 1).length;
            }"""
        )
        check("没有怪叠在同一格", stacked == 0, f"stacked_cells={stacked}")

        for diff, expect_max in (("easy", 4), ("normal", 7), ("hard", 11)):
            peak, limit, total = run_difficulty(page, diff, seconds=45)
            print(f"  {diff}: nearby_peak={peak} limit={limit} total={total}")
            check(
                f"{diff} 难度身边怪物数不超上限",
                peak <= limit,
                f"peak={peak} limit={limit}",
            )
            check(
                f"{diff} 难度上限符合预期",
                limit == expect_max,
                f"limit={limit} expected={expect_max}",
            )

        # 难度选择是否持久化
        page.evaluate("() => window.game.setDifficulty('easy')")
        page.reload(wait_until="domcontentloaded")
        page.wait_for_function(
            "() => { const el = document.getElementById('loading');"
            " return el && el.hasAttribute('hidden'); }",
            timeout=120000,
        )
        saved = page.evaluate("() => window.game.difficulty.id")
        check("难度选择被记住", saved == "easy", f"saved={saved}")

        active = page.evaluate(
            "() => document.querySelector('.diff-btn.is-active')?.dataset.diff"
        )
        check("菜单按钮高亮跟随难度", active == "easy", f"active={active}")

        # ---------- 走远之后刷怪笼产物会被回收 ----------
        page.evaluate("window.game.startGame()")
        page.wait_for_timeout(600)
        # 用困难难度：单笼上限高，才刷得出刷怪笼产物
        page.evaluate("() => window.game.setDifficulty('hard')")
        page.evaluate(
            """() => {
              const g = window.game;
              const s = g.world.spawners[0];
              // 找一个离刷怪笼 8~12 格、脚下踩实的空位：
              // 直接用 +6 偏移会卡进岩石里被弹到楼上，出了刷怪半径就刷不出怪了
              let spot = null;
              for (let r = 8; r <= 12 && !spot; r++) {
                for (let a = 0; a < 24; a++) {
                  const ang = (a / 24) * Math.PI * 2;
                  const x = Math.floor(s.x + Math.cos(ang) * r);
                  const z = Math.floor(s.z + Math.sin(ang) * r);
                  if (g.world.get(x, s.y, z) !== 0) continue;
                  if (g.world.get(x, s.y - 1, z) === 0) continue;
                  spot = { x: x + 0.5, y: s.y, z: z + 0.5 };
                  break;
                }
              }
              if (!spot) spot = { x: s.x + 8, y: s.y, z: s.z + 8 };
              g.player.setPosition(spot.x, spot.y, spot.z);
              g.player.syncCamera();
            }"""
        )
        page.wait_for_timeout(800)
        for _ in range(45):
            page.wait_for_timeout(1000)
            page.evaluate("() => { window.game.player.health = 999; }")
        near_total = page.evaluate("() => window.game.enemies.enemies.length")
        spawned = page.evaluate(
            "() => window.game.enemies.enemies.filter((e) => !e.persistent).length"
        )
        persistent = page.evaluate(
            "() => window.game.enemies.enemies.filter((e) => e.persistent).length"
        )

        # 传送到离刷怪笼最远的房间
        far = page.evaluate(
            """() => {
              const g = window.game;
              const s = g.world.spawners[0];
              let best = null;
              let bestDist = -1;
              for (const r of g.dungeon.rooms) {
                const d = Math.hypot(r.cx - s.x, r.cz - s.z);
                if (d > bestDist) { bestDist = d; best = r; }
              }
              g.player.setPosition(best.cx, best.floorY, best.cz);
              g.player.syncCamera();
              return {
                dist: Math.hypot(
                  g.player.pos.x - s.x, g.player.pos.y - s.y, g.player.pos.z - s.z
                ),
              };
            }"""
        )
        page.wait_for_timeout(1500)
        far_total = page.evaluate("() => window.game.enemies.enemies.length")
        far_spawned = page.evaluate(
            "() => window.game.enemies.enemies.filter((e) => !e.persistent).length"
        )
        far_persistent = page.evaluate(
            "() => window.game.enemies.enemies.filter((e) => e.persistent).length"
        )
        print(f"  远处时 near_total={near_total} spawned={spawned} persistent={persistent}")
        print(
            f"  走开后 far_total={far_total} spawned={far_spawned} "
            f"persistent={far_persistent} dist={far['dist']:.0f}m"
        )
        check(
            "刷怪笼确实会补怪",
            spawned > 0,
            f"spawned={spawned}",
        )
        check(
            "走远后刷怪笼产物被回收",
            far["dist"] > 70 and far_spawned < spawned,
            f"spawned={spawned} far_spawned={far_spawned} dist={far['dist']:.0f}",
        )
        check(
            "房间预置的怪不会被回收",
            far_persistent >= max(1, persistent - 1),
            f"persistent={persistent} far_persistent={far_persistent}",
        )

        check("无页面错误", not errors, str(errors[:3]))
        browser.close()

    if failures:
        print(f"\n{len(failures)} 项失败")
        sys.exit(1)
    print("\n全部通过")


if __name__ == "__main__":
    main()
