import React, { useState } from 'react'
import { safeText } from '../components/safeText'

export default function ConversationFollowupCard({ followup, token }: any) {
  const initialDecision = (followup && followup.decision) || 'pending'
  const initialPublished = !!(followup && followup.published)
  const [decision, setDecision] = useState<string>(initialDecision)
  const [published, setPublished] = useState<boolean>(initialPublished)
  const [loading, setLoading] = useState<string | null>(null)
  const suggestionId = followup && (followup.suggestionId || followup.id || followup.suggestion_id)

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
          setDecision(parsed.decision || (action === 'approve' ? 'approved' : 'denied'))
        }
        if (action === 'publish') setPublished(true)
      } else {
        console.error('Followup action failed', action, res.status, parsed || text)
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
    <div className="followup-card" style={{ padding: 12, borderRadius: 12, background: '#f0fdf4', border: '1px solid #bbf7d0' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
        <div style={{ width: 12, height: 12, borderRadius: 999, background: '#10b981' }} aria-hidden />
        <div style={{ fontWeight: 800, fontSize: 15 }}>{safeText(followup && followup.title) || 'Follow-up'}</div>
        <div style={{ marginLeft: 'auto', fontSize: 13, color: '#374151' }}>Status: <strong style={{ marginLeft: 6 }}>{decision}</strong></div>
      </div>

      <div style={{ marginTop: 8, color: '#374151' }}>{safeText(followup && followup.reason)}</div>

      <div style={{ marginTop: 12, display: 'flex', gap: 12 }}>
        <button className="big" disabled={loading !== null} onClick={() => callAction('approve')} style={{ background: '#10b981', color: '#fff', border: 'none', flex: 1 }}>
          {loading === 'approve' ? 'Approving...' : 'Approve'}
        </button>
        <button className="big" disabled={loading !== null} onClick={() => callAction('reject')} style={{ background: '#ef4444', color: '#fff', border: 'none', flex: 1 }}>
          {loading === 'reject' ? 'Rejecting...' : 'Reject'}
        </button>
        <button className="big" disabled={!canPublish || loading !== null} onClick={() => callAction('publish')} style={{ background: canPublish ? '#3b82f6' : '#9ca3af', color: '#fff', border: 'none', flex: 1 }}>
          {loading === 'publish' ? 'Publishing...' : 'Publish'}
        </button>
      </div>

      <div style={{ marginTop: 10, fontSize: 13, color: published ? '#065f46' : '#6b7280' }}>{published ? 'Published' : 'Not published'}</div>
    </div>
  )
}
