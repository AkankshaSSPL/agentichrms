import { useState } from 'react'

export default function NameChangePopup({ popup, onClose }) {
    const [file, setFile] = useState(null)
    const [uploading, setUploading] = useState(null)

    const handleUpload = async () => {
        if (!file) return
        setUploading(true)
        try {
            const form = new FormData()
            form.append('file', file)
            const res = await fetch(`/api/name-change/${popup.id}/upload`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${localStorage.getItem('hrms_token')}` },
                body: form,
            })
            if (!res.ok) throw new Error(`Server ${res.status}`)
            onClose()
        } catch (e) {
            alert('Upload failed: ' + e.message)
        } finally {
            setUploading(false)
        }
    }

    return (
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center', backdropFilter: 'blur(6px)' }}>
            <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '28px 28px 24px', maxWidth: 440, width: '90%', boxShadow: '0 8px 32px rgba(0,0,0,0.6)', position: 'relative' }}>
                <button onClick={onClose} style={{ position: 'absolute', top: 12, right: 14, background: 'transparent', border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer' }}>✕</button>

                <div style={{ fontSize: 20, marginBottom: 6 }}>📝</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Name Change Submitted</div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 16, lineHeight: 1.5 }}>
                    Your request to change your name from <strong>{popup.old_name}</strong> to{' '}
                    <strong style={{ color: 'var(--accent)' }}>{popup.new_name}</strong> has been sent to HR for approval.
                </div>

                <div style={{ background: 'var(--bg-secondary)', borderRadius: 10, padding: '12px 14px', marginBottom: 16, fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6 }}>
                    <strong style={{ color: 'var(--text-secondary)' }}>Optional:</strong> Upload a supporting document (e.g. marriage certificate) to speed up approval.
                </div>

                {file && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, padding: '6px 10px', background: 'rgba(79,142,247,0.08)', borderRadius: 8, border: '1px solid rgba(79,142,247,0.2)' }}>
                        <span style={{ fontSize: 13 }}>📎</span>
                        <span style={{ fontSize: 12, color: 'var(--accent)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{file.name}</span>
                        <button onClick={() => setFile(null)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 14 }}>✕</button>
                    </div>
                )}

                <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <label style={{ flex: 1, padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-secondary)', fontSize: 13, cursor: 'pointer', textAlign: 'center' }}>
                        {file ? 'Change file' : 'Upload document'}
                        <input type="file" accept=".pdf,.doc,.docx,.jpg,.jpeg,.png" style={{ display: 'none' }} onChange={e => setFile(e.target.files?.[0] || null)} />
                    </label>

                    {file && (
                        <button disabled={uploading} onClick={handleUpload} style={{ flex: 1, padding: '9px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontSize: 13, fontWeight: 600, cursor: uploading ? 'not-allowed' : 'pointer', opacity: uploading ? 0.6 : 1 }}>
                            {uploading ? 'Uploading…' : 'Submit document'}
                        </button>
                    )}

                    <button onClick={onClose} style={{ flex: 1, padding: '9px 14px', borderRadius: 8, border: '1px solid var(--border)', background: 'transparent', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer' }}>
                        Skip for now
                    </button>
                </div>
            </div>
        </div>
    )
}