"""操作指南测试：菜单 / 游戏内 / 暂停三种入口下打开与关闭指南。"""
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
        page = browser.new_page(viewport={"width": 1280, "height": 800})
        errors: list[str] = []
        page.on("pageerror", lambda e: errors.append(str(e)))
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_function(
            "() => { const el = document.getElementById('loading');"
            " return el && el.hasAttribute('hidden'); }",
            timeout=120000,
        )

        # ---------- 1. 主菜单入口 ----------
        page.click("#btn-howto")
        page.wait_for_timeout(200)
        menu_open = page.evaluate(
            """() => ({
              visible: !document.getElementById('help').hidden,
              state: window.game.state,
              menuHidden: document.getElementById('menu').hidden,
              blocks: document.querySelectorAll('#help .help-block').length,
              keys: document.querySelectorAll('#help .help-keys > div').length,
            })"""
        )
        check(
            "主菜单「操作指南」打开指南",
            menu_open["visible"] and menu_open["state"] == "help" and menu_open["menuHidden"],
            str(menu_open),
        )
        check(
            "指南内容完整（12 个板块 / 14 条键位）",
            menu_open["blocks"] == 12 and menu_open["keys"] == 14,
            str(menu_open),
        )
        dex = page.evaluate(
            "() => ({"
            " items: document.querySelectorAll('#item-dex .dex-item').length,"
            " groups: document.querySelectorAll('#item-dex .dex-group').length,"
            " named: [...document.querySelectorAll('#item-dex .dex-name')]"
            "   .filter((n) => n.textContent.trim().length > 0).length,"
            " described: [...document.querySelectorAll('#item-dex .dex-desc')]"
            "   .filter((n) => n.textContent.trim().length > 0).length,"
            "})"
        )
        check(
            "物品图鉴列出了全部物品并带说明",
            dex["items"] >= 40
            and dex["groups"] == 5
            and dex["named"] == dex["items"]
            and dex["described"] == dex["items"],
            str(dex),
        )
        page.click("#btn-help-close")
        page.wait_for_timeout(200)
        after_close = page.evaluate(
            "() => ({ state: window.game.state, helpHidden: document.getElementById('help').hidden })"
        )
        check(
            "关闭指南后回到主菜单",
            after_close["state"] == "menu" and after_close["helpHidden"],
            str(after_close),
        )

        # ---------- 2. 游戏内按 H ----------
        page.evaluate("window.game.startGame()")
        page.wait_for_timeout(400)
        page.keyboard.press("KeyH")
        page.wait_for_timeout(200)
        in_game = page.evaluate(
            """() => ({
              state: window.game.state,
              visible: !document.getElementById('help').hidden,
              locked: window.game.input.locked,
            })"""
        )
        check(
            "游戏中按 H 打开指南并自动暂停",
            in_game["state"] == "help" and in_game["visible"],
            str(in_game),
        )
        page.keyboard.press("KeyH")
        page.wait_for_timeout(200)
        closed = page.evaluate(
            "() => ({ state: window.game.state, helpHidden: document.getElementById('help').hidden })"
        )
        check(
            "再次按 H 关闭指南并恢复游戏",
            closed["state"] == "playing" and closed["helpHidden"],
            str(closed),
        )

        # ---------- 3. 暂停界面 ----------
        page.evaluate("window.game.pause()")
        page.wait_for_timeout(200)
        page.click("#btn-help")
        page.wait_for_timeout(200)
        from_pause = page.evaluate(
            """() => ({
              state: window.game.state,
              visible: !document.getElementById('help').hidden,
              pauseHidden: document.getElementById('pause').hidden,
            })"""
        )
        check(
            "暂停界面打开指南",
            from_pause["state"] == "help" and from_pause["visible"] and from_pause["pauseHidden"],
            str(from_pause),
        )
        page.keyboard.press("Escape")
        page.wait_for_timeout(200)
        back_to_pause = page.evaluate(
            "() => ({ state: window.game.state, pauseVisible: !document.getElementById('pause').hidden })"
        )
        check(
            "指南中按 Esc 回到暂停界面",
            back_to_pause["state"] == "paused" and back_to_pause["pauseVisible"],
            str(back_to_pause),
        )

        page.screenshot(path="/tmp/mcshots/help.png")
        page.evaluate("window.game.openHelp()")
        page.wait_for_timeout(300)
        page.screenshot(path="/tmp/mcshots/help-full.png")
        browser.close()

    if errors:
        print("\n运行时错误:")
        for e in errors[:5]:
            print(" ", e)
        failures.append("runtime errors")
    print("\n结果:", "全部通过" if not failures else f"失败: {failures}")
    sys.exit(0 if not failures else 1)


main()
