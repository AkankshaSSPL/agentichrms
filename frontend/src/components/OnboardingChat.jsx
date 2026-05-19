/**
 * OnboardingChat.jsx
 * Conversational onboarding — collects employee profile via AI chat.
 * Triggered on first login when onboarding_completed = false.
 * Uses the same visual theme as the main chat assistant.
 */

import { useState, useRef, useEffect } from 'react'

const API = '/api'

export default function OnboardingChat({ employee, token, onComplete }) {
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [resumeFile, setResumeFile] = useState(null)
    const [resumeText, setResumeText] = useState(null)
    const [saving, setSaving] = useState(false)
    const [done, setDone] = useState(false)
    const bottomRef = useRef(null)
    const fileRef = useRef(null)
    const inputRef = useRef(null)

    // Boot greeting
    useEffect(() => {
        setMessages([{
            role: 'assistant',
            content: `Hi **${employee.name}**! Welcome to ${employee.department || 'the company'}!\n\nI'm your onboarding assistant. I'll collect a few details to set up your profile, it only takes a couple of minutes.\n\nLet's start: **What department are you joining, and what's your job title?**\n\n*(You can also upload your resume and I'll fill in as much as I can automatically )*`,
        }])
    }, [])

    useEffect(() => {
        bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, loading])

    // Resume upload
    const handleResumeUpload = async (file) => {
        if (!file) return
        setResumeFile(file)
        const reader = new FileReader()
        reader.onload = (e) => {
            const text = e.target.result
            setResumeText(typeof text === 'string' ? text.slice(0, 8000) : null)
            setMessages(prev => [...prev, {
                role: 'user',
                content: `📎 Uploaded resume: **${file.name}**`,
            }])
            sendMessage(`Please extract my profile information from my resume.`, typeof text === 'string' ? text.slice(0, 8000) : null)
        }
        reader.readAsText(file)
    }

    const sendMessage = async (text, resumeTextOverride) => {
        const userMsg = text || input.trim()
        if (!userMsg || loading) return
        setInput('')

        const newMessages = [...messages, { role: 'user', content: userMsg }]
        if (!text) setMessages(newMessages)

        setLoading(true)
        try {
            const res = await fetch(`${API}/onboarding-profile/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify({
                    message: userMsg,
                    history: messages.filter(m => !m.content.startsWith('📎')),
                    resume_text: resumeTextOverride || resumeText || null,
                }),
            })
            const data = await res.json()
            const reply = data.reply || ''

            const displayReply = reply
                .replace('PROFILE_COMPLETE', '')
                .replace(/```json[\s\S]*?```/g, '')
                .trim()

            setMessages(prev => [...prev, { role: 'assistant', content: displayReply }])

            if (data.profile_complete && data.extracted_profile) {
                setTimeout(() => saveProfile(data.extracted_profile), 800)
            }
        } catch (err) {
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: '⚠️ Something went wrong. Please try again.',
            }])
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
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${token}`,
                },
                body: JSON.stringify(profile),
            })
            if (res.ok) {
                setDone(true)
                setMessages(prev => [...prev, {
                    role: 'assistant',
                    content: '🎉 **Your profile is all set!** Welcome aboard — taking you to your dashboard now...',
                }])
                setTimeout(() => onComplete(), 2200)
            }
        } catch (err) {
            console.error('Save failed:', err)
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

    // ── Render using same styles as main chat (from App.jsx) ──────────────────
    return (
        <div style={styles.page}>
            {/* Header – matches chat header */}
            <div style={styles.header}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div style={styles.avatar}>{employee.name?.[0]?.toUpperCase()}</div>
                    <div>
                        <div style={styles.headerTitle}>Profile Setup</div>
                        <div style={styles.headerSub}>Complete your onboarding · {employee.email}</div>
                    </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button
                        onClick={onComplete}
                        title="Skip for now — you can complete your profile later"
                        style={styles.skipBtn}
                    >
                        Skip for now →
                    </button>
                    <div style={styles.progressPill}>
                        <span style={{ color: '#34d399', fontSize: 12 }}>●</span>
                        &nbsp;Onboarding in progress
                    </div>
                </div>
            </div>

            {/* Chat messages area */}
            <div style={styles.chatArea}>
                {messages.map((msg, i) => (
                    <div key={i} style={{ display: 'flex', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start', marginBottom: 12 }}>
                        {msg.role === 'assistant' && (
                            <div style={styles.botAvatar}>🤖</div>
                        )}
                        <div style={msg.role === 'user' ? styles.userBubble : styles.botBubble}>
                            <MarkdownText text={msg.content} />
                        </div>
                    </div>
                ))}

                {loading && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
                        <div style={styles.botAvatar}>🤖</div>
                        <div style={styles.botBubble}>
                            <TypingDots />
                        </div>
                    </div>
                )}

                {saving && (
                    <div style={{ display: 'flex', justifyContent: 'center', padding: 12 }}>
                        <div style={styles.savingPill}>💾 Saving your profile…</div>
                    </div>
                )}

                <div ref={bottomRef} />
            </div>

            {/* Input area – same as main chat */}
            {!done && (
                <div style={styles.inputArea}>
                    <button
                        onClick={() => fileRef.current?.click()}
                        title="Upload resume (PDF or TXT)"
                        style={styles.uploadBtn}
                    >
                        📎
                    </button>
                    <input
                        ref={fileRef}
                        type="file"
                        accept=".pdf,.txt,.doc,.docx"
                        style={{ display: 'none' }}
                        onChange={e => handleResumeUpload(e.target.files?.[0])}
                    />

                    <textarea
                        ref={inputRef}
                        value={input}
                        onChange={e => setInput(e.target.value)}
                        onKeyDown={handleKey}
                        placeholder="Type your answer… (Enter to send, Shift+Enter for new line)"
                        rows={1}
                        style={styles.textarea}
                        disabled={loading || done}
                    />

                    <button
                        onClick={() => sendMessage()}
                        disabled={!input.trim() || loading || done}
                        style={{ ...styles.sendBtn, opacity: (!input.trim() || loading) ? 0.4 : 1 }}
                    >
                        ➤
                    </button>
                </div>
            )}
        </div>
    )
}

// Simple markdown renderer (same as main chat)
function MarkdownText({ text }) {
    const lines = text.split('\n')
    return (
        <div style={{ lineHeight: 1.6, fontSize: 14 }}>
            {lines.map((line, i) => {
                const parts = line.split(/\*\*(.*?)\*\*/g)
                return (
                    <div key={i} style={{ marginBottom: line === '' ? 6 : 0 }}>
                        {parts.map((part, j) =>
                            j % 2 === 1
                                ? <strong key={j} style={{ color: '#e2e8f0' }}>{part}</strong>
                                : <span key={j}>{part}</span>
                        )}
                    </div>
                )
            })}
        </div>
    )
}

function TypingDots() {
    return (
        <div style={{ display: 'flex', gap: 4, alignItems: 'center', padding: '2px 0' }}>
            {[0, 1, 2].map(i => (
                <div key={i} style={{
                    width: 7, height: 7, borderRadius: '50%',
                    background: '#4f8ef7',
                    animation: `bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
                }} />
            ))}
            <style>{`@keyframes bounce { 0%,80%,100%{transform:translateY(0)} 40%{transform:translateY(-6px)} }`}</style>
        </div>
    )
}

// Styles – identical to main chat's look & feel
const styles = {
    page: {
        height: '100vh',
        display: 'flex',
        flexDirection: 'column',
        background: '#060812',
        fontFamily: "'Inter', sans-serif",
        overflow: 'hidden',
    },
    header: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        padding: '16px 28px',
        borderBottom: '1px solid rgba(79,142,247,0.12)',
        background: 'rgba(6,8,18,0.95)',
        backdropFilter: 'blur(12px)',
        flexShrink: 0,
    },
    avatar: {
        width: 40,
        height: 40,
        borderRadius: '50%',
        background: 'linear-gradient(135deg,#4f8ef7,#7c3aed)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 16,
        fontWeight: 700,
        color: '#fff',
    },
    headerTitle: { fontSize: 15, fontWeight: 700, color: '#e2e8f0' },
    headerSub: { fontSize: 11, color: '#475569', marginTop: 2 },
    skipBtn: {
        background: 'transparent',
        border: '1px solid rgba(79,142,247,0.2)',
        borderRadius: 8,
        padding: '6px 14px',
        color: '#475569',
        fontSize: 12,
        cursor: 'pointer',
        transition: 'all 0.15s',
    },
    progressPill: {
        background: 'rgba(52,211,153,0.08)',
        border: '1px solid rgba(52,211,153,0.2)',
        borderRadius: 20,
        padding: '5px 14px',
        fontSize: 12,
        color: '#64748b',
    },
    chatArea: {
        flex: 1,
        overflowY: 'auto',
        padding: '24px 28px',
        display: 'flex',
        flexDirection: 'column',
        scrollbarWidth: 'thin',
        scrollbarColor: '#1e2433 transparent',
    },
    botAvatar: {
        width: 32,
        height: 32,
        borderRadius: '50%',
        background: 'rgba(79,142,247,0.12)',
        border: '1px solid rgba(79,142,247,0.2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 16,
        flexShrink: 0,
        marginRight: 8,
        alignSelf: 'flex-start',
        marginTop: 2,
    },
    botBubble: {
        background: 'rgba(15,18,25,0.9)',
        border: '1px solid rgba(79,142,247,0.12)',
        borderRadius: '0 14px 14px 14px',
        padding: '12px 16px',
        maxWidth: '72%',
        color: '#94a3b8',
    },
    userBubble: {
        background: 'rgba(79,142,247,0.15)',
        border: '1px solid rgba(79,142,247,0.25)',
        borderRadius: '14px 0 14px 14px',
        padding: '12px 16px',
        maxWidth: '72%',
        color: '#e2e8f0',
        fontSize: 14,
        lineHeight: 1.6,
    },
    savingPill: {
        background: 'rgba(52,211,153,0.1)',
        border: '1px solid rgba(52,211,153,0.25)',
        borderRadius: 20,
        padding: '6px 18px',
        fontSize: 13,
        color: '#34d399',
    },
    inputArea: {
        display: 'flex',
        alignItems: 'flex-end',
        gap: 10,
        padding: '14px 20px',
        borderTop: '1px solid rgba(79,142,247,0.1)',
        background: 'rgba(6,8,18,0.95)',
        flexShrink: 0,
    },
    uploadBtn: {
        background: 'rgba(79,142,247,0.08)',
        border: '1px solid rgba(79,142,247,0.2)',
        borderRadius: 10,
        width: 40,
        height: 40,
        fontSize: 18,
        cursor: 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flexShrink: 0,
        color: '#60a5fa',
        transition: 'background 0.15s',
    },
    textarea: {
        flex: 1,
        background: 'rgba(15,18,25,0.9)',
        border: '1px solid rgba(79,142,247,0.2)',
        borderRadius: 12,
        padding: '10px 14px',
        color: '#e2e8f0',
        fontSize: 14,
        resize: 'none',
        outline: 'none',
        fontFamily: 'inherit',
        lineHeight: 1.5,
        maxHeight: 120,
        overflowY: 'auto',
    },
    sendBtn: {
        background: '#4f8ef7',
        border: 'none',
        borderRadius: 10,
        width: 40,
        height: 40,
        fontSize: 16,
        color: '#fff',
        cursor: 'pointer',
        flexShrink: 0,
        transition: 'opacity 0.15s',
    },
}