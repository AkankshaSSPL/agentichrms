// ── Inline Helper Function ───────────────────────────────────────────────────
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

// ── Reusable icon button for collapsed rail ────────────────────────────────────
function RailBtn({ onClick, title, active, danger, children }) {
    const base = {
        width: 38, height: 38, borderRadius: 10, cursor: 'pointer', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        border: '1px solid transparent', transition: 'background 0.15s, border-color 0.15s, transform 0.1s',
        position: 'relative', padding: 0, boxSizing: 'border-box',
    }
    const normal = {
        background: active ? 'rgba(79,142,247,0.22)' : 'rgba(255,255,255,0.05)',
        borderColor: active ? 'rgba(79,142,247,0.4)' : 'rgba(255,255,255,0.08)',
    }
    const dangerStyle = {
        background: 'rgba(248,113,113,0.08)',
        borderColor: 'rgba(248,113,113,0.25)',
    }
    return (
        <button
            onClick={onClick}
            title={title}
            style={{ ...base, ...(danger ? dangerStyle : normal) }}
            onMouseEnter={e => {
                e.currentTarget.style.transform = 'scale(1.08)'
                e.currentTarget.style.background = danger
                    ? 'rgba(248,113,113,0.18)'
                    : active ? 'rgba(79,142,247,0.3)' : 'rgba(255,255,255,0.1)'
                e.currentTarget.style.borderColor = danger
                    ? 'rgba(248,113,113,0.5)'
                    : active ? 'rgba(79,142,247,0.55)' : 'rgba(255,255,255,0.18)'
            }}
            onMouseLeave={e => {
                e.currentTarget.style.transform = 'scale(1)'
                e.currentTarget.style.background = danger ? dangerStyle.background : normal.background
                e.currentTarget.style.borderColor = danger ? dangerStyle.borderColor : normal.borderColor
            }}
        >
            {children}
        </button>
    )
}

export default function SessionSidebar({
    employee, view, docCount, sessions, currentSessionId, loadingSessions, menuOpen,
    onNewSession, onSelectSession, onRename, onTogglePin, onDelete, onSetMenuOpen,
    onClearMessages, onLogout, onProfileClick,
    onDocumentsClick,
    collapsed, onToggleCollapsed,
}) {
    const groups = { Today: [], Yesterday: [], 'Previous 7 Days': [], Older: [] }
    sessions.forEach(s => { const key = getSessionGroupKey(s.created_at); groups[key].push(s) })
    const groupOrder = ['Today', 'Yesterday', 'Previous 7 Days', 'Older']

    const scrollable = {
        flex: 1,
        overflowY: 'auto',
        overflowX: 'hidden',
        scrollbarWidth: 'thin',
        scrollbarColor: 'var(--border-hover) transparent',
        width: '100%',
    }

    return (
        <aside className="sidebar" style={{
            display: 'flex',
            flexDirection: 'column',
            height: '100vh',
            overflow: 'hidden',
            padding: collapsed ? '24px 0' : '24px 18px',
            alignItems: collapsed ? 'center' : 'stretch'
        }}>

            {/* ── Brand / collapse toggle ── */}
            <div className="sidebar-brand" style={{
                display: 'flex', alignItems: 'center', flexShrink: 0,
                justifyContent: collapsed ? 'center' : 'space-between',
                gap: 8,
                width: '100%',
                paddingLeft: collapsed ? 0 : 4,
                paddingRight: collapsed ? 0 : 4
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
                        width: 38, height: 38, flexShrink: 0, borderRadius: 10,
                        background: 'rgba(255,255,255,0.06)',
                        border: '1px solid rgba(255,255,255,0.12)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        cursor: 'pointer', transition: 'background 0.15s',
                        padding: 0, boxSizing: 'border-box',
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(255,255,255,0.06)'}
                >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                        stroke="var(--text-secondary, #cbd5e1)" strokeWidth="2"
                        strokeLinecap="round" strokeLinejoin="round"
                        style={{ transform: collapsed ? 'rotate(180deg)' : 'none', transition: 'transform 0.22s ease' }}>
                        <polyline points="15 18 9 12 15 6" />
                    </svg>
                </button>
            </div>

            {/* ════════════════════════════════════════
                COLLAPSED RAIL
            ════════════════════════════════════════ */}
            {collapsed ? (
                <div style={{ ...scrollable, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 6, paddingTop: 8, paddingBottom: 16 }}>

                    {/* Profile avatar */}
                    {employee && (
                        <RailBtn onClick={onProfileClick} title={`Profile — ${employee.name}`} active={view === 'profile'}>
                            <div style={{
                                width: 26, height: 26, borderRadius: '50%',
                                background: 'linear-gradient(135deg,var(--green),#059669)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                fontSize: 12, fontWeight: 700, color: '#fff',
                            }}>{(employee.name || 'U')[0].toUpperCase()}</div>
                        </RailBtn>
                    )}

                    {/* Document Library */}
                    <RailBtn onClick={onDocumentsClick} title="Document Library" active={view === 'documents'}>
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                            stroke={view === 'documents' ? 'var(--accent,#4f8ef7)' : 'var(--text-secondary,#cbd5e1)'}
                            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <path d="M14 2v6h6" />
                            <line x1="8" y1="13" x2="16" y2="13" />
                            <line x1="8" y1="17" x2="13" y2="17" />
                        </svg>
                    </RailBtn>

                    {/* New Chat */}
                    <RailBtn onClick={onNewSession} title="New Chat">
                        <svg width="15" height="15" viewBox="0 0 24 24" fill="none"
                            stroke="var(--text-secondary,#cbd5e1)" strokeWidth="2"
                            strokeLinecap="round" strokeLinejoin="round">
                            <line x1="12" y1="5" x2="12" y2="19" />
                            <line x1="5" y1="12" x2="19" y2="12" />
                        </svg>
                    </RailBtn>

                    {/* Divider */}
                    <div style={{ width: 24, height: 1, background: 'rgba(255,255,255,0.08)', borderRadius: 1, margin: '4px 0' }} />

                    {/* Clear conversation */}
                    <RailBtn onClick={onClearMessages} title="Clear current conversation">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                            stroke="var(--text-muted,#94a3b8)" strokeWidth="2"
                            strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
                            <path d="M10 11v6M14 11v6" />
                        </svg>
                    </RailBtn>

                    {/* Logout */}
                    <RailBtn onClick={onLogout} title="Logout" danger>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                            stroke="var(--red,#f87171)" strokeWidth="2"
                            strokeLinecap="round" strokeLinejoin="round">
                            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
                            <polyline points="16 17 21 12 16 7" />
                            <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                    </RailBtn>
                </div>

            ) : (
            /* ════════════════════════════════════════
               EXPANDED SIDEBAR
            ════════════════════════════════════════ */
            <div style={{ ...scrollable, display: 'flex', flexDirection: 'column', paddingRight: 10 }}>

                {/* Profile card */}
                {employee && (
                    <div onClick={onProfileClick} style={{
                        background: view === 'profile' ? 'rgba(52,211,153,0.15)' : 'rgba(52,211,153,0.08)',
                        border: `1px solid ${view === 'profile' ? 'rgba(52,211,153,0.4)' : 'rgba(52,211,153,0.2)'}`,
                        borderRadius: 8, padding: '10px 12px', marginBottom: 12,
                        display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer',
                        transition: 'background 0.15s, border-color 0.15s',
                    }}
                        onMouseEnter={e => { if (view !== 'profile') { e.currentTarget.style.background = 'rgba(52,211,153,0.12)'; e.currentTarget.style.borderColor = 'rgba(52,211,153,0.3)' } }}
                        onMouseLeave={e => { if (view !== 'profile') { e.currentTarget.style.background = 'rgba(52,211,153,0.08)'; e.currentTarget.style.borderColor = 'rgba(52,211,153,0.2)' } }}
                    >
                        <div style={{
                            width: 32, height: 32, borderRadius: '50%',
                            background: 'linear-gradient(135deg,var(--green),#059669)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 13, fontWeight: 700, color: '#fff', flexShrink: 0,
                        }}>{(employee.name || 'U')[0].toUpperCase()}</div>
                        <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--green)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{employee.name}</div>
                            <div style={{ fontSize: 10, color: 'var(--text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{employee.email}</div>
                        </div>
                    </div>
                )}

                {/* Document Library */}
                <button onClick={onDocumentsClick} style={{
                    display: 'flex', alignItems: 'center', gap: 10,
                    width: '100%', padding: '10px 12px', marginBottom: 12,
                    background: view === 'documents' ? 'rgba(79,142,247,0.16)' : 'rgba(79,142,247,0.07)',
                    border: `1px solid ${view === 'documents' ? 'rgba(79,142,247,0.45)' : 'rgba(79,142,247,0.18)'}`,
                    borderRadius: 8, cursor: 'pointer', textAlign: 'left',
                    transition: 'background 0.15s, border-color 0.15s',
                }}
                    onMouseEnter={e => { if (view !== 'documents') { e.currentTarget.style.background = 'rgba(79,142,247,0.12)'; e.currentTarget.style.borderColor = 'rgba(79,142,247,0.3)' } }}
                    onMouseLeave={e => { if (view !== 'documents') { e.currentTarget.style.background = 'rgba(79,142,247,0.07)'; e.currentTarget.style.borderColor = 'rgba(79,142,247,0.18)' } }}
                >
                    <span style={{
                        width: 28, height: 28, borderRadius: 7, flexShrink: 0,
                        background: view === 'documents' ? 'var(--accent,#4f8ef7)' : 'rgba(79,142,247,0.18)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'background 0.15s',
                    }}>
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                            stroke={view === 'documents' ? '#fff' : 'var(--accent,#4f8ef7)'}
                            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                            <path d="M14 2v6h6" />
                            <line x1="8" y1="13" x2="16" y2="13" />
                            <line x1="8" y1="17" x2="13" y2="17" />
                        </svg>
                    </span>
                    <span style={{ color: view === 'documents' ? 'var(--accent)' : 'var(--text-secondary,#cbd5e1)', fontSize: 13, fontWeight: view === 'documents' ? 600 : 500 }}>
                        Document Library
                    </span>
                </button>

                {/* Conversations */}
                <div className="sidebar-section">Your Conversations</div>

                {loadingSessions ? (
                    <div className="sidebar-status">Loading...</div>
                ) : (
                    <>
                        <button className="sidebar-btn" onClick={onNewSession}>+ New Chat</button>
                        {groupOrder.map(groupKey => (
                            groups[groupKey].length > 0 && (
                                <div key={groupKey}>
                                    <div className="sidebar-section" style={{ marginTop: 16 }}>{groupKey}</div>
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

                {/* Footer actions — pinned to bottom */}
                <div style={{ marginTop: 'auto', paddingTop: 20, paddingBottom: 12, display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <button className="sidebar-clear" onClick={onClearMessages}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.06)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.18)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.borderColor = '' }}
                    >Clear current conversation</button>
                    <button className="sidebar-clear" onClick={onLogout}
                        style={{ borderColor: 'rgba(248,113,113,0.3)', color: 'var(--red)' }}
                        onMouseEnter={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.1)'; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.5)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = ''; e.currentTarget.style.borderColor = 'rgba(248,113,113,0.3)' }}
                    >Logout</button>
                </div>

            </div>
            )}
        </aside>
    )
}