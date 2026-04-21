/**
 * Register.jsx – Smooth green dot + stability ring for face enrolment
 */

import React, { useState, useRef, useEffect } from 'react'
import Webcam from 'react-webcam'
import { motion } from 'framer-motion'
import './Register.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const Register = ({ onBackToLogin }) => {
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
    const [faceCenter, setFaceCenter] = useState(null)     // { x, y }
    const [faceStable, setFaceStable] = useState(false)
    const [stabilityProgress, setStabilityProgress] = useState(0)  // 0-100

    const webcamRef = useRef(null)
    const canvasRef = useRef(null)
    const intervalRef = useRef(null)
    const detectionIntervalRef = useRef(null)
    const stabilityTimerRef = useRef(null)

    // Smoothing: keep last 5 centers
    const centerHistory = useRef([])
    const MAX_HISTORY = 5

    const REQUIRED = 5
    const TOTAL_TICKS = 60
    const TICKS_PER_CAPTURE = TOTAL_TICKS / REQUIRED

    const instructions = [
        'Look straight at the camera',
        'Slowly turn your head left',
        'Now turn your head right',
        'Tilt your head up slightly',
        'Tilt your head down slightly'
    ]

    useEffect(() => {
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current)
            if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current)
            if (stabilityTimerRef.current) clearTimeout(stabilityTimerRef.current)
        }
    }, [])

    const handleChange = (e) => {
        setForm({ ...form, [e.target.name]: e.target.value })
        setError('')
    }

    const handleRegisterSubmit = async (e) => {
        e.preventDefault()
        if (!form.name || !form.email || !form.phone) {
            setError('All fields are required')
            return
        }
        setStep(2)
    }

    // Smooth a new center point
    const addToHistory = (newCenter) => {
        centerHistory.current.push(newCenter)
        if (centerHistory.current.length > MAX_HISTORY) centerHistory.current.shift()
        // Average of history
        const avgX = centerHistory.current.reduce((sum, p) => sum + p.x, 0) / centerHistory.current.length
        const avgY = centerHistory.current.reduce((sum, p) => sum + p.y, 0) / centerHistory.current.length
        return { x: avgX, y: avgY }
    }

    const detectAndDraw = async () => {
        if (!webcamRef.current || step !== 2) return
        const imageSrc = webcamRef.current.getScreenshot()
        if (!imageSrc) return

        try {
            const res = await fetch('/api/auth/detect-faces', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_base64: imageSrc })
            })
            const data = await res.json()

            if (data.face_count !== 1) {
                setMultipleFaces(true)
                setFaceCenter(null)
                setFaceStable(false)
                setStabilityProgress(0)
                if (stabilityTimerRef.current) clearTimeout(stabilityTimerRef.current)
                setError(data.face_count === 0 ? 'No face detected. Please position your face.' : 'Multiple faces detected. Ensure only your face is visible.')
                // Clear canvas
                if (canvasRef.current) {
                    const ctx = canvasRef.current.getContext('2d')
                    ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
                }
                return
            }

            setMultipleFaces(false)
            setError('')

            if (data.primary_box && canvasRef.current && webcamRef.current.video) {
                const video = webcamRef.current.video
                const videoWidth = video.videoWidth
                const videoHeight = video.videoHeight
                const canvasWidth = canvasRef.current.clientWidth
                const canvasHeight = canvasRef.current.clientHeight
                const scaleX = canvasWidth / videoWidth
                const scaleY = canvasHeight / videoHeight
                const [x1, y1, x2, y2] = data.primary_box
                const center = {
                    x: ((x1 + x2) / 2) * scaleX,
                    y: ((y1 + y2) / 2) * scaleY
                }
                // Smooth center
                const smoothed = addToHistory(center)
                setFaceCenter(smoothed)

                // Stability: if center has moved less than a threshold over last 0.5 sec
                // For simplicity, we'll just set a timer that resets on movement
                if (stabilityTimerRef.current) clearTimeout(stabilityTimerRef.current)
                stabilityTimerRef.current = setTimeout(() => {
                    setFaceStable(true)
                    setStabilityProgress(100)
                }, 1000)
                setFaceStable(false)
                // Update progress smoothly (we'll animate with a simple interval later, but for now just show 0-100)
                // We'll use a separate effect to update progress
            }
        } catch (err) {
            console.error('Detection error:', err)
        }
    }

    // Animate stability progress when waiting for stable face
    useEffect(() => {
        let progressInterval = null
        if (faceCenter && !faceStable && !multipleFaces && step === 2) {
            let progress = 0
            const startTime = Date.now()
            progressInterval = setInterval(() => {
                const elapsed = Date.now() - startTime
                const newProgress = Math.min(100, (elapsed / 1000) * 100)
                setStabilityProgress(newProgress)
                if (newProgress >= 100) {
                    clearInterval(progressInterval)
                }
            }, 50)
        } else {
            if (!faceCenter || multipleFaces) setStabilityProgress(0)
        }
        return () => {
            if (progressInterval) clearInterval(progressInterval)
        }
    }, [faceCenter, faceStable, multipleFaces, step])

    // Draw the dot and stability ring on canvas
    useEffect(() => {
        if (!canvasRef.current || !faceCenter) return
        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        const width = canvas.clientWidth
        const height = canvas.clientHeight
        canvas.width = width
        canvas.height = height
        ctx.clearRect(0, 0, width, height)

        // Draw stability ring (outer circle that fills)
        const radius = 24
        const stableRadius = radius + (stabilityProgress / 100) * 12
        ctx.beginPath()
        ctx.arc(faceCenter.x, faceCenter.y, stableRadius, 0, 2 * Math.PI)
        ctx.strokeStyle = '#22c55e'
        ctx.lineWidth = 2
        ctx.stroke()

        // Draw inner dot
        ctx.beginPath()
        ctx.arc(faceCenter.x, faceCenter.y, 6, 0, 2 * Math.PI)
        ctx.fillStyle = '#22c55e'
        ctx.fill()

        // If stable, draw a solid inner circle
        if (faceStable) {
            ctx.beginPath()
            ctx.arc(faceCenter.x, faceCenter.y, 10, 0, 2 * Math.PI)
            ctx.fillStyle = '#22c55e'
            ctx.fill()
        }
    }, [faceCenter, stabilityProgress, faceStable])

    // Start continuous detection
    useEffect(() => {
        if (step === 2) {
            if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current)
            detectionIntervalRef.current = setInterval(detectAndDraw, 200)
        }
        return () => {
            if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current)
        }
    }, [step])

    // Resize canvas when video loads
    useEffect(() => {
        const video = webcamRef.current?.video
        if (video && video.videoWidth && canvasRef.current) {
            canvasRef.current.width = video.clientWidth
            canvasRef.current.height = video.clientHeight
        }
    }, [step, webcamRef.current?.video])

    const captureImage = async () => {
        if (!webcamRef.current) return
        const imageSrc = webcamRef.current.getScreenshot()
        if (!imageSrc) return

        // Final validation before capturing
        try {
            const res = await fetch('/api/auth/detect-faces', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_base64: imageSrc })
            })
            const data = await res.json()
            if (data.face_count !== 1) {
                setMultipleFaces(true)
                setError(data.face_count === 0 ? 'No face detected. Please position your face.' : 'Multiple faces detected. Ensure only your face is visible.')
                return
            }
            setMultipleFaces(false)
            setError('')
        } catch (err) {
            setError('Face detection failed. Please try again.')
            return
        }

        setFaceImages(prev => [...prev, imageSrc])
        setShowFlash(true)
        setTimeout(() => setShowFlash(false), 200)
        setCaptureCount(prev => prev + 1)
    }

    const startEnrolment = () => {
        if (enrolmentActive) return
        setFaceImages([])
        setCaptureCount(0)
        setInstruction(instructions[0])
        setEnrolmentActive(true)

        if (intervalRef.current) clearInterval(intervalRef.current)

        let currentCapture = 0
        intervalRef.current = setInterval(async () => {
            if (currentCapture >= REQUIRED) {
                clearInterval(intervalRef.current)
                intervalRef.current = null
                setEnrolmentActive(false)
                setInstruction('Enrolment complete!')
                return
            }
            await captureImage()
            currentCapture++
            if (currentCapture < REQUIRED) {
                setInstruction(instructions[currentCapture])
            }
        }, 1500)
    }

    const resetEnrolment = () => {
        if (intervalRef.current) clearInterval(intervalRef.current)
        if (detectionIntervalRef.current) clearInterval(detectionIntervalRef.current)
        setFaceImages([])
        setCaptureCount(0)
        setInstruction('')
        setEnrolmentActive(false)
        setMultipleFaces(false)
        setFaceCenter(null)
        setFaceStable(false)
        setStabilityProgress(0)
        setError('')
        if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d')
            ctx.clearRect(0, 0, canvasRef.current.width, canvasRef.current.height)
        }
        if (step === 2) {
            detectionIntervalRef.current = setInterval(detectAndDraw, 200)
        }
    }

    const removeImage = (idx) => {
        const newImages = faceImages.filter((_, i) => i !== idx)
        setFaceImages(newImages)
        setCaptureCount(newImages.length)
        if (intervalRef.current) clearInterval(intervalRef.current)
        setEnrolmentActive(false)
        setInstruction('')
        setMultipleFaces(false)
        setFaceCenter(null)
        setFaceStable(false)
        setStabilityProgress(0)
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
                    face_images: faceImages
                })
            })
            const data = await res.json()
            if (!res.ok) throw new Error(data.detail || 'Registration failed')
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
        const center = 90
        const radius = 80
        const tickLength = 10
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
                    x1={startX}
                    y1={startY}
                    x2={endX}
                    y2={endY}
                    stroke={isActive ? '#34d399' : '#2a3348'}
                    strokeWidth="3"
                    strokeLinecap="round"
                    initial={{ scale: 1, opacity: 0.6 }}
                    animate={isActive ? { scale: [1, 1.2, 1], opacity: [0.6, 1, 0.6] } : { scale: 1, opacity: 0.4 }}
                    transition={isActive ? { duration: 0.4, repeat: Infinity, repeatDelay: 0.8 } : { duration: 0 }}
                />
            )
        }
        return ticks
    }

    return (
        <div className="register-container">
            <div className="register-card">
                {/* ... header, steps, step 1 form (unchanged) ... */}
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
                        <div className="form-group">
                            <label>Full Name</label>
                            <input type="text" name="name" value={form.name} onChange={handleChange} required />
                        </div>
                        <div className="form-group">
                            <label>Email</label>
                            <input type="email" name="email" value={form.email} onChange={handleChange} required />
                        </div>
                        <div className="form-group">
                            <label>Phone (10 digits)</label>
                            <input type="tel" name="phone" value={form.phone} onChange={handleChange} required />
                        </div>
                        <button type="submit" className="btn-primary">Continue to Face Capture →</button>
                        <button type="button" className="btn-secondary" onClick={onBackToLogin}>← Back to Login</button>
                    </form>
                )}

                {step === 2 && (
                    <div className="face-capture-step">
                        <div className={`webcam-wrapper ${multipleFaces ? 'multiple-faces' : ''}`}>
                            <Webcam
                                ref={webcamRef}
                                audio={false}
                                screenshotFormat="image/jpeg"
                                videoConstraints={{ width: 640, height: 480, facingMode: 'user' }}
                                className="webcam-feed"
                                onUserMedia={() => {
                                    const video = webcamRef.current?.video
                                    if (video && canvasRef.current) {
                                        canvasRef.current.width = video.clientWidth
                                        canvasRef.current.height = video.clientHeight
                                    }
                                }}
                            />
                            <canvas
                                ref={canvasRef}
                                className="face-bounding-box"
                                style={{
                                    position: 'absolute',
                                    top: 0,
                                    left: 0,
                                    width: '100%',
                                    height: '100%',
                                    pointerEvents: 'none'
                                }}
                            />
                            {showFlash && <div className="flash-overlay"></div>}
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
                            {faceImages.length === REQUIRED && <p className="instruction-title">Enrollment complete!</p>}
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
                            <div className="pin-box" onClick={copyPin}>
                                <span className="pin-value">{defaultPin}</span>
                            </div>
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

export default Register