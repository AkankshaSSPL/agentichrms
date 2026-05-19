import { useState, useEffect, useCallback } from 'react'
import LeaveRequests from './LeaveRequests'
import DashboardMetricsSimple from './DashboardMetricsSimple'   // <-- ADD THIS IMPORT

const API = '/api'

/* ── Sweet Alert component ──────────────────────────────────────────────────── */
function Alert({ alerts, remove }) {
    return (
        <div style={{
            position: 'fixed', top: 24, right: 24, zIndex: 9999,
            display: 'flex', flexDirection: 'column', gap: 10, pointerEvents: 'none'
        }}>
            {alerts.map(a => (
                <div key={a.id} style={{
                    display: 'flex', alignItems: 'center', gap: 12,
                    padding: '14px 18px', borderRadius: 12,
                    background: a.type === 'success' ? 'rgba(16,185,129,0.12)'
                        : a.type === 'error' ? 'rgba(239,68,68,0.12)'
                            : a.type === 'warning' ? 'rgba(245,158,11,0.12)'
                                : 'rgba(79,142,247,0.12)',
                    border: `1px solid ${a.type === 'success' ? 'rgba(16,185,129,0.35)'
                        : a.type === 'error' ? 'rgba(239,68,68,0.35)'
                            : a.type === 'warning' ? 'rgba(245,158,11,0.35)'
                                : 'rgba(79,142,247,0.35)'}`,
                    backdropFilter: 'blur(16px)',
                    boxShadow: '0 8px 32px rgba(0,0,0,0.4)',
                    minWidth: 280, maxWidth: 400,
                    pointerEvents: 'all',
                    animation: 'slideIn 0.25s ease',
                }}>
                    <span style={{ fontSize: 18 }}>
                        {a.type === 'success' ? '' : a.type === 'error' ? '' : a.type === 'warning' ? '' : 'ℹ'}
                    </span>
                    <span style={{ flex: 1, fontSize: 13, color: '#e2e8f0', lineHeight: 1.4 }}>{a.message}</span>
                    <button onClick={() => remove(a.id)} style={{
                        background: 'none', border: 'none', color: '#64748b',
                        cursor: 'pointer', fontSize: 16, padding: '0 4px', lineHeight: 1
                    }}>×</button>
                </div>
            ))}
        </div>
    )
}

/* ── Confirm Dialog ─────────────────────────────────────────────────────────── */
function ConfirmDialog({ dialog, onConfirm, onCancel }) {
    if (!dialog) return null
    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 9998,
            background: 'rgba(0,0,0,0.65)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
            <div style={{
                background: '#0f1219', border: '1px solid rgba(239,68,68,0.3)',
                borderRadius: 16, padding: 32, maxWidth: 400, width: '90%',
                boxShadow: '0 24px 64px rgba(0,0,0,0.6)',
                animation: 'popIn 0.2s ease'
            }}>
                <div style={{ fontSize: 40, textAlign: 'center', marginBottom: 16 }}></div>
                <h3 style={{ color: '#f1f5f9', textAlign: 'center', margin: '0 0 8px', fontSize: 16 }}>
                    {dialog.title}
                </h3>
                <p style={{ color: '#94a3b8', textAlign: 'center', margin: '0 0 24px', fontSize: 13, lineHeight: 1.5 }}>
                    {dialog.message}
                </p>
                <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={onCancel} style={{
                        flex: 1, padding: '10px 0', borderRadius: 8,
                        border: '1px solid rgba(255,255,255,0.1)',
                        background: 'transparent', color: '#94a3b8',
                        fontSize: 13, cursor: 'pointer'
                    }}>Cancel</button>
                    <button onClick={onConfirm} style={{
                        flex: 1, padding: '10px 0', borderRadius: 8,
                        border: 'none', background: 'rgba(239,68,68,0.9)',
                        color: '#fff', fontSize: 13, fontWeight: 600, cursor: 'pointer'
                    }}>{dialog.confirmLabel || 'Confirm'}</button>
                </div>
            </div>
        </div>
    )
}

/* ── Role Change Success Dialog ─────────────────────────────────────────────── */
function RoleSuccessDialog({ info, onClose }) {
    if (!info) return null
    const roleColors = {
        admin: { icon: '', color: '#f87171', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)' },
        hr: { icon: '', color: '#34d399', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)' },
        employee: { icon: '', color: '#60a5fa', bg: 'rgba(79,142,247,0.12)', border: 'rgba(79,142,247,0.3)' },
    }
    const style = roleColors[info.role] || roleColors.employee
    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.70)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center'
        }}>
            <div style={{
                background: '#0f1219', border: `1px solid ${style.border}`,
                borderRadius: 20, padding: '40px 36px', maxWidth: 420, width: '90%',
                boxShadow: '0 24px 64px rgba(0,0,0,0.7)',
                animation: 'popIn 0.22s ease', textAlign: 'center', position: 'relative'
            }}>
                <button onClick={onClose} style={{
                    position: 'absolute', top: 14, right: 16,
                    background: 'transparent', border: 'none',
                    color: '#475569', fontSize: 18, cursor: 'pointer', lineHeight: 1,
                    padding: '2px 6px', borderRadius: 6,
                }}>
                    ✕
                </button>
                <h3 style={{ color: '#f1f5f9', margin: '0 0 10px', fontSize: 17, fontWeight: 700 }}>
                    Role Updated Successfully
                </h3>
                <p style={{ color: '#94a3b8', margin: '0 0 18px', fontSize: 13, lineHeight: 1.6 }}>
                    <strong style={{ color: '#e2e8f0' }}>{info.name}</strong>'s role has been changed to{' '}
                    <span style={{
                        color: style.color, fontWeight: 700,
                        background: style.bg, padding: '2px 10px',
                        borderRadius: 12, fontSize: 12, border: `1px solid ${style.border}`
                    }}>{info.role}</span>
                </p>
                <p style={{ color: '#475569', fontSize: 12, margin: '0 0 24px' }}>
                    A notification email has been sent to <strong style={{ color: '#64748b' }}>{info.email}</strong>
                </p>
                <button onClick={onClose} style={{
                    background: style.bg, border: `1px solid ${style.border}`,
                    color: style.color, padding: '10px 32px',
                    borderRadius: 8, fontSize: 13, fontWeight: 600,
                    cursor: 'pointer',
                }}>
                    Got it
                </button>
            </div>
        </div>
    )
}

/* ── Email Settings Tab ─────────────────────────────────────────────────────── */
function EmailSettingsTab({ token }) {
    const [logs, setLogs] = useState([])
    const [loadingLogs, setLoadingLogs] = useState(true)

    useEffect(() => {
        fetch('/api/email-settings/logs?limit=50', { headers: { Authorization: `Bearer ${token}` } })
            .then(r => r.json()).then(data => { setLogs(Array.isArray(data) ? data : []); setLoadingLogs(false) })
            .catch(() => setLoadingLogs(false))
    }, [token])

    const triggerLabel = {
        leave_approve: 'Leave Approved',
        leave_reject: ' Leave Rejected',
        role_change: 'Role Changed',
        test: ' Test',
        system: ' System',
    }

    return (
        <div style={{ padding: '28px 32px', maxWidth: 860 }}>
            <div style={{
                background: 'rgba(15,18,25,0.8)', border: '1px solid rgba(79,142,247,0.12)',
                borderRadius: 14, overflow: 'hidden',
            }}>
                <div style={{
                    padding: '16px 20px', borderBottom: '1px solid rgba(79,142,247,0.08)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'rgba(6,8,18,0.6)',
                }}>
                    <span style={{ fontSize: 13, fontWeight: 700, color: '#e2e8f0' }}>Email Log</span>
                    <span style={{ fontSize: 11, color: '#334155' }}>Last emails</span>
                </div>
                <div style={{ overflowX: 'auto' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, minWidth: 560 }}>
                        <thead>
                            <tr style={{ background: 'rgba(6,8,18,0.5)' }}>
                                {['Time', 'Recipient', 'Subject', 'Triggered by', 'Status'].map(h => (
                                    <th key={h} style={{
                                        padding: '10px 14px', textAlign: 'left',
                                        color: '#475569', fontWeight: 600,
                                        fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase',
                                        borderBottom: '1px solid rgba(79,142,247,0.08)',
                                    }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <tbody>
                            {loadingLogs ? (
                                <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#475569' }}>Loading…</td></tr>
                            ) : logs.length === 0 ? (
                                <tr><td colSpan={5} style={{ padding: 32, textAlign: 'center', color: '#334155' }}>No emails sent yet</td></tr>
                            ) : logs.map((log, i) => (
                                <tr key={log.id} style={{
                                    borderBottom: i < logs.length - 1 ? '1px solid rgba(79,142,247,0.05)' : 'none',
                                    background: log.status === 'failed' ? 'rgba(248,113,113,0.04)' : 'transparent',
                                }}>
                                    <td style={{ padding: '10px 14px', color: '#475569', whiteSpace: 'nowrap' }}>
                                        {new Date(log.sent_at).toLocaleString()}
                                    </td>
                                    <td style={{ padding: '10px 14px', color: '#94a3b8' }}>{log.recipient}</td>
                                    <td style={{ padding: '10px 14px', color: '#cbd5e1', maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
                                        title={log.subject}>{log.subject}</td>
                                    <td style={{ padding: '10px 14px', color: '#64748b' }}>
                                        {triggerLabel[log.triggered_by] || log.triggered_by || '—'}
                                    </td>
                                    <td style={{ padding: '10px 14px' }}>
                                        <span style={{
                                            padding: '2px 10px', borderRadius: 12, fontSize: 11, fontWeight: 600,
                                            background: log.status === 'sent' ? 'rgba(52,211,153,0.12)' : 'rgba(248,113,113,0.12)',
                                            color: log.status === 'sent' ? '#34d399' : '#f87171',
                                            border: `1px solid ${log.status === 'sent' ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)'}`,
                                        }}>
                                            {log.status === 'sent' ? '✓ Sent' : '✗ Failed'}
                                        </span>
                                        {log.status === 'failed' && log.error && (
                                            <div style={{ fontSize: 10, color: '#f87171', marginTop: 3, maxWidth: 160, overflow: 'hidden', textOverflow: 'ellipsis' }}
                                                title={log.error}>{log.error}</div>
                                        )}
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            </div>
        </div>
    )
}

/* ── Main AdminPanel ────────────────────────────────────────────────────────── */
export default function AdminPanel({ token: tokenProp }) {
    const token = tokenProp || localStorage.getItem('hrms_token') || ''
    const [activeTab, setActiveTab] = useState('dashboard')   // changed default to 'dashboard'
    const [employees, setEmployees] = useState([])
    const [loading, setLoading] = useState(false)
    const [alerts, setAlerts] = useState([])
    const [dialog, setDialog] = useState(null)
    const [dialogResolve, setDialogResolve] = useState(null)
    const [roleSuccess, setRoleSuccess] = useState(null)

    /* ── Alert helpers ──────────────────────────────────────────────────────── */
    const addAlert = useCallback((message, type = 'info') => {
        const id = Date.now() + Math.random()
        setAlerts(prev => [...prev, { id, message, type }])
        setTimeout(() => setAlerts(prev => prev.filter(a => a.id !== id)), 4000)
    }, [])

    const removeAlert = useCallback((id) => {
        setAlerts(prev => prev.filter(a => a.id !== id))
    }, [])

    /* ── Confirm helper ─────────────────────────────────────────────────────── */
    const confirm = (title, message, confirmLabel = 'Confirm') => new Promise(resolve => {
        setDialog({ title, message, confirmLabel })
        setDialogResolve(() => resolve)
    })

    const handleConfirm = () => { setDialog(null); dialogResolve && dialogResolve(true) }
    const handleCancel = () => { setDialog(null); dialogResolve && dialogResolve(false) }

    /* ── Data fetching ──────────────────────────────────────────────────────── */
    const fetchEmployees = useCallback(async () => {
        setLoading(true)
        try {
            const res = await fetch(`${API}/admin/employees`, {
                headers: { Authorization: `Bearer ${token}` }
            })
            if (!res.ok) {
                const err = await res.json().catch(() => ({}))
                throw new Error(err.detail || `Error ${res.status}`)
            }
            const data = await res.json()
            setEmployees(data)
        } catch (err) {
            addAlert(err.message || 'Failed to load employees', 'error')
        } finally {
            setLoading(false)
        }
    }, [token, addAlert])

    useEffect(() => {
        if (activeTab === 'roles') fetchEmployees()
    }, [activeTab, fetchEmployees])

    /* ── Actions ────────────────────────────────────────────────────────────── */
    const updateRole = async (employeeId, newRole, employeeName) => {
        const emp = employees.find(e => e.id === employeeId)
        try {
            const res = await fetch(`${API}/admin/role`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
                body: JSON.stringify({ employee_id: employeeId, role_name: newRole })
            })
            if (!res.ok) throw new Error('Failed to update role')
            fetchEmployees()
            setRoleSuccess({ name: employeeName, role: newRole, email: emp?.email || '' })
        } catch (err) {
            addAlert(err.message, 'error')
        }
    }

    const deleteEmployee = async (employeeId, employeeName) => {
        const ok = await confirm(
            'Delete Employee',
            `Are you sure you want to permanently delete ${employeeName}? This action cannot be undone.`,
            'Delete'
        )
        if (!ok) return
        try {
            const res = await fetch(`${API}/admin/employees/${employeeId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${token}` }
            })
            if (!res.ok) throw new Error('Delete failed')
            addAlert(`${employeeName} deleted successfully`, 'success')
            fetchEmployees()
        } catch (err) {
            addAlert(err.message, 'error')
        }
    }

    /* ── Tab config ─────────────────────────────────────────────────────────── */
    const tabs = [
        { id: 'dashboard', label: 'Dashboard' },
        { id: 'roles', label: 'Role Management' },
        { id: 'leaves', label: 'Leave Approvals' },
        { id: 'email', label: 'Email Settings' },
    ]

    const roleBadge = (role) => ({
        admin: { bg: 'rgba(239,68,68,0.15)', color: '#f87171', border: 'rgba(239,68,68,0.3)' },
        hr: { bg: 'rgba(16,185,129,0.15)', color: '#34d399', border: 'rgba(16,185,129,0.3)' },
        employee: { bg: 'rgba(79,142,247,0.15)', color: '#60a5fa', border: 'rgba(79,142,247,0.3)' },
    }[role] || { bg: 'rgba(100,116,139,0.15)', color: '#94a3b8', border: 'rgba(100,116,139,0.3)' })

    return (
        <>
            <style>{`
                @keyframes slideIn {
                    from { opacity: 0; transform: translateX(24px); }
                    to   { opacity: 1; transform: translateX(0); }
                }
                @keyframes popIn {
                    from { opacity: 0; transform: scale(0.92); }
                    to   { opacity: 1; transform: scale(1); }
                }
                .admin-row:hover { background: rgba(79,142,247,0.04) !important; }
                .admin-tab:hover { border-color: rgba(79,142,247,0.5) !important; color: #93c5fd !important; }
                .role-select:focus { outline: none; border-color: #4f8ef7 !important; }
                .delete-btn:hover { background: rgba(239,68,68,0.3) !important; }
                ::-webkit-scrollbar { width: 6px; height: 6px; }
                ::-webkit-scrollbar-track { background: transparent; }
                ::-webkit-scrollbar-thumb { background: rgba(79,142,247,0.2); border-radius: 4px; }
            `}</style>

            <Alert alerts={alerts} remove={removeAlert} />
            <ConfirmDialog dialog={dialog} onConfirm={handleConfirm} onCancel={handleCancel} />
            <RoleSuccessDialog info={roleSuccess} onClose={() => setRoleSuccess(null)} />

            <div style={{
                display: 'flex', flexDirection: 'column',
                minHeight: '100vh', width: '100%',
                background: '#060812',
                padding: '32px 40px',
                boxSizing: 'border-box',
            }}>
                {/* Header */}
                <div style={{ marginBottom: 28 }}>
                    <h1 style={{
                        margin: 0, fontSize: 22, fontWeight: 700,
                        color: '#f1f5f9', letterSpacing: '-0.3px'
                    }}>Admin Dashboard</h1>
                    <p style={{ margin: '4px 0 0', color: '#64748b', fontSize: 13 }}>
                        Manage roles, review leave requests, and configure system settings
                    </p>
                </div>

                {/* Tabs */}
                <div style={{
                    display: 'flex', gap: 8, marginBottom: 28,
                    borderBottom: '1px solid rgba(79,142,247,0.12)',
                    paddingBottom: 12
                }}>
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            className="admin-tab"
                            onClick={() => setActiveTab(tab.id)}
                            style={{
                                padding: '8px 20px',
                                background: activeTab === tab.id ? 'rgba(79,142,247,0.12)' : 'transparent',
                                border: '1px solid',
                                borderColor: activeTab === tab.id ? 'rgba(79,142,247,0.5)' : 'rgba(79,142,247,0.15)',
                                borderRadius: 24,
                                color: activeTab === tab.id ? '#60a5fa' : '#64748b',
                                cursor: 'pointer', fontWeight: 500, fontSize: 13,
                                transition: 'all 0.18s',
                                whiteSpace: 'nowrap',
                            }}
                        >
                            {tab.label}
                        </button>
                    ))}
                </div>

                {/* ── Dashboard Tab (NEW) ───────────────────────────────────── */}
                {activeTab === 'dashboard' && (
                    <DashboardMetricsSimple employees={employees} token={token} />
                )}

                {/* ── Role Management ─────────────────────────────────────── */}
                {activeTab === 'roles' && (
                    <div style={{ flex: 1 }}>
                        {loading ? (
                            <div style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                padding: 60, color: '#475569', fontSize: 13
                            }}>
                                <span style={{ marginRight: 10 }}>⏳</span> Loading employees...
                            </div>
                        ) : (
                            <div style={{
                                background: 'rgba(15,18,25,0.8)',
                                borderRadius: 14,
                                border: '1px solid rgba(79,142,247,0.12)',
                                overflow: 'hidden',
                            }}>
                                <div style={{ overflowX: 'auto' }}>
                                    <table style={{
                                        width: '100%', borderCollapse: 'collapse',
                                        fontSize: 13, minWidth: 640
                                    }}>
                                        <thead>
                                            <tr style={{
                                                background: 'rgba(6,8,18,0.9)',
                                                borderBottom: '1px solid rgba(79,142,247,0.12)'
                                            }}>
                                                {['ID', 'Name', 'Email', 'Current Role', 'Change Role', 'Actions'].map(h => (
                                                    <th key={h} style={{
                                                        padding: '14px 18px', textAlign: h === 'Actions' ? 'center' : 'left',
                                                        color: '#475569', fontWeight: 600,
                                                        fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase'
                                                    }}>{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {employees.length === 0 ? (
                                                <tr><td colSpan={6} style={{ padding: 40, textAlign: 'center', color: '#475569' }}>
                                                    No employees found
                                                </td></tr>
                                            ) : employees.map((emp, i) => {
                                                const badge = roleBadge(emp.role)
                                                return (
                                                    <tr key={emp.id} className="admin-row" style={{
                                                        borderBottom: i < employees.length - 1 ? '1px solid rgba(79,142,247,0.06)' : 'none',
                                                        transition: 'background 0.15s'
                                                    }}>
                                                        <td style={{ padding: '13px 18px', color: '#475569', fontSize: 12 }}>
                                                            #{emp.id}
                                                        </td>
                                                        <td style={{ padding: '13px 18px', color: '#e2e8f0', fontWeight: 500 }}>
                                                            {emp.name}
                                                        </td>
                                                        <td style={{ padding: '13px 18px', color: '#64748b' }}>
                                                            {emp.email}
                                                        </td>
                                                        <td style={{ padding: '13px 18px' }}>
                                                            <span style={{
                                                                background: badge.bg, color: badge.color,
                                                                border: `1px solid ${badge.border}`,
                                                                padding: '3px 10px', borderRadius: 20,
                                                                fontSize: 11, fontWeight: 600, letterSpacing: '0.04em'
                                                            }}>
                                                                {emp.role}
                                                            </span>
                                                        </td>
                                                        <td style={{ padding: '13px 18px' }}>
                                                            <select
                                                                className="role-select"
                                                                value={emp.role}
                                                                onChange={e => updateRole(emp.id, e.target.value, emp.name)}
                                                                style={{
                                                                    background: '#0f1219', color: '#cbd5e1',
                                                                    border: '1px solid rgba(79,142,247,0.25)',
                                                                    padding: '6px 10px', borderRadius: 7,
                                                                    fontSize: 12, cursor: 'pointer',
                                                                    transition: 'border-color 0.15s'
                                                                }}
                                                            >
                                                                <option value="employee">Employee</option>
                                                                <option value="hr">HR</option>
                                                                <option value="admin">Admin</option>
                                                            </select>
                                                        </td>
                                                        <td style={{ padding: '13px 18px', textAlign: 'center' }}>
                                                            <button
                                                                className="delete-btn"
                                                                onClick={() => deleteEmployee(emp.id, emp.name)}
                                                                style={{
                                                                    background: 'rgba(239,68,68,0.1)',
                                                                    border: '1px solid rgba(239,68,68,0.25)',
                                                                    color: '#f87171',
                                                                    padding: '5px 14px', borderRadius: 7,
                                                                    fontSize: 12, cursor: 'pointer',
                                                                    transition: 'background 0.15s'
                                                                }}
                                                            >
                                                                Delete
                                                            </button>
                                                        </td>
                                                    </tr>
                                                )
                                            })}
                                        </tbody>
                                    </table>
                                </div>
                                <div style={{
                                    padding: '10px 18px',
                                    borderTop: '1px solid rgba(79,142,247,0.08)',
                                    color: '#334155', fontSize: 11
                                }}>
                                    {employees.length} employee{employees.length !== 1 ? 's' : ''}
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {/* ── Leave Approvals ─────────────────────────────────────── */}
                {activeTab === 'leaves' && (
                    <div style={{ flex: 1 }}>
                        <LeaveRequests token={token} onAlert={addAlert} />
                    </div>
                )}

                {/* ── Email Settings ───────────────────────────────────────  */}
                {activeTab === 'email' && (
                    <EmailSettingsTab token={token} />
                )}
            </div>
        </>
    )
}