/**
 * frontend/src/components/BehaviorAlerts.jsx
 * HR-facing Signals list — mirrors the NameChangeRequests / ApprovalRequests
 * card pattern inside HRPanel.jsx.
 */

import { useState, useEffect, useCallback } from 'react'
import { useBehaviorAlerts } from '../hooks/useBehaviorAlerts'
import AnalyticsOverview from './AnalyticsOverview'

const CATEGORY_META = {
    SENSITIVE:    { color: '#f87171', bg: 'rgba(239,68,68,0.12)',   border: 'rgba(239,68,68,0.3)',   icon: '', label: 'Sensitive' },
    LEAVE_INTENT: { color: '#fbbf24', bg: 'rgba(245,158,11,0.12)',  border: 'rgba(245,158,11,0.3)',  icon: '', label: 'Leave Intent' },
    EXIT_INTENT:  { color: '#f97316', bg: 'rgba(249,115,22,0.12)',  border: 'rgba(249,115,22,0.3)',  icon: '', label: 'Exit Intent' },
    GROWTH:       { color: '#34d399', bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.3)',  icon: '', label: 'Growth' },
    GENERAL:      { color: '#94a3b8', bg: 'rgba(100,116,139,0.12)', border: 'rgba(100,116,139,0.3)', icon: '', label: 'General' },
}

function CategoryBadge({ category }) {
    const m = CATEGORY_META[category] || CATEGORY_META.GENERAL
    return (
        <span style={{
            background: m.bg, color: m.color,
            border: `1px solid ${m.border}`,
            padding: '2px 10px', borderRadius: 20,
            fontSize: 10, fontWeight: 600, letterSpacing: '0.04em',
            display: 'inline-flex', alignItems: 'center', gap: 4,
        }}>
            {m.icon} {m.label}
        </span>
    )
}

function StatusBadge({ status }) {
    const isOpen = status === 'OPEN'
    return (
        <span style={{
            background: isOpen ? 'rgba(79,142,247,0.15)' : 'rgba(16,185,129,0.15)',
            color: isOpen ? '#60a5fa' : '#34d399',
            border: `1px solid ${isOpen ? 'rgba(79,142,247,0.35)' : 'rgba(16,185,129,0.35)'}`,
            padding: '2px 10px', borderRadius: 20,
            fontSize: 10, fontWeight: 600,
        }}>
            {isOpen ? '● Open' : '✓ Resolved'}
        </span>
    )
}

export default function BehaviorAlerts({ token, onAlert }) {
    const {
        alerts, loading, error, loadAlerts, resolveAlert,
        analytics, analyticsLoading, analyticsError, loadAnalytics,
    } = useBehaviorAlerts()
    const [filter, setFilter]       = useState('open')
    const [tab, setTab]             = useState('alerts')   // 'alerts' | 'overview'
    const [noteModal, setNoteModal] = useState(null)  // alert being resolved
    const [noteText, setNoteText]   = useState('')
    const [resolving, setResolving] = useState(null)

    useEffect(() => { loadAlerts(filter) }, [filter])
    useEffect(() => { if (tab === 'overview') loadAnalytics() }, [tab])

    const openCount = alerts.filter(a => a.status === 'OPEN').length

    const handleResolve = async () => {
        if (!noteModal) return
        setResolving(noteModal.id)
        const ok = await resolveAlert(noteModal.id, noteText)
        if (ok) {
            onAlert?.('Alert resolved', 'success')
            loadAlerts(filter)
        } else {
            onAlert?.('Could not resolve alert. Please try again.', 'error')
        }
        setResolving(null)
        setNoteModal(null)
        setNoteText('')
    }

    const fmtDate = iso => iso
        ? new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })
        : '—'

    return (
        <div>
            {/* Resolve note modal */}
            {noteModal && (
                <div style={{ position:'fixed', inset:0, zIndex:9999, background:'rgba(0,0,0,0.6)', backdropFilter:'blur(4px)', display:'flex', alignItems:'center', justifyContent:'center' }}>
                    <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:14, padding:28, maxWidth:420, width:'90%', boxShadow:'0 24px 64px rgba(0,0,0,0.4)' }}>
                        <div style={{ fontSize:15, fontWeight:700, color:'var(--text-primary)', marginBottom:6 }}>✅ Resolve Signal</div>
                        <div style={{ fontSize:12, color:'var(--text-muted)', marginBottom:14 }}>
                            Add an optional HR note (e.g. "Had a 1:1, situation explained").
                        </div>
                        <textarea
                            value={noteText}
                            onChange={e => setNoteText(e.target.value)}
                            placeholder="Optional note…"
                            rows={3}
                            style={{ width:'100%', background:'var(--bg-input)', border:'1px solid var(--border)', borderRadius:8, padding:'9px 12px', color:'var(--text-primary)', fontSize:12, resize:'none', outline:'none', fontFamily:'inherit', boxSizing:'border-box' }}
                        />
                        <div style={{ display:'flex', gap:8, marginTop:14, justifyContent:'flex-end' }}>
                            <button
                                onClick={() => { setNoteModal(null); setNoteText('') }}
                                style={{ padding:'7px 16px', borderRadius:7, border:'1px solid var(--border)', background:'transparent', color:'var(--text-secondary)', fontSize:12, cursor:'pointer', fontFamily:'inherit' }}
                            >Cancel</button>
                            <button
                                onClick={handleResolve}
                                disabled={!!resolving}
                                style={{ padding:'7px 18px', borderRadius:7, border:'none', background:'#059669', color:'#fff', fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit', opacity: resolving ? 0.6 : 1 }}
                            >{resolving ? '…' : 'Confirm'}</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Header */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:14, flexWrap:'wrap', gap:10 }}>
                <div>
                    <h2 style={{ margin:0, fontSize:17, fontWeight:700, color:'var(--text-primary)' }}>
                        Document Activity Signals
                    </h2>
                    <p style={{ margin:'3px 0 0', fontSize:12, color:'var(--text-muted)' }}>
                        Employees showing repeated interest in specific document categories.
                        No action required — these are signals for human review.
                    </p>
                </div>
                <div style={{ display:'flex', gap:8, alignItems:'center' }}>
                    {tab === 'alerts' && [
                        { id:'open',     label: openCount ? `Open (${openCount})` : 'Open' },
                        { id:'resolved', label: 'Resolved' },
                        { id:'all',      label: 'All' },
                    ].map(f => (
                        <button key={f.id} onClick={() => setFilter(f.id)} style={{
                            padding:'5px 14px', borderRadius:20, fontSize:11, fontWeight:500, cursor:'pointer', fontFamily:'inherit',
                            border: `1px solid ${filter === f.id ? 'rgba(79,142,247,0.5)' : 'var(--border)'}`,
                            background: filter === f.id ? 'var(--accent-dim)' : 'transparent',
                            color: filter === f.id ? 'var(--accent)' : 'var(--text-muted)',
                        }}>{f.label}</button>
                    ))}
                    <button
                        onClick={() => tab === 'alerts' ? loadAlerts(filter) : loadAnalytics()}
                        style={{ padding:'5px 12px', borderRadius:8, border:'1px solid var(--border)', background:'transparent', color:'var(--text-muted)', fontSize:11, cursor:'pointer', fontFamily:'inherit' }}
                    >↻ Refresh</button>
                </div>
            </div>

            {/* Alerts / Overview tab toggle */}
            <div style={{ display:'flex', gap:4, marginBottom:18, background:'var(--bg-secondary)', borderRadius:10, padding:4, width:'fit-content' }}>
                {[
                    { id:'alerts',   label: ' Alerts' },
                    { id:'overview', label: ' Overview' },
                ].map(t => (
                    <button key={t.id} onClick={() => setTab(t.id)} style={{
                        padding:'6px 16px', borderRadius:8, fontSize:12, fontWeight:600, cursor:'pointer', fontFamily:'inherit',
                        border:'none',
                        background: tab === t.id ? 'var(--bg-card)' : 'transparent',
                        color: tab === t.id ? 'var(--text-primary)' : 'var(--text-muted)',
                        boxShadow: tab === t.id ? '0 1px 4px rgba(0,0,0,0.15)' : 'none',
                    }}>{t.label}</button>
                ))}
            </div>

            {tab === 'overview' ? (
                <AnalyticsOverview analytics={analytics} loading={analyticsLoading} error={analyticsError} />
            ) : (
            <>
            {/* Content */}
            {loading ? (
                <div style={{ textAlign:'center', padding:60, color:'var(--text-muted)', fontSize:13 }}> Loading signals…</div>
            ) : error ? (
                <div style={{ textAlign:'center', padding:60, color:'#f87171', fontSize:13 }}>❌ {error}</div>
            ) : alerts.length === 0 ? (
                <div style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:'48px 24px', textAlign:'center' }}>
                    <div style={{ fontSize:32, marginBottom:12 }}>📊</div>
                    <div style={{ fontSize:14, fontWeight:600, color:'var(--text-primary)', marginBottom:4 }}>No {filter === 'all' ? '' : filter} signals</div>
                    <div style={{ fontSize:12, color:'var(--text-muted)' }}>
                        Signals appear when employees repeatedly access documents in sensitive categories.
                    </div>
                </div>
            ) : (
                <div style={{ display:'flex', flexDirection:'column', gap:10 }}>
                    {alerts.map(a => (
                        <div key={a.id} style={{ background:'var(--bg-card)', border:'1px solid var(--border)', borderRadius:12, padding:'16px 20px' }}>
                            <div style={{ display:'flex', alignItems:'flex-start', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>

                                {/* Left: employee + signal info */}
                                <div style={{ flex:1, minWidth:220 }}>
                                    <div style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                                        <div style={{ width:32, height:32, borderRadius:'50%', background:'var(--accent-dim)', color:'var(--accent)', display:'flex', alignItems:'center', justifyContent:'center', fontSize:13, fontWeight:700, flexShrink:0 }}>
                                            {(a.employee_name || '?')[0].toUpperCase()}
                                        </div>
                                        <div>
                                            <div style={{ fontSize:13, fontWeight:600, color:'var(--text-primary)' }}>{a.employee_name}</div>
                                            <div style={{ fontSize:11, color:'var(--text-muted)' }}>{a.employee_email}</div>
                                        </div>
                                        <CategoryBadge category={a.category} />
                                        <StatusBadge status={a.status} />
                                    </div>

                                    <div style={{ fontSize:12, color:'var(--text-secondary)', display:'flex', flexWrap:'wrap', gap:'4px 20px' }}>
                                        <span>
                                            <span style={{ color:'var(--text-muted)' }}>Accesses: </span>
                                            <strong style={{ color:'var(--text-primary)' }}>{a.score}</strong>
                                            <span style={{ color:'var(--text-muted)' }}> in {a.window_days}d window</span>
                                        </span>
                                        <span>
                                            <span style={{ color:'var(--text-muted)' }}>Triggered: </span>
                                            <strong style={{ color:'var(--text-primary)' }}>{a.trigger_count}×</strong>
                                        </span>
                                        <span style={{ color:'var(--text-muted)' }}>
                                            Last: {fmtDate(a.last_triggered_at)}
                                        </span>
                                    </div>

                                    <div style={{ marginTop:6, fontSize:12, display:'flex', alignItems:'center', gap:6 }}>
                                        <span style={{ color:'var(--text-muted)' }}>Document:</span>
                                        <span style={{
                                            color: a.last_filename ? 'var(--text-primary)' : 'var(--text-muted)',
                                            fontWeight: a.last_filename ? 600 : 400,
                                            fontStyle: a.last_filename ? 'normal' : 'italic',
                                        }}>
                                            {a.last_filename || 'Unknown document'}
                                        </span>
                                    </div>

                                    {a.hr_note && (
                                        <div style={{ marginTop:8, fontSize:11, color:'var(--text-muted)', background:'var(--bg-secondary)', padding:'5px 10px', borderRadius:6, borderLeft:'3px solid var(--border)' }}>
                                            Note: {a.hr_note}
                                        </div>
                                    )}
                                </div>

                                {/* Right: action */}
                                <div style={{ display:'flex', alignItems:'center', gap:8, flexShrink:0 }}>
                                    {a.status === 'OPEN' && (
                                        <button
                                            onClick={() => { setNoteModal(a); setNoteText('') }}
                                            style={{ padding:'6px 14px', borderRadius:7, border:'1px solid rgba(16,185,129,0.3)', background:'rgba(16,185,129,0.1)', color:'#10b981', fontSize:11, fontWeight:500, cursor:'pointer', fontFamily:'inherit', transition:'all 0.15s' }}
                                            onMouseEnter={e => e.currentTarget.style.background = 'rgba(16,185,129,0.2)'}
                                            onMouseLeave={e => e.currentTarget.style.background = 'rgba(16,185,129,0.1)'}
                                        >✅ Resolve</button>
                                    )}
                                    {a.status === 'RESOLVED' && (
                                        <span style={{ fontSize:12, color:'#34d399', fontWeight:500 }}>✓ Resolved</span>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
            </>
            )}
        </div>
    )
}