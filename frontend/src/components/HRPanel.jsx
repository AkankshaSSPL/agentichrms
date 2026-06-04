/**
 * HRPanel.jsx
 * HR-only dashboard — 3 tabs:
 *  1. Employee Directory  — all employees, profile completion, fill/update via chat
 *  2. Leave Approvals     — reuses existing LeaveRequests component
 *  3. Profile Update Requests — all pending approval requests (no direct edit)
 */
import { useState, useEffect, useCallback, useRef } from 'react'
import LeaveRequests from './LeaveRequests'

const API = '/api'

/* ── Sweet Alert ──────────────────────────────────────────────────────────── */
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
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                    <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{nameChange ? ' Update Profile — ' : '📋 Fill Profile — '}{employee.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{nameChange ? 'Update any profile field — name, department, title, contact details, etc.' : 'Complete missing profile fields for this employee'}</div>
                    </div>
                    <button onClick={onClose} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 8, color: 'var(--text-muted)', fontSize: 16, cursor: 'pointer', padding: '4px 10px' }}>✕</button>
                </div>
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

/* ── Employee Directory Tab (without Edit button) ───────────────────────── */
function EmployeeDirectory({ token, onFillProfile, onAlert }) {
    const [employees, setEmployees] = useState([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')

    const fetchEmployees = useCallback(async () => {
        try {
            const res = await fetch(`${API}/admin/employees`, { headers: { Authorization: `Bearer ${token}` } })
            if (!res.ok) throw new Error(`Error ${res.status}`)
            const data = await res.json()
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

    if (loading) return <div style={{ padding: 60, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>⏳ Loading employees…</div>

    return (
        <div style={{ padding: '28px 32px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <div style={{ flex: 1 }}>
                    <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, email or department…" style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', color: 'var(--text-primary)', fontSize: 13, outline: 'none' }} />
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>{filtered.length} employees</span>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
                {filtered.map(emp => {
                    const rb = roleBadge(emp.role)
                    const incomplete = emp.completion < 100
                    return (
                        <div key={emp.id} style={{ background: 'var(--bg-card)', border: `1px solid var(--border)`, borderRadius: 16, padding: '18px 20px' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 14 }}>
                                <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg,var(--accent),#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                                    {(emp.name || '?')[0].toUpperCase()}
                                </div>
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>{emp.name}</div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{emp.email}</div>
                                </div>
                                <Ring pct={emp.completion} size={40} />
                            </div>

                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14, flexWrap: 'wrap' }}>
                                <span style={{ background: rb.bg, color: rb.color, border: `1px solid ${rb.border}`, padding: '2px 9px', borderRadius: 20, fontSize: 10, fontWeight: 600 }}>{emp.role}</span>
                                {emp.department && <span style={{ fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-secondary)', border: '1px solid var(--border)', padding: '2px 9px', borderRadius: 20 }}>{emp.department}</span>}
                            </div>

                            <div style={{ display: 'flex', gap: 8 }}>
                                {incomplete ? (
                                    <button onClick={() => onFillProfile(emp, false)} style={{ flex: 1, padding: '8px 0', background: 'var(--accent-dim)', border: '1px solid rgba(79,142,247,0.35)', borderRadius: 10, color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}>Fill Profile via Chat</button>
                                ) : (
                                    <button onClick={() => onFillProfile(emp, true)} style={{ flex: 1, padding: '7px 0', background: 'transparent', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-muted)', fontSize: 11, cursor: 'pointer' }}>Update via Chat</button>
                                )}
                            </div>
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

/* ── Profile Update Requests Tab ─────────────────────────────────────────── */
function ProfileUpdateRequestsTab({ token, onAlert }) {
    const [requests, setRequests] = useState([])
    const [loading, setLoading] = useState(true)
    const [actionLoading, setActionLoading] = useState({})
    const [notes, setNotes] = useState({})

    const fetchRequests = async () => {
        setLoading(true)
        try {
            const res = await fetch(`${API}/onboarding-profile/approval-requests/pending`, {
                headers: { Authorization: `Bearer ${token}` }
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            const data = await res.json()
            setRequests(data)
        } catch (err) {
            onAlert(err.message, 'error')
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchRequests()
    }, [token])

    const handleAction = async (id, action) => {
        setActionLoading(prev => ({ ...prev, [id]: true }))
        try {
            const res = await fetch(`${API}/onboarding-profile/approval-requests/${id}/${action}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ notes: notes[id] || '' })
            })
            if (!res.ok) throw new Error(`HTTP ${res.status}`)
            onAlert(`Request ${action}d successfully`, 'success')
            fetchRequests()
            setNotes(prev => { const newNotes = { ...prev }; delete newNotes[id]; return newNotes })
        } catch (err) {
            onAlert(err.message, 'error')
        } finally {
            setActionLoading(prev => ({ ...prev, [id]: false }))
        }
    }

    if (loading) return <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>⏳ Loading requests…</div>

    if (requests.length === 0) {
        return <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '48px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>✓</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>No pending requests</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>All profile update requests have been reviewed.</div>
        </div>
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            {requests.map(req => (
                <div key={req.id} style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 12, padding: '18px 20px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12, marginBottom: 12 }}>
                        <div>
                            <div style={{ fontWeight: 600, fontSize: 14, color: 'var(--text-primary)' }}>{req.employee_name}</div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{req.employee_email}</div>
                        </div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Requested: {new Date(req.created_at).toLocaleString()}</div>
                    </div>
                    <div style={{ background: 'var(--bg-input)', borderRadius: 8, padding: '12px 14px', marginBottom: 14 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, marginBottom: 8 }}>Field: {req.field_label}</div>
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, fontSize: 12 }}>
                            <div><span style={{ color: 'var(--text-muted)' }}>Current:</span> {req.old_value || '<empty>'}</div>
                            <div><span style={{ color: 'var(--text-muted)' }}>Requested:</span> <strong style={{ color: 'var(--accent)' }}>{req.new_value}</strong></div>
                        </div>
                    </div>
                    <div style={{ marginBottom: 12 }}>
                        <input
                            type="text"
                            placeholder="Optional notes / reason"
                            value={notes[req.id] || ''}
                            onChange={e => setNotes(prev => ({ ...prev, [req.id]: e.target.value }))}
                            style={{
                                width: '100%',
                                background: 'var(--bg-input)',
                                border: '1px solid var(--border)',
                                borderRadius: 8,
                                padding: '8px 12px',
                                fontSize: 12,
                                color: 'var(--text-primary)',
                                outline: 'none',
                            }}
                        />
                    </div>
                    <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                        <button
                            onClick={() => handleAction(req.id, 'approve')}
                            disabled={actionLoading[req.id]}
                            style={{
                                background: '#10b981',
                                border: 'none',
                                borderRadius: 8,
                                padding: '6px 18px',
                                color: '#fff',
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: actionLoading[req.id] ? 'not-allowed' : 'pointer',
                                opacity: actionLoading[req.id] ? 0.6 : 1,
                            }}
                        >
                            Approve
                        </button>
                        <button
                            onClick={() => handleAction(req.id, 'reject')}
                            disabled={actionLoading[req.id]}
                            style={{
                                background: 'transparent',
                                border: '1px solid #ef4444',
                                borderRadius: 8,
                                padding: '6px 18px',
                                color: '#f87171',
                                fontSize: 12,
                                fontWeight: 600,
                                cursor: actionLoading[req.id] ? 'not-allowed' : 'pointer',
                                opacity: actionLoading[req.id] ? 0.6 : 1,
                            }}
                        >
                            Reject
                        </button>
                    </div>
                </div>
            ))}
        </div>
    )
}

/* ── Main HRPanel (3 tabs) ───────────────────────────────────────────────── */
export default function HRPanel({ token: tokenProp }) {
    const token = tokenProp || localStorage.getItem('hrms_token') || ''
    const [activeTab, setActiveTab] = useState('directory')
    const [alerts, setAlerts] = useState([])
    const [chatTarget, setChatTarget] = useState(null)

    const addAlert = useCallback((message, type = 'info') => {
        const id = Date.now() + Math.random()
        setAlerts(p => [...p, { id, message, type }])
        setTimeout(() => setAlerts(p => p.filter(a => a.id !== id)), 4000)
    }, [])

    const removeAlert = useCallback(id => setAlerts(p => p.filter(a => a.id !== id)), [])

    const TABS = [
        { id: 'directory',   label: ' Employee Directory' },
        { id: 'leaves',      label: 'Leave Approvals' },
        { id: 'requests',    label: ' Profile Update Requests' },
    ]

    return (
        <>
            <style>{`
                @keyframes hrSlideIn { from{opacity:0;transform:translateX(32px)} to{opacity:1;transform:translateX(0)} }
                @keyframes hrPopIn   { from{opacity:0;transform:scale(0.94)}     to{opacity:1;transform:scale(1)} }
                @keyframes hrBounce  { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
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
                <div style={{ marginBottom: 28 }}>
                    <h1 style={{ margin: 0, fontSize: 22, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>HR Dashboard</h1>
                    <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>Manage employee profiles, review leave requests, approve changes.</p>
                </div>

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

                <div style={{ flex: 1 }}>
                    {activeTab === 'directory' && (
                        <EmployeeDirectory token={token} onFillProfile={(emp, nameChange = false) => setChatTarget({ ...emp, nameChange })} onAlert={addAlert} />
                    )}
                    {activeTab === 'leaves' && (
                        <LeaveRequests token={token} onAlert={addAlert} />
                    )}
                    {activeTab === 'requests' && (
                        <ProfileUpdateRequestsTab token={token} onAlert={addAlert} />
                    )}
                </div>
            </div>
        </>
    )
}