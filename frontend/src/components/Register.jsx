/**
 * Register.jsx – Face enrolment with auto-retry
 * Fixed: removed default_pin (backend no longer returns it),
 *        step 3 shows SMS confirmation,
 *        inline error with "Login instead?" for duplicate email/phone.
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
    c.width = w; c.height = h
    c.getContext('2d').drawImage(videoEl, 0, 0, w, h)
    return c.toDataURL('image/jpeg', 0.9)
}

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
    const [errorType, setErrorType] = useState('') // 'duplicate' | ''
    const [fieldErrors, setFieldErrors] = useState({}) // inline per-field errors
    const [loading, setLoading] = useState(false)
    const [faceImages, setFaceImages] = useState([])
    const [smsInfo, setSmsInfo] = useState(null) // { masked_phone, sms_sent, pin }
    const [pinCopied, setPinCopied] = useState(false)
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
        return () => { if (abortControllerRef.current) abortControllerRef.current.abort() }
    }, [])

    const handleChange = (e) => {
        const { name, value } = e.target
        setForm({ ...form, [name]: value })
        if (fieldErrors[name]) setFieldErrors(fe => ({ ...fe, [name]: '' }))
        if (error) {
            if ((error.toLowerCase().includes('email') && name === 'email') ||
                (error.toLowerCase().includes('phone') && name === 'phone')) {
                setError(''); setErrorType('')
            }
        }
    }

    const handleRegisterSubmit = async (e) => {
        e.preventDefault()
        const fe = {}
        if (!form.name) fe.name = 'Full name is required'
        if (!form.email) fe.email = 'Email is required'
        if (!form.phone) fe.phone = 'Phone number is required'
        if (Object.keys(fe).length > 0) { setFieldErrors(fe); return }
        setStep(2)
    }

    const detectAndDraw = useCallback(async () => {
        if (step !== 2) return
        const video = webcamRef.current?.video
        if (!video || video.readyState < 2) return
        const wrapper = wrapperRef.current
        if (!wrapper) return
        const dispW = wrapper.offsetWidth, dispH = wrapper.offsetHeight
        if (!dispW || !dispH) return
        const canvas = canvasRef.current
        if (!canvas) return
        if (canvas.width !== dispW || canvas.height !== dispH) { canvas.width = dispW; canvas.height = dispH }
        const imageSrc = captureFrame(video)
        try {
            const res = await fetch('/api/auth/detect-faces', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_base64: imageSrc }),
            })
            if (!res.ok) return
            const data = await res.json()
            const ctx = canvas.getContext('2d')
            ctx.clearRect(0, 0, dispW, dispH)
            if (data.face_count !== 1 || !data.primary_box) {
                setMultipleFaces(data.face_count > 1)
                setError(data.face_count === 0 ? 'No face detected. Please position your face.'
                    : 'Multiple faces detected. Ensure only your face is visible.')
                return
            }
            setMultipleFaces(false); setError(''); setErrorType('')
            const [x1, y1, x2, y2] = data.primary_box
            const scaleX = dispW / CAPTURE_W, scaleY = dispH / CAPTURE_H
            const sx1 = x1 * scaleX, sy1 = y1 * scaleY, sx2 = x2 * scaleX, sy2 = y2 * scaleY
            const drawX = dispW - sx2, drawY = sy1, drawW = sx2 - sx1, drawH = sy2 - sy1
            ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 3
            ctx.strokeRect(drawX, drawY, drawW, drawH)
        } catch (err) { console.error('Detection error:', err) }
    }, [step])

    useEffect(() => {
        let interval
        if (step === 2) interval = setInterval(detectAndDraw, 300)
        return () => clearInterval(interval)
    }, [step, detectAndDraw])

    const startEnrolment = async () => {
        if (enrolmentActive) return
        setFaceImages([]); setCaptureCount(0); setEnrolmentActive(true)
        setError(''); setErrorType(''); setMultipleFaces(false)
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
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ image_base64: imageSrc }),
                    signal: abortController.signal,
                })
                const data = await res.json()
                if (data.face_count === 1) { valid = true; setMultipleFaces(false); setError(''); setErrorType('') }
                else {
                    setMultipleFaces(data.face_count > 1)
                    setError(data.face_count === 0 ? 'No face detected. Please position your face.'
                        : 'Multiple faces detected. Ensure only your face is visible.')
                }
            } catch (err) { if (err.name === 'AbortError') break; console.error(err) }
            if (valid) {
                setFaceImages(prev => [...prev, imageSrc]); setShowFlash(true)
                setTimeout(() => setShowFlash(false), 200)
                currentCount++; setCaptureCount(currentCount)
                await new Promise(r => setTimeout(r, 500))
            } else { await new Promise(r => setTimeout(r, 800)) }
        }
        setEnrolmentActive(false)
        if (currentCount >= REQUIRED) setInstruction('Enrolment complete!')
        else setError('Enrolment was interrupted. Click "Resume Enrollment" to continue.')
        abortControllerRef.current = null
    }

    const resetEnrolment = () => {
        if (abortControllerRef.current) { abortControllerRef.current.abort(); abortControllerRef.current = null }
        setFaceImages([]); setCaptureCount(0); setEnrolmentActive(false)
        setError(''); setErrorType(''); setMultipleFaces(false); setInstruction('')
    }

    const removeImage = (idx) => {
        const newImages = faceImages.filter((_, i) => i !== idx)
        setFaceImages(newImages); setCaptureCount(newImages.length)
        if (abortControllerRef.current) { abortControllerRef.current.abort(); abortControllerRef.current = null }
        setEnrolmentActive(false); setInstruction(''); setError(''); setErrorType('')
    }

    const submitFaceAndRegister = async () => {
        if (faceImages.length < 3) { setError('Please capture at least 3 face images'); return }
        setLoading(true); setError(''); setErrorType('')
        try {
            const res = await fetch(`${API_URL}/api/auth/register`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: form.name, email: form.email, phone: form.phone, face_images: faceImages }),
            })
            if (!res.ok) {
                const err = await res.json()
                const msg = err.detail || 'Registration failed'
                // Detect duplicate email/phone to show login link and inline field error
                if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('already exists')) {
                    setErrorType('duplicate')
                    if (msg.toLowerCase().includes('email')) setFieldErrors(fe => ({ ...fe, email: 'This email is already registered' }))
                    else if (msg.toLowerCase().includes('phone')) setFieldErrors(fe => ({ ...fe, phone: 'This phone number is already registered' }))
                }
                throw new Error(msg)
            }
            const data = await res.json()
            setSmsInfo({ masked_phone: data.masked_phone, sms_sent: data.sms_sent, pin: data.pin })
            setStep(3)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
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
                <motion.line key={i} x1={startX} y1={startY} x2={endX} y2={endY}
                    stroke={isActive ? '#34d399' : '#2a3348'} strokeWidth="3" strokeLinecap="round"
                    initial={{ opacity: 0.6 }}
                    animate={isActive ? { opacity: [0.6, 1, 0.6] } : { opacity: 0.4 }}
                    transition={isActive ? { duration: 0.4, repeat: Infinity, repeatDelay: 0.8 } : { duration: 0 }}
                />
            )
        }
        return ticks
    }

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
                    <div className={`step ${step >= 3 ? 'active' : ''}`}>3. Done</div>
                </div>

                {/* Error banner — with login link for duplicates */}
                {error && (
                    <div className="message error">
                        {error}
                        {errorType === 'duplicate' && (
                            <span> <button
                                onClick={onBackToLogin}
                                style={{ background: 'none', border: 'none', color: 'inherit', textDecoration: 'underline', cursor: 'pointer', fontWeight: 700, fontSize: 'inherit' }}
                            >Login instead →</button></span>
                        )}
                    </div>
                )}

                {/* ── Step 1: Details ── */}
                {step === 1 && (
                    <form onSubmit={handleRegisterSubmit} className="register-form">
                        <div className="form-group">
                            <label>Full Name</label>
                            <input type="text" name="name" value={form.name} onChange={handleChange} required
                                style={fieldErrors.name ? { borderColor: '#f87171' } : {}} />
                            {fieldErrors.name && <div style={{ color: '#f87171', fontSize: 11, marginTop: 4 }}>⚠ {fieldErrors.name}</div>}
                        </div>
                        <div className="form-group">
                            <label>Email</label>
                            <input type="email" name="email" value={form.email} onChange={handleChange} required
                                style={fieldErrors.email ? { borderColor: '#f87171' } : {}} />
                            {fieldErrors.email && <div style={{ color: '#f87171', fontSize: 11, marginTop: 4 }}>⚠ {fieldErrors.email}</div>}
                        </div>
                        <div className="form-group">
                            <label>Phone (E.164 format, e.g. +919876543210)</label>
                            <input type="tel" name="phone" value={form.phone} onChange={handleChange} required
                                style={fieldErrors.phone ? { borderColor: '#f87171' } : {}} />
                            {fieldErrors.phone && <div style={{ color: '#f87171', fontSize: 11, marginTop: 4 }}>⚠ {fieldErrors.phone}</div>}
                        </div>
                        <button type="submit" className="btn-primary">Continue to Face Capture →</button>
                        <button type="button" className="btn-secondary" onClick={onBackToLogin}>← Back to Login</button>
                    </form>
                )}

                {/* ── Step 2: Face capture ── */}
                {step === 2 && (
                    <div className="face-capture-step">
                        <div ref={wrapperRef} className={`webcam-wrapper ${multipleFaces ? 'multiple-faces' : ''}`}>
                            <Webcam ref={webcamRef} audio={false} screenshotFormat="image/jpeg"
                                videoConstraints={{ width: CAPTURE_W, height: CAPTURE_H, facingMode: 'user' }}
                                className="webcam-feed" />
                            <canvas ref={canvasRef} className="face-bounding-box"
                                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
                            {showFlash && <div className="flash-overlay" />}
                        </div>
                        {error && (
                            <div style={{ color: '#f87171', fontSize: 12, marginTop: 8, textAlign: 'center', padding: '6px 12px', background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 8 }}>
                                ⚠ {error}
                            </div>
                        )}

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

                {/* ── Step 3: Confirmation ── */}
                {step === 3 && smsInfo && (
                    <div className="pin-display-step">
                        <div style={{
                            width: 56, height: 56, borderRadius: '50%',
                            background: 'rgba(52,211,153,0.12)', border: '2px solid rgba(52,211,153,0.35)',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 24, margin: '0 auto 14px',
                        }}>✓</div>

                        <h3 style={{ fontSize: 18, fontWeight: 700, color: '#e2e8f0', margin: '0 0 6px', textAlign: 'center' }}>
                            Registration Complete!
                        </h3>

                        {smsInfo.sms_sent ? (
                            <div style={{
                                background: 'rgba(52,211,153,0.07)', border: '1px solid rgba(52,211,153,0.2)',
                                borderRadius: 10, padding: '16px', marginBottom: 16, textAlign: 'center',
                            }}>
                                <div style={{ fontSize: 13, color: '#34d399', fontWeight: 600, marginBottom: 6 }}>
                                    📱 PIN sent via SMS
                                </div>
                                <div style={{ fontSize: 12, color: '#94a3b8', marginBottom: 4 }}>Your login PIN was sent to</div>
                                <div style={{ fontSize: 16, fontWeight: 700, color: '#4f8ef7', fontFamily: 'monospace', letterSpacing: 2 }}>
                                    {smsInfo.masked_phone}
                                </div>
                                {smsInfo.pin && (
                                    <div style={{ marginTop: 14 }}>
                                        <div style={{ fontSize: 11, color: '#64748b', marginBottom: 6 }}>Your PIN</div>
                                        <div style={{
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
                                            background: 'rgba(79,142,247,0.08)', border: '1px solid rgba(79,142,247,0.25)',
                                            borderRadius: 8, padding: '10px 16px',
                                        }}>
                                            <span style={{ fontSize: 28, fontWeight: 800, color: '#e2e8f0', fontFamily: 'monospace', letterSpacing: 6 }}>
                                                {smsInfo.pin}
                                            </span>
                                            <button
                                                onClick={() => {
                                                    navigator.clipboard.writeText(smsInfo.pin)
                                                    setPinCopied(true)
                                                    setTimeout(() => setPinCopied(false), 2000)
                                                }}
                                                style={{
                                                    background: pinCopied ? 'rgba(52,211,153,0.15)' : 'rgba(79,142,247,0.15)',
                                                    border: `1px solid ${pinCopied ? 'rgba(52,211,153,0.4)' : 'rgba(79,142,247,0.4)'}`,
                                                    borderRadius: 6, color: pinCopied ? '#34d399' : '#4f8ef7',
                                                    fontSize: 11, fontWeight: 600, padding: '5px 10px',
                                                    cursor: 'pointer', transition: 'all 0.2s', whiteSpace: 'nowrap',
                                                }}
                                            >
                                                {pinCopied ? '✓ Copied' : 'Copy'}
                                            </button>
                                        </div>
                                        <div style={{ fontSize: 10, color: '#4a5168', marginTop: 6 }}>
                                            Save this PIN — it won't be shown again.
                                        </div>
                                    </div>
                                )}
                                <div style={{ fontSize: 11, color: '#64748b', marginTop: 8 }}>
                                    Check your SMS to get your PIN. You can change it after logging in.
                                </div>
                            </div>
                        ) : (
                            <div style={{
                                background: 'rgba(251,191,36,0.07)', border: '1px solid rgba(251,191,36,0.2)',
                                borderRadius: 10, padding: '16px', marginBottom: 16, textAlign: 'center',
                            }}>
                                <div style={{ fontSize: 13, color: '#fbbf24', fontWeight: 600, marginBottom: 6 }}>
                                    ⚠️ SMS could not be sent
                                </div>
                                <div style={{ fontSize: 12, color: '#94a3b8' }}>
                                    Your account was created but we couldn't send the PIN via SMS.
                                    Please contact HR to receive your login PIN.
                                </div>
                            </div>
                        )}

                        <p style={{ fontSize: 11, color: '#4a5168', textAlign: 'center', margin: '0 0 16px', lineHeight: 1.5 }}>
                            Use the PIN from your SMS to log in. You can change it anytime from your profile.
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