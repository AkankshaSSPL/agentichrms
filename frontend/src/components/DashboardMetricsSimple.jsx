// src/components/DashboardMetricsSimple.jsx
import { useState, useEffect } from 'react'

export default function DashboardMetricsSimple({ employees, token, onNavigate }) {
    const [pendingLeaves, setPendingLeaves] = useState([])
    const [drilldown, setDrilldown] = useState(null) // 'employees' | 'branches' | null

    useEffect(() => {
        if (!token) return
        fetch('/api/leaves/pending', { headers: { Authorization: `Bearer ${token}` } })
            .then(res => res.json()).then(data => setPendingLeaves(data)).catch(() => { })
    }, [token])

    const totalEmployees = employees.length
    const pendingCount = pendingLeaves.length
    const branches = 1
    const departments = 1
    const attendanceRate = 0
    const presentToday = 0
    const activeJobs = 0
    const jobsChange = 0
    const totalCandidates = 0
    const candidatesChange = 0

    const roleGroups = employees.reduce((acc, emp) => {
        const key = emp.department || emp.role || 'General'
        if (!acc[key]) acc[key] = []
        acc[key].push(emp)
        return acc
    }, {})

    const roleBadgeColor = (role) => ({
        admin: { bg: 'rgba(239,68,68,0.15)', color: '#f87171', border: 'rgba(239,68,68,0.3)' },
        hr: { bg: 'rgba(16,185,129,0.15)', color: '#34d399', border: 'rgba(16,185,129,0.3)' },
        employee: { bg: 'rgba(79,142,247,0.15)', color: '#60a5fa', border: 'rgba(79,142,247,0.3)' },
    }[role] || { bg: 'rgba(100,116,139,0.15)', color: '#94a3b8', border: 'rgba(100,116,139,0.3)' })

    // ── Employee drilldown ────────────────────────────────────────────────────
    if (drilldown === 'employees') {
        return (
            <div style={styles.container}>
                <DrilldownHeader title="All Employees" subtitle={`${totalEmployees} total employee${totalEmployees !== 1 ? 's' : ''}`} onBack={() => setDrilldown(null)} />
                <div style={styles.tableWrap}>
                    <table style={styles.table}>
                        <thead>
                            <tr style={styles.thead}>
                                {['ID', 'Name', 'Email', 'Role'].map(h => <th key={h} style={styles.th}>{h}</th>)}
                            </tr>
                        </thead>
                        <tbody>
                            {employees.length === 0 ? (
                                <tr><td colSpan={4} style={styles.empty}>No employees found</td></tr>
                            ) : employees.map((emp, i) => {
                                const badge = roleBadgeColor(emp.role)
                                return (
                                    <tr key={emp.id} style={{ ...styles.trow, borderBottom: i < employees.length - 1 ? '1px solid var(--border)' : 'none' }}
                                        onMouseEnter={e => e.currentTarget.style.background = 'var(--bg-card-hover)'}
                                        onMouseLeave={e => e.currentTarget.style.background = 'transparent'}>
                                        <td style={{ ...styles.td, color: 'var(--text-muted)', fontSize: 12 }}>#{emp.id}</td>
                                        <td style={{ ...styles.td, color: 'var(--text-primary)', fontWeight: 500 }}>{emp.name}</td>
                                        <td style={{ ...styles.td, color: 'var(--text-secondary)' }}>{emp.email}</td>
                                        <td style={styles.td}>
                                            <span style={{ background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`, padding: '3px 10px', borderRadius: 20, fontSize: 11, fontWeight: 600 }}>{emp.role}</span>
                                        </td>
                                    </tr>
                                )
                            })}
                        </tbody>
                    </table>
                    <div style={styles.tableFooter}>{totalEmployees} employee{totalEmployees !== 1 ? 's' : ''}</div>
                </div>
            </div>
        )
    }

    // ── Branches drilldown ────────────────────────────────────────────────────
    if (drilldown === 'branches') {
        const branchList = Object.entries(roleGroups)
        return (
            <div style={styles.container}>
                <DrilldownHeader title="Branches & Departments" subtitle={`${branches} branch · ${branchList.length} department${branchList.length !== 1 ? 's' : ''}`} onBack={() => setDrilldown(null)} />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))', gap: 16 }}>
                    {branchList.map(([dept, members]) => (
                        <div key={dept} style={styles.deptCard}>
                            <div style={styles.deptHeader}>
                                <span style={styles.deptName}>{dept.charAt(0).toUpperCase() + dept.slice(1)}</span>
                                <span style={styles.deptCount}>{members.length} member{members.length !== 1 ? 's' : ''}</span>
                            </div>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 12 }}>
                                {members.map(m => {
                                    const badge = roleBadgeColor(m.role)
                                    return (
                                        <div key={m.id} style={styles.deptMember}>
                                            <div style={{ width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg,var(--accent),#7c3aed)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                                                {(m.name || '?')[0].toUpperCase()}
                                            </div>
                                            <div style={{ flex: 1, minWidth: 0 }}>
                                                <div style={{ fontSize: 13, color: 'var(--text-primary)', fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.name}</div>
                                                <div style={{ fontSize: 11, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.email}</div>
                                            </div>
                                            <span style={{ background: badge.bg, color: badge.color, border: `1px solid ${badge.border}`, padding: '2px 8px', borderRadius: 12, fontSize: 10, fontWeight: 600, flexShrink: 0 }}>{m.role}</span>
                                        </div>
                                    )
                                })}
                            </div>
                        </div>
                    ))}
                    {branchList.length === 0 && <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 24 }}>No department data available yet.</div>}
                </div>
            </div>
        )
    }

    // ── Default dashboard grid ────────────────────────────────────────────────
    return (
        <div style={styles.container}>
            <style>{`
                .metric-card-clickable { transition: all 0.2s !important; }
                .metric-card-clickable:hover { border-color: var(--accent) !important; transform: translateY(-2px); box-shadow: 0 8px 24px rgba(0,0,0,0.15); cursor: pointer; }
                .metric-card-static { transition: all 0.2s !important; }
                .metric-card-static:hover { border-color: var(--border-hover) !important; }
            `}</style>
            <div style={styles.grid}>
                <MetricCard title="Total Employees" value={totalEmployees} trend={`+${totalEmployees} this month`} color="#4f8ef7" clickable onClick={() => setDrilldown('employees')} hint="Click to view all employees" />
                <MetricCard title="Branches" value={branches} trend={`${departments} departments`} color="#34d399" clickable onClick={() => setDrilldown('branches')} hint="Click to view departments" />
                <MetricCard title="Attendance Rate" value={`${attendanceRate}%`} trend={`${presentToday} present today`} color="#fbbf24" />
                <MetricCard title="Pending Leaves" value={pendingCount} trend={`${pendingCount} on leave today`} color="#f87171" clickable onClick={() => onNavigate && onNavigate('leaves')} hint="Click to review leaves" />
                <MetricCard title="Active Jobs" value={activeJobs} trend={`+${jobsChange} this month`} color="#a78bfa" />
                <MetricCard title="Total Candidates" value={totalCandidates} trend={`+${candidatesChange} this month`} color="#f472b6" />
            </div>
            <div style={styles.chartsRow}>
                <div style={styles.chartCard}>
                    <h3 style={styles.chartTitle}>Department Distribution</h3>
                    <div style={styles.emptyChart}><span></span><p>Chart will appear once data is available</p></div>
                </div>
                <div style={styles.chartCard}>
                    <h3 style={styles.chartTitle}>Hiring Trend (6 Months)</h3>
                    <div style={styles.emptyChart}><span></span><p>Chart will appear once data is available</p></div>
                </div>
            </div>
        </div>
    )
}

/* ── Drilldown header ────────────────────────────────────────────────────────── */
function DrilldownHeader({ title, subtitle, onBack }) {
    return (
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24, paddingBottom: 20, borderBottom: '1px solid var(--border)' }}>
            <button onClick={onBack} style={{ background: 'var(--accent-dim)', border: '1px solid var(--border)', borderRadius: 8, padding: '7px 14px', color: 'var(--accent)', fontSize: 13, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.18s', fontWeight: 500 }}
                onMouseEnter={e => { e.currentTarget.style.background = 'var(--accent-glow)'; e.currentTarget.style.borderColor = 'var(--accent)' }}
                onMouseLeave={e => { e.currentTarget.style.background = 'var(--accent-dim)'; e.currentTarget.style.borderColor = 'var(--border)' }}>
                ← Back
            </button>
            <div>
                <div style={{ fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.3px' }}>{title}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{subtitle}</div>
            </div>
        </div>
    )
}

/* ── Metric card ─────────────────────────────────────────────────────────────── */
function MetricCard({ title, value, trend, color, clickable, onClick, hint }) {
    return (
        <div className={clickable ? 'metric-card-clickable' : 'metric-card-static'} onClick={clickable ? onClick : undefined} title={hint || ''} style={styles.card}>
            <div style={styles.cardHeader}>
                <span style={styles.cardTitle}>{title}</span>
                {clickable && <span style={{ fontSize: 11, color, opacity: 0.7 }}>View →</span>}
            </div>
            <div style={styles.cardValue}>{value}</div>
            <div style={{ ...styles.cardTrend, background: `${color}18`, color }}>{trend}</div>
        </div>
    )
}

const styles = {
    container: { padding: '28px 32px', width: '100%', boxSizing: 'border-box' },
    grid: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', gap: '20px', marginBottom: '40px' },
    card: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '20px', padding: '20px' },
    cardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '12px' },
    cardTitle: { fontSize: '14px', fontWeight: 500, color: 'var(--text-secondary)' },
    cardValue: { fontSize: '32px', fontWeight: 700, color: 'var(--text-primary)', marginBottom: '12px' },
    cardTrend: { fontSize: '12px', display: 'inline-block', padding: '2px 10px', borderRadius: '20px' },
    chartsRow: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))', gap: '24px' },
    chartCard: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '20px', padding: '24px' },
    chartTitle: { fontSize: '16px', fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 20px 0' },
    emptyChart: { textAlign: 'center', padding: '40px 20px', color: 'var(--text-muted)', fontSize: '14px' },
    // drilldown
    tableWrap: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 14, overflow: 'hidden' },
    table: { width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 500 },
    thead: { background: 'var(--bg-secondary)', borderBottom: '1px solid var(--border)' },
    th: { padding: '14px 18px', textAlign: 'left', color: 'var(--text-muted)', fontWeight: 600, fontSize: 11, letterSpacing: '0.06em', textTransform: 'uppercase' },
    trow: { transition: 'background 0.15s' },
    td: { padding: '13px 18px' },
    empty: { padding: 40, textAlign: 'center', color: 'var(--text-muted)' },
    tableFooter: { padding: '10px 18px', borderTop: '1px solid var(--border)', color: 'var(--text-muted)', fontSize: 11 },
    deptCard: { background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 16, padding: '18px 20px', transition: 'all 0.2s' },
    deptHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 10, borderBottom: '1px solid var(--border)' },
    deptName: { fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' },
    deptCount: { fontSize: 11, color: 'var(--text-muted)', background: 'var(--accent-dim)', border: '1px solid var(--border)', borderRadius: 10, padding: '2px 8px' },
    deptMember: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 8px', borderRadius: 8, background: 'var(--bg-secondary)', border: '1px solid var(--border)' },
}