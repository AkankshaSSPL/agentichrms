/**
 * Calendar.jsx — Internal Meeting Scheduler
 * - Month grid view with navigation
 * - Meeting chips on each day
 * - New meeting form (click day or "+ New Meeting" button)
 * - Delete meetings
 * - All data from /api/meetings/ — zero external services
 */

import { useState, useEffect } from 'react'

const API = '/api'

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

// ── Colour palette for meeting chips (cycles by meeting id) ───────────────────
const CHIP_COLORS = [
    { bg: 'rgba(79,142,247,0.18)', border: 'rgba(79,142,247,0.4)', text: '#4f8ef7' },
    { bg: 'rgba(52,211,153,0.15)', border: 'rgba(52,211,153,0.35)', text: '#34d399' },
    { bg: 'rgba(251,191,36,0.15)', border: 'rgba(251,191,36,0.35)', text: '#fbbf24' },
    { bg: 'rgba(167,139,250,0.15)', border: 'rgba(167,139,250,0.35)', text: '#a78bfa' },
    { bg: 'rgba(248,113,113,0.15)', border: 'rgba(248,113,113,0.35)', text: '#f87171' },
]
const chipColor = (id) => CHIP_COLORS[id % CHIP_COLORS.length]

// Pad "9" → "09"
const pad2 = n => String(n).padStart(2, '0')

export default function Calendar({ onBack, rescheduleMeetingIds = [] }) {
    const today = new Date()
    const [year, setYear] = useState(today.getFullYear())
    const [month, setMonth] = useState(today.getMonth())   // 0-indexed
    const [meetings, setMeetings] = useState([])
    const [loading, setLoading] = useState(true)
    const [showForm, setShowForm] = useState(false)
    const [selectedDay, setSelectedDay] = useState(null)  // YYYY-MM-DD string
    const [detail, setDetail] = useState(null)            // meeting object shown in side detail
    const [formError, setFormError] = useState('')
    const [saving, setSaving] = useState(false)
    const [form, setForm] = useState({
        title: '', meeting_date: '', start_time: '09:00', end_time: '10:00', attendees: '',
    })

    // Reschedule mode — which meeting is being rescheduled
    const [reschedulingMeeting, setReschedulingMeeting] = useState(null)

    // ── Fetch all meetings once ───────────────────────────────────────────────
    const fetchMeetings = async () => {
        setLoading(true)
        try {
            const res = await fetch(`${API}/meetings/`, {
                headers: { Authorization: `Bearer ${localStorage.getItem('hrms_token')}` },
            })
            if (!res.ok) throw new Error()
            const data = await res.json()
            setMeetings(data)
        } catch {
            setMeetings([])
        } finally {
            setLoading(false)
        }
    }

    useEffect(() => { fetchMeetings() }, [])

    // Auto-open reschedule form for conflicting meetings once loaded
    useEffect(() => {
        if (rescheduleMeetingIds.length === 0 || meetings.length === 0) return
        // Try matching by numeric ID first, then by title string
        const first = meetings.find(m =>
            rescheduleMeetingIds.includes(m.id) ||
            rescheduleMeetingIds.includes(m.title)
        )
        if (first) {
            setReschedulingMeeting(first)
            setForm({
                title: first.title,
                meeting_date: first.meeting_date,
                start_time: first.start_time,
                end_time: first.end_time,
                attendees: first.attendees || '',
            })
            setShowForm(true)
            setFormError('')
        }
    }, [rescheduleMeetingIds, meetings])

    // ── Build calendar grid ───────────────────────────────────────────────────
    const firstDay = new Date(year, month, 1).getDay()   // 0=Sun
    const daysInMonth = new Date(year, month + 1, 0).getDate()

    // meetings indexed by YYYY-MM-DD
    const byDay = {}
    meetings.forEach(m => {
        const d = m.meeting_date  // already "YYYY-MM-DD"
        if (!byDay[d]) byDay[d] = []
        byDay[d].push(m)
    })

    const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1) } else setMonth(m => m - 1) }
    const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1) } else setMonth(m => m + 1) }

    const todayStr = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`

    // ── Open form for a specific day ──────────────────────────────────────────
    const openFormForDay = (dayStr) => {
        setForm({ title: '', meeting_date: dayStr, start_time: '09:00', end_time: '10:00', attendees: '' })
        setSelectedDay(dayStr)
        setDetail(null)
        setShowForm(true)
        setFormError('')
    }

    // ── Submit new meeting OR update existing (reschedule) ──────────────────
    const handleSubmit = async () => {
        if (!form.title.trim()) { setFormError('Title is required.'); return }
        if (!form.meeting_date) { setFormError('Date is required.'); return }
        if (form.start_time >= form.end_time) { setFormError('End time must be after start time.'); return }
        setSaving(true); setFormError('')
        try {
            const isReschedule = !!reschedulingMeeting
            const url = isReschedule ? `${API}/meetings/${reschedulingMeeting.id}` : `${API}/meetings/`
            const method = isReschedule ? 'PUT' : 'POST'
            const res = await fetch(url, {
                method,
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${localStorage.getItem('hrms_token')}`,
                },
                body: JSON.stringify(form),
            })
            if (!res.ok) { const e = await res.json(); throw new Error(e.detail || 'Failed'); }
            await fetchMeetings()
            setShowForm(false)
            setReschedulingMeeting(null)
        } catch (err) {
            setFormError(err.message)
        } finally {
            setSaving(false)
        }
    }

    // ── Delete meeting ────────────────────────────────────────────────────────
    const handleDelete = async (id) => {
        if (!confirm('Delete this meeting?')) return
        try {
            await fetch(`${API}/meetings/${id}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${localStorage.getItem('hrms_token')}` },
            })
            setDetail(null)
            await fetchMeetings()
        } catch { alert('Could not delete. Try again.') }
    }

    // ── This month's meetings sorted ──────────────────────────────────────────
    const thisMonthKey = `${year}-${pad2(month + 1)}`
    const monthMeetings = meetings.filter(m => m.meeting_date.startsWith(thisMonthKey))
        .sort((a, b) => a.meeting_date.localeCompare(b.meeting_date) || a.start_time.localeCompare(b.start_time))

    // ── Render ────────────────────────────────────────────────────────────────
    return (
        <div style={{ display: 'flex', height: '100%', overflow: 'hidden', fontFamily: "'Inter', sans-serif" }}>

            {/* ── Main calendar area ── */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '20px 24px' }}>

                {/* Header */}
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                        <button onClick={onBack} style={btnStyle('#1e2433', '#8b95a9')}>← Back to Chat</button>
                        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', margin: 0 }}>
                            My Calendar
                        </h2>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                        <button onClick={prevMonth} style={navBtn}>‹</button>
                        <span style={{ fontSize: 15, fontWeight: 600, color: '#e2e8f0', minWidth: 140, textAlign: 'center' }}>
                            {MONTHS[month]} {year}
                        </span>
                        <button onClick={nextMonth} style={navBtn}>›</button>
                        <button
                            onClick={() => openFormForDay(todayStr)}
                            style={btnStyle('rgba(79,142,247,0.15)', '#4f8ef7', true)}
                        >
                            + New Meeting
                        </button>
                    </div>
                </div>

                {/* Info banner */}
                <div style={{
                    background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.18)',
                    borderRadius: 8, padding: '7px 14px', marginBottom: 16,
                    fontSize: 11, color: '#34d399', letterSpacing: 0.3,
                }}>
                    * Meetings added here are checked automatically when you apply for leave via the chat.
                </div>

                {/* Day headers */}
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 2, marginBottom: 4 }}>
                    {DAYS.map(d => (
                        <div key={d} style={{ textAlign: 'center', fontSize: 11, fontWeight: 600, color: '#4a5168', padding: '4px 0' }}>{d}</div>
                    ))}
                </div>

                {/* Calendar grid */}
                {loading ? (
                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#4a5168', fontSize: 13 }}>
                        Loading meetings…
                    </div>
                ) : (
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', gap: 3, flex: 1, overflow: 'auto' }}>
                        {/* Empty cells before day 1 */}
                        {Array.from({ length: firstDay }).map((_, i) => (
                            <div key={`e${i}`} style={cellStyle(false, false, false)} />
                        ))}

                        {/* Day cells */}
                        {Array.from({ length: daysInMonth }).map((_, i) => {
                            const dayNum = i + 1
                            const dayStr = `${year}-${pad2(month + 1)}-${pad2(dayNum)}`
                            const isToday = dayStr === todayStr
                            const dayMeetings = byDay[dayStr] || []
                            const isSelected = selectedDay === dayStr

                            return (
                                <div
                                    key={dayStr}
                                    onClick={() => openFormForDay(dayStr)}
                                    style={cellStyle(isToday, isSelected, true)}
                                >
                                    <div style={{
                                        fontSize: 12, fontWeight: isToday ? 700 : 400,
                                        color: isToday ? '#4f8ef7' : '#8b95a9',
                                        marginBottom: 3,
                                    }}>{dayNum}</div>

                                    {/* Meeting chips — max 3, then "+N more" */}
                                    {dayMeetings.slice(0, 3).map(m => {
                                        const c = chipColor(m.id)
                                        return (
                                            <div
                                                key={m.id}
                                                onClick={e => { e.stopPropagation(); setDetail(m); setShowForm(false); setSelectedDay(dayStr) }}
                                                style={{
                                                    background: c.bg, border: `1px solid ${c.border}`,
                                                    borderRadius: 4, padding: '1px 5px', marginBottom: 2,
                                                    fontSize: 10, color: c.text, whiteSpace: 'nowrap',
                                                    overflow: 'hidden', textOverflow: 'ellipsis',
                                                    cursor: 'pointer',
                                                }}
                                                title={`${m.title} · ${m.start_time}–${m.end_time}`}
                                            >
                                                {m.start_time} {m.title}
                                            </div>
                                        )
                                    })}
                                    {dayMeetings.length > 3 && (
                                        <div style={{ fontSize: 9, color: '#4a5168' }}>+{dayMeetings.length - 3} more</div>
                                    )}
                                </div>
                            )
                        })}
                    </div>
                )}
            </div>

            {/* ── Right side panel — New Meeting form OR Meeting detail ── */}
            <div style={{
                width: 280, borderLeft: '1px solid #1e2433',
                background: '#0d1017', display: 'flex', flexDirection: 'column',
                overflow: 'auto',
            }}>
                {showForm ? (
                    /* ── New Meeting Form ── */
                    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 14 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <div>
                                <p style={{ fontSize: 14, fontWeight: 700, color: reschedulingMeeting ? '#fbbf24' : '#e2e8f0', margin: 0 }}>
                                    {reschedulingMeeting ? '📅 Reschedule Meeting' : 'New Meeting'}
                                </p>
                                {reschedulingMeeting && (
                                    <p style={{ fontSize: 11, color: '#8b95a9', margin: '2px 0 0' }}>
                                        Pick new date/time for "{reschedulingMeeting.title}"
                                    </p>
                                )}
                            </div>
                            <button onClick={() => { setShowForm(false); setReschedulingMeeting(null) }} style={{ background: 'none', border: 'none', color: '#4a5168', cursor: 'pointer', fontSize: 16 }}>✕</button>
                        </div>

                        {formError && (
                            <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)', borderRadius: 6, padding: '7px 10px', fontSize: 11, color: '#f87171' }}>
                                {formError}
                            </div>
                        )}

                        <Field label="Title">
                            <input value={form.title} onChange={e => setForm({ ...form, title: e.target.value })}
                                placeholder="e.g. Sprint Review" style={inputStyle} />
                        </Field>

                        <Field label="Date">
                            <input type="date" value={form.meeting_date} onChange={e => setForm({ ...form, meeting_date: e.target.value })}
                                style={inputStyle} />
                        </Field>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                            <Field label="Start">
                                <input type="time" value={form.start_time} onChange={e => setForm({ ...form, start_time: e.target.value })}
                                    style={inputStyle} />
                            </Field>
                            <Field label="End">
                                <input type="time" value={form.end_time} onChange={e => setForm({ ...form, end_time: e.target.value })}
                                    style={inputStyle} />
                            </Field>
                        </div>

                        <Field label="Attendees (optional)">
                            <input value={form.attendees} onChange={e => setForm({ ...form, attendees: e.target.value })}
                                placeholder="emails, comma-separated" style={inputStyle} />
                        </Field>

                        <button
                            onClick={handleSubmit}
                            disabled={saving}
                            style={{ ...btnStyle('rgba(79,142,247,0.15)', '#4f8ef7', true), opacity: saving ? 0.5 : 1, padding: '10px 0' }}
                        >
                            {saving ? 'Saving…' : reschedulingMeeting ? '✓ Save New Time' : '+ Save Meeting'}
                        </button>
                    </div>

                ) : detail ? (
                    /* ── Meeting Detail ── */
                    <div style={{ padding: 20, display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <p style={{ fontSize: 14, fontWeight: 700, color: '#e2e8f0', margin: 0 }}>Meeting Details</p>
                            <button onClick={() => setDetail(null)} style={{ background: 'none', border: 'none', color: '#4a5168', cursor: 'pointer', fontSize: 16 }}>✕</button>
                        </div>

                        {(() => {
                            const c = chipColor(detail.id)
                            return (
                                <div style={{ background: c.bg, border: `1px solid ${c.border}`, borderRadius: 10, padding: '14px 16px' }}>
                                    <p style={{ fontSize: 15, fontWeight: 700, color: c.text, margin: '0 0 8px' }}>{detail.title}</p>
                                    <p style={detailRow}> {detail.meeting_date}</p>
                                    <p style={detailRow}> {detail.start_time} – {detail.end_time}</p>
                                    {detail.attendees && <p style={detailRow}> {detail.attendees}</p>}
                                </div>
                            )
                        })()}

                        <button
                            onClick={() => handleDelete(detail.id)}
                            style={{ ...btnStyle('rgba(248,113,113,0.08)', '#f87171'), padding: '8px 0' }}
                        >
                            Delete Meeting
                        </button>
                    </div>

                ) : (
                    /* ── This month's list ── */
                    <div style={{ padding: 20 }}>
                        <p style={{ fontSize: 12, fontWeight: 600, color: '#4a5168', textTransform: 'uppercase', letterSpacing: 1, marginBottom: 12 }}>
                            {MONTHS[month]} Meetings
                        </p>
                        {monthMeetings.length === 0 ? (
                            <div style={{ color: '#2a3348', fontSize: 12, textAlign: 'center', marginTop: 32 }}>
                                No meetings this month.
                                <br /><br />
                                Click any day or "+ New Meeting" to add one.
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                {monthMeetings.map(m => {
                                    const c = chipColor(m.id)
                                    return (
                                        <div
                                            key={m.id}
                                            onClick={() => { setDetail(m); setShowForm(false) }}
                                            style={{
                                                background: c.bg, border: `1px solid ${c.border}`,
                                                borderRadius: 8, padding: '10px 12px', cursor: 'pointer',
                                            }}
                                        >
                                            <p style={{ fontSize: 13, fontWeight: 600, color: c.text, margin: '0 0 3px' }}>{m.title}</p>
                                            <p style={{ fontSize: 11, color: '#8b95a9', margin: 0 }}>
                                                {m.meeting_date} · {m.start_time}–{m.end_time}
                                            </p>
                                        </div>
                                    )
                                })}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>
    )
}

// ── Small helpers ─────────────────────────────────────────────────────────────
function Field({ label, children }) {
    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <label style={{ fontSize: 11, color: '#8b95a9', letterSpacing: 0.3 }}>{label}</label>
            {children}
        </div>
    )
}

const inputStyle = {
    width: '100%', padding: '8px 10px', background: '#111520',
    border: '1px solid #1e2433', borderRadius: 8, color: '#e2e8f0',
    fontSize: 13, outline: 'none', boxSizing: 'border-box',
    colorScheme: 'dark',
}

const detailRow = { fontSize: 12, color: '#8b95a9', margin: '0 0 4px' }

const navBtn = {
    background: 'transparent', border: '1px solid #1e2433', borderRadius: 6,
    color: '#8b95a9', fontSize: 16, cursor: 'pointer', width: 28, height: 28,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    transition: 'all 0.15s',
}

function btnStyle(bg, color, accent = false) {
    return {
        background: bg, border: `1px solid ${accent ? 'rgba(79,142,247,0.3)' : '#1e2433'}`,
        borderRadius: 8, color, fontSize: 12, fontWeight: 600,
        padding: '7px 14px', cursor: 'pointer', transition: 'all 0.15s',
        fontFamily: "'Inter', sans-serif",
    }
}

function cellStyle(isToday, isSelected, clickable) {
    return {
        minHeight: 80, background: isSelected ? 'rgba(79,142,247,0.06)' : isToday ? 'rgba(79,142,247,0.04)' : '#0d1017',
        border: `1px solid ${isToday ? 'rgba(79,142,247,0.35)' : '#1a2030'}`,
        borderRadius: 6, padding: '5px 6px',
        cursor: clickable ? 'pointer' : 'default',
        transition: 'background 0.12s',
        overflow: 'hidden',
    }
}
