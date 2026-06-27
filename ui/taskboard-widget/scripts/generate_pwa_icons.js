const fs = require('fs')
const path = require('path')
const { chromium } = require('playwright')

;(async () => {
  try {
    const svgPath = path.join(__dirname, '..', 'public', 'assets', 'icons', 'icon.svg')
    const svg = fs.readFileSync(svgPath, 'utf8')
    const sizes = [192, 512]
    const outDir = path.join(__dirname, '..', 'public', 'assets', 'icons')
    if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true })

    const browser = await chromium.launch({ headless: true })
    const page = await browser.newPage()

    for (const size of sizes) {
      const html = `<!doctype html><html><head><meta charset="utf-8"><style>html,body{margin:0;padding:0;background:transparent}</style></head><body style="width:${size}px;height:${size}px;display:flex;align-items:center;justify-content:center;">${svg}</body></html>`
      await page.setViewportSize({ width: size, height: size })
      await page.setContent(html, { waitUntil: 'networkidle' })
      const out = path.join(outDir, `icon-${size}.png`)
      await page.screenshot({ path: out, omitBackground: true })
      console.log('Wrote', out)
    }

    await browser.close()
    process.exit(0)
  } catch (e) {
    console.error('Icon generation failed', e)
    process.exit(2)
  }
})()
