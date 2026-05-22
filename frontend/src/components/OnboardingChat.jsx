/**
 * OnboardingChat.jsx
 * On resume upload: parse common fields client-side, then tell the AI
 * exactly which fields were found so it only asks for what's missing.
 */

import { useState, useRef, useEffect } from 'react'

const API = 'http://localhost:8000/api'

const STEPS = [
    { key: 'role',      label: 'Role'      },
    { key: 'personal',  label: 'Personal'  },
    { key: 'address',   label: 'Address'   },
    { key: 'emergency', label: 'Emergency' },
    { key: 'banking',   label: 'Banking'   },
    { key: 'done',      label: 'Done'      },
]

/* ── Regex-based resume field extractor ──────────────────────────────────── */
function extractFieldsFromText(text) {
    const t = text || ''
    const found = {}

    // Email
    const emailM = t.match(/[\w.+-]+@[\w.-]+\.\w{2,}/)
    if (emailM) found.email = emailM[0].trim()

    // Phone — handles +91, Indian, US formats
    const phoneM = t.match(/(?:\+?\d[\s\-.]?){9,14}\d/)
    if (phoneM) found.phone = phoneM[0].replace(/[\s\-.]/g, '')

    // Job title — lines with common keywords
    const titleM = t.match(
        /(?:designation|job title|position|role)[:\s]+([^\n]{3,60})/i
    )
    if (titleM) found.designation = titleM[1].trim()

    // Department / company
    const deptM = t.match(
        /(?:department|division|team)[:\s]+([^\n]{3,60})/i
    )
    if (deptM) found.department = deptM[1].trim()

    // Date of joining / start date
    const joinM = t.match(
        /(?:joining date|date of joining|start date|joined)[:\s]+([^\n]{4,30})/i
    )
    if (joinM) found.join_date = joinM[1].trim()

    // Name (first non-empty line of resume, or after "Name:")
    const nameM = t.match(/(?:name)[:\s]+([^\n]{2,50})/i)
    if (nameM) found.name = nameM[1].trim()

    // Gender
    const genderM = t.match(/\b(male|female|non[\s-]binary|other)\b/i)
    if (genderM) found.gender = genderM[1].charAt(0).toUpperCase() + genderM[1].slice(1).toLowerCase()

    // Date of birth
    const dobM = t.match(
        /(?:dob|date of birth|born)[:\s]+(\d{1,2}[\s/\-]\w{2,9}[\s/\-]\d{2,4}|\w+ \d{1,2},? \d{4})/i
    )
    if (dobM) found.date_of_birth = dobM[1].trim()

    return found
}

/* Build the message sent to AI after parsing ──────────────────────────────── */
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

export default function OnboardingChat({ employee, token, onComplete, isHRMode = false }) {
    const [messages, setMessages]     = useState([])
    const [input, setInput]           = useState('')
    const [loading, setLoading]       = useState(false)
    const [resumeFile, setResumeFile] = useState(null)
    const [resumeText, setResumeText] = useState(null)
    const [saving, setSaving]         = useState(false)
    const [currentStep, setCurrentStep] = useState(0)
    const [toast, setToast]           = useState(null)

    const messagesRef = useRef(null)
    const fileRef     = useRef(null)
    const inputRef    = useRef(null)

    const progressPercent = (currentStep / (STEPS.length - 1)) * 100

    useEffect(() => {
        if (toast) {
            const t = setTimeout(() => setToast(null), 4000)
            return () => clearTimeout(t)
        }
    }, [toast])

    const showToast = (type, message) => setToast({ type, message })

    useEffect(() => {
        setMessages([{
            role: 'assistant',
            content: isHRMode
                ? `Hi! Let's fill in the profile for **${employee.name}** (${employee.email}).\n\nYou can upload their resume (PDF) and I'll extract what I can, or just answer the questions.\n\nFirst — what department are they joining and what's their job title?`
                : `Welcome ${employee.name}!\n\nI'll help set up your profile in about 2 minutes.\n\nYou can upload your resume (PDF) and I'll fill in what I can, or just answer a few quick questions.\n\nFirst — which department and job title?`,
        }])
    }, [])

    useEffect(() => {
        if (messagesRef.current)
            messagesRef.current.scrollTop = messagesRef.current.scrollHeight
    }, [messages, loading])

    /* ── Resume upload ─────────────────────────────────────────────────────── */
    const handleResumeUpload = async (file) => {
        if (!file) return
        setResumeFile(file)
        setMessages(prev => [...prev, { role: 'user', content: `Uploaded: ${file.name}` }])

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
                // Ask backend to extract text from PDF
                const dataUrl = await readFile(false)
                const base64  = dataUrl.split(',')[1]
                const res     = await fetch(`${API}/onboarding-profile/extract-resume`, {
                    method:  'POST',
                    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                    body:    JSON.stringify({ pdf_base64: base64, filename: file.name }),
                })
                const data = await res.json()
                rawText = data.text || ''
            } else {
                // Plain text file — read directly
                const full = await readFile(true)
                rawText = (typeof full === 'string' ? full : '').slice(0, 8000)
            }

            setResumeText(rawText)

            if (!rawText.trim()) {
                showToast('error', 'Could not read file text. Please type your details.')
                sendMessage("I uploaded my resume but couldn't extract text. Please ask me the questions.", null)
                return
            }

            // ── Extract fields client-side ────────────────────────────────────
            const found   = extractFieldsFromText(rawText)
            const message = buildResumeMessage(found, file.name)

            // Show a quick "extracted" summary bubble to the user
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

            // Send to AI so it can fill in missing fields
            sendMessage(message, rawText)

        } catch (err) {
            console.error('Resume upload error:', err)
            showToast('error', 'Upload failed. Please type your details.')
            sendMessage("My resume upload failed. Please ask me the questions.", null)
        }
    }

    /* ── Send to onboarding chat endpoint ─────────────────────────────────── */
    const sendMessage = async (text, resumeTextOverride) => {
        const userMsg = text || input.trim()
        if (!userMsg || loading) return
        setInput('')
        // Only add the user bubble when it's a manual message (not an internal auto-message)
        if (!text) setMessages(prev => [...prev, { role: 'user', content: userMsg }])
        setLoading(true)
        try {
            const res = await fetch(`${API}/onboarding-profile/${isHRMode ? 'chat-for' : 'chat'}`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body:    JSON.stringify({
                    ...(isHRMode ? { employee_id: employee.id } : {}),
                    message:     userMsg,
                    history:     messages.filter(m => !m.content.startsWith('📎')),
                    resume_text: resumeTextOverride !== undefined ? resumeTextOverride : resumeText,
                }),
            })
            const data = await res.json()
            const reply        = data.reply || ''
            const displayReply = reply
                .replace('PROFILE_COMPLETE', '')
                .replace(/```json[\s\S]*?```/g, '')
                .trim()

            setMessages(prev => [...prev, { role: 'assistant', content: displayReply }])

            // Advance progress stepper based on keywords in reply
            const r = reply.toLowerCase()
            if (r.includes('date of birth') || r.includes('gender'))                  setCurrentStep(s => Math.max(s, 1))
            if (r.includes('address') || r.includes('city'))                          setCurrentStep(s => Math.max(s, 2))
            if (r.includes('emergency') || r.includes('contact name'))                setCurrentStep(s => Math.max(s, 3))
            if (r.includes('bank') || r.includes('account') || r.includes('salary')) setCurrentStep(s => Math.max(s, 4))

            if (data.profile_complete && data.extracted_profile) {
                setCurrentStep(5)
                setTimeout(() => saveProfile(data.extracted_profile), 800)
            }
        } catch {
            showToast('error', 'Oops! Something went wrong. Try again.')
        } finally {
            setLoading(false)
            inputRef.current?.focus()
        }
    }

    /* ── Save profile ──────────────────────────────────────────────────────── */
    const saveProfile = async (profile) => {
        setSaving(true)
        try {
            const res = await fetch(`${API}/onboarding-profile/save`, {
                method:  'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body:    JSON.stringify(profile),
            })
            if (res.ok) {
                showToast('success', 'Profile saved! Redirecting…')
                setTimeout(() => onComplete(), 2000)
            } else {
                showToast('error', 'Save failed. Please retry.')
            }
        } catch {
            showToast('error', 'Network error while saving.')
        } finally {
            setSaving(false)
        }
    }

    const handleKey = (e) => {
        if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
    }

    const handleSkip = () => {
        if (window.confirm('Skip onboarding? You can finish later from your profile.')) onComplete()
    }

    /* ── Render ─────────────────────────────────────────────────────────────── */
    return (
        <div style={S.overlay}>
            <div style={S.modal}>

                {/* Header + stepper */}
                <div style={S.header}>
                    <div>
                        <div style={S.headerTitle}>Onboarding Assistant</div>
                        <div style={S.headerSub}>Let's get you started – 2 minutes</div>
                    </div>
                    <div style={S.progressWrapper}>
                        <div style={S.progressBg}>
                            <div style={{ ...S.progressFill, width: `${progressPercent}%` }} />
                        </div>
                        <div style={S.stepsRow}>
                            {STEPS.map((step, idx) => {
                                const active    = idx <= currentStep
                                const completed = idx < currentStep
                                return (
                                    <div key={step.key} style={S.stepItem}>
                                        <div style={{
                                            ...S.stepDot,
                                            background:   active ? 'var(--accent)' : 'var(--border)',
                                            borderColor:  active ? 'var(--accent)' : 'var(--border)',
                                        }}>
                                            {completed && <span style={S.check}>✓</span>}
                                        </div>
                                        <span style={{
                                            ...S.stepLabel,
                                            color: active ? 'var(--text-primary)' : 'var(--text-muted)',
                                        }}>{step.label}</span>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>

                {/* Messages */}
                <div ref={messagesRef} style={S.messages} className="modal-messages">
                    {messages.map((msg, i) => (
                        <div key={i} style={{ display:'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', animation:'fadeSlideUp .25s ease' }}>
                            <div style={{
                                maxWidth:'80%', padding:'10px 16px',
                                borderRadius: msg.role === 'user' ? '20px 20px 4px 20px' : '20px 20px 20px 4px',
                                background:   msg.role === 'user' ? 'linear-gradient(135deg, var(--accent), #7c3aed)' : 'var(--bg-card)',
                                border:       msg.role === 'user' ? 'none' : '1px solid var(--border)',
                                fontSize:13, lineHeight:1.6,
                                color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
                                whiteSpace:'pre-wrap', wordBreak:'break-word',
                                boxShadow:'0 2px 6px rgba(0,0,0,.06)',
                            }}>
                                {msg.content}
                            </div>
                        </div>
                    ))}
                    {loading && (
                        <div style={{ display:'flex', justifyContent:'flex-start' }}>
                            <div style={S.typing}>
                                {[0,1,2].map(i => (
                                    <span key={i} style={{ ...S.dot, animationDelay:`${i*.15}s` }} />
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                {/* Input area */}
                <div style={S.inputArea}>
                    <button
                        onClick={() => fileRef.current?.click()}
                        style={S.attachBtn}
                        title="Upload resume (PDF or TXT)"
                    >📎</button>
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".pdf,.txt"
                        style={{ display:'none' }}
                        onChange={e => handleResumeUpload(e.target.files?.[0])}
                    />
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKey}
                        placeholder="Type your answer… (Enter to send)"
                        rows={1}
                        style={S.textarea}
                        disabled={loading || saving}
                    />
                    <button
                        onClick={() => sendMessage()}
                        disabled={!input.trim() || loading || saving}
                        style={{ ...S.sendBtn, opacity: (!input.trim() || loading || saving) ? .5 : 1 }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="22" y1="2" x2="11" y2="13"/>
                            <polygon points="22 2 15 22 11 13 2 9 22 2"/>
                        </svg>
                    </button>
                </div>

                {resumeFile && (
                    <div style={S.fileInfo}>
                        📄 {resumeFile.name} · <span style={{ color:'var(--green)' }}>ready</span>
                    </div>
                )}

                <div style={S.skipRow}>
                    <button onClick={handleSkip} style={S.skipBtn}>Skip for now</button>
                </div>
            </div>

            {/* Toast */}
            {toast && (
                <div style={{
                    ...S.toast,
                    background: toast.type === 'success' ? 'var(--green)' : toast.type === 'error' ? 'var(--red)' : 'var(--accent)',
                }}>
                    <span>{toast.type === 'success' ? '✓' : '⚠'}</span>
                    <span>{toast.message}</span>
                </div>
            )}

            <style>{`
                @keyframes fadeSlideUp { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
                @keyframes bounceDot   { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }
                @keyframes toastSlide  { from{opacity:0;transform:translateX(30px)} to{opacity:1;transform:translateX(0)} }
                textarea:focus { outline:none; border-color:var(--accent) !important; box-shadow:0 0 0 2px var(--accent-glow); }
                .modal-messages::-webkit-scrollbar { width:5px; }
                .modal-messages::-webkit-scrollbar-track { background:var(--border); border-radius:10px; }
                .modal-messages::-webkit-scrollbar-thumb { background:var(--accent); border-radius:10px; }
            `}</style>
        </div>
    )
}

/* ── Styles ──────────────────────────────────────────────────────────────── */
const S = {
    overlay: { position:'fixed',inset:0,background:'rgba(0,0,0,0.65)',backdropFilter:'blur(8px)',display:'flex',alignItems:'center',justifyContent:'center',zIndex:9999 },
    modal:   { width:'92%',maxWidth:620,height:'85vh',background:'var(--bg-secondary)',border:'1px solid rgba(255,255,255,.08)',borderRadius:28,display:'flex',flexDirection:'column',overflow:'hidden',boxShadow:'0 25px 50px -12px rgba(0,0,0,.5)',animation:'fadeSlideUp .3s cubic-bezier(.2,.9,.4,1.1)' },
    header:  { padding:'20px 24px 8px',borderBottom:'1px solid var(--border)',background:'var(--bg-card)' },
    headerTitle: { fontSize:18,fontWeight:700,color:'var(--text-primary)',letterSpacing:'-0.2px' },
    headerSub:   { fontSize:12,color:'var(--text-muted)',marginTop:4,marginBottom:16 },
    progressWrapper: { marginTop:4 },
    progressBg:   { background:'var(--border)',borderRadius:10,height:6,width:'100%',marginBottom:14,overflow:'hidden' },
    progressFill: { height:'100%',background:'linear-gradient(90deg,var(--accent),var(--green))',borderRadius:10,transition:'width .5s cubic-bezier(.2,.9,.4,1.1)' },
    stepsRow: { display:'flex',justifyContent:'space-between',gap:8 },
    stepItem: { display:'flex',flexDirection:'column',alignItems:'center',flex:1,gap:6 },
    stepDot:  { width:24,height:24,borderRadius:'50%',display:'flex',alignItems:'center',justifyContent:'center',border:'2px solid',transition:'all .2s' },
    check:    { fontSize:12,color:'#fff' },
    stepLabel:{ fontSize:10,fontWeight:500,textAlign:'center',whiteSpace:'nowrap' },
    messages: { flex:1,overflowY:'auto',padding:'20px 24px',display:'flex',flexDirection:'column',gap:12,background:'var(--bg-primary)',scrollbarWidth:'thin',scrollbarColor:'var(--accent) var(--border)' },
    typing:   { padding:'10px 16px',borderRadius:20,background:'var(--bg-card)',border:'1px solid var(--border)',display:'flex',gap:6,alignItems:'center' },
    dot:      { width:8,height:8,borderRadius:'50%',background:'var(--accent)',animation:'bounceDot 1.2s ease-in-out infinite',display:'inline-block' },
    inputArea:{ padding:'16px 20px 12px',borderTop:'1px solid var(--border)',background:'var(--bg-card)',display:'flex',gap:12,alignItems:'flex-end' },
    attachBtn:{ background:'transparent',border:'1px solid var(--border)',borderRadius:14,width:42,height:42,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',fontSize:18,color:'var(--text-muted)',flexShrink:0 },
    textarea: { flex:1,background:'var(--bg-input)',border:'1px solid var(--border)',borderRadius:14,padding:'10px 16px',color:'var(--text-primary)',fontSize:13,resize:'none',outline:'none',fontFamily:'inherit',lineHeight:1.5,maxHeight:100,overflowY:'auto' },
    sendBtn:  { background:'linear-gradient(135deg,var(--accent),#7c3aed)',border:'none',borderRadius:14,width:42,height:42,display:'flex',alignItems:'center',justifyContent:'center',cursor:'pointer',color:'#fff',flexShrink:0 },
    fileInfo: { padding:'6px 20px 12px',fontSize:11,color:'var(--text-muted)',background:'var(--bg-card)' },
    skipRow:  { padding:'8px 20px 16px',textAlign:'center',background:'var(--bg-card)',borderTop:'1px solid var(--border)' },
    skipBtn:  { background:'transparent',border:'1px solid var(--border)',borderRadius:20,padding:'6px 16px',fontSize:12,color:'var(--text-muted)',cursor:'pointer' },
    toast:    { position:'fixed',bottom:24,right:24,zIndex:10000,display:'flex',alignItems:'center',gap:12,color:'#fff',padding:'12px 20px',borderRadius:40,fontSize:13,fontWeight:500,boxShadow:'0 8px 20px rgba(0,0,0,.2)',animation:'toastSlide .3s ease' },
}