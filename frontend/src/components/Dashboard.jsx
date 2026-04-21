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

    if (loading) return (
        <div className="dashboard-loading">
            <div className="loading-spinner"></div>
            <p>Loading your onboarding tasks...</p>
        </div>
    )
    if (error) return <div className="dashboard-error">⚠️ {error}</div>

    const completedCount = tasks.filter(t => t.is_completed).length
    const totalCount = tasks.length

    return (
        <div className="dashboard-container">
            {/* Welcome Section */}
            <div className="welcome-section">
                <h1>Welcome aboard, {employee.name?.split(' ')[0]}! </h1>
                <p>Complete your onboarding tasks to get started with Agentic HRMS.</p>
            </div>

            {/* Stats Cards */}
            <div className="stats-grid">
                <div className="stat-card">
                    <div className="stat-icon"></div>
                    <div className="stat-info">
                        <span className="stat-value">{totalCount}</span>
                        <span className="stat-label">Total Tasks</span>
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon"></div>
                    <div className="stat-info">
                        <span className="stat-value">{completedCount}</span>
                        <span className="stat-label">Completed</span>
                    </div>
                </div>
                <div className="stat-card">
                    <div className="stat-icon"></div>
                    <div className="stat-info">
                        <span className="stat-value">{totalCount - completedCount}</span>
                        <span className="stat-label">Remaining</span>
                    </div>
                </div>
            </div>

            {/* Progress Section */}
            <div className="progress-section">
                <div className="progress-header">
                    <h3>Overall Progress</h3>
                    <span className="progress-percent">{Math.round(progress)}%</span>
                </div>
                <div className="progress-bar-container">
                    <div className="progress-bar-fill" style={{ width: `${progress}%` }}></div>
                </div>
            </div>

            {/* Tasks Section */}
            <div className="tasks-section">
                <h3>Your Onboarding Checklist</h3>
                {tasks.length === 0 ? (
                    <div className="empty-tasks">
                        <div className="empty-icon"></div>
                        <p>No tasks assigned yet. Check back later!</p>
                    </div>
                ) : (
                    <div className="tasks-grid">
                        {tasks.map(task => (
                            <div key={task.id} className={`task-card ${task.is_completed ? 'completed' : ''}`}>
                                <div className="task-status">
                                    <input
                                        type="checkbox"
                                        checked={task.is_completed}
                                        onChange={() => completeTask(task.id)}
                                        disabled={task.is_completed}
                                        id={`task-${task.id}`}
                                    />
                                    <label htmlFor={`task-${task.id}`}></label>
                                </div>
                                <div className="task-content">
                                    <h4>{task.task_name}</h4>
                                    {task.description && <p>{task.description}</p>}
                                    {task.due_date && (
                                        <span className="due-date">📅 Due: {new Date(task.due_date).toLocaleDateString()}</span>
                                    )}
                                    {task.completed_at && (
                                        <span className="completed-date">✓ Completed {new Date(task.completed_at).toLocaleDateString()}</span>
                                    )}
                                </div>
                                <div className="task-icon">
                                    {task.is_completed ? '✅' : '📌'}
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    )
}