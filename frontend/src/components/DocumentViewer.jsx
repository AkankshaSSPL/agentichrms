/**
 * DocumentViewer — modal overlay that renders a document inline.
 *
 * Rendering by extension:
 *   .pdf  → <object> (native browser PDF renderer)
 *   .md / .txt → fetched as text, shown in a styled <pre>
 *   .docx → download link (browsers can't render docx inline)
 *
 * On open:  fetches blob URL + calls logView() once (analytics trigger).
 * On close: revokes the object URL to free memory.
 */

import { useEffect, useState, useRef } from 'react'

export default function DocumentViewer({ filename, openRaw, logView, onClose }) {
    const [blobUrl, setBlobUrl]       = useState(null)
    const [textContent, setTextContent] = useState(null)
    const [contentType, setContentType] = useState(null)
    const [loadError, setLoadError]   = useState(null)
    const [fetching, setFetching]     = useState(true)
    const blobRef = useRef(null)

    const ext = filename.split('.').pop().toLowerCase()

    useEffect(() => {
        let cancelled = false

        async function load() {
            setFetching(true)
            setLoadError(null)
            try {
                // Log the view first (fire-and-forget, non-fatal)
                logView(filename)

                if (ext === 'docx') {
                    // Docx can't render inline — fetch blob for download link
                    const { url, contentType: ct } = await openRaw(filename)
                    if (!cancelled) { blobRef.current = url; setBlobUrl(url); setContentType(ct) }
                } else if (ext === 'md' || ext === 'txt') {
                    // Fetch as text for inline display
                    const { url, contentType: ct } = await openRaw(filename)
                    if (!cancelled) { blobRef.current = url; setContentType(ct) }
                    const res = await fetch(url)
                    const text = await res.text()
                    if (!cancelled) setTextContent(text)
                } else {
                    // PDF and anything else — blob URL into <object>
                    const { url, contentType: ct } = await openRaw(filename)
                    if (!cancelled) { blobRef.current = url; setBlobUrl(url); setContentType(ct) }
                }
            } catch (e) {
                if (!cancelled) setLoadError(e.message)
            } finally {
                if (!cancelled) setFetching(false)
            }
        }

        load()
        return () => {
            cancelled = true
            if (blobRef.current) {
                URL.revokeObjectURL(blobRef.current)
                blobRef.current = null
            }
        }
    }, [filename])

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 99999,
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
        }}>
            <div style={{
                background: 'var(--bg-secondary, #1a1d27)',
                border: '1px solid var(--border, rgba(255,255,255,0.08))',
                borderRadius: 14,
                width: '90vw', maxWidth: 960,
                height: '85vh',
                display: 'flex', flexDirection: 'column',
                boxShadow: '0 16px 64px rgba(0,0,0,0.6)',
                overflow: 'hidden',
            }}>
                {/* Header */}
                <div style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '14px 20px',
                    borderBottom: '1px solid var(--border, rgba(255,255,255,0.08))',
                    flexShrink: 0,
                }}>
                    <span style={{ fontSize: 18 }}>
                        {ext === 'pdf' ? '📕' : ext === 'md' ? '📘' : ext === 'docx' ? '📝' : '📄'}
                    </span>
                    <span style={{
                        flex: 1, fontSize: 14, fontWeight: 600,
                        color: 'var(--text-primary, #f1f5f9)',
                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>{filename}</span>
                    <button onClick={onClose} style={{
                        background: 'transparent', border: 'none',
                        color: 'var(--text-muted, #64748b)', fontSize: 20,
                        cursor: 'pointer', lineHeight: 1, padding: 4,
                    }}>✕</button>
                </div>

                {/* Body */}
                <div style={{ flex: 1, overflow: 'hidden', position: 'relative' }}>
                    {fetching && (
                        <div style={{
                            position: 'absolute', inset: 0,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'var(--text-muted, #64748b)', fontSize: 14,
                        }}>
                            Loading document…
                        </div>
                    )}

                    {loadError && (
                        <div style={{
                            position: 'absolute', inset: 0,
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', gap: 12,
                        }}>
                            <span style={{ fontSize: 32 }}>⚠️</span>
                            <span style={{ fontSize: 14, color: 'var(--red, #f87171)' }}>{loadError}</span>
                            <button onClick={onClose} style={{
                                padding: '8px 20px', borderRadius: 8, border: 'none',
                                background: 'var(--accent, #4f8ef7)', color: '#fff',
                                fontSize: 13, cursor: 'pointer',
                            }}>Close</button>
                        </div>
                    )}

                    {/* PDF */}
                    {!fetching && !loadError && ext === 'pdf' && blobUrl && (
                        <object
                            data={blobUrl}
                            type="application/pdf"
                            style={{ width: '100%', height: '100%', border: 'none' }}
                        >
                            <div style={{ padding: 24, color: 'var(--text-secondary)' }}>
                                Your browser cannot display this PDF inline.{' '}
                                <a href={blobUrl} download={filename} style={{ color: 'var(--accent)' }}>
                                    Download it instead.
                                </a>
                            </div>
                        </object>
                    )}

                    {/* Markdown / plain text */}
                    {!fetching && !loadError && (ext === 'md' || ext === 'txt') && textContent !== null && (
                        <pre style={{
                            margin: 0, padding: '20px 24px',
                            height: '100%', overflow: 'auto',
                            fontSize: 13, lineHeight: 1.7,
                            color: 'var(--text-primary, #f1f5f9)',
                            fontFamily: ext === 'md'
                                ? 'system-ui, -apple-system, sans-serif'
                                : 'monospace',
                            whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            background: 'transparent',
                        }}>{textContent}</pre>
                    )}

                    {/* DOCX — download only */}
                    {!fetching && !loadError && ext === 'docx' && blobUrl && (
                        <div style={{
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            height: '100%', gap: 16,
                        }}>
                            <span style={{ fontSize: 48 }}>📝</span>
                            <p style={{ fontSize: 14, color: 'var(--text-secondary)', margin: 0, textAlign: 'center' }}>
                                Word documents cannot be previewed inline.<br />
                                Download to view in Microsoft Word or Google Docs.
                            </p>
                            <a
                                href={blobUrl}
                                download={filename}
                                style={{
                                    padding: '10px 24px', borderRadius: 8,
                                    background: 'var(--accent, #4f8ef7)', color: '#fff',
                                    fontSize: 13, fontWeight: 600, textDecoration: 'none',
                                }}
                            >
                                Download {filename}
                            </a>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}