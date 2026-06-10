import { useState, useRef } from 'react'

const API = '/api'

function getToken() {
    return localStorage.getItem('hrms_token')
}

export function useChatMessages() {
    const [messages, setMessages] = useState([])
    const [loading, setLoading] = useState(false)
    const [conflictPopup, setConflictPopup] = useState(null)
    const [nameChangePopup, setNameChangePopup] = useState(null)
    const loadingMsgs = useRef(false)

    const loadMessages = async (sessionId) => {
        if (!sessionId) return
        loadingMsgs.current = true
        try {
            const res = await fetch(`${API}/chat/sessions/${sessionId}/messages`, {
                headers: { Authorization: `Bearer ${getToken()}` }
            })
            if (!res.ok) throw new Error()
            const msgs = await res.json()
            setMessages(msgs.map(m => ({ role: m.role, content: m.content, sources: [], steps: [] })))
        } catch (err) {
            console.error('Failed to load messages', err)
        } finally {
            loadingMsgs.current = false
        }
    }

    const saveMessage = async (role, content, sessionId) => {
        if (!sessionId) return
        try {
            await fetch(`${API}/chat/sessions/${sessionId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                body: JSON.stringify({ role, content })
            })
        } catch (err) {
            console.error('Failed to save message', err)
        }
    }

    const sendMessage = async (text, { sessionId, existingMessages, onLogout, onTitleUpdate } = {}) => {
        if (!text.trim() || loading) return
        const isFirst = existingMessages
            ? existingMessages.filter(m => m.role === 'user').length === 0
            : messages.filter(m => m.role === 'user').length === 0

        const userMsg = { role: 'user', content: text, sources: [], steps: [] }
        const base = existingMessages ?? messages
        setMessages([...base, userMsg])
        setLoading(true)
        await saveMessage('user', text, sessionId)

        if (isFirst && sessionId && onTitleUpdate) {
            const title = text.trim().slice(0, 40) + (text.trim().length > 40 ? '…' : '')
            await onTitleUpdate(sessionId, title)
        }

        try {
            const res = await fetch(`${API}/chat/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                body: JSON.stringify({ message: text, session_id: sessionId }),
            })
            if (res.status === 401) { onLogout?.(); return }
            const data = await res.json()

            if (data.conflict === true) {
                setConflictPopup({ meetings: data.meetings || [], pending_leave: data.pending_leave || null })
                setLoading(false)
                return
            }

            if (data.name_change_request) {
                setNameChangePopup(data.name_change_request)
            }

            if (!data.answer?.trim()) { setLoading(false); return }

            const aMsg = { role: 'assistant', content: data.answer, sources: data.sources || [], steps: data.steps || [] }
            setMessages(prev => [...prev, aMsg])
            await saveMessage('assistant', data.answer, sessionId)
        } catch (err) {
            const eMsg = { role: 'assistant', content: `Error: ${err.message}`, sources: [], steps: [] }
            setMessages(prev => [...prev, eMsg])
            await saveMessage('assistant', eMsg.content, sessionId)
        }
        setLoading(false)
    }

    const regenerate = async (opts) => {
        const last = [...messages].reverse().find(m => m.role === 'user')
        if (!last) return
        const trimmed = messages.slice(0, -1)
        setMessages(trimmed)
        await sendMessage(last.content, { ...opts, existingMessages: trimmed })
    }

    // ── Conflict popup actions ────────────────────────────────────────────────
    const handleConflictDismiss = () => setConflictPopup(null)

    const handleConflictProceed = async (sessionId) => {
        if (!conflictPopup?.pending_leave) return
        const pl = conflictPopup.pending_leave
        setConflictPopup(null)
        setLoading(true)
        try {
            const res = await fetch(`${API}/chat/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                body: JSON.stringify({
                    message: `Proceed with leave anyway. Call confirm_leave with employee_email=${pl.employee_email}, leave_type=${pl.leave_type}, start_date=${pl.start_date}, end_date=${pl.end_date}, reason=${pl.reason}`,
                    session_id: null, history: [],
                }),
            })
            const data = await res.json()
            const reply = data.answer || 'Your leave has been confirmed and HR has been notified.'
            const msg = { role: 'assistant', content: reply, sources: [], steps: [] }
            setMessages(prev => [...prev, msg])
            if (sessionId) await saveMessage('assistant', reply, sessionId)
        } catch {
            const reply = 'Your leave has been confirmed and HR has been notified.'
            setMessages(prev => [...prev, { role: 'assistant', content: reply, sources: [], steps: [] }])
        } finally {
            setLoading(false)
        }
    }

    const handleConflictReschedule = (sessionId) => {
        setConflictPopup(null)
        window.open('https://outlook.office365.com/calendar/view/workweek', '_blank', 'noopener,noreferrer')
        setMessages(prev => [...prev, {
            role: 'assistant',
            content: 'Your Outlook calendar has been opened in a new tab. Please reschedule your meeting there, then come back and apply for leave again.',
            sources: [], steps: []
        }])
    }

    const handleConflictCancel = async (sessionId) => {
        const pl = conflictPopup?.pending_leave
        setConflictPopup(null)
        setLoading(true)
        try {
            const res = await fetch(`${API}/chat/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                body: JSON.stringify({
                    message: `Cancel my leave. Use cancel_latest_pending_leave tool. employee_email=${pl?.employee_email || ''}`,
                    session_id: null, history: [],
                }),
            })
            const data = await res.json()
            const reply = data.answer || 'Your leave request has been cancelled.'
            setMessages(prev => [...prev, { role: 'assistant', content: reply, sources: [], steps: [] }])
            if (sessionId) await saveMessage('assistant', reply, sessionId)
        } catch {
            setMessages(prev => [...prev, { role: 'assistant', content: 'Your leave request has been cancelled.', sources: [], steps: [] }])
        } finally {
            setLoading(false)
        }
    }

    const clearMessages = () => setMessages([])

    return {
        messages, setMessages,
        loading,
        loadingMsgs,
        conflictPopup,
        nameChangePopup, setNameChangePopup,
        loadMessages,
        sendMessage,
        regenerate,
        clearMessages,
        handleConflictDismiss,
        handleConflictProceed,
        handleConflictReschedule,
        handleConflictCancel,
    }
}