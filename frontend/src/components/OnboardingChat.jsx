/**
 * OnboardingChat.jsx — Beautiful modal onboarding with themed scrollbar
 * No hidden scrollbar – custom coloured to match dark/light theme.
 */

import { useState, useRef, useEffect } from 'react'

const API = 'http://localhost:8000/api'

const STEPS = [
    { key: 'role', label: 'Role' },
    { key: 'personal', label: 'Personal' },
    { key: 'address', label: 'Address' },
    { key: 'emergency', label: 'Emergency' },
    { key: 'banking', label: 'Banking' },
    { key: 'done', label: 'Done' },
]

export default function OnboardingChat({ employee, token, onComplete }) {
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [resumeFile, setResumeFile] = useState(null)
    const [resumeText, setResumeText] = useState(null)
    const [saving, setSaving] = useState(false)
    const [currentStep, setCurrentStep] = useState(0)
    const [toast, setToast] = useState(null)

    const messagesRef = useRef(null)
    const fileRef = useRef(null)
    const inputRef = useRef(null)

    const progressPercent = ((currentStep) / (STEPS.length - 1)) * 100

    useEffect(() => {
        if (toast) {
            const timer = setTimeout(() => setToast(null), 4000)
            return () => clearTimeout(timer)
        }
    }, [toast])

    const showToast = (type, message) => setToast({ type, message })

    useEffect(() => {
        setMessages([{
            role: 'assistant',
            content: `Welcome ${employee.name}! \n\nI'll help you set up your profile in about 2 minutes.You can upload your resume or just answer a few quick questions.\n\nFirst, which department and job title?`,
        }])
    }, [])

    useEffect(() => {
        if (messagesRef.current) {
            messagesRef.current.scrollTop = messagesRef.current.scrollHeight
        }
    }, [messages, loading])

    const handleResumeUpload = async (file) => {
        if (!file) return
        setResumeFile(file)
        const reader = new FileReader()
        reader.onload = (e) => {
            const text = e.target.result
            setResumeText(typeof text === 'string' ? text.slice(0, 8000) : null)
            setMessages(prev => [...prev, { role: 'user', content: `📎 Uploaded: ${file.name}` }])
            sendMessage(`Please extract my info from this resume.`, typeof text === 'string' ? text.slice(0, 8000) : null)
        }
        reader.readAsText(file)
    }

    const sendMessage = async (text, resumeTextOverride) => {
        const userMsg = text || input.trim()
        if (!userMsg || loading) return
        setInput('')
        if (!text) setMessages(prev => [...prev, { role: 'user', content: userMsg }])
        setLoading(true)
        try {
            const res = await fetch(`${API}/onboarding-profile/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({
                    message: userMsg,
                    history: messages.filter(m => !m.content.startsWith('📎')),
                    resume_text: resumeTextOverride || resumeText || null,
                }),
            })
            const data = await res.json()
            const reply = data.reply || ''
            const displayReply = reply.replace('PROFILE_COMPLETE', '').replace(/```json[\s\S]*?```/g, '').trim()
            setMessages(prev => [...prev, { role: 'assistant', content: displayReply }])

            const r = reply.toLowerCase()
            if (r.includes('date of birth') || r.includes('gender')) setCurrentStep(s => Math.max(s, 1))
            if (r.includes('address') || r.includes('city')) setCurrentStep(s => Math.max(s, 2))
            if (r.includes('emergency') || r.includes('contact name')) setCurrentStep(s => Math.max(s, 3))
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

    const saveProfile = async (profile) => {
        setSaving(true)
        try {
            const res = await fetch(`${API}/onboarding-profile/save`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify(profile),
            })
            if (res.ok) {
                showToast('success', 'Profile saved! Redirecting...')
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
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendMessage()
        }
    }

    const handleSkip = () => {
        if (window.confirm('Skip onboarding? You can finish later from your profile.')) {
            onComplete()
        }
    }

    return (
        <div style={styles.overlay}>
            <div style={styles.modal}>
                <div style={styles.header}>
                    <div>
                        <div style={styles.headerTitle}> Onboarding Assistant</div>
                        <div style={styles.headerSub}>Let's get you started – 2 minutes</div>
                    </div>
                    <div style={styles.progressWrapper}>
                        <div style={styles.progressBarBg}>
                            <div style={{ ...styles.progressBarFill, width: `${progressPercent}%` }} />
                        </div>
                        <div style={styles.stepsContainer}>
                            {STEPS.map((step, idx) => {
                                const isActive = idx <= currentStep
                                const isCompleted = idx < currentStep
                                return (
                                    <div key={step.key} style={styles.stepItem}>
                                        <div style={{
                                            ...styles.stepDot,
                                            background: isActive ? 'var(--accent)' : 'var(--border)',
                                            borderColor: isActive ? 'var(--accent)' : 'var(--border)',
                                        }}>
                                            {isCompleted && <span style={styles.stepCheck}>✓</span>}
                                        </div>
                                        <span style={{
                                            ...styles.stepLabel,
                                            color: isActive ? 'var(--text-primary)' : 'var(--text-muted)',
                                        }}>{step.label}</span>
                                    </div>
                                )
                            })}
                        </div>
                    </div>
                </div>

                {/* Messages – scrollable with custom‑coloured scrollbar */}
                <div ref={messagesRef} style={styles.messagesArea}>
                    {messages.map((msg, i) => (
                        <div
                            key={i}
                            style={{
                                display: 'flex',
                                justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                                marginBottom: 12,
                                animation: 'fadeSlideUp 0.25s ease',
                            }}
                        >
                            <div style={{
                                maxWidth: '80%',
                                padding: '10px 16px',
                                borderRadius: msg.role === 'user'
                                    ? '20px 20px 4px 20px'
                                    : '20px 20px 20px 4px',
                                background: msg.role === 'user'
                                    ? 'linear-gradient(135deg, var(--accent), #7c3aed)'
                                    : 'var(--bg-card)',
                                border: msg.role === 'user' ? 'none' : '1px solid var(--border)',
                                fontSize: 13,
                                lineHeight: 1.5,
                                color: msg.role === 'user' ? '#fff' : 'var(--text-primary)',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                                boxShadow: '0 2px 6px rgba(0,0,0,0.05)',
                            }}>
                                {msg.content}
                            </div>
                        </div>
                    ))}
                    {loading && (
                        <div style={{ display: 'flex', justifyContent: 'flex-start' }}>
                            <div style={styles.typingIndicator}>
                                {[0, 1, 2].map(i => (
                                    <span key={i} style={{
                                        ...styles.typingDot,
                                        animationDelay: `${i * 0.15}s`,
                                    }} />
                                ))}
                            </div>
                        </div>
                    )}
                </div>

                <div style={styles.inputArea}>
                    <button onClick={() => fileRef.current?.click()} style={styles.attachBtn} title="Upload resume">📎</button>
                    <input ref={fileRef} type="file" accept=".pdf,.txt,.doc,.docx" style={{ display: 'none' }} onChange={e => handleResumeUpload(e.target.files?.[0])} />
                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKey}
                        placeholder="Type your answer… (Enter to send)"
                        rows={1}
                        style={styles.textarea}
                        disabled={loading || saving}
                    />
                    <button
                        onClick={() => sendMessage()}
                        disabled={!input.trim() || loading || saving}
                        style={{
                            ...styles.sendBtn,
                            opacity: (!input.trim() || loading || saving) ? 0.5 : 1,
                        }}
                    >
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                            <line x1="22" y1="2" x2="11" y2="13" />
                            <polygon points="22 2 15 22 11 13 2 9 22 2" />
                        </svg>
                    </button>
                </div>

                {resumeFile && (
                    <div style={styles.fileInfo}>📄 {resumeFile.name} · <span style={{ color: 'var(--green)' }}>ready</span></div>
                )}
                <div style={styles.skipContainer}>
                
                </div>
            </div>

            {toast && (
                <div style={{
                    ...styles.toast,
                    background: toast.type === 'success' ? 'var(--green)' : toast.type === 'error' ? 'var(--red)' : 'var(--accent)',
                }}>
                    <span>{toast.type === 'success' ? '✓' : toast.type === 'error' ? '⚠' : 'ℹ'}</span>
                    <span>{toast.message}</span>
                </div>
            )}

            <style>{`
                @keyframes fadeSlideUp {
                    from { opacity: 0; transform: translateY(10px); }
                    to { opacity: 1; transform: translateY(0); }
                }
                @keyframes bounceDot {
                    0%, 80%, 100% { transform: translateY(0); }
                    40% { transform: translateY(-6px); }
                }
                @keyframes toastSlide {
                    from { opacity: 0; transform: translateX(30px); }
                    to { opacity: 1; transform: translateX(0); }
                }
                textarea:focus {
                    outline: none;
                    border-color: var(--accent) !important;
                    box-shadow: 0 0 0 2px var(--accent-glow);
                }
                button {
                    transition: all 0.2s ease;
                }
                button:hover:not(:disabled) {
                    transform: scale(1.02);
                }
                button:active:not(:disabled) {
                    transform: scale(0.98);
                }
                /* Custom scrollbar – matches theme */
                .modal-messages::-webkit-scrollbar {
                    width: 5px;
                }
                .modal-messages::-webkit-scrollbar-track {
                    background: var(--border);
                    border-radius: 10px;
                }
                .modal-messages::-webkit-scrollbar-thumb {
                    background: var(--accent);
                    border-radius: 10px;
                }
                .modal-messages::-webkit-scrollbar-thumb:hover {
                    background: var(--accent);
                    opacity: 0.8;
                }
            `}</style>
        </div>
    )
}

const styles = {
    overlay: {
        position: 'fixed',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        background: 'rgba(0,0,0,0.65)',
        backdropFilter: 'blur(8px)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 9999,
        fontFamily: 'var(--font-sans)',
    },
    modal: {
        width: '92%',
        maxWidth: 620,
        height: '85vh',
        background: 'var(--bg-secondary)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 28,
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
        animation: 'fadeSlideUp 0.3s cubic-bezier(0.2, 0.9, 0.4, 1.1)',
    },
    header: {
        padding: '20px 24px 8px 24px',
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-card)',
    },
    headerTitle: {
        fontSize: 18,
        fontWeight: 700,
        color: 'var(--text-primary)',
        letterSpacing: '-0.2px',
    },
    headerSub: {
        fontSize: 12,
        color: 'var(--text-muted)',
        marginTop: 4,
        marginBottom: 16,
    },
    progressWrapper: {
        marginTop: 4,
    },
    progressBarBg: {
        background: 'var(--border)',
        borderRadius: 10,
        height: 6,
        width: '100%',
        marginBottom: 14,
        overflow: 'hidden',
    },
    progressBarFill: {
        height: '100%',
        background: 'linear-gradient(90deg, var(--accent), var(--green))',
        borderRadius: 10,
        transition: 'width 0.5s cubic-bezier(0.2, 0.9, 0.4, 1.1)',
    },
    stepsContainer: {
        display: 'flex',
        justifyContent: 'space-between',
        gap: 8,
    },
    stepItem: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        flex: 1,
        gap: 6,
    },
    stepDot: {
        width: 24,
        height: 24,
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 12,
        fontWeight: 700,
        background: 'var(--bg-card)',
        border: '2px solid var(--border)',
        transition: 'all 0.2s',
    },
    stepCheck: {
        fontSize: 12,
        color: '#fff',
    },
    stepLabel: {
        fontSize: 10,
        fontWeight: 500,
        color: 'var(--text-muted)',
        textAlign: 'center',
        whiteSpace: 'nowrap',
    },
    messagesArea: {
        flex: 1,
        overflowY: 'auto',
        padding: '20px 24px',
        display: 'flex',
        flexDirection: 'column',
        gap: 12,
        background: 'var(--bg-primary)',
        // custom scrollbar class – will be applied by adding className="modal-messages"
        scrollbarWidth: 'thin',
        scrollbarColor: 'var(--accent) var(--border)',
    },
    typingIndicator: {
        padding: '10px 16px',
        borderRadius: '20px',
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        display: 'flex',
        gap: 6,
        alignItems: 'center',
    },
    typingDot: {
        width: 8,
        height: 8,
        borderRadius: '50%',
        background: 'var(--accent)',
        animation: 'bounceDot 1.2s ease-in-out infinite',
    },
    inputArea: {
        padding: '16px 20px 12px 20px',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-card)',
        display: 'flex',
        gap: 12,
        alignItems: 'flex-end',
    },
    attachBtn: {
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 14,
        width: 42,
        height: 42,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        fontSize: 18,
        color: 'var(--text-muted)',
        transition: 'all 0.2s',
    },
    textarea: {
        flex: 1,
        background: 'var(--bg-input)',
        border: '1px solid var(--border)',
        borderRadius: 14,
        padding: '10px 16px',
        color: 'var(--text-primary)',
        fontSize: 13,
        resize: 'none',
        outline: 'none',
        fontFamily: 'inherit',
        lineHeight: 1.5,
        maxHeight: 100,
        overflowY: 'auto',
        transition: 'border 0.2s, box-shadow 0.2s',
    },
    sendBtn: {
        background: 'linear-gradient(135deg, var(--accent), #7c3aed)',
        border: 'none',
        borderRadius: 14,
        width: 42,
        height: 42,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        transition: 'all 0.2s',
        color: '#fff',
    },
    fileInfo: {
        padding: '6px 20px 12px',
        fontSize: 11,
        color: 'var(--text-muted)',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-card)',
    },
    skipContainer: {
        padding: '8px 20px 16px',
        textAlign: 'center',
        borderTop: '1px solid var(--border)',
        background: 'var(--bg-card)',
    },
    skipBtn: {
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 20,
        padding: '6px 16px',
        fontSize: 12,
        color: 'var(--text-muted)',
        cursor: 'pointer',
        transition: 'all 0.2s',
    },
    toast: {
        position: 'fixed',
        bottom: 24,
        right: 24,
        zIndex: 10000,
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        color: '#fff',
        padding: '12px 20px',
        borderRadius: 40,
        fontSize: 13,
        fontWeight: 500,
        boxShadow: '0 8px 20px rgba(0,0,0,0.2)',
        animation: 'toastSlide 0.3s ease',
        backdropFilter: 'blur(8px)',
    },
}