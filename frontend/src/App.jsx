import { useState, useRef, useEffect, useCallback } from 'react'
import DOMPurify from 'dompurify'
import Login from './components/Login'
import Register from './components/Register'
import Dashboard from './components/Dashboard'
import NotificationBell from './components/NotificationBell'
import LeaveRequests from './components/LeaveRequests'
import AdminPanel from './components/AdminPanel'
import OnboardingChat from './components/OnboardingChat'
import ProfileView from './components/ProfileView'

const API = '/api'

// Helper to group sessions by date
function getSessionGroupKey(createdAtStr) {
    const created = new Date(createdAtStr)
    const today = new Date()
    today.setHours(0, 0, 0, 0)
    const yesterday = new Date(today)
    yesterday.setDate(yesterday.getDate() - 1)
    const weekAgo = new Date(today)
    weekAgo.setDate(weekAgo.getDate() - 7)

    if (created >= today) return 'Today'
    if (created >= yesterday) return 'Yesterday'
    if (created >= weekAgo) return 'Previous 7 Days'
    return 'Older'
}

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

function generateHighlightedHtml(fullText, chunks, answer = '', isSnippet = true, query = '') {
    // ⚠️ PASTE YOUR ACTUAL IMPLEMENTATION HERE ⚠️
    return fullText
}

function _contentToLines(text) {
    if (!text) return []
    return text.split('\n').map((t, i) => ({
        num: i + 1,
        html: t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        highlighted: false,
    }))
}

export default function App() {
    const [authed, setAuthed] = useState(() => !!localStorage.getItem('hrms_token'))
    const [employee, setEmployee] = useState(() => {
        try { return JSON.parse(localStorage.getItem('hrms_employee') || 'null') } catch { return null }
    })
    const [showRegister, setShowRegister] = useState(false)
    const [view, setView] = useState('chat')
    const [isListening, setIsListening] = useState(false)
    const [isSpeaking, setIsSpeaking] = useState(false)
    const [voiceCooldown, setVoiceCooldown] = useState(false)
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [docCount, setDocCount] = useState(0)
    const [expandedIdx, setExpandedIdx] = useState(null)
    const [previewData, setPreviewData] = useState(null)
    const chatEnd = useRef(null)

    // Theme state
    const [theme, setTheme] = useState(() => localStorage.getItem('hrms_theme') || 'dark')

    // Apply theme class to body
    useEffect(() => {
        document.body.classList.remove('theme-dark', 'theme-light')
        document.body.classList.add(`theme-${theme}`)
        localStorage.setItem('hrms_theme', theme)
    }, [theme])

    const toggleTheme = () => {
        setTheme(prev => prev === 'dark' ? 'light' : 'dark')
    }

    // Session management
    const [sessions, setSessions] = useState([])
    const [currentSessionId, setCurrentSessionId] = useState(null)
    const [loadingSessions, setLoadingSessions] = useState(true)
    const [menuOpen, setMenuOpen] = useState(null)

    const welcomedSessions = useRef(new Set())
    const loadingMsgs = useRef(false)

    const [playingMsgIndex, setPlayingMsgIndex] = useState(null)
    const [likedMsgs, setLikedMsgs] = useState({})
    const [dislikedMsgs, setDislikedMsgs] = useState({})

    const [conflictPopup, setConflictPopup] = useState(null)

    let activeRecognition = null

    // ── Speech ────────────────────────────────────────────────────────────────
    const speakText = (text, index) => {
        if (!('speechSynthesis' in window)) return
        if (playingMsgIndex === index) {
            window.speechSynthesis.cancel()
            setPlayingMsgIndex(null); setIsSpeaking(false)
            setVoiceCooldown(true); setTimeout(() => setVoiceCooldown(false), 800)
            return
        }
        window.speechSynthesis.cancel()
        const u = new SpeechSynthesisUtterance(text)
        u.lang = 'en-US'
        u.onstart = () => setIsSpeaking(true)
        u.onend = () => { setIsSpeaking(false); setPlayingMsgIndex(null); setVoiceCooldown(true); setTimeout(() => setVoiceCooldown(false), 800) }
        u.onerror = () => { setIsSpeaking(false); setPlayingMsgIndex(null); setVoiceCooldown(true); setTimeout(() => setVoiceCooldown(false), 800) }
        window.speechSynthesis.speak(u)
        setPlayingMsgIndex(index)
    }

    const handleLike = (index) => {
        setLikedMsgs(prev => ({ ...prev, [index]: !prev[index] }))
        if (dislikedMsgs[index]) setDislikedMsgs(prev => ({ ...prev, [index]: false }))
    }
    const handleDislike = (index) => {
        setDislikedMsgs(prev => ({ ...prev, [index]: !prev[index] }))
        if (likedMsgs[index]) setLikedMsgs(prev => ({ ...prev, [index]: false }))
    }

    const startVoiceRecognition = () => {
        if (isSpeaking || voiceCooldown) { alert("Please wait a moment before using voice input."); return }
        if (activeRecognition) { try { activeRecognition.abort() } catch (e) { } activeRecognition = null }
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition
        if (!SR) { alert('Speech recognition not supported. Please use Chrome, Edge, or Safari.'); return }
        const r = new SR()
        r.continuous = false; r.interimResults = false; r.lang = 'en-US'
        activeRecognition = r; setIsListening(true)
        r.onresult = (e) => { setInput(e.results[0][0].transcript); r.stop(); setIsListening(false); activeRecognition = null }
        r.onerror = (e) => { if (e.error === 'not-allowed') alert('Microphone access denied.'); setIsListening(false); activeRecognition = null }
        r.onend = () => { setIsListening(false); if (activeRecognition === r) activeRecognition = null }
        r.start()
    }

    // ── Session API (unchanged) ───────────────────────────────────────────────
    const fetchSessions = useCallback(async () => {
        if (!authed) return
        try {
            const res = await fetch(`${API}/chat/sessions`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('hrms_token')}` }
            })
            if (!res.ok) throw new Error()
            const data = await res.json()
            const sorted = [...data].sort((a, b) => {
                if (a.is_pinned && !b.is_pinned) return -1
                if (!a.is_pinned && b.is_pinned) return 1
                return new Date(b.created_at) - new Date(a.created_at)
            })
            setSessions(sorted)
            if (sorted.length > 0 && !currentSessionId) {
                setCurrentSessionId(sorted[0].id)
                loadMessages(sorted[0].id)
            } else if (sorted.length === 0) {
                createNewSession()
            }
        } catch (err) {
            console.error("Failed to load sessions", err)
        } finally {
            setLoadingSessions(false)
        }
    }, [authed, currentSessionId])

    const createNewSession = async () => {
        try {
            const res = await fetch(`${API}/chat/sessions`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${localStorage.getItem('hrms_token')}` }
            })
            const s = await res.json()
            setSessions(prev => [{ ...s, is_pinned: false }, ...prev])
            setCurrentSessionId(s.id)
            setMessages([])
        } catch (err) { console.error("Failed to create session", err) }
    }

    const loadMessages = async (sessionId) => {
        if (!sessionId) return
        loadingMsgs.current = true
        try {
            const res = await fetch(`${API}/chat/sessions/${sessionId}/messages`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('hrms_token')}` }
            })
            if (!res.ok) throw new Error()
            const msgs = await res.json()
            setMessages(msgs.map(m => ({ role: m.role, content: m.content, sources: [], steps: [] })))
        } catch (err) { console.error("Failed to load messages", err) }
        finally { loadingMsgs.current = false }
    }

    const saveMessage = async (role, content, sessionId) => {
        if (!sessionId) return
        try {
            await fetch(`${API}/chat/sessions/${sessionId}/messages`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hrms_token')}` },
                body: JSON.stringify({ role, content })
            })
        } catch (err) { console.error("Failed to save message", err) }
    }

    const updateSessionTitle = async (sessionId, title) => {
        try {
            const res = await fetch(`${API}/chat/sessions/${sessionId}/title`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hrms_token')}` },
                body: JSON.stringify({ title })
            })
            if (!res.ok) throw new Error()
            const updated = await res.json()
            setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: updated.title } : s))
        } catch (err) { console.error("Failed to update title", err) }
    }

    const togglePinSession = async (sessionId, currentPinned) => {
        try {
            const res = await fetch(`${API}/chat/sessions/${sessionId}/pin`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${localStorage.getItem('hrms_token')}` },
                body: JSON.stringify({ is_pinned: !currentPinned })
            })
            if (!res.ok) throw new Error()
            await fetchSessions()
        } catch { alert("Could not pin/unpin chat. Please try again.") }
    }

    const deleteSession = async (sessionId) => {
        if (!confirm("Delete this chat? This cannot be undone.")) return
        try {
            const res = await fetch(`${API}/chat/sessions/${sessionId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${localStorage.getItem('hrms_token')}` }
            })
            if (!res.ok) throw new Error(`Server responded ${res.status}`)
            const newSessions = sessions.filter(s => s.id !== sessionId)
            setSessions(newSessions)
            if (sessionId === currentSessionId) {
                await createNewSession()
            }
            setMenuOpen(null)
        } catch (err) { alert(`Could not delete chat: ${err.message}`) }
    }

    const renameSession = async (sessionId, currentTitle) => {
        let t = prompt("Enter new chat name:", currentTitle)
        if (!t || !t.trim()) return
        await updateSessionTitle(sessionId, t.trim().slice(0, 40))
        setMenuOpen(null)
    }

    // Welcome message
    useEffect(() => {
        if (loadingSessions || !currentSessionId || !employee) return
        if (loadingMsgs.current) return
        if (welcomedSessions.current.has(currentSessionId)) return

        if (messages.length === 0) {
            welcomedSessions.current.add(currentSessionId)
            const h = new Date().getHours()
            const g = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
            setMessages([{
                role: 'assistant',
                content: `${g}, ${employee.name || 'there'}! I'm your HR Assistant. I can help you with policies, leave requests, employee info, onboarding tasks, and more. How can I assist you today?`,
                sources: [], steps: []
            }])
        } else {
            welcomedSessions.current.add(currentSessionId)
        }
    }, [currentSessionId, messages.length, employee, loadingSessions])

    useEffect(() => {
        if (authed) { fetchSessions() }
        else { setSessions([]); setCurrentSessionId(null); setMessages([]); welcomedSessions.current.clear() }
    }, [authed, fetchSessions])

    async function handleLoginSuccess(token, emp) {
        localStorage.setItem('hrms_token', token)
        try {
            const res = await fetch(`${API}/onboarding-profile/me`, {
                headers: { Authorization: `Bearer ${token}` }
            })
            if (res.ok) {
                const fresh = await res.json()
                const merged = { ...emp, ...fresh, role: emp.role }
                localStorage.setItem('hrms_employee', JSON.stringify(merged))
                setEmployee(merged)
            } else {
                localStorage.setItem('hrms_employee', JSON.stringify(emp))
                setEmployee(emp)
            }
        } catch {
            localStorage.setItem('hrms_employee', JSON.stringify(emp))
            setEmployee(emp)
        }
        setAuthed(true)
        setView('chat')
    }

    function handleLogout() {
        localStorage.removeItem('hrms_token'); localStorage.removeItem('hrms_employee')
        setEmployee(null); setMessages([]); setSessions([]); setCurrentSessionId(null)
        welcomedSessions.current.clear(); setAuthed(false); setView('chat')
    }

    useEffect(() => {
        if (!authed) return
        fetch(`${API}/documents`).then(r => r.json()).then(d => setDocCount(d.documents?.length ?? 0)).catch(() => { })
    }, [authed])

    useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

    if (!authed) {
        if (showRegister) return <Register onBackToLogin={() => setShowRegister(false)} />
        return <Login onSuccess={handleLoginSuccess} onRegisterClick={() => setShowRegister(true)} />
    }

    const isAdminOrHr = employee?.role === 'admin' || employee?.role === 'hr'
    if (employee && !employee.onboarding_completed && !isAdminOrHr) {
        return (
            <OnboardingChat
                employee={employee}
                token={localStorage.getItem('hrms_token')}
                onComplete={async () => {
                    const token = localStorage.getItem('hrms_token')
                    try {
                        await fetch(`${API}/onboarding-profile/save`, {
                            method: 'POST',
                            headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                            body: JSON.stringify({}),
                        })
                    } catch { }
                    try {
                        const res = await fetch(`${API}/onboarding-profile/me`, {
                            headers: { Authorization: `Bearer ${token}` }
                        })
                        if (res.ok) {
                            const fresh = await res.json()
                            const merged = { ...employee, ...fresh, role: employee.role }
                            localStorage.setItem('hrms_employee', JSON.stringify(merged))
                            setEmployee(merged)
                        }
                    } catch { }
                    setView('chat')
                }}
            />
        )
    }

    const regenerate = async () => {
        const last = [...messages].reverse().find(m => m.role === 'user')
        if (!last) return
        setMessages(messages.slice(0, -1))
        await sendMessage(last.content, messages.slice(0, -1))
    }

    async function sendMessage(text, customMessages = null) {
        if (!text.trim() || loading) return
        const sid = currentSessionId
        const isFirst = customMessages === null && messages.filter(m => m.role === 'user').length === 0
        const userMsg = { role: 'user', content: text, sources: [], steps: [] }
        setMessages(customMessages !== null ? [...customMessages, userMsg] : [...messages, userMsg])
        setInput(''); setLoading(true); setExpandedIdx(null); setPreviewData(null)
        await saveMessage('user', text, sid)

        if (isFirst && sid) {
            const title = text.trim().slice(0, 40) + (text.trim().length > 40 ? '…' : '')
            await updateSessionTitle(sid, title)
        }

        const token = localStorage.getItem('hrms_token')
        try {
            const res = await fetch(`${API}/chat/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ message: text, session_id: sid }),
            })
            if (res.status === 401) { handleLogout(); return }
            const data = await res.json()

            if (data.conflict === true) {
                setConflictPopup({
                    meetings: data.meetings || [],
                    pending_leave: data.pending_leave || null,
                })
                setLoading(false)
                return
            }

            if (!data.answer || !data.answer.trim()) {
                setLoading(false)
                return
            }

            const aMsg = { role: 'assistant', content: data.answer, sources: data.sources || [], steps: data.steps || [] }
            setMessages(prev => [...prev, aMsg])
            await saveMessage('assistant', data.answer, sid)
        } catch (err) {
            const eMsg = { role: 'assistant', content: `Error: ${err.message}`, sources: [], steps: [] }
            setMessages(prev => [...prev, eMsg])
            await saveMessage('assistant', eMsg.content, sid)
        }
        setLoading(false)
    }

    function handleConflictDismiss() { setConflictPopup(null) }
    async function handleConflictProceed() {
        if (!conflictPopup?.pending_leave) return
        const pl = conflictPopup.pending_leave
        setConflictPopup(null)
        setLoading(true)
        try {
            const token = localStorage.getItem('hrms_token')
            const res = await fetch(`${API}/chat/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    message: `Proceed with leave anyway. Call confirm_leave with employee_email=${pl.employee_email}, leave_type=${pl.leave_type}, start_date=${pl.start_date}, end_date=${pl.end_date}, reason=${pl.reason}`,
                    session_id: null,
                    history: [],
                }),
            })
            const data = await res.json()
            const reply = data.answer || 'Your leave has been confirmed and HR has been notified by email.'
            const msg = { role: 'assistant', content: reply, sources: [], steps: [] }
            setMessages(prev => [...prev, msg])
            if (currentSessionId) await saveMessage('assistant', reply, currentSessionId)
        } catch (e) {
            const reply = 'Your leave has been confirmed and HR has been notified by email.'
            setMessages(prev => [...prev, { role: 'assistant', content: reply, sources: [], steps: [] }])
        } finally { setLoading(false) }
    }
    function handleConflictReschedule() {
        setConflictPopup(null)
        window.open('https://outlook.office365.com/calendar/view/workweek', '_blank', 'noopener,noreferrer')
        setMessages(prev => [...prev, { role: 'assistant', content: 'Your Outlook calendar has been opened in a new tab. Please reschedule your meeting there, then come back here and apply for leave again on the updated date.', sources: [], steps: [] }])
    }
    async function handleConflictCancel() {
        const pl = conflictPopup?.pending_leave
        setConflictPopup(null)
        setLoading(true)
        try {
            const token = localStorage.getItem('hrms_token')
            const res = await fetch(`${API}/chat/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    message: `Cancel my leave. Use cancel_latest_pending_leave tool. employee_email=${pl?.employee_email || ''}`,
                    session_id: null,
                    history: [],
                }),
            })
            const data = await res.json()
            const reply = data.answer || 'Your leave request has been cancelled. No email has been sent to HR.'
            setMessages(prev => [...prev, { role: 'assistant', content: reply, sources: [], steps: [] }])
            if (currentSessionId) await saveMessage('assistant', reply, currentSessionId)
        } catch (e) {
            setMessages(prev => [...prev, { role: 'assistant', content: 'Your leave request has been cancelled. No email has been sent to HR.', sources: [], steps: [] }])
        } finally { setLoading(false) }
    }

    const lastUserQuery = (() => { const m = [...messages].reverse().find(m => m.role === 'user'); return m ? m.content : '' })()
    const latestSources = (() => { for (let i = messages.length - 1; i >= 0; i--) if (messages[i].role === 'assistant' && messages[i].sources?.length) return messages[i].sources; return [] })()

    const handlePageChange = (dir) => {
        if (!previewData) return
        const list = previewData.pages || previewData.segments; if (!list) return
        const ni = previewData.currentIndex + dir
        if (ni < 0 || ni >= list.length) return
        const item = list[ni]
        const rawText = item.text || item.content || ''
        const result = generateHighlightedHtml(rawText, previewData.chunks, previewData.answerContext, true, lastUserQuery)
        const lines = (result && result.lines) ? result.lines : _contentToLines(rawText)
        setPreviewData({ ...previewData, currentIndex: ni, lines })
    }

    async function togglePreview(idx, source) {
        if (expandedIdx === idx) { setExpandedIdx(null); setPreviewData(null); return }
        setExpandedIdx(idx)
        const ext = source.source_file.split('.').pop().toLowerCase()
        const lastMsg = [...messages].reverse().find(m => m.role === 'assistant')
        const answerContext = lastMsg ? lastMsg.content : ''

        if (ext === 'pdf' && Array.isArray(source.full_content)) {
            const si = Math.max(0, source.full_content.findIndex(p => p.page === source.page))
            const pageText = source.full_content[si]?.text || ''
            const res = generateHighlightedHtml(pageText, source.chunks || [], answerContext, true, lastUserQuery)
            const lines = (res && res.lines) ? res.lines : _contentToLines(pageText)
            setPreviewData({ type: 'pdf-snippet', lines, pages: source.full_content, currentIndex: si, chunks: source.chunks || [], answerContext })
        } else if (['md', 'txt', 'docx'].includes(ext)) {
            const rawContent = source.content || (source.segments || []).map(s => s.content).join('\n\n---\n\n') || ''
            const res = generateHighlightedHtml(rawContent, source.chunks || [], answerContext, true, lastUserQuery)
            const lines = (res && res.lines) ? res.lines : _contentToLines(rawContent)
            setPreviewData({ type: 'text-snippet', lines, segments: source.segments || [{ content: rawContent }], currentIndex: 0, chunks: source.chunks || [], answerContext })
        } else if (source.content && source.content.trim()) {
            const res = generateHighlightedHtml(source.content, source.chunks || [], answerContext, true, lastUserQuery)
            const lines = (res && res.lines) ? res.lines : _contentToLines(source.content)
            setPreviewData({ type: 'text-snippet', lines, segments: [{ content: source.content }], currentIndex: 0, chunks: source.chunks || [], answerContext })
        } else {
            const displayContent = answerContext || ''
            const res = generateHighlightedHtml(displayContent, source.chunks || [], answerContext, false, lastUserQuery)
            const lines = (res && res.lines) ? res.lines : _contentToLines(displayContent)
            setPreviewData({ type: 'text-snippet', lines, segments: [{ content: displayContent }], currentIndex: 0, chunks: source.chunks || [], answerContext, isFallbackAnswer: true })
        }
    }

    // Icons for action bar (simple, no emoji)
    const SpeakerIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9v6h4l5 5V4L7 9H3z" /><path d="M16.5 8.5c2 1.5 2 5.5 0 7" /><path d="M19 5c3 2.5 3 9.5 0 12" /></svg>)
    const ThumbUpIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h10.5a3 3 0 0 0 3-3l1-5a3 3 0 0 0-3-3h-4.5zM5 19H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h2v8z" /></svg>)
    const ThumbDownIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V5H6.5a3 3 0 0 0-3 3l-1 5a3 3 0 0 0 3 3H10zM19 5h2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2V5z" /></svg>)
    const RegenerateIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10" /><path d="M20.49 15a9 9 0 01-14.85 3.36L1 14" /></svg>)

    const actionBarStyle = {
        display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '2px',
        marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--border)',
    }
    const btnBase = {
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px',
        background: 'transparent', border: 'none', borderRadius: '6px', cursor: 'pointer', color: 'var(--text-muted)',
        transition: 'background 0.15s, color 0.15s', padding: 0,
    }

    return (
        <div className={`app-layout ${view === "profile" ? "profile-mode" : ""}`}>
            {conflictPopup && (
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.65)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'all',
                }}>
                    <div style={{
                        background: 'var(--bg-card)', border: '1px solid rgba(248,113,113,0.3)',
                        borderRadius: 14, padding: '28px 28px 24px', maxWidth: 440, width: '90%',
                        boxShadow: '0 8px 32px rgba(0,0,0,0.6)', position: 'relative', zIndex: 100000,
                        pointerEvents: 'all',
                    }}>
                        <button onClick={handleConflictDismiss} style={{
                            position: 'absolute', top: 12, right: 14, background: 'transparent', border: 'none',
                            color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer',
                        }}>✕</button>
                        <div style={{ fontSize: 20, marginBottom: 6 }}>⚠️</div>
                        <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--red)', marginBottom: 8 }}>Calendar Conflict Detected</div>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>You have the following meetings during your requested leave period:</div>
                        <ul style={{ margin: '0 0 18px 0', padding: '0 0 0 16px', listStyle: 'disc' }}>
                            {(conflictPopup.meetings || []).map((m, i) => {
                                const dateStr = m.date || m.meeting_date || ''
                                const displayDate = dateStr ? (() => { try { return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) } catch { return dateStr } })() : ''
                                const displayTime = m.time || m.start_time || ''
                                return <li key={i} style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}><strong>{m.title || 'Meeting'}</strong>{displayDate ? ` — ${displayDate}` : ''}{displayTime ? ` at ${displayTime}` : ''}</li>
                            })}
                        </ul>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18 }}>What would you like to do?</div>
                        <div style={{ display: 'flex', gap: 10 }}>
                            <button onClick={handleConflictProceed} style={{ flex: 1, padding: '9px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Proceed</button>
                            <button onClick={handleConflictReschedule} style={{ flex: 1, padding: '9px 14px', borderRadius: 8, border: '1px solid var(--yellow)', background: 'transparent', color: 'var(--yellow)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Reschedule</button>
                            <button onClick={handleConflictCancel} style={{ flex: 1, padding: '9px 14px', borderRadius: 8, border: '1px solid var(--red)', background: 'transparent', color: 'var(--red)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>Cancel leave</button>
                        </div>
                    </div>
                </div>
            )}

            <style>{`
                .msg-action-btn { color: var(--text-muted) !important; transition: background 0.15s, color 0.15s; }
                .msg-action-btn:hover { background: rgba(79,142,247,0.1) !important; color: var(--accent) !important; }
                .msg-action-btn.active-btn { color: var(--accent) !important; background: rgba(79,142,247,0.12) !important; }
                .msg-action-btn.liked { color: var(--green) !important; background: rgba(52,211,153,0.1) !important; }
                .msg-action-btn.disliked { color: var(--red) !important; background: rgba(248,113,113,0.1) !important; }
                .user-msg-actions { opacity: 0 !important; transition: opacity 0.15s; }
                .msg-user:hover .user-msg-actions { opacity: 1 !important; }
                .theme-toggle-icon {
                    background: transparent;
                    border: none;
                    cursor: pointer;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    width: 32px;
                    height: 32px;
                    border-radius: 8px;
                    color: var(--text-secondary);
                    transition: all 0.2s;
                }
                .theme-toggle-icon:hover {
                    background: var(--accent-dim);
                    color: var(--accent);
                }
            `}</style>

            <aside className="sidebar">
                <div className="sidebar-brand">
                    <div className="sidebar-logo">H</div>
                    <div>
                        <div className="sidebar-title">HR Assistant</div>
                        <div className="sidebar-subtitle">AI-POWERED HRMS</div>
                    </div>
                </div>
                {employee && (
                    <div onClick={() => setView('profile')} style={{
                        background: view === 'profile' ? 'rgba(52,211,153,0.15)' : 'rgba(52,211,153,0.08)',
                        border: `1px solid ${view === 'profile' ? 'rgba(52,211,153,0.4)' : 'rgba(52,211,153,0.2)'}`,
                        borderRadius: '8px', padding: '10px 12px', marginBottom: '12px',
                        display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
                    }}>
                        <div style={{
                            width: 32, height: 32, borderRadius: '50%',
                            background: 'linear-gradient(135deg,var(--green),#059669)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 13, fontWeight: 700, color: '#fff',
                        }}>{(employee.name || 'U')[0].toUpperCase()}</div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{employee.name}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{employee.email}</div>
                        </div>
                    </div>
                )}
                <div className="sidebar-status"><span className="dot" />Knowledge base · {docCount} docs</div>

                <div className="sidebar-section">Your Conversations</div>
                {loadingSessions ? (
                    <div className="sidebar-status">Loading...</div>
                ) : (
                    <>
                        <button className="sidebar-btn" onClick={createNewSession}>+ New Chat</button>
                        {(() => {
                            const groups = { Today: [], Yesterday: [], 'Previous 7 Days': [], Older: [] }
                            sessions.forEach(s => { const key = getSessionGroupKey(s.created_at); groups[key].push(s) })
                            const groupOrder = ['Today', 'Yesterday', 'Previous 7 Days', 'Older']
                            return groupOrder.map(groupKey => (
                                groups[groupKey].length > 0 && (
                                    <div key={groupKey}>
                                        <div className="sidebar-section" style={{ marginTop: '16px' }}>{groupKey}</div>
                                        {groups[groupKey].map(s => (
                                            <div key={s.id} className="session-item">
                                                <div className="session-btn-wrapper">
                                                    <button
                                                        className={`session-btn ${currentSessionId === s.id ? 'active-session' : ''}`}
                                                        onClick={() => { setCurrentSessionId(s.id); loadMessages(s.id); setMenuOpen(null) }}
                                                    >
                                                        <span className="session-title">{s.title}</span>
                                                        {s.is_pinned && <span className="pin-icon">📌</span>}
                                                    </button>
                                                    <div className="session-menu">
                                                        <button
                                                            className="menu-dots"
                                                            onClick={(e) => { e.stopPropagation(); setMenuOpen(menuOpen === s.id ? null : s.id) }}
                                                        >⋯</button>
                                                        {menuOpen === s.id && (
                                                            <div className="dropdown-menu">
                                                                <div className="dropdown-item" onClick={() => renameSession(s.id, s.title)}>Rename</div>
                                                                <div className="dropdown-item" onClick={() => togglePinSession(s.id, s.is_pinned)}>{s.is_pinned ? 'Unpin' : 'Pin'}</div>
                                                                <div className="dropdown-item danger" onClick={() => deleteSession(s.id)}>Delete</div>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )
                            ))
                        })()}
                    </>
                )}
                <button className="sidebar-clear" onClick={() => { setMessages([]); setExpandedIdx(null); setPreviewData(null) }}>Clear current conversation</button>
                <button className="sidebar-clear" onClick={handleLogout} style={{ marginTop: 4, borderColor: 'rgba(248,113,113,.3)', color: 'var(--red)' }}>Logout</button>
            </aside>

            {/* Main content (chat, admin, profile) – with theme toggle icon beside notification bell */}
            {employee && (employee.role === 'admin' || employee.role === 'hr') && (view === 'admin' || view === 'leaveRequests') ? (
                <main style={{ gridColumn: '2 / -1', overflow: 'auto', background: 'var(--bg-primary)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 28px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 100 }}>
                        <button onClick={() => setView('chat')} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 16px', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer' }}>← Chat</button>
                        <div style={{ flex: 1 }} />
                        <button className="theme-toggle-icon" onClick={toggleTheme} title="Toggle theme">
                            {theme === 'dark' ? (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
                            ) : (
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
                            )}
                        </button>
                        <NotificationBell token={localStorage.getItem('hrms_token')} />
                    </div>
                    <div style={{ flex: 1, overflow: 'auto' }}>
                        {view === 'leaveRequests' ? <LeaveRequests token={localStorage.getItem('hrms_token')} /> : <AdminPanel token={localStorage.getItem('hrms_token')} />}
                    </div>
                </main>
            ) : view === 'chat' ? (
                <main className="chat-panel">
                    <div className="chat-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Chat</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {employee && (employee.role === 'admin' || employee.role === 'hr') && (
                                <div style={{ display: 'flex', gap: 6 }}>
                                    {employee.role === 'admin' && <button onClick={() => setView('admin')} style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 7, padding: '5px 13px', color: 'var(--accent)', fontSize: 12, cursor: 'pointer' }}>Admin Dashboard</button>}
                                    {employee.role === 'hr' && <button onClick={() => setView('leaveRequests')} style={{ background: 'rgba(16,185,129,0.08)', border: '1px solid rgba(16,185,129,0.25)', borderRadius: 7, padding: '5px 13px', color: 'var(--green)', fontSize: 12, cursor: 'pointer' }}>Leaves</button>}
                                </div>
                            )}
                            <button className="theme-toggle-icon" onClick={toggleTheme} title="Toggle theme">
                                {theme === 'dark' ? (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>
                                ) : (
                                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>
                                )}
                            </button>
                            <NotificationBell token={localStorage.getItem('hrms_token')} />
                        </div>
                    </div>
                    <div className="chat-messages">
                        {messages.map((msg, i) => (
                            msg.role === 'user' ? (
                                <div key={i} className="msg-user" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                                    <div className="msg-user-bubble">{msg.content}</div>
                                    <div style={{ display: 'flex', gap: 2, opacity: 0.5 }} className="user-msg-actions">
                                        <button className="msg-action-btn" style={btnBase} title="Copy" onClick={() => navigator.clipboard.writeText(msg.content)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg></button>
                                        <button className="msg-action-btn" style={btnBase} title="Edit & resend" onClick={() => setInput(msg.content)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg></button>
                                        <button className="msg-action-btn" style={btnBase} title="Resend" onClick={() => sendMessage(msg.content)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M22 2L11 13" /><path d="M22 2L15 22l-4-9-9-4 20-7z" /></svg></button>
                                    </div>
                                </div>
                            ) : (
                                <div key={i} className="msg-assistant">
                                    <div className="answer-card">
                                        <div className="answer-content">{msg.content.split('\n').map((line, j) => <p key={j}>{line || '\u00A0'}</p>)}</div>
                                        {msg.sources?.length > 0 && <div className="sources-list">{msg.sources.map((s, j) => <span key={j} className="source-tag">📄 {s.source_file} — {s.section}</span>)}</div>}
                                        <div style={actionBarStyle}>
                                            <button className={`msg-action-btn ${playingMsgIndex === i ? 'active-btn' : ''}`} style={btnBase} onClick={() => speakText(msg.content, i)}><SpeakerIcon /></button>
                                            <button className={`msg-action-btn ${likedMsgs[i] ? 'liked' : ''}`} style={btnBase} onClick={() => handleLike(i)}><ThumbUpIcon /></button>
                                            <button className={`msg-action-btn ${dislikedMsgs[i] ? 'disliked' : ''}`} style={btnBase} onClick={() => handleDislike(i)}><ThumbDownIcon /></button>
                                            <button className="msg-action-btn" style={btnBase} onClick={regenerate}><RegenerateIcon /></button>
                                        </div>
                                    </div>
                                </div>
                            )
                        ))}
                        {loading && <div className="thinking"><div className="dots"><span /><span /><span /></div>Searching knowledge base...</div>}
                        <div ref={chatEnd} />
                    </div>
                    <div className="chat-input-area">
                        <div className="chat-input-wrap">
                            <input value={input} onChange={e => setInput(e.target.value)} onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }} placeholder="Ask about HR policies, employees, leave..." disabled={loading} />
                            <button onClick={startVoiceRecognition} disabled={loading || isListening || isSpeaking || voiceCooldown} className={`mic-button ${isListening ? 'listening' : ''}`} title="Voice input"><svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="9" y="4" width="6" height="10" rx="3" fill="white" /><path d="M6 11C6 14.3137 8.68629 17 12 17C15.3137 17 18 14.3137 18 11" stroke="white" strokeWidth="1.5" /><path d="M12 17V20" stroke="white" strokeWidth="1.5" /><rect x="10" y="20" width="4" height="2" rx="1" fill="white" /></svg></button>
                            <button onClick={() => sendMessage(input)} disabled={loading || !input.trim()}>↑</button>
                        </div>
                    </div>
                </main>
            ) : (
                <main className="dashboard-panel">
                    {view === 'profile'
                        ? <ProfileView employee={employee} token={localStorage.getItem('hrms_token')} onBack={() => setView('chat')} onSaved={(updated) => { const merged = { ...employee, ...updated }; localStorage.setItem('hrms_employee', JSON.stringify(merged)); setEmployee(merged) }} />
                        : <Dashboard employee={employee} />
                    }
                </main>
            )}

            <aside className="preview-panel" style={{ display: (view === 'admin' || view === 'leaveRequests' || view === 'profile') ? 'none' : undefined }}>
                <div className="preview-header"><span>Source Preview</span></div>
                {latestSources.length === 0 ? (
                    <div className="preview-empty"><div className="icon">📋</div><p>Source documents appear here when the assistant cites them.</p></div>
                ) : (
                    <div className="preview-list">
                        {latestSources.map((src, idx) => {
                            const ext = src.source_file.split('.').pop().toLowerCase()
                            const isMissing = !src.content && !src.full_content && ['pdf', 'docx'].includes(ext)
                            const isExpanded = expandedIdx === idx
                            return (
                                <div key={idx} className={`source-card${isMissing ? ' source-card-missing' : ''}`}>
                                    <div className="source-card-header">
                                        <div className="source-card-info">
                                            <div className="source-card-name">{ext === 'pdf' ? '📕' : ext === 'md' ? '📘' : ext === 'docx' ? '📝' : '📄'} {src.source_file}</div>
                                            <div className="source-card-loc">📍 {src.section || 'General'}</div>
                                        </div>
                                        <button className={`source-card-toggle${isExpanded ? ' active' : ''}`} onClick={() => togglePreview(idx, src)}>{isExpanded ? 'Close' : 'Open'}</button>
                                    </div>
                                    {isExpanded && previewData && (
                                        <>
                                            {previewData.isFallbackAnswer && <div style={{ padding: '8px 12px', background: 'rgba(99,102,241,0.08)', borderRadius: 6, margin: '8px 0 4px', fontSize: 11, color: '#818cf8' }}>Showing the assistant's answer for this source — full document not available in preview.</div>}
                                            {['pdf-snippet', 'text-snippet'].includes(previewData.type) && (
                                                <div className="pdf-preview-container">
                                                    {(previewData.pages?.length > 1 || previewData.segments?.length > 1) && (
                                                        <div className="pdf-pagination">
                                                            <button onClick={() => handlePageChange(-1)} disabled={previewData.currentIndex === 0} className="pdf-nav-btn">← Prev</button>
                                                            <span className="pdf-page-indicator">{previewData.pages ? `Page ${previewData.pages[previewData.currentIndex].page}` : `Segment ${previewData.currentIndex + 1}`}<span className="pdf-page-count">({previewData.currentIndex + 1} of {(previewData.pages || previewData.segments).length})</span></span>
                                                            <button onClick={() => handlePageChange(1)} disabled={previewData.currentIndex === (previewData.pages || previewData.segments).length - 1} className="pdf-nav-btn">Next →</button>
                                                        </div>
                                                    )}
                                                    <div className="code-viewer">
                                                        {(previewData.lines || []).map((line, li) => (
                                                            <div key={li} className={`code-line${line.highlighted ? ' highlighted' : ''}`}>
                                                                <span className="line-num">{line.num}</span>
                                                                <span className="line-text" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(line.html) }} />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {previewData.type === 'content' && <div className="pdf-content-preview"><pre>{previewData.content}</pre></div>}
                                        </>
                                    )}
                                </div>
                            )
                        })}
                        {messages.length > 0 && messages[messages.length - 1].steps?.length > 0 && (
                            <details className="agent-steps">
                                <summary>⚙ Agent Steps ({messages[messages.length - 1].steps.length})</summary>
                                {messages[messages.length - 1].steps.map((step, i) => <div key={i} className="step">→ {step.name || step.type}</div>)}
                            </details>
                        )}
                    </div>
                )}
            </aside>
        </div>
    )
}