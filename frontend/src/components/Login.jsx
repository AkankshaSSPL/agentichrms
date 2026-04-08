/**
 * Login.jsx — Direct permanent PIN login + optional PIN change on the same screen
 *
 * Layout: wide horizontal card (≈780px) — left branding strip, right active form.
 * Face flow:  user clicks "Open Face Scanner" → camera starts → oval → "Scan Face" → API → JWT
 * PIN flow:   identifier + current PIN (6 digits) → login
 *             optional new PIN + confirm → changes PIN and logs in
 */

import { useState, useRef, useEffect, useCallback } from 'react'

const API = '/api'

// ── Spinner ────────────────────────────────────────────────────────────────────
function Spinner({ size = 16 }) {
    return (
        <span style={{
            display: 'inline-block',
            width: size, height: size,
            border: `2px solid rgba(255,255,255,.25)`,
            borderTopColor: '#fff',
            borderRadius: '50%',
            animation: 'spin .65s linear infinite',
            flexShrink: 0,
        }} />
    )
}

// ── Method selector tabs ───────────────────────────────────────────────────────
function MethodTabs({ active, onChange }) {
    return (
        <div style={{
            display: 'flex',
            background: '#0a0e1a',
            borderRadius: 10,
            padding: 4,
            gap: 4,
            width: '100%',
        }}>
            {[
                { id: 'face', label: '📷  Face' },
                { id: 'pin', label: '🔢  PIN' },
            ].map(m => (
                <button
                    key={m.id}
                    onClick={() => onChange(m.id)}
                    style={{
                        flex: 1,
                        padding: '9px 0',
                        borderRadius: 7,
                        border: 'none',
                        background: active === m.id ? '#4f8ef7' : 'transparent',
                        color: active === m.id ? '#fff' : '#4a5168',
                        fontSize: 13,
                        fontWeight: 600,
                        cursor: 'pointer',
                        transition: 'all .2s',
                        fontFamily: 'inherit',
                        letterSpacing: '.3px',
                    }}
                >
                    {m.label}
                </button>
            ))}
        </div>
    )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main component
// ─────────────────────────────────────────────────────────────────────────────
export default function Login({ onSuccess, onRegisterClick }) {
    const [method, setMethod] = useState('face')

    // Face state
    const videoRef = useRef(null)
    const streamRef = useRef(null)
    const [cameraErr, setCameraErr] = useState('')
    const [faceStatus, setFaceStatus] = useState('idle')
    const [faceMsg, setFaceMsg] = useState('')
    const [showFaceScanner, setShowFaceScanner] = useState(false)

    // PIN state (direct permanent PIN)
    const [pinIdentifier, setPinIdentifier] = useState('')
    const [currentPin, setCurrentPin] = useState('')
    const [newPin, setNewPin] = useState('')
    const [confirmNewPin, setConfirmNewPin] = useState('')
    const [pinBusy, setPinBusy] = useState(false)
    const [pinErr, setPinErr] = useState('')

    // ── Camera lifecycle ───────────────────────────────────────────────────────
    const startCamera = useCallback(async () => {
        setCameraErr('')
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 1280, height: 720, facingMode: 'user' },
            })
            streamRef.current = stream
            if (videoRef.current) videoRef.current.srcObject = stream
        } catch {
            setCameraErr('Camera access denied — please allow camera and refresh.')
        }
    }, [])

    const stopCamera = useCallback(() => {
        streamRef.current?.getTracks().forEach(t => t.stop())
        streamRef.current = null
    }, [])

    const openFaceScanner = useCallback(async () => {
        setShowFaceScanner(true)
        await startCamera()
    }, [startCamera])

    useEffect(() => {
        return () => stopCamera()
    }, [stopCamera])

    // ── Face: scan + login ─────────────────────────────────────────────────────
    async function handleFaceScan() {
        if (!videoRef.current || faceStatus === 'scanning') return
        setFaceStatus('scanning')
        setFaceMsg('')
        try {
            const canvas = document.createElement('canvas')
            canvas.width = videoRef.current.videoWidth
            canvas.height = videoRef.current.videoHeight
            canvas.getContext('2d').drawImage(videoRef.current, 0, 0)
            const image_base64 = canvas.toDataURL('image/jpeg', 0.9)

            const res = await fetch(`${API}/auth/face-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_base64 }),
            })
            const data = await res.json()

            if (!res.ok) {
                setFaceStatus('error')
                setFaceMsg(data.detail || 'Face not recognized. Please try again.')
                return
            }

            stopCamera()
            localStorage.setItem('hrms_token', data.access_token)
            localStorage.setItem('hrms_employee', JSON.stringify(data.employee))
            onSuccess(data.access_token, data.employee)
        } catch {
            setFaceStatus('error')
            setFaceMsg('Network error. Check your connection.')
        }
    }

    // ── PIN: login (and optionally change PIN) ─────────────────────────────────
    async function handlePinLoginOrChange() {
        if (pinBusy) return
        if (!pinIdentifier.trim() || currentPin.length !== 6) {
            setPinErr('Email/phone and 6-digit current PIN are required.')
            return
        }
        if (newPin && newPin !== confirmNewPin) {
            setPinErr('New PIN and confirmation do not match.')
            return
        }
        if (newPin && newPin.length !== 6) {
            setPinErr('New PIN must be exactly 6 digits.')
            return
        }

        setPinBusy(true)
        setPinErr('')

        try {
            let url, body
            if (newPin) {
                url = `${API}/auth/verify-and-change-pin`
                body = {
                    identifier: pinIdentifier.trim(),
                    current_pin: currentPin,
                    new_pin: newPin,
                }
            } else {
                url = `${API}/auth/login-with-pin`
                body = {
                    identifier: pinIdentifier.trim(),
                    pin: currentPin,
                }
            }

            const res = await fetch(url, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            })
            const data = await res.json()

            if (!res.ok) {
                setPinErr(data.detail || 'Login failed. Check your credentials.')
                return
            }

            localStorage.setItem('hrms_token', data.access_token)
            localStorage.setItem('hrms_employee', JSON.stringify(data.employee))
            onSuccess(data.access_token, data.employee)
        } catch {
            setPinErr('Network error. Check your connection.')
        } finally {
            setPinBusy(false)
        }
    }

    // ── Switch method — reset all states ──────────────────────────────────────
    function switchMethod(m) {
        setMethod(m)
        setFaceStatus('idle')
        setFaceMsg('')
        setPinIdentifier('')
        setCurrentPin('')
        setNewPin('')
        setConfirmNewPin('')
        setPinErr('')
        if (m !== 'face') {
            setShowFaceScanner(false)
            stopCamera()
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // Render
    // ─────────────────────────────────────────────────────────────────────────
    return (
        <div style={{
            minHeight: '100vh',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: '#060812',
            padding: 24,
            fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
            position: 'relative',
        }}>
            <style>{`
                @keyframes spin { to { transform: rotate(360deg) } }
                @keyframes fadeUp {
                    from { opacity: 0; transform: translateY(10px) }
                    to   { opacity: 1; transform: translateY(0) }
                }
                input:focus { border-color: #4f8ef7 !important; }
            `}</style>

            {/* Outer card */}
            <div style={{
                display: 'flex',
                width: '100%',
                maxWidth: 780,
                background: '#111520',
                border: '1px solid #1e2433',
                borderRadius: 20,
                overflow: 'hidden',
                boxShadow: '0 24px 80px rgba(0,0,0,.5)',
                animation: 'fadeUp .4s ease both',
            }}>
                {/* Left branding strip (unchanged) */}
                <div style={{
                    width: 220,
                    flexShrink: 0,
                    background: 'linear-gradient(160deg, #0d1220 0%, #060c1a 100%)',
                    borderRight: '1px solid #1e2433',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'flex-start',
                    justifyContent: 'space-between',
                    padding: '36px 28px',
                }}>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
                        <div style={{
                            width: 44, height: 44,
                            background: 'linear-gradient(135deg,#4f8ef7,#7c3aed)',
                            borderRadius: 12,
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 20, fontWeight: 800, color: '#fff',
                        }}>H</div>
                        <div>
                            <p style={{ fontSize: 17, fontWeight: 700, color: '#e2e8f0', margin: 0 }}>
                                Agentic HRMS
                            </p>
                            <p style={{ fontSize: 12, color: '#4a5168', margin: '4px 0 0', lineHeight: 1.5 }}>
                                Secure employee portal
                            </p>
                        </div>
                    </div>
                    <div style={{ fontSize: 10, color: '#2a3348', letterSpacing: '.5px', textTransform: 'uppercase' }}>
                        v1.0 · Agentic Systems
                    </div>
                </div>

                {/* Right panel */}
                <div style={{
                    flex: 1,
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '36px 40px',
                    gap: 24,
                    minWidth: 0,
                }}>
                    <div>
                        <p style={{ fontSize: 20, fontWeight: 700, color: '#e2e8f0', margin: 0 }}>
                            Welcome back
                        </p>
                        <p style={{ fontSize: 13, color: '#4a5168', margin: '4px 0 0' }}>
                            Sign in to your HRMS account
                        </p>
                    </div>

                    <MethodTabs active={method} onChange={switchMethod} />

                    {/* Face panel (unchanged) */}
                    {method === 'face' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'fadeUp .25s ease both' }}>
                            {showFaceScanner && (
                                <div style={{
                                    position: 'relative',
                                    borderRadius: 12,
                                    overflow: 'hidden',
                                    background: '#0a0e1a',
                                    border: '1px solid #1e2433',
                                    aspectRatio: '16/9',
                                }}>
                                    {cameraErr ? (
                                        <div style={{
                                            position: 'absolute', inset: 0,
                                            display: 'flex', flexDirection: 'column',
                                            alignItems: 'center', justifyContent: 'center',
                                            color: '#f87171', fontSize: 12, gap: 8, padding: 16,
                                            textAlign: 'center',
                                        }}>
                                            <span style={{ fontSize: 28 }}>📷</span>
                                            {cameraErr}
                                        </div>
                                    ) : (
                                        <>
                                            <video
                                                ref={videoRef}
                                                autoPlay playsInline muted
                                                style={{ width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)', display: 'block' }}
                                            />
                                            <div style={{
                                                position: 'absolute',
                                                top: '50%', left: '50%',
                                                transform: 'translate(-50%,-50%)',
                                                width: '38%', height: '80%',
                                                border: `2px solid ${faceStatus === 'error' ? '#f87171' : '#4f8ef7'}`,
                                                borderRadius: '50%',
                                                pointerEvents: 'none',
                                                boxShadow: faceStatus === 'error'
                                                    ? '0 0 0 2000px rgba(6,8,18,.4)'
                                                    : '0 0 0 2000px rgba(6,8,18,.35)',
                                                transition: 'border-color .3s',
                                            }} />
                                        </>
                                    )}
                                </div>
                            )}
                            {showFaceScanner && (
                                <p style={{ fontSize: 12, color: '#4a5168', margin: 0, textAlign: 'center' }}>
                                    Centre your face in the oval and press <strong style={{ color: '#8b95a9' }}>Scan</strong>
                                </p>
                            )}
                            {faceMsg && (
                                <div style={{
                                    background: 'rgba(248,113,113,.08)',
                                    border: '1px solid rgba(248,113,113,.25)',
                                    borderRadius: 8,
                                    padding: '9px 14px',
                                    color: '#f87171', fontSize: 12, textAlign: 'center',
                                }}>
                                    ⚠️ {faceMsg}
                                </div>
                            )}
                            <button
                                onClick={showFaceScanner ? handleFaceScan : openFaceScanner}
                                disabled={(showFaceScanner && (!!cameraErr || faceStatus === 'scanning'))}
                                style={{
                                    padding: '12px 0',
                                    background: (showFaceScanner && faceStatus === 'scanning') ? '#3b6fd4' : '#4f8ef7',
                                    border: 'none', borderRadius: 10,
                                    color: '#fff', fontSize: 14, fontWeight: 600,
                                    cursor: (showFaceScanner && (!!cameraErr || faceStatus === 'scanning')) ? 'not-allowed' : 'pointer',
                                    opacity: (showFaceScanner && !!cameraErr) ? 0.45 : 1,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                                    transition: 'background .2s',
                                    fontFamily: 'inherit',
                                }}
                            >
                                {!showFaceScanner ? '📷  Open Face Scanner' : (faceStatus === 'scanning' ? <><Spinner /> Recognizing…</> : '📸  Scan Face')}
                            </button>
                        </div>
                    )}

                    {/* NEW PIN panel – direct permanent PIN + optional change */}
                    {method === 'pin' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, animation: 'fadeUp .25s ease both' }}>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <label style={{ fontSize: 12, color: '#8b95a9', letterSpacing: '.3px' }}>
                                    Email or phone number
                                </label>
                                <input
                                    value={pinIdentifier}
                                    onChange={e => setPinIdentifier(e.target.value)}
                                    placeholder="name@company.com  or  +91 98765 43210"
                                    style={{
                                        width: '100%',
                                        padding: '12px 14px',
                                        background: '#0a0e1a',
                                        border: '1px solid #1e2433',
                                        borderRadius: 10,
                                        color: '#e2e8f0',
                                        fontSize: 13,
                                        outline: 'none',
                                    }}
                                />
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <label style={{ fontSize: 12, color: '#8b95a9', letterSpacing: '.3px' }}>
                                    Current PIN (6 digits)
                                </label>
                                <input
                                    type="password"
                                    inputMode="numeric"
                                    maxLength={6}
                                    value={currentPin}
                                    onChange={e => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    placeholder="••••••"
                                    style={{
                                        width: '100%',
                                        padding: '12px 14px',
                                        background: '#0a0e1a',
                                        border: '1px solid #1e2433',
                                        borderRadius: 10,
                                        color: '#e2e8f0',
                                        fontSize: 16,
                                        textAlign: 'center',
                                        letterSpacing: 4,
                                        fontFamily: 'monospace',
                                    }}
                                />
                            </div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                <label style={{ fontSize: 12, color: '#8b95a9', letterSpacing: '.3px' }}>
                                    New PIN (optional – leave blank to keep current)
                                </label>
                                <input
                                    type="password"
                                    inputMode="numeric"
                                    maxLength={6}
                                    value={newPin}
                                    onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                    placeholder="••••••"
                                    style={{
                                        width: '100%',
                                        padding: '12px 14px',
                                        background: '#0a0e1a',
                                        border: '1px solid #1e2433',
                                        borderRadius: 10,
                                        color: '#e2e8f0',
                                        fontSize: 16,
                                        textAlign: 'center',
                                        letterSpacing: 4,
                                        fontFamily: 'monospace',
                                    }}
                                />
                            </div>

                            {newPin.length > 0 && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                                    <label style={{ fontSize: 12, color: '#8b95a9', letterSpacing: '.3px' }}>
                                        Confirm New PIN
                                    </label>
                                    <input
                                        type="password"
                                        inputMode="numeric"
                                        maxLength={6}
                                        value={confirmNewPin}
                                        onChange={e => setConfirmNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                        placeholder="••••••"
                                        style={{
                                            width: '100%',
                                            padding: '12px 14px',
                                            background: '#0a0e1a',
                                            border: '1px solid #1e2433',
                                            borderRadius: 10,
                                            color: '#e2e8f0',
                                            fontSize: 16,
                                            textAlign: 'center',
                                            letterSpacing: 4,
                                            fontFamily: 'monospace',
                                        }}
                                    />
                                </div>
                            )}

                            {pinErr && (
                                <div style={{
                                    background: 'rgba(248,113,113,.08)',
                                    border: '1px solid rgba(248,113,113,.25)',
                                    borderRadius: 8,
                                    padding: '9px 14px',
                                    color: '#f87171', fontSize: 12, textAlign: 'center',
                                }}>
                                    ⚠️ {pinErr}
                                </div>
                            )}

                            <button
                                onClick={handlePinLoginOrChange}
                                disabled={pinBusy || !pinIdentifier.trim() || currentPin.length !== 6 || (newPin.length > 0 && newPin !== confirmNewPin)}
                                style={{
                                    padding: '12px 0',
                                    background: '#4f8ef7',
                                    border: 'none',
                                    borderRadius: 10,
                                    color: '#fff',
                                    fontSize: 14,
                                    fontWeight: 600,
                                    cursor: (pinBusy || !pinIdentifier.trim() || currentPin.length !== 6 || (newPin.length > 0 && newPin !== confirmNewPin)) ? 'not-allowed' : 'pointer',
                                    opacity: (!pinIdentifier.trim() || currentPin.length !== 6 || (newPin.length > 0 && newPin !== confirmNewPin)) ? 0.45 : 1,
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: 8,
                                    transition: 'background .2s',
                                    fontFamily: 'inherit',
                                }}
                            >
                                {pinBusy ? <><Spinner /> Processing…</> : (newPin ? 'Change PIN & Sign In' : 'Sign In with PIN')}
                            </button>
                        </div>
                    )}

                    {/* Registration link */}
                    <div style={{ textAlign: 'center', marginTop: 8 }}>
                        <button
                            onClick={onRegisterClick}
                            style={{
                                background: 'none',
                                border: 'none',
                                color: '#4f8ef7',
                                fontSize: 13,
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                                textDecoration: 'underline',
                            }}
                        >
                            New employee? Register here →
                        </button>
                    </div>
                </div>
            </div>
        </div>
    )
}