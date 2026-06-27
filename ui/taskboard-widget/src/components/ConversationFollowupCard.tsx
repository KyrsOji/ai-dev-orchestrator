import React, { useState } from 'react'
import { safeText } from './safeText'

export default function ConversationFollowupCard({ followup, token }: any) {
  // Local UI state for decision and published status
  const initialDecision = (followup && followup.decision) || 'pending'
  const initialPublished = !!(followup && followup.published)
  const [decision, setDecision] = useState<string>(initialDecision)
  const [published, setPublished] = useState<boolean>(initialPublished)
  const [loading, setLoading] = useState<string | null>(null)
  const suggestionId = followup && (followup.suggestionId || followup.id || followup.suggestion_id)

  // Helper to read token from props or global window if present
  const serverToken = token || (typeof window !== 'undefined' ? (window as any).__TASKBOARD_API_TOKEN : undefined)

  async function callAction(action: 'approve' | 'reject' | 'publish') {
    if (!suggestionId) {
      console.warn('No suggestionId available for followup; cannot perform action')
      return
    }
    setLoading(action)
    try {
      const url = `/taskboard/api/followups/${encodeURIComponent(suggestionId)}/${action}`
      const headers: any = { 'Content-Type': 'application/json' }
      if (serverToken) headers['Authorization'] = `Bearer ${serverToken}`
      const res = await fetch(url, { method: 'POST', headers, body: JSON.stringify({}) })
      const text = await res.text()
      let parsed: any = null
      try { parsed = text ? JSON.parse(text) : {} } catch (e) { parsed = { ok: false, error: 'invalid_json', raw: text } }
      if (res.ok && parsed && parsed.ok) {
        if (action === 'approve' || action === 'reject') {
          // server returns { ok: true, decision: ... }
          setDecision(parsed.decision || (action === 'approve' ? 'approved' : 'denied'))
        }
        if (action === 'publish') {
          setPublished(true)
        }
      } else {
        // surface error to console -- UI remains usable
        console.error('Followup action failed', action, res.status, parsed || text)
        // Optionally show alert
        try { alert && alert(`Action ${action} failed: ${parsed && parsed.error ? parsed.error : res.status}`) } catch (e) {}
      }
    } catch (e) {
      console.error('Followup action error', e)
      try { alert && alert(`Action failed: ${String(e)}`) } catch (e) {}
    } finally {
      setLoading(null)
    }
  }

  const canPublish = decision === 'approved' && !published

  return (
    <div style={{ padding: 8, borderRadius: 6, border: '1px solid #eee', background: '#fff' }}>
      <div style={{ fontWeight: 700 }}>{safeText(followup && followup.title) || 'Follow-up'}</div>
      <div style={{ marginTop: 6 }}>{safeText(followup && followup.reason)}</div>

      <div style={{ marginTop: 8, display: 'flex', gap: 8, alignItems: 'center' }}>
        <button className="small" disabled={loading !== null} onClick={() => callAction('approve')}>
          {loading === 'approve' ? 'Approving...' : 'Approve'}
        </button>
        <button className="small" disabled={loading !== null} onClick={() => callAction('reject')}>
          {loading === 'reject' ? 'Rejecting...' : 'Reject'}
        </button>
        <button
          className="small"
          disabled={!canPublish || loading !== null}
          onClick={() => callAction('publish')}
          style={!canPublish ? { background: '#9ca3af', color: '#fff', border: 'none' } : undefined}
        >
          {loading === 'publish' ? 'Publishing...' : 'Publish'}
        </button>

        <div style={{ marginLeft: 'auto', fontSize: 12 }}>
          <span style={{ marginRight: 8 }}>Status: {decision}</span>
          {published ? <span style={{ color: '#059669', fontWeight: 700 }}>Published</span> : null}
        </div>
      </div>
    </div>
  )
}
