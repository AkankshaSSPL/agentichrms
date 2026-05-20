/**
 * ProfileView.jsx — Read-only profile display + AI chat editing
 * No manual forms. All edits go through the onboarding chat agent.
 * Fully theme‑aware with polished modal styling.
 */
import { useState, useEffect, useRef } from 'react'

const API = import.meta.env.VITE_API_URL || 'http://localhost:8000'

function fmtDate(val) {
    if (!val) return ''
    try {
        const d = new Date(val)
        if (isNaN(d.getTime())) return val
        return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    } catch { return val }
}

// ── Sweet Alert ────────────────────────────────────────────────────────────────
function Alert({ type, message, onClose }) {
    useEffect(() => { const t = setTimeout(onClose, 4000); return () => clearTimeout(t) }, [])
    const C = {
        success: { bg: 'var(--green-dim)', border: 'var(--green)', color: 'var(--green)', icon: '✅' },
        error: { bg: 'var(--red-dim)', border: 'var(--red)', color: 'var(--red)', icon: '❌' },
        info: { bg: 'var(--accent-dim)', border: 'var(--accent)', color: 'var(--accent)', icon: 'ℹ️' },
    }
    const c = C[type] || C.info
    return (
        <div style={{
            position: 'fixed', top: 24, right: 24, zIndex: 99999,
            background: c.bg, border: `1px solid ${c.border}`,
            borderRadius: 14, padding: '14px 20px',
            display: 'flex', alignItems: 'center', gap: 12,
            backdropFilter: 'blur(16px)', boxShadow: '0 8px 32px rgba(0,0,0,.5)',
            animation: 'slideIn .3s cubic-bezier(.2,.8,.3,1)',
            maxWidth: 360, minWidth: 260,
        }}>
            <span style={{ fontSize: 20 }}>{c.icon}</span>
            <span style={{ fontSize: 13, color: c.color, fontWeight: 500, flex: 1 }}>{message}</span>
            <button onClick={onClose} style={{ background: 'transparent', border: 'none', color: c.color, fontSize: 16, cursor: 'pointer', padding: 0 }}>✕</button>
        </div>
    )
}

// ── Completion ring ───────────────────────────────────────────────────────────
function CompletionRing({ pct }) {
    const r = 28, circ = 2 * Math.PI * r
    const trackColor = pct === 100 ? 'var(--green)' : 'var(--accent)'
    return (
        <div style={{ position: 'relative', width: 72, height: 72, flexShrink: 0 }}>
            <svg width="72" height="72" style={{ transform: 'rotate(-90deg)' }}>
                <circle cx="36" cy="36" r={r} fill="none" stroke="var(--border)" strokeWidth="5" />
                <circle cx="36" cy="36" r={r} fill="none"
                    stroke={trackColor} strokeWidth="5"
                    strokeDasharray={`${(pct / 100) * circ} ${circ}`} strokeLinecap="round"
                    style={{ transition: 'stroke-dasharray .6s ease' }} />
            </svg>
            <div style={{
                position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 13, fontWeight: 700, color: trackColor,
            }}>{pct}%</div>
        </div>
    )
}

// ── Read-only Field ────────────────────────────────────────────────────────────
function Field({ label, value, isDate = false }) {
    const display = isDate ? (fmtDate(value) || '—') : (value || '—')
    const isEmpty = !value
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <div style={{ fontSize: 9, textTransform: 'uppercase', letterSpacing: '1px', color: 'var(--text-muted)', fontWeight: 700 }}>{label}</div>
            <div style={{
                fontSize: 13, background: 'var(--bg-input)', padding: '9px 13px', borderRadius: 9,
                border: '1px solid var(--border)', minHeight: 38,
                display: 'flex', alignItems: 'center', wordBreak: 'break-word',
                color: isEmpty ? 'var(--text-muted)' : 'var(--text-primary)', fontStyle: isEmpty ? 'italic' : 'normal',
            }}>{display}</div>
        </div>
    )
}

// ── Read-only Card ─────────────────────────────────────────────────────────────
function Card({ title, children }) {
    return (
        <div style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 16, overflow: 'hidden', backdropFilter: 'blur(12px)',
            transition: 'box-shadow 0.2s ease, transform 0.2s ease',
        }}>
            <div style={{
                display: 'flex', alignItems: 'center', padding: '14px 18px',
                borderBottom: '1px solid var(--border)',
            }}>
                <span style={{ fontSize: 13, fontWeight: 700, color: 'var(--accent)' }}>{title}</span>
            </div>
            <div style={{ padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 }}>
                {children}
            </div>
        </div>
    )
}

// ── Profile Edit Chat Modal (improved styling) ────────────────────────────────
function ProfileEditChat({ token, onClose, onSaved }) {
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [history, setHistory] = useState([])
    const endRef = useRef(null)

    // Greet on open
    useEffect(() => {
        const greet = async () => {
            setLoading(true)
            try {
                const res = await fetch(`${API}/api/onboarding-profile/chat`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ message: 'Hello, I want to update my profile.', history: [] }),
                })
                const data = await res.json()
                const botMsg = { role: 'assistant', content: data.reply }
                setMessages([botMsg])
                setHistory([{ role: 'assistant', content: data.reply }])
                if (data.profile_complete) { if (onSaved) onSaved(); onClose() }
            } catch { setMessages([{ role: 'assistant', content: "Hi! I'm here to help you update your profile. What would you like to change?" }]) }
            finally { setLoading(false) }
        }
        greet()
    }, [])

    useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

    const send = async () => {
        const text = input.trim()
        if (!text || loading) return
        setInput('')
        const userMsg = { role: 'user', content: text }
        const newHistory = [...history, { role: 'user', content: text }]
        setMessages(prev => [...prev, userMsg])
        setHistory(newHistory)
        setLoading(true)
        try {
            const res = await fetch(`${API}/api/onboarding-profile/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ message: text, history: newHistory }),
            })
            const data = await res.json()
            const botMsg = { role: 'assistant', content: data.reply }
            setMessages(prev => [...prev, botMsg])
            setHistory(h => [...h, { role: 'assistant', content: data.reply }])
            if (data.profile_complete) {
                setTimeout(() => { if (onSaved) onSaved(); onClose() }, 1800)
            }
        } catch {
            setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }])
        } finally { setLoading(false) }
    }

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 99998,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'fadeIn 0.2s ease',
        }}>
            <div style={{
                background: 'var(--bg-secondary)',
                border: '1px solid var(--border)',
                borderRadius: 24,
                width: '92%',
                maxWidth: 520,
                height: '78vh',
                display: 'flex',
                flexDirection: 'column',
                boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
                overflow: 'hidden',
                animation: 'scaleIn 0.2s ease',
            }}>
                {/* Header */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '18px 20px',
                    borderBottom: '1px solid var(--border)',
                    background: 'var(--bg-card)',
                }}>
                    <div>
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Edit Profile</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            Chat with AI assistant to update your details
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            background: 'transparent',
                            border: 'none',
                            fontSize: 20,
                            cursor: 'pointer',
                            color: 'var(--text-muted)',
                            padding: '4px 8px',
                            borderRadius: 8,
                            transition: 'all 0.2s',
                        }}
                        onMouseEnter={e => e.currentTarget.style.background = 'var(--accent-dim)'}
                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >✕</button>
                </div>

                {/* Messages */}
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '20px',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 16,
                    background: 'var(--bg-primary)',
                }}>
                    {messages.map((m, i) => (
                        <div
                            key={i}
                            style={{
                                display: 'flex',
                                justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start',
                                animation: 'fadeSlideUp 0.2s ease',
                            }}
                        >
                            <div style={{
                                maxWidth: '80%',
                                padding: '10px 16px',
                                borderRadius: m.role === 'user'
                                    ? '18px 18px 4px 18px'
                                    : '18px 18px 18px 4px',
                                background: m.role === 'user'
                                    ? 'linear-gradient(135deg, var(--accent), #7c3aed)'
                                    : 'var(--bg-card)',
                                border: m.role === 'user' ? 'none' : '1px solid var(--border)',
                                fontSize: 13,
                                lineHeight: 1.5,
                                color: m.role === 'user' ? '#fff' : 'var(--text-primary)',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                boxShadow: '0 1px 2px rgba(0,0,0,0.05)',
                            }}>
                                {m.content}
                            </div>
                        </div>
                    ))}
                    {loading && (
                        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                            <div style={{
                                padding: '10px 16px',
                                borderRadius: '18px',
                                background: 'var(--bg-card)',
                                border: '1px solid var(--border)',
                                display: 'flex',
                                gap: 6,
                                alignItems: 'center',
                            }}>
                                {[0, 1, 2].map(i => (
                                    <span key={i} style={{
                                        width: 8,
                                        height: 8,
                                        borderRadius: '50%',
                                        background: 'var(--accent)',
                                        animation: `bounce 0.9s ease-in-out ${i * 0.2}s infinite`,
                                        display: 'inline-block',
                                    }} />
                                ))}
                            </div>
                        </div>
                    )}
                    <div ref={endRef} />
                </div>

                {/* Input */}
                <div style={{
                    padding: '16px 20px',
                    borderTop: '1px solid var(--border)',
                    background: 'var(--bg-card)',
                }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                        <textarea
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } }}
                            placeholder="Type your update… (Enter to send)"
                            rows={1}
                            style={{
                                flex: 1,
                                background: 'var(--bg-input)',
                                border: '1px solid var(--border)',
                                borderRadius: 12,
                                padding: '10px 14px',
                                color: 'var(--text-primary)',
                                fontSize: 13,
                                resize: 'none',
                                outline: 'none',
                                fontFamily: 'inherit',
                                lineHeight: 1.5,
                                maxHeight: 100,
                                overflowY: 'auto',
                                transition: 'border-color 0.2s',
                            }}
                            onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                            onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
                        />
                        <button
                            onClick={send}
                            disabled={loading || !input.trim()}
                            style={{
                                background: 'linear-gradient(135deg, var(--accent), #7c3aed)',
                                border: 'none',
                                borderRadius: 12,
                                padding: '10px 20px',
                                color: '#fff',
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: loading || !input.trim() ? 'not-allowed' : 'pointer',
                                opacity: loading || !input.trim() ? 0.5 : 1,
                                transition: 'opacity 0.2s, transform 0.1s',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            Send
                        </button>
                    </div>
                </div>
            </div>

            <style>{`
                @keyframes fadeIn {
                    from { opacity: 0; }
                    to { opacity: 1; }
                }
                @keyframes scaleIn {
                    from { opacity: 0; transform: scale(0.96); }
                    to { opacity: 1; transform: scale(1); }
                }
                @keyframes fadeSlideUp {
                    from { opacity: 0; transform: translateY(8px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes bounce {
                    0%, 100% { transform: translateY(0); }
                    50% { transform: translateY(-4px); }
                }
            `}</style>
        </div>
    )
}

// ── Main ProfileView ──────────────────────────────────────────────────────────
export default function ProfileView({ employee, token, onBack, onSaved }) {
    const [form, setForm] = useState({})
    const [loading, setLoading] = useState(true)
    const [alert, setAlert] = useState(null)
    const [showChat, setShowChat] = useState(false)

    const showAlert = (type, message) => setAlert({ type, message })

    const loadProfile = () => {
        setLoading(true)
        fetch(`${API}/api/onboarding-profile/me`, {
            headers: { Authorization: `Bearer ${token}` },
        })
            .then(r => r.json())
            .then(data => setForm(data))
            .catch(() => showAlert('error', 'Could not load profile. Please try again.'))
            .finally(() => setLoading(false))
    }

    useEffect(() => { loadProfile() }, [token])

    const completionFields = ['name', 'email', 'phone', 'gender', 'date_of_birth', 'department', 'designation', 'employment_type', 'join_date', 'address_line1', 'city', 'state', 'country', 'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation', 'bank_name', 'account_number', 'bank_branch']
    const filled = completionFields.filter(f => form[f]).length
    const pct = Math.round((filled / completionFields.length) * 100)

    const roleName = employee?.role || form?.role || ''
    const roleLabel = roleName === 'admin' ? 'Administrator' : roleName === 'hr' ? 'HR Manager' : 'Employee'
    const roleColor = roleName === 'admin' ? '#a78bfa' : roleName === 'hr' ? 'var(--accent)' : 'var(--green)'
    const roleBg = roleName === 'admin' ? 'rgba(124,58,237,.15)' : roleName === 'hr' ? 'var(--accent-dim)' : 'var(--green-dim)'

    if (loading) return (
        <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg-primary)' }}>
            <div style={{ textAlign: 'center' }}>
                <div style={{ width: 40, height: 40, border: '3px solid var(--border)', borderTop: '3px solid var(--accent)', borderRadius: '50%', animation: 'spin .8s linear infinite', margin: '0 auto 16px' }} />
                <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Loading profile…</div>
            </div>
        </div>
    )

    return (
        <>
            <style>{`
                @keyframes slideIn { from{opacity:0;transform:translateX(40px)} to{opacity:1;transform:translateX(0)} }
                @keyframes spin { to{transform:rotate(360deg)} }
                @keyframes popIn { from{opacity:0;transform:scale(.94)} to{opacity:1;transform:scale(1)} }
                @keyframes bounce { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-5px)} }
                * { box-sizing: border-box; }
                ::-webkit-scrollbar { width: 5px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: var(--border); border-radius: 4px; }
                @media (max-width: 900px) { .pv-grid { grid-template-columns: 1fr !important; } }
                @media (min-width: 901px) and (max-width: 1200px) { .pv-grid { grid-template-columns: repeat(2,1fr) !important; } }
                @media (min-width: 1201px) { .pv-grid { grid-template-columns: repeat(3,1fr) !important; } }
            `}</style>

            {alert && <Alert {...alert} onClose={() => setAlert(null)} />}
            {showChat && (
                <ProfileEditChat
                    token={token}
                    onClose={() => setShowChat(false)}
                    onSaved={() => {
                        setShowChat(false)
                        loadProfile()
                        showAlert('success', 'Profile updated successfully!')
                        if (onSaved) onSaved(form)
                    }}
                />
            )}

            <div style={{ width: '100%', height: '100%', overflowY: 'auto', overflowX: 'hidden', background: 'var(--bg-primary)', fontFamily: "'Sora',sans-serif", position: 'relative' }}>
                {/* Background glow */}
                <div style={{ position: 'fixed', width: 700, height: 700, borderRadius: '50%', background: 'radial-gradient(circle,var(--accent-glow) 0%,transparent 65%)', top: -200, left: -150, pointerEvents: 'none', zIndex: 0 }} />
                <div style={{ position: 'fixed', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle,rgba(124,58,237,.05) 0%,transparent 65%)', bottom: -100, right: -100, pointerEvents: 'none', zIndex: 0 }} />

                <div style={{ position: 'relative', zIndex: 1, width: '100%', padding: '20px 20px 80px' }} className="pv-inner">

                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
                        <button
                            onClick={onBack}
                            style={{ background: 'var(--accent-dim)', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 18px', color: 'var(--accent)', fontSize: 13, cursor: 'pointer', transition: 'all .2s', fontFamily: 'inherit' }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-dim)' }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent-dim)' }}
                        >← Back</button>

                        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-.5px' }}>My Profile</h1>

                        <button
                            onClick={() => setShowChat(true)}
                            style={{
                                background: 'linear-gradient(135deg,var(--accent-dim),rgba(124,58,237,.15))',
                                border: '1px solid rgba(79,142,247,.3)',
                                borderRadius: 10,
                                padding: '9px 20px',
                                color: 'var(--accent)',
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: 'pointer',
                                transition: 'all .2s',
                                fontFamily: 'inherit',
                                display: 'flex',
                                alignItems: 'center',
                                gap: 8,
                            }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'linear-gradient(135deg,var(--accent-dim),rgba(124,58,237,.25))'; e.currentTarget.style.transform = 'translateY(-1px)' }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'linear-gradient(135deg,var(--accent-dim),rgba(124,58,237,.15))'; e.currentTarget.style.transform = 'none' }}
                        >
                            Edit via Chat
                        </button>
                    </div>

                    {/* Hero card */}
                    <div style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24,
                        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 20, padding: '20px 24px',
                        marginBottom: 28, backdropFilter: 'blur(20px)',
                        boxShadow: '0 8px 40px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.04)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flex: 1, minWidth: 0 }}>
                            <div style={{ width: 72, height: 72, borderRadius: '50%', flexShrink: 0, background: 'conic-gradient(var(--accent),#7c3aed,var(--green),var(--accent))', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 2.5 }}>
                                <div style={{ width: 67, height: 67, borderRadius: '50%', background: 'linear-gradient(135deg,var(--accent),#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 800, color: '#fff' }}>
                                    {(form.name || employee?.name || '?')[0].toUpperCase()}
                                </div>
                            </div>
                            <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-.3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{form.name || employee?.name}</div>
                                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{form.designation || form.department || ''}</div>
                                <div style={{ marginTop: 8 }}>
                                    <span style={{ background: roleBg, color: roleColor, border: `1px solid ${roleColor}40`, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{roleLabel}</span>
                                </div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                            <CompletionRing pct={pct} />
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>Profile<br />Complete</div>
                        </div>
                    </div>

                    {/* Cards grid */}
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: 14, width: '100%' }} className="pv-grid">

                        <Card title="Basic Information">
                            <Field label="Full Name" value={form.name} />
                            <Field label="Email" value={form.email} />
                            <Field label="Phone" value={form.phone} />
                            <Field label="Gender" value={form.gender} />
                            <Field label="Date of Birth" value={form.date_of_birth} isDate />
                        </Card>

                        <Card title="Employment Details">
                            <Field label="Department" value={form.department} />
                            <Field label="Designation" value={form.designation} />
                            <Field label="Employment Type" value={form.employment_type} />
                            <Field label="Date of Joining" value={form.join_date} isDate />
                        </Card>

                        <Card title="Address">
                            <Field label="Address Line 1" value={form.address_line1} />
                            <Field label="Address Line 2" value={form.address_line2} />
                            <Field label="City" value={form.city} />
                            <Field label="State / Province" value={form.state} />
                            <Field label="Country" value={form.country} />
                        </Card>

                        <Card title="Emergency Contact">
                            <Field label="Contact Name" value={form.emergency_contact_name} />
                            <Field label="Phone Number" value={form.emergency_contact_phone} />
                            <Field label="Relation" value={form.emergency_contact_relation} />
                        </Card>

                        <Card title="Banking Information">
                            <Field label="Bank Name" value={form.bank_name} />
                            <Field label="Account Holder" value={form.account_holder_name} />
                            <Field label="Account Number" value={form.account_number} />
                            <Field label="Branch" value={form.bank_branch} />
                            <Field label="Base Salary (₹)" value={form.base_salary} />
                        </Card>

                    </div>
                </div>
            </div>
        </>
    )
}