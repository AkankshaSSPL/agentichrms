import { useState, useRef, useEffect } from 'react'
import DOMPurify from 'dompurify'
import Login from './components/Login'
import Register from './components/Register'

const API = '/api'

const QUICK_QUESTIONS = [
    'Maternity policy',
    'What is moonlighting disclosure?',
    'Remote work policy',
    'What are the leave types?',
    'Onboarding guidelines',
    'Department headcount',
    'Check leave balance for Rahul',
]

function escapeHtml(text) {
    return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;').replace(/'/g, '&#039;')
}

function generateHighlightedHtml(fullText, chunks, answer = '', isSnippet = true, query = '') {
    if (!fullText) return isSnippet ? { html: '', lines: [] } : '<p>No text available</p>'
    let searchTerms = []
    if (query && query.trim().length > 3) {
        searchTerms.push(query.trim())
        searchTerms = [...searchTerms, ...query.trim().split(/\s+/).filter(w => w.length > 4)]
    }
    ; (chunks || []).forEach(c => { if (c && c.trim().length > 15) searchTerms.push(c.trim()) })
    if (answer) {
        const boldMatches = answer.match(/\*\*(.*?)\*\*/g)
        if (boldMatches) boldMatches.forEach(m => { const c = m.replace(/\*\*/g, '').trim(); if (c.length > 3) searchTerms.push(c) })
        const clean = answer.replace(/[\*\_#\>~`\[\]\(\)"']/g, ' ').replace(/\s+/g, ' ')
        searchTerms = [...searchTerms, ...clean.split(/[.!?\n]/).filter(s => s.trim().length > 18).map(s => s.trim())]
    }
    const sorted = Array.from(new Set(searchTerms)).filter(Boolean).sort((a, b) => b.length - a.length)
    const lines = fullText.split('\n')
    const matched = new Set()
    sorted.forEach(chunk => {
        const esc = chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const rx = esc.split(/\s+/).filter(w => w.length > 0).join('\\s+')
        if (!rx) return
        try { const re = new RegExp(rx, 'gi'); lines.forEach((l, i) => { if (re.test(l.replace(/\s+/g, ' '))) matched.add(i) }) } catch { }
    })
    let blocks = [], cur = []
    lines.forEach((l, i) => { if (l.trim()) cur.push(i); else { if (cur.length) blocks.push(cur); cur = [] } })
    if (cur.length) blocks.push(cur)
    const highlights = new Set()
    blocks.forEach(b => { if (b.some(i => matched.has(i))) b.forEach(i => highlights.add(i)) })
    if (isSnippet) {
        let ctx = new Set()
        if (highlights.size === 0) { for (let i = 0; i < Math.min(lines.length, 50); i++) ctx.add(i) }
        else highlights.forEach(i => { for (let j = Math.max(0, i - 5); j <= Math.min(lines.length - 1, i + 5); j++) ctx.add(j) })
        const idxs = Array.from(ctx).sort((a, b) => a - b)
        const out = []; let last = -1
        idxs.forEach(i => {
            if (last !== -1 && i > last + 1) out.push({ num: '...', text: '...', html: '<div class="preview-ellipsis">...</div>', highlighted: false })
            out.push({ num: i + 1, text: lines[i], html: generateHighlightedHtml(lines[i], chunks, answer, false, query), highlighted: highlights.has(i) })
            last = i
        })
        return { html: '', lines: out }
    }
    let html = escapeHtml(fullText)
    sorted.forEach(chunk => {
        const esc = chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
        const rx = esc.split(/\s+/).filter(w => w.length > 0).join('\\s+')
        if (!rx) return
        try { html = html.replace(new RegExp(rx, 'gi'), m => `<mark>${m}</mark>`) } catch { }
    })
    return html.replace(/\n/g, '<br>')
}

export default function App() {
    // ── Auth ──────────────────────────────────────────────────────────────────
    const [authed, setAuthed] = useState(() => !!localStorage.getItem('hrms_token'))
    const [employee, setEmployee] = useState(() => {
        try { return JSON.parse(localStorage.getItem('hrms_employee') || 'null') } catch { return null }
    })
    const [showRegister, setShowRegister] = useState(false)

    function handleLoginSuccess(token, emp) {
        localStorage.setItem('hrms_token', token)
        localStorage.setItem('hrms_employee', JSON.stringify(emp))
        setEmployee(emp)
        setAuthed(true)
    }

    function handleLogout() {
        localStorage.removeItem('hrms_token')
        localStorage.removeItem('hrms_employee')
        setEmployee(null)
        setMessages([])
        setAuthed(false)
    }

    // ── Chat ──────────────────────────────────────────────────────────────────
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [docCount, setDocCount] = useState(0)
    const [expandedIdx, setExpandedIdx] = useState(null)
    const [previewData, setPreviewData] = useState(null)
    const chatEnd = useRef(null)

    useEffect(() => {
        if (!authed) return
        fetch(`${API}/documents`).then(r => r.json()).then(d => setDocCount(d.documents?.length ?? 0)).catch(() => { })
    }, [authed])

    useEffect(() => { chatEnd.current?.scrollIntoView({ behavior: 'smooth' }) }, [messages, loading])

    // ── Render login/register if not authed ───────────────────────────────────
    if (!authed) {
        if (showRegister) {
            return <Register onBackToLogin={() => setShowRegister(false)} />
        }
        return <Login onSuccess={handleLoginSuccess} onRegisterClick={() => setShowRegister(true)} />
    }

    // ── Chat helpers ───────────────────────────────────────────────────────────
    const latestSources = (() => {
        for (let i = messages.length - 1; i >= 0; i--)
            if (messages[i].role === 'assistant' && messages[i].sources?.length) return messages[i].sources
        return []
    })()

    const lastUserQuery = (() => {
        const m = [...messages].reverse().find(m => m.role === 'user')
        return m ? m.content : ''
    })()

    const handlePageChange = (dir) => {
        if (!previewData) return
        const list = previewData.pages || previewData.segments
        if (!list) return
        const ni = previewData.currentIndex + dir
        if (ni < 0 || ni >= list.length) return
        const item = list[ni]
        const result = generateHighlightedHtml(item.text || item.content || '', previewData.chunks, previewData.answerContext, true, lastUserQuery)
        setPreviewData({ ...previewData, currentIndex: ni, lines: result.lines || [] })
    }

    async function sendMessage(text) {
        if (!text.trim() || loading) return
        const token = localStorage.getItem('hrms_token')
        setMessages(prev => [...prev, { role: 'user', content: text }])
        setInput(''); setLoading(true); setExpandedIdx(null); setPreviewData(null)
        try {
            const res = await fetch(`${API}/chat`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
                body: JSON.stringify({ message: text }),
            })
            if (res.status === 401) { handleLogout(); return }
            const data = await res.json()
            setMessages(prev => [...prev, { role: 'assistant', content: data.answer, sources: data.sources || [], steps: data.steps || [] }])
        } catch (err) {
            setMessages(prev => [...prev, { role: 'assistant', content: `Error: ${err.message}`, sources: [], steps: [] }])
        }
        setLoading(false)
    }

    async function togglePreview(idx, source) {
        if (expandedIdx === idx) { setExpandedIdx(null); setPreviewData(null); return }
        setExpandedIdx(idx)
        const ext = source.source_file.split('.').pop().toLowerCase()
        const lastMsg = [...messages].reverse().find(m => m.role === 'assistant')
        const answerContext = lastMsg ? lastMsg.content : ''
        if (ext === 'pdf' && Array.isArray(source.full_content)) {
            const mIdx = source.full_content.findIndex(p => p.page === source.page)
            const si = mIdx >= 0 ? mIdx : 0
            const res = generateHighlightedHtml(source.full_content[si].text, source.chunks || [], answerContext, true, lastUserQuery)
            setPreviewData({ type: 'pdf-snippet', lines: res.lines, pages: source.full_content, currentIndex: si, chunks: source.chunks || [], answerContext })
        } else if (['md', 'txt', 'docx'].includes(ext)) {
            const res = generateHighlightedHtml(source.content || '', source.chunks || [], answerContext, true, lastUserQuery)
            setPreviewData({ type: 'text-snippet', lines: res.lines, segments: source.segments || [{ content: source.content }], currentIndex: 0, chunks: source.chunks || [], answerContext })
        } else {
            setPreviewData({ type: 'content', content: source.content || 'No content available.' })
        }
    }

    return (
        <div className="app-layout">
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
                    Knowledge base · {docCount} docs
                </div>
                {employee && (
                    <div style={{
                        background: 'rgba(52,211,153,.08)', border: '1px solid rgba(52,211,153,.2)',
                        borderRadius: 8, padding: '8px 12px', fontSize: 12, color: '#34d399', marginBottom: 8,
                    }}>
                        👤 {employee.name}
                        {employee.department && <span style={{ color: '#4a5168', marginLeft: 4 }}>· {employee.department}</span>}
                    </div>
                )}
                <div className="sidebar-section">Quick Questions</div>
                {QUICK_QUESTIONS.map(q => (
                    <button key={q} className="sidebar-btn" onClick={() => sendMessage(q)}>{q}</button>
                ))}
                <button className="sidebar-clear" onClick={() => { setMessages([]); setExpandedIdx(null); setPreviewData(null) }}>
                    🗑 Clear conversation
                </button>
                <button className="sidebar-clear" onClick={handleLogout} style={{ marginTop: 4, borderColor: 'rgba(248,113,113,.3)', color: '#f87171' }}>
                    🔓 Logout
                </button>
            </aside>

            <main className="chat-panel">
                <div className="chat-header"><span>💬</span> Chat</div>
                <div className="chat-messages">
                    {messages.length === 0 && !loading && (
                        <div className="empty-state">
                            <div className="icon">💼</div>
                            <h3>HR Policy Assistant</h3>
                            <p>Ask about policies, employees, leave, or onboarding.</p>
                        </div>
                    )}
                    {messages.map((msg, i) => (
                        msg.role === 'user' ? (
                            <div key={i} className="msg-user"><div className="msg-user-bubble">{msg.content}</div></div>
                        ) : (
                            <div key={i} className="msg-assistant">
                                <div className="answer-card">
                                    {msg.content.split('\n').map((line, j) => <p key={j}>{line || '\u00A0'}</p>)}
                                    {msg.sources?.length > 0 && (
                                        <div className="sources-list">
                                            {msg.sources.map((s, j) => (
                                                <span key={j} className="source-tag">📄 {s.source_file} — {s.section}</span>
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
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input) } }}
                            placeholder="Ask about HR policies, employees, leave..."
                            disabled={loading}
                        />
                        <button onClick={() => sendMessage(input)} disabled={loading || !input.trim()}>↑</button>
                    </div>
                </div>
            </main>

            <aside className="preview-panel">
                <div className="preview-header">📎 Source Preview</div>
                {latestSources.length === 0 ? (
                    <div className="preview-empty">
                        <div className="icon">📋</div>
                        <p>Source documents appear here when the assistant cites them.</p>
                    </div>
                ) : (
                    <div className="preview-list">
                        {latestSources.map((src, idx) => {
                            const ext = src.source_file.split('.').pop().toLowerCase()
                            const isMissing = !src.content && !src.full_content && ['pdf', 'docx'].includes(ext)
                            const isExpanded = expandedIdx === idx
                            return (
                                <div key={idx} className={`source-card${isMissing ? ' source-card-missing' : ''}`}>
                                    <div className="source-card-header">
                                        <div className="source-card-info">
                                            <div className="source-card-name">
                                                {ext === 'pdf' ? '📕' : ext === 'md' ? '📘' : ext === 'docx' ? '📝' : '📄'} {src.source_file}
                                            </div>
                                            <div className="source-card-loc">📍 {src.section || 'General'}</div>
                                        </div>
                                        <button className={`source-card-toggle${isExpanded ? ' active' : ''}`} onClick={() => togglePreview(idx, src)}>
                                            {isExpanded ? 'Close' : 'Open'}
                                        </button>
                                    </div>
                                    {isExpanded && previewData && (
                                        <>
                                            {['pdf-snippet', 'text-snippet'].includes(previewData.type) && (
                                                <div className="pdf-preview-container">
                                                    {(previewData.pages?.length > 1 || previewData.segments?.length > 1) && (
                                                        <div className="pdf-pagination">
                                                            <button onClick={() => handlePageChange(-1)} disabled={previewData.currentIndex === 0} className="pdf-nav-btn">← Prev</button>
                                                            <span className="pdf-page-indicator">
                                                                {previewData.pages ? `Page ${previewData.pages[previewData.currentIndex].page}` : `Segment ${previewData.currentIndex + 1}`}
                                                                <span className="pdf-page-count">({previewData.currentIndex + 1} of {(previewData.pages || previewData.segments).length})</span>
                                                            </span>
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
                                            {previewData.type === 'content' && (
                                                <div className="pdf-content-preview"><pre>{previewData.content}</pre></div>
                                            )}
                                        </>
                                    )}
                                </div>
                            )
                        })}
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