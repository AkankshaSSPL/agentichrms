/**
 * DocumentLibrary — employee-facing document browser.
 *
 * Lists all ingested documents. Click → opens DocumentViewer modal.
 * The viewer logs the open to behavioral analytics (employee sees nothing of this).
 */

import { useEffect, useState } from 'react'
import { useDocuments } from '../hooks/useDocuments'
import DocumentViewer from './DocumentViewer'

function fileIcon(filename) {
    const ext = filename.split('.').pop().toLowerCase()
    return { pdf: '📕', md: '📘', docx: '📝', txt: '📄' }[ext] || '📄'
}

function fileLabel(filename) {
    // Strip extension and replace underscores/hyphens with spaces for readability
    return filename.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ')
}

export default function DocumentLibrary({ onBack }) {
    const { documents, loading, error, loadDocuments, openRaw, logView } = useDocuments()
    const [viewing, setViewing] = useState(null)   // filename currently open in viewer

    useEffect(() => { loadDocuments() }, [loadDocuments])

    return (
        <div style={{
            minHeight: '100vh',
            background: 'var(--bg-primary, #0f1117)',
            display: 'flex', flexDirection: 'column',
        }}>
            {/* Header */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '14px 28px',
                borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))',
                background: 'var(--bg-secondary, #1a1d27)',
                position: 'sticky', top: 0, zIndex: 10,
            }}>
                <button onClick={onBack} style={{
                    background: 'transparent',
                    border: '1px solid var(--border, rgba(255,255,255,0.1))',
                    borderRadius: 8, padding: '7px 16px',
                    color: 'var(--text-muted, #64748b)', fontSize: 13, cursor: 'pointer',
                }}>← Chat</button>
                <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary, #f1f5f9)' }}>
                         Document Library
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted, #64748b)', marginTop: 2 }}>
                        {loading ? 'Loading…' : `${documents.length} document${documents.length !== 1 ? 's' : ''} available`}
                    </div>
                </div>
            </div>

            {/* Body */}
            <div style={{ flex: 1, padding: '24px 28px', overflow: 'auto' }}>
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
                    <div style={{ textAlign: 'center', marginTop: 80 }}>
                        <div style={{ fontSize: 48, marginBottom: 16 }}>📭</div>
                        <div style={{ fontSize: 15, color: 'var(--text-secondary, #94a3b8)' }}>
                            No documents have been ingested yet.
                        </div>
                        <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 8 }}>
                            Ask your administrator to run the document ingest script.
                        </div>
                    </div>
                )}

                {!loading && documents.length > 0 && (
                    <div style={{
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
                        gap: 16,
                    }}>
                        {documents.map(doc => (
                            <button
                                key={doc.filename}
                                onClick={() => setViewing(doc.filename)}
                                style={{
                                    background: 'var(--bg-card, #1e2130)',
                                    border: '1px solid var(--border, rgba(255,255,255,0.08))',
                                    borderRadius: 12,
                                    padding: '18px 16px',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    transition: 'border-color 0.15s, background 0.15s',
                                    display: 'flex', flexDirection: 'column', gap: 10,
                                }}
                                onMouseEnter={e => {
                                    e.currentTarget.style.borderColor = 'var(--accent, #4f8ef7)'
                                    e.currentTarget.style.background = 'rgba(79,142,247,0.06)'
                                }}
                                onMouseLeave={e => {
                                    e.currentTarget.style.borderColor = 'var(--border, rgba(255,255,255,0.08))'
                                    e.currentTarget.style.background = 'var(--bg-card, #1e2130)'
                                }}
                            >
                                <span style={{ fontSize: 28 }}>{fileIcon(doc.filename)}</span>
                                <div>
                                    <div style={{
                                        fontSize: 13, fontWeight: 600,
                                        color: 'var(--text-primary, #f1f5f9)',
                                        marginBottom: 4,
                                        display: '-webkit-box',
                                        WebkitLineClamp: 2,
                                        WebkitBoxOrient: 'vertical',
                                        overflow: 'hidden',
                                    }}>
                                        {fileLabel(doc.filename)}
                                    </div>
                                    <div style={{ fontSize: 11, color: 'var(--text-muted, #64748b)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                                        {doc.filename.split('.').pop()}
                                    </div>
                                </div>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* Document viewer modal */}
            {viewing && (
                <DocumentViewer
                    filename={viewing}
                    openRaw={openRaw}
                    logView={logView}
                    onClose={() => setViewing(null)}
                />
            )}
        </div>
    )
}