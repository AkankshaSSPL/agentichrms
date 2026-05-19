import { useState, useEffect, useCallback } from 'react'

const API = '/api'

export default function NotificationBell({ token }) {
    const [unreadCount, setUnreadCount] = useState(0)
    const [notifications, setNotifications] = useState([])
    const [showDropdown, setShowDropdown] = useState(false)
    const [dismissed, setDismissed] = useState(() => {
        try { return JSON.parse(localStorage.getItem('dismissed_notifications') || '[]') } catch { return [] }
    })
    const [showDismissed, setShowDismissed] = useState(false)

    const saveDismissed = (ids) => {
        setDismissed(ids)
        localStorage.setItem('dismissed_notifications', JSON.stringify(ids))
    }

    const dismissNotification = (e, id) => {
        e.stopPropagation()
        const updated = [...new Set([...dismissed, id])]
        saveDismissed(updated)
    }

    const undismissAll = () => {
        saveDismissed([])
        setShowDismissed(false)
    }

    const fetchNotifications = useCallback(async () => {
        try {
            const res = await fetch(`${API}/notifications/?only_unread=true`, {
                headers: { Authorization: `Bearer ${token}` }
            })
            if (!res.ok) throw new Error()
            const data = await res.json()
            // Only count unread that aren't dismissed
            const currentDismissed = JSON.parse(localStorage.getItem('dismissed_notifications') || '[]')
            setUnreadCount(data.filter(n => !currentDismissed.includes(n.id)).length)
        } catch (err) {
            console.error("Failed to fetch notifications count", err)
        }
    }, [token])

    const fetchAll = useCallback(async () => {
        try {
            const res = await fetch(`${API}/notifications/`, {
                headers: { Authorization: `Bearer ${token}` }
            })
            if (!res.ok) throw new Error()
            const data = await res.json()
            setNotifications(data)
            const currentDismissed = JSON.parse(localStorage.getItem('dismissed_notifications') || '[]')
            setUnreadCount(data.filter(n => !n.is_read && !currentDismissed.includes(n.id)).length)
        } catch (err) {
            console.error("Failed to fetch notifications", err)
        }
    }, [token])

    const markAsRead = async (id) => {
        try {
            await fetch(`${API}/notifications/${id}/read`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            })
            fetchAll()
        } catch (err) {
            console.error("Could not mark read:", err)
        }
    }

    const markAllRead = async () => {
        try {
            await fetch(`${API}/notifications/read-all`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            })
            fetchAll()
        } catch (err) {
            console.error("Could not mark all read:", err)
        }
    }

    useEffect(() => {
        fetchNotifications()
        const interval = setInterval(fetchNotifications, 10000)
        return () => clearInterval(interval)
    }, [fetchNotifications])

    useEffect(() => {
        if (showDropdown) fetchAll()
    }, [showDropdown, fetchAll])

    const BellIcon = () => (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
            <path d="M13.73 21a2 2 0 0 1-3.46 0" />
        </svg>
    )

    const visible = notifications.filter(n => !dismissed.includes(n.id))
    const dismissedList = notifications.filter(n => dismissed.includes(n.id))

    const NotifCard = ({ n, isDismissed }) => (
        <div
            key={n.id}
            onClick={() => { if (!n.is_read && !isDismissed) markAsRead(n.id) }}
            style={{
                padding: '10px 12px',
                borderBottom: '1px solid var(--border)',
                background: (!n.is_read && !isDismissed) ? 'var(--accent-dim)' : 'transparent',
                cursor: isDismissed ? 'default' : 'pointer',
                transition: 'background 0.2s',
                position: 'relative',
                opacity: isDismissed ? 0.5 : 1,
            }}
        >
            {/* × dismiss button — only on active notifications */}
            {!isDismissed && (
                <button
                    onClick={(e) => dismissNotification(e, n.id)}
                    title="Dismiss"
                    style={{
                        position: 'absolute', top: 8, right: 8,
                        background: 'transparent', border: 'none',
                        color: 'var(--text-muted)', fontSize: 13,
                        lineHeight: 1, cursor: 'pointer', padding: '2px 5px',
                        borderRadius: 4, transition: 'color 0.15s, background 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.color = 'var(--text-primary)'; e.currentTarget.style.background = 'rgba(255,255,255,0.07)' }}
                    onMouseLeave={e => { e.currentTarget.style.color = 'var(--text-muted)'; e.currentTarget.style.background = 'transparent' }}
                >✕</button>
            )}
            <div style={{ fontWeight: 600, fontSize: '12px', marginBottom: '3px', color: 'var(--text-primary)', paddingRight: 20 }}>{n.title}</div>
            <div style={{ fontSize: '11px', color: 'var(--text-secondary)' }}>{n.message}</div>
            <div style={{ fontSize: '9px', color: 'var(--text-muted)', marginTop: '4px' }}>
                {new Date(n.created_at).toLocaleString()}
            </div>
        </div>
    )

    return (
        <div style={{ position: 'relative', display: 'inline-block' }}>
            <button
                onClick={() => setShowDropdown(!showDropdown)}
                style={{
                    background: 'transparent', border: 'none', cursor: 'pointer',
                    fontSize: '18px', color: 'var(--text-secondary)', position: 'relative',
                    padding: '8px', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'color 0.2s'
                }}
                onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-secondary)'}
            >
                <BellIcon />
                {unreadCount > 0 && (
                    <span style={{
                        position: 'absolute', top: '2px', right: '2px',
                        background: 'var(--red)', color: '#060812',
                        fontSize: '9px', fontWeight: 'bold', borderRadius: '10px',
                        padding: '1px 5px', minWidth: '12px', textAlign: 'center',
                        boxShadow: '0 0 4px var(--red)'
                    }}>
                        {unreadCount}
                    </span>
                )}
            </button>

            {showDropdown && (
                <div style={{
                    position: 'absolute', right: 0, top: '40px', width: '320px',
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
                    zIndex: 999, overflow: 'hidden'
                }}>
                    {/* Header */}
                    <div style={{
                        padding: '12px', borderBottom: '1px solid var(--border)',
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        background: 'var(--bg-secondary)'
                    }}>
                        <span style={{ fontSize: '13px', fontWeight: 'bold', color: 'var(--text-primary)' }}>Notifications</span>
                        {unreadCount > 0 && (
                            <button onClick={markAllRead} style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '11px', cursor: 'pointer', padding: 0 }}>
                                Mark all as read
                            </button>
                        )}
                    </div>

                    {/* Active notifications */}
                    <div style={{ maxHeight: '300px', overflowY: 'auto' }}>
                        {visible.length === 0 ? (
                            <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '12px' }}>
                                No notifications
                            </div>
                        ) : (
                            visible.map(n => <NotifCard key={n.id} n={n} isDismissed={false} />)
                        )}
                    </div>

                    {/* Dismissed section toggle */}
                    {dismissedList.length > 0 && (
                        <div style={{ borderTop: '1px solid var(--border)' }}>
                            <button
                                onClick={() => setShowDismissed(v => !v)}
                                style={{
                                    width: '100%', padding: '8px 12px',
                                    background: 'var(--bg-secondary)', border: 'none',
                                    color: 'var(--text-muted)', fontSize: '11px',
                                    cursor: 'pointer', display: 'flex', alignItems: 'center',
                                    justifyContent: 'space-between', transition: 'color 0.15s'
                                }}
                                onMouseEnter={e => e.currentTarget.style.color = 'var(--text-primary)'}
                                onMouseLeave={e => e.currentTarget.style.color = 'var(--text-muted)'}
                            >
                                <span>Previously dismissed ({dismissedList.length})</span>
                                <span style={{ fontSize: 10 }}>{showDismissed ? '▲' : '▼'}</span>
                            </button>

                            {showDismissed && (
                                <>
                                    <div style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                        {dismissedList.map(n => <NotifCard key={n.id} n={n} isDismissed={true} />)}
                                    </div>
                                    <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border)', textAlign: 'right' }}>
                                        <button
                                            onClick={undismissAll}
                                            style={{ background: 'none', border: 'none', color: 'var(--accent)', fontSize: '10px', cursor: 'pointer', padding: 0 }}
                                        >
                                            Restore all
                                        </button>
                                    </div>
                                </>
                            )}
                        </div>
                    )}
                </div>
            )}
        </div>
    )
}
