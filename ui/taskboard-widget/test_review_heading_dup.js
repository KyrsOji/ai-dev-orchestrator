const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  const url = 'https://obiz.yahlife.com/taskboard-v2/?v=sessions-branch-duplicate-fix-001'
  console.log('navigating to', url)
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 })
    if (!resp || ![200, 304].includes(resp.status())) console.warn('Initial page navigation returned status', resp && resp.status())

    await page.waitForSelector('#left-panel', { timeout: 20000 })

    // Count occurrences of the heading text
    const count = await page.locator('text=Review Decisions').count().catch(() => 0)

    await page.screenshot({ path: '/tmp/playwright_review_heading_dup.png', fullPage: true })
    await browser.close()

    console.log('REVIEW_HEADING_COUNT', count)
    if (count !== 1) {
      console.error('Unexpected number of "Review Decisions" headings:', count)
      process.exit(2)
    }
    console.log('OK: exactly one Review Decisions heading present')
    process.exit(0)
  } catch (e) {
    console.error('verify error', e)
    try { await browser.close() } catch (ie) {}
    process.exit(2)
  }
})()
