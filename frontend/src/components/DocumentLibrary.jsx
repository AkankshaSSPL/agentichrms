/**
 * DocumentLibrary — document browser grouped by file type.
 *
 * Views:
 *   root     — type-group cards (PDF, MD, TXT, DOCX, ...) derived dynamically
 *              from whatever extensions exist in DOCS_DIR — no hardcoded list
 *   contents — inside a type group, documents + search bar
 *
 * HR/Admin: upload, delete docs
 * Employees: read-only browse and open
 */

import { useEffect, useState, useRef } from 'react'
import { useDocuments } from '../hooks/useDocuments'
import DocumentViewer from './DocumentViewer'

const API = '/api'
function getToken() { return localStorage.getItem('hrms_token') || '' }
function authHeaders() { return { Authorization: `Bearer ${getToken()}` } }
function jsonHeaders() { return { ...authHeaders(), 'Content-Type': 'application/json' } }

// ── File helpers ──────────────────────────────────────────────────────────────
function fileExt(f) { return f.split('.').pop().toLowerCase() }
function fileLabel(f) { return f.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ') }
function fileIcon(f) { return ({ pdf: '', md: '', docx: '', txt: '' })[fileExt(f)] || '   ' }
function fmtSize(b) {
    if (!b) return ''
    if (b < 1024) return `${b} B`
    if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`
    return `${(b / 1048576).toFixed(1)} MB`
}

// ── Folder colours ────────────────────────────────────────────────────────────
const COLORS = ['#4f8ef7','#a78bfa','#34d399','#f59e0b','#f87171','#38bdf8','#fb923c','#a3e635']
const folderColor = idx => COLORS[idx % COLORS.length]

// ── Base styles ───────────────────────────────────────────────────────────────
const cardBase = {
    background: 'var(--bg-card,#1e2130)',
    border: '1px solid var(--border,rgba(255,255,255,0.08))',
    borderRadius: 12, cursor: 'pointer',
    transition: 'border-color .15s, background .15s',
}
const btnStyle = (accent) => ({
    padding: '7px 14px', borderRadius: 7, fontSize: 12, fontWeight: 600,
    cursor: 'pointer', border: 'none', transition: 'opacity .15s',
    background: accent ? 'var(--accent,#4f8ef7)' : 'rgba(255,255,255,0.07)',
    color: accent ? '#fff' : 'var(--text-muted,#64748b)',
})
const inputStyle = {
    boxSizing: 'border-box', padding: '8px 12px', borderRadius: 7, fontSize: 13,
    border: '1px solid var(--border,rgba(255,255,255,0.12))',
    background: 'var(--bg-primary,#0f1117)',
    color: 'var(--text-primary,#f1f5f9)', outline: 'none', width: '100%',
}

// ── Dropdown menu ─────────────────────────────────────────────────────────────
function KebabMenu({ items }) {
    const [open, setOpen] = useState(false)
    const ref = useRef()
    useEffect(() => {
        const h = e => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
        document.addEventListener('mousedown', h)
        return () => document.removeEventListener('mousedown', h)
    }, [])
    return (
        <div ref={ref} style={{ position: 'relative' }} onClick={e => e.stopPropagation()}>
            <button onClick={() => setOpen(o => !o)}
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 18, cursor: 'pointer', padding: '0 4px', lineHeight: 1 }}>
                ⋯
            </button>
            {open && (
                <div style={{
                    position: 'absolute', right: 0, top: 26, zIndex: 99,
                    background: 'var(--bg-secondary,#1a1d27)',
                    border: '1px solid var(--border,rgba(255,255,255,0.12))',
                    borderRadius: 8, overflow: 'hidden', minWidth: 140,
                    boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                }}>
                    {items.map((item, i) => (
                        <div key={i}
                            onClick={() => { setOpen(false); item.action() }}
                            style={{ padding: '10px 14px', fontSize: 13, cursor: 'pointer',
                                     color: item.danger ? 'var(--red,#f87171)' : 'var(--text-primary,#f1f5f9)' }}
                            onMouseEnter={e => e.currentTarget.style.background = item.danger ? 'rgba(248,113,113,0.08)' : 'rgba(255,255,255,0.05)'}
                            onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                            {item.label}
                        </div>
                    ))}
                </div>
            )}
        </div>
    )
}

// ── Modal shell ───────────────────────────────────────────────────────────────
function Modal({ title, onClose, children }) {
    return (
        <div style={{ position:'fixed', inset:0, zIndex:200, background:'rgba(0,0,0,0.6)',
                       backdropFilter:'blur(4px)', display:'flex', alignItems:'center',
                       justifyContent:'center', padding:24 }}>
            <div style={{ background:'var(--bg-secondary,#1a1d27)',
                           border:'1px solid var(--border,rgba(255,255,255,0.1))',
                           borderRadius:12, padding:'24px 28px', width:420, maxWidth:'94vw',
                           boxShadow:'0 16px 48px rgba(0,0,0,0.5)' }}>
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:18 }}>
                    <span style={{ fontSize:15, fontWeight:700, color:'var(--text-primary,#f1f5f9)' }}>{title}</span>
                    <button onClick={onClose} style={{ background:'none', border:'none',
                                                       color:'var(--text-muted)', fontSize:18, cursor:'pointer' }}>✕</button>
                </div>
                {children}
            </div>
        </div>
    )
}

// ── Upload / status banner ────────────────────────────────────────────────────
function Banner({ msg, onDismiss }) {
    if (!msg) return null
    const ok = msg.type === 'ok'
    return (
        <div style={{
            margin:'10px 28px 0', padding:'10px 16px', borderRadius:8, fontSize:13,
            background: ok ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.08)',
            border: `1px solid ${ok ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.2)'}`,
            color: ok ? 'var(--green,#34d399)' : 'var(--red,#f87171)',
            display:'flex', alignItems:'center', justifyContent:'space-between',
        }}>
            <span>{ok ? '✓' : '⚠'} {msg.text}</span>
            <button onClick={onDismiss} style={{ background:'none', border:'none', color:'inherit', cursor:'pointer', fontSize:16 }}>✕</button>
        </div>
    )
}

// ── Upload label button ───────────────────────────────────────────────────────
function UploadBtn({ uploading, onChange }) {
    return (
        <label style={{ ...btnStyle(true), display:'flex', alignItems:'center', gap:6,
                         cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? 0.7 : 1 }}>
            <input type="file" accept=".pdf,.md,.txt,.docx" style={{ display:'none' }}
                   disabled={uploading} onChange={onChange} />
            {uploading ? 'Uploading…' : '↑ Upload Document'}
        </label>
    )
}

// ── Top bar ───────────────────────────────────────────────────────────────────
function TopBar({ onBack, children }) {
    return (
        <div style={{
            display:'flex', alignItems:'center', gap:12,
            padding:'14px 28px',
            borderBottom:'1px solid var(--border,rgba(255,255,255,0.08))',
            background:'var(--bg-secondary,#1a1d27)',
            position:'sticky', top:0, zIndex:10,
        }}>
            <button onClick={onBack} style={{ ...btnStyle(false), fontSize:13 }}>← Chat</button>
            {children}
        </div>
    )
}

// ── Document card ─────────────────────────────────────────────────────────────
function DocCard({ doc, canManage, onOpen, onDelete }) {
    const [hover, setHover] = useState(false)

    const menuItems = canManage ? [
        { label: '🗑 Delete', danger: true, action: () => onDelete(doc.filename) },
    ] : []

    return (
        <div
            onClick={() => onOpen(doc.filename)}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                ...cardBase,
                borderColor: hover ? 'var(--accent,#4f8ef7)' : 'var(--border,rgba(255,255,255,0.08))',
                background: hover ? 'rgba(79,142,247,0.06)' : 'var(--bg-card,#1e2130)',
                padding:'16px', display:'flex', flexDirection:'column', gap:10, position:'relative',
            }}
        >
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start' }}>
                <span style={{ fontSize:24 }}>{fileIcon(doc.filename)}</span>
                {canManage && <KebabMenu items={menuItems} />}
            </div>
            <div>
                <div style={{
                    fontSize:13, fontWeight:600,
                    color:'var(--text-primary,#f1f5f9)', marginBottom:4,
                    display:'-webkit-box', WebkitLineClamp:2,
                    WebkitBoxOrient:'vertical', overflow:'hidden',
                }}>{fileLabel(doc.filename)}</div>
                <div style={{ display:'flex', gap:6, alignItems:'center' }}>
                    <span style={{
                        fontSize:10, fontWeight:700, textTransform:'uppercase', letterSpacing:'0.06em',
                        color:'var(--accent,#4f8ef7)', background:'rgba(79,142,247,0.12)',
                        padding:'2px 6px', borderRadius:4,
                    }}>{fileExt(doc.filename)}</span>
                    {doc.size_bytes > 0 && (
                        <span style={{ fontSize:11, color:'var(--text-muted,#64748b)' }}>{fmtSize(doc.size_bytes)}</span>
                    )}
                </div>
            </div>
        </div>
    )
}

// ── Type-group contents view ──────────────────────────────────────────────────
function GroupContents({ group, canManage, openRaw, logView, onBack, onDocsChanged }) {
    const [search, setSearch] = useState('')
    const [viewing, setViewing] = useState(null)

    const filtered = group.documents.filter(d => d.filename.toLowerCase().includes(search.toLowerCase()))

    async function handleDelete(filename) {
        if (!confirm(`Delete "${filename}"? This cannot be undone.`)) return
        try {
            const res = await fetch(`${API}/documents/${encodeURIComponent(filename)}`, {
                method: 'DELETE', headers: authHeaders(),
            })
            if (res.ok) onDocsChanged()
            else alert('Delete failed.')
        } catch(e) { alert(e.message) }
    }

    return (
        <div style={{ display:'flex', flexDirection:'column', height:'100%' }}>
            {/* Breadcrumb bar */}
            <div style={{
                display:'flex', alignItems:'center', gap:8,
                padding:'11px 28px',
                borderBottom:'1px solid var(--border,rgba(255,255,255,0.06))',
                background:'var(--bg-secondary,#1a1d27)', flexShrink:0,
            }}>
                <button onClick={onBack}
                    style={{ background:'none', border:'none', color:'var(--accent,#4f8ef7)',
                              fontSize:13, cursor:'pointer', padding:0, fontWeight:500 }}>
                    Document Library
                </button>
                <span style={{ color:'var(--text-muted)', fontSize:13 }}>/</span>
                <span style={{ fontSize:13, fontWeight:700, color:'var(--text-primary,#f1f5f9)' }}>
                    {group.label}
                </span>
                <span style={{ fontSize:12, color:'var(--text-muted)', marginLeft:2 }}>
                    ({group.documents.length} file{group.documents.length !== 1 ? 's' : ''})
                </span>
                {/* Search */}
                <div style={{ marginLeft:'auto', width:260 }}>
                    <input
                        style={{ ...inputStyle, padding:'7px 12px', fontSize:13 }}
                        placeholder={`Search in ${group.label}…`}
                        value={search}
                        onChange={e => setSearch(e.target.value)}
                    />
                </div>
            </div>

            {/* Document grid */}
            <div style={{ flex:1, padding:'24px 28px', overflow:'auto' }}>
                {filtered.length === 0 && (
                    <div style={{ textAlign:'center', marginTop:80 }}>
                        <div style={{ fontSize:40, marginBottom:12 }}></div>
                        <div style={{ fontSize:14, color:'var(--text-secondary,#94a3b8)' }}>
                            {search ? 'No files match your search.' : 'This group is empty.'}
                        </div>
                    </div>
                )}
                {filtered.length > 0 && (
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:14 }}>
                        {filtered.map(doc => (
                            <DocCard
                                key={doc.filename}
                                doc={doc}
                                canManage={canManage}
                                onOpen={setViewing}
                                onDelete={handleDelete}
                            />
                        ))}
                    </div>
                )}
            </div>

            {viewing && (
                <DocumentViewer filename={viewing} openRaw={openRaw} logView={logView}
                                onClose={() => setViewing(null)} />
            )}
        </div>
    )
}

// ── Type-group card ───────────────────────────────────────────────────────────
function GroupCard({ group, color, onClick }) {
    const [hover, setHover] = useState(false)

    return (
        <div
            onClick={onClick}
            onMouseEnter={() => setHover(true)}
            onMouseLeave={() => setHover(false)}
            style={{
                ...cardBase, padding:'20px 18px', position:'relative',
                borderColor: hover ? color : 'var(--border,rgba(255,255,255,0.08))',
                background: hover ? `${color}14` : 'var(--bg-card,#1e2130)',
            }}
        >
            {/* SVG folder icon */}
            <div style={{ marginBottom:12 }}>
                <svg width="40" height="34" viewBox="0 0 40 34" fill="none">
                    <path d="M0 6C0 4.343 1.343 3 3 3H15L19 7H37C38.657 7 40 8.343 40 10V31C40 32.657 38.657 34 37 34H3C1.343 34 0 32.657 0 31V6Z"
                          fill={color} fillOpacity="0.2"/>
                    <path d="M0 10C0 8.343 1.343 7 3 7H37C38.657 7 40 8.343 40 10V31C40 32.657 38.657 34 37 34H3C1.343 34 0 32.657 0 31V10Z"
                          fill={color} fillOpacity="0.55"/>
                </svg>
            </div>

            <div style={{ fontSize:14, fontWeight:700, color:'var(--text-primary,#f1f5f9)',
                           marginBottom:4, wordBreak:'break-word' }}>
                {group.label}
            </div>
            <div style={{ fontSize:12, color:'var(--text-muted,#64748b)' }}>
                {group.count} file{group.count !== 1 ? 's' : ''}
            </div>
        </div>
    )
}

// ── Root: type-group grid ─────────────────────────────────────────────────────
export default function DocumentLibrary({ onBack, userRole }) {
    const { openRaw, logView } = useDocuments()
    const canManage = userRole === 'hr' || userRole === 'admin'

    const [groups, setGroups]               = useState([])
    const [loadingGroups, setLoadingGroups] = useState(true)
    const [activeGroup, setActiveGroup]     = useState(null)   // null=root | group object

    const [uploading, setUploading]         = useState(false)
    const [uploadMsg, setUploadMsg]         = useState(null)

    async function loadGroups() {
        setLoadingGroups(true)
        try {
            const res  = await fetch(`${API}/documents/grouped`, { headers: authHeaders() })
            const data = await res.json()
            setGroups(data.groups || [])
        } catch { setGroups([]) } finally { setLoadingGroups(false) }
    }

    useEffect(() => { loadGroups() }, [])

    // Keep the open group's file list in sync after upload/delete, instead of
    // bouncing the user back to root every time.
    useEffect(() => {
        if (!activeGroup) return
        const fresh = groups.find(g => g.type === activeGroup.type)
        setActiveGroup(fresh || null)
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [groups])

    async function handleUpload(e) {
        const file = e.target.files?.[0]
        if (!file) return
        e.target.value = ''
        setUploading(true); setUploadMsg(null)
        try {
            const form = new FormData()
            form.append('file', file)
            const res  = await fetch(`${API}/documents/upload`, { method:'POST', headers:authHeaders(), body:form })
            const data = await res.json()
            if (!res.ok) {
                setUploadMsg({ type:'error', text: data.detail || 'Upload failed.' })
            } else {
                setUploadMsg({ type:'ok', text:`'${data.filename}' uploaded.` })
                loadGroups()
            }
        } catch(err) { setUploadMsg({ type:'error', text: err.message }) }
        finally { setUploading(false) }
    }

    // ── Inside a type group ───────────────────────────────────────────────────
    if (activeGroup !== null) {
        return (
            <div style={{ minHeight:'100vh', background:'var(--bg-primary,#0f1117)', display:'flex', flexDirection:'column' }}>
                <TopBar onBack={onBack}>
                    <div style={{ flex:1 }} />
                    {canManage && (
                        <label style={{ ...btnStyle(true), display:'flex', alignItems:'center', gap:6,
                                         cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? 0.7 : 1 }}>
                            <input type="file" accept=".pdf,.md,.txt,.docx" style={{ display:'none' }}
                                   disabled={uploading} onChange={handleUpload} />
                            {uploading ? 'Uploading…' : '↑ Upload'}
                        </label>
                    )}
                </TopBar>
                <Banner msg={uploadMsg} onDismiss={() => setUploadMsg(null)} />
                <div style={{ flex:1, overflow:'hidden' }}>
                    <GroupContents
                        group={activeGroup}
                        canManage={canManage}
                        openRaw={openRaw}
                        logView={logView}
                        onBack={() => setActiveGroup(null)}
                        onDocsChanged={loadGroups}
                    />
                </div>
            </div>
        )
    }

    // ── Root type-group grid ──────────────────────────────────────────────────
    const totalDocs = groups.reduce((s, g) => s + g.count, 0)

    return (
        <div style={{ minHeight:'100vh', background:'var(--bg-primary,#0f1117)', display:'flex', flexDirection:'column' }}>
            <TopBar onBack={onBack}>
                <div style={{ flex:1 }}>
                    <div style={{ fontSize:16, fontWeight:700, color:'var(--text-primary,#f1f5f9)' }}>
                        Document Library
                    </div>
                    <div style={{ fontSize:12, color:'var(--text-muted,#64748b)', marginTop:2 }}>
                        {loadingGroups ? 'Loading…'
                            : `${groups.length} type${groups.length !== 1 ? 's' : ''} · ${totalDocs} document${totalDocs !== 1 ? 's' : ''}`}
                    </div>
                </div>
                {canManage && <UploadBtn uploading={uploading} onChange={handleUpload} />}
            </TopBar>

            <Banner msg={uploadMsg} onDismiss={() => setUploadMsg(null)} />

            <div style={{ flex:1, padding:'28px', overflow:'auto' }}>
                {loadingGroups && (
                    <div style={{ color:'var(--text-muted)', fontSize:14, textAlign:'center', marginTop:60 }}>Loading…</div>
                )}

                {!loadingGroups && groups.length === 0 && (
                    <div style={{ textAlign:'center', marginTop:80 }}>
                        <div style={{ fontSize:48, marginBottom:12 }}></div>
                        <div style={{ fontSize:15, color:'var(--text-secondary,#94a3b8)' }}>No documents yet.</div>
                        {canManage && (
                            <div style={{ fontSize:13, color:'var(--text-muted)', marginTop:8 }}>
                                Click "Upload Document" to get started.
                            </div>
                        )}
                    </div>
                )}

                {!loadingGroups && groups.length > 0 && (
                    <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(200px,1fr))', gap:16 }}>
                        {groups.map((group, idx) => (
                            <GroupCard
                                key={group.type}
                                group={group}
                                color={folderColor(idx)}
                                onClick={() => setActiveGroup(group)}
                            />
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}