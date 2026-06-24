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
    collapsed, onToggleCollapsed,
}) {
    const groups = { Today: [], Yesterday: [], 'Previous 7 Days': [], Older: [] }
    sessions.forEach(s => { const key = getSessionGroupKey(s.created_at); groups[key].push(s) })
    const groupOrder = ['Today', 'Yesterday', 'Previous 7 Days', 'Older']

    return (
        <aside className="sidebar" style={{
            overflow: 'hidden',
        }}>
            <div className="sidebar-brand" style={{
                display: 'flex', alignItems: 'center',
                justifyContent: collapsed ? 'center' : 'space-between',
                gap: 8,
            }}>
                {!collapsed && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0 }}>
                        <div className="sidebar-logo">H</div>
                        <div style={{ minWidth: 0 }}>
                            <div className="sidebar-title">HR Assistant</div>
                            <div className="sidebar-subtitle">AI-POWERED HRMS</div>
                        </div>
                    </div>
                )}
                <button
                    onClick={onToggleCollapsed}
                    title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
                    style={{
                        width: 28, height: 28, flexShrink: 0, borderRadius: 7,
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', transition: 'background 0.15s, transform 0.15s',
                    }}
                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.12)' }}
                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)' }}
                >
                    <svg
                        width="14" height="14" viewBox="0 0 24 24" fill="none"
                        stroke="var(--text-secondary, #cbd5e1)" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round"
                        style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.22s ease' }}
                    >
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                </button>
            </div>

            {collapsed ? (
                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, marginTop: 8 }}>
                    {employee && (
                        <div
                            onClick={onProfileClick}
                            title={employee.name}
                            style={{
                                width: 32, height: 32, borderRadius: '50%', cursor: 'pointer',
                                background: 'linear-gradient(135deg,var(--green),#059669)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 13, fontWeight: 700, color: '#fff',
                                outline: view === 'profile' ? '2px solid rgba(52,211,153,0.5)' : 'none',
                            }}
                        >{(employee.name || 'U')[0].toUpperCase()}</div>
                    )}
                    <button
                        onClick={onDocumentsClick}
                        title="Document Library"
                        style={{
                            width: 32, height: 32, borderRadius: 7, cursor: 'pointer', flexShrink: 0,
                            background: view === 'documents' ? 'var(--accent, #4f8ef7)' : 'rgba(79,142,247,0.18)',
                            border: 'none', display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                            stroke={view === 'documents' ? '#fff' : 'var(--accent, #4f8ef7)'}
                            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <path d="M14 2v6h6" />
                            <line x1="8" y1="13" x2="16" y2="13" />
                            <line x1="8" y1="17" x2="13" y2="17" />
                        </svg>
                    </button>
                    <button
                        onClick={onNewSession}
                        title="New Chat"
                        style={{
                            width: 32, height: 32, borderRadius: 7, cursor: 'pointer', flexShrink: 0,
                            background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.12)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            color: 'var(--text-secondary, #cbd5e1)', fontSize: 18, lineHeight: 1,
                        }}
                    >+</button>
                    <button
                        onClick={onLogout}
                        title="Logout"
                        style={{
                            width: 32, height: 32, borderRadius: 7, cursor: 'pointer', flexShrink: 0,
                            background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.3)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            marginTop: 'auto',
                        }}
                    >
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                            stroke="var(--red, #f87171)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                    </button>
                </div>
            ) : (
            <>

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

            {/* ── Documents nav ── */}
            <button
                onClick={onDocumentsClick}
                style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '10px 12px', marginBottom: 12,
                    background: view === 'documents' ? 'rgba(79,142,247,0.16)' : 'rgba(79,142,247,0.07)',
                    border: `1px solid ${view === 'documents' ? 'rgba(79,142,247,0.45)' : 'rgba(79,142,247,0.18)'}`,
                    borderRadius: 8, cursor: 'pointer',
                    transition: 'background 0.15s, border-color 0.15s, transform 0.1s',
                    textAlign: 'left',
                }}
                onMouseEnter={e => {
                    if (view !== 'documents') {
                        e.currentTarget.style.background = 'rgba(79,142,247,0.12)'
                        e.currentTarget.style.borderColor = 'rgba(79,142,247,0.3)'
                    }
                }}
                onMouseLeave={e => {
                    if (view !== 'documents') {
                        e.currentTarget.style.background = 'rgba(79,142,247,0.07)'
                        e.currentTarget.style.borderColor = 'rgba(79,142,247,0.18)'
                    }
                }}
            >
                <span style={{
                    width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                    background: view === 'documents' ? 'var(--accent, #4f8ef7)' : 'rgba(79,142,247,0.18)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    transition: 'background 0.15s',
                }}>
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                        stroke={view === 'documents' ? '#fff' : 'var(--accent, #4f8ef7)'}
                        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                        <path d="M14 2v6h6" />
                        <line x1="8" y1="13" x2="16" y2="13" />
                        <line x1="8" y1="17" x2="13" y2="17" />
                    </svg>
                </span>
                <span style={{
                    color: view === 'documents' ? 'var(--accent)' : 'var(--text-secondary, #cbd5e1)',
                    fontSize: 13, fontWeight: view === 'documents' ? 600 : 500,
                }}>
                    Document Library
                </span>
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
            </>
            )}
        </aside>
    )
}