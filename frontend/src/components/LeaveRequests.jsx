// src/components/LeaveRequests.jsx
import { useState, useEffect, useCallback } from 'react'

const API = '/api'

const STATUS_STYLES = {
    Pending:  { bg: 'rgba(79,142,247,0.12)',  color: '#60a5fa', border: 'rgba(79,142,247,0.3)'  },
    Approved: { bg: 'rgba(52,211,153,0.12)',  color: '#34d399', border: 'rgba(52,211,153,0.3)'  },
    Rejected: { bg: 'rgba(248,113,113,0.12)', color: '#f87171', border: 'rgba(248,113,113,0.3)' },
}

function StatusBadge({ status }) {
    const s = STATUS_STYLES[status] || STATUS_STYLES.Pending
    return (
        <span style={{ background: s.bg, color: s.color, border: `1px solid ${s.border}`, padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600, letterSpacing: '0.04em' }}>
            {status}
        </span>
    )
}

function LeaveTypeBadge({ type }) {
    return (
        <span style={{ background: 'rgba(139,92,246,0.12)', color: '#a78bfa', border: '1px solid rgba(139,92,246,0.25)', padding: '3px 10px', borderRadius: 20, fontSize: 10, fontWeight: 600 }}>
            {type}
        </span>
    )
}

export default function LeaveRequests({ token: tokenProp, onAlert }) {
    const token = tokenProp || localStorage.getItem('hrms_token') || ''
    const showAlert = onAlert || ((msg) => alert(msg))

    const [filter, setFilter]               = useState('Pending')
    const [leaves, setLeaves]               = useState([])
    const [loading, setLoading]             = useState(true)
    const [actionLoading, setActionLoading] = useState(null)
    const [rejectModal, setRejectModal]     = useState(null)  // leave object
    const [rejectReason, setRejectReason]   = useState('')
    const [counts, setCounts]               = useState({ Pending: 0, Approved: 0, Rejected: 0 })

    const fetchLeaves = useCallback(async (statusFilter) => {
        setLoading(true)
        try {
            const sf = statusFilter || filter
            const url = sf === 'Pending'
                ? `${API}/leaves/pending`
                : `${API}/leaves/all?status_filter=${sf}`
            const res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } })
            if (!res.ok) throw new Error(`Server ${res.status}`)
            const data = await res.json()
            setLeaves(Array.isArray(data) ? data : [])
        } catch (e) {
            showAlert('Failed to load leaves: ' + e.message, 'error')
        } finally { setLoading(false) }
    }, [token, filter])

    // Fetch counts for all tabs
    const fetchCounts = useCallback(async () => {
        try {
            const t = token
            const [pRes, aRes, rRes] = await Promise.all([
                fetch(`${API}/leaves/pending`,               { headers: { Authorization: `Bearer ${t}` } }),
                fetch(`${API}/leaves/all?status_filter=Approved`, { headers: { Authorization: `Bearer ${t}` } }),
                fetch(`${API}/leaves/all?status_filter=Rejected`, { headers: { Authorization: `Bearer ${t}` } }),
            ])
            const [p, a, r] = await Promise.all([pRes.json(), aRes.json(), rRes.json()])
            setCounts({
                Pending:  Array.isArray(p) ? p.length : 0,
                Approved: Array.isArray(a) ? a.length : 0,
                Rejected: Array.isArray(r) ? r.length : 0,
            })
        } catch (_) {}
    }, [token])

    useEffect(() => {
        fetchLeaves(filter)
    }, [filter])

    useEffect(() => {
        fetchCounts()
        const interval = setInterval(fetchCounts, 15000)
        return () => clearInterval(interval)
    }, [fetchCounts])

    const handleApprove = async (leaveId) => {
        setActionLoading(leaveId + 'approve')
        try {
            const res = await fetch(`${API}/leaves/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ leave_id: leaveId, reason: 'Approved by HR' }),
            })
            if (!res.ok) throw new Error('Approval failed')
            showAlert('Leave approved successfully', 'success')
            fetchLeaves(filter)
            fetchCounts()
        } catch (e) {
            showAlert(e.message, 'error')
        } finally { setActionLoading(null) }
    }

    const handleReject = async () => {
        if (!rejectReason.trim()) { showAlert('Please enter a rejection reason', 'warning'); return }
        const leaveId = rejectModal.id
        setActionLoading(leaveId + 'reject')
        try {
            const res = await fetch(`${API}/leaves/reject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ leave_id: leaveId, reason: rejectReason }),
            })
            if (!res.ok) throw new Error('Rejection failed')
            showAlert('Leave rejected', 'info')
            setRejectModal(null)
            setRejectReason('')
            fetchLeaves(filter)
            fetchCounts()
        } catch (e) {
            showAlert(e.message, 'error')
        } finally { setActionLoading(null) }
    }

    const TABS = ['Pending', 'Approved', 'Rejected']

    return (
        <>
            {/* Reject modal */}
            {rejectModal && (
                <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:14, padding:28, maxWidth:420, width:'90%' }}>
                        <div style={{ fontSize:15, fontWeight:700, color:'var(--text-primary)', marginBottom:4 }}>Reject Leave Request</div>
                        <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:14 }}>
                            {rejectModal.employee_name} — {rejectModal.leave_type} ({rejectModal.start_date} → {rejectModal.end_date})
                        </div>
                        <textarea
                            autoFocus
                            value={rejectReason}
                            onChange={e => setRejectReason(e.target.value)}
                            placeholder="Reason for rejection (required)…"
                            rows={3}
                            style={{ width:'100%', background:'var(--bg-input)', border:'1px solid var(--border)', borderRadius:8, padding:'9px 12px', color:'var(--text-primary)', fontSize:12, resize:'none', outline:'none', fontFamily:'inherit', boxSizing:'border-box' }}
                            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleReject() } }}
                        />
                        <div style={{ display:'flex', gap:8, marginTop:14, justifyContent:'flex-end' }}>
                            <button onClick={() => { setRejectModal(null); setRejectReason('') }}
                                style={{ padding:'7px 16px', borderRadius:7, border:'1px solid var(--border)', background:'transparent', color:'var(--text-secondary)', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
                                Cancel
                            </button>
                            <button onClick={handleReject} disabled={!!actionLoading}
                                style={{ padding:'7px 18px', borderRadius:7, border:'none', background:'#dc2626', color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit' }}>
                                {actionLoading ? '…' : 'Reject'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            <div style={{ padding:'24px 28px', maxWidth:900, margin:'0 auto', width:'100%', boxSizing:'border-box' }}>

                {/* Header */}
                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', marginBottom:20 }}>
                    <div>
                        <h2 style={{ margin:0, fontSize:18, fontWeight:700, color:'var(--text-primary)' }}>Leave Requests</h2>
                        <p style={{ margin:'3px 0 0', fontSize:12, color:'var(--text-muted)' }}>Review and action employee leave requests</p>
                    </div>
                    <button onClick={() => fetchLeaves(filter)}
                        style={{ padding:'6px 14px', borderRadius:8, border:'1px solid var(--border)', background:'transparent', color:'var(--text-muted)', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}>
                        ↻ Refresh
                    </button>
                </div>

                {/* Filter tabs */}
                <div style={{ display:'flex', gap:8, marginBottom:20 }}>
                    {TABS.map(t => (
                        <button key={t} onClick={() => setFilter(t)} style={{
                            padding:'6px 16px', borderRadius:20, fontSize:12, fontWeight:500, cursor:'pointer', fontFamily:'inherit', transition:'all 0.15s',
                            border: `1px solid ${filter === t ? (STATUS_STYLES[t]?.border || 'rgba(79,142,247,0.3)') : 'var(--border)'}`,
                            background: filter === t ? (STATUS_STYLES[t]?.bg || 'transparent') : 'transparent',
                            color: filter === t ? (STATUS_STYLES[t]?.color || 'var(--accent)') : 'var(--text-muted)',
                        }}>
                            {t} {counts[t] > 0 ? `(${counts[t]})` : ''}
                        </button>
                    ))}
                </div>

                {/* Content */}
                {loading ? (
                    <div style={{ textAlign:'center', padding:60, color:'var(--text-muted)', fontSize:13 }}>⏳ Loading…</div>
                ) : leaves.length === 0 ? (
                    <div style={{ textAlign:'center', padding:'60px 20px', background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:16 }}>
                        <div style={{ fontSize:36, marginBottom:10, opacity:0.4 }}>📭</div>
                        <div style={{ fontSize:14, fontWeight:600, color:'var(--text-secondary)', marginBottom:4 }}>No {filter.toLowerCase()} requests</div>
                        <div style={{ fontSize:12, color:'var(--text-muted)' }}>
                            {filter === 'Pending' ? 'All clear — no leave requests waiting for action.' : `No ${filter.toLowerCase()} leave requests found.`}
                        </div>
                    </div>
                ) : (
                    <div style={{ display:'flex', flexDirection:'column', gap:12 }}>
                        {leaves.map(l => (
                            <div key={l.id} style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:14, padding:'16px 20px', transition:'border-color 0.15s' }}
                                onMouseEnter={e => e.currentTarget.style.borderColor = 'var(--border-hover)'}
                                onMouseLeave={e => e.currentTarget.style.borderColor = 'var(--border)'}>

                                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12, flexWrap:'wrap' }}>
                                    {/* Left */}
                                    <div style={{ flex:1, minWidth:200 }}>
                                        <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:6 }}>
                                            <div style={{ width:32, height:32, borderRadius:'50%', background:'var(--accent-dim)', color:'var(--accent)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, flexShrink:0 }}>
                                                {(l.employee_name || '?')[0].toUpperCase()}
                                            </div>
                                            <div>
                                                <div style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)' }}>{l.employee_name}</div>
                                                <div style={{ fontSize:11, color:'var(--text-muted)' }}>{l.employee_email}</div>
                                            </div>
                                            <LeaveTypeBadge type={l.leave_type} />
                                            <StatusBadge status={l.status} />
                                        </div>

                                        {/* Date range + days */}
                                        <div style={{ display:'inline-flex', alignItems:'center', gap:6, background:'var(--bg-secondary)', border:'1px solid var(--border)', borderRadius:8, padding:'5px 12px', fontSize:12, color:'var(--text-secondary)', marginBottom:8, fontWeight:500 }}>
                                            📅 {l.start_date} → {l.end_date}
                                            <span style={{ background:'var(--border)', color:'var(--text-muted)', borderRadius:6, padding:'1px 6px', fontSize:10, fontWeight:600 }}>
                                                {l.days} day{l.days !== 1 ? 's' : ''}
                                            </span>
                                        </div>

                                        {/* Reason */}
                                        {l.reason && (
                                            <div style={{ fontSize:12, color:'var(--text-secondary)', background:'var(--bg-secondary)', border:'1px solid var(--border)', borderLeft:'3px solid var(--accent)', borderRadius:8, padding:'7px 12px', lineHeight:1.5 }}>
                                                <span style={{ fontSize:10, color:'var(--text-muted)', fontWeight:600, textTransform:'uppercase', letterSpacing:'0.04em' }}>Reason  </span>
                                                {l.reason}
                                            </div>
                                        )}

                                        {/* Rejection reason (for rejected tab) */}
                                        {l.rejection_reason && (
                                            <div style={{ marginTop:6, fontSize:12, color:'#f87171', background:'rgba(248,113,113,0.08)', border:'1px solid rgba(248,113,113,0.2)', borderRadius:8, padding:'6px 12px' }}>
                                                <span style={{ fontWeight:600, fontSize:10, textTransform:'uppercase', letterSpacing:'0.04em' }}>Rejection reason  </span>
                                                {l.rejection_reason}
                                            </div>
                                        )}
                                    </div>

                                    {/* Actions — only for pending */}
                                    {l.status === 'Pending' && (
                                        <div style={{ display:'flex', gap:8, alignItems:'center', flexShrink:0 }}>
                                            <button
                                                onClick={() => handleApprove(l.id)}
                                                disabled={!!actionLoading}
                                                style={{ padding:'7px 18px', borderRadius:8, border:'1px solid rgba(52,211,153,0.3)', background:'rgba(52,211,153,0.1)', color:'#34d399', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit', transition:'all 0.15s' }}
                                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(52,211,153,0.2)'}
                                                onMouseLeave={e => e.currentTarget.style.background = 'rgba(52,211,153,0.1)'}
                                            >
                                                {actionLoading === l.id + 'approve' ? '…' : '✓ Approve'}
                                            </button>
                                            <button
                                                onClick={() => { setRejectModal(l); setRejectReason('') }}
                                                disabled={!!actionLoading}
                                                style={{ padding:'7px 16px', borderRadius:8, border:'1px solid rgba(248,113,113,0.3)', background:'rgba(248,113,113,0.08)', color:'#f87171', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit', transition:'all 0.15s' }}
                                                onMouseEnter={e => e.currentTarget.style.background = 'rgba(248,113,113,0.16)'}
                                                onMouseLeave={e => e.currentTarget.style.background = 'rgba(248,113,113,0.08)'}
                                            >
                                                ✕ Reject
                                            </button>
                                        </div>
                                    )}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </>
    )
}