// src/components/DashboardMetricsSimple.jsx
import { useState, useEffect } from 'react'

export default function DashboardMetricsSimple({ employees, token }) {
    const [pendingLeaves, setPendingLeaves] = useState([])

    useEffect(() => {
        if (!token) return
        fetch('/api/leaves/pending', {
            headers: { Authorization: `Bearer ${token}` }
        })
            .then(res => res.json())
            .then(data => setPendingLeaves(data))
            .catch(() => { })
    }, [token])

    const totalEmployees = employees.length
    const pendingCount = pendingLeaves.length

    // Placeholder data – replace with real API later
    const branches = 1
    const departments = 1
    const attendanceRate = 0
    const presentToday = 0
    const activeJobs = 0
    const jobsChange = 0
    const totalCandidates = 0
    const candidatesChange = 0

    return (
        <div style={styles.container}>
            <div style={styles.grid}>
                <MetricCard
                    title="Total Employees"
                    value={totalEmployees}
                    trend={`+${totalEmployees > 0 ? totalEmployees : 0} this month`}
                    icon=""
                    color="#4f8ef7"
                />
                <MetricCard
                    title="Branches"
                    value={branches}
                    trend={`${departments} departments`}
                    icon=""
                    color="#34d399"
                />
                <MetricCard
                    title="Attendance Rate"
                    value={`${attendanceRate}%`}
                    trend={`${presentToday} present today`}
                    icon=""
                    color="#fbbf24"
                />
                <MetricCard
                    title="Pending Leaves"
                    value={pendingCount}
                    trend={`${pendingCount} on leave today`}
                    icon=""
                    color="#f87171"
                />
                <MetricCard
                    title="Active Jobs"
                    value={activeJobs}
                    trend={`+${jobsChange} this month`}
                    icon=""
                    color="#a78bfa"
                />
                <MetricCard
                    title="Total Candidates"
                    value={totalCandidates}
                    trend={`+${candidatesChange} this month`}
                    icon=""
                    color="#f472b6"
                />
            </div>

            <div style={styles.chartsRow}>
                <div style={styles.chartCard}>
                    <h3 style={styles.chartTitle}>Department Distribution</h3>
                    <div style={styles.emptyChart}>
                        <span></span>
                        <p>Chart will appear once data is available</p>
                    </div>
                </div>
                <div style={styles.chartCard}>
                    <h3 style={styles.chartTitle}>Hiring Trend (6 Months)</h3>
                    <div style={styles.emptyChart}>
                        <span></span>
                        <p>Chart will appear once data is available</p>
                    </div>
                </div>
            </div>
        </div>
    )
}

function MetricCard({ title, value, trend, icon, color }) {
    return (
        <div style={styles.card}>
            <div style={styles.cardHeader}>
                <span style={styles.cardTitle}>{title}</span>
                <span style={{ fontSize: 28 }}>{icon}</span>
            </div>
            <div style={styles.cardValue}>{value}</div>
            <div style={{ ...styles.cardTrend, background: `${color}15`, color }}>
                {trend}
            </div>
        </div>
    )
}

const styles = {
    container: {
        padding: '28px 32px',
        width: '100%',
        boxSizing: 'border-box',
    },
    grid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
        gap: '20px',
        marginBottom: '40px',
    },
    card: {
        background: 'rgba(15,18,25,0.8)',
        backdropFilter: 'blur(4px)',
        border: '1px solid rgba(79,142,247,0.12)',
        borderRadius: '20px',
        padding: '20px',
        transition: 'all 0.2s',
    },
    cardHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
        marginBottom: '12px',
    },
    cardTitle: {
        fontSize: '14px',
        fontWeight: 500,
        color: '#94a3b8',
    },
    cardValue: {
        fontSize: '32px',
        fontWeight: 700,
        color: '#e2e8f0',
        marginBottom: '12px',
    },
    cardTrend: {
        fontSize: '12px',
        display: 'inline-block',
        padding: '2px 10px',
        borderRadius: '20px',
    },
    chartsRow: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
        gap: '24px',
    },
    chartCard: {
        background: 'rgba(15,18,25,0.6)',
        border: '1px solid rgba(79,142,247,0.08)',
        borderRadius: '20px',
        padding: '24px',
    },
    chartTitle: {
        fontSize: '16px',
        fontWeight: 600,
        color: '#e2e8f0',
        margin: '0 0 20px 0',
    },
    emptyChart: {
        textAlign: 'center',
        padding: '40px 20px',
        color: '#64748b',
        fontSize: '14px',
    },
}