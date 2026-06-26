import React, { useEffect, useState } from 'react'
import ConversationTimeline from './ConversationTimeline'
import ConversationComposer from './ConversationComposer'

function getFirstSentence(text: string) {
  if (!text) return ''
  const s = String(text).trim()
  // match up to first sentence-ending punctuation
  const m = s.match(/^\s*([^.!?]+[.!?])/) || s.match(/^\s*([^\n]+)/)
  if (m && m[1]) return m[1].trim()
  return s.split('\n')[0].trim()
}

export default function ConversationPanel({ task, followups, onTaskUpdate, onRefresh }: { task: any; followups?: any[]; onTaskUpdate?: (t: any) => void; onRefresh?: () => Promise<void> }) {
  const [localTask, setLocalTask] = useState<any>(task)
  const [actionModalOpen, setActionModalOpen] = useState(false)
  const [pendingMessage, setPendingMessage] = useState<string>('')
  const [actionPreviewMode, setActionPreviewMode] = useState<'choose' | 'create' | null>('choose')

  useEffect(() => {
    setLocalTask(task)
  }, [task])

  function handleComposeSend(text: string) {
    setPendingMessage(text)
    setActionPreviewMode('choose')
    setActionModalOpen(true)
  }

  function uuid(prefix = '') {
    return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)
  }

  function handleContinueConversation() {
    const text = pendingMessage
    const base = localTask || task || {}
    const updated = { ...base }
    // Preserve existing notes for backward compatibility; append message into messages[]
    const existingMessages = Array.isArray(updated.messages) ? updated.messages.slice() : []
    const msg = { id: uuid('msg-'), author: 'user', text: text, createdAt: new Date().toISOString() }
    existingMessages.push(msg)
    updated.messages = existingMessages
    updated.updatedAt = new Date().toISOString()
    if (typeof onTaskUpdate === 'function') {
      onTaskUpdate(updated)
    } else {
      setLocalTask(updated)
    }
    setActionModalOpen(false)
    setPendingMessage('')
  }

  function handleCreateReviewDecision() {
    const text = pendingMessage
    const description = getFirstSentence(text) || (text.length > 120 ? text.slice(0, 120) + '...' : text)
    const newAction = {
      type: 'manual',
      id: 'custom-' + Date.now(),
      description,
      payload: { instructions: text }
    }

    const base = localTask || task || {}
    const updated = { ...base, proposedActions: [...(Array.isArray(base.proposedActions) ? base.proposedActions : []), newAction], selectedAction: newAction.id, updatedAt: new Date().toISOString() }

    if (typeof onTaskUpdate === 'function') {
      onTaskUpdate(updated)
    } else {
      setLocalTask(updated)
    }

    setActionModalOpen(false)
    setPendingMessage('')
  }

  if (!localTask) return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        <div style={{ padding: 16 }}>No task selected</div>
      </div>
      <div style={{ borderTop: '1px solid #eee' }}>
        <ConversationComposer onSend={(t) => { console.log('compose send', t) }} />
      </div>
    </div>
  )

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ flex: 1, overflow: 'auto', padding: 8 }}>
        <ConversationTimeline task={localTask} followups={followups} onTaskUpdate={onTaskUpdate} onRefresh={onRefresh} />
      </div>

      <div style={{ borderTop: '1px solid #eee' }}>
        <ConversationComposer onSend={handleComposeSend} />
      </div>

      {/* Action choice modal / bottom sheet */}
      {actionModalOpen ? (
        <div className="modal-overlay" onClick={() => setActionModalOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            {actionPreviewMode === 'choose' ? (
              <div>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>How should this message be used?</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <button className="sheet-option" onClick={handleContinueConversation}>Continue Conversation</button>
                  <button className="sheet-option" onClick={() => setActionPreviewMode('create')}>Create Review Decision</button>
                  <button className="sheet-option disabled">Execute Immediately (coming soon)</button>
                </div>
                <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
                  <button className="small" onClick={() => setActionModalOpen(false)}>Cancel</button>
                </div>
              </div>
            ) : (
              <div>
                <div style={{ fontWeight: 800, marginBottom: 8 }}>Create Review Decision</div>
                <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>Description (auto-generated from first sentence)</div>
                <div style={{ padding: 12, borderRadius: 8, background: '#f8fafc', border: '1px solid #e6eefc', marginBottom: 8 }}>{getFirstSentence(pendingMessage)}</div>
                <div style={{ fontSize: 13, color: '#374151', marginBottom: 8 }}>Instructions</div>
                <pre style={{ padding: 12, borderRadius: 8, background: '#fff', border: '1px solid #e6eefc', whiteSpace: 'pre-wrap', maxHeight: 220, overflow: 'auto' }}>{pendingMessage}</pre>

                <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 12 }}>
                  <button className="big" onClick={() => { setActionPreviewMode('choose') }} style={{ background: '#f3f4f6', border: 'none', padding: '10px 14px', borderRadius: 10 }}>Cancel</button>
                  <button className="big" onClick={handleCreateReviewDecision} style={{ background: '#3b82f6', color: '#fff', border: 'none', padding: '10px 14px', borderRadius: 10 }}>Create Review Decision</button>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  )
}
