import React from 'react'

export default function DiffViewer({ diff }: { diff?: string | null }) {
  if (!diff) return <div style={{ color: '#6b7280' }}>Diff unavailable</div>

  const lines = String(diff).split(/\r?\n/)

  return (
    <div className="diff-viewer" style={{ fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, monospace', fontSize: 13, borderRadius: 8, overflow: 'auto', maxHeight: 420, border: '1px solid #eef2ff', background: '#fff', padding: 8 }}>
      {lines.map((line, i) => {
        const isHunk = line.startsWith('@@')
        // treat + and - lines as additions/deletions, but ignore file header markers like "+++" and "---"
        const isAdd = line.startsWith('+') && !line.startsWith('+++')
        const isDel = line.startsWith('-') && !line.startsWith('---')
        const isFileHeader = line.startsWith('+++') || line.startsWith('---')

        let className = 'diff-context'
        if (isHunk) className = 'diff-hunk'
        else if (isAdd) className = 'diff-add'
        else if (isDel) className = 'diff-del'
        else if (isFileHeader) className = 'diff-file-header'

        return (
          <div key={i} className={`diff-line ${className}`} style={{ whiteSpace: 'pre' }}>
            {line}
          </div>
        )
      })}
    </div>
  )
}
