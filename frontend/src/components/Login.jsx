/**
 * Login.jsx
 * Step 1 + 2: Captures a webcam snapshot and POSTs it to /api/auth/face-login.
 * On success, calls onPinRequired({ pin_record_id, masked_contact, channel }).
 */

import { useRef, useState, useCallback, useEffect } from 'react'

const API = '/api'

export default function Login({ onPinRequired }) {
    const videoRef = useRef(null)
    const canvasRef = useRef(null)
    const streamRef = useRef(null)

    const [cameraReady, setCameraReady] = useState(false)
    const [cameraError, setCameraError] = useState(null)
    const [loading, setLoading] = useState(false)
    const [error, setError] = useState(null)

    // ── Start webcam on mount ──────────────────────────────────────────────
    useEffect(() => {
        startCamera()
        return () => stopCamera()
    }, [])

    async function startCamera() {
        try {
            const stream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: 'user' },
                audio: false,
            })
            streamRef.current = stream
            if (videoRef.current) {
                videoRef.current.srcObject = stream
                videoRef.current.onloadedmetadata = () => {
                    videoRef.current.play()
                    setCameraReady(true)
                }
            }
        } catch (err) {
            setCameraError(
                err.name === 'NotAllowedError'
                    ? 'Camera permission denied. Please allow camera access and refresh.'
                    : 'Could not access camera: ' + err.message
            )
        }
    }

    function stopCamera() {
        streamRef.current?.getTracks().forEach(t => t.stop())
    }

    // ── Capture snapshot → Base64 ──────────────────────────────────────────
    function captureSnapshot() {
        const video = videoRef.current
        const canvas = canvasRef.current
        if (!video || !canvas) return null

        canvas.width = video.videoWidth || 640
        canvas.height = video.videoHeight || 480
        const ctx = canvas.getContext('2d')
        // Mirror the image (front camera is mirrored in CSS but we need the real image)
        ctx.drawImage(video, 0, 0, canvas.width, canvas.height)
        return canvas.toDataURL('image/jpeg', 0.9)  // returns data:image/jpeg;base64,...
    }

    // ── Submit face for recognition ────────────────────────────────────────
    const handleLogin = useCallback(async () => {
        setError(null)
        const snapshot = captureSnapshot()
        if (!snapshot) {
            setError('Could not capture image. Please try again.')
            return
        }

        setLoading(true)
        try {
            const res = await fetch(`${API}/auth/face-login`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ image_base64: snapshot }),
            })
            const data = await res.json()

            if (!res.ok) {
                setError(data.detail || 'Face not recognized. Please try again.')
                return
            }

            // Hand off to parent — show PIN screen
            stopCamera()
            onPinRequired({
                pin_record_id: data.pin_record_id,
                masked_contact: data.masked_contact,
                channel: data.channel,
                message: data.message,
            })
        } catch (err) {
            setError('Network error: ' + err.message)
        } finally {
            setLoading(false)
        }
    }, [onPinRequired])

    return (
        <div style={styles.page}>
            <div style={styles.card}>
                {/* Header */}
                <div style={styles.header}>
                    <div style={styles.logo}>H</div>
                    <h1 style={styles.title}>Agentic HRMS</h1>
                    <p style={styles.subtitle}>Face Recognition Login</p>
                </div>

                {/* Camera view */}
                <div style={styles.cameraBox}>
                    {cameraError ? (
                        <div style={styles.cameraError}>
                            <span style={{ fontSize: 32 }}>📷</span>
                            <p>{cameraError}</p>
                        </div>
                    ) : (
                        <>
                            <video
                                ref={videoRef}
                                style={styles.video}
                                muted
                                playsInline
                            />
                            {/* Face guide overlay */}
                            <div style={styles.faceGuide} />
                            {!cameraReady && (
                                <div style={styles.cameraLoading}>
                                    <div style={styles.spinner} />
                                    <span>Starting camera…</span>
                                </div>
                            )}
                        </>
                    )}
                    {/* Hidden canvas for snapshot */}
                    <canvas ref={canvasRef} style={{ display: 'none' }} />
                </div>

                {/* Instructions */}
                <p style={styles.instructions}>
                    Position your face within the oval and click <strong>Login</strong>
                </p>

                {/* Error message */}
                {error && (
                    <div style={styles.errorBox}>
                        ⚠️ {error}
                    </div>
                )}

                {/* Login button */}
                <button
                    onClick={handleLogin}
                    disabled={!cameraReady || loading || !!cameraError}
                    style={{
                        ...styles.button,
                        opacity: (!cameraReady || loading || !!cameraError) ? 0.5 : 1,
                        cursor: (!cameraReady || loading || !!cameraError) ? 'not-allowed' : 'pointer',
                    }}
                >
                    {loading ? (
                        <span style={styles.btnContent}>
                            <span style={styles.btnSpinner} /> Recognizing…
                        </span>
                    ) : (
                        '🔐 Login with Face'
                    )}
                </button>

                <p style={styles.hint}>
                    Make sure you are in a well-lit area and facing the camera directly.
                </p>
            </div>
        </div>
    )
}

// ── Inline styles (matches your dark theme) ───────────────────────────────────
const styles = {
    page: {
        minHeight: '100vh',
        background: '#060812',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Inter', -apple-system, BlinkMacSystemFont, sans-serif",
    },
    card: {
        background: '#111520',
        border: '1px solid #1e2433',
        borderRadius: 16,
        padding: '40px 36px',
        width: 480,
        maxWidth: '95vw',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
    },
    header: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 8,
    },
    logo: {
        width: 52,
        height: 52,
        background: 'linear-gradient(135deg, #4f8ef7, #7c3aed)',
        borderRadius: 12,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 24,
        fontWeight: 700,
        color: '#fff',
    },
    title: {
        fontSize: 22,
        fontWeight: 700,
        color: '#e2e8f0',
        margin: 0,
    },
    subtitle: {
        fontSize: 13,
        color: '#8b95a9',
        margin: 0,
    },
    cameraBox: {
        width: '100%',
        aspectRatio: '4/3',
        borderRadius: 12,
        overflow: 'hidden',
        background: '#0d1017',
        border: '1px solid #1e2433',
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
    },
    video: {
        width: '100%',
        height: '100%',
        objectFit: 'cover',
        transform: 'scaleX(-1)',  // mirror for natural selfie view
    },
    faceGuide: {
        position: 'absolute',
        top: '50%',
        left: '50%',
        transform: 'translate(-50%, -50%)',
        width: '55%',
        height: '72%',
        border: '2px solid rgba(79,142,247,0.6)',
        borderRadius: '50%',
        pointerEvents: 'none',
        boxShadow: '0 0 0 2000px rgba(6,8,18,0.35)',
    },
    cameraLoading: {
        position: 'absolute',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 10,
        color: '#8b95a9',
        fontSize: 13,
    },
    cameraError: {
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 12,
        color: '#f87171',
        fontSize: 13,
        padding: 20,
        textAlign: 'center',
    },
    spinner: {
        width: 28,
        height: 28,
        border: '3px solid #1e2433',
        borderTop: '3px solid #4f8ef7',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
    },
    instructions: {
        fontSize: 13,
        color: '#8b95a9',
        textAlign: 'center',
        margin: 0,
    },
    errorBox: {
        width: '100%',
        background: 'rgba(248,113,113,0.1)',
        border: '1px solid rgba(248,113,113,0.3)',
        borderRadius: 8,
        padding: '10px 14px',
        fontSize: 13,
        color: '#f87171',
        textAlign: 'center',
    },
    button: {
        width: '100%',
        padding: '14px 0',
        background: '#4f8ef7',
        border: 'none',
        borderRadius: 10,
        color: '#fff',
        fontSize: 15,
        fontWeight: 600,
        fontFamily: 'inherit',
        transition: 'background 0.2s',
    },
    btnContent: {
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 8,
    },
    btnSpinner: {
        display: 'inline-block',
        width: 16,
        height: 16,
        border: '2px solid rgba(255,255,255,0.3)',
        borderTop: '2px solid #fff',
        borderRadius: '50%',
        animation: 'spin 0.8s linear infinite',
    },
    hint: {
        fontSize: 11,
        color: '#4a5168',
        textAlign: 'center',
        margin: 0,
    },
}
