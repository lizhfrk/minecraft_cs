"""玩法闭环测试：弓箭命中、末影龙被击杀、玩家死亡、进食、开箱、挖掘。"""
import sys
from playwright.sync_api import sync_playwright

URL = "http://localhost:5173/"

failures: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    status = "PASS" if ok else "FAIL"
    print(f"[{status}] {name} {detail}")
    if not ok:
        failures.append(name)


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 1280, "height": 760})
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_function(
            "() => { const el = document.getElementById('loading');"
            " return el && el.hasAttribute('hidden'); }",
            timeout=120000,
        )

        page.evaluate("window.game.startGame()")
        # 注入瞄准辅助函数
        page.evaluate(
            """() => {
              window.__aimAt = (tx, ty, tz) => {
                const g = window.game;
                const c = g.camera.position;
                const dx = tx - c.x, dy = ty - c.y, dz = tz - c.z;
                g.player.yaw = Math.atan2(-dx, -dz);
                g.player.pitch = Math.atan2(dy, Math.hypot(dx, dz));
                g.player.syncCamera();
              };
            }"""
        )
        page.wait_for_timeout(600)

        # ---------- 0. 传送到竞技场（空旷区域，方便做战斗测试） ----------
        page.evaluate(
            """() => {
              const g = window.game;
              g.player.setPosition(70, 12, 70);
              g.player.yaw = 0;
              g.player.pitch = 0;
              g.player.syncCamera();
            }"""
        )
        page.wait_for_timeout(1200)

        # ---------- 1. 弓箭命中僵尸 ----------
        res = page.evaluate(
            """() => {
              const g = window.game;
              const e = g.enemies.spawn('zombie', 70, 12, 76);
              g.player.setPosition(70, 12, 70);
              g.player.yaw = Math.PI;      // 面向 +z
              g.player.pitch = 0;
              g.player.syncCamera();
              const origin = g.camera.position.clone();
              g.projectiles.spawnArrow(origin, g.vec(0, 0, 1), 25, 10, true, g.player);
              return { hp: e.hp, id: e.id };
            }"""
        )
        page.wait_for_timeout(1500)
        hp_after = page.evaluate(
            """(id) => {
              const e = window.game.enemies.enemies.find(x => x.id === id);
              return e ? { hp: e.hp, dead: e.dead } : { removed: true };
            }""",
            res["id"],
        )
        check(
            "箭矢命中僵尸并造成伤害",
            hp_after is not None
            and (hp_after.get("removed") is True or hp_after["hp"] < 20),
            f"hp {res['hp']} -> {hp_after}",
        )

        # ---------- 2. 末影龙出现 ----------
        dragon_exists = page.evaluate("() => !!window.game.dragon")
        check("进入竞技场后末影龙出现", dragon_exists)

        # ---------- 2b. 射碎末影水晶 → 阻断回血 ----------
        crystals = page.evaluate(
            """() => {
              const g = window.game;
              const d = g.dragon;
              const before = d.aliveCrystals;
              // 直接调用水晶受击逻辑（等价于箭矢命中）
              const c = d.crystals.find(x => x.alive && !x.floating);
              g.onCrystalHit(c, g.vec(0, 0, 1));
              return { before, after: d.aliveCrystals, total: d.crystals.length };
            }"""
        )
        check(
            "射碎末影水晶后不再为其回血",
            crystals["after"] == crystals["before"] - 1,
            f"剩余水晶 {crystals['before']} -> {crystals['after']}",
        )

        heal = page.evaluate(
            """() => {
              const g = window.game;
              const d = g.dragon;
              // 清空剩余水晶
              for (const c of d.crystals.filter(x => x.alive)) g.onCrystalHit(c, g.vec(0,0,1));
              // 清空掉落出来的治疗水晶
              for (const c of d.crystals.filter(x => x.alive)) g.onCrystalHit(c, g.vec(0,0,1));
              const hp = d.hp;
              d.heal(0);
              d.update(1.0, g.player, g);   // 跑一整秒的回血逻辑
              return { crystals: d.aliveCrystals, hp, hpAfter: d.hp };
            }"""
        )
        check(
            "水晶清空后末影龙不再回血",
            heal["crystals"] == 0 and heal["hpAfter"] <= heal["hp"],
            str(heal),
        )

        # ---------- 3. 末影龙被击杀 → 通关 ----------
        page.evaluate(
            """() => {
              const g = window.game;
              g.dragon.setState('perch');
              g.dragon.pos.set(80, 14, 80);
              g.dragon.takeDamage(500, g.vec(0, 0, 1), g);
            }"""
        )
        page.wait_for_timeout(900)
        win_state = page.evaluate(
            """() => ({
              state: window.game.state,
              winHidden: document.getElementById('win').hasAttribute('hidden'),
              stats: document.getElementById('win-stats').textContent,
            })"""
        )
        check(
            "末影龙被击杀后进入通关界面",
            win_state["state"] == "won" and not win_state["winHidden"],
            str(win_state["stats"]),
        )

        # ---------- 4. 玩家死亡 → 死亡界面 ----------
        page.evaluate("window.game.state = 'playing'")
        page.evaluate("window.game.onPlayerDeath('僵尸')")
        page.wait_for_timeout(500)
        dead_state = page.evaluate(
            """() => ({
              state: window.game.state,
              deadHidden: document.getElementById('dead').hasAttribute('hidden'),
              cause: document.getElementById('death-cause').textContent,
            })"""
        )
        check(
            "玩家死亡后进入结算界面",
            dead_state["state"] == "dead" and not dead_state["deadHidden"],
            str(dead_state["cause"]),
        )

        # ---------- 5. 重生 ----------
        page.evaluate("document.getElementById('btn-respawn').click()")
        page.wait_for_timeout(500)
        resp = page.evaluate(
            """() => ({
              state: window.game.state,
              hp: window.game.player.health,
            })"""
        )
        check("重生恢复状态正确", resp["state"] == "playing" and resp["hp"] > 10, str(resp))

        # ---------- 6. 进食回血 ----------
        food = page.evaluate(
            """() => {
              const g = window.game;
              g.player.health = 8;
              g.player.hunger = 8;
              const idx = g.player.hotbar.findIndex(s => s && s.id === 'bread');
              if (idx < 0) return 'no bread';
              g.player.selectSlot(idx);
              g.useRightClick();
              return { hp: g.player.health, hunger: g.player.hunger };
            }"""
        )
        check(
            "进食恢复生命与饱食度",
            isinstance(food, dict) and food["hp"] > 8 and food["hunger"] > 8,
            str(food),
        )

        # ---------- 7. 打开箱子 ----------
        chest = page.evaluate(
            """() => {
              const g = window.game;
              const x = Math.floor(g.player.pos.x) + 2;
              const z = Math.floor(g.player.pos.z);
              const y = Math.floor(g.player.pos.y);
              g.world.set(x, y, z, 16);
              g.world.meta.set(g.world.index(x, y, z), {
                type: 'chest',
                loot: [{ item: 'arrow', count: 5 }, { item: 'gold', count: 2 }],
              });
              g.mesher.rebuildAround(x, y, z);
              window.__aimAt(x + 0.5, y + 0.3, z + 0.5);
              const before = g.player.countItem('arrow');
              g.interact();
              return { before, after: g.player.countItem('arrow'),
                       gold: g.player.countItem('gold') };
            }"""
        )
        check(
            "打开箱子获得战利品",
            isinstance(chest, dict) and chest["after"] > chest["before"] and chest["gold"] >= 2,
            str(chest),
        )

        # ---------- 8. 挖方块 ----------
        dig = page.evaluate(
            """() => {
              const g = window.game;
              const x = Math.floor(g.player.pos.x) + 2;
              const z = Math.floor(g.player.pos.z);
              const y = Math.floor(g.player.pos.y);
              g.breakBlock(x, y, z);
              return g.world.get(x, y, z);
            }"""
        )
        check("破坏方块生效", dig == 0, f"block={dig}")

        # ---------- 9. 放置方块 ----------
        place = page.evaluate(
            """() => {
              const g = window.game;
              g.player.giveItem('cobblestone_item', 4);
              const idx = g.player.hotbar.findIndex(s => s && s.id === 'cobblestone_item');
              g.player.selectSlot(idx);
              const x = Math.floor(g.player.pos.x) + 3;
              const z = Math.floor(g.player.pos.z);
              const y = Math.floor(g.player.pos.y);
              g.world.set(x, y, z, 1);      // 先放一块石头作为参照
              g.mesher.rebuildAround(x, y, z);
              window.__aimAt(x + 0.5, y + 0.5, z + 0.5);
              g.useRightClick();
              return {
                top: g.world.get(x, y + 1, z),
                side: g.world.get(x - 1, y, z),
                count: g.player.countItem('cobblestone_item'),
              };
            }"""
        )
        check(
            "放置方块生效",
            isinstance(place, dict) and (place["top"] != 0 or place["side"] != 0),
            str(place),
        )

        page.wait_for_timeout(600)
        browser.close()

    if errors:
        print("\n运行时错误:")
        for e in errors:
            print(" ", e)
        failures.append("runtime errors")

    print("\n结果:", "全部通过" if not failures else f"失败 {len(failures)} 项: {failures}")
    sys.exit(0 if not failures else 1)


main()
