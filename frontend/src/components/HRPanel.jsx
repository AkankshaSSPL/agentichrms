/**
 * HRPanel.jsx
 * HR-only dashboard — 3 tabs:
 *  1. Employee Directory  — all employees, profile completion, click to fill via chat
 *  2. Leave Approvals     — reuses existing LeaveRequests component
 *  3. Fill Profile        — onboarding chat open for a selected employee (HR fills on behalf)
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import LeaveRequests from './LeaveRequests'

const API = '/api'

/* ── Sweet Alert ─────────────────────────────────────────────────────────── */
function Alert({ alerts, remove }) {
    return (
        <div style={{ position: 'fixed', top: 24, right: 24, zIndex: 99999, display: 'flex', flexDirection: 'column', gap: 10, pointerEvents: 'none' }}>
            {alerts.map(a => (
                <div key={a.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '13px 18px', borderRadius: 14, pointerEvents: 'all',
                    background: a.type === 'success' ? 'rgba(52,211,153,0.12)' : a.type === 'error' ? 'rgba(248,113,113,0.12)' : 'rgba(79,142,247,0.12)',
                    border: `1px solid ${a.type === 'success' ? 'rgba(52,211,153,0.35)' : a.type === 'error' ? 'rgba(248,113,113,0.35)' : 'rgba(79,142,247,0.35)'}`,
                    backdropFilter: 'blur(16px)', boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                    minWidth: 260, maxWidth: 380, animation: 'hrSlideIn 0.25s ease',
                }}>
                    <span style={{ fontSize: 18 }}>{a.type === 'success' ? '✅' : a.type === 'error' ? '❌' : 'ℹ️'}</span>
                    <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.4 }}>{a.message}</span>
                    <button onClick={() => remove(a.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, padding: '0 4px' }}>×</button>
                </div>
            ))}
        </div>
    )
}

/* ── Completion Ring ─────────────────────────────────────────────────────── */
function Ring({ pct, size = 36 }) {
    const r = (size - 4) / 2, circ = 2 * Math.PI * r
    const color = pct === 100 ? '#34d399' : pct > 0 ? 'var(--accent)' : 'var(--border)'
    return (
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth="3" />
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke={color} strokeWidth="3"
                strokeDasharray={`${(pct / 100) * circ} ${circ}`} strokeLinecap="round"
                style={{ transition: 'stroke-dasharray 0.5s ease' }} />
            <text x="50%" y="50%" dominantBaseline="middle" textAnchor="middle"
                style={{ fill: color, fontSize: size * 0.28, fontWeight: 700, transform: 'rotate(90deg)', transformOrigin: `${size / 2}px ${size / 2}px` }}>
                {pct}%
            </text>
        </svg>
    )
}

/* ── Onboarding Chat Modal (HR fills on behalf of employee) ──────────────── */
function OnboardingChatModal({ employee, token, onClose, onDone, nameChange = false }) {
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [history, setHistory] = useState([])
    const endRef = useRef(null)

    useEffect(() => {
        const greet = async () => {
            setLoading(true)
            const greetMsg = nameChange
                ? `I am HR. I want to update the profile details for employee ${employee.name} (ID: ${employee.id}). This could include updating their name, department, job title, phone number, date of birth, address, or any other profile field. Please ask me what specifically needs to be updated, then confirm the current value on record and ask for the new correct value. Only ask about the field being updated — do not ask unrelated questions.`
                : `I am HR and I want to fill the onboarding profile for ${employee.name}. Please guide me through only the fields that are still missing or incomplete — do not ask about fields that are already filled.`
            try {
                const res = await fetch(`${API}/onboarding-profile/chat-for`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({
                        message: greetMsg,
                        history: [],
                        employee_id: employee.id,
                    }),
                })
                const data = await res.json()
                const bot = { role: 'assistant', content: data.reply }
                setMessages([bot])
                setHistory([bot])
                if (data.profile_complete) { onDone?.(); onClose() }
            } catch {
                const fallback = nameChange
                    ? `I can help update ${employee.name}'s profile details. Please tell me which field you'd like to update (e.g. name, department, job title, phone, address), and I'll confirm the current value and record the new one.`
                    : `Let's complete ${employee.name}'s profile. I'll guide you through the missing fields one at a time.`
                setMessages([{ role: 'assistant', content: fallback }])
            } finally { setLoading(false) }
        }
        greet()
    }, [])

    useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

    const send = async () => {
        const text = input.trim()
        if (!text || loading) return
        setInput('')
        const userMsg = { role: 'user', content: text }
        const newHist = [...history, userMsg]
        setMessages(p => [...p, userMsg])
        setHistory(newHist)
        setLoading(true)
        try {
            const res = await fetch(`${API}/onboarding-profile/chat-for`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ message: text, history: newHist, employee_id: employee.id }),
            })
            const data = await res.json()
            const bot = { role: 'assistant', content: data.reply }
            setMessages(p => [...p, bot])
            setHistory(h => [...h, bot])
            // Broadcast name change so sidebar/admin refresh instantly
            if (data.name_changed) {
                window.dispatchEvent(new CustomEvent('hrms:name-changed'))
            }
            if (data.name_changed) {
                window.dispatchEvent(new CustomEvent('hrms:name-changed'))
            }
            if (data.profile_complete) setTimeout(() => { onDone?.(); onClose() }, 1500)
        } catch {
            setMessages(p => [...p, { role: 'assistant', content: 'Something went wrong. Please try again.' }])
        } finally { setLoading(false) }
    }

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 20, width: '92%', maxWidth: 520, height: '78vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,0.6)', animation: 'hrPopIn 0.2s ease' }}>

                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                    <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{nameChange ? ' Update Profile — ' : '📋 Fill Profile — '}{employee.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{nameChange ? 'Update any profile field — name, department, title, contact details, etc.' : 'Complete missing profile fields for this employee'}</div>
                    </div>
                    <button onClick={onClose} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 16, cursor: 'pointer', padding: '4px 10px' }}>✕</button>
                </div>

                {/* Messages */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '16px 20px', display: 'flex', flexDirection: 'column', gap: 12 }}>
                    {messages.map((m, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                            <div style={{
                                maxWidth: '82%', padding: '10px 14px', lineHeight: 1.55, fontSize: 13, whiteSpace: 'pre-wrap',
                                borderRadius: m.role === 'user' ? '14px 14px 4px 14px' : '14px 14px 14px 4px',
                                background: m.role === 'user' ? 'var(--accent)' : 'var(--bg-card)',
                                border: m.role === 'user' ? 'none' : '1px solid var(--border)',
                                color: m.role === 'user' ? '#fff' : 'var(--text-primary)',
                            }}>{m.content}</div>
                        </div>
                    ))}
                    {loading && (
                        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                            <div style={{ padding: '10px 16px', borderRadius: '14px 14px 14px 4px', background: 'var(--bg-card)', border: '1px solid var(--border)', display: 'flex', gap: 5, alignItems: 'center' }}>
                                {[0, 1, 2].map(i => <span key={i} style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--accent)', display: 'inline-block', animation: `hrBounce 0.9s ease-in-out ${i * 0.2}s infinite` }} />)}
                            </div>
                        </div>
                    )}
                    <div ref={endRef} />
                </div>

                {/* Input */}
                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--border)', display: 'flex', gap: 10, alignItems: 'flex-end' }}>
                    <textarea
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                        placeholder="Type your answer… (Enter to send)"
                        rows={1}
                        style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', color: 'var(--text-primary)', fontSize: 13, resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5, maxHeight: 100, overflowY: 'auto', transition: 'border-color 0.15s' }}
                        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                        onBlur={e => e.target.style.borderColor = 'var(--border)'}
                    />
                    <button onClick={send} disabled={loading || !input.trim()} style={{ background: 'var(--accent)', border: 'none', borderRadius: 10, padding: '10px 18px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: loading || !input.trim() ? 'not-allowed' : 'pointer', opacity: loading || !input.trim() ? 0.5 : 1, transition: 'opacity 0.15s', whiteSpace: 'nowrap' }}>Send</button>
                </div>
            </div>
        </div>
    )
}

/* ── Employee Directory Tab ──────────────────────────────────────────────── */
function EmployeeDirectory({ token, onFillProfile, onAlert }) {
    const [employees, setEmployees] = useState([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')

    const COMPLETION_FIELDS = ['gender', 'date_of_birth', 'department', 'designation', 'employment_type', 'join_date', 'address_line1', 'city', 'state', 'country', 'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation', 'bank_name', 'account_number', 'bank_branch']

    const fetchEmployees = useCallback(async () => {
        try {
            // Use the admin employees endpoint — HR can read but not modify roles
            const res = await fetch(`${API}/admin/employees`, { headers: { Authorization: `Bearer ${token}` } })
            if (!res.ok) throw new Error(`Error ${res.status}`)
            const data = await res.json()
            // profile_completion comes directly from the backend — no per-employee fetch needed
            const withProfiles = data.map(emp => ({
                ...emp,
                completion: emp.profile_completion ?? 0,
            }))
            setEmployees(withProfiles)
        } catch (err) {
            onAlert(err.message || 'Failed to load employees', 'error')
        } finally { setLoading(false) }
    }, [token])

    useEffect(() => { fetchEmployees() }, [fetchEmployees])

    const roleBadge = r => ({
        admin:    { bg: 'rgba(167,139,250,0.12)', color: '#a78bfa', border: 'rgba(167,139,250,0.3)' },
        hr:       { bg: 'rgba(79,142,247,0.12)',  color: 'var(--accent)', border: 'rgba(79,142,247,0.3)' },
        employee: { bg: 'rgba(52,211,153,0.1)',   color: '#34d399', border: 'rgba(52,211,153,0.25)' },
    }[r] || { bg: 'rgba(100,116,139,0.1)', color: 'var(--text-muted)', border: 'var(--border)' })

    const filtered = employees.filter(e =>
        !search || e.name?.toLowerCase().includes(search.toLowerCase()) || e.email?.toLowerCase().includes(search.toLowerCase()) || e.department?.toLowerCase().includes(search.toLowerCase())
    )

    if (loading) return <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}> Loading employees…</div>

    return (
        <div style={{ padding: '28px 32px' }}>
            {/* Search */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <div style={{ flex: 1, position: 'relative' }}>
                    <span style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)', fontSize: 14 }}></span>
                    <input
                        value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search by name, email or department…"
                        style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px 10px 38px', color: 'var(--text-primary)', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', transition: 'border-color 0.15s' }}
                        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                        onBlur={e => e.target.style.borderColor = 'var(--border)'}
                    />
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{filtered.length} employees</span>
            </div>

            {/* Grid */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                {filtered.map(emp => {
                    const rb = roleBadge(emp.role)
                    const incomplete = emp.completion < 100
                    return (
                        <div key={emp.id} style={{ background: 'var(--bg-card)', border: `1px solid var(--border)`, borderRadius: 16, padding: '18px 20px', transition: 'all 0.18s', cursor: 'default' }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = 'var(--border-hover)'; e.currentTarget.style.transform = 'translateY(-2px)'; e.currentTarget.style.boxShadow = '0 6px 24px rgba(0,0,0,0.15)' }}
                            onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = 'none' }}
                        >
                            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                                {/* Avatar */}
                                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg,var(--accent),#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                                    {(emp.name || '?')[0].toUpperCase()}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.name}</div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.email}</div>
                                </div>
                                <Ring pct={emp.completion} size={40} />
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                                <span style={{ background: rb.bg, color: rb.color, border: `1px solid ${rb.border}`, padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 600, letterSpacing: '0.04em' }}>{emp.role}</span>
                                {emp.department && <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', padding: '2px 9px', borderRadius: 20 }}>{emp.department}</span>}
                            </div>

                            {incomplete && (
                                <button
                                    onClick={() => onFillProfile(emp, false)}
                                    style={{ width: '100%', padding: '8px 0', background: 'var(--accent-dim)', border: '1px solid rgba(79,142,247,0.35)', borderRadius: 10, color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit' }}
                                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(79,142,247,0.2)' }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent-dim)' }}
                                >
                                     Fill Profile via Chat
                                </button>
                            )}
                            {!incomplete && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div style={{ textAlign: 'center', fontSize: 12, color: '#34d399', fontWeight: 600 }}> Profile Complete</div>
                                    <button
                                        onClick={() => onFillProfile(emp, true)}
                                        style={{ width: '100%', padding: '7px 0', background: 'transparent', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-muted)', fontSize: 11, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit' }}
                                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(79,142,247,0.4)'; e.currentTarget.style.color = 'var(--accent)' }}
                                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' }}
                                    >Update</button>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

/* ── Name Change Requests Tab ────────────────────────────────────────────── */
function NameChangeRequests({ token, onAlert }) {
    const [requests, setRequests] = useState([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState('pending') // pending | awaiting_document | all
    const [actionLoading, setActionLoading] = useState(null)
    const [noteModal, setNoteModal] = useState(null) // { id, action }
    const [noteText, setNoteText] = useState('')
    const [uploadModal, setUploadModal] = useState(null) // request id for doc preview

    const fetchRequests = useCallback(async () => {
        try {
            const t = token || localStorage.getItem('hrms_token') || ''
            const res = await fetch(`/api/name-change/requests`, {
                headers: { Authorization: `Bearer ${t}` }
            })
            const text = await res.text()
            console.log('[NameChange] status:', res.status, 'body:', text)
            if (!res.ok) throw new Error(`Server ${res.status}: ${text}`)
            const data = JSON.parse(text)
            console.log('[NameChange] rows:', data.length)
            setRequests(data)
        } catch (e) {
            console.error('[NameChange] fetch error:', e)
            onAlert?.('Failed to load name change requests: ' + e.message, 'error')
        } finally { setLoading(false) }
    }, [token])

    useEffect(() => { fetchRequests() }, [fetchRequests])

    const doAction = async (id, action, note = '') => {
        setActionLoading(id + action)
        try {
            const res = await fetch(`/api/name-change/${id}/action`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ action, hr_note: note || null }),
            })
            if (!res.ok) throw new Error(`Server ${res.status}`)
            const labels = { approve: 'approved', reject: 'rejected', request_document: 'document requested' }
            onAlert?.(`Request ${labels[action] || action} successfully`, 'success')
            await fetchRequests()
            // If approved, broadcast name change so App + AdminPanel refresh
            if (action === 'approve') {
                window.dispatchEvent(new CustomEvent('hrms:name-changed'))
            }
        } catch (e) {
            onAlert?.('Action failed: ' + e.message, 'error')
        } finally {
            setActionLoading(null)
            setNoteModal(null)
            setNoteText('')
        }
    }

    const openNote = (id, action) => { setNoteModal({ id, action }); setNoteText('') }

    const filtered = requests.filter(r => {
        if (filter === 'all') return true
        if (filter === 'pending') return r.status === 'pending'
        if (filter === 'awaiting_document') return r.status === 'awaiting_document'
        return true
    })

    const statusBadge = (status) => {
        const map = {
            pending:            { bg: 'rgba(79,142,247,0.15)',  color: '#60a5fa', label: 'Pending' },
            awaiting_document:  { bg: 'rgba(245,158,11,0.15)', color: '#fbbf24', label: 'Awaiting Doc' },
            approved:           { bg: 'rgba(16,185,129,0.15)', color: '#34d399', label: 'Approved' },
            rejected:           { bg: 'rgba(239,68,68,0.15)',  color: '#f87171', label: 'Rejected' },
        }
        const s = map[status] || { bg: 'rgba(100,116,139,0.15)', color: '#94a3b8', label: status }
        return <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}40`, padding: '2px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600, letterSpacing: '0.04em' }}>{s.label}</span>
    }

    const actionBtn = (label, color, onClick, disabled) => (
        <button
            onClick={onClick} disabled={disabled}
            style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${color}50`, background: `${color}15`, color, fontSize: 11, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, fontFamily: 'inherit', transition: 'all 0.15s' }}
            onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = `${color}28` }}
            onMouseLeave={e => { e.currentTarget.style.background = `${color}15` }}
        >{label}</button>
    )

    const pendingCount = requests.filter(r => r.status === 'pending').length
    const awaitingCount = requests.filter(r => r.status === 'awaiting_document').length

    return (
        <div>
            {/* Note/Action modal */}
            {noteModal && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 28, maxWidth: 400, width: '90%', boxShadow: '0 24px 64px rgba(0,0,0,0.4)' }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                            {noteModal.action === 'approve' ? '✅ Approve Request' : noteModal.action === 'reject' ? '❌ Reject Request' : '📎 Request Document'}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>Add an optional note for the employee (optional)</div>
                        <textarea
                            value={noteText}
                            onChange={e => setNoteText(e.target.value)}
                            placeholder="e.g. Please also submit updated ID proof…"
                            rows={3}
                            style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text-primary)', fontSize: 12, resize: 'none', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }}
                        />
                        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
                            <button onClick={() => { setNoteModal(null); setNoteText('') }} style={{ padding: '7px 16px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                            <button
                                onClick={() => doAction(noteModal.id, noteModal.action, noteText)}
                                disabled={!!actionLoading}
                                style={{ padding: '7px 18px', borderRadius: 7, border: 'none', background: noteModal.action === 'approve' ? '#059669' : noteModal.action === 'reject' ? '#dc2626' : 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}
                            >{actionLoading ? '…' : 'Confirm'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>Name Change Requests</h2>
                    <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>Review, approve or request documents for employee name changes.</p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                    {/* Filter pills */}
                    {[
                        { id: 'pending', label: `Pending${pendingCount ? ` (${pendingCount})` : ''}` },
                        { id: 'awaiting_document', label: `Awaiting Doc${awaitingCount ? ` (${awaitingCount})` : ''}` },
                        { id: 'all', label: 'Show All' },
                    ].map(f => (
                        <button key={f.id} onClick={() => setFilter(f.id)} style={{
                            padding: '5px 14px', borderRadius: 20, border: `1px solid ${filter === f.id ? 'rgba(79,142,247,0.5)' : 'var(--border)'}`,
                            background: filter === f.id ? 'var(--accent-dim)' : 'transparent',
                            color: filter === f.id ? 'var(--accent)' : 'var(--text-muted)',
                            fontSize: 11, fontWeight: 500, cursor: 'pointer', fontFamily: 'inherit',
                        }}>{f.label}</button>
                    ))}
                    <button onClick={fetchRequests} style={{ padding: '5px 12px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer', fontFamily: 'inherit' }}>↻ Refresh</button>
                </div>
            </div>

            {/* Content */}
            {loading ? (
                <div style={{ textAlign: 'center', padding: 60, color: 'var(--text-muted)', fontSize: 13 }}>⏳ Loading…</div>
            ) : filtered.length === 0 ? (
                <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '48px 24px', textAlign: 'center' }}>
                    <div style={{ fontSize: 28, marginBottom: 10 }}>📭</div>
                    <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>No {filter === 'all' ? '' : filter.replace('_', ' ')} requests</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Name change requests from employees will appear here.</div>
                </div>
            ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {filtered.map(r => (
                        <div key={r.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px' }}>
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
                                {/* Left: employee info */}
                                <div style={{ flex: 1, minWidth: 200 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                        <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--accent-dim)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>
                                            {(r.employee_name || '?')[0].toUpperCase()}
                                        </div>
                                        <div>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{r.employee_name}</div>
                                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.employee_email}</div>
                                        </div>
                                        {statusBadge(r.status)}
                                        {!r.document_provided && r.status !== 'approved' && r.status !== 'rejected' && (
                                            <span style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)', padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600 }}>No Document</span>
                                        )}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
                                        <span><span style={{ color: 'var(--text-muted)' }}>From:</span> <strong style={{ color: 'var(--text-primary)' }}>{r.current_name}</strong></span>
                                        <span>→</span>
                                        <span><span style={{ color: 'var(--text-muted)' }}>To:</span> <strong style={{ color: 'var(--accent)' }}>{r.requested_name}</strong></span>
                                        <span><span style={{ color: 'var(--text-muted)' }}>Reason:</span> {r.reason}</span>
                                        <span style={{ color: 'var(--text-muted)' }}>{new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                    </div>
                                    {r.hr_note && (
                                        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: '5px 10px', borderRadius: 6, borderLeft: '3px solid var(--border)' }}>
                                            Note: {r.hr_note}
                                        </div>
                                    )}
                                </div>

                                {/* Right: actions */}
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                                    {r.document_provided && (
                                        <a href={`/api/name-change/${r.id}/document`} target="_blank" rel="noopener noreferrer"
                                            style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid rgba(79,142,247,0.3)', background: 'rgba(79,142,247,0.08)', color: 'var(--accent)', fontSize: 11, fontWeight: 500, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                                            📎 View Doc
                                        </a>
                                    )}
                                    {(r.status === 'pending' || r.status === 'awaiting_document') && (<>
                                        {actionBtn('✅ Approve', '#10b981', () => openNote(r.id, 'approve'), !!actionLoading)}
                                        {actionBtn('❌ Reject',  '#ef4444', () => openNote(r.id, 'reject'),  !!actionLoading)}
                                        {!r.document_provided && actionBtn('📎 Request Doc', '#f59e0b', () => openNote(r.id, 'request_document'), !!actionLoading)}
                                    </>)}
                                    {r.status === 'approved' && <span style={{ fontSize: 12, color: '#34d399', fontWeight: 500 }}>✅ Name updated</span>}
                                    {r.status === 'rejected' && <span style={{ fontSize: 12, color: '#f87171', fontWeight: 500 }}>❌ Rejected</span>}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}


/* ── Approval Requests Tab ───────────────────────────────────────────────── */
function ApprovalRequests({ token, onAlert }) {
    const [requests, setRequests] = useState([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState('pending')
    const [actionLoading, setActionLoading] = useState(null)
    const [noteModal, setNoteModal] = useState(null) // { id, action }
    const [noteText, setNoteText] = useState('')

    const fetchRequests = useCallback(async () => {
        try {
            const t = token || localStorage.getItem('hrms_token') || ''
            const url = filter === 'all' ? '/api/approvals/requests' : `/api/approvals/requests?status=${filter}`
            const res = await fetch(url, { headers: { Authorization: `Bearer ${t}` } })
            if (!res.ok) throw new Error(`Server ${res.status}`)
            setRequests(await res.json())
        } catch (e) {
            onAlert?.('Failed to load approval requests: ' + e.message, 'error')
        } finally { setLoading(false) }
    }, [token, filter])

    useEffect(() => { fetchRequests() }, [fetchRequests])

    const doAction = async (id, action, note) => {
        setActionLoading(id + action)
        try {
            const t = token || localStorage.getItem('hrms_token') || ''
            const res = await fetch(`/api/approvals/${id}/action`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
                body: JSON.stringify({ action, reason: note || null }),
            })
            if (!res.ok) throw new Error(`Server ${res.status}`)
            onAlert?.(action === 'approve' ? 'Change approved and applied' : 'Request rejected', 'success')
            if (action === 'approve') window.dispatchEvent(new CustomEvent('hrms:name-changed'))
            await fetchRequests()
        } catch (e) {
            onAlert?.('Action failed: ' + e.message, 'error')
        } finally {
            setActionLoading(null)
            setNoteModal(null)
            setNoteText('')
        }
    }

    const statusBadge = (status) => {
        const map = {
            pending:  { bg: 'rgba(79,142,247,0.15)',  color: '#60a5fa', label: 'Pending' },
            approved: { bg: 'rgba(16,185,129,0.15)', color: '#34d399', label: 'Approved' },
            rejected: { bg: 'rgba(239,68,68,0.15)',  color: '#f87171', label: 'Rejected' },
        }
        const s = map[status] || { bg: 'rgba(100,116,139,0.15)', color: '#94a3b8', label: status }
        return <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.color}40`, padding: '2px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600 }}>{s.label}</span>
    }

    const pendingCount = requests.filter(r => r.status === 'pending').length

    return (
        <div>
            {/* Note modal */}
            {noteModal && (
                <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:14, padding:28, maxWidth:400, width:'90%' }}>
                        <div style={{ fontSize:15, fontWeight:700, color:'var(--text-primary)', marginBottom:6 }}>
                            {noteModal.action === 'approve' ? '✅ Approve Change' : '❌ Reject Request'}
                        </div>
                        <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:14 }}>Optional note to the employee</div>
                        <textarea value={noteText} onChange={e => setNoteText(e.target.value)}
                            placeholder="Add a reason or note..." rows={3}
                            style={{ width:'100%', background:'var(--bg-input)', border:'1px solid var(--border)', borderRadius:8, padding:'9px 12px', color:'var(--text-primary)', fontSize:12, resize:'none', outline:'none', fontFamily:'inherit', boxSizing:'border-box' }} />
                        <div style={{ display:'flex', gap:8, marginTop:14, justifyContent:'flex-end' }}>
                            <button onClick={() => { setNoteModal(null); setNoteText('') }}
                                style={{ padding:'7px 16px', borderRadius:7, border:'1px solid var(--border)', background:'transparent', color:'var(--text-secondary)', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>Cancel</button>
                            <button onClick={() => doAction(noteModal.id, noteModal.action, noteText)} disabled={!!actionLoading}
                                style={{ padding:'7px 18px', borderRadius:7, border:'none', background: noteModal.action === 'approve' ? '#059669' : '#dc2626', color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
                                {actionLoading ? '…' : 'Confirm'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:18 }}>
                <div>
                    <h2 style={{ margin:0, fontSize:17, fontWeight:700, color:'var(--text-primary)' }}>Profile Update Requests</h2>
                    <p style={{ margin:'3px 0 0', fontSize:12, color:'var(--text-muted)' }}>Employee requests to update HR-controlled profile fields.</p>
                </div>
                <div style={{ display:'flex', gap:8 }}>
                    {[
                        { id:'pending', label: pendingCount ? `Pending (${pendingCount})` : 'Pending' },
                        { id:'approved', label:'Approved' },
                        { id:'rejected', label:'Rejected' },
                        { id:'all', label:'All' },
                    ].map(f => (
                        <button key={f.id} onClick={() => setFilter(f.id)} style={{
                            padding:'5px 14px', borderRadius:20, fontSize:11, fontWeight:500, cursor:'pointer', fontFamily:'inherit',
                            border: `1px solid ${filter === f.id ? 'rgba(79,142,247,0.5)' : 'var(--border)'}`,
                            background: filter === f.id ? 'var(--accent-dim)' : 'transparent',
                            color: filter === f.id ? 'var(--accent)' : 'var(--text-muted)',
                        }}>{f.label}</button>
                    ))}
                    <button onClick={fetchRequests} style={{ padding:'5px 12px', borderRadius:8, border:'1px solid var(--border)', background:'transparent', color:'var(--text-muted)', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}>↻</button>
                </div>
            </div>

            {loading ? (
                <div style={{ textAlign:'center', padding:60, color:'var(--text-muted)', fontSize:13 }}>⏳ Loading…</div>
            ) : requests.length === 0 ? (
                <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:'48px 24px', textAlign:'center' }}>
                    <div style={{ fontSize:28, marginBottom:10 }}>📭</div>
                    <div style={{ fontSize:14, fontWeight:600, color:'var(--text-primary)', marginBottom:4 }}>No {filter === 'all' ? '' : filter} requests</div>
                    <div style={{ fontSize:12, color:'var(--text-muted)' }}>Profile update requests from employees will appear here.</div>
                </div>
            ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    {requests.map(r => (
                        <div key={r.id} style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:'16px 20px' }}>
                            <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
                                <div style={{ flex:1, minWidth:200 }}>
                                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                                        <div style={{ width:30, height:30, borderRadius:'50%', background:'var(--accent-dim)', color:'var(--accent)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:12, fontWeight:700, flexShrink:0 }}>
                                            {(r.employee_name || '?')[0].toUpperCase()}
                                        </div>
                                        <div>
                                            <div style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)' }}>{r.employee_name}</div>
                                            <div style={{ fontSize:11, color:'var(--text-muted)' }}>{r.employee_email}</div>
                                        </div>
                                        {statusBadge(r.status)}
                                    </div>
                                    <div style={{ fontSize:12, color:'var(--text-secondary)', display:'flex', flexWrap:'wrap', gap:'4px 16px' }}>
                                        <span><span style={{ color:'var(--text-muted)' }}>Field:</span> <strong style={{ color:'var(--text-primary)' }}>{r.field_label}</strong></span>
                                        <span><span style={{ color:'var(--text-muted)' }}>From:</span> {r.old_value || '—'}</span>
                                        <span>→</span>
                                        <span><span style={{ color:'var(--text-muted)' }}>To:</span> <strong style={{ color:'var(--accent)' }}>{r.new_value}</strong></span>
                                        <span style={{ color:'var(--text-muted)' }}>{r.created_at ? new Date(r.created_at).toLocaleDateString('en-IN', { day:'numeric', month:'short', year:'numeric' }) : ''}</span>
                                    </div>
                                    {r.reason && (
                                        <div style={{ marginTop:8, fontSize:11, color:'var(--text-muted)', background:'var(--bg-secondary)', padding:'5px 10px', borderRadius:6, borderLeft:'3px solid var(--border)' }}>
                                            Note: {r.reason}
                                        </div>
                                    )}
                                </div>
                                {r.status === 'pending' && (
                                    <div style={{ display:'flex', gap:6, flexShrink:0 }}>
                                        <button onClick={() => setNoteModal({ id:r.id, action:'approve' })} disabled={!!actionLoading}
                                            style={{ padding:'6px 14px', borderRadius:7, border:'1px solid rgba(16,185,129,0.3)', background:'rgba(16,185,129,0.1)', color:'#10b981', fontSize:11, fontWeight:500, cursor:'pointer', fontFamily:'inherit' }}>
                                            ✅ Approve
                                        </button>
                                        <button onClick={() => setNoteModal({ id:r.id, action:'reject' })} disabled={!!actionLoading}
                                            style={{ padding:'6px 14px', borderRadius:7, border:'1px solid rgba(239,68,68,0.3)', background:'rgba(239,68,68,0.1)', color:'#ef4444', fontSize:11, fontWeight:500, cursor:'pointer', fontFamily:'inherit' }}>
                                            ❌ Reject
                                        </button>
                                    </div>
                                )}
                                {r.status === 'approved' && <span style={{ fontSize:12, color:'#34d399', fontWeight:500 }}>✅ Applied</span>}
                                {r.status === 'rejected' && <span style={{ fontSize:12, color:'#f87171', fontWeight:500 }}>❌ Rejected</span>}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}


/* ── Main HRPanel ────────────────────────────────────────────────────────── */
export default function HRPanel({ token: tokenProp }) {
    const token = tokenProp || localStorage.getItem('hrms_token') || ''
    const [activeTab, setActiveTab] = useState('directory')
    const [alerts, setAlerts] = useState([])
    const [chatTarget, setChatTarget] = useState(null)  // employee being onboarded

    const addAlert = useCallback((message, type = 'info') => {
        const id = Date.now() + Math.random()
        setAlerts(p => [...p, { id, message, type }])
        setTimeout(() => setAlerts(p => p.filter(a => a.id !== id)), 4000)
    }, [])

    const removeAlert = useCallback(id => setAlerts(p => p.filter(a => a.id !== id)), [])

    const TABS = [
        { id: 'directory', label: ' Employee Directory' },
        { id: 'leaves',    label: ' Leave Approvals' },
        { id: 'approvals', label: ' Update Requests' },
    ]

    return (
        <>
            <style>{`
                @keyframes hrSlideIn { from{opacity:0;transform:translateX(32px)} to{opacity:1;transform:translateX(0)} }
                @keyframes hrPopIn   { from{opacity:0;transform:scale(0.94)}     to{opacity:1;transform:scale(1)} }
                @keyframes hrBounce  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }

                /* Themed scrollbars */
                ::-webkit-scrollbar { width: 6px; height: 6px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 999px; }
                ::-webkit-scrollbar-thumb:hover { background: var(--border-hover, rgba(79,142,247,0.4)); }
                ::-webkit-scrollbar-corner { background: transparent; }
                * { scrollbar-width: thin; scrollbar-color: var(--border) transparent; }
            `}</style>

            <Alert alerts={alerts} remove={removeAlert} />

            {chatTarget && (
                <OnboardingChatModal
                    employee={chatTarget}
                    token={token}
                    nameChange={chatTarget.nameChange || false}
                    onClose={() => setChatTarget(null)}
                    onDone={() => { addAlert(`${chatTarget.name}'s profile updated successfully!`, 'success'); setChatTarget(null) }}
                />
            )}

            <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', width: '100%', background: 'var(--bg-primary)', padding: '32px 40px', boxSizing: 'border-box' }}>

                {/* Header */}
                <div style={{ marginBottom: 28 }}>
                    <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>HR Dashboard</h1>
                    <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>Manage employee profiles, review leave requests</p>
                </div>

                {/* Tabs */}
                <div style={{ display: 'flex', gap: 8, marginBottom: 28, borderBottom: '1px solid var(--border)', paddingBottom: 12 }}>
                    {TABS.map(tab => (
                        <button key={tab.id} onClick={() => setActiveTab(tab.id)} style={{
                            padding: '8px 20px', background: activeTab === tab.id ? 'var(--accent-dim)' : 'transparent',
                            border: `1px solid ${activeTab === tab.id ? 'rgba(79,142,247,0.4)' : 'var(--border)'}`,
                            borderRadius: 24, color: activeTab === tab.id ? 'var(--accent)' : 'var(--text-muted)',
                            cursor: 'pointer', fontWeight: 500, fontSize: 13, transition: 'all 0.15s', whiteSpace: 'nowrap', fontFamily: 'inherit',
                        }}
                        onMouseEnter={e => { if (activeTab !== tab.id) { e.currentTarget.style.borderColor = 'rgba(79,142,247,0.3)'; e.currentTarget.style.color = 'var(--text-secondary)' } }}
                        onMouseLeave={e => { if (activeTab !== tab.id) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' } }}
                        >{tab.label}</button>
                    ))}
                </div>

                {/* Content */}
                <div style={{ flex: 1 }}>
                    {activeTab === 'directory' && (
                        <EmployeeDirectory token={token} onFillProfile={(emp, nameChange = false) => setChatTarget({ ...emp, nameChange })} onAlert={addAlert} />
                    )}
                    {activeTab === 'leaves' && (
                        <LeaveRequests token={token} onAlert={addAlert} />
                    )}
                    {activeTab === 'approvals' && (
                        <ApprovalRequests token={token} onAlert={addAlert} />
                    )}
                </div>
            </div>
        </>
    )
}