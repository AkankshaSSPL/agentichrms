/**
 * Login.jsx - Dual Authentication Flow
 * Updated: Change PIN feature hidden by default, shown on user request
 * Fixed: Face login directly uses token, no extra PIN request
 */

import React, { useState, useRef, useCallback } from 'react'
import Webcam from 'react-webcam'
import './Login.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const Login = ({ onSuccess, onRegisterClick }) => {
    // State
    const [loginMethod, setLoginMethod] = useState('choice')
    const [step, setStep] = useState('initial')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')

    // PIN login data
    const [identifier, setIdentifier] = useState('')
    const [currentPin, setCurrentPin] = useState('')
    const [newPin, setNewPin] = useState('')
    const [confirmNewPin, setConfirmNewPin] = useState('')
    const [showChangePin, setShowChangePin] = useState(false)

    const webcamRef = useRef(null)

    const resetState = () => {
        setLoginMethod('choice')
        setStep('initial')
        setError('')
        setMessage('')
        setIdentifier('')
        setCurrentPin('')
        setNewPin('')
        setConfirmNewPin('')
        setShowChangePin(false)
    }

    const switchMethod = (method) => {
        setLoginMethod(method)
        setStep('initial')
        setError('')
        setMessage('')
        setShowChangePin(false)
        if (method === 'choice') resetState()
    }

    // ============ FACE LOGIN FLOW ============

    const handleFaceLogin = () => {
        setLoginMethod('face')
        setStep('capturing')
        setError('')
    }

    const captureFace = useCallback(async () => {
        if (!webcamRef.current) return

        setLoading(true)
        setError('')

        try {
            const imageSrc = webcamRef.current.getScreenshot()
            if (!imageSrc) throw new Error('Failed to capture image')

            const response = await fetch(`${API_URL}/api/auth/face-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_base64: imageSrc })
            })

            const data = await response.json()

            if (!response.ok) {
                const errorMsg = data.detail || data.message || 'Face recognition failed'
                throw new Error(typeof errorMsg === 'string' ? errorMsg : JSON.stringify(errorMsg))
            }

            // ✅ Direct login – no extra API call
            localStorage.setItem('access_token', data.access_token)
            localStorage.setItem('user', JSON.stringify(data.employee))
            onSuccess(data)

        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }, [onSuccess])

    // ============ PIN-ONLY LOGIN FLOW ============

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
            if (!identifier || !currentPin) throw new Error('Please fill in all required fields')
            if (currentPin.length !== 6) throw new Error('PIN must be 6 digits')

            if (showChangePin) {
                if (!newPin || !confirmNewPin) throw new Error('Please enter and confirm your new PIN')
                if (newPin.length !== 6) throw new Error('New PIN must be 6 digits')
                if (newPin !== confirmNewPin) throw new Error('New PIN and Confirm PIN do not match')

                const response = await fetch(`${API_URL}/api/auth/verify-and-change-pin`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ identifier, current_pin: currentPin, new_pin: newPin })
                })

                const data = await response.json()
                if (!response.ok) throw new Error(data.detail || 'Failed to change PIN and login')

                localStorage.setItem('access_token', data.access_token)
                localStorage.setItem('user', JSON.stringify(data.user))
                setMessage('PIN changed successfully!')
                setTimeout(() => onSuccess(data), 1000)
            } else {
                const response = await fetch(`${API_URL}/api/auth/login-with-pin`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ identifier, pin: currentPin })
                })

                const data = await response.json()
                if (!response.ok) throw new Error(data.detail || 'Invalid credentials')

                localStorage.setItem('access_token', data.access_token)
                localStorage.setItem('user', JSON.stringify(data.user))
                setTimeout(() => onSuccess(data), 500)
            }
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    // ============ RENDER ============

    return (
        <div className="login-wrapper">
            <div className="login-container">

                {/* Left Panel - Branding */}
                <div className="login-left">
                    <div className="branding">
                        <div className="logo-icon">H</div>
                        <h1>Agentic HRMS</h1>
                        <p className="tagline">Modern HR Management System</p>
                    </div>
                    <div style={{ fontSize: 10, color: '#2a3348', letterSpacing: '.5px', textTransform: 'uppercase', marginTop: 'auto' }}>
                        v1.0 · Agentic Systems
                    </div>
                </div>

                {/* Right Panel - Authentication */}
                <div className="login-right">

                    {/* Choice Screen */}
                    {loginMethod === 'choice' && (
                        <div className="auth-content">
                            <h2>Welcome Back</h2>
                            <p className="subtitle">Choose your preferred login method</p>
                            {error && <div className="alert alert-error">{error}</div>}

                            <div className="login-options">
                                <button className="login-option face-option" onClick={handleFaceLogin}>
                                    <span className="option-icon"></span>
                                    <div>
                                        <h3>Login with Face</h3>
                                        <p>Quick biometric authentication</p>
                                    </div>
                                </button>
                                <button className="login-option pin-option" onClick={handlePinLogin}>
                                    <span className="option-icon"></span>
                                    <div>
                                        <h3>Login with PIN</h3>
                                        <p>Use email or phone + permanent PIN</p>
                                    </div>
                                </button>
                            </div>

                            <div className="footer-text">
                                New employee? <span onClick={onRegisterClick} style={{ cursor: 'pointer', color: '#4f8ef7', textDecoration: 'underline' }}>Register here →</span>
                            </div>
                        </div>
                    )}

                    {/* Face Capture Screen */}
                    {loginMethod === 'face' && step === 'capturing' && (
                        <div className="auth-content">
                            <h2>Face Recognition</h2>
                            <p className="subtitle">Position your face in the camera</p>
                            {error && <div className="alert alert-error">{error}</div>}
                            {message && <div className="alert alert-success">{message}</div>}

                            <div className="webcam-container">
                                <Webcam
                                    ref={webcamRef}
                                    audio={false}
                                    screenshotFormat="image/jpeg"
                                    videoConstraints={{ width: 640, height: 480, facingMode: 'user' }}
                                    className="webcam-video"
                                />
                                <div className="face-overlay">
                                    <div className="face-frame"></div>
                                </div>
                            </div>

                            <div className="action-buttons">
                                <button className="btn-primary" onClick={captureFace} disabled={loading}>
                                    {loading ? 'Recognizing...' : 'Capture & Continue'}
                                </button>
                                <button className="btn-secondary" onClick={() => switchMethod('choice')} disabled={loading}>
                                    Back
                                </button>
                            </div>
                        </div>
                    )}

                    {/* PIN-Only Login Screen */}
                    {loginMethod === 'pin' && step === 'initial' && (
                        <div className="auth-content">
                            <h2>Login with PIN</h2>
                            <p className="subtitle">Enter your credentials</p>
                            {error && <div className="alert alert-error">{error}</div>}
                            {message && <div className="alert alert-success">{message}</div>}

                            <form onSubmit={handlePinLoginSubmit} className="pin-form">
                                <div className="form-group">
                                    <label>Email or Phone Number</label>
                                    <input
                                        type="text"
                                        value={identifier}
                                        onChange={(e) => setIdentifier(e.target.value)}
                                        placeholder="name@company.com or +91 98765 43210"
                                        required autoFocus disabled={loading}
                                    />
                                </div>

                                <div className="form-group">
                                    <label>Current PIN (6 digits)</label>
                                    <input
                                        type="password"
                                        value={currentPin}
                                        onChange={(e) => setCurrentPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                        placeholder="••••••" maxLength={6} required disabled={loading}
                                        className="pin-input-field"
                                    />
                                </div>

                                {!showChangePin && (
                                    <div className="change-pin-toggle">
                                        <button type="button" className="link-button" onClick={() => setShowChangePin(true)}>
                                            Want to change your PIN?
                                        </button>
                                    </div>
                                )}

                                {showChangePin && (
                                    <>
                                        <div className="form-group">
                                            <label>New PIN (6 digits)</label>
                                            <input
                                                type="password"
                                                value={newPin}
                                                onChange={(e) => setNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                                placeholder="••••••" maxLength={6} required disabled={loading}
                                                className="pin-input-field"
                                            />
                                        </div>
                                        <div className="form-group">
                                            <label>Confirm New PIN</label>
                                            <input
                                                type="password"
                                                value={confirmNewPin}
                                                onChange={(e) => setConfirmNewPin(e.target.value.replace(/\D/g, '').slice(0, 6))}
                                                placeholder="••••••" maxLength={6} required disabled={loading}
                                                className="pin-input-field"
                                            />
                                        </div>
                                        <div className="change-pin-toggle">
                                            <button
                                                type="button"
                                                className="link-button"
                                                onClick={() => { setShowChangePin(false); setNewPin(''); setConfirmNewPin(''); }}
                                            >
                                                Cancel PIN change
                                            </button>
                                        </div>
                                    </>
                                )}

                                <div className="action-buttons">
                                    <button
                                        type="submit"
                                        className="btn-primary"
                                        disabled={loading || !identifier || currentPin.length !== 6 || (showChangePin && (newPin.length !== 6 || confirmNewPin.length !== 6))}
                                    >
                                        {loading ? 'Signing in...' : (showChangePin ? 'Change PIN & Sign In' : 'Sign In with PIN')}
                                    </button>
                                    <button type="button" className="btn-secondary" onClick={() => switchMethod('choice')} disabled={loading}>
                                        Back
                                    </button>
                                </div>
                            </form>

                            <div className="switch-option">
                                Or <a onClick={handleFaceLogin}>login with face</a>
                            </div>
                        </div>
                    )}
                </div>
            </div>
        </div>
    )
}

export default Login