const { chromium } = require('playwright');
const fs = require('fs');

(async () => {
  const url = process.env.URL || 'http://127.0.0.1:3010/taskboard-v2';
  const outDir = process.env.OUTDIR || './screenshots';
  if (!fs.existsSync(outDir)) fs.mkdirSync(outDir, { recursive: true });

  const browser = await chromium.launch();

  try {
    // Desktop
    let context = await browser.newContext({ viewport: { width: 1024, height: 768 } });
    let page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${outDir}/desktop.png`, fullPage: true });
    await context.close();

    // Tablet
    context = await browser.newContext({ viewport: { width: 768, height: 1024 } });
    page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${outDir}/tablet.png`, fullPage: true });
    await context.close();

    // Mobile
    context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true });
    page = await context.newPage();
    await page.goto(url, { waitUntil: 'networkidle' });
    await page.screenshot({ path: `${outDir}/mobile.png`, fullPage: true });
    await context.close();

    console.log('Screenshots saved to', outDir);
  } finally {
    await browser.close();
  }

})();
