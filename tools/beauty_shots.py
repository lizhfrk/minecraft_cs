"""视觉验收：在地牢各处取景截图。"""
from playwright.sync_api import sync_playwright

URL = "http://localhost:5173/"
OUT = "/tmp/mcshots"


def aim(page, tx, ty, tz) -> None:
    page.evaluate(
        """([tx, ty, tz]) => {
          const g = window.game;
          const c = g.camera.position;
          const dx = tx - c.x, dy = ty - c.y, dz = tz - c.z;
          g.player.yaw = Math.atan2(-dx, -dz);
          g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
          g.player.syncCamera();
        }""",
        [tx, ty, tz],
    )


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 720})
        page.on("pageerror", lambda e: print("ERR", e))
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_function(
            "() => { const el = document.getElementById('loading');"
            " return el && el.hasAttribute('hidden'); }",
            timeout=120000,
        )
        page.evaluate("window.game.startGame()")
        page.wait_for_timeout(800)

        # 1) 入口房间
        page.evaluate(
            """() => {
              const g = window.game;
              const sp = g.dungeon.spawnPoint;
              g.player.setPosition(sp.x - 4, sp.y, sp.z + 3);
              g.player.syncCamera();
            }"""
        )
        page.wait_for_timeout(500)
        aim(page, 133, 59, 72)
        page.wait_for_timeout(400)
        page.screenshot(path=f"{OUT}/a-entrance.png")

        # 2) 竖井内部（向下看）
        shaft = page.evaluate(
            """() => {
              const g = window.game;
              const st = g.dungeon.stairs[0];
              return { x: st.from.x, y: st.from.y, z: st.from.z };
            }"""
        )
        page.evaluate(
            """(s) => {
              const g = window.game;
              g.player.setPosition(s.x - 1.5, s.y, s.z);
              g.player.pitch = -0.5;
              g.player.syncCamera();
            }""",
            shaft,
        )
        page.wait_for_timeout(500)
        page.screenshot(path=f"{OUT}/b-shaft.png")

        # 3) 竞技场 + 末影龙
        page.evaluate(
            """() => {
              const g = window.game;
              g.player.setPosition(80, 12, 62);
              g.player.syncCamera();
            }"""
        )
        page.wait_for_timeout(2500)
        page.screenshot(path=f"{OUT}/c-arena.png")

        # 4) 对准末影龙
        dpos = page.evaluate(
            """() => {
              const g = window.game;
              return g.dragon ? [g.dragon.pos.x, g.dragon.pos.y, g.dragon.pos.z] : null;
            }"""
        )
        if dpos:
            page.evaluate(
                """(d) => {
                  const g = window.game;
                  g.player.setPosition(d[0] + 9, 12, d[2] + 9);
                  g.player.syncCamera();
                }""",
                dpos,
            )
            page.wait_for_timeout(300)
            aim(page, dpos[0], dpos[1], dpos[2])
            page.wait_for_timeout(400)
            page.screenshot(path=f"{OUT}/d-dragon.png")
            print("dragon at", dpos)

        # 5) 末影水晶
        page.evaluate(
            """() => {
              const g = window.game;
              const c = g.dragon.crystals[0];
              g.player.setPosition(c.pos.x + 2.5, 12, c.pos.z + 2.5);
              g.player.syncCamera();
            }"""
        )
        page.wait_for_timeout(400)
        aim(page, 0, 0, 0)
        page.evaluate(
            """() => {
              const g = window.game;
              const c = g.dragon.crystals[0];
              const cam = g.camera.position;
              const dx = c.pos.x - cam.x, dy = c.pos.y - cam.y, dz = c.pos.z - cam.z;
              g.player.yaw = Math.atan2(-dx, -dz);
              g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
              g.player.syncCamera();
            }"""
        )
        page.wait_for_timeout(400)
        page.screenshot(path=f"{OUT}/e-crystal.png")

        # 6) 拉弓视角
        page.evaluate(
            """() => {
              const g = window.game;
              const bow = g.player.hotbar.findIndex(s => s && s.id === 'bow');
              g.player.selectSlot(bow);
              g.viewModel.setItem('bow');
              g.charging = true;
              g.drawTime = 1.0;
            }"""
        )
        page.wait_for_timeout(600)
        page.screenshot(path=f"{OUT}/f-bow.png")

        browser.close()
    print("shots saved")


main()
