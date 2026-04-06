/**
 * VerifyPin.jsx
 * Accepts the 6-digit PIN sent via Twilio SMS and POSTs to /api/auth/verify-pin.
 * Calls onSuccess(token, employee) when the JWT is returned.
 *
 * Props:
 *   pinData   — { pin_record_id, masked_phone, message }
 *   onSuccess — (token: string, employee: object) => void
 *   onBack    — () => void
 */

import { useState, useRef, useEffect } from 'react'

const API = '/api'
const PIN_LENGTH = 6

export default function VerifyPin({ pinData, onSuccess, onBack }) {
    const { pin_record_id, masked_phone, message } = pinData

    const [digits, setDigits] = useState(Array(PIN_LENGTH).fill(''))
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)
    const [countdown, setCountdown] = useState(5 * 60)  // 5 min in seconds
    const inputRefs = useRef([])

    useEffect(() => { inputRefs.current[0]?.focus() }, [])

    useEffect(() => {
        if (countdown <= 0) return
        const t = setInterval(() => setCountdown(c => c - 1), 1000)
        return () => clearInterval(t)
    }, [])

    const fmt = s => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
    const isExpired = countdown <= 0

    function handleChange(idx, value) {
        const digit = value.replace(/\D/g, '').slice(-1)
        const next = [...digits]
        next[idx] = digit
        setDigits(next)
        setError(null)
        if (digit && idx < PIN_LENGTH - 1) inputRefs.current[idx + 1]?.focus()
        if (digit && idx === PIN_LENGTH - 1) {
            const full = [...next.slice(0, idx), digit].join('')
            if (full.length === PIN_LENGTH) submitPin(full)
        }
    }

    function handleKeyDown(idx, e) {
        if (e.key === 'Backspace' && !digits[idx] && idx > 0)
            inputRefs.current[idx - 1]?.focus()
    }

    function handlePaste(e) {
        e.preventDefault()
        const pasted = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, PIN_LENGTH)
        if (!pasted) return
        const next = Array(PIN_LENGTH).fill('')
        pasted.split('').forEach((d, i) => { next[i] = d })
        setDigits(next)
        inputRefs.current[Math.min(pasted.length - 1, PIN_LENGTH - 1)]?.focus()
        if (pasted.length === PIN_LENGTH) submitPin(pasted)
    }

    async function submitPin(pin) {
        if (loading) return
        setError(null)
        setLoading(true)
        try {
            const res = await fetch(`${API}/auth/verify-pin`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ pin_record_id, pin_code: pin }),
            })
            const data = await res.json()
            if (!res.ok) {
                setError(data.detail || 'Incorrect PIN.')
                setDigits(Array(PIN_LENGTH).fill(''))
                inputRefs.current[0]?.focus()
                return
            }
            localStorage.setItem('hrms_token', data.access_token)
            localStorage.setItem('hrms_employee', JSON.stringify(data.employee))
            onSuccess(data.access_token, data.employee)
        } catch (err) {
            setError('Network error: ' + err.message)
        } finally {
            setLoading(false)
        }
    }

    function handleSubmit() {
        const pin = digits.join('')
        if (pin.length < PIN_LENGTH) { setError(`Enter all ${PIN_LENGTH} digits.`); return }
        submitPin(pin)
    }

    const btnDisabled = loading || isExpired || digits.join('').length < PIN_LENGTH

    return (
        <div style={S.page}>
            <div style={S.card}>
                <div style={S.logo}>H</div>
                <h1 style={S.title}>Verify Your Identity</h1>

                {/* SMS confirmation */}
                <div style={S.infoBox}>
                    <span style={{ fontSize: 22 }}>📱</span>
                    <div>
                        <p style={S.infoLabel}>PIN sent via SMS to</p>
                        <p style={S.infoPhone}>{masked_phone}</p>
                    </div>
                </div>

                {/* Countdown */}
                {!isExpired ? (
                    <p style={{ fontSize: 13, color: countdown < 60 ? '#f87171' : '#8b95a9', margin: 0 }}>
                        ⏱ Expires in <strong>{fmt(countdown)}</strong>
                    </p>
                ) : (
                    <div style={S.errBox}>⚠️ PIN expired — please go back and scan your face again.</div>
                )}

                {/* PIN inputs */}
                <div style={S.pinRow} onPaste={handlePaste}>
                    {digits.map((d, i) => (
                        <input
                            key={i}
                            ref={el => inputRefs.current[i] = el}
                            type="text"
                            inputMode="numeric"
                            maxLength={1}
                            value={d}
                            onChange={e => handleChange(i, e.target.value)}
                            onKeyDown={e => handleKeyDown(i, e)}
                            disabled={loading || isExpired}
                            style={{
                                ...S.pinInput,
                                borderColor: d ? '#4f8ef7' : '#1e2433',
                                background: d ? 'rgba(79,142,247,0.1)' : '#0d1017',
                            }}
                        />
                    ))}
                </div>

                {error && <div style={S.errBox}>⚠️ {error}</div>}

                <button
                    onClick={handleSubmit}
                    disabled={btnDisabled}
                    style={{ ...S.btn, opacity: btnDisabled ? 0.5 : 1, cursor: btnDisabled ? 'not-allowed' : 'pointer' }}
                >
                    {loading ? '⏳ Verifying…' : '✅ Verify PIN'}
                </button>

                <button onClick={onBack} style={S.backBtn}>
                    ← Go back and scan face again
                </button>
            </div>
        </div>
    )
}

const S = {
    page: { minHeight: '100vh', background: '#060812', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', sans-serif" },
    card: { background: '#111520', border: '1px solid #1e2433', borderRadius: 16, padding: '40px 36px', width: 440, maxWidth: '95vw', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 },
    logo: { width: 52, height: 52, background: 'linear-gradient(135deg,#4f8ef7,#7c3aed)', borderRadius: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 24, fontWeight: 700, color: '#fff' },
    title: { fontSize: 20, fontWeight: 700, color: '#e2e8f0', margin: 0 },
    infoBox: { width: '100%', background: 'rgba(79,142,247,0.08)', border: '1px solid rgba(79,142,247,0.2)', borderRadius: 10, padding: '14px 16px', display: 'flex', alignItems: 'center', gap: 12 },
    infoLabel: { fontSize: 11, color: '#8b95a9', margin: '0 0 2px', textTransform: 'uppercase', letterSpacing: '0.5px' },
    infoPhone: { fontSize: 16, fontWeight: 700, color: '#4f8ef7', margin: 0, fontFamily: 'monospace' },
    pinRow: { display: 'flex', gap: 10, justifyContent: 'center' },
    pinInput: { width: 50, height: 60, borderRadius: 10, border: '1.5px solid', fontSize: 24, fontWeight: 700, textAlign: 'center', color: '#e2e8f0', outline: 'none', transition: 'all 0.15s', fontFamily: 'monospace' },
    errBox: { width: '100%', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, padding: '10px 14px', fontSize: 13, color: '#f87171', textAlign: 'center' },
    btn: { width: '100%', padding: '14px 0', background: '#4f8ef7', border: 'none', borderRadius: 10, color: '#fff', fontSize: 15, fontWeight: 600, fontFamily: 'inherit' },
    backBtn: { background: 'transparent', border: 'none', color: '#8b95a9', fontSize: 13, cursor: 'pointer', fontFamily: 'inherit', textDecoration: 'underline' },
}
