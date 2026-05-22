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
                ? `I am HR and I need to update the name for employee ${employee.name} (ID: ${employee.id}). The employee may have changed their name due to marriage or a legal name change. Please confirm the current name on record, ask for the new legal name and reason for the change (marriage / legal name change / correction / other). Also check and flag if any other employee already has the same name as the new name being requested.`
                : `I am HR and I want to fill the onboarding profile for ${employee.name}. Please guide me through the missing fields.`
            try {
                const res = await fetch(`${API}/onboarding-profile/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({
                        message: greetMsg,
                        history: [],
                        target_employee_id: employee.id,
                    }),
                })
                const data = await res.json()
                const bot = { role: 'assistant', content: data.reply }
                setMessages([bot])
                setHistory([bot])
                if (data.profile_complete) { onDone?.(); onClose() }
            } catch {
                const fallback = nameChange
                    ? `I'll help update the name for ${employee.name}. Please confirm:\n1. The new legal name\n2. Reason for change (marriage / legal / correction / other)\n\nI'll also flag if any other employee already shares the new name.`
                    : `Let's fill in ${employee.name}'s profile. What department and job title should I record?`
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
            const res = await fetch(`${API}/onboarding-profile/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ message: text, history: newHist, target_employee_id: employee.id }),
            })
            const data = await res.json()
            const bot = { role: 'assistant', content: data.reply }
            setMessages(p => [...p, bot])
            setHistory(h => [...h, bot])
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
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{nameChange ? ' Name Update — ' : ' Fill Profile — '}{employee.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{nameChange ? 'Update legal name — provide new name, reason, and supporting context' : 'Answer the assistant\'s questions to complete the profile'}</div>
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
            // Fetch profile completion for each
            const withProfiles = await Promise.all(data.map(async emp => {
                try {
                    const r = await fetch(`${API}/onboarding-profile/me?employee_id=${emp.id}`, { headers: { Authorization: `Bearer ${token}` } })
                    if (!r.ok) return { ...emp, completion: 0, profile: {} }
                    const p = await r.json()
                    const filled = COMPLETION_FIELDS.filter(f => p[f]).length
                    return { ...emp, completion: Math.round((filled / COMPLETION_FIELDS.length) * 100), profile: p }
                } catch { return { ...emp, completion: 0, profile: {} } }
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
                                    <div style={{ textAlign: 'center', fontSize: 12, color: '#34d399', fontWeight: 600 }}>✅ Profile Complete</div>
                                    <button
                                        onClick={() => onFillProfile(emp, true)}
                                        style={{ width: '100%', padding: '7px 0', background: 'transparent', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-muted)', fontSize: 11, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit' }}
                                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(79,142,247,0.4)'; e.currentTarget.style.color = 'var(--accent)' }}
                                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' }}
                                    >✏️ Update Name</button>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
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
                </div>
            </div>
        </>
    )
}