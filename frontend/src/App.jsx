import { useState, useRef, useEffect } from 'react'

const API = '/api'

const QUICK_QUESTIONS = [
    'Maternity policy',
    'What is moonlighting disclosure?',
    'Remote work policy',
    'What are the leave types?',
    'Onboarding guidelines',
    'Look up Rahul Sharma',
    'Department headcount',
    'Check leave balance for Rahul',
]

export default function App() {
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [docCount, setDocCount] = useState(0)
    const [expandedIdx, setExpandedIdx] = useState(null)
    const [previewLines, setPreviewLines] = useState(null)
    const chatEnd = useRef(null)

    useEffect(() => {
        fetch(`${API}/documents`).then(r => r.json()).then(d => setDocCount(d.documents.length)).catch(() => { })
    }, [])

    useEffect(() => {
        chatEnd.current?.scrollIntoView({ behavior: 'smooth' })
    }, [messages, loading])

    const latestSources = (() => {
        for (let i = messages.length - 1; i >= 0; i--) {
            if (messages[i].role === 'assistant' && messages[i].sources?.length) return messages[i].sources
        }
        return []
    })()

    async function sendMessage(text) {
        if (!text.trim() || loading) return
        const userMsg = { role: 'user', content: text }
        setMessages(prev => [...prev, userMsg])
        setInput('')
        setLoading(true)
        setExpandedIdx(null)
        setPreviewLines(null)

        try {
            const res = await fetch(`${API}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: text }),
            })
            const data = await res.json()
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: data.answer,
                sources: data.sources || [],
                steps: data.steps || [],
            }])
        } catch (err) {
            setMessages(prev => [...prev, {
                role: 'assistant',
                content: `Error: ${err.message}`,
                sources: [],
                steps: [],
            }])
        }
        setLoading(false)
    }

    async function togglePreview(idx, source) {
        if (expandedIdx === idx) {
            setExpandedIdx(null)
            setPreviewLines(null)
            return
        }
        setExpandedIdx(idx)

        const ext = source.source_file.split('.').pop().toLowerCase()
        if (['md', 'txt'].includes(ext)) {
            try {
                const res = await fetch(`${API}/document-preview`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        source_file: source.source_file,
                        start_line: source.start_line,
                        end_line: source.end_line,
                    }),
                })
                const data = await res.json()
                setPreviewLines(data)
            } catch {
                setPreviewLines(null)
            }
        } else {
            setPreviewLines({ type: 'content', content: source.content })
        }
    }

    function handleKeyDown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendMessage(input)
        }
    }

    return (
        <div className="app-layout">
            {/* ── Sidebar ─── */}
            <aside className="sidebar">
                <div className="sidebar-brand">
                    <div className="sidebar-logo">H</div>
                    <div>
                        <div className="sidebar-title">HR Assistant</div>
                        <div className="sidebar-subtitle">AI-POWERED HRMS</div>
                    </div>
                </div>

                <div className="sidebar-status">
                    <span className="dot" />
                    Knowledge base connected · {docCount} documents
                </div>

                <div className="sidebar-section">Quick Questions</div>
                {QUICK_QUESTIONS.map(q => (
                    <button key={q} className="sidebar-btn" onClick={() => sendMessage(q)}>
                        {q}
                    </button>
                ))}

                <button className="sidebar-clear" onClick={() => {
                    setMessages([])
                    setExpandedIdx(null)
                    setPreviewLines(null)
                }}>
                    🗑 Clear conversation
                </button>
            </aside>

            {/* ── Chat Panel ─── */}
            <main className="chat-panel">
                <div className="chat-header">
                    <span>💬</span> Chat
                </div>

                <div className="chat-messages">
                    {messages.length === 0 && !loading && (
                        <div className="empty-state">
                            <div className="icon">💼</div>
                            <h3>HR Policy Assistant</h3>
                            <p>Ask me about company policies, employee info, leave management, onboarding, or send emails.</p>
                        </div>
                    )}

                    {messages.map((msg, i) => (
                        msg.role === 'user' ? (
                            <div key={i} className="msg-user">
                                <div className="msg-user-bubble">{msg.content}</div>
                            </div>
                        ) : (
                            <div key={i} className="msg-assistant">
                                <div className="answer-card">
                                    {msg.content.split('\n').map((line, j) => (
                                        <p key={j}>{line || '\u00A0'}</p>
                                    ))}
                                    {msg.sources?.length > 0 && (
                                        <div className="sources-list">
                                            {msg.sources.map((s, j) => (
                                                <span key={j} className="source-tag">
                                                    📄 {s.source_file} — {s.section}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            </div>
                        )
                    ))}

                    {loading && (
                        <div className="thinking">
                            <div className="dots"><span /><span /><span /></div>
                            Searching knowledge base...
                        </div>
                    )}
                    <div ref={chatEnd} />
                </div>

                <div className="chat-input-area">
                    <div className="chat-input-wrap">
                        <input
                            value={input}
                            onChange={e => setInput(e.target.value)}
                            onKeyDown={handleKeyDown}
                            placeholder="Ask about HR policies, employees, leave..."
                            disabled={loading}
                        />
                        <button onClick={() => sendMessage(input)} disabled={loading || !input.trim()}>
                            ↑
                        </button>
                    </div>
                </div>
            </main>

            {/* ── Preview Panel ─── */}
            <aside className="preview-panel">
                <div className="preview-header">📎 Source Preview</div>

                {latestSources.length === 0 ? (
                    <div className="preview-empty">
                        <div className="icon">📋</div>
                        <p>Source documents will appear here when the assistant cites them.</p>
                    </div>
                ) : (
                    <div className="preview-list">
                        {latestSources.map((src, idx) => {
                            const ext = src.source_file.split('.').pop().toLowerCase()
                            const isMissing = !src.content && ['pdf', 'docx'].includes(ext)
                            const isExpanded = expandedIdx === idx

                            return (
                                <div key={idx} className={`source-card${isMissing ? ' source-card-missing' : ''}`}>
                                    <div className="source-card-header">
                                        <div className="source-card-info">
                                            <div className="source-card-name">
                                                {ext === 'pdf' ? '📕' : ext === 'md' ? '📘' : ext === 'docx' ? '📝' : '📄'}{' '}
                                                {src.source_file}
                                            </div>
                                            <div className="source-card-loc">
                                                📍 {src.section} · Lines {src.start_line}–{src.end_line}
                                            </div>
                                        </div>
                                        <button
                                            className={`source-card-toggle${isExpanded ? ' active' : ''}`}
                                            onClick={() => togglePreview(idx, src)}
                                        >
                                            {isExpanded ? 'Close' : 'Open'}
                                        </button>
                                    </div>

                                    {isExpanded && previewLines && (
                                        previewLines.type === 'text' ? (
                                            <div className="code-viewer">
                                                {previewLines.lines.map((line, li) => (
                                                    <div key={li} className={`code-line${line.highlighted ? ' highlighted' : ''}`}>
                                                        <span className="line-num">{line.num}</span>
                                                        <span className="line-text">{line.text}</span>
                                                    </div>
                                                ))}
                                            </div>
                                        ) : (
                                            <div className="pdf-content-preview">
                                                <div className="pdf-label">
                                                    📄 {src.source_file} — {src.section}
                                                </div>
                                                {previewLines.content || src.content || 'Content not available for preview.'}
                                            </div>
                                        )
                                    )}
                                </div>
                            )
                        })}

                        {/* Agent steps */}
                        {messages.length > 0 && messages[messages.length - 1].steps?.length > 0 && (
                            <details className="agent-steps">
                                <summary>⚙ Agent Steps ({messages[messages.length - 1].steps.length})</summary>
                                {messages[messages.length - 1].steps.map((step, i) => (
                                    <div key={i} className="step">→ {step.name || step.type}</div>
                                ))}
                            </details>
                        )}
                    </div>
                )}
            </aside>
        </div>
    )
}
