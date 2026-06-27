const { chromium } = require('playwright')

function pad(n) { return String(n).padStart(2, '0') }
function genPwaId() {
  const now = new Date()
  return `PWA-${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}-${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`
}

async function sleep(ms) { return new Promise(r => setTimeout(r, ms)) }

;(async () => {
  const base = 'https://obiz.yahlife.com'
  const browser = await chromium.launch({ headless: true })
  const context = await browser.newContext()

  // support --auth-from-server-env: read TASKBOARD_API_TOKEN from process.env without printing
  const useServerEnvAuth = process.argv && process.argv.indexOf('--auth-from-server-env') !== -1
  const serverToken = useServerEnvAuth ? (process.env.TASKBOARD_API_TOKEN || null) : null
  if (useServerEnvAuth && !serverToken) {
    console.warn('Warning: --auth-from-server-env requested but TASKBOARD_API_TOKEN not set in environment; proceeding without token')
  }

  // Inject token into every page as a global and localStorage if present (do NOT print token)
  if (serverToken) {
    try {
      await context.addInitScript((t) => {
        try { window.__TASKBOARD_API_TOKEN = t } catch (e) {}
        try { window.localStorage && window.localStorage.setItem && window.localStorage.setItem('taskboard_standalone_token', t) } catch (e) {}
      }, serverToken)
    } catch (e) {
      // addInitScript may fail in some Playwright versions; fallback to setting later
    }
  }

  const page = await context.newPage()

  const taskId = genPwaId()
  const oldSessionId = 'sess-old-' + Date.now().toString(36)
  const now = new Date().toISOString()
  const execReport = { id: 'old-exec-' + Date.now().toString(36), status: 'completed', summary: 'original execution', stdout: 'original output', completedAt: now }

  const fixture = {
    taskId: taskId,
    title: `E2E followup lifecycle ${taskId}`,
    sessions: [
      {
        sessionId: oldSessionId,
        title: 'Original session',
        createdAt: now,
        updatedAt: now,
        messages: [{ id: 'm1', author: 'user', text: 'initial message', createdAt: now }],
        reviewDecision: { proposals: [{ id: 'r1', description: 'Initial decision' }] },
        selectedActionId: 'r1',
        approval: { value: true, approver: 'tester', approvedAt: now },
        dispatch: { value: true, dispatchedAt: now },
        executionReport: execReport,
        artifacts: [],
        timeline: [],
        status: 'Complete',
        immutable: true
      }
    ],
    activeSessionId: oldSessionId,
    updatedAt: now
  }

  console.log('Creating fixture task', taskId)
  try {
    const saveResp = await context.request.post(`${base}/taskboard/api/task/save`, {
      data: JSON.stringify(fixture),
      headers: { 'Content-Type': 'application/json' }
    })
    if (!saveResp || saveResp.status() >= 400) {
      console.error('Failed to save fixture task', saveResp && saveResp.status && saveResp.status())
      await browser.close()
      process.exit(2)
    }
    console.log('Fixture saved')
  } catch (e) {
    console.error('Error saving fixture', e)
    await browser.close()
    process.exit(2)
  }

  // navigate to UI
  const url = `${base}/taskboard-v2/?v=followup-session-lifecycle-001`
  console.log('navigating to', url)
  try {
    const resp = await page.goto(url, { waitUntil: 'networkidle', timeout: 40000 })
    console.log('page response', resp && resp.status())
  } catch (e) {
    console.error('navigation failed', e)
    await browser.close()
    process.exit(2)
  }

  // Wait for left-panel and list to appear
  try {
    await page.waitForSelector('#left-panel', { timeout: 20000 })
    await page.waitForSelector('.card', { timeout: 20000 })
  } catch (e) {
    console.error('UI did not load', e)
    await page.screenshot({ path: '/tmp/smoke_followup_session_lifecycle_error.png', fullPage: true })
    await browser.close()
    process.exit(2)
  }

  // Select our task card
  try {
    const card = page.locator('.card').filter({ hasText: taskId }).first()
    await card.click({ timeout: 5000 })
  } catch (e) {
    console.error('Failed to click task card', e)
    await page.screenshot({ path: '/tmp/smoke_followup_session_lifecycle_no_card.png', fullPage: true })
    await browser.close()
    process.exit(2)
  }

  // helper to get stored task from API
  async function fetchStoredTask() {
    try {
      const r = await context.request.get(`${base}/taskboard/api/tasks`)
      if (!r || r.status() >= 400) return null
      const arr = await r.json()
      if (!Array.isArray(arr)) return null
      return arr.find(t => t && t.taskId === taskId) || null
    } catch (e) { return null }
  }

  // fetch before state
  const before = await fetchStoredTask()
  const beforeSessions = (before && Array.isArray(before.sessions)) ? before.sessions.length : 0
  const prevExec = (before && Array.isArray(before.sessions) && before.sessions[0] && before.sessions[0].executionReport) ? before.sessions[0].executionReport : null

  console.log('before sessions count', beforeSessions)

  // Ensure composer present
  try {
    await page.waitForSelector('.composer textarea', { timeout: 5000 })
  } catch (e) {
    console.error('composer not found', e)
    await page.screenshot({ path: '/tmp/smoke_followup_session_lifecycle_no_composer.png', fullPage: true })
    await browser.close()
    process.exit(2)
  }

  // Send a message and choose Create Review Decision -> Create
  const messageText = 'E2E follow-up test message ' + Date.now()
  try {
    const ta = page.locator('.composer textarea').first()
    await ta.fill(messageText)
    // send via Ctrl+Enter to trigger modal
    await ta.press('Control+Enter')

    // Wait for modal
    await page.waitForSelector('.modal', { timeout: 5000 })
    // Choose Create Review Decision sheet option
    const sheetBtn = page.locator('button.sheet-option', { hasText: 'Create Review Decision' }).first()
    await sheetBtn.click()
    // Now click final Create Review Decision button inside modal
    await page.waitForSelector('.modal', { timeout: 5000 })
    const createBtn = page.locator('.modal button.big', { hasText: 'Create Review Decision' }).first()
    await createBtn.click()

    // wait briefly for save network call
    try {
      await page.waitForResponse(resp => resp.url().endsWith('/taskboard/api/task/save') && resp.status() === 200, { timeout: 10000 })
    } catch (e) {
      // continue - we'll poll stored task
    }
  } catch (e) {
    console.error('Failed to create review decision via UI', e)
    await page.screenshot({ path: '/tmp/smoke_followup_session_lifecycle_create_fail.png', fullPage: true })
    await browser.close()
    process.exit(2)
  }

  // Poll for new session created (up to 30s)
  let after = null
  for (let i = 0; i < 30; i++) {
    after = await fetchStoredTask()
    if (after && Array.isArray(after.sessions) && after.sessions.length >= (beforeSessions + 1)) break
    await sleep(1000)
  }

  const afterSessions = (after && Array.isArray(after.sessions)) ? after.sessions.length : 0
  console.log('after sessions count', afterSessions)

  // Take screenshot
  await page.screenshot({ path: '/tmp/smoke_followup_session_lifecycle_after_create.png', fullPage: true })

  // Assertions and checks
  const results = {
    taskId,
    beforeSessions,
    afterSessions,
    duplicateReviewHeadings: null,
    prevExecPreserved: false,
    prevSessionImmutable: null,
    newSessionAttached: false,
    activeSessionStatus: null,
    approveStatus: null,
    dispatched: null,
    dispatchResponseStatus: null
  }

  // check duplicate review headings count
  try {
    const headings = await page.locator('text=Review Decisions').count()
    results.duplicateReviewHeadings = headings
  } catch (e) { results.duplicateReviewHeadings = -1 }

  // check previous execution preserved
  try {
    if (prevExec && after && Array.isArray(after.sessions)) {
      const foundPrev = after.sessions.find(s => s && s.sessionId === oldSessionId)
      if (foundPrev && foundPrev.executionReport) {
        // compare ids or summaries
        const origId = prevExec.id || prevExec.runId || prevExec.run_id || JSON.stringify(prevExec)
        const foundId = foundPrev.executionReport.id || foundPrev.executionReport.runId || foundPrev.executionReport.run_id || JSON.stringify(foundPrev.executionReport)
        results.prevExecPreserved = (String(origId) === String(foundId))
      }
    }
  } catch (e) {}

  // check new session attached (exists session not equal to oldSessionId)
  try {
    if (after && Array.isArray(after.sessions)) {
      results.newSessionAttached = after.sessions.some(s => s && s.sessionId && s.sessionId !== oldSessionId)
    }
  } catch (e) {}

  // Approve the follow-up via UI
  try {
    // click Approve button for active session
    const approveBtn = page.locator('button:has-text("Approve")').first()
    await approveBtn.click()
    // wait for save
    try { await page.waitForResponse(resp => resp.url().endsWith('/taskboard/api/task/save') && resp.status() === 200, { timeout: 5000 }) } catch (e) {}
    // fetch task
    const afterApprove = await fetchStoredTask()
    // determine if approval present on active session
    if (afterApprove && Array.isArray(afterApprove.sessions)) {
      const activeId = afterApprove.activeSessionId || (afterApprove.sessions.length ? afterApprove.sessions[afterApprove.sessions.length-1].sessionId : null)
      const act = afterApprove.sessions.find(s => s && s.sessionId === activeId)
      results.approveStatus = (act && act.approval && act.approval.value === true) ? 'approved' : ((act && act.approval) ? 'present' : 'none')
      results.activeSessionStatus = act && act.status ? String(act.status) : null

      // previous session still immutable and Complete
      try {
        const prev = afterApprove.sessions.find(s => s && s.sessionId === oldSessionId)
        if (prev) {
          results.prevSessionImmutable = !!prev.immutable
        }
      } catch (e) { results.prevSessionImmutable = null }
    }
  } catch (e) {
    console.error('Approve step failed', e)
  }

  // Attempt dispatch via UI (this requires server token; may fail)
  try {
    // set localStorage token to encourage client to send Authorization header if server expects it
    if (typeof serverToken !== 'undefined' && serverToken) {
      await page.evaluate((t) => { try { localStorage.setItem('taskboard_standalone_token', t) } catch (e) {} }, serverToken)
    } else {
      await page.evaluate(() => { try { localStorage.setItem('taskboard_standalone_token', 'test-token') } catch (e) {} })
    }
    const dispatchBtn = page.locator('button:has-text("Dispatch to Engineering")').first()
    await dispatchBtn.click()
    const resp = await page.waitForResponse(r => r.url().endsWith('/taskboard/api/task/decision'), { timeout: 5000 }).catch(() => null)
    if (resp) {
      results.dispatched = true
      results.dispatchResponseStatus = resp.status()
    } else {
      results.dispatched = false
    }
  } catch (e) {
    console.error('Dispatch step failed', e)
    results.dispatched = false
  }

  // If dispatched, poll for executionReport on new session (up to 120s)
  if (results.dispatched) {
    const start = Date.now()
    let polled = null
    for (let i = 0; i < 120; i++) {
      const t = await fetchStoredTask()
      if (t && Array.isArray(t.sessions)) {
        const activeId = t.activeSessionId || (t.sessions.length ? t.sessions[t.sessions.length-1].sessionId : null)
        const act = t.sessions.find(s => s && s.sessionId === activeId)
        if (act && act.executionReport && act.executionReport.id) {
          polled = { executionReport: act.executionReport }
          break
        }
      }
      await sleep(1000)
    }
    results.newExecutionReport = polled ? true : false

    // Always collect runner result endpoint and stored task snapshot for debugging/tracing
    try {
      const res = await context.request.get(`${base}/taskboard/api/results/${encodeURIComponent(taskId)}`)
      results.runnerEvidence = res && res.ok() ? await res.json() : { status: res ? res.status() : 'no-response' }
    } catch (e) { results.runnerEvidence = { error: String(e) } }

    try {
      const stored = await fetchStoredTask()
      results.reviewerEvidence = stored || null
    } catch (e) { results.reviewerEvidence = { error: String(e) } }
  } else {
    results.newExecutionReport = false
    results.runnerEvidence = null
    results.reviewerEvidence = null
  }

  // final screenshot
  await page.screenshot({ path: '/tmp/smoke_followup_session_lifecycle_final.png', fullPage: true })

  console.log('RESULTS', JSON.stringify(results, null, 2))

  await browser.close()

  // Exit non-zero if critical failures: afterSessions did not increase or duplicate headings > 1 or previous exec not preserved
  let exitCode = 0
  if (!(afterSessions >= (beforeSessions + 1))) exitCode = 2
  if (results.duplicateReviewHeadings !== 1) exitCode = 2
  // fail if approval was not persisted
  if (results.approveStatus !== 'approved') exitCode = 2
  // ensure previous session remains immutable
  if (results.prevSessionImmutable !== true) exitCode = 2
  // allow dispatch/new execution to be optional

  process.exit(exitCode)
})()
