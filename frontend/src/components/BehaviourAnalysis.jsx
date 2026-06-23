/**
 * frontend/src/components/BehaviourAnalysis.jsx
 * Admin-only: pick an employee → AI reads their chat history → shows
 * inferred mood/personality/traits. Nothing here is shown to employees.
 *
 * All data is fetched from the API (analysis / history / dashboard).
 * Nothing is hardcoded or sample data.
 *
 * Layout:
 *  - No team overview block (removed — was cramped and overlapping).
 *  - Per-employee panel: a clean mini behavioral dashboard —
 *      • 3 stat cards (Mood / Confidence / Attitude Trend) — glanceable,
 *        generous spacing, label above icon+value, never overlapping.
 *        Mood/Trend/Confidence icons are theme-colored line SVGs (no
 *        colorful emoji) — same badge style across all three stat cards.
 *      • Traits as vertical bar columns, arranged side-by-side in a row
 *      • History trend line (only when 2+ analyses exist)
 *      • Personality / Observations / Talking points — stays as prose
 *  - Smooth transitions on hover/select, polished toast-style alerts.
 */

import { useEffect, useState, useCallback, useRef } from 'react'
import { useBehaviourAnalysis } from '../hooks/useBehaviourAnalysis'

const API = '/api'

const CONFIDENCE_COLORS = {
    high:    { bg: 'rgba(16,185,129,0.15)', color: '#34d399', border: 'rgba(16,185,129,0.3)', hex: '#34d399' },
    medium:  { bg: 'rgba(245,158,11,0.15)', color: '#fbbf24', border: 'rgba(245,158,11,0.3)', hex: '#fbbf24' },
    low:     { bg: 'rgba(239,68,68,0.15)',  color: '#f87171', border: 'rgba(239,68,68,0.3)', hex: '#f87171' },
    unknown: { bg: 'rgba(100,116,139,0.15)',color: '#94a3b8', border: 'rgba(100,116,139,0.3)', hex: '#94a3b8' },
}

const TREND_META = {
    improving: { icon: '↗', color: '#34d399', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)' },
    declining: { icon: '↘', color: '#f87171', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)' },
    stable:    { icon: '→', color: '#60a5fa', bg: 'rgba(79,142,247,0.12)', border: 'rgba(79,142,247,0.3)' },
    unknown:   { icon: '·', color: '#94a3b8', bg: 'rgba(100,116,139,0.12)', border: 'rgba(100,116,139,0.3)' },
}

// Theme-colored mood badges — same palette family as TREND_META/CONFIDENCE_COLORS,
// rendered with a line-drawn face icon (MoodFaceIcon) instead of an emoji.
//
// The mood field is free text from an LLM, not a fixed enum, so this map covers
// a wide vocabulary grouped into icon "families" (smile / neutral / frown / curious /
// tired / energetic / confused) rather than just 3 buckets. Anything not listed
// falls through to a sentiment-aware fallback below — never a single flat icon.
const MOOD_META = {
    // ── Positive / smile ──────────────────────────────────────────────────────
    positive:    { type: 'smile',    color: '#34d399', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)' },
    happy:       { type: 'smile',    color: '#34d399', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)' },
    upbeat:      { type: 'smile',    color: '#34d399', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)' },
    cheerful:    { type: 'smile',    color: '#34d399', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)' },
    content:     { type: 'smile',    color: '#34d399', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)' },
    satisfied:   { type: 'smile',    color: '#34d399', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)' },
    optimistic:  { type: 'smile',    color: '#34d399', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)' },
    confident:   { type: 'smile',    color: '#34d399', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)' },
    grateful:    { type: 'smile',    color: '#34d399', bg: 'rgba(16,185,129,0.12)', border: 'rgba(16,185,129,0.3)' },

    // ── Energetic / motivated — distinct from plain "happy" ─────────────────
    energetic:   { type: 'energetic', color: '#fbbf24', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
    motivated:   { type: 'energetic', color: '#fbbf24', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
    enthusiastic:{ type: 'energetic', color: '#fbbf24', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
    excited:     { type: 'energetic', color: '#fbbf24', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },
    driven:      { type: 'energetic', color: '#fbbf24', bg: 'rgba(245,158,11,0.12)', border: 'rgba(245,158,11,0.3)' },

    // ── Curious / engaged — raised brow, distinct from neutral ───────────────
    curious:      { type: 'curious', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.3)' },
    inquisitive:  { type: 'curious', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.3)' },
    interested:   { type: 'curious', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.3)' },
    engaged:      { type: 'curious', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.3)' },
    attentive:    { type: 'curious', color: '#a78bfa', bg: 'rgba(167,139,250,0.12)', border: 'rgba(167,139,250,0.3)' },

    // ── Neutral / calm ────────────────────────────────────────────────────────
    neutral:     { type: 'neutral',  color: '#60a5fa', bg: 'rgba(79,142,247,0.12)', border: 'rgba(79,142,247,0.3)' },
    calm:        { type: 'neutral',  color: '#60a5fa', bg: 'rgba(79,142,247,0.12)', border: 'rgba(79,142,247,0.3)' },
    professional:{ type: 'neutral',  color: '#60a5fa', bg: 'rgba(79,142,247,0.12)', border: 'rgba(79,142,247,0.3)' },
    focused:     { type: 'neutral',  color: '#60a5fa', bg: 'rgba(79,142,247,0.12)', border: 'rgba(79,142,247,0.3)' },
    reserved:    { type: 'neutral',  color: '#60a5fa', bg: 'rgba(79,142,247,0.12)', border: 'rgba(79,142,247,0.3)' },

    // ── Tired / low energy — droopy eyes, distinct from sad ──────────────────
    tired:       { type: 'tired',    color: '#94a3b8', bg: 'rgba(100,116,139,0.14)', border: 'rgba(100,116,139,0.32)' },
    fatigued:    { type: 'tired',    color: '#94a3b8', bg: 'rgba(100,116,139,0.14)', border: 'rgba(100,116,139,0.32)' },
    disengaged:  { type: 'tired',    color: '#94a3b8', bg: 'rgba(100,116,139,0.14)', border: 'rgba(100,116,139,0.32)' },
    withdrawn:   { type: 'tired',    color: '#94a3b8', bg: 'rgba(100,116,139,0.14)', border: 'rgba(100,116,139,0.32)' },
    bored:       { type: 'tired',    color: '#94a3b8', bg: 'rgba(100,116,139,0.14)', border: 'rgba(100,116,139,0.32)' },

    // ── Confused / uncertain — wavy mouth, distinct from frown ───────────────
    confused:    { type: 'confused', color: '#fb923c', bg: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.3)' },
    uncertain:   { type: 'confused', color: '#fb923c', bg: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.3)' },
    hesitant:    { type: 'confused', color: '#fb923c', bg: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.3)' },
    conflicted:  { type: 'confused', color: '#fb923c', bg: 'rgba(251,146,60,0.12)', border: 'rgba(251,146,60,0.3)' },

    // ── Negative / frown ──────────────────────────────────────────────────────
    negative:    { type: 'frown',    color: '#f87171', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)' },
    stressed:    { type: 'frown',    color: '#f87171', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)' },
    frustrated:  { type: 'frown',    color: '#f87171', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)' },
    anxious:     { type: 'frown',    color: '#f87171', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)' },
    sad:         { type: 'frown',    color: '#f87171', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)' },
    discouraged: { type: 'frown',    color: '#f87171', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)' },
    overwhelmed: { type: 'frown',    color: '#f87171', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)' },
    irritated:   { type: 'frown',    color: '#f87171', bg: 'rgba(239,68,68,0.12)', border: 'rgba(239,68,68,0.3)' },

    unknown:     { type: 'neutral',  color: '#94a3b8', bg: 'rgba(100,116,139,0.12)', border: 'rgba(100,116,139,0.3)' },
}

// Sentiment-keyword fallback — used only when the exact mood word isn't in
// MOOD_META above. Keeps icon/color varied instead of collapsing everything
// unrecognized into the same flat "unknown" face.
const FALLBACK_RULES = [
    { test: /happy|joy|glad|pleased|delight/i,            meta: MOOD_META.happy },
    { test: /energ|motiv|excit|enthus/i,                  meta: MOOD_META.energetic },
    { test: /curious|inquisit|interest|engag|wonder/i,    meta: MOOD_META.curious },
    { test: /tired|fatigue|burn.?out|exhaust|disengag/i,  meta: MOOD_META.tired },
    { test: /confus|uncertain|hesitant|conflict|unsure/i, meta: MOOD_META.confused },
    { test: /stress|frustrat|anx|angry|sad|upset|overwhelm|irritat|discourag/i, meta: MOOD_META.negative },
    { test: /calm|neutral|focus|profession|reserved/i,    meta: MOOD_META.neutral },
]

// Cycling accent palette for trait columns — purely styling, not data
const TRAIT_PALETTE = ['#4f8ef7', '#34d399', '#fbbf24', '#a78bfa', '#22d3ee', '#fb923c', '#f472b6', '#84cc16']

let chartJsLoadPromise = null
function loadChartJs() {
    if (window.Chart) return Promise.resolve(window.Chart)
    if (chartJsLoadPromise) return chartJsLoadPromise
    chartJsLoadPromise = new Promise((resolve, reject) => {
        const script = document.createElement('script')
        script.src = 'https://cdnjs.cloudflare.com/ajax/libs/Chart.js/4.4.1/chart.umd.js'
        script.onload = () => resolve(window.Chart)
        script.onerror = reject
        document.head.appendChild(script)
    })
    return chartJsLoadPromise
}

function getToken() {
    return localStorage.getItem('hrms_token') || ''
}

function confidenceStyle(confidence) {
    return CONFIDENCE_COLORS[(confidence || '').toLowerCase()] || CONFIDENCE_COLORS.unknown
}

function trendStyle(trend) {
    return TREND_META[(trend || '').toLowerCase()] || TREND_META.unknown
}

function moodStyle(mood) {
    const key = (mood || '').toLowerCase().trim()
    if (MOOD_META[key]) return MOOD_META[key]
    const matched = FALLBACK_RULES.find(rule => rule.test.test(key))
    return matched ? matched.meta : MOOD_META.unknown
}

function traitColor(index) {
    return TRAIT_PALETTE[index % TRAIT_PALETTE.length]
}

/* ── Mood face icon — line-drawn, currentColor stroke, no emoji ──────────────
   Three variants (smile / neutral / frown) drawn as a simple circular face.
   Color comes entirely from the parent badge (theme palette), never hardcoded
   here, so it always matches the rest of the dashboard's accent system. */
function MoodFaceIcon({ type, size = 18 }) {
    let mouth, brows = null, eyes = null

    if (type === 'smile') {
        mouth = <path d="M7 13c1.3 1.8 3.1 2.7 5 2.7s3.7-.9 5-2.7" />
    } else if (type === 'frown') {
        mouth = <path d="M7 16.7c1.3-1.8 3.1-2.7 5-2.7s3.7.9 5 2.7" />
    } else if (type === 'curious') {
        // One raised brow + small round open mouth — engaged, questioning look
        mouth = <circle cx="12" cy="15.5" r="1.8" fill="none" strokeWidth="2.2" />
        brows = (
            <>
                <path d="M5.6 8.8c1.2-1 2.6-1 3.8 0" strokeWidth="2.2" />
                <path d="M14.3 7.1c1.3-1.3 2.9-1.3 4.3-.1" strokeWidth="2.2" />
            </>
        )
    } else if (type === 'tired') {
        // Half-closed eyelids (arcs instead of dots) + flat-low mouth
        eyes = (
            <>
                <path d="M6.3 10.2c.9-.9 2.4-.9 3.3 0" strokeWidth="2.6" />
                <path d="M14.4 10.2c.9-.9 2.4-.9 3.3 0" strokeWidth="2.6" />
            </>
        )
        mouth = <line x1="8" y1="15.3" x2="16" y2="15.3" strokeWidth="2.6" />
    } else if (type === 'energetic') {
        // Wide bright eyes (rings) + big open grin
        mouth = <path d="M6.5 13c1.5 2.6 3.5 4 5.5 4s4-1.4 5.5-4" />
        eyes = (
            <>
                <circle cx="8.2" cy="9.8" r="2.3" fill="none" strokeWidth="2.4" />
                <circle cx="15.8" cy="9.8" r="2.3" fill="none" strokeWidth="2.4" />
            </>
        )
    } else if (type === 'confused') {
        // Wavy/zigzag mouth + one raised brow — uncertain, puzzled
        mouth = <path d="M7 15.5c1-1.3 1.9 1.3 2.9 0s1.9-1.3 2.9 0 1.9 1.3 3 0" strokeWidth="2.2" />
        brows = <path d="M5.3 7.8c1.3-1.1 2.9-1.1 4.1 0" strokeWidth="2.4" />
    } else {
        // neutral
        mouth = <line x1="7.5" y1="14.8" x2="16.5" y2="14.8" strokeWidth="2.6" />
    }

    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round">
            <circle cx="12" cy="12" r="9.3" strokeWidth="2.2" />
            {eyes || (
                <>
                    <circle cx="8.2" cy="9.8" r="1.6" fill="currentColor" stroke="none" />
                    <circle cx="15.8" cy="9.8" r="1.6" fill="currentColor" stroke="none" />
                </>
            )}
            {brows}
            {mouth}
        </svg>
    )
}

/* ── Toast-style alert system ──────────────────────────────────────────────── */
function useToasts() {
    const [toasts, setToasts] = useState([])
    const push = useCallback((message, type = 'info') => {
        const id = Date.now() + Math.random()
        setToasts(p => [...p, { id, message, type }])
        setTimeout(() => setToasts(p => p.filter(t => t.id !== id)), 3800)
    }, [])
    const remove = useCallback(id => setToasts(p => p.filter(t => t.id !== id)), [])
    return { toasts, push, remove }
}

function ToastStack({ toasts, remove }) {
    const ICONS = { success: '✓', error: '✕', warning: '⚠', info: 'ℹ' }
    const COLORS = {
        success: { bg: 'rgba(16,185,129,0.14)', border: 'rgba(16,185,129,0.4)', color: '#34d399' },
        error:   { bg: 'rgba(239,68,68,0.14)',  border: 'rgba(239,68,68,0.4)',  color: '#f87171' },
        warning: { bg: 'rgba(245,158,11,0.14)', border: 'rgba(245,158,11,0.4)', color: '#fbbf24' },
        info:    { bg: 'rgba(79,142,247,0.14)', border: 'rgba(79,142,247,0.4)', color: '#60a5fa' },
    }
    return (
        <div style={{
            position: 'fixed', top: 24, right: 24, zIndex: 9999,
            display: 'flex', flexDirection: 'column', gap: 10, pointerEvents: 'none',
        }}>
            {toasts.map(t => {
                const c = COLORS[t.type] || COLORS.info
                return (
                    <div key={t.id} style={{
                        display: 'flex', alignItems: 'center', gap: 12,
                        padding: '13px 18px', borderRadius: 14, pointerEvents: 'all',
                        background: c.bg, border: `1px solid ${c.border}`,
                        backdropFilter: 'blur(16px)', boxShadow: '0 8px 32px rgba(0,0,0,0.35)',
                        minWidth: 260, maxWidth: 380,
                        animation: 'baToastIn 0.28s cubic-bezier(0.34, 1.56, 0.64, 1)',
                    }}>
                        <span style={{
                            width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                            background: c.color, color: '#0a0a14',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 12, fontWeight: 800,
                        }}>{ICONS[t.type] || ICONS.info}</span>
                        <span style={{ flex: 1, fontSize: 13, color: 'var(--text-primary)', lineHeight: 1.4 }}>{t.message}</span>
                        <button onClick={() => remove(t.id)} style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 16, padding: '0 4px', lineHeight: 1 }}>×</button>
                    </div>
                )
            })}
        </div>
    )
}

/* ── Generic canvas-backed chart component ────────────────────────────────── */
function CanvasChart({ config, height = 220, ariaLabel, fallbackText }) {
    const canvasRef = useRef(null)
    const chartRef = useRef(null)

    useEffect(() => {
        let cancelled = false
        loadChartJs().then((Chart) => {
            if (cancelled || !canvasRef.current || !config) return
            if (chartRef.current) chartRef.current.destroy()
            chartRef.current = new Chart(canvasRef.current, config)
        })
        return () => {
            cancelled = true
            if (chartRef.current) {
                chartRef.current.destroy()
                chartRef.current = null
            }
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [JSON.stringify(config)])

    return (
        <div style={{ position: 'relative', width: '100%', height }}>
            <canvas ref={canvasRef} role="img" aria-label={ariaLabel}>{fallbackText}</canvas>
        </div>
    )
}

/* ── Confidence gauge — small ring icon, label printed separately ────────────── */
function ConfidenceGauge({ confidence, size = 52 }) {
    const c = confidenceStyle(confidence)
    const pct = { high: 100, medium: 62, low: 28 }[(confidence || '').toLowerCase()] ?? 0
    const r = (size - 8) / 2
    const circ = 2 * Math.PI * r

    return (
        <svg width={size} height={size} style={{ transform: 'rotate(-90deg)', flexShrink: 0 }}>
            <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border)" strokeWidth="6" />
            <circle
                cx={size / 2} cy={size / 2} r={r} fill="none"
                stroke={c.hex} strokeWidth="6" strokeLinecap="round"
                strokeDasharray={`${(pct / 100) * circ} ${circ}`}
                style={{ transition: 'stroke-dasharray 0.6s cubic-bezier(0.4, 0, 0.2, 1)' }}
            />
        </svg>
    )
}

/* ── Stat card — icon, label, value stacked cleanly, no overlap ──────────────── */
function StatCard({ label, icon, value, accentColor }) {
    return (
        <div
            className="ba-stat-card"
            style={{
                flex: '1 1 0', minWidth: 0,
                background: 'var(--bg-secondary)', borderRadius: 14,
                padding: '16px 18px',
                border: '1px solid var(--border)',
                transition: 'transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease',
            }}
        >
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                {icon}
                <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'var(--text-muted)', fontWeight: 700 }}>
                    {label}
                </span>
            </div>
            <div style={{
                fontSize: 16, fontWeight: 700, color: accentColor || 'var(--text-primary)',
                textTransform: 'capitalize', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
            }}>
                {value || '—'}
            </div>
        </div>
    )
}

/* ── Trait column — vertical bar card ─────────────────────────────────────────
   Each trait is a standalone tall card: colored top edge, number badge,
   label below — arranged side-by-side in a row so the set reads like a row
   of vertical bars rather than a stacked list of wide horizontal rows. */
function TraitBar({ label, color, index }) {
    return (
        <div
            className="ba-trait-bar"
            style={{
                flex: '1 1 0', minWidth: 96,
                display: 'flex', flexDirection: 'column', alignItems: 'center',
                gap: 10,
                padding: '16px 10px 14px',
                borderRadius: 12,
                background: 'var(--bg-secondary)',
                borderTop: `3px solid ${color}`,
                transition: 'transform 0.15s ease, background 0.15s ease, box-shadow 0.15s ease',
            }}
        >
            <span style={{
                width: 26, height: 26, borderRadius: '50%', flexShrink: 0,
                background: `${color}22`, color,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontSize: 11, fontWeight: 800,
            }}>{index + 1}</span>
            <span style={{
                fontSize: 12.5, fontWeight: 600, color: 'var(--text-primary)',
                textAlign: 'center', lineHeight: 1.3,
            }}>{label}</span>
        </div>
    )
}

/* ── Per-employee trend strip ─────────────────────────────────────────────── */
function HistoryTrend({ history, loading }) {
    if (loading) {
        return <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 18 }}>Loading history…</div>
    }
    if (!history || history.length < 2) {
        return null
    }

    const labels = history.map(h => h.analyzed_at ? new Date(h.analyzed_at).toLocaleDateString('en-IN', { day: '2-digit', month: 'short' }) : '')
    const confidenceRank = { low: 1, medium: 2, high: 3 }
    const confidenceSeries = history.map(h => confidenceRank[(h.confidence || '').toLowerCase()] || null)

    const trendChart = {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Confidence',
                data: confidenceSeries,
                borderColor: '#4f8ef7',
                backgroundColor: 'rgba(79,142,247,0.12)',
                fill: true,
                tension: 0.3,
                pointRadius: 4,
                pointBackgroundColor: '#4f8ef7',
                spanGaps: true,
            }],
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: (ctx) => {
                            const h = history[ctx.dataIndex]
                            return `${h.mood || 'Unknown mood'} · ${h.attitude_trend || 'Unknown trend'} · ${h.confidence || 'unknown'} confidence`
                        },
                    },
                },
            },
            scales: {
                x: { ticks: { color: '#94a3b8', font: { size: 10 } }, grid: { display: false } },
                y: {
                    min: 0.5, max: 3.5,
                    ticks: {
                        color: '#94a3b8', font: { size: 10 }, stepSize: 1,
                        callback: (v) => ({ 1: 'Low', 2: 'Medium', 3: 'High' }[v] || ''),
                    },
                    grid: { color: 'rgba(148,163,184,0.12)' },
                },
            },
        },
    }

    return (
        <div style={{ marginTop: 22, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', fontWeight: 700, marginBottom: 10 }}>
                Trend over past analyses ({history.length})
            </div>
            <CanvasChart
                config={trendChart}
                height={160}
                ariaLabel={`Line chart of analysis confidence over time across ${history.length} past analyses`}
                fallbackText={history.map(h => `${h.analyzed_at}: ${h.mood}, ${h.attitude_trend}, ${h.confidence} confidence`).join('; ')}
            />
        </div>
    )
}

/* ── Per-employee mini behavioral dashboard ───────────────────────────────── */
function AnalysisCard({ result, employeeName, history, loadingHistory, onReanalyse, analyzing }) {
    if (!result) return null

    if (result.status === 'disabled') {
        return (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                Behaviour analysis is currently disabled.
            </div>
        )
    }
    if (result.status === 'insufficient_data') {
        return (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                Not enough chat history to analyze ({result.message_count || 0} message
                {result.message_count === 1 ? '' : 's'}, need at least {result.min_required}).
            </div>
        )
    }
    if (result.status === 'error') {
        return (
            <div style={{ padding: 24, textAlign: 'center', color: '#f87171', fontSize: 13 }}>
                {result.detail || 'Analysis failed. Please try again.'}
            </div>
        )
    }
    if (result.status === 'no_data') {
        return (
            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 13 }}>
                No analysis has been run for this employee yet. Click "Analyse" to start.
            </div>
        )
    }

    const tStyle = trendStyle(result.attitude_trend)
    const cStyle = confidenceStyle(result.confidence)
    const mStyle = moodStyle(result.mood)

    return (
        <div className="ba-analysis-card" style={{
            background: 'var(--bg-card)', border: '1px solid var(--border)',
            borderRadius: 14, padding: '24px 28px',
            animation: 'baFadeUp 0.32s cubic-bezier(0.16, 1, 0.3, 1)',
        }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 20, gap: 16 }}>
                <div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)' }}>{employeeName}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2, display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                        <span>Based on {result.message_count} messages</span>
                        {result.analyzed_at && (() => {
                            const analyzedDate = new Date(result.analyzed_at)
                            const daysSince = Math.floor((Date.now() - analyzedDate.getTime()) / 86400000)
                            const isStale = daysSince >= 1
                            return (
                                <>
                                    <span>· Last analysed {analyzedDate.toLocaleString('en-IN', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>
                                    {isStale && (
                                        <span style={{
                                            padding: '2px 8px', borderRadius: 6,
                                            background: 'rgba(251,191,36,0.12)', color: '#fbbf24',
                                            fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em',
                                        }}>
                                            {daysSince === 1 ? '1 day old' : `${daysSince} days old`} — may not reflect recent chats
                                        </span>
                                    )}
                                </>
                            )
                        })()}
                    </div>
                </div>
                {onReanalyse && (
                    <button
                        onClick={onReanalyse}
                        disabled={analyzing}
                        style={{
                            flexShrink: 0,
                            padding: '7px 14px', borderRadius: 8,
                            border: '1px solid rgba(79,142,247,0.3)',
                            background: 'rgba(79,142,247,0.1)', color: 'var(--accent)',
                            fontSize: 12, fontWeight: 600, cursor: analyzing ? 'default' : 'pointer',
                            opacity: analyzing ? 0.5 : 1,
                            display: 'flex', alignItems: 'center', gap: 6,
                            transition: 'background 0.15s, transform 0.15s',
                        }}
                        onMouseEnter={e => { if (!analyzing) e.currentTarget.style.background = 'rgba(79,142,247,0.22)' }}
                        onMouseLeave={e => { e.currentTarget.style.background = 'rgba(79,142,247,0.1)' }}
                    >
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                            <path d="M23 4v6h-6" /><path d="M1 20v-6h6" />
                            <path d="M3.51 9a9 9 0 0114.85-3.36L23 10" />
                            <path d="M20.49 15a9 9 0 01-14.85 3.36L1 14" />
                        </svg>
                        {analyzing ? 'Analysing…' : 'Re-analyse now'}
                    </button>
                )}
            </div>

            {/* Top row: 3 clean stat cards — no overlap, generous spacing */}
            <div style={{ display: 'flex', gap: 12, marginBottom: 22 }}>
                <StatCard
                    label="Mood"
                    icon={
                        <span style={{
                            width: 34, height: 34, borderRadius: '50%', flexShrink: 0,
                            background: mStyle.bg.replace('0.12', '0.28'), color: mStyle.color, border: `1.5px solid ${mStyle.color}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}><MoodFaceIcon type={mStyle.type} size={24} /></span>
                    }
                    value={result.mood}
                    accentColor={mStyle.color}
                />
                <StatCard
                    label="Confidence"
                    icon={<ConfidenceGauge confidence={result.confidence} size={26} />}
                    value={result.confidence}
                    accentColor={cStyle.color}
                />
                <StatCard
                    label="Attitude Trend"
                    icon={
                        <span style={{
                            fontSize: 14, width: 26, height: 26, borderRadius: '50%',
                            background: tStyle.bg, color: tStyle.color, border: `1px solid ${tStyle.border}`,
                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                        }}>{tStyle.icon}</span>
                    }
                    value={result.attitude_trend}
                    accentColor={tStyle.color}
                />
            </div>

            {/* Traits — vertical bar cards, arranged side-by-side in a row */}
            {result.traits && result.traits.length > 0 && (
                <div style={{ marginBottom: 18 }}>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', fontWeight: 700, marginBottom: 8 }}>Traits</div>
                    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                        {result.traits.map((t, i) => (
                            <TraitBar key={i} label={t} color={traitColor(i)} index={i} />
                        ))}
                    </div>
                </div>
            )}

            {/* History trend — only when 2+ analyses exist */}
            <HistoryTrend history={history} loading={loadingHistory} />

            {/* Personality — character sketch, framed like a quoted insight */}
            {result.personality && (
                <div style={{ marginTop: 18, marginBottom: 18, paddingTop: 18, borderTop: '1px solid var(--border)' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <span style={{
                            width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                            background: 'rgba(167,139,250,0.15)', color: '#a78bfa',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                                <circle cx="12" cy="8" r="3.6" />
                                <path d="M5 20c0-3.6 3.1-6.4 7-6.4s7 2.8 7 6.4" />
                            </svg>
                        </span>
                        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', fontWeight: 700 }}>Personality</span>
                    </div>
                    <div style={{
                        position: 'relative',
                        padding: '14px 18px 14px 20px',
                        borderRadius: 12,
                        background: 'rgba(167,139,250,0.06)',
                        borderLeft: '3px solid rgba(167,139,250,0.45)',
                    }}>
                        <div style={{ fontSize: 13.5, color: 'var(--text-primary)', lineHeight: 1.75, fontStyle: 'italic' }}>
                            {result.personality}
                        </div>
                    </div>
                </div>
            )}

            {/* Observations — evidence log, distinct from the personality sketch above */}
            {result.observations && (
                <div style={{ marginBottom: 18 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
                        <span style={{
                            width: 22, height: 22, borderRadius: '50%', flexShrink: 0,
                            background: 'rgba(96,165,250,0.15)', color: '#60a5fa',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                        }}>
                            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M9 11l3 3L22 4" />
                                <path d="M21 12v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h11" />
                            </svg>
                        </span>
                        <span style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', fontWeight: 700 }}>Observations</span>
                    </div>
                    <div style={{
                        padding: '14px 16px',
                        borderRadius: 12,
                        background: 'var(--bg-secondary)',
                        border: '1px solid var(--border)',
                    }}>
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                            {result.observations}
                        </div>
                    </div>
                </div>
            )}

            {result.suggested_talking_points && result.suggested_talking_points.length > 0 && (
                <div>
                    <div style={{ fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', fontWeight: 700, marginBottom: 8 }}>Suggested Talking Points</div>
                    <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.8 }}>
                        {result.suggested_talking_points.map((p, i) => <li key={i}>{p}</li>)}
                    </ul>
                </div>
            )}
        </div>
    )
}

export default function BehaviourAnalysis({ token }) {
    const {
        dashboard, loadingDashboard, loadDashboard,
        analysis, getAnalysis, runAnalysis, analyzing,
        loadOverview,
        history, loadingHistory, loadHistory,
        error,
    } = useBehaviourAnalysis()
    const [employees, setEmployees] = useState([])
    const [loadingEmployees, setLoadingEmployees] = useState(true)
    const [selected, setSelected] = useState(null)
    const { toasts, push, remove } = useToasts()

    const fetchEmployees = useCallback(async () => {
        setLoadingEmployees(true)
        try {
            const res = await fetch(`${API}/admin/employees`, { headers: { Authorization: `Bearer ${getToken()}` } })
            if (res.ok) setEmployees(await res.json())
        } catch {
            push('Could not load employee list', 'error')
        } finally { setLoadingEmployees(false) }
    }, [push])

    useEffect(() => { fetchEmployees(); loadDashboard() }, [fetchEmployees, loadDashboard])

    useEffect(() => {
        if (error) push(error, 'error')
    }, [error, push])

    const dashboardMap = Object.fromEntries(dashboard.map(d => [d.employee_id, d]))

    const handleSelect = async (emp) => {
        setSelected(emp)
        await getAnalysis(emp.id)
        loadHistory(emp.id)
    }

    const handleAnalyse = async (emp) => {
        setSelected(emp)
        await runAnalysis(emp.id)
        loadDashboard()
        loadOverview()
        loadHistory(emp.id)
        push(`Analysis complete for ${emp.name}`, 'success')
    }

    return (
        <div>
            <style>{`
                @keyframes baFadeUp {
                    from { opacity: 0; transform: translateY(8px); }
                    to   { opacity: 1; transform: translateY(0); }
                }
                @keyframes baToastIn {
                    from { opacity: 0; transform: translateX(32px); }
                    to   { opacity: 1; transform: translateX(0); }
                }
                .ba-stat-card:hover {
                    transform: translateY(-2px);
                    border-color: rgba(79,142,247,0.35);
                    box-shadow: 0 6px 20px rgba(0,0,0,0.18);
                }
                .ba-trait-bar:hover {
                    transform: translateY(-3px);
                    background: var(--bg-card);
                    box-shadow: 0 6px 16px rgba(0,0,0,0.18);
                }
                .ba-emp-row {
                    transition: background 0.18s ease, transform 0.18s ease;
                }
                .ba-analyse-btn {
                    transition: background 0.15s ease, transform 0.15s ease;
                }
                .ba-analyse-btn:hover:not(:disabled) {
                    background: rgba(79,142,247,0.22) !important;
                    transform: translateY(-1px);
                }
                .ba-analyse-btn:active:not(:disabled) {
                    transform: translateY(0);
                }
            `}</style>

            <ToastStack toasts={toasts} remove={remove} />

            <div style={{ display: 'flex', gap: 20, alignItems: 'flex-start' }}>
                {/* Left: employee list */}
                <div style={{
                    width: 320, flexShrink: 0,
                    background: 'var(--bg-card)', border: '1px solid var(--border)',
                    borderRadius: 14, overflow: 'hidden',
                }}>
                    <div style={{ padding: '14px 18px', borderBottom: '1px solid var(--border)', background: 'var(--bg-secondary)' }}>
                        <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)' }}>Employees</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                            AI-inferred from chat history — a prompt to start a human conversation, not a judgement.
                        </div>
                    </div>
                    <div style={{ maxHeight: 560, overflowY: 'auto' }}>
                        {loadingEmployees || loadingDashboard ? (
                            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>Loading…</div>
                        ) : employees.length === 0 ? (
                            <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)', fontSize: 12 }}>No employees found</div>
                        ) : employees.map(emp => {
                            const d = dashboardMap[emp.id]
                            const isSelected = selected?.id === emp.id
                            return (
                                <div
                                    key={emp.id}
                                    className="ba-emp-row"
                                    onClick={() => handleSelect(emp)}
                                    style={{
                                        padding: '12px 18px',
                                        borderBottom: '1px solid var(--border)',
                                        cursor: 'pointer',
                                        background: isSelected ? 'var(--accent-dim)' : 'transparent',
                                    }}
                                    onMouseEnter={e => { if (!isSelected) e.currentTarget.style.background = 'var(--bg-secondary)' }}
                                    onMouseLeave={e => { if (!isSelected) e.currentTarget.style.background = 'transparent' }}
                                >
                                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                        <div style={{ minWidth: 0, flex: 1 }}>
                                            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{emp.name}</div>
                                            <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                                {d ? `${d.mood || '—'} · ${d.analyzed_at ? new Date(d.analyzed_at).toLocaleDateString('en-IN') : ''}` : 'Not yet analysed'}
                                            </div>
                                        </div>
                                        <button
                                            className="ba-analyse-btn"
                                            onClick={(e) => { e.stopPropagation(); handleAnalyse(emp) }}
                                            disabled={analyzing && selected?.id === emp.id}
                                            style={{
                                                padding: '5px 12px', borderRadius: 8, border: '1px solid rgba(79,142,247,0.3)',
                                                background: 'rgba(79,142,247,0.1)', color: 'var(--accent)',
                                                fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0,
                                                opacity: (analyzing && selected?.id === emp.id) ? 0.5 : 1,
                                            }}
                                        >
                                            {(analyzing && selected?.id === emp.id) ? '…' : 'Analyse'}
                                        </button>
                                    </div>
                                </div>
                            )
                        })}
                    </div>
                </div>

                {/* Right: analysis result */}
                <div style={{ flex: 1, minWidth: 0 }}>
                    {!selected ? (
                        <div style={{
                            background: 'var(--bg-card)', border: '1px solid var(--border)',
                            borderRadius: 14, padding: '60px 24px', textAlign: 'center',
                        }}>
                            <div style={{ fontSize: 14, color: 'var(--text-secondary)' }}>
                                Select an employee to view or run a behaviour analysis.
                            </div>
                        </div>
                    ) : (analyzing && selected) ? (
                        <div style={{
                            background: 'var(--bg-card)', border: '1px solid var(--border)',
                            borderRadius: 14, padding: '60px 24px', textAlign: 'center',
                        }}>
                            <div style={{ fontSize: 13, color: 'var(--text-muted)' }}>Analysing {selected.name}'s chat history…</div>
                        </div>
                    ) : (
                        <AnalysisCard
                            result={analysis}
                            employeeName={selected.name}
                            history={history}
                            loadingHistory={loadingHistory}
                            onReanalyse={() => handleAnalyse(selected)}
                            analyzing={analyzing}
                        />
                    )}

                    <div style={{ marginTop: 16, fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', fontStyle: 'italic' }}>
                        AI-inferred from chat history — a prompt to start a human conversation, not a judgement.
                    </div>
                </div>
            </div>
        </div>
    )
}