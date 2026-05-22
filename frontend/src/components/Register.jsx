/**
 * Register.jsx – Face enrolment with auto‑retry (no manual resume needed)
 * Error clearing now only happens when the user edits the offending field.
 *
 * Step 3 changes:
 *  - Hide/Show text replaced with eye SVG icon
 *  - Added "Save PIN" button (copies to clipboard + shows confirmation)
 *  - PIN hidden by default, revealed on eye toggle
 */

import React, { useState, useRef, useEffect, useCallback } from 'react'
import Webcam from 'react-webcam'
import { motion } from 'framer-motion'
import './Register.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'
const CAPTURE_W = 640
const CAPTURE_H = 480
const REQUIRED = 5
const TOTAL_TICKS = 60
const TICKS_PER_CAPTURE = TOTAL_TICKS / REQUIRED

const INSTRUCTIONS = [
    'Look straight at the camera',
    'Slowly turn your head left',
    'Now turn your head right',
    'Tilt your head up slightly',
    'Tilt your head down slightly',
]

function captureFrame(videoEl, w = CAPTURE_W, h = CAPTURE_H) {
    const c = document.createElement('canvas')
    c.width = w
    c.height = h
    c.getContext('2d').drawImage(videoEl, 0, 0, w, h)
    return c.toDataURL('image/jpeg', 0.9)
}

// ── Eye SVG icons ─────────────────────────────────────────────────────────────
function EyeOpenIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
            <circle cx="12" cy="12" r="3" />
        </svg>
    )
}

function EyeClosedIcon() {
    return (
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
            <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
            <line x1="1" y1="1" x2="23" y2="23" />
        </svg>
    )
}

export default function Register({ onBackToLogin }) {
    const [step, setStep] = useState(1)
    const [form, setForm] = useState({ name: '', email: '', phone: '' })
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [faceImages, setFaceImages] = useState([])
    const [defaultPin, setDefaultPin] = useState('')
    const [pinVisible, setPinVisible] = useState(false)     // hidden by default
    const [pinSaved, setPinSaved] = useState(false)
    const [instruction, setInstruction] = useState('')
    const [showFlash, setShowFlash] = useState(false)
    const [enrolmentActive, setEnrolmentActive] = useState(false)
    const [captureCount, setCaptureCount] = useState(0)
    const [multipleFaces, setMultipleFaces] = useState(false)

    const webcamRef = useRef(null)
    const canvasRef = useRef(null)
    const wrapperRef = useRef(null)
    const abortControllerRef = useRef(null)

    useEffect(() => {
        return () => {
            if (abortControllerRef.current) abortControllerRef.current.abort()
        }
    }, [])

    // ── Error clearing: only when the user edits the field that caused the error ──
    const handleChange = (e) => {
        const { name, value } = e.target
        setForm({ ...form, [name]: value })
        if (error) {
            if ((error.toLowerCase().includes('email') && name === 'email') ||
                (error.toLowerCase().includes('phone') && name === 'phone')) {
                setError('')
            }
        }
    }

    const handleRegisterSubmit = async (e) => {
        e.preventDefault()
        if (!form.name || !form.email || !form.phone) {
            setError('All fields are required')
            return
        }
        setStep(2)
    }

    // ── Face detection and drawing (unchanged) ────────────────────────────────
    const detectAndDraw = useCallback(async () => {
        if (step !== 2) return
        const video = webcamRef.current?.video
        if (!video || video.readyState < 2) return
        const wrapper = wrapperRef.current
        if (!wrapper) return
        const dispW = wrapper.offsetWidth
        const dispH = wrapper.offsetHeight
        if (!dispW || !dispH) return
        const canvas = canvasRef.current
        if (!canvas) return
        if (canvas.width !== dispW || canvas.height !== dispH) {
            canvas.width = dispW
            canvas.height = dispH
        }
        const imageSrc = captureFrame(video)
        try {
            const res = await fetch('/api/auth/detect-faces', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_base64: imageSrc }),
            })
            if (!res.ok) return
            const data = await res.json()
            const ctx = canvas.getContext('2d')
            ctx.clearRect(0, 0, dispW, dispH)
            if (data.face_count !== 1 || !data.primary_box) {
                setMultipleFaces(data.face_count > 1)
                setError(data.face_count === 0
                    ? 'No face detected. Please position your face.'
                    : 'Multiple faces detected. Ensure only your face is visible.')
                return
            }
            setMultipleFaces(false)
            setError('')
            const [x1, y1, x2, y2] = data.primary_box
            const scaleX = dispW / CAPTURE_W
            const scaleY = dispH / CAPTURE_H
            const sx1 = x1 * scaleX, sy1 = y1 * scaleY
            const sx2 = x2 * scaleX, sy2 = y2 * scaleY
            const drawX = dispW - sx2, drawY = sy1
            const drawW = sx2 - sx1, drawH = sy2 - sy1
            ctx.strokeStyle = '#22c55e'
            ctx.lineWidth = 3
            ctx.strokeRect(drawX, drawY, drawW, drawH)
        } catch (err) {
            console.error('Detection error:', err)
        }
    }, [step])

    useEffect(() => {
        let interval
        if (step === 2) interval = setInterval(detectAndDraw, 300)
        return () => clearInterval(interval)
    }, [step, detectAndDraw])

    // ── Enrolment auto‑retry loop (unchanged) ─────────────────────────────────
    const startEnrolment = async () => {
        if (enrolmentActive) return
        setFaceImages([])
        setCaptureCount(0)
        setEnrolmentActive(true)
        setError('')
        setMultipleFaces(false)

        let currentCount = 0
        const abortController = new AbortController()
        abortControllerRef.current = abortController

        while (currentCount < REQUIRED && !abortController.signal.aborted) {
            setInstruction(INSTRUCTIONS[currentCount])
            await new Promise(r => setTimeout(r, 1000))
            if (abortController.signal.aborted) break

            const video = webcamRef.current?.video
            if (!video || video.readyState < 2) continue
            const imageSrc = captureFrame(video)
            let valid = false
            try {
                const res = await fetch('/api/auth/detect-faces', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image_base64: imageSrc }),
                    signal: abortController.signal,
                })
                const data = await res.json()
                if (data.face_count === 1) {
                    valid = true
                    setMultipleFaces(false)
                    setError('')
                } else {
                    setMultipleFaces(data.face_count > 1)
                    setError(data.face_count === 0
                        ? 'No face detected. Please position your face.'
                        : 'Multiple faces detected. Ensure only your face is visible.')
                }
            } catch (err) {
                if (err.name === 'AbortError') break
                console.error(err)
            }
            if (valid) {
                setFaceImages(prev => [...prev, imageSrc])
                setShowFlash(true)
                setTimeout(() => setShowFlash(false), 200)
                currentCount++
                setCaptureCount(currentCount)
                await new Promise(r => setTimeout(r, 500))
            } else {
                await new Promise(r => setTimeout(r, 800))
            }
        }
        setEnrolmentActive(false)
        if (currentCount >= REQUIRED) {
            setInstruction('Enrolment complete!')
        } else {
            setError('Enrolment was interrupted. Click "Resume Enrollment" to continue.')
        }
        abortControllerRef.current = null
    }

    const resetEnrolment = () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
            abortControllerRef.current = null
        }
        setFaceImages([])
        setCaptureCount(0)
        setEnrolmentActive(false)
        setError('')
        setMultipleFaces(false)
        setInstruction('')
    }

    const removeImage = (idx) => {
        const newImages = faceImages.filter((_, i) => i !== idx)
        setFaceImages(newImages)
        setCaptureCount(newImages.length)
        if (abortControllerRef.current) {
            abortControllerRef.current.abort()
            abortControllerRef.current = null
        }
        setEnrolmentActive(false)
        setInstruction('')
        setError('')
    }

    const submitFaceAndRegister = async () => {
        if (faceImages.length < 3) {
            setError('Please capture at least 3 face images')
            return
        }
        setLoading(true)
        setError('')
        try {
            const res = await fetch(`${API_URL}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: form.name,
                    email: form.email,
                    phone: form.phone,
                    face_images: faceImages,
                }),
            })
            if (!res.ok) {
                const err = await res.json()
                throw new Error(err.detail || 'Registration failed')
            }
            const data = await res.json()
            setDefaultPin(data.default_pin)
            setStep(3)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    // ── Save PIN — copies to clipboard ───────────────────────────────────────
    const savePin = async () => {
        try {
            await navigator.clipboard.writeText(defaultPin)
            setPinSaved(true)
            setTimeout(() => setPinSaved(false), 3000)
        } catch {
            // fallback: select text
            const el = document.createElement('textarea')
            el.value = defaultPin
            document.body.appendChild(el)
            el.select()
            document.execCommand('copy')
            document.body.removeChild(el)
            setPinSaved(true)
            setTimeout(() => setPinSaved(false), 3000)
        }
    }

    const renderTicks = () => {
        const ticks = []
        const center = 90, radius = 80, tickLength = 10
        const activeTicks = Math.min(TOTAL_TICKS, Math.floor(captureCount * TICKS_PER_CAPTURE))
        for (let i = 0; i < TOTAL_TICKS; i++) {
            const angle = (i * 360) / TOTAL_TICKS - 90
            const rad = (angle * Math.PI) / 180
            const startX = center + (radius - tickLength) * Math.cos(rad)
            const startY = center + (radius - tickLength) * Math.sin(rad)
            const endX = center + radius * Math.cos(rad)
            const endY = center + radius * Math.sin(rad)
            const isActive = i < activeTicks
            ticks.push(
                <motion.line
                    key={i}
                    x1={startX} y1={startY} x2={endX} y2={endY}
                    stroke={isActive ? '#34d399' : '#2a3348'}
                    strokeWidth="3" strokeLinecap="round"
                    initial={{ opacity: 0.6 }}
                    animate={isActive ? { opacity: [0.6, 1, 0.6] } : { opacity: 0.4 }}
                    transition={isActive ? { duration: 0.4, repeat: Infinity, repeatDelay: 0.8 } : { duration: 0 }}
                />
            )
        }
        return ticks
    }

    // ── Masked PIN display ────────────────────────────────────────────────────
    const pinDigits = defaultPin ? defaultPin.split('') : []

    return (
        <div className="register-container">
            <div className="register-card">
                <div className="register-header">
                    <h2>Create Account</h2>
                    <p className="subtitle">Face + PIN authentication</p>
                </div>

                <div className="steps-indicator">
                    <div className={`step ${step >= 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''}`}>1. Details</div>
                    <div className={`step ${step >= 2 ? 'active' : ''} ${step > 2 ? 'completed' : ''}`}>2. Face</div>
                    <div className={`step ${step >= 3 ? 'active' : ''}`}>3. PIN</div>
                </div>

                {error && <div className="message error">{error}</div>}

                {/* ── Step 1: Details ───────────────────────────────────── */}
                {step === 1 && (
                    <form onSubmit={handleRegisterSubmit} className="register-form">
                        <div className="form-group">
                            <label>Full Name</label>
                            <input type="text" name="name" value={form.name} onChange={handleChange} required />
                        </div>
                        <div className="form-group">
                            <label>Email</label>
                            <input type="email" name="email" value={form.email} onChange={handleChange} required />
                        </div>
                        <div className="form-group">
                            <label>Phone (E.164 format, e.g. +919876543210)</label>
                            <input type="tel" name="phone" value={form.phone} onChange={handleChange} required />
                        </div>
                        <button type="submit" className="btn-primary">Continue to Face Capture →</button>
                        <button type="button" className="btn-secondary" onClick={onBackToLogin}>← Back to Login</button>
                    </form>
                )}

                {/* ── Step 2: Face capture ──────────────────────────────── */}
                {step === 2 && (
                    <div className="face-capture-step">
                        <div ref={wrapperRef} className={`webcam-wrapper ${multipleFaces ? 'multiple-faces' : ''}`}>
                            <Webcam
                                ref={webcamRef}
                                audio={false}
                                screenshotFormat="image/jpeg"
                                videoConstraints={{ width: CAPTURE_W, height: CAPTURE_H, facingMode: 'user' }}
                                className="webcam-feed"
                            />
                            <canvas
                                ref={canvasRef}
                                className="face-bounding-box"
                                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }}
                            />
                            {showFlash && <div className="flash-overlay" />}
                        </div>

                        <div className="progress-ring-large">
                            <svg className="progress-ring-svg" width="180" height="180" viewBox="0 0 180 180">
                                {renderTicks()}
                            </svg>
                            <div className="progress-text">{captureCount}/{REQUIRED}</div>
                        </div>

                        <div className="instruction-box">
                            {!enrolmentActive && faceImages.length === 0 && (
                                <button className="start-button" onClick={startEnrolment}>Start Enrollment</button>
                            )}
                            {enrolmentActive && <p className="instruction-title">{instruction}</p>}
                            {!enrolmentActive && faceImages.length > 0 && faceImages.length < REQUIRED && (
                                <button className="start-button" onClick={startEnrolment}>Resume Enrollment</button>
                            )}
                            {faceImages.length === REQUIRED && <p className="instruction-title">✅ Enrollment complete!</p>}
                        </div>

                        {faceImages.length > 0 && (
                            <div className="thumbnails-grid">
                                {faceImages.map((img, idx) => (
                                    <div key={idx} className="thumbnail-item">
                                        <img src={img} alt="face" />
                                        <button className="thumbnail-delete" onClick={() => removeImage(idx)} disabled={enrolmentActive}>✖</button>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className="action-buttons">
                            <button className="btn-secondary" onClick={resetEnrolment} disabled={loading}>Reset</button>
                            <button className="btn-secondary" onClick={() => setStep(1)} disabled={loading}>Back</button>
                        </div>

                        {faceImages.length >= 3 && (
                            <button className="btn-primary" onClick={submitFaceAndRegister} disabled={loading} style={{ marginTop: 12 }}>
                                {loading ? 'Registering...' : 'Complete Registration'}
                            </button>
                        )}
                    </div>
                )}

                {/* ── Step 3: PIN display ───────────────────────────────── */}
                {step === 3 && defaultPin && (
                    <div className="pin-display-step">
                        {/* Success icon */}
                        <div style={{
                            width: 56, height: 56, borderRadius: '50%',
                            background: 'rgba(52,211,153,0.12)',
                            border: '2px solid rgba(52,211,153,0.35)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 24, margin: '0 auto 14px',
                        }}>✓</div>

                        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', margin: '0 0 6px', textAlign: 'center' }}>
                            Registration Complete!
                        </h3>

                        {/* SMS info strip */}
                        <div style={{
                            background: 'rgba(79,142,247,0.07)',
                            border: '1px solid rgba(79,142,247,0.18)',
                            borderRadius: 10,
                            padding: '12px 16px',
                            marginBottom: 16,
                            textAlign: 'center',
                        }}>
                            <div style={{ fontSize: 10, color: '#4a5168', letterSpacing: '0.5px', marginBottom: 4, textTransform: 'uppercase' }}>
                                PIN sent via SMS to
                            </div>
                            <div style={{ fontSize: 15, fontWeight: 700, color: '#4f8ef7', letterSpacing: '2px', fontFamily: 'monospace' }}>
                                {'*'.repeat(Math.max(0, form.phone.length - 4))}{form.phone.slice(-4)}
                            </div>
                        </div>

                        {/* PIN card */}
                        <div style={{
                            background: 'rgba(12,16,28,0.8)',
                            border: '1px solid rgba(79,142,247,0.15)',
                            borderRadius: 12,
                            padding: '16px 18px',
                            marginBottom: 16,
                        }}>
                            {/* Card header: label + eye toggle */}
                            <div style={{
                                display: 'flex', alignItems: 'center',
                                justifyContent: 'space-between',
                                marginBottom: 14,
                            }}>
                                <span style={{ fontSize: 12, color: '#475569', fontWeight: 500 }}>
                                    Your Default PIN
                                </span>
                                {/* Eye icon toggle — replaces Hide/Show text */}
                                <button
                                    onClick={() => setPinVisible(v => !v)}
                                    title={pinVisible ? 'Hide PIN' : 'Show PIN'}
                                    style={{
                                        background: 'rgba(79,142,247,0.08)',
                                        border: '1px solid rgba(79,142,247,0.2)',
                                        borderRadius: 6,
                                        padding: '5px 8px',
                                        color: '#4f8ef7',
                                        cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        transition: 'background 0.15s',
                                    }}
                                    onMouseEnter={e => e.currentTarget.style.background = 'rgba(79,142,247,0.18)'}
                                    onMouseLeave={e => e.currentTarget.style.background = 'rgba(79,142,247,0.08)'}
                                >
                                    {pinVisible ? <EyeClosedIcon /> : <EyeOpenIcon />}
                                </button>
                            </div>

                            {/* PIN digits */}
                            <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 14 }}>
                                {pinDigits.map((digit, i) => (
                                    <div key={i} style={{
                                        width: 42, height: 48,
                                        background: 'rgba(79,142,247,0.06)',
                                        border: '1.5px solid rgba(79,142,247,0.2)',
                                        borderRadius: 9,
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        fontSize: pinVisible ? 22 : 26,
                                        fontWeight: 700,
                                        color: '#e2e8f0',
                                        fontFamily: 'monospace',
                                        letterSpacing: 0,
                                        transition: 'all 0.2s',
                                        userSelect: 'none',
                                    }}>
                                        {pinVisible ? digit : '•'}
                                    </div>
                                ))}
                            </div>

                            {/* Save PIN button */}
                            <button
                                onClick={savePin}
                                style={{
                                    width: '100%',
                                    padding: '9px 0',
                                    background: pinSaved
                                        ? 'rgba(52,211,153,0.12)'
                                        : 'rgba(79,142,247,0.1)',
                                    border: `1px solid ${pinSaved ? 'rgba(52,211,153,0.35)' : 'rgba(79,142,247,0.3)'}`,
                                    borderRadius: 8,
                                    color: pinSaved ? '#34d399' : '#4f8ef7',
                                    fontSize: 13,
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    transition: 'all 0.2s',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                                    fontFamily: 'inherit',
                                }}
                                onMouseEnter={e => {
                                    if (!pinSaved) e.currentTarget.style.background = 'rgba(79,142,247,0.18)'
                                }}
                                onMouseLeave={e => {
                                    if (!pinSaved) e.currentTarget.style.background = 'rgba(79,142,247,0.1)'
                                }}
                            >
                                {pinSaved ? (
                                    <>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                                            <polyline points="20 6 9 17 4 12" />
                                        </svg>
                                        PIN Saved to Clipboard!
                                    </>
                                ) : (
                                    <>
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                                            <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" />
                                            <polyline points="17 21 17 13 7 13 7 21" />
                                            <polyline points="7 3 7 8 15 8" />
                                        </svg>
                                        Save PIN
                                    </>
                                )}
                            </button>
                        </div>

                        <p style={{ fontSize: 11, color: '#4a5168', textAlign: 'center', margin: '0 0 16px', lineHeight: 1.5 }}>
                            Use this PIN to log in. You can change it later from your profile settings.
                        </p>

                        <button className="btn-primary" onClick={onBackToLogin} style={{ width: '100%' }}>
                            Go to Login →
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}