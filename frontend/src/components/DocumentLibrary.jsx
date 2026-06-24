import { useState, useEffect, useRef, useMemo } from 'react'
import { useDocuments } from '../hooks/useDocuments'
import DocumentViewer from './DocumentViewer'

// ── Category config (for display only; no longer used in upload) ──────────────
const CATEGORY_META = {
  general:      { label: 'General',      color: '#94A3B8', bg: 'rgba(148,163,184,0.12)', dot: '#94A3B8' },
  posh:         { label: 'POSH',         color: '#F87171', bg: 'rgba(248,113,113,0.12)', dot: '#F87171' },
  exit_intent:  { label: 'Exit Intent',  color: '#FBBF24', bg: 'rgba(251,191,36,0.12)',  dot: '#FBBF24' },
  leave_intent: { label: 'Leave Intent', color: '#60A5FA', bg: 'rgba(96,165,250,0.12)',  dot: '#60A5FA' },
  growth:       { label: 'Growth',       color: '#34D399', bg: 'rgba(52,211,153,0.12)',  dot: '#34D399' },
}

const FILE_TYPE = {
  pdf:  { label: 'PDF',  color: '#f87171', bg: 'rgba(248,113,113,0.10)', icon: 'pdf'  },
  md:   { label: 'MD',   color: '#60a5fa', bg: 'rgba(96,165,250,0.10)',  icon: 'doc'  },
  docx: { label: 'DOCX', color: '#a78bfa', bg: 'rgba(167,139,250,0.10)', icon: 'doc'  },
  txt:  { label: 'TXT',  color: '#94a3b8', bg: 'rgba(148,163,184,0.10)', icon: 'txt'  },
}
const DEFAULT_TYPE = { label: 'FILE', color: '#94a3b8', bg: 'rgba(148,163,184,0.10)', icon: 'doc' }

const ALLOWED_EXT = ['.pdf', '.docx', '.txt', '.md']

function getExt(filename) { return (filename.split('.').pop() || '').toLowerCase() }
function typeFor(filename) { return FILE_TYPE[getExt(filename)] || DEFAULT_TYPE }
function fileLabel(filename) { return filename.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ') }

// ── Icons ──────────────────────────────────────────────────────────────────────
function FileGlyph({ icon, color, size = 20 }) {
  const p = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: color, strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' }
  if (icon === 'pdf') return (
    <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><path d="M9 15.5h1.4a1.3 1.3 0 0 0 0-2.6H9V17"/></svg>
  )
  if (icon === 'txt') return (
    <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="16.5" x2="13" y2="16.5"/></svg>
  )
  return (
    <svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/><line x1="8" y1="13" x2="16" y2="13"/><line x1="8" y1="17" x2="16" y2="17"/></svg>
  )
}

const SearchIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <circle cx="11" cy="11" r="7"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
)
const UploadIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 16V4"/><path d="M6 10l6-6 6 6"/><path d="M4 18v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/>
  </svg>
)
const CloseIcon = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round">
    <line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>
  </svg>
)
const TrashIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
  </svg>
)

// ── Category badge (still used for display) ─────────────────────────────────
function CategoryBadge({ category }) {
  const m = CATEGORY_META[category] || CATEGORY_META.general
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 4,
      fontSize: 10, fontWeight: 600, padding: '2px 7px', borderRadius: 20,
      color: m.color, background: m.bg, letterSpacing: '0.02em',
    }}>
      <span style={{ width: 4, height: 4, borderRadius: '50%', background: m.dot, flexShrink: 0 }} />
      {m.label}
    </span>
  )
}

// ── Filter chip ────────────────────────────────────────────────────────────────
function FilterChip({ label, count, color, active, onClick }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 12px', borderRadius: 8,
      border: `1px solid ${active ? (color || 'var(--accent, #4f8ef7)') : 'rgba(255,255,255,0.08)'}`,
      background: active ? (color ? color + '1a' : 'rgba(79,142,247,0.1)') : 'transparent',
      color: active ? (color || 'var(--accent, #4f8ef7)') : '#64748b',
      fontSize: 12, fontWeight: active ? 600 : 500,
      cursor: 'pointer', whiteSpace: 'nowrap',
      display: 'flex', alignItems: 'center', gap: 5,
    }}>
      {label}
      <span style={{
        fontSize: 10, opacity: 0.75, fontWeight: 700,
        background: active ? 'rgba(255,255,255,0.12)' : 'rgba(255,255,255,0.06)',
        borderRadius: 4, padding: '1px 5px',
      }}>{count}</span>
    </button>
  )
}

// ── Delete confirmation modal ──────────────────────────────────────────────────
function DeleteModal({ filename, onConfirm, onCancel, loading }) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={e => { if (e.target === e.currentTarget && !loading) onCancel() }}>
      <div style={{
        background: '#161B22', border: '1px solid rgba(248,113,113,0.2)',
        borderRadius: 16, padding: '28px 32px', maxWidth: 400, width: '100%',
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
      }}>
        <div style={{ fontSize: 28, marginBottom: 14 }}></div>
        <p style={{ margin: '0 0 8px', fontWeight: 600, fontSize: 15, color: '#F1F5F9' }}>
          Delete document?
        </p>
        <p style={{ margin: '0 0 24px', fontSize: 13, color: '#64748B', lineHeight: 1.6 }}>
          <span style={{ color: '#94A3B8', fontWeight: 500 }}>{filename}</span> will be permanently
          removed from the library and the search index. This cannot be undone.
        </p>
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onCancel} disabled={loading} style={{
            padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
            border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer',
            background: 'transparent', color: '#94A3B8',
          }}>Cancel</button>
          <button onClick={onConfirm} disabled={loading} style={{
            padding: '8px 18px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            border: 'none', cursor: loading ? 'not-allowed' : 'pointer',
            background: loading ? 'rgba(248,113,113,0.3)' : '#F87171',
            color: loading ? '#64748B' : '#0D1117',
          }}>{loading ? 'Deleting…' : 'Delete'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Upload modal (category removed) ───────────────────────────────────────────
function UploadModal({ onClose, onSuccess, uploadDocument }) {
  const [file, setFile] = useState(null)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [dragging, setDragging] = useState(false)
  const fileRef = useRef()

  function pickFile(f) {
    if (!f) return
    const ext = '.' + f.name.split('.').pop().toLowerCase()
    if (!ALLOWED_EXT.includes(ext)) { setErrorMsg(`Not supported. Use: ${ALLOWED_EXT.join(', ')}`); return }
    setErrorMsg(''); setFile(f)
  }

  async function handleUpload() {
    if (!file || status === 'uploading') return
    setStatus('uploading'); setProgress(0); setErrorMsg('')
    const ticker = setInterval(() => setProgress(p => Math.min(p + 12, 85)), 180)
    try {
      // Always tag as 'general' (not tracked by analytics)
      await uploadDocument(file, 'general')
      clearInterval(ticker); setProgress(100); setStatus('done')
      setTimeout(() => { onSuccess(); onClose() }, 900)
    } catch (err) {
      clearInterval(ticker); setStatus('error')
      setErrorMsg(err.message || 'Upload failed.')
    }
  }

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
    }} onClick={e => { if (e.target === e.currentTarget && status !== 'uploading') onClose() }}>
      <div style={{
        background: '#161B22', border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 16, padding: '28px 28px 24px', width: '100%', maxWidth: 440,
        boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
      }}>
        {/* Title */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
          <div>
            <p style={{ margin: 0, fontSize: 15, fontWeight: 600, color: '#F1F5F9' }}>Upload document</p>
            <p style={{ margin: '3px 0 0', fontSize: 12, color: '#64748B' }}>PDF, DOCX, TXT or MD · max 50 MB</p>
          </div>
          {status !== 'uploading' && (
            <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748B', padding: 4 }}>
              <CloseIcon />
            </button>
          )}
        </div>

        {/* Drop zone */}
        <div
          onClick={() => fileRef.current?.click()}
          onDragOver={e => { e.preventDefault(); setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={e => { e.preventDefault(); setDragging(false); pickFile(e.dataTransfer.files[0]) }}
          style={{
            border: `2px dashed ${dragging ? '#60A5FA' : file ? '#34D399' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: 12, padding: '24px 16px', textAlign: 'center',
            cursor: 'pointer', marginBottom: 18,
            background: dragging ? 'rgba(96,165,250,0.05)' : file ? 'rgba(52,211,153,0.04)' : 'rgba(255,255,255,0.02)',
            transition: 'all 0.15s',
          }}
        >
          <input ref={fileRef} type="file" accept={ALLOWED_EXT.join(',')}
            onChange={e => pickFile(e.target.files[0])} style={{ display: 'none' }} />
          {file ? (
            <>
              <div style={{ fontSize: 24, marginBottom: 6 }}>📄</div>
              <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#34D399' }}>{file.name}</p>
              <p style={{ margin: '3px 0 0', fontSize: 11, color: '#64748B' }}>
                {(file.size / 1024).toFixed(0)} KB — click to change
              </p>
            </>
          ) : (
            <>
              <div style={{ fontSize: 24, marginBottom: 6 }}></div>
              <p style={{ margin: 0, fontSize: 13, color: '#94A3B8' }}>
                Drag & drop or <span style={{ color: '#60A5FA', fontWeight: 600 }}>browse</span>
              </p>
              <p style={{ margin: '4px 0 0', fontSize: 11, color: '#475569' }}>{ALLOWED_EXT.join('  ·  ')}</p>
            </>
          )}
        </div>

        {/* Category dropdown removed – document will be tagged as 'general' */}

        {/* Progress */}
        {(status === 'uploading' || status === 'done') && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
              <div style={{
                height: '100%', borderRadius: 2, width: `${progress}%`,
                background: status === 'done' ? '#34D399' : '#60A5FA',
                transition: 'width 0.25s ease, background 0.3s',
              }} />
            </div>
            <p style={{ margin: '5px 0 0', fontSize: 11, color: '#64748B', textAlign: 'right' }}>
              {status === 'done' ? '✓ Uploaded and indexed' : `${progress}%`}
            </p>
          </div>
        )}

        {errorMsg && (
          <div style={{
            marginBottom: 14, padding: '9px 12px', borderRadius: 8,
            background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
            fontSize: 12, color: '#F87171',
          }}>{errorMsg}</div>
        )}

        {/* Actions */}
        <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end' }}>
          <button onClick={onClose} disabled={status === 'uploading'} style={{
            padding: '8px 16px', borderRadius: 8, fontSize: 13, fontWeight: 500,
            border: '1px solid rgba(255,255,255,0.1)', cursor: 'pointer',
            background: 'transparent', color: '#94A3B8',
            opacity: status === 'uploading' ? 0.4 : 1,
          }}>Cancel</button>
          <button onClick={handleUpload} disabled={!file || status === 'uploading' || status === 'done'} style={{
            padding: '8px 20px', borderRadius: 8, fontSize: 13, fontWeight: 600,
            border: 'none', cursor: (!file || status !== 'idle') ? 'not-allowed' : 'pointer',
            background: (!file || status !== 'idle') ? 'rgba(96,165,250,0.25)' : '#60A5FA',
            color: (!file || status !== 'idle') ? '#475569' : '#0D1117',
            transition: 'all 0.15s',
          }}>{status === 'uploading' ? 'Uploading…' : status === 'done' ? 'Done ✓' : 'Upload'}</button>
        </div>
      </div>
    </div>
  )
}

// ── Main component ─────────────────────────────────────────────────────────────
export default function DocumentLibrary({ employee, onBack }) {
  const {
    documents, loading, error,
    loadDocuments, openRaw, logView,
    uploadDocument, deleteDocument, fetchCategories,
  } = useDocuments()

  const [categories, setCategories] = useState(
    Object.entries(CATEGORY_META).map(([value, m]) => ({ value, label: m.label }))
  )
  const [viewing, setViewing] = useState(null)
  const [query, setQuery] = useState('')
  const [activeType, setActiveType] = useState('all')
  const [showUpload, setShowUpload] = useState(false)
  const [deleteTarget, setDeleteTarget] = useState(null)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [toast, setToast] = useState(null)

  const canManage = employee && ['hr', 'admin'].includes(employee.role)

  useEffect(() => {
    loadDocuments()
    fetchCategories().then(cats => { if (cats?.length) setCategories(cats) }).catch(() => {})
  }, [])

  function showToast(msg, type = 'success') {
    setToast({ msg, type })
    setTimeout(() => setToast(null), 3000)
  }

  async function handleDelete() {
    if (!deleteTarget) return
    setDeleteLoading(true)
    try {
      await deleteDocument(deleteTarget)
      showToast(`${deleteTarget} deleted.`)
      loadDocuments()
    } catch (err) {
      showToast(err.message || 'Delete failed.', 'error')
    } finally {
      setDeleteLoading(false); setDeleteTarget(null)
    }
  }

  const typeCounts = useMemo(() => {
    const counts = { all: documents.length }
    documents.forEach(d => { const e = getExt(d.filename); counts[e] = (counts[e] || 0) + 1 })
    return counts
  }, [documents])

  const presentTypes = useMemo(
    () => Object.keys(FILE_TYPE).filter(ext => typeCounts[ext] > 0),
    [typeCounts]
  )

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    return documents.filter(d => {
      if (activeType !== 'all' && getExt(d.filename) !== activeType) return false
      if (q && !d.filename.toLowerCase().includes(q)) return false
      return true
    })
  }, [documents, query, activeType])

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg-primary, #0f1117)', display: 'flex', flexDirection: 'column' }}>

      {/* Toast */}
      {toast && (
        <div style={{
          position: 'fixed', bottom: 24, right: 24, zIndex: 10000,
          padding: '10px 16px', borderRadius: 10, fontSize: 13, fontWeight: 500,
          background: toast.type === 'error' ? 'rgba(248,113,113,0.12)' : 'rgba(52,211,153,0.12)',
          color: toast.type === 'error' ? '#F87171' : '#34D399',
          border: `1px solid ${toast.type === 'error' ? 'rgba(248,113,113,0.25)' : 'rgba(52,211,153,0.25)'}`,
          boxShadow: '0 8px 32px rgba(0,0,0,0.4)', backdropFilter: 'blur(8px)',
        }}>
          {toast.type === 'error' ? '✕ ' : '✓ '}{toast.msg}
        </div>
      )}

      {/* Header */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14, padding: '16px 28px',
        borderBottom: '1px solid rgba(255,255,255,0.08)',
        background: 'var(--bg-secondary, #1a1d27)',
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        {onBack && (
          <button onClick={onBack} style={{
            background: 'transparent', border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: 8, padding: '7px 14px',
            color: '#64748b', fontSize: 13, cursor: 'pointer', flexShrink: 0,
          }}>← Chat</button>
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700, color: '#f1f5f9', letterSpacing: '-0.01em' }}>
            Document Library
          </div>
          <div style={{ fontSize: 12, color: '#64748b', marginTop: 1 }}>
            {loading ? 'Loading…' : `${documents.length} document${documents.length !== 1 ? 's' : ''} available`}
          </div>
        </div>
        {canManage && (
          <button
            onClick={() => setShowUpload(true)}
            style={{
              display: 'flex', alignItems: 'center', gap: 7,
              background: '#4f8ef7', border: 'none', borderRadius: 9,
              padding: '9px 16px', color: '#fff', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', flexShrink: 0,
              boxShadow: '0 2px 10px rgba(79,142,247,0.3)',
            }}
            onMouseEnter={e => { e.currentTarget.style.transform = 'translateY(-1px)'; e.currentTarget.style.boxShadow = '0 4px 14px rgba(79,142,247,0.4)' }}
            onMouseLeave={e => { e.currentTarget.style.transform = 'none'; e.currentTarget.style.boxShadow = '0 2px 10px rgba(79,142,247,0.3)' }}
          >
            <UploadIcon /> Upload Document
          </button>
        )}
      </div>

      {/* Toolbar */}
      {!loading && documents.length > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '16px 28px 0', flexWrap: 'wrap' }}>
          {/* Search */}
          <div style={{
            display: 'flex', alignItems: 'center', gap: 8,
            background: 'var(--bg-secondary, #1a1d27)',
            border: '1px solid rgba(255,255,255,0.08)',
            borderRadius: 9, padding: '8px 12px',
            minWidth: 200, flex: '0 1 260px',
          }}>
            <span style={{ color: '#64748b', display: 'flex' }}><SearchIcon /></span>
            <input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search documents…" style={{
              flex: 1, background: 'transparent', border: 'none', outline: 'none',
              color: '#f1f5f9', fontSize: 13,
            }} />
          </div>

          {/* Type filters */}
          <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
            <FilterChip label="All" count={typeCounts.all} active={activeType === 'all'} onClick={() => setActiveType('all')} />
            {presentTypes.map(ext => (
              <FilterChip key={ext} label={FILE_TYPE[ext].label} count={typeCounts[ext]}
                color={FILE_TYPE[ext].color} active={activeType === ext} onClick={() => setActiveType(ext)} />
            ))}
          </div>
        </div>
      )}

      {/* Body */}
      <div style={{ flex: 1, padding: '20px 28px 32px' }}>
        {loading && (
          <div style={{ color: '#64748b', fontSize: 14, textAlign: 'center', marginTop: 60 }}>
            Loading documents…
          </div>
        )}
        {error && !loading && (
          <div style={{
            padding: '12px 16px', borderRadius: 10,
            background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)',
            color: '#f87171', fontSize: 13, marginBottom: 20,
          }}>Could not load documents: {error}</div>
        )}
        {!loading && documents.length === 0 && !error && (
          <div style={{ textAlign: 'center', marginTop: 80 }}>
            <div style={{
              width: 56, height: 56, borderRadius: 14, margin: '0 auto 16px',
              background: 'rgba(79,142,247,0.08)', display: 'flex', alignItems: 'center', justifyContent: 'center',
            }}>
              <svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#4f8ef7" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>
              </svg>
            </div>
            <div style={{ fontSize: 15, color: '#94a3b8', fontWeight: 600 }}>No documents yet.</div>
            <div style={{ fontSize: 13, color: '#64748b', marginTop: 6 }}>
              {canManage ? 'Upload your first policy document to get started.' : "Your HR team hasn't added any documents yet."}
            </div>
            {canManage && (
              <button onClick={() => setShowUpload(true)} style={{
                marginTop: 16, display: 'inline-flex', alignItems: 'center', gap: 7,
                background: '#4f8ef7', border: 'none', borderRadius: 9,
                padding: '9px 18px', color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer',
              }}><UploadIcon /> Upload Document</button>
            )}
          </div>
        )}
        {!loading && documents.length > 0 && visible.length === 0 && (
          <div style={{ textAlign: 'center', marginTop: 60, fontSize: 14, color: '#64748b' }}>
            No documents match your filters.
          </div>
        )}

        {/* Grid */}
        {!loading && visible.length > 0 && (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(230px, 1fr))',
            gap: 14, marginTop: 4,
          }}>
            {visible.map(doc => (
              <DocCard
                key={doc.filename}
                doc={doc}
                canManage={canManage}
                onView={() => setViewing(doc.filename)}
                onDelete={() => setDeleteTarget(doc.filename)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Document viewer */}
      {viewing && (
        <DocumentViewer
          filename={viewing}
          openRaw={openRaw}
          logView={logView}
          onClose={() => setViewing(null)}
        />
      )}

      {/* Upload modal */}
      {showUpload && canManage && (
        <UploadModal
          uploadDocument={uploadDocument}
          onClose={() => setShowUpload(false)}
          onSuccess={loadDocuments}
        />
      )}

      {/* Delete modal */}
      {deleteTarget && (
        <DeleteModal
          filename={deleteTarget}
          loading={deleteLoading}
          onConfirm={handleDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

// ── Document card ──────────────────────────────────────────────────────────────
function DocCard({ doc, canManage, onView, onDelete }) {
  const t = typeFor(doc.filename)
  const [hovered, setHovered] = useState(false)

  return (
    <div
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        position: 'relative',
        background: hovered ? 'var(--bg-secondary, #1f2330)' : 'var(--bg-card, #1a1d27)',
        border: `1px solid ${hovered ? t.color + '55' : 'rgba(255,255,255,0.07)'}`,
        borderRadius: 12, overflow: 'hidden',
        transition: 'transform 0.12s, border-color 0.12s, background 0.12s',
        transform: hovered ? 'translateY(-2px)' : 'none',
        cursor: 'default',
      }}
    >
      {/* Accent bar */}
      <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: 3, background: t.color }} />

      {/* Delete button — top right */}
      {canManage && (
        <button
          onClick={e => { e.stopPropagation(); onDelete() }}
          title="Delete document"
          style={{
            position: 'absolute', top: 8, right: 8, zIndex: 2,
            background: hovered ? 'rgba(248,113,113,0.14)' : 'rgba(248,113,113,0.06)',
            border: `1px solid ${hovered ? 'rgba(248,113,113,0.35)' : 'rgba(248,113,113,0.15)'}`,
            borderRadius: 6, padding: '4px 5px', cursor: 'pointer',
            color: hovered ? '#F87171' : 'rgba(248,113,113,0.55)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            transition: 'all 0.15s',
          }}
          onFocus={e => { e.currentTarget.style.color = '#F87171'; e.currentTarget.style.background = 'rgba(248,113,113,0.14)'; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.35)' }}
          onBlur={e => { if (!hovered) { e.currentTarget.style.color = 'rgba(248,113,113,0.55)'; e.currentTarget.style.background = 'rgba(248,113,113,0.06)'; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.15)' } }}
        >
          <TrashIcon />
        </button>
      )}

      {/* Clickable content */}
      <button onClick={onView} style={{
        background: 'none', border: 'none', padding: '16px 16px 18px 20px',
        cursor: 'pointer', textAlign: 'left', width: '100%', display: 'flex',
        alignItems: 'flex-start', gap: 12,
      }}>
        {/* Icon */}
        <span style={{
          width: 38, height: 38, borderRadius: 9, flexShrink: 0,
          background: t.bg, display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <FileGlyph icon={t.icon} color={t.color} />
        </span>

        {/* Name + type */}
        <div style={{ minWidth: 0, flex: 1, paddingRight: canManage ? 18 : 0 }}>
          <div style={{
            fontSize: 13, fontWeight: 600, color: '#f1f5f9',
            marginBottom: 6, lineHeight: 1.35,
            display: '-webkit-box', WebkitLineClamp: 2,
            WebkitBoxOrient: 'vertical', overflow: 'hidden',
            textTransform: 'capitalize',
          }}>
            {fileLabel(doc.filename)}
          </div>
          <span style={{
            display: 'inline-block', fontSize: 10, fontWeight: 700,
            color: t.color, background: t.bg,
            padding: '2px 7px', borderRadius: 5, letterSpacing: '0.04em',
          }}>{t.label}</span>
        </div>
      </button>
    </div>
  )
}