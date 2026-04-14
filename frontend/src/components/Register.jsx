/**
 * Register.jsx - Registration with Progressive Face Capture
 * Updated with:
 * 1. Progressive auto-capture (like phone face enrollment)
 * 2. Copy button next to default PIN
 */

import React, { useState, useRef, useCallback, useEffect } from 'react'
import Webcam from 'react-webcam'
import './Register.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const Register = ({ onSuccess, onBackToLogin }) => {
    const [step, setStep] = useState(1) // 1: Info, 2: Face Capture, 3: PIN Display
    const [formData, setFormData] = useState({
        name: '',
        email: '',
        password: '',
        phone: ''
    })

    // Face capture state
    const [faceImages, setFaceImages] = useState([])
    const [isCapturing, setIsCapturing] = useState(false)
    const [captureProgress, setCaptureProgress] = useState(0)
    const [showFlash, setShowFlash] = useState(false)

    // Registration data
    const [userId, setUserId] = useState(null)
    const [defaultPin, setDefaultPin] = useState('')
    const [pinCopied, setPinCopied] = useState(false)

    // UI state
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')

    const webcamRef = useRef(null)
    const captureIntervalRef = useRef(null)

    const REQUIRED_IMAGES = 5
    const CAPTURE_INTERVAL = 1000 // 1 second between captures

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            if (captureIntervalRef.current) {
                clearInterval(captureIntervalRef.current)
            }
        }
    }, [])

    // Handle form input changes
    const handleChange = (e) => {
        setFormData({
            ...formData,
            [e.target.name]: e.target.value
        })
        setError('')
    }

    // ============ STEP 1: REGISTER ============

    const handleSubmitInfo = async (e) => {
        e.preventDefault()
        setLoading(true)
        setError('')

        try {
            // Validation
            if (formData.password.length < 8) {
                throw new Error('Password must be at least 8 characters')
            }

            if (formData.phone.length < 10) {
                throw new Error('Phone number must be at least 10 digits')
            }

            // Move to face capture
            setStep(2)
            setMessage('Now let\'s capture your face for secure login')

        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    // ============ STEP 2: PROGRESSIVE FACE CAPTURE ============

    const handleWebcamReady = useCallback(() => {
        // Auto-start capturing after webcam is ready
        if (!isCapturing && faceImages.length === 0) {
            setTimeout(() => {
                startProgressiveCapture()
            }, 1000)
        }
    }, [isCapturing, faceImages.length])

    const startProgressiveCapture = () => {
        if (faceImages.length >= REQUIRED_IMAGES || isCapturing) return

        setIsCapturing(true)
        setError('')
        setCaptureProgress(0)

        captureIntervalRef.current = setInterval(() => {
            captureFrame()
        }, CAPTURE_INTERVAL)
    }

    const captureFrame = () => {
        if (!webcamRef.current) return

        const imageSrc = webcamRef.current.getScreenshot()

        if (imageSrc) {
            // Flash effect
            setShowFlash(true)
            setTimeout(() => setShowFlash(false), 200)

            // Add image
            setFaceImages(prev => {
                const newImages = [...prev, imageSrc]

                // Update progress
                const progress = (newImages.length / REQUIRED_IMAGES) * 100
                setCaptureProgress(progress)

                // Stop if we have enough images
                if (newImages.length >= REQUIRED_IMAGES) {
                    stopCapture()
                }

                return newImages
            })
        }
    }

    const stopCapture = () => {
        if (captureIntervalRef.current) {
            clearInterval(captureIntervalRef.current)
            captureIntervalRef.current = null
        }
        setIsCapturing(false)
    }

    const resetCapture = () => {
        stopCapture()
        setFaceImages([])
        setCaptureProgress(0)
        setError('')
    }

    const removeImage = (index) => {
        setFaceImages(prev => prev.filter((_, i) => i !== index))
        const newProgress = ((faceImages.length - 1) / REQUIRED_IMAGES) * 100
        setCaptureProgress(newProgress)
    }

    // ============ STEP 3: COMPLETE REGISTRATION ============

    const handleCompleteRegistration = async () => {
        setLoading(true)
        setError('')

        try {
            if (faceImages.length < 3) {
                throw new Error('Please capture at least 3 face images')
            }

            const response = await fetch(`${API_URL}/api/auth/register`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    ...formData,
                    face_images: faceImages
                })
            })

            const data = await response.json()

            if (!response.ok) {
                throw new Error(data.detail || 'Registration failed')
            }

            setUserId(data.user_id)
            setDefaultPin(data.default_pin)
            setStep(3)
            setMessage('Registration successful!')

        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    // ============ COPY PIN TO CLIPBOARD ============

    const copyPinToClipboard = async () => {
        try {
            await navigator.clipboard.writeText(defaultPin)
            setPinCopied(true)
            setTimeout(() => setPinCopied(false), 2000)
        } catch (err) {
            console.error('Failed to copy PIN:', err)
        }
    }

    const handlePinBoxClick = () => {
        copyPinToClipboard()
    }

    // ============ PROCEED TO LOGIN ============

    const handleProceedToLogin = () => {
        // In a real app, this would redirect to login or auto-login
        if (onSuccess) {
            onSuccess({ user_id: userId, email: formData.email })
        }
    }

    // ============ RENDER ============

    return (
        <div className="register-container">
            <div className="register-card">

                {/* Header */}
                <div className="register-header">
                    <h2>Create Account</h2>
                    <p className="subtitle">Join Agentic HRMS</p>
                </div>

                {/* Step Indicator */}
                <div className="steps-indicator">
                    <div className={`step ${step >= 1 ? 'active' : ''} ${step > 1 ? 'completed' : ''}`}>
                        <span className="step-number">1</span>
                        <span className="step-label">Info</span>
                    </div>
                    <div className={`step ${step >= 2 ? 'active' : ''} ${step > 2 ? 'completed' : ''}`}>
                        <span className="step-number">2</span>
                        <span className="step-label">Face</span>
                    </div>
                    <div className={`step ${step >= 3 ? 'active' : ''}`}>
                        <span className="step-number">3</span>
                        <span className="step-label">PIN</span>
                    </div>
                </div>

                {/* Messages */}
                {message && <div className="message success">{message}</div>}
                {error && <div className="message error">{error}</div>}

                {/* STEP 1: Basic Information */}
                {step === 1 && (
                    <form onSubmit={handleSubmitInfo} className="register-form">
                        <div className="form-group">
                            <label>Full Name</label>
                            <input
                                type="text"
                                name="name"
                                value={formData.name}
                                onChange={handleChange}
                                placeholder="John Doe"
                                required
                                disabled={loading}
                            />
                        </div>

                        <div className="form-group">
                            <label>Email</label>
                            <input
                                type="email"
                                name="email"
                                value={formData.email}
                                onChange={handleChange}
                                placeholder="john@example.com"
                                required
                                disabled={loading}
                            />
                        </div>

                        <div className="form-group">
                            <label>Password</label>
                            <input
                                type="password"
                                name="password"
                                value={formData.password}
                                onChange={handleChange}
                                placeholder="Min 8 characters"
                                required
                                minLength={8}
                                disabled={loading}
                            />
                        </div>

                        <div className="form-group">
                            <label>Phone Number</label>
                            <input
                                type="tel"
                                name="phone"
                                value={formData.phone}
                                onChange={handleChange}
                                placeholder="9876543210"
                                required
                                disabled={loading}
                            />
                        </div>

                        <button type="submit" className="btn-primary" disabled={loading}>
                            {loading ? 'Processing...' : 'Continue to Face Capture'}
                        </button>

                        <button
                            type="button"
                            className="btn-secondary"
                            onClick={onBackToLogin}
                            disabled={loading}
                        >
                            Back to Login
                        </button>
                    </form>
                )}

                {/* STEP 2: Progressive Face Capture */}
                {step === 2 && (
                    <div className="face-capture-step">
                        <div className="capture-instructions">
                            <p>Position your face in the center</p>
                            <p className="instruction-detail">
                                {isCapturing
                                    ? 'Capturing... Move your head slightly'
                                    : faceImages.length >= REQUIRED_IMAGES
                                        ? 'Capture complete!'
                                        : 'Starting capture...'}
                            </p>
                        </div>

                        {/* Webcam with Progress Ring */}
                        <div className="webcam-wrapper">
                            <Webcam
                                ref={webcamRef}
                                audio={false}
                                screenshotFormat="image/jpeg"
                                videoConstraints={{
                                    width: 640,
                                    height: 480,
                                    facingMode: 'user'
                                }}
                                className="webcam-feed"
                                onUserMedia={handleWebcamReady}
                            />

                            {/* Flash Effect */}
                            {showFlash && <div className="flash-overlay"></div>}

                            {/* Progress Ring */}
                            <div className="progress-ring-container">
                                <svg className="progress-ring" width="240" height="240">
                                    <circle
                                        className="progress-ring-bg"
                                        cx="120"
                                        cy="120"
                                        r="110"
                                    />
                                    <circle
                                        className="progress-ring-fill"
                                        cx="120"
                                        cy="120"
                                        r="110"
                                        style={{
                                            strokeDashoffset: `${691 - (691 * captureProgress) / 100}`
                                        }}
                                    />
                                </svg>

                                {/* Progress Dots */}
                                <div className="progress-dots">
                                    {[...Array(REQUIRED_IMAGES)].map((_, i) => (
                                        <div
                                            key={i}
                                            className={`progress-dot ${i < faceImages.length ? 'completed' : ''}`}
                                        >
                                            {i < faceImages.length && '✓'}
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Thumbnails */}
                        {faceImages.length > 0 && (
                            <div className="captured-images">
                                <p className="thumbnails-label">
                                    Captured: {faceImages.length}/{REQUIRED_IMAGES}
                                </p>
                                <div className="thumbnails-grid">
                                    {faceImages.map((img, index) => (
                                        <div key={index} className="thumbnail-item">
                                            <img src={img} alt={`Capture ${index + 1}`} />
                                            <button
                                                type="button"
                                                className="thumbnail-delete"
                                                onClick={() => removeImage(index)}
                                                disabled={isCapturing}
                                            >
                                                ×
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        {/* Action Buttons */}
                        <div className="action-buttons">
                            {faceImages.length < REQUIRED_IMAGES && !isCapturing && faceImages.length > 0 && (
                                <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={startProgressiveCapture}
                                >
                                    Resume Capture
                                </button>
                            )}

                            {faceImages.length > 0 && (
                                <button
                                    type="button"
                                    className="btn-secondary"
                                    onClick={resetCapture}
                                    disabled={isCapturing}
                                >
                                    Reset All
                                </button>
                            )}

                            <button
                                type="button"
                                className="btn-primary"
                                onClick={handleCompleteRegistration}
                                disabled={loading || faceImages.length < 3}
                            >
                                {loading
                                    ? 'Registering...'
                                    : faceImages.length >= REQUIRED_IMAGES
                                        ? 'Complete Registration'
                                        : `Need ${3 - faceImages.length} more captures`
                                }
                            </button>

                            <button
                                type="button"
                                className="btn-secondary"
                                onClick={() => {
                                    resetCapture()
                                    setStep(1)
                                }}
                                disabled={loading || isCapturing}
                            >
                                Back
                            </button>
                        </div>
                    </div>
                )}

                {/* STEP 3: PIN Display with Copy Button */}
                {step === 3 && (
                    <div className="pin-display-step">
                        <div className="success-icon">✓</div>
                        <h3>Registration Complete!</h3>
                        <p className="pin-instruction">
                            Your default PIN has been generated and sent to your email and phone.
                        </p>

                        {/* PIN Box with Copy Button */}
                        <div className="pin-display-wrapper">
                            <div
                                className="pin-box"
                                onClick={handlePinBoxClick}
                                title="Click to copy"
                            >
                                <span className="pin-value">{defaultPin}</span>
                            </div>

                            <button
                                className="copy-button"
                                onClick={copyPinToClipboard}
                                title="Copy PIN"
                            >
                                {pinCopied ? (
                                    <>
                                        <span className="copy-icon">✓</span>
                                        <span className="copy-text">Copied!</span>
                                    </>
                                ) : (
                                    <>
                                        <span className="copy-icon">📋</span>
                                        <span className="copy-text">Copy</span>
                                    </>
                                )}
                            </button>
                        </div>

                        {pinCopied && (
                            <div className="copy-tooltip">PIN copied to clipboard!</div>
                        )}

                        <div className="pin-warnings">
                            <p>⚠️ Save this PIN securely</p>
                            <p>You'll need it for your first login</p>
                            <p>You can change it after logging in</p>
                        </div>

                        <button
                            type="button"
                            className="btn-primary"
                            onClick={handleProceedToLogin}
                        >
                            Proceed to Login
                        </button>
                    </div>
                )}
            </div>
        </div>
    )
}

export default Register
