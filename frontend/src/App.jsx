import { useState, useRef, useEffect } from 'react'
import DOMPurify from 'dompurify'

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

// Helper to escape HTML special characters
function escapeHtml(text) {
    return text.replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

// Generate highlighted HTML from full page text and chunks fuzzily
function generateHighlightedHtml(fullText, chunks, answer = '') {
    if (!fullText) return '<p>No text available</p>';

    // 1. Collect potential search terms: long chunks + major phrases from the AI answer
    let searchTerms = [];

    // Use retriever chunks if they are reasonably long (avoid false positives on short snippets)
    (chunks || []).forEach(c => {
        if (c && c.trim().length > 25) searchTerms.push(c.trim());
    });

    // Extract key sentences from the AI answer to ensure we highlight what the user actually read
    if (answer) {
        // Clean markdown symbols from the answer for better text-matching
        const cleanAnswer = answer.replace(/[\*\_#\>~`\[\]\(\)]/g, ' ');
        const sentences = cleanAnswer.split(/[.!?\n]/).filter(s => s.trim().length > 18);
        searchTerms = sentences.map(s => s.trim());
    } else {
        // Fallback to chunks only if no answer context is available (e.g. initial loading)
        (chunks || []).forEach(c => {
            if (c && c.trim().length > 25) searchTerms.push(c.trim());
        });
    }

    const sortedChunks = searchTerms.filter(c => c).sort((a, b) => b.length - a.length);
    let ranges = [];

    sortedChunks.forEach(chunk => {
        const escapedChunk = chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regexStr = escapedChunk.split(/\s+/).filter(w => w.length > 0).join('\\s+');
        if (!regexStr) return;

        try {
            const regex = new RegExp(regexStr, 'gi');
            let match;
            while ((match = regex.exec(fullText)) !== null) {
                ranges.push({ start: match.index, end: match.index + match[0].length });
            }
        } catch (e) {
            console.error("Regex error", e);
        }
    });

    ranges.sort((a, b) => a.start - b.start);
    let mergedRanges = [];
    for (let r of ranges) {
        if (mergedRanges.length === 0) {
            mergedRanges.push(r);
        } else {
            let last = mergedRanges[mergedRanges.length - 1];
            if (r.start <= last.end) {
                last.end = Math.max(last.end, r.end);
            } else {
                mergedRanges.push(r);
            }
        }
    }

    let resultHtml = '';
    let lastIndex = 0;
    for (let r of mergedRanges) {
        resultHtml += escapeHtml(fullText.substring(lastIndex, r.start)).replace(/\n/g, '<br>');
        resultHtml += '<mark>';
        resultHtml += escapeHtml(fullText.substring(r.start, r.end)).replace(/\n/g, '<br>');
        resultHtml += '</mark>';
        lastIndex = r.end;
    }
    resultHtml += escapeHtml(fullText.substring(lastIndex)).replace(/\n/g, '<br>');

    return resultHtml;
}

export default function App() {
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [docCount, setDocCount] = useState(0)
    const [expandedIdx, setExpandedIdx] = useState(null)
    const [previewData, setPreviewData] = useState(null) // stores { type, content/lines/html }
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

    // Handle PDF pagination
    const handlePdfPageChange = (direction) => {
        if (!previewData || previewData.type !== 'pdf-html' || !previewData.pages) return;

        const newIndex = previewData.currentIndex + direction;
        if (newIndex >= 0 && newIndex < previewData.pages.length) {
            const pageObj = previewData.pages[newIndex];
            const html = generateHighlightedHtml(pageObj.text, previewData.chunks, previewData.answerContext || '');
            setPreviewData({
                ...previewData,
                currentIndex: newIndex,
                html: html
            });
        }
    };

    async function sendMessage(text) {
        if (!text.trim() || loading) return
        const userMsg = { role: 'user', content: text }
        setMessages(prev => [...prev, userMsg])
        setInput('')
        setLoading(true)
        setExpandedIdx(null)
        setPreviewData(null)

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
            setPreviewData(null)
            return
        }
        setExpandedIdx(idx)

        const ext = source.source_file.split('.').pop().toLowerCase()

        // Find the latest assistant answer to provide context for highlighting
        const lastAssistantMsg = [...messages].reverse().find(m => m.role === 'assistant');
        const answerContext = lastAssistantMsg ? lastAssistantMsg.content : '';

        if (ext === 'pdf' && Array.isArray(source.full_content) && source.full_content.length > 0) {
            // Find the index of the matched page in the loaded pages
            const matchedIndex = source.full_content.findIndex(p => p.page === source.page);
            const startIndex = matchedIndex >= 0 ? matchedIndex : 0;

            const currentPage = source.full_content[startIndex];
            const html = generateHighlightedHtml(currentPage.text, source.chunks || [], answerContext);
            setPreviewData({
                type: 'pdf-html',
                html: html,
                pages: source.full_content, // [{page, text}, ...]
                currentIndex: startIndex,
                chunks: source.chunks || [],
                answerContext: answerContext
            })
        } else if (['md', 'txt', 'docx'].includes(ext)) {
            // Fetch line-by-line preview from backend
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
                // Add chunks and answer context for granular highlighting in text view
                setPreviewData({
                    ...data,
                    chunks: source.chunks || [],
                    answerContext: answerContext
                })
            } catch {
                setPreviewData(null)
            }
        } else {
            // Fallback: show the raw snippet (source.content)
            setPreviewData({ type: 'content', content: source.content || 'No content available.' })
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
                    setPreviewData(null)
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
                        {latestSources
                            .map((src, idx) => {
                                const ext = src.source_file.split('.').pop().toLowerCase()
                                const isMissing = !src.content && !src.full_content && ['pdf', 'docx'].includes(ext)
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
                                                    📍 {src.section} · {ext === 'pdf' ? `Page ${src.page}` : `Lines ${src.start_line}–${src.end_line}`}
                                                </div>
                                            </div>
                                            <button
                                                className={`source-card-toggle${isExpanded ? ' active' : ''}`}
                                                onClick={() => togglePreview(idx, src)}
                                            >
                                                {isExpanded ? 'Close' : 'Open'}
                                            </button>
                                        </div>

                                        {isExpanded && previewData && (
                                            <>
                                                {previewData.type === 'text' && (
                                                    <div className="code-viewer">
                                                        {previewData.lines.map((line, li) => (
                                                            <div key={li} className={`code-line${line.highlighted ? ' highlighted' : ''}`}>
                                                                <span className="line-num">{line.num}</span>
                                                                <span
                                                                    className="line-text"
                                                                    dangerouslySetInnerHTML={{
                                                                        __html: DOMPurify.sanitize(
                                                                            generateHighlightedHtml(line.text, previewData.chunks, previewData.answerContext)
                                                                        )
                                                                    }}
                                                                />
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {previewData.type === 'pdf-html' && (
                                                    <div className="pdf-preview-container">
                                                        {previewData.pages && previewData.pages.length > 1 && (
                                                            <div className="pdf-pagination">
                                                                <button
                                                                    onClick={() => handlePdfPageChange(-1)}
                                                                    disabled={previewData.currentIndex === 0}
                                                                    className="pdf-nav-btn"
                                                                >
                                                                    ← Prev
                                                                </button>
                                                                <span className="pdf-page-indicator">
                                                                    Page {previewData.pages[previewData.currentIndex].page}
                                                                    <span className="pdf-page-count">({previewData.currentIndex + 1} of {previewData.pages.length})</span>
                                                                </span>
                                                                <button
                                                                    onClick={() => handlePdfPageChange(1)}
                                                                    disabled={previewData.currentIndex === previewData.pages.length - 1}
                                                                    className="pdf-nav-btn"
                                                                >
                                                                    Next →
                                                                </button>
                                                            </div>
                                                        )}
                                                        <div
                                                            className="pdf-content-preview"
                                                            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(previewData.html) }}
                                                        />
                                                    </div>
                                                )}
                                                {previewData.type === 'content' && (
                                                    <div className="pdf-content-preview">
                                                        <pre>{previewData.content}</pre>
                                                    </div>
                                                )}
                                            </>
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