/**
 * Register.jsx – Dark theme registration with face capture
 * Step 1: Name, Email, Phone
 * Step 2: Capture 3-5 face images (webcam) – front camera only (facingMode: 'user')
 * Step 3: Show generated PIN (large, copyable)
 * Step 4: Back to login
 */

import { useState, useRef } from 'react'

const API = '/api'

export default function Register({ onBackToLogin }) {
    const [step, setStep] = useState(1)
    const [form, setForm] = useState({ name: '', email: '', phone: '' })
    const [error, setError] = useState('')
    const [loading, setLoading] = useState(false)
    const [faceImages, setFaceImages] = useState([])
    const [defaultPin, setDefaultPin] = useState('')

    const videoRef = useRef(null)
    const streamRef = useRef(null)
    const canvasRef = useRef(null)

    const handleChange = (e) => {
        setForm({ ...form, [e.target.name]: e.target.value })
        setError('')
    }

    // Force front camera (mirror/selfie camera)
    const startCamera = async () => {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { facingMode: 'user' }   // ← explicit front camera
            })
            streamRef.current = stream
            if (videoRef.current) videoRef.current.srcObject = stream
        } catch (err) {
            setError('Camera access denied. Please allow camera and refresh.')
        }
    }

    const stopCamera = () => {
        streamRef.current?.getTracks().forEach(t => t.stop())
        streamRef.current = null
    }

    const captureImage = () => {
        if (!videoRef.current) return
        const canvas = canvasRef.current
        canvas.width = videoRef.current.videoWidth
        canvas.height = videoRef.current.videoHeight
        canvas.getContext('2d').drawImage(videoRef.current, 0, 0)
        const dataUrl = canvas.toDataURL('image/jpeg', 0.9)
        if (faceImages.length < 5) {
            setFaceImages([...faceImages, dataUrl])
        } else {
            setError('Maximum 5 images captured')
        }
    }

    const removeImage = (idx) => {
        setFaceImages(faceImages.filter((_, i) => i !== idx))
    }

    const handleRegisterSubmit = async (e) => {
        e.preventDefault()
        setError('')
        if (!form.name || !form.email || !form.phone) {
            setError('All fields are required')
            return
        }
        setStep(2)
        startCamera()
    }

    const submitFaceAndRegister = async () => {
        if (faceImages.length < 3) {
            setError('Please capture at least 3 face images')
            return
        }
        setLoading(true)
        setError('')
        try {
            const res = await fetch(`${API}/auth/register`, {
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
            stopCamera()
            setStep(3)
        } catch (err) {
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }

    // ──────────────────────────────────────────────────────────
    // Inline dark theme styles (matching Login.jsx)
    // ──────────────────────────────────────────────────────────
    const containerStyle = {
        minHeight: '100vh',
        background: '#060812',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    }
    const cardStyle = {
        width: '100%',
        maxWidth: 520,
        background: '#111520',
        border: '1px solid #1e2433',
        borderRadius: 20,
        padding: '32px 36px',
        boxShadow: '0 24px 80px rgba(0,0,0,.5)',
    }
    const stepIndicatorStyle = {
        display: 'flex',
        justifyContent: 'space-between',
        marginBottom: 28,
        gap: 8,
    }
    const stepStyle = (active) => ({
        flex: 1,
        textAlign: 'center',
        padding: '8px 0',
        borderRadius: 20,
        fontSize: 12,
        fontWeight: 600,
        background: active ? '#4f8ef7' : '#0d1017',
        color: active ? '#fff' : '#4a5168',
        border: active ? 'none' : '1px solid #1e2433',
    })
    const inputStyle = {
        width: '100%',
        padding: '12px 14px',
        background: '#0a0e1a',
        border: '1px solid #1e2433',
        borderRadius: 10,
        color: '#e2e8f0',
        fontSize: 13,
        outline: 'none',
        boxSizing: 'border-box',
    }
    const buttonStyle = {
        width: '100%',
        padding: '12px 0',
        background: '#4f8ef7',
        border: 'none',
        borderRadius: 10,
        color: '#fff',
        fontSize: 14,
        fontWeight: 600,
        cursor: 'pointer',
        marginTop: 16,
    }
    const secondaryButtonStyle = {
        ...buttonStyle,
        background: 'transparent',
        border: '1px solid #1e2433',
        color: '#8b95a9',
    }
    const successButtonStyle = {
        ...buttonStyle,
        background: '#10b981',  // Green for success/continue
        fontSize: 16,
        padding: '14px 0',
    }

    return (
        <div style={containerStyle}>
            <div style={cardStyle}>
                <h2 style={{ fontSize: 24, fontWeight: 700, margin: '0 0 4px', color: '#e2e8f0', textAlign: 'center' }}>Create Account</h2>
                <p style={{ fontSize: 13, color: '#4a5168', textAlign: 'center', marginBottom: 24 }}>Face + PIN authentication</p>

                <div style={stepIndicatorStyle}>
                    <div style={stepStyle(step >= 1)}>1. Details</div>
                    <div style={stepStyle(step >= 2)}>2. Face Capture</div>
                    <div style={stepStyle(step >= 3)}>3. PIN</div>
                </div>

                {error && (
                    <div style={{
                        background: 'rgba(248,113,113,.1)',
                        border: '1px solid #f87171',
                        borderRadius: 8,
                        padding: 10,
                        fontSize: 12,
                        color: '#f87171',
                        marginBottom: 20,
                    }}>
                        ⚠️ {error}
                    </div>
                )}

                {step === 1 && (
                    <form onSubmit={handleRegisterSubmit}>
                        <div style={{ marginBottom: 16 }}>
                            <label style={{ fontSize: 12, color: '#8b95a9', display: 'block', marginBottom: 6 }}>Full Name</label>
                            <input type="text" name="name" value={form.name} onChange={handleChange} style={inputStyle} required />
                        </div>
                        <div style={{ marginBottom: 16 }}>
                            <label style={{ fontSize: 12, color: '#8b95a9', display: 'block', marginBottom: 6 }}>Email</label>
                            <input type="email" name="email" value={form.email} onChange={handleChange} style={inputStyle} required />
                        </div>
                        <div style={{ marginBottom: 24 }}>
                            <label style={{ fontSize: 12, color: '#8b95a9', display: 'block', marginBottom: 6 }}>Phone (10 digits)</label>
                            <input type="tel" name="phone" value={form.phone} onChange={handleChange} pattern="[0-9]{10}" style={inputStyle} required />
                        </div>
                        <button type="submit" style={buttonStyle}>Continue to Face Capture →</button>
                        <button type="button" onClick={onBackToLogin} style={secondaryButtonStyle}>← Back to Login</button>
                    </form>
                )}

                {step === 2 && (
                    <div>
                        <div style={{
                            position: 'relative',
                            borderRadius: 12,
                            overflow: 'hidden',
                            background: '#0a0e1a',
                            marginBottom: 16,
                        }}>
                            {/* Mirror horizontally for natural selfie view */}
                            <video ref={videoRef} autoPlay playsInline muted style={{ width: '100%', display: 'block', transform: 'scaleX(-1)' }} />
                            <canvas ref={canvasRef} style={{ display: 'none' }} />
                        </div>

                        {/* Capture and Reset buttons */}
                        <div style={{ display: 'flex', gap: 12, marginBottom: 16 }}>
                            <button
                                onClick={captureImage}
                                disabled={faceImages.length >= 5}
                                style={{
                                    flex: 1,
                                    ...buttonStyle,
                                    marginTop: 0,
                                    background: faceImages.length >= 5 ? '#4b5563' : '#4f8ef7',
                                    cursor: faceImages.length >= 5 ? 'not-allowed' : 'pointer'
                                }}
                            >
                                {faceImages.length >= 5 ? '✅ Max Captured (5/5)' : `Capture (${faceImages.length}/5)`}
                            </button>
                            <button
                                onClick={() => { setFaceImages([]); startCamera(); }}
                                style={{ flex: 1, ...secondaryButtonStyle, marginTop: 0 }}
                            >
                                Reset
                            </button>
                        </div>

                        {/* Captured images preview */}
                        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 16, justifyContent: 'center' }}>
                            {faceImages.map((img, idx) => (
                                <div key={idx} style={{ position: 'relative' }}>
                                    <img src={img} alt={`face ${idx + 1}`} width={60} height={60} style={{ borderRadius: 8, border: '1px solid #1e2433' }} />
                                    <button
                                        onClick={() => removeImage(idx)}
                                        style={{
                                            position: 'absolute',
                                            top: -8, right: -8,
                                            background: '#f87171',
                                            border: 'none',
                                            borderRadius: 20,
                                            width: 20, height: 20,
                                            fontSize: 12,
                                            color: '#fff',
                                            cursor: 'pointer',
                                        }}
                                    >
                                        ✖
                                    </button>
                                </div>
                            ))}
                        </div>

                        {/* Progress indicator */}
                        <div style={{ marginBottom: 16, textAlign: 'center' }}>
                            <p style={{ fontSize: 13, color: faceImages.length >= 3 ? '#10b981' : '#8b95a9' }}>
                                {faceImages.length < 3
                                    ? `Capture ${3 - faceImages.length} more photo${3 - faceImages.length !== 1 ? 's' : ''} to continue`
                                    : faceImages.length < 5
                                        ? `✓ Minimum reached. Capture up to ${5 - faceImages.length} more for better accuracy`
                                        : '✓ Maximum photos captured. Ready to register!'
                                }
                            </p>
                        </div>

                        {/* PROMINENT Continue Button - Shows when ready */}
                        {faceImages.length >= 3 && (
                            <button
                                onClick={submitFaceAndRegister}
                                disabled={loading}
                                style={{
                                    ...successButtonStyle,
                                    animation: 'pulse 2s infinite',
                                    boxShadow: '0 0 20px rgba(16, 185, 129, 0.4)'
                                }}
                            >
                                {loading ? '⏳ Registering...' : '🚀 Complete Registration'}
                            </button>
                        )}

                        {/* Back button */}
                        <button
                            onClick={() => { stopCamera(); setStep(1); }}
                            style={secondaryButtonStyle}
                        >
                            ← Back to Details
                        </button>
                    </div>
                )}

                {step === 3 && defaultPin && (
                    <div style={{ textAlign: 'center' }}>
                        <div style={{ fontSize: 48, marginBottom: 16 }}>🔐</div>
                        <p style={{ fontSize: 14, color: '#8b95a9' }}>Your permanent login PIN is:</p>
                        <div
                            onClick={() => { navigator.clipboard.writeText(defaultPin); alert('PIN copied to clipboard'); }}
                            style={{
                                background: '#0a0e1a',
                                border: '1px solid #4f8ef7',
                                borderRadius: 12,
                                padding: '12px',
                                fontSize: 28,
                                fontWeight: 700,
                                letterSpacing: 4,
                                color: '#4f8ef7',
                                fontFamily: 'monospace',
                                marginBottom: 16,
                                cursor: 'pointer',
                            }}
                        >
                            {defaultPin} <span style={{ fontSize: 16 }}>📋</span>
                        </div>
                        <p style={{ fontSize: 11, color: '#4a5168', marginBottom: 24 }}>
                            This PIN has been sent to your email & SMS. You can keep it or change it on first login.
                        </p>
                        <button onClick={onBackToLogin} style={buttonStyle}>Go to Login</button>
                    </div>
                )}
            </div>
        </div>
    )
}