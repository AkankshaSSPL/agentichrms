/**
 * Register.jsx – Face enrolment with auto‑retry (no manual resume needed)
 * Error clearing now only happens when the user edits the offending field.
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

export default function Register({ onBackToLogin }) {
    const [step, setStep] = useState(1)
    const [form, setForm] = useState({ name: '', email: '', phone: '' })
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [faceImages, setFaceImages] = useState([])
    const [defaultPin, setDefaultPin] = useState('')
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
        return () => {
            if (abortControllerRef.current) abortControllerRef.current.abort()
        }
    }, [])

    // ── Error clearing: only when the user edits the field that caused the error ──
    const handleChange = (e) => {
        const { name, value } = e.target
        setForm({ ...form, [name]: value })

        // Clear error only if the user is typing in the field that caused it
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

    // ── Face detection and drawing (unchanged) ──────────────────────────────────
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
                setError(data.face_count === 0 ? 'No face detected. Please position your face.' : 'Multiple faces detected. Ensure only your face is visible.')
                return
            }
            setMultipleFaces(false)
            setError('')
            const [x1, y1, x2, y2] = data.primary_box
            const scaleX = dispW / CAPTURE_W
            const scaleY = dispH / CAPTURE_H
            const sx1 = x1 * scaleX
            const sy1 = y1 * scaleY
            const sx2 = x2 * scaleX
            const sy2 = y2 * scaleY
            const drawX = dispW - sx2
            const drawY = sy1
            const drawW = sx2 - sx1
            const drawH = sy2 - sy1
            ctx.strokeStyle = '#22c55e'
            ctx.lineWidth = 3
            ctx.strokeRect(drawX, drawY, drawW, drawH)
        } catch (err) {
            console.error('Detection error:', err)
        }
    }, [step])

    useEffect(() => {
        let interval
        if (step === 2) {
            interval = setInterval(detectAndDraw, 300)
        }
        return () => clearInterval(interval)
    }, [step, detectAndDraw])

    // ── Enrolment auto‑retry loop (unchanged) ───────────────────────────────────
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
                    setError(data.face_count === 0 ? 'No face detected. Please position your face.' : 'Multiple faces detected. Ensure only your face is visible.')
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

    const copyPin = async () => {
        await navigator.clipboard.writeText(defaultPin)
        setPinCopied(true)
        setTimeout(() => setPinCopied(false), 2000)
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

                {step === 1 && (
                    <form onSubmit={handleRegisterSubmit} className="register-form">
                        <div className="form-group"><label>Full Name</label><input type="text" name="name" value={form.name} onChange={handleChange} required /></div>
                        <div className="form-group"><label>Email</label><input type="email" name="email" value={form.email} onChange={handleChange} required /></div>
                        <div className="form-group"><label>Phone (E.164 format, e.g. +919876543210)</label><input type="tel" name="phone" value={form.phone} onChange={handleChange} required /></div>
                        <button type="submit" className="btn-primary">Continue to Face Capture →</button>
                        <button type="button" className="btn-secondary" onClick={onBackToLogin}>← Back to Login</button>
                    </form>
                )}

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
                            <canvas ref={canvasRef} className="face-bounding-box" style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%', pointerEvents: 'none' }} />
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

                {step === 3 && defaultPin && (
                    <div className="pin-display-step">
                        <div className="success-icon">✓</div>
                        <h3>Registration Complete!</h3>
                        <p>Your permanent login PIN is:</p>
                        <div className="pin-display-wrapper">
                            <div className="pin-box" onClick={copyPin}><span className="pin-value">{defaultPin}</span></div>
                            <button className="copy-button" onClick={copyPin}>{pinCopied ? 'Copied!' : 'Copy'}</button>
                        </div>
                        <p className="pin-note">This PIN has been sent to your email & SMS.</p>
                        <button className="btn-primary" onClick={onBackToLogin}>Go to Login</button>
                    </div>
                )}
            </div>
        </div>
    )
}