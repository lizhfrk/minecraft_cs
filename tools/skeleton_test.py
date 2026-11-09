"""骷髅手感测试：近战够得到、箭打得中、不会隔墙放箭。

对应玩家反馈的三个问题：
  1. 射箭的骷髅摸不到他 —— 骷髅原来永远后退，玩家剑够不着；
  2. 弓箭数量太少，很快就打完了；
  3. 打不到他 —— 玩家的箭重力太大，20 米外必失手。
"""
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

        # 选困难难度开局 —— 用户反馈的就是这一档
        page.evaluate(
            """() => {
              localStorage.setItem('mc-cs-difficulty', 'hard');
              window.game.startGame();
            }"""
        )
        page.wait_for_timeout(800)

        # ---------- 0. 传送到竞技场空旷处 ----------
        page.evaluate(
            """() => {
              const g = window.game;
              g.player.setPosition(70, 12, 70);
              g.player.yaw = Math.PI;
              g.player.pitch = 0;
              g.player.syncCamera();
            }"""
        )
        page.wait_for_timeout(1200)

        # ---------- 1. 骷髅不再无限后退：玩家贴到 2 米时它应该压上来 ----------
        res = page.evaluate(
            """() => {
              const g = window.game;
              const e = g.enemies.spawn('skeleton', 70, 12, 72);   // 玩家正前方 2 米
              e.aggro = true;
              return { id: e.id, x: e.pos.x, z: e.pos.z };
            }"""
        )
        page.wait_for_timeout(2000)
        after = page.evaluate(
            """(id) => {
              const e = window.game.enemies.enemies.find(x => x.id === id);
              if (!e) return null;
              const p = window.game.player.pos;
              return {
                dist: Math.hypot(e.pos.x - p.x, e.pos.z - p.z),
                hp: e.hp,
              };
            }""",
            res["id"],
        )
        check(
            "骷髅不会在玩家贴脸时后退（距离没拉开）",
            after is not None and after["dist"] < 3.5,
            f"初始 2 米 → {after}",
        )

        # ---------- 2. 玩家贴脸时骷髅改用近战，不会被速射 ----------
        check(
            "玩家近战能打到骷髅（进入剑的射程）",
            after is not None and after["dist"] <= 3.4,
            f"距离 {after['dist'] if after else '?'} 米，铁剑射程 3.4 米",
        )

        # ---------- 3. 15 米外玩家的箭能命中骷髅（重力修正） ----------
        res2 = page.evaluate(
            """() => {
              const g = window.game;
              // 清场：上一只骷髅已经贴到玩家身上，不清掉的话箭会先打中它
              for (const e of [...g.enemies.enemies]) { e.dead = true; e.removed = true; }
              g.enemies.enemies = g.enemies.enemies.filter(e => !e.removed);
              const p = g.player;
              p.setPosition(70, 12, 70);
              p.yaw = Math.PI;   // 面向 +z
              p.pitch = 0;
              p.syncCamera();
              const e = g.enemies.spawn('skeleton', 70, 12, 85);   // 正前方 15 米
              e.aggro = false;
              const dir = g.vec(0, 0, 1);
              const origin = g.camera.position.clone();
              g.projectiles.spawnArrow(origin, dir, 52, 10, true, p);
              return { id: e.id, hp: e.hp };
            }"""
        )
        page.wait_for_timeout(2000)
        hit = page.evaluate(
            """(id) => {
              const e = window.game.enemies.enemies.find(x => x.id === id);
              return e ? { hp: e.hp, dead: e.dead } : { removed: true };
            }""",
            res2["id"],
        )
        check(
            "15 米外玩家的箭能命中骷髅",
            hit is not None and (hit.get("removed") is True or hit["hp"] < res2["hp"]),
            f"hp {res2['hp']} -> {hit}",
        )

        # ---------- 4. 骷髅不会隔墙放箭 ----------
        los = page.evaluate(
            """() => {
              const g = window.game;
              const e = g.enemies.spawn('skeleton', 70, 12, 70);
              e.pos.set(70, 12, 70);
              const p = g.player;
              p.setPosition(70, 12, 78);
              // 两者之间砌一堵实心墙
              for (let y = 0; y < 3; y++) g.world.set(70, 12 + y, 74, 1);
              const clear = e.hasLineOfSight(p);
              // 拆掉墙之后应该通视
              for (let y = 0; y < 3; y++) g.world.set(70, 12 + y, 74, 0);
              const after = e.hasLineOfSight(p);
              return { clear, after };
            }"""
        )
        check(
            "骷髅能看见墙后的玩家时判定为不通视",
            los["clear"] is False,
            str(los),
        )
        check(
            "墙拆掉后骷髅重新获得视线",
            los["after"] is True,
            str(los),
        )

        # ---------- 5. 箭矢供给：出生箭数 / 补给箱 / 骷髅掉落 ----------
        supply = page.evaluate(
            """() => {
              const g = window.game;
              return { arrows: g.player.countItem('arrow') };
            }"""
        )
        check(
            "出生即带有足够的箭（≥ 32 支）",
            supply["arrows"] >= 32,
            f"当前 {supply['arrows']} 支",
        )

        drops = page.evaluate(
            """async () => {
              const m = await import('/src/entities/enemies.js');
              const t = m.ENEMY_TYPES.skeleton;
              return t.drops.find(d => d.item === 'arrow');
            }"""
        )
        check(
            "骷髅掉落箭矢的概率与数量提高",
            drops["chance"] >= 0.8 and drops["count"][0] >= 2,
            str(drops),
        )

        # ---------- 6. 困难难度不再过载 ----------
        diff = page.evaluate(
            """async () => {
              const m = await import('/src/core/difficulty.js');
              return { hard: m.DIFFICULTIES.hard, pop: m.ROOM_POP.hard };
            }"""
        )
        check(
            "困难难度：伤害倍率降到 1.25 及以下",
            diff["hard"]["damageScale"] <= 1.25,
            str(diff["hard"]["damageScale"]),
        )
        check(
            "困难难度：同屏怪物上限与刷怪间隔收敛",
            diff["hard"]["maxNearby"] <= 9 and diff["hard"]["spawnInterval"] >= 14,
            str(diff["hard"]),
        )

        # ---------- 7. 玩家箭的重力比敌人的小（打得准但敌人仍可躲） ----------
        grav = page.evaluate(
            """async () => {
              const g = window.game;
              const mine = g.projectiles.spawnArrow(
                g.camera.position.clone(), g.vec(0, 0, 1), 40, 10, true, g.player);
              const theirs = g.projectiles.spawnArrow(
                g.camera.position.clone(), g.vec(0, 0, 1), 16, 4, false, null);
              const out = { mine: mine.gravity, theirs: theirs.gravity };
              mine.destroy(); theirs.destroy();
              return out;
            }"""
        )
        check(
            "玩家的箭近乎平直，敌人的箭是抛物线",
            grav["mine"] < grav["theirs"],
            str(grav),
        )

        check("没有页面错误", not errors, str(errors[:3]))

        browser.close()

    print()
    if failures:
        print(f"FAILED ({len(failures)}): {failures}")
        sys.exit(1)
    print("ALL PASS")


if __name__ == "__main__":
    main()
