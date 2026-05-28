/**
 * HRPanel.jsx
 * HR-only dashboard — 3 tabs:
 *  1. Employee Directory  — all employees, profile completion, click to fill via chat
 *  2. Leave Approvals     — reuses existing LeaveRequests component
 *  3. Name Change Requests — full list with approve/reject/request‑document actions
 * 
 * The "Fill Profile via Chat" modal now supports resume upload.
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

// ── Resume extraction helpers (same as OnboardingChat) ─────────────────────
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

/* ── Onboarding Chat Modal (HR fills on behalf of employee) with resume upload ── */
function OnboardingChatModal({ employee, token, onClose, onDone, nameChange = false }) {
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [history, setHistory] = useState([])
    const [pendingNameChange, setPendingNameChange] = useState(null)
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

    useEffect(() => {
        if (nameChange) {
            const greet = `I need to update the name for **${employee.name}**.\n\nWhat is the new legal name?`
            setMessages([{ role: 'assistant', content: greet }])
            setHistory([{ role: 'assistant', content: greet }])
        } else {
            const greetAsync = async () => {
                setLoading(true)
                const greetMsg = `I am HR and I want to fill the onboarding profile for ${employee.name}. Please guide me through the missing fields.`
                try {
                    const res = await fetch(`${API}/onboarding-profile/chat-for`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify({ employee_id: employee.id, message: greetMsg, history: [] }),
                    })
                    const data = await res.json()
                    const bot = { role: 'assistant', content: data.reply }
                    setMessages([bot])
                    setHistory([bot])
                    if (data.profile_complete) { onDone?.(); onClose() }
                } catch {
                    setMessages([{ role: 'assistant', content: `Let's fill in ${employee.name}'s profile. What department and job title should I record?` }])
                } finally { setLoading(false) }
            }
            greetAsync()
        }
    }, [])

    useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages])

    const send = async (textOverride, resumeOverride = null) => {
        const text = textOverride !== undefined ? textOverride : input.trim()
        if (!text || loading) return
        setInput('')
        const userMsg = { role: 'user', content: text }
        const newHist = [...history, userMsg]
        if (!textOverride) setMessages(p => [...p, userMsg])
        setHistory(newHist)

        if (nameChange) {
            if (!pendingNameChange) {
                const newName = text.trim()
                setPendingNameChange({ new_name: newName })
                const ask = { role: 'assistant', content: `Got it — changing to **${newName}**.\n\nWhat's the reason? (e.g. marriage, legal name change, correction)` }
                setMessages(p => [...p, ask])
                setHistory(h => [...h, ask])
            } else if (!pendingNameChange.reason) {
                const finalData = { ...pendingNameChange, reason: text.trim() }
                setPendingNameChange(finalData)
                setLoading(true)
                try {
                    const res = await fetch(`${API}/name-change/request-for`, {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                        body: JSON.stringify({
                            employee_id: employee.id,
                            new_name: finalData.new_name,
                            reason: finalData.reason,
                        }),
                    })
                    const data = await res.json()
                    if (res.ok) {
                        const confirm = { role: 'assistant', content: `✅ Name change request submitted!\n\n**${employee.name}** → **${finalData.new_name}**\nReason: ${finalData.reason}\n\nThis is now visible in the Name Change Requests tab for HR to approve.` }
                        setMessages(p => [...p, confirm])
                        setHistory(h => [...h, confirm])
                        setTimeout(() => { onDone?.(); onClose() }, 2000)
                    } else {
                        const err = { role: 'assistant', content: `❌ Failed: ${data.detail || 'Could not submit request.'}` }
                        setMessages(p => [...p, err])
                    }
                } catch (e) {
                    setMessages(p => [...p, { role: 'assistant', content: `❌ Error: ${e.message}` }])
                } finally { setLoading(false) }
            }
            return
        }

        // Profile fill — use onboarding chat API
        setLoading(true)
        try {
            const res = await fetch(`${API}/onboarding-profile/chat-for`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    employee_id: employee.id,
                    message: text,
                    history: newHist,
                    resume_text: resumeOverride !== null ? resumeOverride : resumeText,
                }),
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
                const res = await fetch(`${API}/onboarding-profile/extract-resume`, {
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

    const handleKey = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            send()
        }
    }

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(6px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <div style={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)', borderRadius: 20, width: '92%', maxWidth: 520, height: '78vh', display: 'flex', flexDirection: 'column', boxShadow: '0 24px 80px rgba(0,0,0,0.6)', animation: 'hrPopIn 0.2s ease' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
                    <div>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>{nameChange ? ' Name Update — ' : ' Fill Profile — '}{employee.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>{nameChange ? 'Update legal name — provide new name, reason, and supporting context' : 'Answer the assistant\'s questions to complete the profile'}</div>
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
                    <button
                        onClick={() => fileRef.current?.click()}
                        style={{
                            background: 'transparent',
                            border: '1px solid var(--border)',
                            borderRadius: 10,
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
                    >📎</button>
                    <input ref={fileRef} type="file" accept=".pdf,.txt" style={{ display: 'none' }} onChange={e => handleResumeUpload(e.target.files?.[0])} />
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKey}
                        placeholder="Type your answer… (Enter to send)"
                        rows={1}
                        style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', color: 'var(--text-primary)', fontSize: 13, resize: 'none', outline: 'none', fontFamily: 'inherit', lineHeight: 1.5, maxHeight: 100, overflowY: 'auto', transition: 'border-color 0.15s' }}
                        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                        onBlur={e => e.target.style.borderColor = 'var(--border)'}
                    />
                    <button onClick={() => send()} disabled={loading || !input.trim()} style={{ background: 'var(--accent)', border: 'none', borderRadius: 10, padding: '10px 18px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: loading || !input.trim() ? 'not-allowed' : 'pointer', opacity: loading || !input.trim() ? 0.5 : 1, transition: 'opacity 0.15s', whiteSpace: 'nowrap' }}>Send</button>
                </div>
                {resumeFile && (
                    <div style={{ marginTop: 8, marginBottom: 8, paddingLeft: 16, fontSize: 11, color: 'var(--text-muted)' }}>
                        📄 {resumeFile.name} · <span style={{ color: 'var(--green)' }}>ready</span>
                    </div>
                )}
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
        </div>
    )
}

/* ── Employee Directory Tab (unchanged) ──────────────────────────────────── */
function EmployeeDirectory({ token, onFillProfile, onAlert }) {
    const [employees, setEmployees] = useState([])
    const [loading, setLoading] = useState(true)
    const [search, setSearch] = useState('')

    const COMPLETION_FIELDS = ['gender', 'date_of_birth', 'department', 'designation', 'employment_type', 'join_date', 'address_line1', 'city', 'state', 'country', 'emergency_contact_name', 'emergency_contact_phone', 'emergency_contact_relation', 'bank_name', 'account_number', 'bank_branch']

    const fetchEmployees = useCallback(async () => {
        try {
            const res = await fetch(`${API}/admin/employees`, { headers: { Authorization: `Bearer ${token}` } })
            if (!res.ok) throw new Error(`Error ${res.status}`)
            const data = await res.json()
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 24 }}>
                <div style={{ flex: 1, position: 'relative' }}>
                    <input value={search} onChange={e => setSearch(e.target.value)}
                        placeholder="Search by name, email or department…"
                        style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 10, padding: '10px 14px', color: 'var(--text-primary)', fontSize: 13, outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box', transition: 'border-color 0.15s' }}
                        onFocus={e => e.target.style.borderColor = 'var(--accent)'}
                        onBlur={e => e.target.style.borderColor = 'var(--border)'}
                    />
                </div>
                <span style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{filtered.length} employees</span>
            </div>
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
                                <button onClick={() => onFillProfile(emp, false)} style={{ width: '100%', padding: '8px 0', background: 'var(--accent-dim)', border: '1px solid rgba(79,142,247,0.35)', borderRadius: 10, color: 'var(--accent)', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit' }}
                                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(79,142,247,0.2)' }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent-dim)' }}> Fill Profile via Chat</button>
                            )}
                            {!incomplete && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    <div style={{ textAlign: 'center', fontSize: 12, color: '#34d399', fontWeight: 600 }}>✅ Profile Complete</div>
                                    <button onClick={() => onFillProfile(emp, true)} style={{ width: '100%', padding: '7px 0', background: 'transparent', border: '1px solid var(--border)', borderRadius: 10, color: 'var(--text-muted)', fontSize: 11, fontWeight: 500, cursor: 'pointer', transition: 'all 0.15s', fontFamily: 'inherit' }}
                                        onMouseEnter={e => { e.currentTarget.style.borderColor = 'rgba(79,142,247,0.4)'; e.currentTarget.style.color = 'var(--accent)' }}
                                        onMouseLeave={e => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' }}>✏️ Update Name</button>
                                </div>
                            )}
                        </div>
                    )
                })}
            </div>
        </div>
    )
}

/* ── Name Change Requests Tab (unchanged) ────────────────────────────────── */
function NameChangeRequests({ token, onAlert }) {
    const [requests, setRequests] = useState([])
    const [loading, setLoading] = useState(true)
    const [filter, setFilter] = useState('pending')
    const [actionLoading, setActionLoading] = useState(null)
    const [noteModal, setNoteModal] = useState(null)
    const [noteText, setNoteText] = useState('')

    const fetchRequests = useCallback(async () => {
        try {
            const t = token || localStorage.getItem('hrms_token') || ''
            const res = await fetch(`/api/name-change/requests`, {
                headers: { Authorization: `Bearer ${t}` }
            })
            if (!res.ok) throw new Error(`Server ${res.status}`)
            const data = await res.json()
            setRequests(data)
        } catch (e) {
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
        <button onClick={onClick} disabled={disabled} style={{ padding: '5px 12px', borderRadius: 7, border: `1px solid ${color}50`, background: `${color}15`, color, fontSize: 11, fontWeight: 500, cursor: disabled ? 'not-allowed' : 'pointer', opacity: disabled ? 0.5 : 1, fontFamily: 'inherit', transition: 'all 0.15s' }}
            onMouseEnter={e => { if (!disabled) e.currentTarget.style.background = `${color}28` }}
            onMouseLeave={e => { e.currentTarget.style.background = `${color}15` }}>{label}</button>
    )

    const pendingCount = requests.filter(r => r.status === 'pending').length
    const awaitingCount = requests.filter(r => r.status === 'awaiting_document').length

    return (
        <div>
            {noteModal && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, padding: 28, maxWidth: 400, width: '90%', boxShadow: '0 24px 64px rgba(0,0,0,0.4)' }}>
                        <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 6 }}>
                            {noteModal.action === 'approve' ? '✅ Approve Request' : noteModal.action === 'reject' ? '❌ Reject Request' : '📎 Request Document'}
                        </div>
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 14 }}>Add an optional note for the employee (optional)</div>
                        <textarea value={noteText} onChange={e => setNoteText(e.target.value)} placeholder="e.g. Please also submit updated ID proof…" rows={3}
                            style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 12px', color: 'var(--text-primary)', fontSize: 12, resize: 'none', outline: 'none', fontFamily: 'inherit', boxSizing: 'border-box' }} />
                        <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
                            <button onClick={() => { setNoteModal(null); setNoteText('') }} style={{ padding: '7px 16px', borderRadius: 7, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 12, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
                            <button onClick={() => doAction(noteModal.id, noteModal.action, noteText)} disabled={!!actionLoading} style={{ padding: '7px 18px', borderRadius: 7, border: 'none', background: noteModal.action === 'approve' ? '#059669' : noteModal.action === 'reject' ? '#dc2626' : 'var(--accent)', color: '#fff', fontSize: 12, fontWeight: 600, cursor: 'pointer', fontFamily: 'inherit' }}>{actionLoading ? '…' : 'Confirm'}</button>
                        </div>
                    </div>
                </div>
            )}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                <div>
                    <h2 style={{ margin: 0, fontSize: 17, fontWeight: 700, color: 'var(--text-primary)' }}>Name Change Requests</h2>
                    <p style={{ margin: '3px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>Review, approve or request documents for employee name changes.</p>
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
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
                                <div style={{ flex: 1, minWidth: 200 }}>
                                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6 }}>
                                        <div style={{ width: 30, height: 30, borderRadius: '50%', background: 'var(--accent-dim)', color: 'var(--accent)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 700, flexShrink: 0 }}>{(r.employee_name || '?')[0].toUpperCase()}</div>
                                        <div><div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{r.employee_name}</div><div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{r.employee_email}</div></div>
                                        {statusBadge(r.status)}
                                        {!r.document_provided && r.status !== 'approved' && r.status !== 'rejected' && <span style={{ background: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: '1px solid rgba(245,158,11,0.3)', padding: '2px 8px', borderRadius: 20, fontSize: 10, fontWeight: 600 }}>No Document</span>}
                                    </div>
                                    <div style={{ fontSize: 12, color: 'var(--text-secondary)', display: 'flex', flexWrap: 'wrap', gap: '4px 16px' }}>
                                        <span><span style={{ color: 'var(--text-muted)' }}>From:</span> <strong style={{ color: 'var(--text-primary)' }}>{r.current_name}</strong></span>
                                        <span>→</span>
                                        <span><span style={{ color: 'var(--text-muted)' }}>To:</span> <strong style={{ color: 'var(--accent)' }}>{r.requested_name}</strong></span>
                                        <span><span style={{ color: 'var(--text-muted)' }}>Reason:</span> {r.reason}</span>
                                        <span style={{ color: 'var(--text-muted)' }}>{new Date(r.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
                                    </div>
                                    {r.hr_note && <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-secondary)', padding: '5px 10px', borderRadius: 6, borderLeft: '3px solid var(--border)' }}>Note: {r.hr_note}</div>}
                                </div>
                                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                                    {r.document_provided && <a href={`/api/name-change/${r.id}/document`} target="_blank" rel="noopener noreferrer" style={{ padding: '5px 12px', borderRadius: 7, border: '1px solid rgba(79,142,247,0.3)', background: 'rgba(79,142,247,0.08)', color: 'var(--accent)', fontSize: 11, fontWeight: 500, textDecoration: 'none', display: 'inline-flex', alignItems: 'center', gap: 4 }}>📎 View Doc</a>}
                                    {(r.status === 'pending' || r.status === 'awaiting_document') && (
                                        <>
                                            {actionBtn('Approve', '#10b981', () => openNote(r.id, 'approve'), !!actionLoading)}
                                            {actionBtn('Reject', '#ef4444', () => openNote(r.id, 'reject'), !!actionLoading)}
                                            {!r.document_provided && actionBtn('Request Doc', '#f59e0b', () => openNote(r.id, 'request_document'), !!actionLoading)}
                                        </>
                                    )}
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

/* ── Main HRPanel ────────────────────────────────────────────────────────── */
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
        { id: 'leaves',      label: ' Leave Approvals' },
        { id: 'namechanges', label: ' Name Change Requests' },
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
                    <p style={{ margin: '4px 0 0', color: 'var(--text-muted)', fontSize: 13 }}>Manage employee profiles, review leave requests</p>
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
                        onMouseLeave={e => { if (activeTab !== tab.id) { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.color = 'var(--text-muted)' } }}>{tab.label}</button>
                    ))}
                </div>
                <div style={{ flex: 1 }}>
                    {activeTab === 'directory' && <EmployeeDirectory token={token} onFillProfile={(emp, nameChange = false) => setChatTarget({ ...emp, nameChange })} onAlert={addAlert} />}
                    {activeTab === 'leaves' && <LeaveRequests token={token} onAlert={addAlert} />}
                    {activeTab === 'namechanges' && <NameChangeRequests token={token} onAlert={addAlert} />}
                </div>
            </div>
        </>
    )
}