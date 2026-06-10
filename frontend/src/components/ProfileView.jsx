/**
 * ProfileView.jsx — Read-only profile display + AI chat editing
 * Now includes resume upload in the edit chat modal.
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

// ── Profile Edit Chat Modal (with resume upload step) ─────────────────────────
function ProfileEditChat({ token, onClose, onSaved }) {
    const [step, setStep] = useState('mode')     // 'mode', 'upload', 'chat'
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [sessionId, setSessionId] = useState(null)
    const [resumeFile, setResumeFile] = useState(null)
    const [uploading, setUploading] = useState(false)
    const [extractedData, setExtractedData] = useState(null)
    const [toast, setToast] = useState(null)
    const endRef = useRef(null)
    const fileRef = useRef(null)
    const inputRef = useRef(null)
    const chatInitialized = useRef(false)

    const showToast = (type, message) => {
        setToast({ type, message })
        setTimeout(() => setToast(null), 4000)
    }

    const handleResumeUpload = async (file) => {
        if (!file) return
        setUploading(true)
        setResumeFile(file)

        const reader = new FileReader()
        reader.onload = async (e) => {
            const base64 = e.target.result.split(',')[1]
            try {
                const res = await fetch(`${API}/api/onboarding-profile/resume-extract`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ pdf_base64: base64 })
                })
                const data = await res.json()
                if (!res.ok) throw new Error(data.detail || 'Extraction failed')
                setExtractedData(data)
                showToast('success', `Extracted ${data.extracted?.length || 0} fields from resume`)
                setStep('chat')
            } catch (err) {
                console.error(err)
                showToast('error', err.message || 'Failed to process resume')
                setStep('mode')
            } finally {
                setUploading(false)
            }
        }
        reader.readAsDataURL(file)
    }

    // Chat initialisation – runs only once when step becomes 'chat'
    useEffect(() => {
        if (step !== 'chat') return
        if (chatInitialized.current) return
        chatInitialized.current = true

        const initChat = async () => {
            setLoading(true)
            try {
                const sessRes = await fetch(`${API}/api/chat/sessions`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                })
                const sessData = await sessRes.json()
                const sid = sessData.id
                setSessionId(sid)

                let initialMessage = ''
                if (extractedData?.extracted?.length > 0 || extractedData?.missing?.length > 0) {
                    const extractedList = extractedData.extracted.map(f => `• ${f}`).join('\n')
                    const missingList = extractedData.missing.map(f => `• ${f}`).join('\n')
                    initialMessage = `I uploaded my resume. Here's what I found:\n${extractedList}\n\nPlease help me fill the missing fields:\n${missingList}\n\nFor fields that need HR approval, please create approval requests. Let's start with the first missing field.`
                } else {
                    initialMessage = 'Hello, I want to update my personal details.'
                }

                const res = await fetch(`${API}/api/chat/`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body: JSON.stringify({ message: initialMessage, session_id: sid })
                })
                const data = await res.json()
                setMessages([{ role: 'assistant', content: data.answer }])
            } catch (err) {
                console.error(err)
                setMessages([{ role: 'assistant', content: "Let's update your profile. What would you like to change?" }])
            } finally {
                setLoading(false)
                inputRef.current?.focus()
            }
        }
        initChat()
    }, [step, token])   // extractedData intentionally omitted

    useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

    const send = async (textOverride) => {
        const text = textOverride !== undefined ? textOverride : input.trim()
        if (!text || loading) return
        setInput('')
        setMessages(prev => [...prev, { role: 'user', content: text }])
        setLoading(true)

        try {
            const res = await fetch(`${API}/api/chat/`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ message: text, session_id: sessionId })
            })
            const data = await res.json()
            setMessages(prev => [...prev, { role: 'assistant', content: data.answer }])
        } catch {
            setMessages(prev => [...prev, { role: 'assistant', content: 'Something went wrong. Please try again.' }])
        } finally {
            setLoading(false)
            inputRef.current?.focus()
        }
    }

    const handleSend = () => send()
    const handleKey = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
    }

    const handleClose = () => {
        onSaved?.()
        onClose()
    }

    // Mode selection UI
    if (step === 'mode') {
        return (
            <div style={{
                position: 'fixed', inset: 0, zIndex: 99998,
                background: 'rgba(0,0,0,0.6)',
                backdropFilter: 'blur(8px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
                <div style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: 24,
                    width: '92%',
                    maxWidth: 420,
                    padding: '32px 24px',
                    textAlign: 'center',
                    boxShadow: '0 24px 48px rgba(0,0,0,0.4)',
                }}>
                    <h2 style={{ margin: '0 0 8px', fontSize: 22, fontWeight: 700, color: 'var(--text-primary)' }}>Update Profile</h2>
                    <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 32 }}>Choose how you'd like to provide your information</p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
                        <button
                            onClick={() => setStep('upload')}
                            style={{
                                background: 'linear-gradient(135deg, var(--accent-dim), rgba(124,58,237,.1))',
                                border: '1px solid var(--accent)',
                                borderRadius: 16,
                                padding: '18px 20px',
                                fontSize: 16,
                                fontWeight: 600,
                                color: 'var(--accent)',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 12,
                            }}
                        >
                            <span style={{ fontSize: 24 }}></span> Upload Resume (PDF)
                        </button>
                        <button
                            onClick={() => setStep('chat')}
                            style={{
                                background: 'var(--bg-card)',
                                border: '1px solid var(--border)',
                                borderRadius: 16,
                                padding: '18px 20px',
                                fontSize: 16,
                                fontWeight: 600,
                                color: 'var(--text-primary)',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                gap: 12,
                            }}
                        >
                            <span style={{ fontSize: 24 }}></span> Fill by chatting
                        </button>
                        <button
                            onClick={handleClose}
                            style={{
                                marginTop: 8,
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-muted)',
                                fontSize: 13,
                                cursor: 'pointer',
                            }}
                        >
                            Cancel
                        </button>
                    </div>
                </div>
            </div>
        )
    }

    // Upload step
    if (step === 'upload') {
        return (
            <div style={{
                position: 'fixed', inset: 0, zIndex: 99998,
                background: 'rgba(0,0,0,0.6)',
                backdropFilter: 'blur(8px)',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
                <div style={{
                    background: 'var(--bg-secondary)',
                    border: '1px solid var(--border)',
                    borderRadius: 24,
                    width: '92%',
                    maxWidth: 420,
                    padding: '32px 24px',
                    textAlign: 'center',
                }}>
                    <h3 style={{ margin: '0 0 16px', fontSize: 18, fontWeight: 600 }}>Upload your resume</h3>
                    <div
                        style={{
                            border: '2px dashed var(--border)',
                            borderRadius: 20,
                            padding: '40px 20px',
                            marginBottom: 20,
                            cursor: 'pointer',
                        }}
                        onClick={() => fileRef.current?.click()}
                    >
                        <div style={{ fontSize: 40, marginBottom: 12 }}>📎</div>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>
                            {resumeFile ? resumeFile.name : 'Click to select PDF or TXT'}
                        </div>
                    </div>
                    <input ref={fileRef} type="file" accept=".pdf,.txt" style={{ display: 'none' }}
                        onChange={e => handleResumeUpload(e.target.files?.[0])} />
                    {uploading && (
                        <div style={{ marginTop: 12, fontSize: 13, color: 'var(--accent)' }}>
                            Extracting information...
                        </div>
                    )}
                    <button onClick={() => setStep('mode')} style={{
                        marginTop: 16,
                        background: 'transparent',
                        border: 'none',
                        color: 'var(--text-muted)',
                        fontSize: 13,
                        cursor: 'pointer',
                    }}>← Back</button>
                </div>
            </div>
        )
    }

    // Chat UI
    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 99998,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(8px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
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
                        <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>Update Profile</div>
                        {extractedData?.extracted?.length > 0 && (
                            <div style={{ fontSize: 11, color: 'var(--green)', marginTop: 2 }}>
                                ✅ {extractedData.extracted.length} fields auto-filled
                            </div>
                        )}
                    </div>
                    <button onClick={handleClose} style={{ background: 'transparent', border: 'none', fontSize: 20, cursor: 'pointer', color: 'var(--text-muted)' }}>✕</button>
                </div>

                {/* Messages */}
                <div style={{ flex: 1, overflowY: 'auto', padding: '20px', display: 'flex', flexDirection: 'column', gap: 16, background: 'var(--bg-primary)' }}>
                    {messages.map((m, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
                            <div style={{
                                maxWidth: '80%',
                                padding: '10px 16px',
                                borderRadius: m.role === 'user' ? '18px 18px 4px 18px' : '18px 18px 18px 4px',
                                background: m.role === 'user' ? 'linear-gradient(135deg, var(--accent), #7c3aed)' : 'var(--bg-card)',
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
                            <div style={{ padding: '10px 16px', borderRadius: '18px', background: 'var(--bg-card)', display: 'flex', gap: 6 }}>
                                {[0,1,2].map(i => <span key={i} style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--accent)', animation: `bounce 0.9s ease-in-out ${i*0.2}s infinite` }} />)}
                            </div>
                        </div>
                    )}
                    <div ref={endRef} />
                </div>

                {/* Input area */}
                <div style={{ padding: '16px 20px', borderTop: '1px solid var(--border)', background: 'var(--bg-card)' }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                        <textarea
                            ref={inputRef}
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={handleKey}
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
                            }}
                            onFocus={e => e.currentTarget.style.borderColor = 'var(--accent)'}
                            onBlur={e => e.currentTarget.style.borderColor = 'var(--border)'}
                        />
                        <button
                            onClick={handleSend}
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
                                whiteSpace: 'nowrap',
                            }}
                        >
                            Send
                        </button>
                    </div>
                </div>
            </div>

            {toast && (
                <div style={{
                    position: 'fixed', bottom: 24, right: 24, zIndex: 10000,
                    background: toast.type === 'success' ? 'var(--green)' : 'var(--red)',
                    color: '#fff', padding: '12px 20px', borderRadius: 40, fontSize: 13,
                    boxShadow: '0 8px 20px rgba(0,0,0,0.2)',
                }}>
                    {toast.message}
                </div>
            )}

            <style>{`
                @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
                @keyframes scaleIn { from { opacity: 0; transform: scale(0.96); } to { opacity: 1; transform: scale(1); } }
                @keyframes fadeSlideUp { from { opacity: 0; transform: translateY(8px); } to { opacity: 1; transform: translateY(0); } }
                @keyframes bounce { 0%,100% { transform: translateY(0); } 50% { transform: translateY(-4px); } }
                @keyframes toastSlide { from { opacity: 0; transform: translateX(30px); } to { opacity: 1; transform: translateX(0); } }
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

    const completionFields = ['name', 'email', 'phone', 'gender', 'date_of_birth', 'department', 'designation', 'employment_type', 'join_date', 'address_line1', 'city', 'state', 'country', 'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation', 'bank_name', 'bank_account_number', 'bank_branch']
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
                <div style={{ position: 'fixed', width: 700, height: 700, borderRadius: '50%', background: 'radial-gradient(circle,var(--accent-glow) 0%,transparent 65%)', top: -200, left: -150, pointerEvents: 'none', zIndex: 0 }} />
                <div style={{ position: 'fixed', width: 500, height: 500, borderRadius: '50%', background: 'radial-gradient(circle,rgba(124,58,237,.05) 0%,transparent 65%)', bottom: -100, right: -100, pointerEvents: 'none', zIndex: 0 }} />

                <div style={{ position: 'relative', zIndex: 1, width: '100%', padding: '20px 20px 80px' }} className="pv-inner">
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 28 }}>
                        <button onClick={onBack} style={{ background: 'var(--accent-dim)', border: '1px solid var(--border)', borderRadius: 10, padding: '9px 18px', color: 'var(--accent)', fontSize: 13, cursor: 'pointer', transition: 'all .2s', fontFamily: 'inherit' }}
                            onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-dim)' }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent-dim)' }}>← Back</button>
                        <h1 style={{ fontSize: 24, fontWeight: 800, color: 'var(--text-primary)', margin: 0, letterSpacing: '-.5px' }}>My Profile</h1>
                        <button onClick={() => setShowChat(true)} style={{
                            background: 'linear-gradient(135deg,var(--accent-dim),rgba(124,58,237,.15))',
                            border: '1px solid rgba(79,142,247,.3)', borderRadius: 10, padding: '9px 20px',
                            color: 'var(--accent)', fontSize: 13, fontWeight: 600, cursor: 'pointer', transition: 'all .2s',
                            fontFamily: 'inherit', display: 'flex', alignItems: 'center', gap: 8,
                        }}>✏&nbsp;Update</button>
                    </div>

                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24,
                        background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 20, padding: '20px 24px',
                        marginBottom: 28, backdropFilter: 'blur(20px)', boxShadow: '0 8px 40px rgba(0,0,0,.3),inset 0 1px 0 rgba(255,255,255,.04)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 20, flex: 1, minWidth: 0 }}>
                            <div style={{ width: 72, height: 72, borderRadius: '50%', flexShrink: 0, background: 'conic-gradient(var(--accent),#7c3aed,var(--green),var(--accent))', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 2.5 }}>
                                <div style={{ width: 67, height: 67, borderRadius: '50%', background: 'linear-gradient(135deg,var(--accent),#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 26, fontWeight: 800, color: '#fff' }}>
                                    {(form.name || employee?.name || '?')[0].toUpperCase()}
                                </div>
                            </div>
                            <div style={{ minWidth: 0 }}>
                                <div style={{ fontSize: 20, fontWeight: 800, color: 'var(--text-primary)', letterSpacing: '-.3px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{form.name || employee?.name}</div>
                                <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 2 }}>{form.designation || form.department || ''}</div>
                                <div style={{ marginTop: 8 }}><span style={{ background: roleBg, color: roleColor, border: `1px solid ${roleColor}40`, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{roleLabel}</span></div>
                            </div>
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, flexShrink: 0 }}>
                            <CompletionRing pct={pct} />
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center' }}>Profile<br />Complete</div>
                        </div>
                    </div>

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
                            <Field label="Account Number" value={form.bank_account_number} />
                            <Field label="Branch" value={form.bank_branch} />
                            <Field label="Base Salary (₹)" value={form.base_salary} />
                        </Card>
                    </div>
                </div>
            </div>
        </>
    )
}