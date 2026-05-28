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

// ── Helper: extract fields from resume text (same as OnboardingChat) ──────────
function extractFieldsFromText(text) {
    const t = text || ''
    const found = {}

    const emailM = t.match(/[\w.+-]+@[\w.-]+\.\w{2,}/)
    if (emailM) found.email = emailM[0].trim()

    const phoneM = t.match(/(?:\+?\d[\s\-.]?){9,14}\d/)
    if (phoneM) found.phone = phoneM[0].replace(/[\s\-.]/g, '')

    const titleM = t.match(/(?:designation|job title|position|role)[:\s]+([^\n]{3,60})/i)
    if (titleM) found.designation = titleM[1].trim()

    const deptM = t.match(/(?:department|division|team)[:\s]+([^\n]{3,60})/i)
    if (deptM) found.department = deptM[1].trim()

    const joinM = t.match(/(?:joining date|date of joining|start date|joined)[:\s]+([^\n]{4,30})/i)
    if (joinM) found.join_date = joinM[1].trim()

    const nameM = t.match(/(?:name)[:\s]+([^\n]{2,50})/i)
    if (nameM) found.name = nameM[1].trim()

    const genderM = t.match(/\b(male|female|non[\s-]binary|other)\b/i)
    if (genderM) found.gender = genderM[1].charAt(0).toUpperCase() + genderM[1].slice(1).toLowerCase()

    const dobM = t.match(/(?:dob|date of birth|born)[:\s]+(\d{1,2}[\s/\-]\w{2,9}[\s/\-]\d{2,4}|\w+ \d{1,2},? \d{4})/i)
    if (dobM) found.date_of_birth = dobM[1].trim()

    return found
}

// ── Build resume message for AI ──────────────────────────────────────────────
function buildResumeMessage(found, filename) {
    const lines = [`I uploaded my resume (${filename}).`]
    if (Object.keys(found).length > 0) {
        lines.push('\nI found the following details in the resume:')
        const labels = {
            name: 'Name', email: 'Email', phone: 'Phone',
            designation: 'Job title', department: 'Department',
            join_date: 'Date of joining', gender: 'Gender',
            date_of_birth: 'Date of birth',
        }
        Object.entries(found).forEach(([k, v]) => {
            lines.push(`- ${labels[k] || k}: ${v}`)
        })
        lines.push('\nPlease use these to pre-fill my profile and only ask for the fields that are still missing.')
    } else {
        lines.push('The text could be extracted but no specific fields were found. Please ask me the questions to fill in my profile.')
    }
    return lines.join('\n')
}

// ── Profile Edit Chat Modal (fixed resume upload) ─────────────────────────────
function ProfileEditChat({ token, onClose, onSaved }) {
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [history, setHistory] = useState([])
    const [resumeFile, setResumeFile] = useState(null)
    const [resumeText, setResumeText] = useState(null)
    const [toast, setToast] = useState(null)
    const endRef = useRef(null)
    const fileRef = useRef(null)
    const inputRef = useRef(null)

    const showToast = (type, message) => {
        setToast({ type, message })
        setTimeout(() => setToast(null), 4000)
    }

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

    // Main send function
    const send = async (textOverride, resumeOverride = null) => {
        const text = textOverride !== undefined ? textOverride : input.trim()
        if (!text || loading) return
        setInput('')
        const userMsg = { role: 'user', content: text }
        const newHistory = [...history, userMsg]
        if (!textOverride) setMessages(prev => [...prev, userMsg])
        setHistory(newHistory)
        setLoading(true)

        try {
            const res = await fetch(`${API}/api/onboarding-profile/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    message: text,
                    history: newHistory,
                    resume_text: resumeOverride !== null ? resumeOverride : resumeText,
                }),
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
        } finally {
            setLoading(false)
            inputRef.current?.focus()
        }
    }

    // Resume upload handler (now calls 'send' correctly)
    const handleResumeUpload = async (file) => {
        if (!file) return
        setResumeFile(file)
        setMessages(prev => [...prev, { role: 'user', content: `📎 Uploaded: ${file.name}` }])

        const readFile = (asText = false) => new Promise((res, rej) => {
            const reader = new FileReader()
            reader.onload  = e => res(e.target.result)
            reader.onerror = rej
            asText ? reader.readAsText(file) : reader.readAsDataURL(file)
        })

        const isPdf = file.name.toLowerCase().endsWith('.pdf')

        try {
            let rawText = ''
            if (isPdf) {
                const dataUrl = await readFile(false)
                const base64  = dataUrl.split(',')[1]
                const res = await fetch(`${API}/api/onboarding-profile/extract-resume`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body:    JSON.stringify({ pdf_base64: base64, filename: file.name }),
                })
                const data = await res.json()
                rawText = data.text || ''
            } else {
                const full = await readFile(true)
                rawText = (typeof full === 'string' ? full : '').slice(0, 8000)
            }

            setResumeText(rawText)

            if (!rawText.trim()) {
                showToast('error', 'Could not read file text. Please type your details.')
                send("I uploaded my resume but couldn't extract text. Please ask me the questions.", null)
                return
            }

            const found = extractFieldsFromText(rawText)
            const message = buildResumeMessage(found, file.name)

            const foundCount = Object.keys(found).length
            if (foundCount > 0) {
                const summary = Object.entries(found)
                    .map(([k, v]) => `• ${k.replace(/_/g,' ')}: ${v}`)
                    .join('\n')
                setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: `I found ${foundCount} field${foundCount > 1 ? 's' : ''} in your resume:\n${summary}\n\nLet me ask for the rest…`,
                }])
            }

            send(message, rawText)
        } catch (err) {
            console.error('Resume upload error:', err)
            showToast('error', 'Upload failed. Please type your details.')
            send("My resume upload failed. Please ask me the questions.", null)
        }
    }

    const handleSend = () => send()
    const handleKey = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            handleSend()
        }
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

                {/* Input area with attach button */}
                <div style={{
                    padding: '16px 20px',
                    borderTop: '1px solid var(--border)',
                    background: 'var(--bg-card)',
                }}>
                    <div style={{ display: 'flex', gap: 12, alignItems: 'flex-end' }}>
                        <button
                            onClick={() => fileRef.current?.click()}
                            style={{
                                background: 'transparent',
                                border: '1px solid var(--border)',
                                borderRadius: 12,
                                width: 40,
                                height: 40,
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                cursor: 'pointer',
                                fontSize: 18,
                                color: 'var(--text-muted)',
                                transition: 'all 0.2s',
                            }}
                            title="Upload resume (PDF or TXT)"
                        >
                            📎
                        </button>
                        <input
                            ref={fileRef}
                            type="file"
                            accept=".pdf,.txt"
                            style={{ display: 'none' }}
                            onChange={e => handleResumeUpload(e.target.files?.[0])}
                        />
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
                                transition: 'border-color 0.2s',
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
                                transition: 'opacity 0.2s, transform 0.1s',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            Send
                        </button>
                    </div>
                    {resumeFile && (
                        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                            📄 {resumeFile.name} · <span style={{ color: 'var(--green)' }}>ready</span>
                        </div>
                    )}
                </div>
            </div>

            {toast && (
                <div style={{
                    position: 'fixed', bottom: 24, right: 24, zIndex: 10000,
                    display: 'flex', alignItems: 'center', gap: 12,
                    background: toast.type === 'success' ? 'var(--green)' : 'var(--red)',
                    color: '#fff', padding: '12px 20px', borderRadius: 40,
                    fontSize: 13, fontWeight: 500, boxShadow: '0 8px 20px rgba(0,0,0,0.2)',
                    animation: 'toastSlide 0.3s ease', backdropFilter: 'blur(8px)',
                }}>
                    <span>{toast.type === 'success' ? '✓' : '⚠'}</span>
                    <span>{toast.message}</span>
                </div>
            )}

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
                @keyframes toastSlide {
                    from { opacity: 0; transform: translateX(30px); }
                    to { opacity: 1; transform: translateX(0); }
                }
            `}</style>
        </div>
    )
}

// ── Main ProfileView (unchanged) ──────────────────────────────────────────
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
                        }}>Edit via Chat</button>
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