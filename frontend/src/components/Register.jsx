/**
 * Register.jsx – Idle ring, auto‑capture sequence after user clicks "Start Enrolment"
 */

import React, { useState, useRef, useEffect } from 'react'
import Webcam from 'react-webcam'
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

    const webcamRef = useRef(null)
    const canvasRef = useRef(null)
    const intervalRef = useRef(null)

    const REQUIRED = 5
    const instructions = [
        'Look straight at the camera',
        'Slowly turn your head left',
        'Now turn your head right',
        'Tilt your head up slightly',
        'Tilt your head down slightly'
    ]

    // Cleanup interval on unmount
    useEffect(() => {
        return () => {
            if (intervalRef.current) clearInterval(intervalRef.current)
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
        // Webcam will start automatically
    }

    const startEnrolment = () => {
        if (enrolmentActive) return
        setFaceImages([])
        setInstruction(instructions[0])
        setEnrolmentActive(true)

        let captureCount = 0
        // Clear any existing interval
        if (intervalRef.current) clearInterval(intervalRef.current)

        intervalRef.current = setInterval(() => {
            if (captureCount >= REQUIRED) {
                clearInterval(intervalRef.current)
                intervalRef.current = null
                setEnrolmentActive(false)
                setInstruction('Enrolment complete!')
                return
            }

            // Capture image
            if (webcamRef.current) {
                const imageSrc = webcamRef.current.getScreenshot()
                if (imageSrc) {
                    setFaceImages(prev => {
                        const newImages = [...prev, imageSrc]
                        // Flash effect
                        setShowFlash(true)
                        setTimeout(() => setShowFlash(false), 200)
                        return newImages
                    })
                    captureCount++
                    if (captureCount < REQUIRED) {
                        setInstruction(instructions[captureCount])
                    }
                }
            }
        }, 1800) // 1.8 seconds between captures
    }

    const resetEnrolment = () => {
        if (intervalRef.current) {
            clearInterval(intervalRef.current)
            intervalRef.current = null
        }
        setFaceImages([])
        setInstruction('')
        setEnrolmentActive(false)
    }

    const removeImage = (idx) => {
        const newImages = faceImages.filter((_, i) => i !== idx)
        setFaceImages(newImages)
        // If we remove an image, we need to adjust the count
        // For simplicity, we'll just reset the enrolment state
        if (intervalRef.current) clearInterval(intervalRef.current)
        setEnrolmentActive(false)
        setInstruction('')
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

    const progressPercent = (faceImages.length / REQUIRED) * 100
    const circumference = 2 * Math.PI * 90
    const strokeDashoffset = circumference - (circumference * progressPercent) / 100

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
                        <div className="webcam-wrapper">
                            <Webcam
                                ref={webcamRef}
                                audio={false}
                                screenshotFormat="image/jpeg"
                                videoConstraints={{ width: 640, height: 480, facingMode: 'user' }}
                                className="webcam-feed"
                            />
                            {showFlash && <div className="flash-overlay"></div>}
                        </div>

                        <div className="progress-ring-large">
                            <svg className="progress-ring-svg" width="200" height="200">
                                <circle
                                    className="progress-ring-bg"
                                    cx="100" cy="100" r="90"
                                    fill="none"
                                    stroke="rgba(255,255,255,0.15)"
                                    strokeWidth="6"
                                />
                                <circle
                                    className="progress-ring-fill"
                                    cx="100" cy="100" r="90"
                                    fill="none"
                                    stroke="#34d399"
                                    strokeWidth="6"
                                    strokeLinecap="round"
                                    strokeDasharray={circumference}
                                    strokeDashoffset={strokeDashoffset}
                                    transform="rotate(-90 100 100)"
                                />
                            </svg>
                            <div className="progress-text">{faceImages.length}/{REQUIRED}</div>
                        </div>

                        <div className="instruction-box">
                            {!enrolmentActive && faceImages.length === 0 && (
                                <button className="start-button" onClick={startEnrolment}>
                                    Start Enrollment
                                </button>
                            )}
                            {enrolmentActive && (
                                <p className="instruction-title">{instruction}</p>
                            )}
                            {!enrolmentActive && faceImages.length > 0 && faceImages.length < REQUIRED && (
                                <button className="start-button" onClick={startEnrolment}>
                                    Resume Enrollment
                                </button>
                            )}
                            {faceImages.length === REQUIRED && (
                                <p className="instruction-title">Enrollment complete!</p>
                            )}
                        </div>

                        {faceImages.length > 0 && (
                            <div className="thumbnails-grid">
                                {faceImages.map((img, idx) => (
                                    <div key={idx} className="thumbnail-item">
                                        <img src={img} alt="face" />
                                        <button
                                            className="thumbnail-delete"
                                            onClick={() => removeImage(idx)}
                                            disabled={enrolmentActive}
                                        >
                                            ✖
                                        </button>
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
                            <button className="copy-button" onClick={copyPin}>
                                {pinCopied ? 'Copied!' : 'Copy'}
                            </button>
                        </div>
                        <p className="pin-note">This PIN has been sent to your email & SMS.</p>
                        <button className="btn-primary" onClick={onBackToLogin}>Go to Login</button>
                    </div>
                )}
            </div>

            <canvas ref={canvasRef} style={{ display: 'none' }} />
        </div>
    )
}

export default Register