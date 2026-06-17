const puppeteer = require('puppeteer-core');
const fs = require('fs');

const BASE = 'http://127.0.0.1:3000/taskboard/?v=opinion-polish';
const TASK_ID = 'PWA-MOBILE-HOME-001';
const CHROMIUM = '/usr/bin/chromium-browser';

async function clickButtonByText(page, text) {
  const handles = await page.$x(`//button[normalize-space(.)='${text}']`);
  if (!handles || handles.length === 0) throw new Error(`Button with text '${text}' not found`);
  await handles[0].click();
}

async function runViewport(width, height) {
  console.log(`\n--- Running viewport ${width}x${height} ---`);
  const browser = await puppeteer.launch({
    executablePath: CHROMIUM,
    headless: true,
    args: ['--no-sandbox', '--disable-setuid-sandbox']
  });
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE:', msg.text()));

  await page.setViewport({ width, height });
  await page.goto(BASE, { waitUntil: 'networkidle2', timeout: 30000 });
  console.log('Loaded PWA');

  // wait for threads list
  await page.waitForSelector('.threads-list', { timeout: 10000 });
  console.log('threads list present');

  // Click the task tile for TASK_ID (match title shown on card)
  const taskTitle = await page.evaluate((taskId) => {
    // Try to find by taskId inside available DOM; fall back to title lookup
    const cards = Array.from(document.querySelectorAll('.card'));
    for (const c of cards) {
      if (c.innerText && c.innerText.indexOf(taskId) !== -1) return c.querySelector('.card-title')?.innerText || null;
    }
    // fallback to first .card-title
    const el = document.querySelector('.card-title');
    return el ? el.innerText : null;
  }, TASK_ID);

  console.log('Detected task title on card:', taskTitle);

  // Try clicking by card-title text matching the known title OR by finding the card that contains TASK_ID text
  let clicked = false;
  try {
    // Attempt to find a card whose innerText contains TASK_ID
    const cardHandle = await page.$x(`//div[contains(@class,'card') and normalize-space(. )[contains(., '${TASK_ID}')]]`);
    if (cardHandle && cardHandle.length) {
      await cardHandle[0].click();
      clicked = true;
    }
  } catch (e) {
    // ignore xpath complexity
  }

  if (!clicked) {
    // fallback: click first card that has card-title matching the earlier detected title
    if (taskTitle) {
      const handle = await page.$x(`//div[contains(@class,'card-title') and normalize-space(.)='${taskTitle}']/ancestor::div[contains(@class,'card')][1]`);
      if (handle && handle.length) {
        await handle[0].click();
        clicked = true;
      }
    }
  }

  if (!clicked) {
    // fallback: click first thread-item
    const first = await page.$('.thread-item, .card');
    if (first) { await first.click(); clicked = true; }
  }

  if (!clicked) throw new Error('Failed to click task card');
  console.log('Clicked task card');

  // Wait for detail pane / composer
  await page.waitForSelector('.composer button', { timeout: 10000 });
  console.log('Composer ready');

  // Click Get 2nd Opinion
  await clickButtonByText(page, 'Get 2nd Opinion');
  console.log('Clicked Get 2nd Opinion');

  // Wait for modal
  await page.waitForSelector('.modal-overlay', { timeout: 5000 });
  console.log('Modal opened');

  // Check no horizontal scroll
  const scrollCheck = await page.evaluate(() => ({ scrollWidth: document.documentElement.scrollWidth, innerWidth: window.innerWidth }));
  console.log('Document scrollWidth / innerWidth:', scrollCheck.scrollWidth, '/', scrollCheck.innerWidth);

  const noHorizontalScroll = scrollCheck.scrollWidth <= scrollCheck.innerWidth + 2;
  console.log('No horizontal scroll:', noHorizontalScroll);

  // Check field sizes and tappable buttons
  const fieldMetrics = await page.evaluate(() => {
    const input = document.querySelector('.modal input');
    const textarea = document.querySelector('.modal textarea');
    const cancelBtn = Array.from(document.querySelectorAll('.modal button')).find(b => b.innerText.trim() === 'Cancel');
    const saveBtn = Array.from(document.querySelectorAll('.modal button')).find(b => b.innerText.trim() === 'Save');
    function rectInfo(el) { if (!el) return null; const r = el.getBoundingClientRect(); return { width: Math.round(r.width), height: Math.round(r.height), top: Math.round(r.top), left: Math.round(r.left) } }
    return { input: rectInfo(input), textarea: rectInfo(textarea), cancel: rectInfo(cancelBtn), save: rectInfo(saveBtn), viewport: { w: window.innerWidth, h: window.innerHeight } }
  });

  console.log('Field metrics:', JSON.stringify(fieldMetrics, null, 2));

  // Ensure cancel works
  await clickButtonByText(page, 'Cancel');
  await page.waitForTimeout(300);
  const modalGone = await page.$('.modal-overlay') === null;
  console.log('Cancel closed modal:', modalGone);

  // Re-open and fill fields
  await clickButtonByText(page, 'Get 2nd Opinion');
  await page.waitForSelector('.modal-overlay', { timeout: 5000 });
  await page.type('.modal input', 'Reviewer Alternative', { delay: 20 });
  await page.type('.modal textarea', 'Consider using a dedicated result cache rather than polling.', { delay: 20 });

  // Intercept network for POST to opinions
  const postPromise = page.waitForResponse(resp => resp.url().includes(`/taskboard/api/opinions/${encodeURIComponent(TASK_ID)}`) && resp.status() >= 200 && resp.status() < 300, { timeout: 10000 }).catch(e => null);

  await clickButtonByText(page, 'Save Opinion');
  console.log('Clicked Save');

  const postResponse = await postPromise;
  if (!postResponse) {
    console.log('No POST response captured for opinions (timed out)');
  } else {
    const json = await postResponse.json();
    console.log('POST /opinions response:', JSON.stringify(json, null, 2));
  }

  // Wait for the opinion bubble to appear in the messages area
  await page.waitForFunction((title) => {
    const bubbles = Array.from(document.querySelectorAll('.message-bubble'));
    return bubbles.some(b => b.classList.contains('second_opinion') && b.innerText.indexOf(title) !== -1);
  }, { timeout: 5000 }, 'Reviewer Alternative');
  console.log('Opinion bubble present in thread');

  // Verify runner bubble exists
  const runnerExists = await page.evaluate(() => !!document.querySelector('.message-bubble.openhands'));
  console.log('Runner bubble present:', runnerExists);

  // Click Refresh and wait for the results GET
  const resPromise = page.waitForResponse(resp => resp.url().includes(`/taskboard/api/results/${encodeURIComponent(TASK_ID)}`) && resp.status() === 200, { timeout: 10000 }).catch(e => null);
  await clickButtonByText(page, 'Refresh');
  console.log('Clicked Refresh');
  const resResp = await resPromise;
  console.log('Refresh GET caught:', !!resResp);

  await browser.close();
  return { noHorizontalScroll, fieldMetrics, postCaptured: !!postResponse, runnerExists, refreshGotResponse: !!resResp };
}

(async () => {
  try {
    const results1 = await runViewport(390, 844);
    console.log('Result viewport 390x844:', JSON.stringify(results1, null, 2));

    const results2 = await runViewport(430, 932);
    console.log('Result viewport 430x932:', JSON.stringify(results2, null, 2));

    // Also fetch opinions JSON to show final state
    const http = require('http');
    const url = `http://127.0.0.1:3000/taskboard/api/opinions/${encodeURIComponent(TASK_ID)}`;
    http.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        try { const parsed = JSON.parse(data); console.log('Final GET /opinions response:', JSON.stringify(parsed, null, 2)); } catch(e) { console.log('Failed to parse opinions JSON:', e); }
      });
    }).on('error', (e) => console.error('GET opinions error', e));

  } catch (e) {
    console.error('Validation script failed:', e);
    process.exit(2);
  }
})();
