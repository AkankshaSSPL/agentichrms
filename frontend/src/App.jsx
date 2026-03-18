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
function generateHighlightedHtml(fullText, chunks, answer = '', isSnippet = true, query = '') {
    if (!fullText) return isSnippet ? { html: '', lines: [] } : '<p>No text available</p>';

    // 1. Collect potential search terms: query + bold terms + chunks + phrases 
    let searchTerms = [];

    // Prioritize user's query
    if (query && query.trim().length > 3) {
        searchTerms.push(query.trim());
        const words = query.trim().split(/\s+/).filter(w => w.length > 4);
        searchTerms = [...searchTerms, ...words];
    }

    // Use retriever chunks
    (chunks || []).forEach(c => {
        if (c && c.trim().length > 15) searchTerms.push(c.trim());
    });

    // Extract key sentences and BOLD TERMS from the AI answer
    if (answer) {
        const boldMatches = answer.match(/\*\*(.*?)\*\*/g);
        if (boldMatches) {
            boldMatches.forEach(m => {
                const cleanBold = m.replace(/\*\*/g, '').trim();
                if (cleanBold.length > 3) searchTerms.push(cleanBold);
            });
        }
        const cleanAnswer = answer.replace(/[\*\_#\>~`\[\]\(\)"']/g, ' ').replace(/\s+/g, ' ');
        const sentences = cleanAnswer.split(/[.!?\n]/).filter(s => s.trim().length > 18);
        searchTerms = [...searchTerms, ...sentences.map(s => s.trim())];
    }

    const sortedChunks = Array.from(new Set(searchTerms)).filter(c => c).sort((a, b) => b.length - a.length);
    const lines = fullText.split('\n');
    let matchedLineIndices = new Set();

    // Find matches
    sortedChunks.forEach(chunk => {
        const escapedChunk = chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regexStr = escapedChunk.split(/\s+/).filter(w => w.length > 0).join('\\s+');
        if (!regexStr) return;

        try {
            const regex = new RegExp(regexStr, 'gi');

            // For snippet building, identify matching lines
            lines.forEach((line, idx) => {
                // Normalize spaces to handle different encodings/nbsp
                const normLine = line.replace(/\s+/g, ' ');
                if (regex.test(normLine)) matchedLineIndices.add(idx);
            });
        } catch (e) { }
    });

    // ─── Paragraph Block Logic ───
    // Group lines into contiguous non-empty blocks
    let blocks = [];
    let currentBlock = [];
    lines.forEach((line, idx) => {
        if (line.trim().length > 0) {
            currentBlock.push(idx);
        } else {
            if (currentBlock.length > 0) blocks.push(currentBlock);
            currentBlock = [];
        }
    });
    if (currentBlock.length > 0) blocks.push(currentBlock);

    // If any line in a block is matched, highlight the entire block
    let finalHighlights = new Set();
    blocks.forEach(block => {
        const hasMatch = block.some(idx => matchedLineIndices.has(idx));
        if (hasMatch) {
            block.forEach(idx => finalHighlights.add(idx));
        }
    });

    // Identify windows of interest (any highlighted line +/- 5 context lines)
    if (isSnippet) {
        let contextIndices = new Set();
        if (finalHighlights.size === 0) {
            // FALLBACK: If no matches, show first 50 lines so the doc isn't "empty"
            for (let i = 0; i < Math.min(lines.length, 50); i++) contextIndices.add(i);
        } else {
            finalHighlights.forEach(idx => {
                for (let i = Math.max(0, idx - 5); i <= Math.min(lines.length - 1, idx + 5); i++) {
                    contextIndices.add(i);
                }
            });
        }

        const sortedIndices = Array.from(contextIndices).sort((a, b) => a - b);
        let resultLines = [];
        let lastIdx = -1;

        sortedIndices.forEach(idx => {
            if (lastIdx !== -1 && idx > lastIdx + 1) {
                resultLines.push({ num: '...', text: '...', html: '<div class="preview-ellipsis">...</div>', highlighted: false });
            }
            const lineText = lines[idx];
            const isHighlighted = finalHighlights.has(idx);

            // Recursive call for inner highlighting (not snippet mode)
            const lineHtml = generateHighlightedHtml(lineText, chunks, answer, false, query);

            resultLines.push({
                num: idx + 1,
                text: lineText,
                html: lineHtml,
                highlighted: isHighlighted
            });
            lastIdx = idx;
        });

        return { html: '', lines: resultLines };
    }

    // Full text highlighting mode (fallback or single line)
    let finalHtml = escapeHtml(fullText);
    sortedChunks.forEach(chunk => {
        const escapedChunk = chunk.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regexStr = escapedChunk.split(/\s+/).filter(w => w.length > 0).join('\\s+');
        if (!regexStr) return;
        try {
            const regex = new RegExp(regexStr, 'gi');
            finalHtml = finalHtml.replace(regex, (match) => `<mark>${match}</mark>`);
        } catch (e) { }
    });

    return finalHtml.replace(/\n/g, '<br>');
}

export default function App() {
    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [docCount, setDocCount] = useState(0)
    const [expandedIdx, setExpandedIdx] = useState(null)
    const [previewData, setPreviewData] = useState(null)
    const [previewLoading, setPreviewLoading] = useState(false)
    const chatEnd = useRef(null)
    const isSubmitting = useRef(false)

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

    // Get the user's last query for highlighting context
    const lastUserQuery = (() => {
        const rev = [...messages].reverse();
        const found = rev.find(m => m.role === 'user');
        return found ? found.content : '';
    })()

    // Handle pagination (PDF pages or Text segments)
    const handlePageChange = (direction) => {
        if (!previewData) return;
        const list = previewData.pages || previewData.segments;
        if (!list) return;

        const newIdx = previewData.currentIndex + direction;
        if (newIdx >= 0 && newIdx < list.length) {
            const item = list[newIdx];
            const text = item.text || item.content || '';
            const result = generateHighlightedHtml(text, previewData.chunks, previewData.answerContext, true, lastUserQuery);
            setPreviewData({
                ...previewData,
                currentIndex: newIdx,
                lines: result.lines || []
            });
        }
    };

    async function sendMessage(text) {
        if (!text.trim() || loading || isSubmitting.current) return
        isSubmitting.current = true
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
        } finally {
            isSubmitting.current = false
            setLoading(false)
        }
    }

    async function togglePreview(idx, source) {
        if (expandedIdx === idx) {
            setExpandedIdx(null)
            setPreviewData(null)
            return
        }
        setExpandedIdx(idx)
        setPreviewLoading(true)
        setPreviewData(null)

        const ext = source.source_file.split('.').pop().toLowerCase()
        const lastMsg = [...messages].reverse().find(m => m.role === 'assistant');
        const answerContext = lastMsg ? lastMsg.content : '';

        // PDFs: native browser iframe opened at the exact cited page
        if (ext === 'pdf') {
            const page = source.page || source.start_line || 1
            setPreviewData({
                type: 'pdf-native',
                fileUrl: `${API}/file/${encodeURIComponent(source.source_file)}#page=${page}`,
                page,
                filename: source.source_file,
            })
            setPreviewLoading(false)
            return
        }

        // Text/markdown/docx: highlighted snippet view
        setTimeout(() => {
            if (['md', 'txt', 'docx'].includes(ext)) {
                const res = generateHighlightedHtml(source.content || '', source.chunks || [], answerContext, true, lastUserQuery);
                setPreviewData({
                    type: 'text-snippet',
                    lines: res.lines,
                    segments: source.segments || [{ content: source.content }],
                    currentIndex: 0,
                    chunks: source.chunks || [],
                    answerContext: answerContext
                });
            } else {
                setPreviewData({ type: 'content', content: source.content || 'No content available.' })
            }
            setPreviewLoading(false)
        }, 0)
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
                                                    📍 {src.section || 'General'}
                                                </div>
                                            </div>
                                            <button
                                                className={`source-card-toggle${isExpanded ? ' active' : ''}`}
                                                onClick={() => togglePreview(idx, src)}
                                            >
                                                {isExpanded ? 'Close' : 'Open'}
                                            </button>
                                        </div>

                                        {isExpanded && (
                                            <>
                                                {previewLoading && (
                                                    <div style={{ padding: '14px 12px', fontSize: '13px', color: 'var(--color-text-secondary)' }}>
                                                        Loading preview...
                                                    </div>
                                                )}
                                                {!previewLoading && previewData && (
                                                    <>
                                                        {previewData.type === 'pdf-native' && (
                                                            <div style={{ paddingTop: '8px' }}>
                                                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px', fontSize: '12px', color: 'var(--color-text-secondary)', padding: '0 2px' }}>
                                                                    <span>Page {previewData.page}</span>
                                                                    <a href={previewData.fileUrl} target="_blank" rel="noopener noreferrer" style={{ color: 'var(--color-text-info)', textDecoration: 'none' }}>Open full PDF ↗</a>
                                                                </div>
                                                                <iframe
                                                                    src={previewData.fileUrl}
                                                                    title={previewData.filename}
                                                                    style={{ width: '100%', height: '500px', border: '1px solid var(--color-border-tertiary)', borderRadius: '6px', display: 'block' }}
                                                                />
                                                            </div>
                                                        )}
                                                        {['pdf-snippet', 'text-snippet'].includes(previewData.type) && (
                                                            <div className="pdf-preview-container">
                                                                {(previewData.pages?.length > 1 || previewData.segments?.length > 1) && (
                                                                    <div className="pdf-pagination">
                                                                        <button
                                                                            onClick={() => handlePageChange(-1)}
                                                                            disabled={previewData.currentIndex === 0}
                                                                            className="pdf-nav-btn"
                                                                        >
                                                                            ← Prev
                                                                        </button>
                                                                        <span className="pdf-page-indicator">
                                                                            {previewData.pages ? `Page ${previewData.pages[previewData.currentIndex].page}` : `Segment ${previewData.currentIndex + 1}`}
                                                                            <span className="pdf-page-count">
                                                                                ({previewData.currentIndex + 1} of {(previewData.pages || previewData.segments).length})
                                                                            </span>
                                                                        </span>
                                                                        <button
                                                                            onClick={() => handlePageChange(1)}
                                                                            disabled={previewData.currentIndex === (previewData.pages || previewData.segments).length - 1}
                                                                            className="pdf-nav-btn"
                                                                        >
                                                                            Next →
                                                                        </button>
                                                                    </div>
                                                                )}
                                                                <div className="code-viewer">
                                                                    {(previewData.lines || []).map((line, li) => (
                                                                        <div key={li} className={`code-line${line.highlighted ? ' highlighted' : ''}`}>
                                                                            <span className="line-num">{line.num}</span>
                                                                            <span
                                                                                className="line-text"
                                                                                dangerouslySetInnerHTML={{
                                                                                    __html: DOMPurify.sanitize(line.html)
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            </div>
                                                        )}
                                                        {previewData.type === 'content' && (
                                                            <div className="pdf-content-preview">
                                                                <pre>{previewData.content}</pre>
                                                            </div>
                                                        )}
                                                    </>
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