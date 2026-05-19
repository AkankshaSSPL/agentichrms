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

    if (loading) return <LeaveLoading />
    if (error) return <LeaveError message={error} />

    return (
        <div style={styles.container}>
            <div style={styles.header}>
                <h2 style={styles.title}> Pending Leave Requests</h2>
                <span style={styles.badge}>{leaves.length} pending</span>
            </div>

            {leaves.length === 0 ? (
                <div style={styles.emptyState}>
                    <div style={styles.emptyIcon}></div>
                    <p>No pending leave requests</p>
                </div>
            ) : (
                <div style={styles.cardsGrid}>
                    {leaves.map(l => (
                        <div key={l.id} style={styles.leaveCard}>
                            <div style={styles.cardHeader}>
                                <div>
                                    <div style={styles.employeeName}>{l.employee_name}</div>
                                    <div style={styles.employeeEmail}>{l.employee_email}</div>
                                </div>
                                <div style={styles.leaveType}>{l.leave_type}</div>
                            </div>
                            <div style={styles.dateRange}>
                                {l.start_date} → {l.end_date}
                            </div>
                            <div style={styles.reasonBox}>
                                <span style={styles.reasonLabel}>Reason:</span> "{l.reason}"
                            </div>
                            <div style={styles.actionRow}>
                                <button
                                    onClick={() => handleApprove(l.id)}
                                    disabled={actionLoading === l.id}
                                    style={styles.approveBtn}
                                >
                                    {actionLoading === l.id ? '...' : '✓ Approve'}
                                </button>
                                <div style={styles.rejectGroup}>
                                    <input
                                        type="text"
                                        placeholder="Rejection reason..."
                                        value={rejectionReasons[l.id] || ""}
                                        onChange={(e) => setRejectionReasons(prev => ({ ...prev, [l.id]: e.target.value }))}
                                        style={styles.reasonInput}
                                    />
                                    <button
                                        onClick={() => handleReject(l.id)}
                                        disabled={actionLoading === l.id}
                                        style={styles.rejectBtn}
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
    )
}

// Loading & Error components
const LeaveLoading = () => (
    <div style={styles.loader}> Loading leave requests...</div>
)
const LeaveError = ({ message }) => (
    <div style={styles.errorBox}> Error: {message}</div>
)

const styles = {
    container: {
        padding: '28px 32px',
        maxWidth: '900px',
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box',
    },
    header: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '28px',
    },
    title: {
        fontSize: '20px',
        fontWeight: 600,
        color: '#e2e8f0',
        margin: 0,
    },
    badge: {
        background: 'rgba(79,142,247,0.15)',
        color: '#60a5fa',
        padding: '4px 12px',
        borderRadius: '20px',
        fontSize: '12px',
        fontWeight: 500,
    },
    emptyState: {
        textAlign: 'center',
        padding: '60px 20px',
        background: 'rgba(15,18,25,0.6)',
        borderRadius: '24px',
        color: '#64748b',
    },
    emptyIcon: {
        fontSize: '48px',
        marginBottom: '12px',
        opacity: 0.6,
    },
    cardsGrid: {
        display: 'flex',
        flexDirection: 'column',
        gap: '16px',
    },
    leaveCard: {
        background: 'rgba(15,18,25,0.8)',
        border: '1px solid rgba(79,142,247,0.12)',
        borderRadius: '20px',
        padding: '20px',
        transition: 'all 0.2s',
    },
    cardHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        marginBottom: '12px',
    },
    employeeName: {
        fontSize: '16px',
        fontWeight: 600,
        color: '#e2e8f0',
    },
    employeeEmail: {
        fontSize: '12px',
        color: '#64748b',
        marginTop: '2px',
    },
    leaveType: {
        background: 'rgba(52,211,153,0.1)',
        color: '#34d399',
        padding: '4px 12px',
        borderRadius: '20px',
        fontSize: '12px',
        fontWeight: 500,
    },
    dateRange: {
        fontSize: '13px',
        color: '#94a3b8',
        marginBottom: '12px',
    },
    reasonBox: {
        background: 'rgba(6,8,18,0.5)',
        borderRadius: '12px',
        padding: '12px',
        fontSize: '13px',
        color: '#cbd5e1',
        marginBottom: '16px',
        borderLeft: '2px solid #4f8ef7',
    },
    reasonLabel: {
        fontWeight: 600,
        color: '#94a3b8',
    },
    actionRow: {
        display: 'flex',
        gap: '12px',
        flexWrap: 'wrap',
    },
    approveBtn: {
        background: 'rgba(52,211,153,0.15)',
        border: '1px solid rgba(52,211,153,0.3)',
        padding: '8px 20px',
        borderRadius: '10px',
        color: '#34d399',
        fontWeight: 600,
        fontSize: '13px',
        cursor: 'pointer',
        transition: 'all 0.15s',
    },
    rejectGroup: {
        flex: 1,
        display: 'flex',
        gap: '8px',
    },
    reasonInput: {
        flex: 1,
        background: '#0f1219',
        border: '1px solid rgba(79,142,247,0.2)',
        borderRadius: '10px',
        padding: '8px 12px',
        color: '#e2e8f0',
        fontSize: '12px',
        outline: 'none',
    },
    rejectBtn: {
        background: 'rgba(248,113,113,0.1)',
        border: '1px solid rgba(248,113,113,0.3)',
        padding: '8px 16px',
        borderRadius: '10px',
        color: '#f87171',
        fontWeight: 600,
        fontSize: '13px',
        cursor: 'pointer',
    },
    loader: {
        padding: '60px',
        textAlign: 'center',
        color: '#64748b',
    },
    errorBox: {
        padding: '20px',
        background: 'rgba(248,113,113,0.1)',
        borderRadius: '16px',
        color: '#f87171',
        textAlign: 'center',
    },
}