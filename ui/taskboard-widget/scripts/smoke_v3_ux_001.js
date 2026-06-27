const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  const url = 'https://obiz.yahlife.com/taskboard-v2/?v=v3-ux-001'
  console.log('navigating to', url)
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 })
    if (!resp || ![200, 304].includes(resp.status())) {
      console.warn('Initial page navigation returned status', resp && resp.status())
    }

    // Wait for left panel and execution monitor to appear
    await page.waitForSelector('#left-panel', { timeout: 15000 })
    const execVisible = await page.locator('text=Execution').first().waitFor({ timeout: 15000 }).then(() => true).catch(() => false)

    // Check left panel collapse toggle
    const leftPanelWidthBefore = await page.$eval('#left-panel', (el) => window.getComputedStyle(el).width).catch(() => null)
    const toggle = await page.$('button[aria-label*="sessions panel"]')
    let leftPanelWidthAfter = null
    if (toggle) {
      await toggle.click()
      await page.waitForTimeout(500)
      leftPanelWidthAfter = await page.$eval('#left-panel', (el) => window.getComputedStyle(el).width).catch(() => null)
    }

    // Fetch manifest to ensure reachable
    const manifestReq = await page.request.get('https://obiz.yahlife.com/taskboard-v2/manifest.webmanifest')
    const manifestOk = manifestReq && manifestReq.status() === 200

    // Screenshot
    await page.screenshot({ path: '/tmp/playwright_v3_ux_001.png', fullPage: true })

    await browser.close()

    const result = {
      pageStatus: resp ? resp.status() : null,
      execMonitorPresent: execVisible,
      leftPanelWidthBefore,
      leftPanelWidthAfter,
      manifestReachable: manifestOk,
      screenshot: '/tmp/playwright_v3_ux_001.png'
    }

    console.log('SMOKE RESULT', JSON.stringify(result, null, 2))
    process.exit(0)
  } catch (e) {
    console.error('Playwright smoke error', e)
    try { await browser.close() } catch (ie) {}
    process.exit(2)
  }
})()
