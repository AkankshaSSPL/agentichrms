// src/components/LeaveRequests.jsx
import { useState, useEffect } from 'react'

const API = '/api'

export default function LeaveRequests({ token: tokenProp, onAlert }) {
    const token = tokenProp || localStorage.getItem('hrms_token') || ''
    const showAlert = onAlert || ((msg, type) => alert(msg))
    const [leaves, setLeaves] = useState([])
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')
    const [actionLoading, setActionLoading] = useState(null)
    const [rejectionReasons, setRejectionReasons] = useState({})

    const fetchPending = async () => {
        try {
            const res = await fetch(`${API}/leaves/pending`, {
                headers: { Authorization: `Bearer ${token}` }
            })
            if (!res.ok) throw new Error('Failed to fetch pending leaves')
            const data = await res.json()
            setLeaves(data)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => {
        fetchPending()
        const interval = setInterval(fetchPending, 15000)
        return () => clearInterval(interval)
    }, [token])

    const handleApprove = async (leaveId) => {
        setActionLoading(leaveId)
        try {
            const res = await fetch(`${API}/leaves/approve`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ leave_id: leaveId, reason: "Approved by HR" })
            })
            if (!res.ok) throw new Error("Approval processing failed.")
            fetchPending()
            showAlert('Leave approved successfully', 'success')
        } catch (err) {
            showAlert(err.message, 'error')
        } finally {
            setActionLoading(null)
        }
    }

    const handleReject = async (leaveId) => {
        const reason = rejectionReasons[leaveId] || ""
        if (!reason.trim()) {
            showAlert("Please specify a reason for rejection.", 'warning')
            return
        }
        setActionLoading(leaveId)
        try {
            const res = await fetch(`${API}/leaves/reject`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ leave_id: leaveId, reason })
            })
            if (!res.ok) throw new Error("Rejection processing failed.")
            fetchPending()
            showAlert('Leave rejected', 'info')
        } catch (err) {
            showAlert(err.message, 'error')
        } finally {
            setActionLoading(null)
        }
    }

    if (loading) return (
        <div style={{ padding: '60px', textAlign: 'center', color: 'var(--text-muted)' }}>
            Loading leave requests…
        </div>
    )

    if (error) return (
        <div style={{ padding: '20px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: '16px', color: '#f87171', textAlign: 'center', margin: '20px' }}>
            Error: {error}
        </div>
    )

    return (
        <>
            <style>{`
                .lr-card {
                    background: var(--bg-card);
                    border: 1px solid var(--border);
                    border-radius: 20px;
                    padding: 20px;
                    transition: all 0.2s;
                }
                .lr-card:hover {
                    border-color: var(--border-hover);
                    box-shadow: 0 4px 20px rgba(0,0,0,0.08);
                    transform: translateY(-1px);
                }
                .lr-reason-input {
                    flex: 1;
                    background: var(--bg-input);
                    border: 1px solid var(--border);
                    border-radius: 10px;
                    padding: 8px 12px;
                    color: var(--text-primary);
                    font-size: 12px;
                    outline: none;
                    font-family: inherit;
                    transition: border-color 0.15s;
                }
                .lr-reason-input:focus {
                    border-color: var(--accent);
                }
                .lr-reason-input::placeholder {
                    color: var(--text-muted);
                }
                .lr-approve-btn {
                    background: rgba(52,211,153,0.1);
                    border: 1px solid rgba(52,211,153,0.25);
                    padding: 8px 20px;
                    border-radius: 10px;
                    color: #34d399;
                    font-weight: 600;
                    font-size: 13px;
                    cursor: pointer;
                    transition: all 0.15s;
                    font-family: inherit;
                }
                .lr-approve-btn:hover:not(:disabled) {
                    background: rgba(52,211,153,0.18);
                    border-color: rgba(52,211,153,0.4);
                    transform: translateY(-1px);
                }
                .lr-approve-btn:disabled { opacity: 0.5; cursor: not-allowed; }
                .lr-reject-btn {
                    background: rgba(248,113,113,0.08);
                    border: 1px solid rgba(248,113,113,0.25);
                    padding: 8px 16px;
                    border-radius: 10px;
                    color: #f87171;
                    font-weight: 600;
                    font-size: 13px;
                    cursor: pointer;
                    transition: all 0.15s;
                    font-family: inherit;
                }
                .lr-reject-btn:hover:not(:disabled) {
                    background: rgba(248,113,113,0.15);
                    border-color: rgba(248,113,113,0.4);
                }
                .lr-reject-btn:disabled { opacity: 0.5; cursor: not-allowed; }
            `}</style>

            <div style={{ padding: '28px 32px', maxWidth: '900px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>

                {/* Header */}
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '28px' }}>
                    <h2 style={{ fontSize: '20px', fontWeight: 600, color: 'var(--text-primary)', margin: 0 }}>
                        Pending Leave Requests
                    </h2>
                    <span style={{
                        background: 'rgba(79,142,247,0.1)',
                        color: 'var(--accent)',
                        border: '1px solid rgba(79,142,247,0.2)',
                        padding: '4px 14px',
                        borderRadius: '20px',
                        fontSize: '12px',
                        fontWeight: 600,
                    }}>
                        {leaves.length} pending
                    </span>
                </div>

                {/* Empty state */}
                {leaves.length === 0 ? (
                    <div style={{
                        textAlign: 'center',
                        padding: '60px 20px',
                        background: 'var(--bg-card)',
                        border: '1px solid var(--border)',
                        borderRadius: '24px',
                        color: 'var(--text-muted)',
                    }}>
                        <div style={{ fontSize: '40px', marginBottom: '12px', opacity: 0.5 }}></div>
                        <div style={{ fontSize: '15px', fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 4 }}>All clear!</div>
                        <div style={{ fontSize: '13px' }}>No pending leave requests at the moment.</div>
                    </div>
                ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                        {leaves.map(l => (
                            <div key={l.id} className="lr-card">

                                {/* Card header */}
                                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '14px' }}>
                                    <div>
                                        <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--text-primary)' }}>{l.employee_name}</div>
                                        <div style={{ fontSize: '12px', color: 'var(--text-muted)', marginTop: '2px' }}>{l.employee_email}</div>
                                    </div>
                                    <span style={{
                                        background: 'rgba(52,211,153,0.1)',
                                        color: '#34d399',
                                        border: '1px solid rgba(52,211,153,0.2)',
                                        padding: '4px 12px',
                                        borderRadius: '20px',
                                        fontSize: '11px',
                                        fontWeight: 600,
                                    }}>
                                        {l.leave_type}
                                    </span>
                                </div>

                                {/* Date range */}
                                <div style={{
                                    display: 'inline-flex',
                                    alignItems: 'center',
                                    gap: 8,
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border)',
                                    borderRadius: '10px',
                                    padding: '6px 14px',
                                    fontSize: '12px',
                                    color: 'var(--text-secondary)',
                                    marginBottom: '12px',
                                    fontWeight: 500,
                                }}>
                                    📅 {l.start_date} → {l.end_date}
                                </div>

                                {/* Reason */}
                                <div style={{
                                    background: 'var(--bg-secondary)',
                                    border: '1px solid var(--border)',
                                    borderLeft: '3px solid var(--accent)',
                                    borderRadius: '10px',
                                    padding: '10px 14px',
                                    fontSize: '13px',
                                    color: 'var(--text-secondary)',
                                    marginBottom: '16px',
                                    lineHeight: 1.5,
                                }}>
                                    <span style={{ fontWeight: 600, color: 'var(--text-muted)', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.5px' }}>Reason </span>
                                    <br/>
                                    "{l.reason}"
                                </div>

                                {/* Actions */}
                                <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center' }}>
                                    <button
                                        className="lr-approve-btn"
                                        onClick={() => handleApprove(l.id)}
                                        disabled={actionLoading === l.id}
                                    >
                                        {actionLoading === l.id ? '…' : '✓ Approve'}
                                    </button>
                                    <div style={{ flex: 1, display: 'flex', gap: '8px', minWidth: 220 }}>
                                        <input
                                            className="lr-reason-input"
                                            type="text"
                                            placeholder="Rejection reason…"
                                            value={rejectionReasons[l.id] || ""}
                                            onChange={e => setRejectionReasons(prev => ({ ...prev, [l.id]: e.target.value }))}
                                        />
                                        <button
                                            className="lr-reject-btn"
                                            onClick={() => handleReject(l.id)}
                                            disabled={actionLoading === l.id}
                                        >
                                            Reject
                                        </button>
                                    </div>
                                </div>

                            </div>
                        ))}
                    </div>
                )}
            </div>
        </>
    )
}