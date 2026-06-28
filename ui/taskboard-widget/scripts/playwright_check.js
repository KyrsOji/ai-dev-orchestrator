const { chromium } = require('playwright');

(async () => {
  const viewports = [
    { name: 'desktop', width: 1280, height: 800 },
    { name: 'tablet', width: 768, height: 1024 },
    { name: 'mobile', width: 375, height: 812 }
  ];

  const url = 'http://localhost:3000/taskboard-v2';

  for (const vp of viewports) {
    const browser = await chromium.launch();
    const context = await browser.newContext({ viewport: { width: vp.width, height: vp.height } });

    // instrument fetch and EventSource before scripts run
    await context.addInitScript(() => {
      try {
        window.__fetch_calls = [];
        const _fetch = window.fetch;
        window.fetch = function() {
          try { window.__fetch_calls.push({ url: arguments[0], t: Date.now() }); } catch (e) {}
          return _fetch.apply(this, arguments);
        };
      } catch (e) {}

      try {
        const NativeES = window.EventSource;
        function WrappedES(url, opts) {
          const es = new NativeES(url, opts);
          try {
            es.addEventListener('open', function() {
              window.__sse_opened = window.__sse_opened || [];
              window.__sse_opened.push({ url: url, t: Date.now(), type: 'es' });
            });
          } catch (e) {}
          return es;
        }
        WrappedES.prototype = NativeES.prototype;
        WrappedES.CONNECTING = NativeES.CONNECTING;
        WrappedES.OPEN = NativeES.OPEN;
        WrappedES.CLOSED = NativeES.CLOSED;
        window.EventSource = WrappedES;
      } catch (e) {}

      try {
        const NativeWS = window.WebSocket;
        function WrappedWS(url, protocols) {
          const ws = protocols ? new NativeWS(url, protocols) : new NativeWS(url);
          try {
            ws.addEventListener('open', function() {
              window.__sse_opened = window.__sse_opened || [];
              window.__sse_opened.push({ url: url, t: Date.now(), type: 'ws' });
            });
          } catch (e) {}
          return ws;
        }
        WrappedWS.prototype = NativeWS.prototype;
        window.WebSocket = WrappedWS;
      } catch (e) {}
    });

    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 10000 });

      // wait for SSE open (EventSource) or timeout
      try {
        await page.waitForFunction(() => window.__sse_opened && window.__sse_opened.length > 0, { timeout: 5000 });
      } catch (e) {
        // no SSE opened within timeout
      }

      const sseOpened = await page.evaluate(() => Array.isArray(window.__sse_opened) && window.__sse_opened.length > 0);
      const foundLiveText = await page.evaluate(() => (document && document.body && document.body.innerText || '').toLowerCase().includes('live'));

      // collect fetch calls after SSE open
      const fetchCalls = await page.evaluate(() => (window.__fetch_calls || []).slice());
      const sseTs = await page.evaluate(() => (window.__sse_opened && window.__sse_opened[0] && window.__sse_opened[0].t) || null);
      const callsAfter = (fetchCalls || []).filter(c => !sseTs || c.t > sseTs + 10);

      // screenshot
      const screenshotPath = `./playwright-screenshot-${vp.name}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: true });

      console.log(JSON.stringify({ viewport: vp.name, sseOpened, foundLiveText, fetchCallsCount: fetchCalls.length, fetchAfterSse: callsAfter.length, screenshot: screenshotPath }));
    } catch (err) {
      console.error('error', err && err.message ? err.message : err);
    } finally {
      await context.close();
      await browser.close();
    }
  }

  process.exit(0);
})();
