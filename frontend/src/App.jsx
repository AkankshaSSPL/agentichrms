import { useState, useRef, useEffect } from 'react'
import DOMPurify from 'dompurify'

import Login from './components/Login'
import Register from './components/Register'
import Dashboard from './components/Dashboard'
import NotificationBell from './components/NotificationBell'
import LeaveRequests from './components/LeaveRequests'
import AdminPanel from './components/AdminPanel'
import HRPanel from './components/HRPanel'
import OnboardingChat from './components/OnboardingChat'
import ProfileView from './components/ProfileView'
import ConflictPopup from './components/ConflictPopup'
import NameChangePopup from './components/NameChangePopup'
import SessionSidebar from './components/SessionSidebar'
import DocumentLibrary from './components/DocumentLibrary'

import { useAuth } from './hooks/useAuth'
import { useChatSessions } from './hooks/useChatSessions'
import { useChatMessages } from './hooks/useChatMessages'
import { useSpeech } from './hooks/useSpeech'

const API = '/api'

// ── Helpers (non-component, kept here as they're small) ──────────────────────
function generateHighlightedHtml(fullText) { return fullText }
function _contentToLines(text) {
    if (!text) return []
    return text.split('\n').map((t, i) => ({
        num: i + 1,
        html: t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'),
        highlighted: false,
    }))
}

// ── Icons ─────────────────────────────────────────────────────────────────────
const SpeakerIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M3 9v6h4l5 5V4L7 9H3z" /><path d="M16.5 8.5c2 1.5 2 5.5 0 7" /><path d="M19 5c3 2.5 3 9.5 0 12" /></svg>)
const ThumbUpIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M14 9V5a3 3 0 0 0-3-3l-4 9v11h10.5a3 3 0 0 0 3-3l1-5a3 3 0 0 0-3-3h-4.5zM5 19H3a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1h2v8z" /></svg>)
const ThumbDownIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M10 15v4a3 3 0 0 0 3 3l4-9V5H6.5a3 3 0 0 0-3 3l-1 5a3 3 0 0 0 3 3H10zM19 5h2a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-2V5z" /></svg>)
const RegenerateIcon = () => (<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M23 4v6h-6" /><path d="M1 20v-6h6" /><path d="M3.51 9a9 9 0 0114.85-3.36L23 10" /><path d="M20.49 15a9 9 0 01-14.85 3.36L1 14" /></svg>)
const SunIcon = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></svg>)
const MoonIcon = () => (<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" /></svg>)

const actionBarStyle = { display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: '2px', marginTop: '10px', paddingTop: '8px', borderTop: '1px solid var(--border)' }
const btnBase = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '28px', height: '28px', background: 'transparent', border: 'none', borderRadius: '6px', cursor: 'pointer', color: 'var(--text-muted)', transition: 'background 0.15s, color 0.15s', padding: 0 }

export default function App() {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const { authed, employee, handleLoginSuccess, handleLogout, updateEmployee } = useAuth()
    const [showRegister, setShowRegister] = useState(false)
    const [view, setView] = useState(() => {
        try {
            const emp = JSON.parse(localStorage.getItem('hrms_employee') || '{}')
            return ['hr', 'admin'].includes((emp.role || '').toLowerCase()) ? 'admin' : 'chat'
        } catch { return 'chat' }
    })

    // ── Theme ─────────────────────────────────────────────────────────────────
    const [theme, setTheme] = useState(() => localStorage.getItem('hrms_theme') || 'dark')
    useEffect(() => {
        document.body.classList.remove('theme-dark', 'theme-light')
        document.body.classList.add(`theme-${theme}`)
        localStorage.setItem('hrms_theme', theme)
    }, [theme])
    const toggleTheme = () => setTheme(prev => prev === 'dark' ? 'light' : 'dark')

    // ── Sessions ──────────────────────────────────────────────────────────────
    const sessions = useChatSessions(authed)

    // ── Messages ──────────────────────────────────────────────────────────────
    const chat = useChatMessages()
    const welcomedSessions = useRef(new Set())

    // ── Speech ────────────────────────────────────────────────────────────────
    const speech = useSpeech()
    const [likedMsgs, setLikedMsgs] = useState({})
    const [dislikedMsgs, setDislikedMsgs] = useState({})
    const handleLike = (i) => { setLikedMsgs(p => ({ ...p, [i]: !p[i] })); if (dislikedMsgs[i]) setDislikedMsgs(p => ({ ...p, [i]: false })) }
    const handleDislike = (i) => { setDislikedMsgs(p => ({ ...p, [i]: !p[i] })); if (likedMsgs[i]) setLikedMsgs(p => ({ ...p, [i]: false })) }

    // ── Source preview ────────────────────────────────────────────────────────
    const [expandedIdx, setExpandedIdx] = useState(null)
    const [previewData, setPreviewData] = useState(null)
    const [docCount, setDocCount] = useState(0)
    const [input, setInput] = useState('')
    const chatEnd = useRef(null)

    // ── Effects ───────────────────────────────────────────────────────────────
    useEffect(() => {
        if (authed) {
            sessions.fetchSessions((sorted) => {
                if (sorted.length > 0) {
                    sessions.setCurrentSessionId(sorted[0].id)
                    chat.loadMessages(sorted[0].id)
                } else {
                    sessions.createNewSession()
                }
            })
            fetch(`${API}/documents`).then(r => r.json()).then(d => setDocCount(d.documents?.length ?? 0)).catch(() => { })
        } else {
            sessions.clearSessions()
            chat.clearMessages()
            welcomedSessions.current.clear()
        }
    }, [authed])

    useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }) }, [chat.messages, chat.loading])

    // Welcome message
    useEffect(() => {
        if (sessions.loadingSessions || !sessions.currentSessionId || !employee) return
        if (chat.loadingMsgs.current) return
        if (welcomedSessions.current.has(sessions.currentSessionId)) return
        if (chat.messages.length === 0) {
            welcomedSessions.current.add(sessions.currentSessionId)
            const h = new Date().getHours()
            const g = h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening'
            chat.setMessages([{ role: 'assistant', content: `${g}, ${employee.name || 'there'}! I'm your HR Assistant. I can help you with policies, leave requests, employee info, onboarding tasks, and more. How can I assist you today?`, sources: [], steps: [] }])
        } else {
            welcomedSessions.current.add(sessions.currentSessionId)
        }
    }, [sessions.currentSessionId, chat.messages.length, employee, sessions.loadingSessions])

    // ── Handlers ──────────────────────────────────────────────────────────────
    const onLogout = () => { handleLogout(); setView('chat') }

    const selectSession = (id) => {
        sessions.setCurrentSessionId(id)
        chat.loadMessages(id)
        sessions.setMenuOpen(null)
    }

    const onDeleteSession = (id) => {
        sessions.deleteSession(id, sessions.currentSessionId, (wasActive) => {
            if (wasActive) sessions.createNewSession().then(newId => { if (newId) chat.loadMessages(newId) })
        })
    }

    const sendMsg = (text) => {
        chat.sendMessage(text, {
            sessionId: sessions.currentSessionId,
            onLogout,
            onTitleUpdate: sessions.updateSessionTitle,
        })
    }

    const handlePageChange = (dir) => {
        if (!previewData) return
        const list = previewData.pages || previewData.segments; if (!list) return
        const ni = previewData.currentIndex + dir
        if (ni < 0 || ni >= list.length) return
        const item = list[ni]
        const rawText = item.text || item.content || ''
        const lines = _contentToLines(rawText)
        setPreviewData({ ...previewData, currentIndex: ni, lines })
    }

    const togglePreview = (idx, source) => {
        if (expandedIdx === idx) { setExpandedIdx(null); setPreviewData(null); return }
        setExpandedIdx(idx)
        const ext = source.source_file.split('.').pop().toLowerCase()
        const lastMsg = [...chat.messages].reverse().find(m => m.role === 'assistant')
        const answerContext = lastMsg ? lastMsg.content : ''
        if (ext === 'pdf' && Array.isArray(source.full_content)) {
            const si = Math.max(0, source.full_content.findIndex(p => p.page === source.page))
            setPreviewData({ type: 'pdf-snippet', lines: _contentToLines(source.full_content[si]?.text || ''), pages: source.full_content, currentIndex: si, chunks: source.chunks || [], answerContext })
        } else {
            const rawContent = source.content || (source.segments || []).map(s => s.content).join('\n\n---\n\n') || answerContext || ''
            setPreviewData({ type: 'text-snippet', lines: _contentToLines(rawContent), segments: source.segments || [{ content: rawContent }], currentIndex: 0, chunks: source.chunks || [], answerContext, isFallbackAnswer: !source.content })
        }
    }

    const latestSources = (() => { for (let i = chat.messages.length - 1; i >= 0; i--) if (chat.messages[i].role === 'assistant' && chat.messages[i].sources?.length) return chat.messages[i].sources; return [] })()

    // ── Pre-auth screens ──────────────────────────────────────────────────────
    if (!authed) {
        if (showRegister) return <Register onBackToLogin={() => setShowRegister(false)} />
        return <Login onSuccess={handleLoginSuccess} onRegisterClick={() => setShowRegister(true)} />
    }

    const ThemeIcon = theme === 'dark' ? SunIcon : MoonIcon
    const token = localStorage.getItem('hrms_token')
    const isAdminOrHr = employee && ['admin', 'hr'].includes(employee.role)

    return (
        <div className={`app-layout ${view === 'profile' ? 'profile-mode' : ''}`}>

            {/* ── Popups ── */}
            {chat.conflictPopup && (
                <ConflictPopup
                    popup={chat.conflictPopup}
                    onProceed={() => chat.handleConflictProceed(sessions.currentSessionId)}
                    onReschedule={() => chat.handleConflictReschedule(sessions.currentSessionId)}
                    onCancel={() => chat.handleConflictCancel(sessions.currentSessionId)}
                    onDismiss={chat.handleConflictDismiss}
                />
            )}
            {chat.nameChangePopup && (
                <NameChangePopup popup={chat.nameChangePopup} onClose={() => chat.setNameChangePopup(null)} />
            )}

            <style>{`
                .msg-action-btn { color: var(--text-muted) !important; transition: background 0.15s, color 0.15s; }
                .msg-action-btn:hover { background: rgba(79,142,247,0.1) !important; color: var(--accent) !important; }
                .msg-action-btn.active-btn { color: var(--accent) !important; background: rgba(79,142,247,0.12) !important; }
                .msg-action-btn.liked { color: var(--green) !important; background: rgba(52,211,153,0.1) !important; }
                .msg-action-btn.disliked { color: var(--red) !important; background: rgba(248,113,113,0.1) !important; }
                .user-msg-actions { opacity: 0 !important; transition: opacity 0.15s; }
                .msg-user:hover .user-msg-actions { opacity: 1 !important; }
                .theme-toggle-icon { background: transparent; border: none; cursor: pointer; display: flex; align-items: center; justify-content: center; width: 32px; height: 32px; border-radius: 8px; color: var(--text-secondary); transition: all 0.2s; }
                .theme-toggle-icon:hover { background: var(--accent-dim); color: var(--accent); }
            `}</style>

            {/* ── Sidebar ── */}
            <SessionSidebar
                employee={employee}
                view={view}
                docCount={docCount}
                sessions={sessions.sessions}
                currentSessionId={sessions.currentSessionId}
                loadingSessions={sessions.loadingSessions}
                menuOpen={sessions.menuOpen}
                onNewSession={() => sessions.createNewSession().then(id => { if (id) { chat.clearMessages(); sessions.setCurrentSessionId(id) } })}
                onSelectSession={selectSession}
                onRename={sessions.renameSession}
                onTogglePin={sessions.togglePinSession}
                onDelete={onDeleteSession}
                onSetMenuOpen={sessions.setMenuOpen}
                onClearMessages={() => { chat.clearMessages(); setExpandedIdx(null); setPreviewData(null) }}
                onLogout={onLogout}
                onProfileClick={() => setView('profile')}
                onDocumentsClick={() => setView('documents')}
            />

            {/* ── Main content ── */}
            {isAdminOrHr && (view === 'admin' || view === 'leaveRequests') ? (
                <main style={{ gridColumn: '2 / -1', overflow: 'auto', background: 'var(--bg-primary)', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '14px 28px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)', backdropFilter: 'blur(12px)', position: 'sticky', top: 0, zIndex: 100 }}>
                        <button onClick={() => setView('chat')} style={{ background: 'transparent', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 16px', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer' }}>← Chat</button>
                        <div style={{ flex: 1 }} />
                        <button className="theme-toggle-icon" onClick={toggleTheme} title="Toggle theme"><ThemeIcon /></button>
                        <NotificationBell token={token} />
                    </div>
                    <div style={{ flex: 1, overflow: 'auto' }}>
                        {view === 'leaveRequests'
                            ? <LeaveRequests token={token} />
                            : employee?.role === 'hr'
                                ? <HRPanel token={token} />
                                : <AdminPanel token={token} />
                        }
                    </div>
                </main>
            ) : view === 'chat' ? (
                <main className="chat-panel">
                    <div className="chat-header" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>Chat</span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            {isAdminOrHr && (
                                <button onClick={() => setView('admin')} style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', borderRadius: 7, padding: '5px 13px', color: 'var(--accent)', fontSize: 12, cursor: 'pointer' }}>
                                    {employee.role === 'hr' ? 'HR Dashboard' : 'Admin Dashboard'}
                                </button>
                            )}
                            <button className="theme-toggle-icon" onClick={toggleTheme} title="Toggle theme"><ThemeIcon /></button>
                            <NotificationBell token={token} />
                        </div>
                    </div>

                    <div className="chat-messages">
                        {chat.messages.map((msg, i) => (
                            msg.role === 'user' ? (
                                <div key={i} className="msg-user" style={{ flexDirection: 'column', alignItems: 'flex-end', gap: 4 }}>
                                    <div className="msg-user-bubble">{msg.content}</div>
                                    <div style={{ display: 'flex', gap: 2, opacity: 0.5 }} className="user-msg-actions">
                                        <button className="msg-action-btn" style={btnBase} title="Copy" onClick={() => navigator.clipboard.writeText(msg.content)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><rect x="9" y="9" width="13" height="13" rx="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg></button>
                                        <button className="msg-action-btn" style={btnBase} title="Edit & resend" onClick={() => setInput(msg.content)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg></button>
                                        <button className="msg-action-btn" style={btnBase} title="Resend" onClick={() => sendMsg(msg.content)}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M22 2L11 13" /><path d="M22 2L15 22l-4-9-9-4 20-7z" /></svg></button>
                                    </div>
                                </div>
                            ) : (
                                <div key={i} className="msg-assistant">
                                    <div className="answer-card">
                                        <div className="answer-content">{msg.content.split('\n').map((line, j) => <p key={j}>{line || '\u00A0'}</p>)}</div>
                                        {msg.sources?.length > 0 && <div className="sources-list">{msg.sources.map((s, j) => <span key={j} className="source-tag"> {s.source_file} — {s.section}</span>)}</div>}
                                        <div style={actionBarStyle}>
                                            <button className={`msg-action-btn ${speech.playingMsgIndex === i ? 'active-btn' : ''}`} style={btnBase} onClick={() => speech.speakText(msg.content, i)}><SpeakerIcon /></button>
                                            <button className={`msg-action-btn ${likedMsgs[i] ? 'liked' : ''}`} style={btnBase} onClick={() => handleLike(i)}><ThumbUpIcon /></button>
                                            <button className={`msg-action-btn ${dislikedMsgs[i] ? 'disliked' : ''}`} style={btnBase} onClick={() => handleDislike(i)}><ThumbDownIcon /></button>
                                            <button className="msg-action-btn" style={btnBase} onClick={() => chat.regenerate({ sessionId: sessions.currentSessionId, onLogout, onTitleUpdate: sessions.updateSessionTitle })}><RegenerateIcon /></button>
                                        </div>
                                    </div>
                                </div>
                            )
                        ))}
                        {chat.loading && <div className="thinking"><div className="dots"><span /><span /><span /></div>Searching knowledge base...</div>}
                        <div ref={chatEnd} />
                    </div>

                    <div className="chat-input-area">
                        <div className="chat-input-wrap">
                            <input
                                value={input}
                                onChange={e => setInput(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMsg(input); setInput('') } }}
                                placeholder="Ask about HR policies, employees, leave..."
                                disabled={chat.loading}
                            />
                            <button onClick={() => speech.startVoiceRecognition(setInput)} disabled={chat.loading || speech.isListening || speech.isSpeaking || speech.voiceCooldown} className={`mic-button ${speech.isListening ? 'listening' : ''}`} title="Voice input">
                                <svg width="24" height="24" viewBox="0 0 24 24" fill="none"><rect x="9" y="4" width="6" height="10" rx="3" fill="white" /><path d="M6 11C6 14.3137 8.68629 17 12 17C15.3137 17 18 14.3137 18 11" stroke="white" strokeWidth="1.5" /><path d="M12 17V20" stroke="white" strokeWidth="1.5" /><rect x="10" y="20" width="4" height="2" rx="1" fill="white" /></svg>
                            </button>
                            <button onClick={() => { sendMsg(input); setInput('') }} disabled={chat.loading || !input.trim()}>↑</button>
                        </div>
                    </div>
                </main>
            ) : view === 'documents' ? (
                <main style={{ gridColumn: '2 / -1', overflow: 'auto', background: 'var(--bg-primary)', minHeight: '100vh' }}>
                    <DocumentLibrary onBack={() => setView('chat')} />
                </main>
            ) : (
                <main className="dashboard-panel">
                    {view === 'profile'
                        ? <ProfileView employee={employee} token={token} onBack={() => setView('chat')} onSaved={updateEmployee} />
                        : <Dashboard employee={employee} />
                    }
                </main>
            )}

            {/* ── Source preview panel ── */}
            <aside className="preview-panel" style={{ display: (['admin', 'leaveRequests', 'profile', 'documents'].includes(view)) ? 'none' : undefined }}>
                <div className="preview-header"><span>Source Preview</span></div>
                {latestSources.length === 0 ? (
                    <div className="preview-empty"><div className="icon"></div><p>Source documents appear here when the assistant cites them.</p></div>
                ) : (
                    <div className="preview-list">
                        {latestSources.map((src, idx) => {
                            const ext = src.source_file.split('.').pop().toLowerCase()
                            const isExpanded = expandedIdx === idx
                            return (
                                <div key={idx} className={`source-card${(!src.content && !src.full_content && ['pdf', 'docx'].includes(ext)) ? ' source-card-missing' : ''}`}>
                                    <div className="source-card-header">
                                        <div className="source-card-info">
                                            <div className="source-card-name">{ext === 'pdf' ? '' : ext === 'md' ? '' : ext === 'docx' ? '' : ''} {src.source_file}</div>
                                            <div className="source-card-loc">📍 {src.section || 'General'}</div>
                                        </div>
                                        <button className={`source-card-toggle${isExpanded ? ' active' : ''}`} onClick={() => togglePreview(idx, src)}>{isExpanded ? 'Close' : 'Open'}</button>
                                    </div>
                                    {isExpanded && previewData && (
                                        <>
                                            {previewData.isFallbackAnswer && <div style={{ padding: '8px 12px', background: 'rgba(99,102,241,0.08)', borderRadius: 6, margin: '8px 0 4px', fontSize: 11, color: '#818cf8' }}>Showing the assistant's answer — full document not available.</div>}
                                            {['pdf-snippet', 'text-snippet'].includes(previewData.type) && (
                                                <div className="pdf-preview-container">
                                                    {(previewData.pages?.length > 1 || previewData.segments?.length > 1) && (
                                                        <div className="pdf-pagination">
                                                            <button onClick={() => handlePageChange(-1)} disabled={previewData.currentIndex === 0} className="pdf-nav-btn">← Prev</button>
                                                            <span className="pdf-page-indicator">{previewData.pages ? `Page ${previewData.pages[previewData.currentIndex].page}` : `Segment ${previewData.currentIndex + 1}`}<span className="pdf-page-count">({previewData.currentIndex + 1} of {(previewData.pages || previewData.segments).length})</span></span>
                                                            <button onClick={() => handlePageChange(1)} disabled={previewData.currentIndex === (previewData.pages || previewData.segments).length - 1} className="pdf-nav-btn">Next →</button>
                                                        </div>
                                                    )}
                                                    <div className="code-viewer">
                                                        {(previewData.lines || []).map((line, li) => (
                                                            <div key={li} className={`code-line${line.highlighted ? ' highlighted' : ''}`}>
                                                                <span className="line-num">{line.num}</span>
                                                                <span className="line-text" dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(line.html) }} />
                                                            </div>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                            {previewData.type === 'content' && <div className="pdf-content-preview"><pre>{previewData.content}</pre></div>}
                                        </>
                                    )}
                                </div>
                            )
                        })}
                        {chat.messages.length > 0 && chat.messages[chat.messages.length - 1].steps?.length > 0 && (
                            <details className="agent-steps">
                                <summary>⚙ Agent Steps ({chat.messages[chat.messages.length - 1].steps.length})</summary>
                                {chat.messages[chat.messages.length - 1].steps.map((step, i) => <div key={i} className="step">→ {step.name || step.type}</div>)}
                            </details>
                        )}
                    </div>
                )}
            </aside>
        </div>
    )
}