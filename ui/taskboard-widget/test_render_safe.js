const assert = require('assert')
const { safeText } = require('./src/components/safeText.cjs.js')

function run() {
  // Action object with description preferred
  const actionWithDesc = { id: 'a1', type: 'test', description: 'Do something', payload: { foo: 1 } }
  assert.strictEqual(safeText(actionWithDesc), 'Do something', 'description should be preferred')

  // Action object with title fallback
  const actionWithTitle = { id: 'a2', type: 'test', title: 'Title only', payload: {} }
  assert.strictEqual(safeText(actionWithTitle), 'Title only', 'title should be used when description missing')

  // Action object with id fallback
  const actionWithId = { id: 'a3', type: 'test', payload: {} }
  assert.strictEqual(safeText(actionWithId), 'a3', 'id should be used when description/title missing')

  // Action object with none -> JSON fallback
  const actionOther = { type: 'unknown', payload: { x: 1 } }
  const out = safeText(actionOther)
  assert.ok(typeof out === 'string' && out.includes('type') && out.includes('payload'), 'JSON fallback expected')

  // Message text object
  const msgObj = { text: { foo: 'bar' } }
  assert.ok(typeof safeText(msgObj.text) === 'string', 'message object should be converted to string')

  // System event text object
  const sysObj = { text: { event: 'x', data: [1,2,3] } }
  assert.ok(typeof safeText(sysObj.text) === 'string', 'system event object converted to string')

  // Followup title/reason objects
  const followup = { title: { t: 'title' }, reason: { why: 'because' } }
  assert.ok(typeof safeText(followup.title) === 'string', 'followup title object safe')
  assert.ok(typeof safeText(followup.reason) === 'string', 'followup reason object safe')

  // Primitive inputs
  assert.strictEqual(safeText('abc'), 'abc')
  assert.strictEqual(safeText(123), '123')
  assert.strictEqual(safeText(null), '')
  assert.strictEqual(safeText(undefined), '')

  // Array input
  const arr = [1,2,3]
  assert.strictEqual(safeText(arr), JSON.stringify(arr))

  console.log('ALL RENDER-SAFE TESTS PASSED')
}

try {
  run()
  process.exit(0)
} catch (e) {
  console.error('RENDER-SAFE TESTS FAILED')
  console.error(e && e.stack ? e.stack : e)
  process.exit(1)
}
