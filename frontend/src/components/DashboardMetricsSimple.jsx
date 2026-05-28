// frontend/src/components/DashboardMetricsSimple.jsx
import { useState, useEffect } from 'react'

export default function DashboardMetricsSimple({ employees = [], token, onNavigate }) {
    const [pendingLeaves, setPendingLeaves] = useState([])
    const [drilldown, setDrilldown] = useState(null) // null | 'incomplete' | 'complete' | 'leaves' | 'departments'
    const [selectedDept, setSelectedDept] = useState(null)

    useEffect(() => {
        if (!token) return
        fetch('/api/leaves/pending', { headers: { Authorization: `Bearer ${token}` } })
            .then(res => res.json())
            .then(data => setPendingLeaves(data))
            .catch(() => { })
    }, [token])

    // --- Dynamic Metrics Math ---
    const totalEmployees = employees.length
    const pendingLeavesCount = pendingLeaves.length

    // Profile Completion Breakdown
    const incompleteProfiles = employees.filter(e => (e.profile_completion_percentage || 0) < 100)
    const completeProfiles = employees.filter(e => (e.profile_completion_percentage || 0) === 100)
    
    const incompleteCount = incompleteProfiles.length
    const completeCount = completeProfiles.length
    const avgCompletion = totalEmployees 
        ? Math.round(employees.reduce((acc, e) => acc + (e.profile_completion_percentage || 0), 0) / totalEmployees)
        : 0

    // Department Grouping logic
    const departmentGroups = employees.reduce((acc, emp) => {
        const dept = emp.department || 'General Operational'
        if (!acc[dept]) acc[dept] = []
        acc[dept].push(emp)
        return acc
    }, {})

    const departmentList = Object.keys(departmentGroups).map(name => ({
        name,
        count: departmentGroups[name].length,
        employees: departmentGroups[name]
    }))

    // SVG Circular Donut Math Parameters
    const radius = 50
    const circumference = 2 * Math.PI * radius
    const completeStrokeOffset = circumference - (completeCount / (totalEmployees || 1)) * circumference
    const incompleteStrokeOffset = circumference - (incompleteCount / (totalEmployees || 1)) * circumference

    // Helper badge maps
    const getStatusStyle = (pct) => {
        if (pct === 100) return { bg: 'rgba(16,185,129,0.12)', color: 'var(--green)', border: '1px solid rgba(16,185,129,0.2)' }
        if (pct > 0) return { bg: 'rgba(245,158,11,0.12)', color: 'var(--yellow)', border: '1px solid rgba(245,158,11,0.2)' }
        return { bg: 'rgba(239,68,68,0.12)', color: 'var(--red)', border: '1px solid rgba(239,68,68,0.2)' }
    }

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '28px', width: '100%', fontFamily: 'inherit' }}>
            
            {/* ── TOP LAYER MACRO KPI STAT CARDS ── */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '20px' }}>
                
                <div 
                    onClick={() => { setDrilldown(drilldown === 'complete' ? null : 'complete'); setSelectedDept(null); }}
                    style={{ ...S.kpiCard, ...(drilldown === 'complete' ? S.kpiCardActive : {}) }}
                >
                    <div style={S.kpiMeta}>Fully Onboarded</div>
                    <div style={S.kpiValueGroup}>
                        <div style={S.kpiNumber}>{completeCount}</div>
                        <span style={{ ...S.kpiPill, background: 'var(--green-dim)', color: 'var(--green)' }}>
                            {totalEmployees ? Math.round((completeCount / totalEmployees) * 100) : 0}%
                        </span>
                    </div>
                </div>

                <div 
                    onClick={() => { setDrilldown(drilldown === 'incomplete' ? null : 'incomplete'); setSelectedDept(null); }}
                    style={{ ...S.kpiCard, ...(drilldown === 'incomplete' ? S.kpiCardActive : {}) }}
                >
                    <div style={S.kpiMeta}>Profiles </div>
                    <div style={S.kpiValueGroup}>
                        <div style={S.kpiNumber}>{incompleteCount}</div>
                        <span style={{ ...S.kpiPill, background: 'var(--yellow-dim)', color: 'var(--yellow)' }}>
                            Avg {avgCompletion}%
                        </span>
                    </div>
                </div>

                <div 
                    onClick={() => { setDrilldown(drilldown === 'leaves' ? null : 'leaves'); setSelectedDept(null); }}
                    style={{ ...S.kpiCard, ...(drilldown === 'leaves' ? S.kpiCardActive : {}) }}
                >
                    <div style={S.kpiMeta}>Pending Leave Queue</div>
                    <div style={S.kpiValueGroup}>
                        <div style={S.kpiNumber}>{pendingLeavesCount}</div>
                        {pendingLeavesCount > 0 && (
                            <span style={{ ...S.kpiPill, background: 'var(--red-dim)', color: 'var(--red)' }}>Attention</span>
                        )}
                    </div>
                </div>

                <div 
                    onClick={() => { setDrilldown(drilldown === 'departments' ? null : 'departments'); setSelectedDept(null); }}
                    style={{ ...S.kpiCard, ...(drilldown === 'departments' ? S.kpiCardActive : {}) }}
                >
                    <div style={S.kpiMeta}>Active Departments</div>
                    <div style={S.kpiValueGroup}>
                        <div style={S.kpiNumber}>{departmentList.length}</div>
                        <span style={{ ...S.kpiPill, background: 'var(--accent-dim)', color: 'var(--accent)' }}>Total Corp</span>
                    </div>
                </div>

            </div>

            {/* ── MIDDLE ANALYTICS DEEP DIVE BLOCK ── */}
            <div style={S.chartLayoutGrid}>
                
                {/* Visual Donut Distribution Map */}
                <div style={S.visualChartContainer}>
                    <div style={S.panelHeader}>Onboarding Allocation</div>
                    <div style={S.donutCanvasCenter}>
                        <svg width="160" height="160" viewBox="0 0 120 120" style={{ transform: 'rotate(-90deg)' }}>
                            {/* Track Circle background track */}
                            <circle cx="60" cy="60" r={radius} fill="transparent" stroke="var(--border)" strokeWidth="10" />
                            
                            {/* Complete Segment */}
                            {completeCount > 0 && (
                                <circle 
                                    cx="60" cy="60" r={radius} fill="transparent" 
                                    stroke="var(--green)" strokeWidth="10"
                                    strokeDasharray={circumference} strokeDashoffset={completeStrokeOffset}
                                    strokeLinecap="round" style={{ transition: 'stroke-dashoffset 0.5s ease' }}
                                />
                            )}
                            
                            {/* Incomplete Segment */}
                            {incompleteCount > 0 && (
                                <circle 
                                    cx="60" cy="60" r={radius} fill="transparent" 
                                    stroke="var(--yellow)" strokeWidth="10"
                                    strokeDasharray={circumference} strokeDashoffset={incompleteStrokeOffset}
                                    strokeLinecap="round"
                                    style={{ 
                                        transition: 'stroke-dashoffset 0.5s ease',
                                        transform: `rotate(${(completeCount / (totalEmployees || 1)) * 360}deg)`,
                                        transformOrigin: '60px 60px'
                                    }}
                                />
                            )}
                        </svg>
                        
                        <div style={S.donutAbsoluteLabel}>
                            <div style={{ fontSize: '22px', fontWeight: '800', color: 'var(--text-primary)' }}>{totalEmployees}</div>
                            <div style={{ fontSize: '10px', color: 'var(--text-muted)', textTransform: 'uppercase' }}>Staff</div>
                        </div>
                    </div>

                    {/* Integrated Interactive Legend */}
                    <div style={S.legendBoxContainer}>
                        <div style={S.legendRowItem} onClick={() => setDrilldown('complete')}>
                            <div style={{ ...S.legendDotIndicator, background: 'var(--green)' }} />
                            <span style={S.legendTextSpan}>Complete Records ({completeCount})</span>
                        </div>
                        <div style={S.legendRowItem} onClick={() => setDrilldown('incomplete')}>
                            <div style={{ ...S.legendDotIndicator, background: 'var(--yellow)' }} />
                            <span style={S.legendTextSpan}>Incomplete Records ({incompleteCount})</span>
                        </div>
                    </div>
                </div>

                {/* Department Matrix Dashboard Map */}
                <div style={S.visualChartContainer}>
                    <div style={S.panelHeader}>Organizational Segments Grid</div>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px', marginTop: '4px' }}>
                        {departmentList.map(dept => (
                            <div 
                                key={dept.name}
                                onClick={() => { setDrilldown('departments'); setSelectedDept(dept.name); }}
                                style={{
                                    ...S.departmentMicroCard,
                                    borderColor: selectedDept === dept.name ? 'var(--accent)' : 'var(--border)',
                                    background: selectedDept === dept.name ? 'var(--accent-dim)' : 'var(--bg-secondary)'
                                }}
                            >
                                <div style={{ fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)' }}>{dept.name}</div>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '4px' }}>{dept.count} Members registered</div>
                            </div>
                        ))}
                    </div>
                </div>

            </div>

            {/* ── LOWER SECTION DETAILED TARGET DRILLDOWN MATRIX VIEWPORTS ── */}
            {drilldown && (
                <div style={S.drilldownWrapperPanel}>
                    <div style={S.drilldownHeadingRow}>
                        <h4 style={S.drilldownTitleText}>
                            ⚡ Operational View: {drilldown.toUpperCase()} 
                            {selectedDept ? ` — (${selectedDept})` : ''}
                        </h4>
                        <button style={S.closeActionBtn} onClick={() => { setDrilldown(null); setSelectedDept(null); }}>
                            ✕ Dismiss Table
                        </button>
                    </div>

                    <div style={S.tableViewportContainer}>
                        
                        {/* Dynamic Leaf Requests Subset Table Viewport */}
                        {drilldown === 'leaves' && (
                            <table style={S.masterTableLayout}>
                                <thead style={S.tableHeadSection}>
                                    <tr>
                                        <th style={S.thCell}>Employee Record</th>
                                        <th style={S.thCell}>Leave Type</th>
                                        <th style={S.thCell}>Schedule Range</th>
                                        <th style={S.thCell}>Reason Context</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {pendingLeaves.length === 0 ? (
                                        <tr><td colSpan="4" style={S.emptyCell}>No pending leave approvals detected in system.</td></tr>
                                    ) : pendingLeaves.map(l => (
                                        <tr key={l.id} style={S.trHoverRow}>
                                            <td style={{ ...S.tdCell, fontWeight: 500 }}>{l.employee_name || `ID: ${l.employee_id}`}</td>
                                            <td style={S.tdCell}><span style={S.genericTableBadge}>{l.leave_type}</span></td>
                                            <td style={S.tdCell}>{l.start_date} → {l.end_date}</td>
                                            <td style={{ ...S.tdCell, color: 'var(--text-secondary)', fontSize: '12.5px' }}>{l.reason || 'No description assigned.'}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}

                        {/* Standard Employee Attributes Metric Dynamic Drilldown Table */}
                        {(drilldown === 'complete' || drilldown === 'incomplete' || drilldown === 'departments') && (
                            <table style={S.masterTableLayout}>
                                <thead style={S.tableHeadSection}>
                                    <tr>
                                        <th style={S.thCell}>Registered Profile</th>
                                        <th style={S.thCell}>Assigned Section</th>
                                        <th style={S.thCell}>Designation Role</th>
                                        <th style={S.thCell}>Onboarding Tracking Status</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {(employees.filter(e => {
                                        if (drilldown === 'complete') return e.profile_completion_percentage === 100
                                        if (drilldown === 'incomplete') return (e.profile_completion_percentage || 0) < 100
                                        if (drilldown === 'departments' && selectedDept) return (e.department || 'General Operational') === selectedDept
                                        return true
                                    })).length === 0 ? (
                                        <tr><td colSpan="4" style={S.emptyCell}>No active employee criteria metrics match this slice parameters.</td></tr>
                                    ) : employees.filter(e => {
                                        if (drilldown === 'complete') return e.profile_completion_percentage === 100
                                        if (drilldown === 'incomplete') return (e.profile_completion_percentage || 0) < 100
                                        if (drilldown === 'departments' && selectedDept) return (e.department || 'General Operational') === selectedDept
                                        return true
                                    }).map(e => (
                                        <tr key={e.id} style={S.trHoverRow}>
                                            <td style={S.tdCell}>
                                                <div style={{ fontWeight: 600, color: 'var(--text-primary)' }}>{e.name}</div>
                                                <div style={{ fontSize: '11.5px', color: 'var(--text-muted)' }}>{e.email}</div>
                                            </td>
                                            <td style={S.tdCell}>{e.department || 'General Operational'}</td>
                                            <td style={S.tdCell}>{e.role || 'Associate'}</td>
                                            <td style={S.tdCell}>
                                                <span style={{
                                                    padding: '4px 10px', borderRadius: '100px', fontSize: '11.5px', fontWeight: '600',
                                                    ...getStatusStyle(e.profile_completion_percentage || 0)
                                                }}>
                                                    {e.profile_completion_percentage || 0}% Done
                                                </span>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        )}

                    </div>
                </div>
            )}

        </div>
    )
}

// ── EXPLICIT SYSTEM STYLING CONFIGURATION SCHEMAS ──
const S = {
    kpiCard: {
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '16px',
        padding: '20px',
        boxShadow: '0 1px 3px 0 rgba(0,0,0,0.05)',
        cursor: 'pointer',
        transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
        userSelect: 'none'
    },
    kpiCardActive: {
        borderColor: 'var(--accent)',
        boxShadow: '0 0 0 3px var(--accent-glow)',
        transform: 'translateY(-1px)'
    },
    kpiMeta: {
        fontSize: '11px',
        fontWeight: '700',
        color: 'var(--text-muted)',
        textTransform: 'uppercase',
        letterSpacing: '0.8px'
    },
    kpiValueGroup: {
        display: 'flex',
        alignItems: 'baseline',
        justifyContent: 'space-between',
        marginTop: '10px'
    },
    kpiNumber: {
        fontSize: '30px',
        fontWeight: '800',
        color: 'var(--text-primary)',
        letterSpacing: '-0.02em'
    },
    kpiPill: {
        fontSize: '11px',
        fontWeight: '600',
        padding: '3px 9px',
        borderRadius: '100px'
    },
    chartLayoutGrid: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(320px, 1fr))',
        gap: '24px'
    },
    visualChartContainer: {
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '16px',
        padding: '24px',
        display: 'flex',
        flexDirection: 'column',
        minHeight: '270px'
    },
    panelHeader: {
        fontSize: '14px',
        fontWeight: '700',
        color: 'var(--text-primary)',
        marginBottom: '16px'
    },
    donutCanvasCenter: {
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        flex: 1
    },
    donutAbsoluteLabel: {
        position: 'absolute',
        textAlign: 'center',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center'
    },
    legendBoxContainer: {
        display: 'flex',
        justifyContent: 'center',
        gap: '16px',
        marginTop: '16px',
        flexWrap: 'wrap'
    },
    legendRowItem: {
        display: 'flex',
        alignItems: 'center',
        gap: '8px',
        cursor: 'pointer'
    },
    legendDotIndicator: {
        width: '10px',
        height: '10px',
        borderRadius: '50%'
    },
    legendTextSpan: {
        fontSize: '12px',
        color: 'var(--text-secondary)',
        fontWeight: '500'
    },
    departmentMicroCard: {
        border: '1px solid var(--border)',
        borderRadius: '12px',
        padding: '14px',
        cursor: 'pointer',
        transition: 'all 0.15s ease'
    },
    drilldownWrapperPanel: {
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: '16px',
        padding: '20px',
        animation: 'fadeIn 0.2s ease-out'
    },
    drilldownHeadingRow: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        marginBottom: '16px',
        paddingBottom: '10px',
        borderBottom: '1px solid var(--border)'
    },
    drilldownTitleText: {
        margin: 0,
        fontSize: '14px',
        fontWeight: '700',
        color: 'var(--text-primary)',
        letterSpacing: '0.2px'
    },
    closeActionBtn: {
        background: 'transparent',
        border: 'none',
        color: 'var(--text-muted)',
        fontSize: '12px',
        cursor: 'pointer',
        fontWeight: '500'
    },
    tableViewportContainer: {
        width: '100%',
        overflowX: 'auto',
        borderRadius: '8px',
        border: '1px solid var(--border)'
    },
    masterTableLayout: {
        width: '100%',
        borderCollapse: 'collapse',
        textAlign: 'left',
        fontSize: '13px'
    },
    tableHeadSection: {
        background: 'var(--bg-secondary)',
        borderBottom: '1px solid var(--border)'
    },
    thCell: {
        padding: '12px 16px',
        fontWeight: '600',
        color: 'var(--text-muted)',
        fontSize: '11px',
        textTransform: 'uppercase',
        letterSpacing: '0.5px'
    },
    trHoverRow: {
        borderBottom: '1px solid var(--border)',
        background: 'var(--bg-card)'
    },
    tdCell: {
        padding: '12px 16px',
        color: 'var(--text-primary)'
    },
    emptyCell: {
        padding: '32px',
        textAlign: 'center',
        color: 'var(--text-muted)'
    },
    genericTableBadge: {
        background: 'var(--accent-dim)',
        color: 'var(--accent)',
        padding: '2px 8px',
        borderRadius: '4px',
        fontSize: '11.5px',
        fontWeight: '500'
    }
}