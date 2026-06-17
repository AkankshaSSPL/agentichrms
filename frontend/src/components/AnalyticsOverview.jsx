/**
 * frontend/src/components/AnalyticsOverview.jsx
 * Read-only analytics dashboard — stat cards + charts.
 * Polished: hover lifts, fade-in stagger, smooth transitions,
 * rich dark tooltips, animated spinner, consistent colour system.
 */

import { useEffect, useRef, useState } from 'react'

// ── Design tokens ─────────────────────────────────────────────────────────────

const CATEGORY_COLORS = {
    SENSITIVE:    '#f87171',
    LEAVE_INTENT: '#fbbf24',
    EXIT_INTENT:  '#f97316',
    GROWTH:       '#34d399',
    GENERAL:      '#94a3b8',
}

const CATEGORY_LABELS = {
    SENSITIVE:    'Sensitive',
    LEAVE_INTENT: 'Leave Intent',
    EXIT_INTENT:  'Exit Intent',
    GROWTH:       'Growth',
    GENERAL:      'General',
}

const EMPLOYEE_PALETTE = [
    { base: '#f87171', light: '#fca5a5' },
    { base: '#60a5fa', light: '#93c5fd' },
    { base: '#34d399', light: '#6ee7b7' },
    { base: '#fbbf24', light: '#fcd34d' },
    { base: '#a78bfa', light: '#c4b5fd' },
    { base: '#f472b6', light: '#f9a8d4' },
    { base: '#38bdf8', light: '#7dd3fc' },
    { base: '#fb923c', light: '#fdba74' },
]

// Shared dark tooltip config for every Chart.js instance
const TOOLTIP = {
    enabled: true,
    backgroundColor: 'rgba(15,17,26,0.96)',
    titleColor: '#f1f5f9',
    bodyColor: '#94a3b8',
    borderColor: 'rgba(255,255,255,0.1)',
    borderWidth: 1,
    padding: 12,
    cornerRadius: 10,
    displayColors: false,
    titleFont: { size: 12, weight: '600', family: 'inherit' },
    bodyFont: { size: 12, family: 'inherit' },
}

// ── Keyframes injected once ───────────────────────────────────────────────────

function injectStyles() {
    if (document.getElementById('ao-styles')) return
    const el = document.createElement('style')
    el.id = 'ao-styles'
    el.textContent = `
        @keyframes ao-fadein {
            from { opacity: 0; transform: translateY(8px); }
            to   { opacity: 1; transform: translateY(0); }
        }
        @keyframes ao-spin {
            to { transform: rotate(360deg); }
        }
        .ao-card {
            transition: border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
        }
        .ao-card:hover {
            border-color: rgba(79,142,247,0.4) !important;
            transform: translateY(-2px);
            box-shadow: 0 8px 24px rgba(0,0,0,0.25);
        }
        .ao-legend-item {
            cursor: default;
            padding: 2px 6px;
            border-radius: 6px;
            transition: background 0.15s ease;
        }
        .ao-legend-item:hover {
            background: rgba(255,255,255,0.06);
        }
    `
    document.head.appendChild(el)
}

// ── Chart.js loader ───────────────────────────────────────────────────────────

function ensureChartJs() {
    return new Promise((resolve, reject) => {
        if (window.Chart) return resolve(window.Chart)
        const existing = document.querySelector('script[data-chartjs-loader]')
        if (existing) {
            existing.addEventListener('load', () => resolve(window.Chart))
            existing.addEventListener('error', reject)
            return
        }
        const s = document.createElement('script')
        s.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js'
        s.setAttribute('data-chartjs-loader', 'true')
        s.onload = () => resolve(window.Chart)
        s.onerror = reject
        document.head.appendChild(s)
    })
}

// ── StatCard ──────────────────────────────────────────────────────────────────

function StatCard({ label, value, suffix, index = 0 }) {
    injectStyles()
    return (
        <div
            className="ao-card"
            style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 12,
                padding: '16px 18px',
                animation: `ao-fadein 0.4s ease both`,
                animationDelay: `${index * 60}ms`,
            }}
        >
            <div style={{
                fontSize: 11, color: 'var(--text-muted)',
                marginBottom: 8, letterSpacing: '0.04em', textTransform: 'uppercase',
            }}>
                {label}
            </div>
            <div style={{ fontSize: 26, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1 }}>
                {value}
                {suffix
                    ? <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-muted)', marginLeft: 4 }}>{suffix}</span>
                    : null}
            </div>
        </div>
    )
}

// ── ChartCard ─────────────────────────────────────────────────────────────────

function ChartCard({ title, children, height = 200, delay = 0 }) {
    injectStyles()
    return (
        <div
            className="ao-card"
            style={{
                background: 'var(--bg-card)',
                border: '1px solid var(--border)',
                borderRadius: 14,
                padding: '18px 20px',
                animation: `ao-fadein 0.45s ease both`,
                animationDelay: `${delay}ms`,
            }}
        >
            <div style={{
                fontSize: 13, fontWeight: 600,
                color: 'var(--text-primary)',
                marginBottom: 14, letterSpacing: '-0.01em',
            }}>
                {title}
            </div>
            <div style={{ position: 'relative', height, maxWidth: '100%' }}>
                {children}
            </div>
        </div>
    )
}

// ── CategoryPie ───────────────────────────────────────────────────────────────

function CategoryPie({ data }) {
    const canvasRef = useRef(null)
    const chartRef  = useRef(null)
    const [hovered, setHovered] = useState(null)

    useEffect(() => {
        let cancelled = false
        ensureChartJs().then(Chart => {
            if (cancelled || !canvasRef.current) return
            if (chartRef.current) chartRef.current.destroy()

            const labels = data.map(d => CATEGORY_LABELS[d.category] || d.category)
            const values = data.map(d => d.count)
            const colors = data.map(d => CATEGORY_COLORS[d.category] || '#94a3b8')

            chartRef.current = new Chart(canvasRef.current, {
                type: 'doughnut',
                data: {
                    labels,
                    datasets: [{
                        data: values,
                        backgroundColor: colors.map(c => c + 'cc'),
                        hoverBackgroundColor: colors,
                        borderWidth: 2,
                        borderColor: 'rgba(0,0,0,0.3)',
                        hoverOffset: 8,
                    }],
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    cutout: '74%',
                    animation: { duration: 600, easing: 'easeOutQuart' },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            ...TOOLTIP,
                            callbacks: {
                                title: items => CATEGORY_LABELS[data[items[0].dataIndex]?.category] || items[0].label,
                                label: item => `${item.raw} alert${item.raw === 1 ? '' : 's'}`,
                            },
                        },
                    },
                },
            })
        })
        return () => { cancelled = true; chartRef.current?.destroy() }
    }, [data])

    if (!data.length) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 12 }}>
                No open alerts to chart
            </div>
        )
    }

    const total = data.reduce((s, d) => s + d.count, 0)

    return (
        <>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                {data.map((d, i) => (
                    <span
                        key={d.category}
                        className="ao-legend-item"
                        onMouseEnter={() => setHovered(i)}
                        onMouseLeave={() => setHovered(null)}
                        style={{
                            display: 'flex', alignItems: 'center', gap: 5,
                            fontSize: 11, color: hovered === i ? 'var(--text-primary)' : 'var(--text-muted)',
                            transition: 'color 0.15s',
                        }}
                    >
                        <span style={{
                            width: 8, height: 8, borderRadius: 2,
                            background: CATEGORY_COLORS[d.category] || '#94a3b8',
                            opacity: hovered === null || hovered === i ? 1 : 0.4,
                            transition: 'opacity 0.15s',
                        }} />
                        {CATEGORY_LABELS[d.category] || d.category}
                        <span style={{ color: CATEGORY_COLORS[d.category], fontWeight: 600 }}>
                            {Math.round((d.count / total) * 100)}%
                        </span>
                    </span>
                ))}
            </div>
            <div style={{ width: '100%', maxWidth: 180, height: 'calc(100% - 36px)', margin: '0 auto' }}>
                <canvas ref={canvasRef} role="img" aria-label="Donut chart of open alerts by category" />
            </div>
        </>
    )
}

// ── VolumeLine ────────────────────────────────────────────────────────────────

function VolumeLine({ data }) {
    const canvasRef = useRef(null)
    const chartRef  = useRef(null)

    useEffect(() => {
        let cancelled = false
        ensureChartJs().then(Chart => {
            if (cancelled || !canvasRef.current) return
            if (chartRef.current) chartRef.current.destroy()

            const labels = data.map(d =>
                new Date(d.date).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
            )

            chartRef.current = new Chart(canvasRef.current, {
                type: 'line',
                data: {
                    labels,
                    datasets: [
                        {
                            label: 'Chat',
                            data: data.map(d => d.chat),
                            borderColor: '#7c3aed',
                            backgroundColor: 'rgba(124,58,237,0.08)',
                            borderWidth: 2,
                            fill: true, tension: 0.4,
                            pointRadius: 4, pointHoverRadius: 6,
                            pointBackgroundColor: '#7c3aed',
                            pointBorderColor: 'rgba(124,58,237,0.3)',
                            pointBorderWidth: 3,
                            pointHoverBorderWidth: 0,
                        },
                        {
                            label: 'Viewer',
                            data: data.map(d => d.viewer),
                            borderColor: '#34d399',
                            backgroundColor: 'rgba(52,211,153,0.07)',
                            borderWidth: 2,
                            fill: true, tension: 0.4,
                            pointRadius: 4, pointHoverRadius: 6,
                            pointBackgroundColor: '#34d399',
                            pointBorderColor: 'rgba(52,211,153,0.3)',
                            pointBorderWidth: 3,
                            pointHoverBorderWidth: 0,
                            borderDash: [5, 3],
                        },
                    ],
                },
                options: {
                    responsive: true, maintainAspectRatio: false,
                    animation: { duration: 600, easing: 'easeOutQuart' },
                    interaction: { mode: 'index', intersect: false },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            ...TOOLTIP,
                            mode: 'index',
                            callbacks: {
                                label: item => `${item.dataset.label}: ${item.raw}`,
                            },
                        },
                    },
                    scales: {
                        x: {
                            ticks: { autoSkip: true, maxRotation: 0, font: { size: 10 }, color: '#64748b' },
                            grid: { display: false },
                            border: { color: 'rgba(255,255,255,0.06)' },
                        },
                        y: {
                            beginAtZero: true,
                            suggestedMax: Math.max(4, ...data.map(d => Math.max(d.chat, d.viewer))),
                            ticks: { font: { size: 10 }, precision: 0, maxTicksLimit: 5, color: '#64748b' },
                            grid: { color: 'rgba(255,255,255,0.04)' },
                            border: { display: false },
                        },
                    },
                },
            })
        })
        return () => { cancelled = true; chartRef.current?.destroy() }
    }, [data])

    if (!data.length) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 12 }}>
                No access activity in this window
            </div>
        )
    }

    return (
        <>
            <div style={{ display: 'flex', gap: 16, marginBottom: 12, fontSize: 11 }}>
                {[
                    { color: '#7c3aed', label: 'Chat', solid: true },
                    { color: '#34d399', label: 'Viewer', solid: false },
                ].map(({ color, label, solid }) => (
                    <span key={label} className="ao-legend-item" style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--text-muted)' }}>
                        <svg width="20" height="8">
                            {solid
                                ? <line x1="0" y1="4" x2="20" y2="4" stroke={color} strokeWidth="2" />
                                : <line x1="0" y1="4" x2="20" y2="4" stroke={color} strokeWidth="2" strokeDasharray="5,3" />
                            }
                            <circle cx="10" cy="4" r="3" fill={color} />
                        </svg>
                        {label}
                    </span>
                ))}
            </div>
            <canvas ref={canvasRef} role="img" aria-label="Line chart of daily document access volume" style={{ height: 'calc(100% - 32px)' }} />
        </>
    )
}

// ── TopEmployeesBar ───────────────────────────────────────────────────────────

function TopEmployeesBar({ data }) {
    const canvasRef = useRef(null)
    const chartRef  = useRef(null)

    useEffect(() => {
        let cancelled = false
        ensureChartJs().then(Chart => {
            if (cancelled || !canvasRef.current) return
            if (chartRef.current) chartRef.current.destroy()

            const ctx = canvasRef.current.getContext('2d')
            const palette = data.map((_, i) => EMPLOYEE_PALETTE[i % EMPLOYEE_PALETTE.length])

            const gradients = palette.map(c => {
                const g = ctx.createLinearGradient(0, 0, canvasRef.current.width || 400, 0)
                g.addColorStop(0, c.base + '66')
                g.addColorStop(1, c.base)
                return g
            })
            const hoverGradients = palette.map(c => {
                const g = ctx.createLinearGradient(0, 0, canvasRef.current.width || 400, 0)
                g.addColorStop(0, c.light + '88')
                g.addColorStop(1, c.light)
                return g
            })

            chartRef.current = new Chart(ctx, {
                type: 'bar',
                data: {
                    labels: data.map(d => d.employee_name),
                    datasets: [{
                        label: 'Accesses',
                        data: data.map(d => d.count),
                        backgroundColor: gradients,
                        hoverBackgroundColor: hoverGradients,
                        borderRadius: 8,
                        borderSkipped: false,
                        barThickness: 22,
                        maxBarThickness: 26,
                    }],
                },
                options: {
                    indexAxis: 'y',
                    responsive: true, maintainAspectRatio: false,
                    animation: { duration: 700, easing: 'easeOutQuart' },
                    hover: { animationDuration: 200 },
                    plugins: {
                        legend: { display: false },
                        tooltip: {
                            ...TOOLTIP,
                            callbacks: {
                                title: items => items[0]?.label || '',
                                label: item => `${item.raw} access${item.raw === 1 ? '' : 'es'}`,
                            },
                        },
                    },
                    scales: {
                        x: {
                            beginAtZero: true,
                            suggestedMax: Math.max(4, ...data.map(d => d.count)),
                            ticks: { font: { size: 11 }, precision: 0, maxTicksLimit: 5, color: '#64748b' },
                            grid: { color: 'rgba(255,255,255,0.04)' },
                            border: { display: false },
                        },
                        y: {
                            ticks: { font: { size: 12 }, color: '#94a3b8' },
                            grid: { display: false },
                            border: { display: false },
                        },
                    },
                },
            })
        })
        return () => { cancelled = true; chartRef.current?.destroy() }
    }, [data])

    if (!data.length) {
        return (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: 12 }}>
                No accesses in this window
            </div>
        )
    }

    return <canvas ref={canvasRef} role="img" aria-label="Horizontal bar chart of top employees by document access count" style={{ cursor: 'crosshair' }} />
}

// ── Loading spinner ───────────────────────────────────────────────────────────

function Spinner() {
    injectStyles()
    return (
        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 60, gap: 16 }}>
            <div style={{
                width: 36, height: 36, borderRadius: '50%',
                border: '3px solid rgba(255,255,255,0.08)',
                borderTopColor: 'var(--accent, #4f8ef7)',
                animation: 'ao-spin 0.8s linear infinite',
            }} />
            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Loading analytics…</div>
        </div>
    )
}

// ── Error card ────────────────────────────────────────────────────────────────

function ErrorCard({ message }) {
    return (
        <div style={{
            margin: '32px auto', maxWidth: 420,
            background: 'rgba(248,113,113,0.06)',
            border: '1px solid rgba(248,113,113,0.2)',
            borderRadius: 14, padding: '24px 28px',
            textAlign: 'center',
        }}>
            <div style={{ fontSize: 28, marginBottom: 10 }}>⚠️</div>
            <div style={{ fontSize: 14, fontWeight: 600, color: '#f87171', marginBottom: 6 }}>Could not load analytics</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{message}</div>
        </div>
    )
}

// ── Root export ───────────────────────────────────────────────────────────────

export default function AnalyticsOverview({ analytics, loading, error }) {
    injectStyles()

    if (loading) return <Spinner />
    if (error)   return <ErrorCard message={error} />
    if (!analytics) return null

    const { stats, by_category, daily_volume, top_employees } = analytics

    return (
        <div style={{ animation: 'ao-fadein 0.35s ease both' }}>
            {/* Stat cards */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))',
                gap: 12, marginBottom: 16,
            }}>
                <StatCard index={0} label="Open alerts"                        value={stats.open_alerts} />
                <StatCard index={1} label="Resolved (30d)"                     value={stats.resolved_30d} />
                <StatCard index={2} label={`Total accesses (${stats.window_days}d)`} value={stats.total_accesses} />
                <StatCard index={3}
                    label="Avg time to resolve"
                    value={stats.avg_resolution_days != null ? stats.avg_resolution_days : '—'}
                    suffix={stats.avg_resolution_days != null ? 'd' : ''}
                />
            </div>

            {/* Charts row */}
            <div style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))',
                gap: 14, marginBottom: 14,
            }}>
                <ChartCard title="Open alerts by category" delay={120}>
                    <CategoryPie data={by_category} />
                </ChartCard>
                <ChartCard title={`Access volume — last ${stats.window_days} days`} delay={180}>
                    <VolumeLine data={daily_volume} />
                </ChartCard>
            </div>

            {/* Top employees */}
            <ChartCard
                title={`Top employees by access count — ${stats.window_days}d window`}
                height={Math.min(300, Math.max(140, top_employees.length * 40 + 56))}
                delay={240}
            >
                <TopEmployeesBar data={top_employees} />
            </ChartCard>
        </div>
    )
}