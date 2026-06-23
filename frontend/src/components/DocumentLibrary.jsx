/**
 * DocumentLibrary — document browser.
 *
 * Visible to everyone; uploading is restricted to HR/Admin (both client-side
 * gating here and — this must also be enforced — server-side on the
 * /documents/upload endpoint).
 *
 * Click a card -> opens DocumentViewer modal. The viewer logs the open to
 * behavioral analytics; nothing about that is visible in this UI.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { useDocuments } from '../hooks/useDocuments'
import DocumentViewer from './DocumentViewer'

// ── File-type styling — gives the grid a real visual taxonomy instead of ──
// ── identical gray boxes with a floating emoji. ────────────────────────────
const FILE_TYPE = {
    pdf:  { label: 'PDF',  color: '#f87171', bg: 'rgba(248,113,113,0.10)', icon: 'pdf'  },
    md:   { label: 'MD',   color: '#60a5fa', bg: 'rgba(96,165,250,0.10)',  icon: 'doc'  },
    docx: { label: 'DOCX', color: '#a78bfa', bg: 'rgba(167,139,250,0.10)', icon: 'doc'  },
    txt:  { label: 'TXT',  color: '#94a3b8', bg: 'rgba(148,163,184,0.10)', icon: 'txt'  },
}
const DEFAULT_TYPE = { label: 'FILE', color: '#94a3b8', bg: 'rgba(148,163,184,0.10)', icon: 'doc' }

function getExt(filename) {
    return (filename.split('.').pop() || '').toLowerCase()
}
function typeFor(filename) {
    return FILE_TYPE[getExt(filename)] || DEFAULT_TYPE
}
function fileLabel(filename) {
    return filename.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ')
}

// Small line-drawn glyphs — consistent stroke style with the rest of the app
// instead of mismatched platform emoji.
function FileGlyph({ icon, color, size = 20 }) {
    const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }
    if (icon === 'pdf') {
        return (
            <svg {...common}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <path d="M9 15.5h1.4a1.3 1.3 0 0 0 0-2.6H9V17" />
                <path d="M13.2 17v-4.1h1a1.6 1.6 0 0 1 0 4.1h-1z" opacity="0" />
            </svg>
        )
    }
    if (icon === 'txt') {
        return (
            <svg {...common}>
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                <path d="M14 2v6h6" />
                <line x1="8" y1="13" x2="16" y2="13" />
                <line x1="8" y1="16.5" x2="13" y2="16.5" />
            </svg>
        )
    }
    // doc (md / docx / fallback)
    return (
        <svg {...common}>
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <path d="M14 2v6h6" />
            <line x1="8" y1="13" x2="16" y2="13" />
            <line x1="8" y1="17" x2="16" y2="17" />
        </svg>
    )
}

const SearchIcon = () => (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <circle cx="11" cy="11" r="7" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
    </svg>
)
const UploadIcon = () => (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M12 16V4" /><path d="M6 10l6-6 6 6" /><path d="M4 18v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2" />
    </svg>
)
const CloseIcon = () => (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
    </svg>
)

export default function DocumentLibrary({ employee, onBack }) {
    const { documents, loading, error, loadDocuments, openRaw, logView, uploadDocument } = useDocuments()
    const [viewing, setViewing] = useState(null)
    const [query, setQuery] = useState('')
    const [activeType, setActiveType] = useState('all')

    const [showUpload, setShowUpload] = useState(false)
    const [uploadFile, setUploadFile] = useState(null)
    const [uploading, setUploading] = useState(false)
    const [uploadError, setUploadError] = useState(null)
    const fileInputRef = useRef(null)

    const canUpload = employee && ['hr', 'admin'].includes(employee.role)

    useEffect(() => { loadDocuments() }, [loadDocuments])

    const typeCounts = useMemo(() => {
        const counts = { all: documents.length }
        documents.forEach(d => {
            const ext = getExt(d.filename)
            counts[ext] = (counts[ext] || 0) + 1
        })
        return counts
    }, [documents])

    const filtered = useMemo(() => {
        const q = query.trim().toLowerCase()
        return documents.filter(d => {
            if (activeType !== 'all' && getExt(d.filename) !== activeType) return false
            if (q && !d.filename.toLowerCase().includes(q)) return false
            return true
        })
    }, [documents, query, activeType])

    const presentTypes = useMemo(
        () => Object.keys(FILE_TYPE).filter(ext => typeCounts[ext] > 0),
        [typeCounts]
    )

    function openFilePicker() {
        setUploadError(null)
        setUploadFile(null)
        setShowUpload(true)
    }

    function handleFileChosen(e) {
        const f = e.target.files?.[0]
        if (f) setUploadFile(f)
    }

    async function handleUploadSubmit() {
        if (!uploadFile) return
        setUploading(true)
        setUploadError(null)
        try {
            await uploadDocument(uploadFile)
            setShowUpload(false)
            setUploadFile(null)
            await loadDocuments()
        } catch (e) {
            setUploadError(e.message || 'Upload failed. Please try again.')
        } finally {
            setUploading(false)
        }
    }

    return (
        <div style={{
            minHeight: '100vh',
            background: 'var(--bg-primary, #0f1117)',
            display: 'flex', flexDirection: 'column',
        }}>
            {/* ── Header ── */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 14,
                padding: '16px 28px',
                borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))',
                background: 'var(--bg-secondary, #1a1d27)',
                position: 'sticky', top: 0, zIndex: 10,
            }}>
                <button onClick={onBack} style={{
                    background: 'transparent',
                    border: '1px solid var(--border, rgba(255,255,255,0.1))',
                    borderRadius: 8, padding: '7px 16px',
                    color: 'var(--text-muted, #64748b)', fontSize: 13, cursor: 'pointer',
                    flexShrink: 0,
                }}>← Chat</button>

                <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 17, fontWeight: 700, color: 'var(--text-primary, #f1f5f9)', letterSpacing: '-0.01em' }}>
                        Document Library
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: 1 }}>
                        {loading ? 'Loading…' : `${documents.length} document${documents.length !== 1 ? 's' : ''} available`}
                    </div>
                </div>

                {canUpload && (
                    <button
                        onClick={openFilePicker}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 7,
                            background: 'var(--accent, #4f8ef7)',
                            border: 'none', borderRadius: 9,
                            padding: '9px 16px',
                            color: '#fff', fontSize: 13, fontWeight: 600,
                            cursor: 'pointer', flexShrink: 0,
                            boxShadow: '0 2px 10px rgba(79,142,247,0.3)',
                            transition: 'transform 0.12s, box-shadow 0.12s',
                        }}
                        onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(79,142,247,0.4)' }}
                        onMouseLeave={e => { e.currentTarget.style.transform = 'translateY(0)'; e.currentTarget.style.boxShadow = '0 2px 10px rgba(79,142,247,0.3)' }}
                    >
                        <UploadIcon /> Upload Document
                    </button>
                )}
            </div>

            {/* ── Toolbar: search + type filters ── */}
            {!loading && documents.length > 0 && (
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    padding: '16px 28px 0', flexWrap: 'wrap',
                }}>
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: 8,
                        background: 'var(--bg-secondary, #1a1d27)',
                        border: '1px solid var(--border, rgba(255,255,255,0.08))',
                        borderRadius: 9, padding: '8px 12px',
                        minWidth: 220, flex: '0 1 280px',
                    }}>
                        <span style={{ color: 'var(--text-muted)', display: 'flex' }}><SearchIcon /></span>
                        <input
                            value={query}
                            onChange={e => setQuery(e.target.value)}
                            placeholder="Search documents…"
                            style={{
                                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                                color: 'var(--text-primary)', fontSize: 13,
                            }}
                        />
                    </div>

                    <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <FilterChip label="All" count={typeCounts.all} active={activeType === 'all'} onClick={() => setActiveType('all')} />
                        {presentTypes.map(ext => (
                            <FilterChip
                                key={ext}
                                label={FILE_TYPE[ext].label}
                                count={typeCounts[ext]}
                                color={FILE_TYPE[ext].color}
                                active={activeType === ext}
                                onClick={() => setActiveType(ext)}
                            />
                        ))}
                    </div>
                </div>
            )}

            {/* ── Body ── */}
            <div style={{ flex: 1, padding: '20px 28px 28px', overflow: 'auto' }}>
                {error && (
                    <div style={{
                        padding: '12px 16px', borderRadius: 10,
                        background: 'rgba(248,113,113,0.08)',
                        border: '1px solid rgba(248,113,113,0.2)',
                        color: 'var(--red, #f87171)', fontSize: 13, marginBottom: 20,
                    }}>
                        Could not load documents: {error}
                    </div>
                )}

                {loading && (
                    <div style={{ color: 'var(--text-muted)', fontSize: 14, textAlign: 'center', marginTop: 60 }}>
                        Loading documents…
                    </div>
                )}

                {!loading && documents.length === 0 && !error && (
                    <EmptyState canUpload={canUpload} onUpload={openFilePicker} />
                )}

                {!loading && documents.length > 0 && filtered.length === 0 && (
                    <div style={{ textAlign: 'center', marginTop: 60 }}>
                        <div style={{ fontSize: 14, color: 'var(--text-secondary, #94a3b8)' }}>
                            No documents match "{query}".
                        </div>
                    </div>
                )}

                {!loading && filtered.length > 0 && (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                        gap: 14,
                    }}>
                        {filtered.map(doc => {
                            const t = typeFor(doc.filename)
                            return (
                                <button
                                    key={doc.filename}
                                    onClick={() => setViewing(doc.filename)}
                                    style={{
                                        position: 'relative',
                                        background: 'var(--bg-card, #1a1d27)',
                                        border: '1px solid var(--border, rgba(255,255,255,0.07))',
                                        borderRadius: 12,
                                        padding: '16px 16px 16px 18px',
                                        cursor: 'pointer',
                                        textAlign: 'left',
                                        transition: 'transform 0.12s, border-color 0.12s, background 0.12s',
                                        display: 'flex', alignItems: 'flex-start', gap: 12,
                                        overflow: 'hidden',
                                    }}
                                    onMouseEnter={e => {
                                        e.currentTarget.style.transform = 'translateY(-2px)'
                                        e.currentTarget.style.borderColor = t.color + '55'
                                        e.currentTarget.style.background = 'var(--bg-secondary, #1f2330)'
                                    }}
                                    onMouseLeave={e => {
                                        e.currentTarget.style.transform = 'translateY(0)'
                                        e.currentTarget.style.borderColor = 'var(--border, rgba(255,255,255,0.07))'
                                        e.currentTarget.style.background = 'var(--bg-card, #1a1d27)'
                                    }}
                                >
                                    {/* type accent bar */}
                                    <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: t.color }} />

                                    <span style={{
                                        width: 38, height: 38, borderRadius: 9, flexShrink: 0,
                                        background: t.bg,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                        <FileGlyph icon={t.icon} color={t.color} />
                                    </span>

                                    <div style={{ minWidth: 0, flex: 1 }}>
                                        <div style={{
                                            fontSize: 13.5, fontWeight: 600,
                                            color: 'var(--text-primary, #f1f5f9)',
                                            marginBottom: 5, lineHeight: 1.35,
                                            display: '-webkit-box',
                                            WebkitLineClamp: 2,
                                            WebkitBoxOrient: 'vertical',
                                            overflow: 'hidden',
                                            textTransform: 'capitalize',
                                        }}>
                                            {fileLabel(doc.filename)}
                                        </div>
                                        <span style={{
                                            display: 'inline-block',
                                            fontSize: 10, fontWeight: 700,
                                            color: t.color, background: t.bg,
                                            padding: '2px 7px', borderRadius: 5,
                                            letterSpacing: '0.04em',
                                        }}>
                                            {t.label}
                                        </span>
                                    </div>
                                </button>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* ── Document viewer modal ── */}
            {viewing && (
                <DocumentViewer
                    filename={viewing}
                    openRaw={openRaw}
                    logView={logView}
                    onClose={() => setViewing(null)}
                />
            )}

            {/* ── Upload modal (HR/Admin only — also gated server-side) ── */}
            {showUpload && canUpload && (
                <div
                    style={{
                        position: 'fixed', inset: 0, zIndex: 9999,
                        background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(4px)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        padding: 20,
                    }}
                    onClick={() => !uploading && setShowUpload(false)}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{
                            width: '100%', maxWidth: 420,
                            background: 'var(--bg-secondary, #1a1d27)',
                            border: '1px solid var(--border, rgba(255,255,255,0.08))',
                            borderRadius: 14, padding: 24,
                            boxShadow: '0 16px 48px rgba(0,0,0,0.5)',
                        }}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
                            <div style={{ fontSize: 15, fontWeight: 700, color: 'var(--text-primary)' }}>Upload document</div>
                            <button
                                onClick={() => !uploading && setShowUpload(false)}
                                style={{ background: 'transparent', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: 4 }}
                            >
                                <CloseIcon />
                            </button>
                        </div>

                        <div
                            onClick={() => fileInputRef.current?.click()}
                            style={{
                                border: `1.5px dashed ${uploadFile ? 'var(--accent)' : 'var(--border, rgba(255,255,255,0.15))'}`,
                                borderRadius: 10,
                                padding: '28px 16px',
                                textAlign: 'center',
                                cursor: 'pointer',
                                background: uploadFile ? 'rgba(79,142,247,0.06)' : 'transparent',
                                transition: 'border-color 0.15s, background 0.15s',
                            }}
                        >
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept=".pdf,.md,.docx,.txt"
                                onChange={handleFileChosen}
                                style={{ display: 'none' }}
                            />
                            {uploadFile ? (
                                <>
                                    <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' }}>{uploadFile.name}</div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                                        {(uploadFile.size / 1024).toFixed(0)} KB — click to choose a different file
                                    </div>
                                </>
                            ) : (
                                <>
                                    <div style={{ color: 'var(--text-muted)', marginBottom: 8, display: 'flex', justifyContent: 'center' }}>
                                        <UploadIcon />
                                    </div>
                                    <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>Click to choose a file</div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>PDF, Markdown, Word, or text</div>
                                </>
                            )}
                        </div>

                        {uploadError && (
                            <div style={{
                                marginTop: 12, padding: '10px 12px', borderRadius: 8,
                                background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
                                color: 'var(--red, #f87171)', fontSize: 12.5,
                            }}>
                                {uploadError}
                            </div>
                        )}

                        <button
                            onClick={handleUploadSubmit}
                            disabled={!uploadFile || uploading}
                            style={{
                                width: '100%', marginTop: 16,
                                padding: '11px 0', borderRadius: 9, border: 'none',
                                background: (!uploadFile || uploading) ? 'rgba(79,142,247,0.3)' : 'var(--accent, #4f8ef7)',
                                color: '#fff', fontSize: 13.5, fontWeight: 600,
                                cursor: (!uploadFile || uploading) ? 'default' : 'pointer',
                            }}
                        >
                            {uploading ? 'Uploading…' : 'Upload'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    )
}

function FilterChip({ label, count, color, active, onClick }) {
    return (
        <button
            onClick={onClick}
            style={{
                padding: '7px 13px', borderRadius: 8,
                border: `1px solid ${active ? (color || 'var(--accent)') : 'var(--border, rgba(255,255,255,0.08))'}`,
                background: active ? (color ? color + '1a' : 'rgba(79,142,247,0.1)') : 'transparent',
                color: active ? (color || 'var(--accent)') : 'var(--text-muted)',
                fontSize: 12, fontWeight: active ? 600 : 500,
                cursor: 'pointer', whiteSpace: 'nowrap',
                transition: 'all 0.12s',
                display: 'flex', alignItems: 'center', gap: 5,
            }}
        >
            {label}
            <span style={{
                fontSize: 10.5, opacity: 0.7, fontWeight: 700,
                background: active ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
                borderRadius: 5, padding: '1px 5px',
            }}>{count}</span>
        </button>
    )
}

function EmptyState({ canUpload, onUpload }) {
    return (
        <div style={{ textAlign: 'center', marginTop: 80 }}>
            <div style={{
                width: 64, height: 64, borderRadius: 16, margin: '0 auto 18px',
                background: 'rgba(79,142,247,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="var(--accent, #4f8ef7)" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                    <path d="M14 2v6h6" />
                </svg>
            </div>
            <div style={{ fontSize: 15, color: 'var(--text-secondary, #94a3b8)', fontWeight: 600 }}>
                No documents yet.
            </div>
            <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 6 }}>
                {canUpload
                    ? 'Upload your first policy document to get started.'
                    : 'Your HR team hasn\'t added any documents yet.'}
            </div>
            {canUpload && (
                <button
                    onClick={onUpload}
                    style={{
                        marginTop: 18, display: 'inline-flex', alignItems: 'center', gap: 7,
                        background: 'var(--accent, #4f8ef7)', border: 'none', borderRadius: 9,
                        padding: '9px 18px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
                    }}
                >
                    <UploadIcon /> Upload Document
                </button>
            )}
        </div>
    )
}