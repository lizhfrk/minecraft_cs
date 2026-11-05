"""视觉验收：难度选择、手持物品面板、物品图鉴。"""
from playwright.sync_api import sync_playwright

URL = "http://localhost:5173/"
OUT = "/tmp/mcshots"


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

        # 1) 主菜单（难度选择）
        page.screenshot(path=f"{OUT}/n1-menu-diff.png")

        # 切到困难难度
        page.click('.diff-btn[data-diff="hard"]')
        page.wait_for_timeout(200)
        page.screenshot(path=f"{OUT}/n2-menu-hard.png")
        diff = page.evaluate("() => window.game.difficulty.id")
        print("difficulty after click:", diff)

        # 切回普通，避免影响后续截图
        page.click('.diff-btn[data-diff="normal"]')
        page.wait_for_timeout(200)

        # 2) 进入游戏，检查手持物品面板
        page.evaluate("window.game.startGame()")
        page.wait_for_timeout(1200)
        page.screenshot(path=f"{OUT}/n3-held-item.png")

        # 切到弓，看看面板是否跟着变
        page.evaluate("() => window.game.player.selectSlot(1)")
        page.wait_for_timeout(300)
        page.screenshot(path=f"{OUT}/n4-held-bow.png")

        # 切到面包
        page.evaluate("() => window.game.player.selectSlot(4)")
        page.wait_for_timeout(300)
        page.screenshot(path=f"{OUT}/n5-held-bread.png")

        # 3) 打开操作指南，看物品图鉴
        page.evaluate("window.game.openHelp()")
        page.wait_for_timeout(700)
        page.screenshot(path=f"{OUT}/n6-guide.png")

        # 滚到物品图鉴
        page.evaluate(
            "() => { const el = document.querySelector('.help-block.wide');"
            " el.scrollIntoView({block:'start'}); }"
        )
        page.wait_for_timeout(400)
        page.screenshot(path=f"{OUT}/n7-item-dex.png")

        # 继续往下滚，看方块那一组
        page.evaluate(
            "() => { const body = document.querySelector('.help-body');"
            " body.scrollTop += 700; }"
        )
        page.wait_for_timeout(400)
        page.screenshot(path=f"{OUT}/n8-item-dex-2.png")

        count = page.evaluate("() => document.querySelectorAll('.dex-item').length")
        print("dex items:", count)
        browser.close()


if __name__ == "__main__":
    main()
