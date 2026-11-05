"""导出纹理图集与实体贴图，便于人工检查像素画质量。"""
import base64
from playwright.sync_api import sync_playwright

URL = "http://localhost:5173/"


def main() -> None:
    with sync_playwright() as p:
        browser = p.chromium.launch(headless=True)
        page = browser.new_page(viewport={"width": 800, "height": 600})
        page.on("pageerror", lambda e: print("ERR", e))
        page.goto(URL, wait_until="domcontentloaded")
        page.wait_for_function(
            "() => { const el = document.getElementById('loading');"
            " return el && el.hasAttribute('hidden'); }",
            timeout=120000,
        )
        data = page.evaluate(
            """() => {
              const c = window.game.atlas.canvas;
              const out = document.createElement('canvas');
              out.width = c.width * 4;
              out.height = c.height * 4;
              const ctx = out.getContext('2d');
              ctx.imageSmoothingEnabled = false;
              ctx.fillStyle = '#202020';
              ctx.fillRect(0, 0, out.width, out.height);
              ctx.drawImage(c, 0, 0, out.width, out.height);
              return out.toDataURL('image/png');
            }"""
        )
        raw = base64.b64decode(data.split(",", 1)[1])
        with open("/tmp/mcshots/atlas.png", "wb") as f:
            f.write(raw)
        print("saved /tmp/mcshots/atlas.png", len(raw), "bytes")

        names = page.evaluate("() => Array.from(window.game.atlas.rect ? Object.keys(window.game.atlas.rect('stone')) : [])")
        print(names)
        browser.close()


main()
