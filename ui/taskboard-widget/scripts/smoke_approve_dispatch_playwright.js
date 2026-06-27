const { chromium } = require('playwright')

;(async () => {
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()
  const page = await context.newPage()
  const url = 'https://obiz.yahlife.com/taskboard-v2/?v=approve-dispatch-fix-001'
  console.log('navigating to', url)
  await page.goto(url, { waitUntil: 'networkidle' })

  try {
    // Wait for Review Decisions panel
    await page.waitForSelector('text=Review Decisions', { timeout: 15000 })
  } catch (e) {
    console.error('Review Decisions panel did not appear', e)
  }

  // Give the page a moment to settle
  await page.waitForTimeout(1500)

  // Try to locate a Dispatch button
  const dispatchButton = await page.$('button:has-text("Dispatch to Engineering")')
  const sendButton = await page.$('button:has-text("Send")')

  // Take a full-page screenshot for debugging
  await page.screenshot({ path: '/tmp/playwright_full.png', fullPage: true })

  if (dispatchButton) {
    console.log('Dispatch button found')
    try { await dispatchButton.screenshot({ path: '/tmp/playwright_dispatch_btn.png' }) } catch (e) {}
    await browser.close()
    process.stdout.write(JSON.stringify({ result: 'PASS', dispatch: true }))
    process.exit(0)
  } else {
    console.log('Dispatch button NOT found')
    if (sendButton) {
      try { await sendButton.screenshot({ path: '/tmp/playwright_send_btn.png' }) } catch (e) {}
    }
    await browser.close()
    process.stdout.write(JSON.stringify({ result: 'FAIL', dispatch: false }))
    process.exit(2)
  }
})().catch((e) => {
  console.error('playwright error', e)
  process.exit(3)
})
