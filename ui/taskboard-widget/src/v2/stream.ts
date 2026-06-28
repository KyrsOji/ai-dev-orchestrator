export type StreamHandlers = {
  onOpen?: () => void
  onClose?: () => void
  onError?: (err?: any) => void
  onEvent?: (evt: any) => void
}

export default function connectExecutionStream(taskId?: string, handlers?: StreamHandlers) {
  // Try SSE first
  try {
    if (typeof window !== 'undefined' && (window as any).EventSource) {
      const url = '/taskboard/api/stream' + (taskId ? ('?taskId=' + encodeURIComponent(taskId)) : '')
      const es: any = new (window as any).EventSource(url)
      let opened = false
      es.onopen = () => {
        opened = true
        try { handlers && handlers.onOpen && handlers.onOpen() } catch (e) {}
      }
      es.onmessage = (ev: any) => {
        try {
          const data = ev && ev.data ? JSON.parse(ev.data) : null
          handlers && handlers.onEvent && handlers.onEvent(data)
        } catch (e) {
          try { handlers && handlers.onError && handlers.onError(e) } catch (_) {}
        }
      }
      es.onerror = (err: any) => {
        try { handlers && handlers.onError && handlers.onError(err) } catch (e) {}
        try { handlers && handlers.onClose && handlers.onClose() } catch (e) {}
        try { es && es.close && es.close() } catch (e) {}
      }
      // Support named events too (task/agents/runner/log)
      try {
        es.addEventListener && es.addEventListener('task', (ev: any) => { try { handlers && handlers.onEvent && handlers.onEvent(JSON.parse(ev.data)) } catch (e) {} })
        es.addEventListener && es.addEventListener('agents', (ev: any) => { try { handlers && handlers.onEvent && handlers.onEvent(JSON.parse(ev.data)) } catch (e) {} })
        es.addEventListener && es.addEventListener('runner', (ev: any) => { try { handlers && handlers.onEvent && handlers.onEvent(JSON.parse(ev.data)) } catch (e) {} })
        es.addEventListener && es.addEventListener('log', (ev: any) => { try { handlers && handlers.onEvent && handlers.onEvent(JSON.parse(ev.data)) } catch (e) {} })
      } catch (e) {}

      return {
        close: () => { try { es.close && es.close() } catch (e) {} }
      }
    }
  } catch (err) {
    try { handlers && handlers.onError && handlers.onError(err) } catch (e) {}
  }

  // Try WebSocket fallback
  try {
    if (typeof window !== 'undefined' && (window as any).WebSocket) {
      const loc = window.location
      const proto = loc.protocol === 'https:' ? 'wss:' : 'ws:'
      const host = loc.host
      const path = '/taskboard/api/stream-ws' + (taskId ? ('?taskId=' + encodeURIComponent(taskId)) : '')
      const wsUrl = proto + '//' + host + path
      const ws = new (window as any).WebSocket(wsUrl)
      ws.onopen = () => { try { handlers && handlers.onOpen && handlers.onOpen() } catch (e) {} }
      ws.onmessage = (ev: any) => {
        try {
          const data = ev && ev.data ? JSON.parse(ev.data) : null
          handlers && handlers.onEvent && handlers.onEvent(data)
        } catch (e) { try { handlers && handlers.onError && handlers.onError(e) } catch (_) {} }
      }
      ws.onerror = (err: any) => { try { handlers && handlers.onError && handlers.onError(err) } catch (e) {} }
      ws.onclose = () => { try { handlers && handlers.onClose && handlers.onClose() } catch (e) {} }

      return { close: () => { try { ws.close && ws.close() } catch (e) {} } }
    }
  } catch (err) { try { handlers && handlers.onError && handlers.onError(err) } catch (e) {} }

  return null
}
