import { useState, useRef, useEffect } from 'react'
import DOMPurify from 'dompurify'

const API = '/api'

// ── Auth helpers ──────────────────────────────────────────────────────────────
const USERS_KEY = 'hrms_users'
function getStoredUsers() { try { return JSON.parse(localStorage.getItem(USERS_KEY) || '{}') } catch { return {} } }
function registerUser(name, email, password) {
    const users = getStoredUsers()
    if (users[email.toLowerCase()]) return { ok: false, error: 'Account already exists. Please sign in.' }
    users[email.toLowerCase()] = { name, password }
    localStorage.setItem(USERS_KEY, JSON.stringify(users))
    return { ok: true }
}
function loginUser(email, password) {
    const users = getStoredUsers()
    const user = users[email.toLowerCase()]
    if (!user) return { ok: false, error: 'No account found. Please register first.' }
    if (user.password !== password) return { ok: false, error: 'Incorrect password.' }
    return { ok: true, name: user.name }
}

// ── AuthPage ──────────────────────────────────────────────────────────────────
function AuthPage({ onLogin }) {
    const [mode, setMode] = useState('login')
    const [name, setName] = useState('')
    const [email, setEmail] = useState('')
    const [password, setPassword] = useState('')
    const [error, setError] = useState('')
    const [submitting, setSubmitting] = useState(false)
    function switchMode(m) { setMode(m); setError(''); setName(''); setEmail(''); setPassword('') }
    function handleSubmit(e) {
        e.preventDefault(); setError(''); setSubmitting(true)
        if (mode === 'register') {
            if (!name.trim()) { setError('Please enter your full name.'); setSubmitting(false); return }
            if (!email.includes('@')) { setError('Please enter a valid email.'); setSubmitting(false); return }
            if (password.length < 6) { setError('Password must be at least 6 characters.'); setSubmitting(false); return }
            const res = registerUser(name.trim(), email.trim(), password)
            if (!res.ok) { setError(res.error); setSubmitting(false); return }
            onLogin(name.trim(), email.trim())
        } else {
            if (!email.trim()) { setError('Please enter your email.'); setSubmitting(false); return }
            if (!password) { setError('Please enter your password.'); setSubmitting(false); return }
            const res = loginUser(email.trim(), password)
            if (!res.ok) { setError(res.error); setSubmitting(false); return }
            onLogin(res.name, email.trim())
        }
        setSubmitting(false)
    }
    return (
        <div className="auth-page">
            <div className="auth-card">
                <div className="auth-logo">
                    <div className="auth-logo-icon">H</div>
                    <div>
                        <div className="auth-logo-title">HR Assistant</div>
                        <div className="auth-logo-sub">AI-POWERED HRMS</div>
                    </div>
                </div>
                <div className="auth-tabs">
                    <button className={`auth-tab${mode === 'login' ? ' active' : ''}`} onClick={() => switchMode('login')}>Sign In</button>
                    <button className={`auth-tab${mode === 'register' ? ' active' : ''}`} onClick={() => switchMode('register')}>Register</button>
                </div>
                <form className="auth-form" onSubmit={handleSubmit}>
                    {mode === 'register' && (
                        <div className="auth-field">
                            <label className="auth-label">Full Name</label>
                            <input className="auth-input" type="text" placeholder="Rahul Sharma" value={name} onChange={e => setName(e.target.value)} autoFocus />
                        </div>
                    )}
                    <div className="auth-field">
                        <label className="auth-label">Email Address</label>
                        <input className="auth-input" type="email" placeholder="you@company.com" value={email} onChange={e => setEmail(e.target.value)} autoFocus={mode === 'login'} />
                    </div>
                    <div className="auth-field">
                        <label className="auth-label">Password</label>
                        <input className="auth-input" type="password" placeholder={mode === 'register' ? 'Min. 6 characters' : 'Your password'} value={password} onChange={e => setPassword(e.target.value)} />
                    </div>
                    {error && <div className="auth-error">⚠ {error}</div>}
                    <button className="auth-submit" type="submit" disabled={submitting}>
                        {submitting ? '...' : mode === 'login' ? 'Sign In →' : 'Create Account →'}
                    </button>
                </form>
                <p className="auth-footer">
                    {mode === 'login'
                        ? <>{`Don't have an account? `}<span className="auth-link" onClick={() => switchMode('register')}>Register here</span></>
                        : <>{'Already have an account? '}<span className="auth-link" onClick={() => switchMode('login')}>Sign in</span></>}
                </p>
            </div>
        </div>
    )
}

// ── UploadModal ───────────────────────────────────────────────────────────────
function UploadModal({ onClose, onUploaded }) {
    const [dragOver, setDragOver] = useState(false)
    const [files, setFiles] = useState([])            // staged files
    const [uploading, setUploading] = useState(false)
    const [progress, setProgress] = useState({})      // filename → 'uploading'|'done'|'error'
    const [ingesting, setIngesting] = useState(false)
    const [ingestDone, setIngestDone] = useState(false)
    const [documents, setDocuments] = useState([])    // existing docs from server
    const [docsLoading, setDocsLoading] = useState(true)
    const fileInputRef = useRef(null)

    const ALLOWED_EXT = ['pdf', 'md', 'txt', 'docx', 'xlsx', 'xls', 'csv']

    useEffect(() => {
        loadDocuments()
    }, [])

    async function loadDocuments() {
        setDocsLoading(true)
        try {
            const res = await fetch(`${API}/documents`)
            const data = await res.json()
            setDocuments(data.documents || [])
        } catch { setDocuments([]) }
        setDocsLoading(false)
    }

    function validateFiles(rawFiles) {
        return Array.from(rawFiles).filter(f => {
            const ext = f.name.split('.').pop().toLowerCase()
            return ALLOWED_EXT.includes(ext)
        })
    }

    function stageFiles(rawFiles) {
        const valid = validateFiles(rawFiles)
        setFiles(prev => {
            const existing = new Set(prev.map(f => f.name))
            return [...prev, ...valid.filter(f => !existing.has(f.name))]
        })
    }

    function handleDrop(e) {
        e.preventDefault(); setDragOver(false)
        stageFiles(e.dataTransfer.files)
    }

    function handleFileInput(e) { stageFiles(e.target.files) }

    function removeFile(name) { setFiles(prev => prev.filter(f => f.name !== name)) }

    async function deleteDocument(name) {
        try {
            await fetch(`${API}/documents/${encodeURIComponent(name)}`, { method: 'DELETE' })
            setDocuments(prev => prev.filter(d => d.name !== name))
        } catch { alert('Failed to delete ' + name) }
    }

    async function handleUpload() {
        if (!files.length) return
        setUploading(true)
        const p = {}
        files.forEach(f => p[f.name] = 'uploading')
        setProgress({ ...p })

        const form = new FormData()
        files.forEach(f => form.append('files', f))

        try {
            const res = await fetch(`${API}/upload`, { method: 'POST', body: form })
            if (res.ok) {
                const data = await res.json()
                const done = {}
                files.forEach(f => done[f.name] = data.uploaded.includes(f.name) ? 'done' : 'error')
                setProgress(done)
                setFiles([])
                loadDocuments()
            } else {
                files.forEach(f => p[f.name] = 'error')
                setProgress({ ...p })
            }
        } catch {
            files.forEach(f => p[f.name] = 'error')
            setProgress({ ...p })
        }
        setUploading(false)
    }

    async function handleIngest() {
        setIngesting(true)
        try {
            await fetch(`${API}/ingest`, { method: 'POST' })
            setIngestDone(true)
            onUploaded()
        } catch { alert('Ingestion failed.') }
        setIngesting(false)
    }

    const uploadedCount = Object.values(progress).filter(v => v === 'done').length
    const anyUploaded = uploadedCount > 0

    function fileIcon(ext) {
        if (ext === '.pdf') return '📕'
        if (['.md', '.txt'].includes(ext)) return '📘'
        if (ext === '.docx') return '📝'
        if (['.xlsx', '.xls', '.csv'].includes(ext)) return '📊'
        return '📄'
    }

    function formatSize(bytes) {
        if (bytes < 1024) return `${bytes} B`
        if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
        return `${(bytes / 1024 / 1024).toFixed(1)} MB`
    }

    return (
        <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
            <div className="modal-box">

                {/* Header */}
                <div className="modal-header">
                    <div className="modal-title">📁 Document Manager</div>
                    <button className="modal-close" onClick={onClose}>✕</button>
                </div>

                {/* Drop zone */}
                <div
                    className={`drop-zone${dragOver ? ' drag-over' : ''}`}
                    onDragOver={e => { e.preventDefault(); setDragOver(true) }}
                    onDragLeave={() => setDragOver(false)}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <input
                        ref={fileInputRef}
                        type="file"
                        multiple
                        accept=".pdf,.md,.txt,.docx,.xlsx,.xls,.csv"
                        style={{ display: 'none' }}
                        onChange={handleFileInput}
                    />
                    <div className="drop-icon">📂</div>
                    <div className="drop-text">Drop files here or <span className="drop-link">browse</span></div>
                    <div className="drop-hint">PDF, MD, TXT, DOCX, XLSX, CSV — max 50 MB each</div>
                </div>

                {/* Staged files */}
                {files.length > 0 && (
                    <div className="staged-files">
                        <div className="staged-label">Ready to upload ({files.length})</div>
                        {files.map(f => (
                            <div key={f.name} className="staged-row">
                                <span className="staged-icon">{fileIcon('.' + f.name.split('.').pop())}</span>
                                <span className="staged-name">{f.name}</span>
                                <span className="staged-size">{formatSize(f.size)}</span>
                                <button className="staged-remove" onClick={() => removeFile(f.name)}>✕</button>
                            </div>
                        ))}
                        <button
                            className="upload-btn"
                            onClick={handleUpload}
                            disabled={uploading}
                        >
                            {uploading ? 'Uploading...' : `Upload ${files.length} file${files.length > 1 ? 's' : ''}`}
                        </button>
                    </div>
                )}

                {/* Upload progress */}
                {Object.keys(progress).length > 0 && (
                    <div className="upload-progress">
                        {Object.entries(progress).map(([name, status]) => (
                            <div key={name} className={`progress-row ${status}`}>
                                <span className="progress-icon">
                                    {status === 'uploading' ? '⏳' : status === 'done' ? '✅' : '❌'}
                                </span>
                                <span className="progress-name">{name}</span>
                                <span className="progress-status">{status}</span>
                            </div>
                        ))}
                        {anyUploaded && !ingestDone && (
                            <button className="ingest-btn" onClick={handleIngest} disabled={ingesting}>
                                {ingesting ? '⏳ Ingesting into knowledge base...' : '⚡ Ingest uploaded files'}
                            </button>
                        )}
                        {ingestDone && <div className="ingest-done">✅ Knowledge base updated!</div>}
                    </div>
                )}

                {/* Existing documents */}
                <div className="docs-section">
                    <div className="docs-label">
                        Knowledge Base ({docsLoading ? '...' : documents.length} documents)
                    </div>
                    {docsLoading ? (
                        <div className="docs-loading">Loading...</div>
                    ) : documents.length === 0 ? (
                        <div className="docs-empty">No documents yet. Upload some above.</div>
                    ) : (
                        <div className="docs-list">
                            {documents.map(doc => (
                                <div key={doc.name} className="doc-row">
                                    <span className="doc-icon">{fileIcon(doc.ext)}</span>
                                    <span className="doc-name">{doc.name}</span>
                                    <span className="doc-size">{formatSize(doc.size)}</span>
                                    <button
                                        className="doc-delete"
                                        onClick={() => deleteDocument(doc.name)}
                                        title="Delete"
                                    >🗑</button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

            </div>
        </div>
    )
}

const QUICK_QUESTIONS = [
    'Maternity policy',
    'What is moonlighting disclosure?',
    'Remote work policy',
    'What are the leave types?',
    'Onboarding guidelines',
    'Look up Rahul Sharma',

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
    // Auth state — first hook, never conditional
    const [currentUser, setCurrentUser] = useState(() => {
        try { return JSON.parse(sessionStorage.getItem('hrms_session') || 'null') }
        catch { return null }
    })

    const [messages, setMessages] = useState([])
    const [input, setInput] = useState('')
    const [loading, setLoading] = useState(false)
    const [docCount, setDocCount] = useState(0)
    const [expandedIdx, setExpandedIdx] = useState(null)
    const [previewData, setPreviewData] = useState(null) // stores { type, content/lines/html }
    const [showUpload, setShowUpload] = useState(false)
    const chatEnd = useRef(null)

    // Auth handlers
    function handleLogin(name, email) {
        const user = { name, email }
        sessionStorage.setItem('hrms_session', JSON.stringify(user))
        setCurrentUser(user)
    }
    function handleLogout() {
        sessionStorage.removeItem('hrms_session')
        setCurrentUser(null)
        setMessages([])
        setExpandedIdx(null)
        setPreviewData(null)
    }

    // Refresh doc count after upload
    function handleUploaded() {
        fetch(`${API}/documents`).then(r => r.json()).then(d => setDocCount(d.documents.length)).catch(() => { })
    }

    // Auth gate — after all hooks
    if (!currentUser) return <AuthPage onLogin={handleLogin} />

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
                body: JSON.stringify({
                    message: text,
                    history: messages.map(m => ({ role: m.role, content: m.content }))
                }),
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
        const lastMsg = [...messages].reverse().find(m => m.role === 'assistant');
        const answerContext = lastMsg ? lastMsg.content : '';

        if (ext === 'pdf' && Array.isArray(source.full_content)) {
            const mIdx = source.full_content.findIndex(p => p.page === source.page);
            const startIdx = mIdx >= 0 ? mIdx : 0;
            const res = generateHighlightedHtml(source.full_content[startIdx].text, source.chunks || [], answerContext, true, lastUserQuery);

            setPreviewData({
                type: 'pdf-snippet',
                lines: res.lines,
                pages: source.full_content,
                currentIndex: startIdx,
                chunks: source.chunks || [],
                answerContext: answerContext,
                sourceFile: source.source_file,
            });
        } else if (['md', 'txt', 'docx'].includes(ext)) {
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
    }

    function handleKeyDown(e) {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault()
            sendMessage(input)
        }
    }

    return (
        <>
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

                    {/* User info + logout */}
                    <div className="sidebar-user">
                        <div className="sidebar-user-info">
                            <div className="sidebar-user-avatar">{currentUser.name.charAt(0).toUpperCase()}</div>
                            <div className="sidebar-user-details">
                                <div className="sidebar-user-name">{currentUser.name}</div>
                                <div className="sidebar-user-email">{currentUser.email}</div>
                            </div>
                        </div>
                        <button className="sidebar-logout" onClick={handleLogout} title="Sign out">↩</button>
                    </div>

                    {/* Upload documents button */}
                    <button className="upload-docs-btn" onClick={() => setShowUpload(true)}>
                        📁 Upload Documents
                    </button>

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

                                            {isExpanded && previewData && (
                                                <>
                                                    {['pdf-snippet', 'text-snippet'].includes(previewData.type) && (
                                                        <div className="pdf-preview-container">
                                                            {/* Pagination bar */}
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

                                                            {/* PDF: render actual PDF page via iframe so it looks like Image 1 */}
                                                            {previewData.type === 'pdf-snippet' && previewData.pages && (() => {
                                                                const currentPage = previewData.pages[previewData.currentIndex]
                                                                const pageNum = currentPage?.page || 1
                                                                const pdfUrl = `${API}/pdf-file/${encodeURIComponent(previewData.sourceFile)}#page=${pageNum}`
                                                                return (
                                                                    <iframe
                                                                        src={pdfUrl}
                                                                        style={{
                                                                            width: '100%',
                                                                            height: '500px',
                                                                            border: 'none',
                                                                            borderRadius: '0 0 8px 8px'
                                                                        }}
                                                                        title="PDF Preview"
                                                                    />
                                                                )
                                                            })()}

                                                            {/* Text/MD/DOCX: keep existing highlighted code-viewer */}
                                                            {previewData.type === 'text-snippet' && (
                                                                <div className="code-viewer">
                                                                    {(previewData.lines || []).map((line, li) => (
                                                                        <div key={li} className={`code-line${line.highlighted ? ' highlighted' : ''}`}>
                                                                            <span className="line-num">{line.num}</span>
                                                                            <span
                                                                                className="line-text"
                                                                                dangerouslySetInnerHTML={{
                                                                                    __html: DOMPurify.sanitize(
                                                                                        line.html || '&nbsp;',
                                                                                        { ADD_TAGS: ['mark'] }
                                                                                    )
                                                                                }}
                                                                            />
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
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

            {/* Upload Modal */}
            {showUpload && (
                <UploadModal
                    onClose={() => setShowUpload(false)}
                    onUploaded={() => {
                        setShowUpload(false)
                        handleUploaded()
                    }}
                />
            )}
        </>
    )
}