#!/usr/bin/env node
'use strict'

// Smoke test for thread timeline ordering
// Ensures synthetic lifecycle messages are ordered naturally:
// Task Created -> Reviewer -> Runner Started -> Result -> Runner Result Available -> Follow-up Created

function normalizeMessagesForTask(task, rawMessages) {
  const raw = Array.isArray(rawMessages) ? rawMessages : []
  const normalized = raw.map((m) => {
    const authorRaw = (m && m.author) ? m.author : 'system'
    let author = authorRaw
    if (authorRaw === 'openhands') author = 'result'
    if (authorRaw === 'second_opinion') author = 'second_opinion'
    if (authorRaw === 'follow_up') author = 'follow_up'
    if (authorRaw === 'system') {
      if (m && m.data && m.data.followUpTask) author = 'follow_up'
      else if (m && typeof m.text === 'string' && /follow-?up task created/i.test(m.text)) author = 'follow_up'
    }
    return Object.assign({}, m, { author })
  })

  // Determine earliest raw message timestamp (ms)
  let earliestRawTs = null
  for (const m of raw) {
    if (m && m.createdAt) {
      const t = Date.parse(m.createdAt)
      if (!isNaN(t)) {
        if (earliestRawTs === null || t < earliestRawTs) earliestRawTs = t
      }
    }
  }

  const taskUpdatedTs = task && task.updatedAt ? (() => { const t = Date.parse(task.updatedAt); return isNaN(t) ? null : t })() : null
  const now = Date.now()

  // Base timestamp for synthetic Task Created: prefer earliestRawTs - 10s, else task.updatedAt - 10s, else now - 20s
  let baseTaskCreated
  if (earliestRawTs !== null) baseTaskCreated = earliestRawTs - 10000
  else if (taskUpdatedTs !== null) baseTaskCreated = taskUpdatedTs - 10000
  else baseTaskCreated = now - 20000

  if (baseTaskCreated > now) baseTaskCreated = now - 20000

  const augmented = []

  // Ensure Task Created system message exists (strict match to avoid counting follow-up created)
  const hasCreated = normalized.find((m) => m.author === 'system' && m.text && /task created/i.test(String(m.text)))
  if (!hasCreated) {
    augmented.push({ id: 'msg-syn-created', author: 'system', text: 'Task Created', createdAt: new Date(baseTaskCreated).toISOString() })
  }

  // Ensure user notes present if task.notes exists and no explicit user message
  if (task && task.notes) {
    const hasUser = normalized.find((m) => m.author === 'user' && m.text && String(m.text).trim())
    if (!hasUser) {
      augmented.push({ id: 'msg-syn-user', author: 'user', text: task.notes, createdAt: new Date(baseTaskCreated + 1000).toISOString() })
    }
  }

  // Ensure reviewer message present when reviewerSummary exists
  if (task && task.reviewerSummary) {
    const hasReviewer = normalized.find((m) => m.author === 'reviewer')
    if (!hasReviewer) {
      augmented.push({ id: 'msg-syn-reviewer', author: 'reviewer', text: task.reviewerSummary, createdAt: new Date(baseTaskCreated + 2000).toISOString() })
    }
  }

  // Synthesize Runner Started and Runner Result Available messages around result messages
  normalized.forEach((m) => {
    if (m.author === 'result') {
      const resultTsRaw = m.createdAt ? Date.parse(m.createdAt) : NaN
      const rTs = (!isNaN(resultTsRaw)) ? resultTsRaw : (baseTaskCreated + 3000)
      const startTs = rTs - 2000 // Runner Started ~2s before result
      const availableTs = rTs + 1000 // Runner Result Available ~1s after result

      const startExists = normalized.find((x) => x.author === 'system' && /Runner Started/i.test(String(x.text)) && Math.abs((Date.parse(x.createdAt || '') || rTs) - rTs) < 300000)
      if (!startExists) augmented.push({ id: 'msg-syn-start-' + Math.random().toString(36).slice(2, 6), author: 'system', text: 'Runner Started', createdAt: new Date(startTs).toISOString() })

      const availableExists = normalized.find((x) => x.author === 'system' && /Runner Result Available/i.test(String(x.text)) && Math.abs((Date.parse(x.createdAt || '') || rTs) - rTs) < 300000)
      if (!availableExists) augmented.push({ id: 'msg-syn-available-' + Math.random().toString(36).slice(2, 6), author: 'system', text: 'Runner Result Available', createdAt: new Date(availableTs).toISOString() })
    }
  })

  // Add augmented synthetic messages to the list and sort
  const all = normalized.concat(augmented)
  all.sort((A, B) => {
    const aT = Date.parse(A.createdAt || '') || 0
    const bT = Date.parse(B.createdAt || '') || 0
    if (aT === bT) return (A.id || '').localeCompare(B.id || '')
    return aT - bT
  })

  // Adjust duplicates to ensure strictly increasing timestamps (1ms increments)
  for (let i = 1; i < all.length; i++) {
    const prevT = Date.parse(all[i - 1].createdAt || '') || 0
    let curT = Date.parse(all[i].createdAt || '') || 0
    if (curT <= prevT) {
      curT = prevT + 1
      all[i].createdAt = new Date(curT).toISOString()
    }
  }

  return all
}

function runSmoke() {
  const sampleTask = {
    taskId: 'PWA-MOBILE-HOME-001',
    title: 'PWA Mobile Home - Update UI for thread view',
    reviewerSummary: 'Reviewer placeholder summary.',
    notes: 'Initial task to validate mobile thread UI.',
    updatedAt: '2026-06-17T21:57:06.421487Z',
    messages: [
      {
        id: 'op-OP-1781729028298',
        author: 'second_opinion',
        text: 'Runner artifacts look good',
        createdAt: '2026-06-17T20:43:48.298Z',
        data: { opinion: { id: 'OP-1781729028298' } }
      },
      {
        id: 'op-OP-1781729624973',
        author: 'second_opinion',
        text: '2nd Opinion for PWA-MOBILE-HOME-001Reviewer Alternative',
        createdAt: '2026-06-17T20:53:44.973Z',
        data: { opinion: { id: 'OP-1781729624973' } }
      },
      {
        id: 'op-OP-1781729629359',
        author: 'second_opinion',
        text: '2nd Opinion for PWA-MOBILE-HOME-001Reviewer Alternative',
        createdAt: '2026-06-17T20:53:49.359Z',
        data: { opinion: { id: 'OP-1781729629359' } }
      },
      {
        id: 'msg-mqil8zov9m7149',
        author: 'openhands',
        text: 'Runner prepared task artifacts.',
        createdAt: '2026-06-17T18:38:21.518Z',
        data: { _runner_marker: true, _runner_for: 'PWA-MOBILE-HOME-001' }
      },
      {
        id: 'msg-1781733427',
        author: 'system',
        text: 'Follow-up task created: PWA-FOLLOWUP-SMOKE-001',
        createdAt: '2026-06-17T21:57:06.421487Z',
        data: { followUpTask: { taskId: 'PWA-FOLLOWUP-SMOKE-001', title: 'Follow-up smoke' } }
      }
    ]
  }

  const timeline = normalizeMessagesForTask(sampleTask, sampleTask.messages)

  // Find indices of expected entries
  function findIndex(pred) {
    for (let i = 0; i < timeline.length; i++) {
      if (pred(timeline[i], i)) return i
    }
    return -1
  }

  const idxTaskCreated = findIndex(m => m.author === 'system' && /Task Created/i.test(String(m.text)))
  const idxReviewer = findIndex(m => m.author === 'reviewer')
  const idxRunnerStarted = findIndex(m => m.author === 'system' && /Runner Started/i.test(String(m.text)))
  const idxResult = findIndex(m => m.author === 'result' && /Runner prepared task artifacts/i.test(String(m.text)))
  const idxRunnerAvailable = findIndex(m => m.author === 'system' && /Runner Result Available/i.test(String(m.text)))
  const idxFollowUp = findIndex(m => m.author === 'follow_up' || (m.author === 'system' && /follow-?up task created/i.test(String(m.text))))

  const checks = [
    ['Task Created', idxTaskCreated],
    ['Reviewer', idxReviewer],
    ['Runner Started', idxRunnerStarted],
    ['Runner Result', idxResult],
    ['Runner Result Available', idxRunnerAvailable],
    ['Follow-up Created', idxFollowUp],
  ]

  let ok = true
  for (const [name, idx] of checks) {
    if (idx === -1) {
      console.error('MISSING:', name)
      ok = false
    }
  }

  if (ok) {
    // ensure order
    for (let i = 0; i < checks.length - 1; i++) {
      const nameA = checks[i][0]
      const idxA = checks[i][1]
      const nameB = checks[i + 1][0]
      const idxB = checks[i + 1][1]
      if (!(idxA < idxB)) {
        console.error('ORDER FAIL:', nameA, 'should come before', nameB, '- indices', idxA, idxB)
        ok = false
      }
    }
  }

  if (!ok) {
    console.error('\nObserved timeline:')
    timeline.forEach((m, i) => {
      console.error((i + 1).toString().padStart(2, ' '), '|', (m.author || '').padEnd(12), '|', (m.text || '').split('\n')[0], '|', m.createdAt)
    })
    process.exit(1)
  }

  console.log('SMOKE PASS: timeline ordering is correct')
  process.exit(0)
}

runSmoke()
