"""游戏冒烟测试：加载页面、检查控制台错误、进入游戏并截图。"""
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:5173/"
OUT = "/tmp/mcshots"

errors: list[str] = []
logs: list[str] = []


def report() -> None:
    print("\n=== CONSOLE (last 40) ===")
    for line in logs[-40:]:
        print(line)
    print("\n=== ERRORS ===")
    if errors:
        for e in errors:
            print(e)
        sys.exit(1)
    print("no page errors")


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 760})
        page.on("console", lambda m: logs.append(f"[{m.type}] {m.text}"))
        page.on("pageerror", lambda e: errors.append(f"PAGEERROR: {e}"))

        page.goto(URL, wait_until="domcontentloaded")

        # 等待地牢生成完毕（loading 元素带上 hidden 属性）
        try:
            page.wait_for_function(
                "() => { const el = document.getElementById('loading');"
                " return el && el.hasAttribute('hidden'); }",
                timeout=120000,
            )
        except Exception as e:
            errors.append(f"LOADING TIMEOUT: {e}")
            page.screenshot(path=f"{OUT}/00-loading-stuck.png")
            browser.close()
            report()
            return

        page.wait_for_timeout(1200)
        page.screenshot(path=f"{OUT}/01-menu.png")
        print("menu ok")

        page.evaluate("window.game.startGame()")
        page.wait_for_timeout(1500)
        page.screenshot(path=f"{OUT}/02-game.png")

        state = page.evaluate(
            """() => {
              const g = window.game;
              return {
                state: g.state,
                playerPos: [g.player.pos.x, g.player.pos.y, g.player.pos.z],
                health: g.player.health,
                hotbar: g.player.hotbar.map(s => s ? s.id + 'x' + s.count : null),
                enemies: g.enemies.enemies.length,
                rooms: g.dungeon.rooms.length,
                stairs: (g.dungeon.stairs || []).length,
                crystalSpots: (g.dungeon.crystalSpots || []).length,
                spawnPoint: g.dungeon.spawnPoint,
                drawCalls: g.renderer.info.render.calls,
                triangles: g.renderer.info.render.triangles,
                chunkMeshes: g.mesher.group.children.length,
              };
            }"""
        )
        print("STATE:", state)

        # 转身看房间另一侧
        page.evaluate(
            """() => {
              const g = window.game;
              g.player.yaw = 2.2;
              g.player.pitch = -0.12;
              g.player.syncCamera();
            }"""
        )
        page.wait_for_timeout(600)
        page.screenshot(path=f"{OUT}/03-turned.png")

        # 传送到竞技场（站在场地一角，朝向中心）
        page.evaluate(
            """() => {
              const g = window.game;
              g.player.setPosition(95, 12, 95);
              g.player.yaw = Math.PI / 4;
              g.player.pitch = 0.08;
              g.player.syncCamera();
            }"""
        )
        page.wait_for_timeout(2000)
        page.screenshot(path=f"{OUT}/04-arena.png")
        dragon_state = page.evaluate(
            """() => {
              const g = window.game;
              return g.dragon ? {
                hp: g.dragon.hp, state: g.dragon.state,
                crystals: g.dragon.crystals.length,
                pos: [g.dragon.pos.x, g.dragon.pos.y, g.dragon.pos.z],
              } : null;
            }"""
        )
        print("DRAGON:", dragon_state)

        # 召唤四种敌人（放在竞技场内部的空地上）
        page.evaluate(
            """() => {
              const g = window.game;
              g.enemies.spawn('zombie', 88, 12, 88);
              g.enemies.spawn('skeleton', 91, 12, 86);
              g.enemies.spawn('creeper', 86, 12, 91);
              g.enemies.spawn('spider', 92, 12, 92);
            }"""
        )
        page.wait_for_timeout(2500)
        page.screenshot(path=f"{OUT}/05-enemies.png")
        enemy_state = page.evaluate(
            """() => window.game.enemies.enemies.map(e => ({
                type: e.type, hp: e.hp, bar: e.healthBar.visible,
                pos: [Math.round(e.pos.x), Math.round(e.pos.y), Math.round(e.pos.z)],
            }))"""
        )
        print("ENEMIES:", enemy_state)

        # 瞄准僵尸并挥剑（先走近一点）
        page.evaluate(
            """() => {
              const g = window.game;
              const e = g.enemies.enemies.find(x => x.type === 'zombie' && !x.dead);
              if (!e) return;
              // 站到僵尸正前方 2 格
              g.player.setPosition(e.pos.x, e.pos.y, e.pos.z + 2);
              const dx = e.pos.x - g.player.pos.x;
              const dz = e.pos.z - g.player.pos.z;
              g.player.yaw = Math.atan2(-dx, -dz);
              g.player.pitch = 0;
              g.player.syncCamera();
            }"""
        )
        page.wait_for_timeout(400)
        hit = page.evaluate(
            """() => {
              const g = window.game;
              const target = g.findMeleeTarget(4);
              if (!target) return 'no target';
              g.attackCooldown = 0;
              g.applyMeleeHit(target, { damage: 5, knockback: 5.5 });
              const e = g.enemies.enemies.find(x => x.type === 'zombie');
              return e ? { hp: e.hp, dead: e.dead } : 'gone';
            }"""
        )
        print("MELEE:", hit)
        page.wait_for_timeout(400)
        page.screenshot(path=f"{OUT}/06-attack.png")

        # 射箭测试
        arrow = page.evaluate(
            """() => {
              const g = window.game;
              const e = g.enemies.enemies.find(x => x.type === 'zombie' && !x.dead);
              if (!e) return 'no zombie';
              const origin = g.camera.position.clone();
              const c = e.center;
              const dir = g.vec(c.x - origin.x, c.y - origin.y, c.z - origin.z).normalize();
              g.projectiles.spawnArrow(origin, dir, 30, 10, true, g.player);
              return 'spawned';
            }"""
        )
        print("ARROW:", arrow)
        page.wait_for_timeout(900)
        page.screenshot(path=f"{OUT}/07-arrow.png")

        # 破坏方块 + 放置方块
        block_ops = page.evaluate(
            """() => {
              const g = window.game;
              const p = g.player.pos;
              const bx = Math.floor(p.x) + 2, bz = Math.floor(p.z);
              let by = null;
              for (let y = Math.floor(p.y) + 3; y > Math.floor(p.y) - 3; y--) {
                if (g.world.isSolid(bx, y, bz)) { by = y; break; }
              }
              if (by === null) return 'no block';
              g.breakBlock(bx, by, bz);
              const after = g.world.get(bx, by, bz);
              g.world.set(bx, by, bz, 1);
              g.mesher.rebuildAround(bx, by, bz);
              return { broke: after, restored: g.world.get(bx, by, bz) };
            }"""
        )
        print("BLOCKS:", block_ops)

        page.wait_for_timeout(1500)
        browser.close()
        report()


main()
