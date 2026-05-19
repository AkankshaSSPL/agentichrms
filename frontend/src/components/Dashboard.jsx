// frontend/src/components/Dashboard.jsx
import { useState, useEffect } from 'react'

const API = '/api'

export default function Dashboard({ employee }) {
    const [tasks, setTasks] = useState([])
    const [progress, setProgress] = useState(0)
    const [loading, setLoading] = useState(true)
    const [error, setError] = useState('')

    const fetchChecklist = async () => {
        try {
            const res = await fetch(`${API}/onboarding/${employee.id}/checklist`)
            if (!res.ok) throw new Error('Failed to fetch checklist')
            const data = await res.json()
            setTasks(data.checklist || [])
        } catch (err) {
            setError(err.message)
        }
    }

    const fetchProgress = async () => {
        try {
            const res = await fetch(`${API}/onboarding/${employee.id}/progress`)
            if (!res.ok) throw new Error('Failed to fetch progress')
            const data = await res.json()
            setProgress(data.progress_percentage || 0)
        } catch (err) {
            setError(err.message)
        }
    }

    const completeTask = async (taskId) => {
        try {
            const res = await fetch(`${API}/onboarding/${employee.id}/task/${taskId}/complete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' }
            })
            if (!res.ok) throw new Error('Failed to mark task complete')
            await fetchChecklist()
            await fetchProgress()
        } catch (err) {
            setError(err.message)
        }
    }

    useEffect(() => {
        if (employee && employee.id) {
            setLoading(true)
            Promise.all([fetchChecklist(), fetchProgress()]).finally(() => setLoading(false))
        }
    }, [employee])

    if (loading) return <DashboardLoader />
    if (error) return <DashboardError message={error} />

    const completedCount = tasks.filter(t => t.is_completed).length
    const totalCount = tasks.length

    return (
        <div style={styles.container}>
            {/* Welcome Section */}
            <div style={styles.welcomeCard}>
                <div>
                    <h1 style={styles.welcomeTitle}>Welcome aboard, {employee.name?.split(' ')[0]}! 🎉</h1>
                    <p style={styles.welcomeText}>Complete your onboarding checklist to get started.</p>
                </div>
                <div style={styles.welcomeEmoji}>📋</div>
            </div>

            {/* Stats Cards */}
            <div style={styles.statsGrid}>
                <StatCard label="Total Tasks" value={totalCount} icon="📌" color="#4f8ef7" />
                <StatCard label="Completed" value={completedCount} icon="✅" color="#34d399" />
                <StatCard label="Remaining" value={totalCount - completedCount} icon="⏳" color="#fbbf24" />
            </div>

            {/* Progress Section */}
            <div style={styles.progressCard}>
                <div style={styles.progressHeader}>
                    <span style={styles.progressLabel}>Overall Progress</span>
                    <span style={styles.progressPercent}>{Math.round(progress)}%</span>
                </div>
                <div style={styles.progressBarBg}>
                    <div style={{ ...styles.progressBarFill, width: `${progress}%` }} />
                </div>
            </div>

            {/* Tasks Section */}
            <div style={styles.tasksCard}>
                <h3 style={styles.tasksTitle}>Your Onboarding Checklist</h3>
                {tasks.length === 0 ? (
                    <div style={styles.emptyTasks}>
                        <div style={styles.emptyIcon}>✅</div>
                        <p>No tasks assigned yet. Check back later!</p>
                    </div>
                ) : (
                    <div style={styles.tasksGrid}>
                        {tasks.map(task => (
                            <div key={task.id} style={{ ...styles.taskCard, opacity: task.is_completed ? 0.7 : 1 }}>
                                <div style={styles.taskCheck}>
                                    <input
                                        type="checkbox"
                                        checked={task.is_completed}
                                        onChange={() => completeTask(task.id)}
                                        disabled={task.is_completed}
                                        id={`task-${task.id}`}
                                        style={styles.checkbox}
                                    />
                                </div>
                                <div style={styles.taskContent}>
                                    <h4 style={styles.taskName}>{task.task_name}</h4>
                                    {task.description && <p style={styles.taskDesc}>{task.description}</p>}
                                    {task.due_date && (
                                        <span style={styles.dueDate}>📅 Due: {new Date(task.due_date).toLocaleDateString()}</span>
                                    )}
                                    {task.completed_at && (
                                        <span style={styles.completedDate}>✓ Completed {new Date(task.completed_at).toLocaleDateString()}</span>
                                    )}
                                </div>
                                <div style={styles.taskIcon}>{task.is_completed ? '✅' : '📌'}</div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}

// Helper Components
const StatCard = ({ label, value, icon, color }) => (
    <div style={styles.statCard}>
        <div style={{ ...styles.statIcon, background: `${color}15`, color }}>{icon}</div>
        <div style={styles.statInfo}>
            <span style={styles.statValue}>{value}</span>
            <span style={styles.statLabel}>{label}</span>
        </div>
    </div>
)

const DashboardLoader = () => (
    <div style={styles.loaderContainer}>
        <div style={styles.spinner} />
        <p>Loading your onboarding tasks...</p>
    </div>
)

const DashboardError = ({ message }) => (
    <div style={styles.errorContainer}>
        <span>⚠️</span> {message}
    </div>
)

// Styles – glassmorphic, matches AdminPanel theme
const styles = {
    container: {
        padding: '32px',
        maxWidth: '1200px',
        margin: '0 auto',
        width: '100%',
        boxSizing: 'border-box',
    },
    welcomeCard: {
        background: 'rgba(15,18,25,0.8)',
        backdropFilter: 'blur(4px)',
        border: '1px solid rgba(79,142,247,0.12)',
        borderRadius: '24px',
        padding: '24px 32px',
        marginBottom: '28px',
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'center',
    },
    welcomeTitle: {
        fontSize: '24px',
        fontWeight: 700,
        color: '#e2e8f0',
        margin: '0 0 6px 0',
    },
    welcomeText: {
        fontSize: '13px',
        color: '#64748b',
        margin: 0,
    },
    welcomeEmoji: {
        fontSize: '48px',
        opacity: 0.6,
    },
    statsGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))',
        gap: '16px',
        marginBottom: '28px',
    },
    statCard: {
        background: 'rgba(15,18,25,0.6)',
        border: '1px solid rgba(79,142,247,0.08)',
        borderRadius: '20px',
        padding: '18px',
        display: 'flex',
        alignItems: 'center',
        gap: '14px',
        transition: 'all 0.2s',
    },
    statIcon: {
        width: '48px',
        height: '48px',
        borderRadius: '16px',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: '24px',
    },
    statInfo: {
        display: 'flex',
        flexDirection: 'column',
    },
    statValue: {
        fontSize: '28px',
        fontWeight: 700,
        color: '#e2e8f0',
        lineHeight: 1.2,
    },
    statLabel: {
        fontSize: '12px',
        color: '#64748b',
    },
    progressCard: {
        background: 'rgba(15,18,25,0.6)',
        border: '1px solid rgba(79,142,247,0.08)',
        borderRadius: '20px',
        padding: '20px 24px',
        marginBottom: '28px',
    },
    progressHeader: {
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'baseline',
        marginBottom: '12px',
    },
    progressLabel: {
        fontSize: '14px',
        fontWeight: 500,
        color: '#94a3b8',
    },
    progressPercent: {
        fontSize: '20px',
        fontWeight: 700,
        color: '#4f8ef7',
    },
    progressBarBg: {
        background: 'rgba(79,142,247,0.1)',
        borderRadius: '20px',
        height: '8px',
        overflow: 'hidden',
    },
    progressBarFill: {
        background: 'linear-gradient(90deg, #4f8ef7, #7c3aed)',
        height: '100%',
        borderRadius: '20px',
        transition: 'width 0.3s ease',
    },
    tasksCard: {
        background: 'rgba(15,18,25,0.6)',
        border: '1px solid rgba(79,142,247,0.08)',
        borderRadius: '20px',
        padding: '24px',
    },
    tasksTitle: {
        fontSize: '18px',
        fontWeight: 600,
        color: '#e2e8f0',
        margin: '0 0 20px 0',
    },
    tasksGrid: {
        display: 'flex',
        flexDirection: 'column',
        gap: '12px',
    },
    taskCard: {
        background: 'rgba(6,8,18,0.6)',
        border: '1px solid rgba(79,142,247,0.1)',
        borderRadius: '16px',
        padding: '16px',
        display: 'flex',
        gap: '16px',
        alignItems: 'flex-start',
        transition: 'all 0.2s',
    },
    taskCheck: {
        flexShrink: 0,
    },
    checkbox: {
        width: '20px',
        height: '20px',
        cursor: 'pointer',
        accentColor: '#4f8ef7',
    },
    taskContent: {
        flex: 1,
    },
    taskName: {
        fontSize: '15px',
        fontWeight: 600,
        color: '#e2e8f0',
        margin: '0 0 4px 0',
    },
    taskDesc: {
        fontSize: '13px',
        color: '#94a3b8',
        margin: '0 0 6px 0',
    },
    dueDate: {
        fontSize: '11px',
        color: '#fbbf24',
        background: 'rgba(251,191,36,0.1)',
        padding: '2px 8px',
        borderRadius: '12px',
        display: 'inline-block',
    },
    completedDate: {
        fontSize: '11px',
        color: '#34d399',
        background: 'rgba(52,211,153,0.1)',
        padding: '2px 8px',
        borderRadius: '12px',
        display: 'inline-block',
    },
    taskIcon: {
        fontSize: '20px',
        opacity: 0.7,
    },
    loaderContainer: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        height: '400px',
        color: '#64748b',
    },
    spinner: {
        width: '40px',
        height: '40px',
        border: '2px solid rgba(79,142,247,0.2)',
        borderTopColor: '#4f8ef7',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
        marginBottom: '16px',
    },
    errorContainer: {
        padding: '40px',
        textAlign: 'center',
        color: '#f87171',
        background: 'rgba(248,113,113,0.05)',
        borderRadius: '20px',
    },
}

// Add this CSS to your global styles or inside a <style> tag in the component
if (typeof document !== 'undefined') {
    const style = document.createElement('style')
    style.textContent = `
    @keyframes spin {
      to { transform: rotate(360deg); }
    }
  `
    document.head.appendChild(style)
}