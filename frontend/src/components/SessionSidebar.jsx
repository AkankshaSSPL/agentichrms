function getSessionGroupKey(createdAtStr) {
    const created = new Date(createdAtStr)
    const today = new Date(); today.setHours(0, 0, 0, 0)
    const yesterday = new Date(today); yesterday.setDate(yesterday.getDate() - 1)
    const weekAgo = new Date(today); weekAgo.setDate(weekAgo.getDate() - 7)
    if (created >= today) return 'Today'
    if (created >= yesterday) return 'Yesterday'
    if (created >= weekAgo) return 'Previous 7 Days'
    return 'Older'
}

export default function SessionSidebar({
    employee, view, docCount, sessions, currentSessionId, loadingSessions, menuOpen,
    onNewSession, onSelectSession, onRename, onTogglePin, onDelete, onSetMenuOpen,
    onClearMessages, onLogout, onProfileClick,
    onDocumentsClick,   // ← new prop
}) {
    const groups = { Today: [], Yesterday: [], 'Previous 7 Days': [], Older: [] }
    sessions.forEach(s => { const key = getSessionGroupKey(s.created_at); groups[key].push(s) })
    const groupOrder = ['Today', 'Yesterday', 'Previous 7 Days', 'Older']

    return (
        <aside className="sidebar">
            <div className="sidebar-brand">
                <div className="sidebar-logo">H</div>
                <div>
                    <div className="sidebar-title">HR Assistant</div>
                    <div className="sidebar-subtitle">AI-POWERED HRMS</div>
                </div>
            </div>

            {employee && (
                <div onClick={onProfileClick} style={{
                    background: view === 'profile' ? 'rgba(52,211,153,0.15)' : 'rgba(52,211,153,0.08)',
                    border: `1px solid ${view === 'profile' ? 'rgba(52,211,153,0.4)' : 'rgba(52,211,153,0.2)'}`,
                    borderRadius: '8px', padding: '10px 12px', marginBottom: '12px',
                    display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer',
                }}>
                    <div style={{
                        width: 32, height: 32, borderRadius: '50%',
                        background: 'linear-gradient(135deg,var(--green),#059669)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        fontSize: 13, fontWeight: 700, color: '#fff',
                    }}>{(employee.name || 'U')[0].toUpperCase()}</div>
                    <div style={{ minWidth: 0, flex: 1 }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{employee.name}</div>
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{employee.email}</div>
                    </div>
                </div>
            )}

            {/* ── Knowledge base status + Documents nav ── */}
            <div className="sidebar-status"><span className="dot" />Knowledge base · {docCount} docs</div>
            <button
                onClick={onDocumentsClick}
                style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '8px 10px', marginBottom: 8,
                    background: view === 'documents' ? 'rgba(79,142,247,0.15)' : 'transparent',
                    border: `1px solid ${view === 'documents' ? 'rgba(79,142,247,0.4)' : 'transparent'}`,
                    borderRadius: 8, cursor: 'pointer',
                    color: view === 'documents' ? 'var(--accent)' : 'var(--text-muted)',
                    fontSize: 13, fontWeight: view === 'documents' ? 600 : 400,
                    transition: 'all 0.15s',
                    textAlign: 'left',
                }}
            >
                <span></span> Document Library
            </button>

            <div className="sidebar-section">Your Conversations</div>

            {loadingSessions ? (
                <div className="sidebar-status">Loading...</div>
            ) : (
                <>
                    <button className="sidebar-btn" onClick={onNewSession}>+ New Chat</button>
                    {groupOrder.map(groupKey => (
                        groups[groupKey].length > 0 && (
                            <div key={groupKey}>
                                <div className="sidebar-section" style={{ marginTop: '16px' }}>{groupKey}</div>
                                {groups[groupKey].map(s => (
                                    <div key={s.id} className="session-item">
                                        <div className="session-btn-wrapper">
                                            <button
                                                className={`session-btn ${currentSessionId === s.id ? 'active-session' : ''}`}
                                                onClick={() => onSelectSession(s.id)}
                                            >
                                                <span className="session-title">{s.title}</span>
                                                {s.is_pinned && <span className="pin-icon">📌</span>}
                                            </button>
                                            <div className="session-menu">
                                                <button className="menu-dots" onClick={(e) => { e.stopPropagation(); onSetMenuOpen(menuOpen === s.id ? null : s.id) }}>⋯</button>
                                                {menuOpen === s.id && (
                                                    <div className="dropdown-menu">
                                                        <div className="dropdown-item" onClick={() => onRename(s.id, s.title)}>Rename</div>
                                                        <div className="dropdown-item" onClick={() => onTogglePin(s.id, s.is_pinned)}>{s.is_pinned ? 'Unpin' : 'Pin'}</div>
                                                        <div className="dropdown-item danger" onClick={() => onDelete(s.id)}>Delete</div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )
                    ))}
                </>
            )}

            <button className="sidebar-clear" onClick={onClearMessages}>Clear current conversation</button>
            <button className="sidebar-clear" onClick={onLogout} style={{ marginTop: 4, borderColor: 'rgba(248,113,113,.3)', color: 'var(--red)' }}>Logout</button>
        </aside>
    )
}