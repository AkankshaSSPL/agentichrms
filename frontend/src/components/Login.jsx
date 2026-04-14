/**
 * Login.jsx - Clean Dark Theme (no icons)
 * Auto-scan face login, horizontal toggles
 */

import React, { useState, useRef, useCallback, useEffect } from 'react'
import Webcam from 'react-webcam'
import './Login.css'

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:8000'

const Login = ({ onSuccess, onRegisterClick }) => {
    const [loginMethod, setLoginMethod] = useState('choice')
    const [step, setStep] = useState('initial')
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState('')
    const [message, setMessage] = useState('')
    const [scanning, setScanning] = useState(false)

    // PIN login data
    const [identifier, setIdentifier] = useState('')
    const [currentPin, setCurrentPin] = useState('')
    const [newPin, setNewPin] = useState('')
    const [confirmNewPin, setConfirmNewPin] = useState('')
    const [showChangePin, setShowChangePin] = useState(false)

    const webcamRef = useRef(null)
    const autoScanTimerRef = useRef(null)
    const hasScannedRef = useRef(false)

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
        hasScannedRef.current = false
        if (autoScanTimerRef.current) clearTimeout(autoScanTimerRef.current)
    }

    const switchMethod = (method) => {
        if (autoScanTimerRef.current) clearTimeout(autoScanTimerRef.current)
        setLoginMethod(method)
        setStep('initial')
        setError('')
        setMessage('')
        setScanning(false)
        setShowChangePin(false)
        hasScannedRef.current = false
        if (method === 'choice') resetState()
    }

    // ============ FACE LOGIN (auto-scan) ============
    const handleFaceLogin = () => {
        setLoginMethod('face')
        setStep('capturing')
        setError('')
        hasScannedRef.current = false
    }

    const autoCaptureFace = useCallback(async () => {
        if (!webcamRef.current || hasScannedRef.current || loading) return
        hasScannedRef.current = true
        setScanning(true)
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
            if (!response.ok) throw new Error(data.detail || 'Face not recognized')

            localStorage.setItem('access_token', data.access_token)
            localStorage.setItem('user', JSON.stringify(data.employee))
            onSuccess(data)
        } catch (err) {
            setError(err.message)
            hasScannedRef.current = false
            autoScanTimerRef.current = setTimeout(() => {
                if (loginMethod === 'face' && step === 'capturing') autoCaptureFace()
            }, 2000)
        } finally {
            setLoading(false)
            setScanning(false)
        }
    }, [loginMethod, step, onSuccess, loading])

    const handleWebcamReady = useCallback(() => {
        if (hasScannedRef.current || loading) return
        autoScanTimerRef.current = setTimeout(() => {
            if (loginMethod === 'face' && step === 'capturing') autoCaptureFace()
        }, 1500)
    }, [loginMethod, step, autoCaptureFace, loading])

    useEffect(() => {
        return () => { if (autoScanTimerRef.current) clearTimeout(autoScanTimerRef.current) }
    }, [])

    // ============ PIN LOGIN ============
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

                const res = await fetch(`${API_URL}/api/auth/verify-and-change-pin`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ identifier, current_pin: currentPin, new_pin: newPin })
                })
                const data = await res.json()
                if (!res.ok) throw new Error(data.detail || 'Change failed')
                localStorage.setItem('access_token', data.access_token)
                localStorage.setItem('user', JSON.stringify(data.user))
                setMessage('PIN changed successfully!')
                setTimeout(() => onSuccess(data), 1000)
            } else {
                const res = await fetch(`${API_URL}/api/auth/login-with-pin`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ identifier, pin: currentPin })
                })
                const data = await res.json()
                if (!res.ok) throw new Error(data.detail || 'Invalid credentials')
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
                            <p className="subtitle">{scanning ? 'Scanning your face...' : 'Position your face in the frame'}</p>
                            {error && <div className="alert alert-error">{error}</div>}
                            <div className="webcam-container">
                                <Webcam ref={webcamRef} audio={false} screenshotFormat="image/jpeg"
                                    videoConstraints={{ width: 640, height: 480, facingMode: 'user' }}
                                    className="webcam-video" onUserMedia={handleWebcamReady} />
                                <div className="face-overlay">
                                    <div className={`face-frame ${scanning ? 'scanning' : ''}`}>
                                        {scanning && <div className="scanning-indicator"><div className="spinner"></div></div>}
                                    </div>
                                </div>
                            </div>
                            <div className="action-buttons">
                                <button className="btn-secondary" onClick={() => switchMethod('choice')} disabled={loading}>Back</button>
                            </div>
                        </div>
                    )}

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