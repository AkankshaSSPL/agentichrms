/**
 * Login.jsx - Face login with stability & symmetry check (no half-face capture)
 */

import React, { useState, useRef, useCallback, useEffect } from 'react'
import Webcam from 'react-webcam'
import './Login.css'

const Login = ({ onSuccess, onRegisterClick }) => {
    const [loginMethod, setLoginMethod] = useState('choice')
    const [step, setStep] = useState('initial')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')
    const [scanning, setScanning] = useState(false)
    const [faceStatus, setFaceStatus] = useState('')

    // PIN login data
    const [identifier, setIdentifier] = useState('')
    const [currentPin, setCurrentPin] = useState('')
    const [newPin, setNewPin] = useState('')
    const [confirmNewPin, setConfirmNewPin] = useState('')
    const [showChangePin, setShowChangePin] = useState(false)

    const webcamRef = useRef(null)
    const canvasRef = useRef(document.createElement('canvas'))
    const animationRef = useRef(null)
    const stabilityTimerRef = useRef(null)

    const resetState = () => {
        setLoginMethod('choice')
        setStep('initial')
        setError('')
        setMessage('')
        setScanning(false)
        setIdentifier('')
        setCurrentPin('')
        setNewPin('')
        setConfirmNewPin('')
        setShowChangePin(false)
        if (animationRef.current) cancelAnimationFrame(animationRef.current)
        if (stabilityTimerRef.current) clearTimeout(stabilityTimerRef.current)
    }

    const switchMethod = (method) => {
        setLoginMethod(method)
        setStep('initial')
        setError('')
        setMessage('')
        setScanning(false)
        setShowChangePin(false)
        if (method === 'choice') resetState()
    }

    // Face detection helpers
    const isFullFaceCentred = () => {
        if (!webcamRef.current) return false
        const video = webcamRef.current.video
        if (!video || video.videoWidth === 0) return false

        const canvas = canvasRef.current
        const ctx = canvas.getContext('2d')
        canvas.width = video.videoWidth
        canvas.height = video.videoHeight
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)

        const centreX = canvas.width / 2
        const centreY = canvas.height / 2
        const radiusX = canvas.width * 0.19
        const radiusY = canvas.height * 0.3

        // Skin tone detection
        let skinPixels = 0
        let totalPixels = 0
        for (let y = centreY - radiusY; y <= centreY + radiusY; y += 4) {
            for (let x = centreX - radiusX; x <= centreX + radiusX; x += 4) {
                const ellipse = ((x - centreX) ** 2) / (radiusX ** 2) + ((y - centreY) ** 2) / (radiusY ** 2)
                if (ellipse <= 1) {
                    const pixel = ctx.getImageData(x, y, 1, 1).data
                    const r = pixel[0], g = pixel[1], b = pixel[2]
                    if (r > 70 && g > 40 && b > 20 && r > g && r > b) skinPixels++
                    totalPixels++
                }
            }
        }
        const skinRatio = totalPixels === 0 ? 0 : skinPixels / totalPixels
        if (skinRatio < 0.2) return false

        // Symmetry check
        let leftBright = 0, rightBright = 0
        let leftCount = 0, rightCount = 0
        for (let y = centreY - radiusY; y <= centreY + radiusY; y += 4) {
            for (let x = centreX - radiusX; x <= centreX + radiusX; x += 4) {
                const ellipse = ((x - centreX) ** 2) / (radiusX ** 2) + ((y - centreY) ** 2) / (radiusY ** 2)
                if (ellipse <= 1) {
                    const pixel = ctx.getImageData(x, y, 1, 1).data
                    const bright = (pixel[0] + pixel[1] + pixel[2]) / 3
                    if (x < centreX) { leftBright += bright; leftCount++ }
                    else { rightBright += bright; rightCount++ }
                }
            }
        }
        const leftAvg = leftCount ? leftBright / leftCount : 0
        const rightAvg = rightCount ? rightBright / rightCount : 0
        const symmetry = Math.abs(leftAvg - rightAvg) / ((leftAvg + rightAvg) / 2 + 0.01)
        return symmetry < 0.3
    }

    const startFaceMonitoring = useCallback(() => {
        let lastFacePresent = false
        let stableStart = null

        const monitor = () => {
            if (!webcamRef.current || step !== 'capturing') return
            const facePresent = isFullFaceCentred()
            const now = Date.now()

            if (facePresent && !lastFacePresent) {
                stableStart = now
                setFaceStatus('detecting')
            } else if (facePresent && lastFacePresent) {
                if (stableStart && (now - stableStart) >= 1000) {
                    setFaceStatus('stable')
                    if (stabilityTimerRef.current === null) {
                        stabilityTimerRef.current = setTimeout(() => {
                            if (step === 'capturing') autoCaptureFace()
                        }, 100)
                    }
                } else {
                    setFaceStatus('detecting')
                }
            } else {
                stableStart = null
                if (stabilityTimerRef.current) {
                    clearTimeout(stabilityTimerRef.current)
                    stabilityTimerRef.current = null
                }
                setFaceStatus('unstable')
            }
            lastFacePresent = facePresent
            animationRef.current = requestAnimationFrame(monitor)
        }
        monitor()
    }, [step])

    useEffect(() => {
        if (step === 'capturing') {
            startFaceMonitoring()
        }
        return () => {
            if (animationRef.current) cancelAnimationFrame(animationRef.current)
            if (stabilityTimerRef.current) clearTimeout(stabilityTimerRef.current)
        }
    }, [step, startFaceMonitoring])

    const autoCaptureFace = useCallback(async () => {
        if (!webcamRef.current || loading) return
        setLoading(true)
        setError('')
        setScanning(true)

        try {
            const imageSrc = webcamRef.current.getScreenshot()
            if (!imageSrc) throw new Error('Failed to capture image')

            const response = await fetch('/api/auth/face-login', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_base64: imageSrc })
            })
            const data = await response.json()
            if (!response.ok) throw new Error(data.detail || 'Face not recognized')

            localStorage.setItem('access_token', data.access_token)
            localStorage.setItem('hrms_employee', JSON.stringify(data.employee))
            localStorage.setItem('hrms_token', data.access_token)
            onSuccess(data.access_token, data.employee)
        } catch (err) {
            setError(err.message)
            // Retry detection after error
            setTimeout(() => {
                if (step === 'capturing') startFaceMonitoring()
            }, 2000)
        } finally {
            setLoading(false)
            setScanning(false)
        }
    }, [onSuccess, loading, step])

    const handleFaceLogin = () => {
        setLoginMethod('face')
        setStep('capturing')
        setError('')
    }

    // PIN login handlers (unchanged from previous working version)
    const handlePinLogin = () => {
        setLoginMethod('pin')
        setStep('initial')
        setError('')
    }

    const handlePinLoginSubmit = async (e) => {
        e.preventDefault()
        setLoading(true)
        setError('')
        try {
            if (!identifier || !currentPin) throw new Error('All fields required')
            if (currentPin.length !== 6) throw new Error('PIN must be 6 digits')

            if (showChangePin) {
                if (!newPin || !confirmNewPin) throw new Error('Enter and confirm new PIN')
                if (newPin.length !== 6) throw new Error('New PIN must be 6 digits')
                if (newPin !== confirmNewPin) throw new Error('PINs do not match')

                const res = await fetch('/api/auth/verify-and-change-pin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ identifier, current_pin: currentPin, new_pin: newPin })
                })
                const data = await res.json()
                if (!res.ok) throw new Error(data.detail || 'Change failed')
                localStorage.setItem('access_token', data.access_token)
                localStorage.setItem('hrms_employee', JSON.stringify(data.employee))
                localStorage.setItem('hrms_token', data.access_token)
                setMessage('PIN changed successfully!')
                setTimeout(() => onSuccess(data.access_token, data.employee), 1000)
            } else {
                const res = await fetch('/api/auth/login-with-pin', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ identifier, pin: currentPin })
                })
                const data = await res.json()
                if (!res.ok) throw new Error(data.detail || 'Invalid credentials')
                localStorage.setItem('access_token', data.access_token)
                localStorage.setItem('hrms_employee', JSON.stringify(data.employee))
                localStorage.setItem('hrms_token', data.access_token)
                setTimeout(() => onSuccess(data.access_token, data.employee), 500)
            }
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    // Render (same as before, but add face status indicator)
    return (
        <div className="login-wrapper">
            <div className="login-container">
                <div className="login-left">
                    <div className="branding">
                        <div className="logo-icon">H</div>
                        <h1>Agentic HRMS</h1>
                        <p className="tagline">Secure employee portal</p>
                    </div>
                </div>

                <div className="login-right">
                    {loginMethod === 'choice' && (
                        <div className="auth-content">
                            <h2>Welcome Back</h2>
                            <p className="subtitle">Choose your preferred login method</p>
                            {error && <div className="alert alert-error">{error}</div>}
                            <div className="login-options-horizontal">
                                <button className="login-option-horizontal" onClick={handleFaceLogin}>
                                    <h3>Login with Face</h3>
                                    <p>Quick biometric authentication</p>
                                </button>
                                <button className="login-option-horizontal" onClick={handlePinLogin}>
                                    <h3>Login with PIN</h3>
                                    <p>Use permanent PIN</p>
                                </button>
                            </div>
                            <div className="footer-text">
                                New employee? <span onClick={onRegisterClick}>Register here →</span>
                            </div>
                        </div>
                    )}

                    {loginMethod === 'face' && step === 'capturing' && (
                        <div className="auth-content">
                            <h2>Face Recognition</h2>
                            <p className="subtitle">
                                {faceStatus === 'stable' ? 'Face detected – logging in...' :
                                    faceStatus === 'detecting' ? 'Hold still – detecting face...' :
                                        'Position your full face in the frame'}
                            </p>
                            {error && <div className="alert alert-error">{error}</div>}
                            <div className="webcam-container">
                                <Webcam
                                    ref={webcamRef}
                                    audio={false}
                                    screenshotFormat="image/jpeg"
                                    videoConstraints={{ width: 640, height: 480, facingMode: 'user' }}
                                    className="webcam-video"
                                />
                                <div className="face-overlay">
                                    <div className={`face-frame ${faceStatus === 'stable' ? 'stable' : ''}`}>
                                        {scanning && <div className="scanning-indicator"><div className="spinner"></div></div>}
                                    </div>
                                </div>
                            </div>
                            <div className="action-buttons">
                                <button className="btn-secondary" onClick={() => switchMethod('choice')} disabled={loading}>
                                    Back
                                </button>
                            </div>
                        </div>
                    )}

                    {/* PIN login screen unchanged */}
                    {loginMethod === 'pin' && step === 'initial' && (
                        <div className="auth-content">
                            <h2>Login with PIN</h2>
                            <p className="subtitle">Enter your credentials</p>
                            {error && <div className="alert alert-error">{error}</div>}
                            {message && <div className="alert alert-success">{message}</div>}
                            <form onSubmit={handlePinLoginSubmit} className="pin-form">
                                <div className="form-group">
                                    <label>Email or Phone Number</label>
                                    <input type="text" value={identifier} onChange={e => setIdentifier(e.target.value)}
                                        placeholder="name@company.com or +91 98765 43210" required autoFocus disabled={loading} />
                                </div>
                                <div className="form-group">
                                    <label>Current PIN (6 digits)</label>
                                    <input type="password" value={currentPin}
                                        onChange={e => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                        placeholder="••••••" maxLength={6} required disabled={loading} className="pin-input-field" />
                                </div>
                                {!showChangePin && (
                                    <div className="change-pin-toggle">
                                        <button type="button" className="link-button" onClick={() => setShowChangePin(true)}>Want to change your PIN?</button>
                                    </div>
                                )}
                                {showChangePin && (
                                    <>
                                        <div className="form-group">
                                            <label>New PIN (6 digits)</label>
                                            <input type="password" value={newPin}
                                                onChange={e => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                                placeholder="••••••" maxLength={6} required disabled={loading} className="pin-input-field" />
                                        </div>
                                        <div className="form-group">
                                            <label>Confirm New PIN</label>
                                            <input type="password" value={confirmNewPin}
                                                onChange={e => setConfirmNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                                placeholder="••••••" maxLength={6} required disabled={loading} className="pin-input-field" />
                                        </div>
                                        <div className="change-pin-toggle">
                                            <button type="button" className="link-button" onClick={() => { setShowChangePin(false); setNewPin(''); setConfirmNewPin(''); }}>Cancel PIN change</button>
                                        </div>
                                    </>
                                )}
                                <div className="action-buttons">
                                    <button type="submit" className="btn-primary"
                                        disabled={loading || !identifier || currentPin.length !== 6 || (showChangePin && (newPin.length !== 6 || confirmNewPin.length !== 6))}>
                                        {loading ? 'Signing in...' : (showChangePin ? 'Change PIN & Sign In' : 'Sign In with PIN')}
                                    </button>
                                    <button type="button" className="btn-secondary" onClick={() => switchMethod('choice')} disabled={loading}>Back</button>
                                </div>
                            </form>
                            <div className="switch-option">Or <a onClick={handleFaceLogin}>login with face</a></div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default Login