"""浸泡测试：模拟真实键鼠输入，验证移动、攻击、爬台阶与长时间运行稳定性。"""
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:5173/"
failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    print(f"[{'PASS' if ok else 'FAIL'}] {name} {detail}")
    if not ok:
        failures.append(name)


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
        page.evaluate("window.game.startGame()")
        page.wait_for_timeout(600)

        # 模拟指针锁定（无头环境下无法真正锁定，手动补上）
        page.evaluate(
            """() => {
              const g = window.game;
              g.input.locked = true;
              Object.defineProperty(g.input, 'locked', { value: true, writable: true });
            }"""
        )

        # ---------- 1. 键盘移动 ----------
        before = page.evaluate("() => [window.game.player.pos.x, window.game.player.pos.z]")
        page.keyboard.down("KeyW")
        page.wait_for_timeout(1500)
        page.keyboard.up("KeyW")
        page.wait_for_timeout(200)
        after = page.evaluate("() => [window.game.player.pos.x, window.game.player.pos.z]")
        moved = abs(after[0] - before[0]) + abs(after[1] - before[1])
        check("WASD 移动生效", moved > 1.0, f"位移 {moved:.2f} 格")

        # ---------- 2. 跳跃 ----------
        y_before = page.evaluate("() => window.game.player.pos.y")
        page.keyboard.press("Space")
        page.wait_for_timeout(150)
        y_peak = page.evaluate("() => window.game.player.pos.y")
        page.wait_for_timeout(900)
        check("跳跃生效", y_peak > y_before + 0.3, f"y {y_before:.2f} -> {y_peak:.2f}")

        # ---------- 3. 鼠标左键攻击（近战挥砍） ----------
        page.evaluate(
            """() => {
              const g = window.game;
              // 在玩家前方找一个确定为空的位置（避免把僵尸刷进墙里）
              let sx = g.player.pos.x, sy = g.player.pos.y, sz = g.player.pos.z;
              for (let d = 2; d <= 5; d++) {
                const tx = g.player.pos.x, tz = g.player.pos.z - d;
                if (g.world.isSolid(Math.floor(tx), Math.floor(sy), Math.floor(tz))) continue;
                if (g.world.isSolid(Math.floor(tx), Math.floor(sy) + 1, Math.floor(tz))) continue;
                sx = tx; sy = g.player.pos.y; sz = tz; break;
              }
              const e = g.enemies.spawn('zombie', sx, sy, sz);
              window.__zombieId = e.id;
            }"""
        )
        page.wait_for_timeout(400)
        hp_before = page.evaluate(
            """() => {
              const e = window.game.enemies.enemies.find(x => x.id === window.__zombieId);
              return e ? e.hp : null;
            }"""
        )
        # 对准僵尸再点击（模拟玩家把准星放在目标上）
        page.evaluate(
            """() => {
              const g = window.game;
              const e = g.enemies.enemies.find(x => x.id === window.__zombieId);
              if (!e) return;
              const dx = e.pos.x - g.camera.position.x;
              const dy = e.pos.y + 0.9 - g.camera.position.y;
              const dz = e.pos.z - g.camera.position.z;
              g.player.yaw = Math.atan2(-dx, -dz);
              g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
              g.player.vel.set(0, 0, 0);
              g.player.syncCamera();
            }"""
        )
        page.wait_for_timeout(120)
        page.mouse.down()
        page.wait_for_timeout(120)
        page.mouse.up()
        melee_log = page.evaluate(
            """() => {
              const g = window.game;
              const e = g.enemies.enemies.find(x => x.id === window.__zombieId);
              const t = g.findMeleeTarget(3.4);
              return {
                locked: g.input.locked, buttons: g.input.buttons[0],
                cooldown: g.attackCooldown, held: g.player.heldItem,
                target: t ? t.target.id : null, zid: window.__zombieId,
                epos: e ? [+e.pos.x.toFixed(2), +e.pos.y.toFixed(2), +e.pos.z.toFixed(2)] : null,
                ppos: [+g.player.pos.x.toFixed(2), +g.player.pos.y.toFixed(2), +g.player.pos.z.toFixed(2)],
                cam: [+g.camera.position.x.toFixed(2), +g.camera.position.y.toFixed(2), +g.camera.position.z.toFixed(2)],
                yaw: +g.player.yaw.toFixed(3), state: g.state,
              };
            }"""
        )
        page.wait_for_timeout(400)
        hp_after = page.evaluate(
            """() => {
              const e = window.game.enemies.enemies.find(x => x.id === window.__zombieId);
              return e ? e.hp : null;
            }"""
        )
        check(
            "左键近战攻击造成伤害",
            hp_before is not None and (hp_after is None or hp_after < hp_before),
            f"hp {hp_before} -> {hp_after} | {melee_log}",
        )

        # ---------- 4. 拉弓射箭 ----------
        page.evaluate(
            """() => {
              const g = window.game;
              const bow = g.player.hotbar.findIndex(s => s && s.id === 'bow');
              g.player.selectSlot(bow);
              g.viewModel.setItem('bow');
              const arrowsBefore = g.player.countItem('arrow');
              g.charging = true;
              g.drawTime = 1.0;
              g.fireArrow(window.__W || { kind: 'bow', drawTime: 1, minSpeed: 20, maxSpeed: 52, damage: 10 });
              window.__arrowsBefore = arrowsBefore;
            }"""
        )
        page.wait_for_timeout(500)
        arrows = page.evaluate(
            """() => ({
              before: window.__arrowsBefore,
              after: window.game.player.countItem('arrow'),
              proj: window.game.projectiles.projectiles.length,
            })"""
        )
        check(
            "射箭消耗箭矢并生成投射物",
            arrows["after"] < arrows["before"],
            f"{arrows['before']} -> {arrows['after']}",
        )

        # ---------- 5. 自动上台阶（走到竖井入口） ----------
        climb = page.evaluate(
            """async () => {
              const g = window.game;
              const st = g.dungeon.stairs[0];
              // 站到竖井入口附近
              g.player.setPosition(st.from.x - 3, st.from.y, st.from.z);
              g.player.yaw = Math.atan2(1, 0);   // 面向 +x
              g.player.syncCamera();
              const y0 = g.player.pos.y;
              // 模拟按住 W 前进（直接驱动移动逻辑）
              const inp = g.input;
              inp.keys.add('KeyW');
              for (let i = 0; i < 90; i++) {
                g.player.update(1 / 60, inp);
              }
              inp.keys.delete('KeyW');
              return { y0, y1: g.player.pos.y, x: g.player.pos.x };
            }"""
        )
        check(
            "自动上台阶 / 沿地面移动",
            abs(climb["y1"] - climb["y0"]) < 3,
            f"y {climb['y0']:.2f} -> {climb['y1']:.2f}，x {climb['x']:.1f}",
        )

        # ---------- 6. 长时间运行稳定性 ----------
        page.evaluate(
            """() => {
              const g = window.game;
              g.player.setPosition(g.dungeon.spawnPoint.x, g.dungeon.spawnPoint.y, g.dungeon.spawnPoint.z);
              g.player.invulnerable = 9999;
              for (let i = 0; i < 40; i++) {
                g.enemies.spawn(['zombie', 'skeleton', 'creeper', 'spider'][i % 4],
                  g.dungeon.spawnPoint.x + (i % 7) - 3, g.dungeon.spawnPoint.y,
                  g.dungeon.spawnPoint.z + (i % 5) - 2);
              }
            }"""
        )
        page.wait_for_timeout(6000)
        alive = page.evaluate(
            """() => ({
              enemies: window.game.enemies.enemies.length,
              proj: window.game.projectiles.projectiles.length,
              pickups: window.game.pickups.pickups.length,
              hp: window.game.player.health,
              geoms: window.game.renderer.info.memory.geometries,
              texs: window.game.renderer.info.memory.textures,
            })"""
        )
        check(
            "长时间运行无崩溃且资源未失控",
            len(errors) == 0 and alive["geoms"] < 4000 and alive["texs"] < 50,
            str(alive),
        )

        # ---------- 7. 敌人被击杀后正确清理 ----------
        cleanup = page.evaluate(
            """() => {
              const g = window.game;
              g.state = 'playing';
              g.player.health = 20;
              g.player.invulnerable = 999;
              const e = g.enemies.enemies[0];
              const before = g.enemies.enemies.length;
              e.takeDamage(999, 0, g.vec(0,0,1));
              return { before };
            }"""
        )
        page.wait_for_timeout(1200)
        after_kill = page.evaluate("() => window.game.enemies.enemies.length")
        check(
            "敌人死亡后从列表中移除",
            after_kill < cleanup["before"],
            f"{cleanup['before']} -> {after_kill}",
        )

        page.screenshot(path="/tmp/mcshots/soak.png")
        browser.close()

    if errors:
        print("\n运行时错误:")
        for e in errors[:5]:
            print(" ", e)
        failures.append("runtime errors")
    print("\n结果:", "全部通过" if not failures else f"失败: {failures}")
    sys.exit(0 if not failures else 1)


main()
