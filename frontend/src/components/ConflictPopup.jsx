export default function ConflictPopup({ popup, onProceed, onReschedule, onCancel, onDismiss }) {
    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 99999, background: 'rgba(0,0,0,0.65)',
            display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'all',
        }}>
            <div style={{
                background: 'var(--bg-card)', border: '1px solid rgba(248,113,113,0.3)',
                borderRadius: 14, padding: '28px 28px 24px', maxWidth: 440, width: '90%',
                boxShadow: '0 8px 32px rgba(0,0,0,0.6)', position: 'relative', zIndex: 100000,
            }}>
                <button onClick={onDismiss} style={{
                    position: 'absolute', top: 12, right: 14, background: 'transparent',
                    border: 'none', color: 'var(--text-muted)', fontSize: 20, cursor: 'pointer',
                }}>✕</button>

                <div style={{ fontSize: 20, marginBottom: 6 }}>⚠️</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--red)', marginBottom: 8 }}>
                    Calendar Conflict Detected
                </div>
                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 14 }}>
                    You have the following meetings during your requested leave period:
                </div>

                <ul style={{ margin: '0 0 18px 0', padding: '0 0 0 16px', listStyle: 'disc' }}>
                    {(popup.meetings || []).map((m, i) => {
                        const dateStr = m.date || m.meeting_date || ''
                        const displayDate = dateStr
                            ? (() => { try { return new Date(dateStr).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) } catch { return dateStr } })()
                            : ''
                        const displayTime = m.time || m.start_time || ''
                        return (
                            <li key={i} style={{ fontSize: 13, color: 'var(--text-primary)', marginBottom: 4 }}>
                                <strong>{m.title || 'Meeting'}</strong>
                                {displayDate ? ` — ${displayDate}` : ''}
                                {displayTime ? ` at ${displayTime}` : ''}
                            </li>
                        )
                    })}
                </ul>

                <div style={{ fontSize: 13, color: 'var(--text-secondary)', marginBottom: 18 }}>
                    What would you like to do?
                </div>
                <div style={{ display: 'flex', gap: 10 }}>
                    <button onClick={onProceed} style={{ flex: 1, padding: '9px 14px', borderRadius: 8, border: 'none', background: 'var(--accent)', color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                        Proceed
                    </button>
                    <button onClick={onReschedule} style={{ flex: 1, padding: '9px 14px', borderRadius: 8, border: '1px solid var(--yellow)', background: 'transparent', color: 'var(--yellow)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                        Reschedule
                    </button>
                    <button onClick={onCancel} style={{ flex: 1, padding: '9px 14px', borderRadius: 8, border: '1px solid var(--red)', background: 'transparent', color: 'var(--red)', fontWeight: 600, fontSize: 13, cursor: 'pointer' }}>
                        Cancel leave
                    </button>
                </div>
            </div>
        </div>
    )
}