/**
 * Register.jsx – Face enrolment with auto-retry
 * Fixed: persistent registration errors (duplicate email/phone) no longer cleared by face detection.
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

// ── Field status icons (shown inside the input itself) ──────────────────────
function CheckCircleIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <path d="M8 12.5l2.5 2.5L16 9" />
        </svg>
    )
}

function AlertCircleIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" />
            <line x1="12" y1="7.5" x2="12" y2="13" />
            <circle cx="12" cy="16.5" r="0.5" fill="currentColor" stroke="none" />
        </svg>
    )
}

function SpinnerIcon({ size = 16 }) {
    return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" style={{ animation: 'rf-spin 0.7s linear infinite' }}>
            <circle cx="12" cy="12" r="9" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2.5" />
            <path d="M21 12a9 9 0 0 0-9-9" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" />
        </svg>
    )
}

// ── Form field with in-input status icon and a single, styled inline error ──
// Consolidates what used to be a top banner + a separate plain-text message
// under the field into one place, right where the user is looking.
function FormField({
    label, name, type, value, placeholder, hint,
    status, errorMessage, showLoginLink, onLoginClick,
    onChange, onBlur,
}) {
    const borderColor = status === 'error' ? 'rgba(248,113,113,0.6)'
        : status === 'valid' ? 'rgba(52,211,153,0.5)'
        : undefined
    return (
        <div className="form-group">
            <label>{label}{hint && <span style={{ fontSize: 11, color: '#64748b', fontWeight: 400 }}> ({hint})</span>}</label>
            <div style={{ position: 'relative' }}>
                <input
                    type={type} name={name} value={value}
                    onChange={onChange} onBlur={onBlur}
                    placeholder={placeholder}
                    style={{
                        borderColor,
                        background: status === 'error' ? 'rgba(248,113,113,0.04)' : undefined,
                        paddingRight: status !== 'neutral' ? 36 : undefined,
                    }}
                />
                {status === 'error' && (
                    <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#f87171', display: 'flex' }}>
                        <AlertCircleIcon />
                    </span>
                )}
                {status === 'valid' && (
                    <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#34d399', display: 'flex' }}>
                        <CheckCircleIcon />
                    </span>
                )}
                {status === 'checking' && (
                    <span style={{ position: 'absolute', right: 12, top: '50%', transform: 'translateY(-50%)', color: '#7a8399', display: 'flex' }}>
                        <SpinnerIcon />
                    </span>
                )}
            </div>
            {status === 'checking' && !errorMessage && (
                <div style={{ fontSize: 12, color: '#7a8399', marginTop: 5 }}>Checking availability…</div>
            )}
            {errorMessage && (
                <div style={{
                    display: 'flex', alignItems: 'flex-start', gap: 6, marginTop: 7,
                    padding: '8px 10px', borderRadius: 6,
                    background: 'rgba(248,113,113,0.08)', borderLeft: '2px solid #f87171',
                }}>
                    <span style={{ color: '#f87171', flexShrink: 0, marginTop: 1 }}><AlertCircleIcon size={14} /></span>
                    <span style={{ fontSize: 12.5, color: '#e0a0a8', lineHeight: 1.5 }}>
                        {errorMessage}
                        {showLoginLink && (
                            <> {'\u00b7'} <button
                                type="button"
                                onClick={onLoginClick}
                                style={{ background: 'none', border: 'none', padding: 0, color: '#7fa8ff', textDecoration: 'none', fontWeight: 500, fontSize: 'inherit', cursor: 'pointer' }}
                            >Log in instead</button></>
                        )}
                    </span>
                </div>
            )}
        </div>
    )
}

export default function Register({ onBackToLogin }) {
    const [step, setStep] = useState(1)
    const [form, setForm] = useState({ name: '', email: '', phone: '' })
    const [error, setError] = useState('')               // detection errors (cleared by loop)
    const [persistentError, setPersistentError] = useState('')  // registration errors (never auto‑cleared)
    const [errorType, setErrorType] = useState('')       // 'duplicate' | ''
    const [duplicateField, setDuplicateField] = useState('')    // 'email' | 'phone' | '' — which field's inline error gets the login link
    const [fieldErrors, setFieldErrors] = useState({})
    const [checkingFields, setCheckingFields] = useState({})    // { email: bool, phone: bool } — in-flight uniqueness check
    const [confirmedAvailable, setConfirmedAvailable] = useState({ email: null, phone: null }) // exact value string last confirmed free, per field
    const [loading, setLoading] = useState(false)
    const [faceImages, setFaceImages] = useState([])
    const [smsInfo, setSmsInfo] = useState(null)
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
    const formRef = useRef(form)
    useEffect(() => { formRef.current = form }, [form])
    const availabilityDebounceRef = useRef({})

    useEffect(() => {
        return () => {
            if (abortControllerRef.current) abortControllerRef.current.abort()
            if (detailsErrorTimerRef.current) clearTimeout(detailsErrorTimerRef.current)
            Object.values(availabilityDebounceRef.current).forEach(t => t && clearTimeout(t))
        }
    }, [])

    // ── Single source of truth for field validation ───────────────────────────
    const validateField = (name, value) => {
        const v = (value || '').trim()

        if (name === 'name') {
            if (!v) return 'Full name is required'
            if (!/^[A-Za-z][A-Za-z .'-]*$/.test(v))
                return 'Name can only contain letters, spaces, and . \' -'
            const parts = v.split(/\s+/).filter(p => p.length >= 2)
            if (parts.length < 2)
                return 'Please enter your full name (first and last name)'
            if (v.length > 80) return 'Name must be under 80 characters'
        }

        if (name === 'email') {
            if (!v) return 'Email address is required'
            if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v))
                return 'Enter a valid email address (e.g. name@company.com)'
            if (v.length > 254) return 'Email address is too long'
        }

        if (name === 'phone') {
            if (!v) return 'Phone number is required'
            if (!/^\+[1-9]\d{6,14}$/.test(v))
                return 'Must start with + and country code, digits only (e.g. +919876543210)'
        }

        return ''  // valid
    }

    // Fields where two accounts can never share the same value — format-valid
    // isn't enough to call them "good", they need a real availability check.
    const UNIQUE_FIELDS = ['email', 'phone']

    // Drives the in-field icon (check / alert / spinner) and border color.
    // 'error' | 'checking' | 'valid' | 'neutral'.
    const fieldStatus = (name) => {
        if (fieldErrors[name]) return 'error'
        const value = form[name]
        if (!value || !value.trim()) return 'neutral'
        if (validateField(name, value)) return 'neutral'
        if (checkingFields[name]) return 'checking'
        if (UNIQUE_FIELDS.includes(name)) {
            return confirmedAvailable[name] === value.trim() ? 'valid' : 'neutral'
        }
        return 'valid'
    }

    // Cross-checks email/phone against the backend so the tick means "this is
    // actually free", not just "this is correctly formatted". Runs on blur.
    const checkAvailability = async (triggerField, snapshotEmail, snapshotPhone) => {
        const emailOk = snapshotEmail && !validateField('email', snapshotEmail)
        const phoneOk = snapshotPhone && !validateField('phone', snapshotPhone)
        if (!emailOk && !phoneOk) return

        setCheckingFields(cf => ({ ...cf, [triggerField]: true }))
        try {
            const res = await fetch(`${API_URL}/api/auth/check-availability`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: snapshotEmail, phone: snapshotPhone }),
            })
            if (!res.ok) return
            const data = await res.json()

            // Discard the result if the field moved on while the request was in flight
            if (formRef.current.email.trim() !== snapshotEmail || formRef.current.phone.trim() !== snapshotPhone) return

            const emailError = emailOk ? (data.errors?.email || '') : undefined
            const phoneError = phoneOk ? (data.errors?.phone || '') : undefined

            if (emailError !== undefined || phoneError !== undefined) {
                setFieldErrors(fe => {
                    const next = { ...fe }
                    if (emailError !== undefined) next.email = emailError
                    if (phoneError !== undefined) next.phone = phoneError
                    return next
                })
            }
            setConfirmedAvailable(ca => ({
                email: emailOk && !data.errors?.email ? snapshotEmail : ca.email,
                phone: phoneOk && !data.errors?.phone ? snapshotPhone : ca.phone,
            }))
            if (data.errors?.email || data.errors?.phone) {
                setDuplicateField(data.errors?.email ? 'email' : 'phone')
                setErrorType('duplicate')
            }
        } catch {
            // Silent — the submit-time check remains the authoritative fallback
        } finally {
            setCheckingFields(cf => ({ ...cf, [triggerField]: false }))
        }
    }

    // Blocks submission while a known field error exists (format or duplicate)
    // or while a uniqueness check is still in flight — not just during the
    // final network call. This is what the submit button's disabled state uses.
    const hasBlockingFieldIssues = Object.values(fieldErrors).some(Boolean)
        || checkingFields.email || checkingFields.phone

    const handleChange = (e) => {
        const { name, value } = e.target
        setForm(f => ({ ...f, [name]: value }))
        // Clear the error for this field as the user types so they get live feedback
        if (fieldErrors[name]) setFieldErrors(fe => ({ ...fe, [name]: '' }))
        if (duplicateField === name) {
            setPersistentError(''); setErrorType(''); setDuplicateField('')
            if (detailsErrorTimerRef.current) clearTimeout(detailsErrorTimerRef.current)
        }
        if (error) setError('')

        // Debounced typing-triggered uniqueness check for email/phone — this is
        // the safety net for when a field is filled but never explicitly blurred
        // (e.g. it's the last field before submit).
        if (UNIQUE_FIELDS.includes(name)) {
            if (availabilityDebounceRef.current[name]) clearTimeout(availabilityDebounceRef.current[name])
            const trimmed = value.trim()
            if (trimmed && !validateField(name, trimmed) && confirmedAvailable[name] !== trimmed) {
                availabilityDebounceRef.current[name] = setTimeout(() => {
                    checkAvailability(name, formRef.current.email.trim(), formRef.current.phone.trim())
                }, 500)
            }
        }
    }

    // Fires when user leaves a field — shows format errors immediately, and for
    // email/phone kicks off the real uniqueness check right away rather than
    // waiting out the debounce (faster feedback for people who tab away).
    const handleBlur = (e) => {
        const { name, value } = e.target
        const err = validateField(name, value)
        if (err) { setFieldErrors(fe => ({ ...fe, [name]: err })); return }
        if (UNIQUE_FIELDS.includes(name)) {
            const trimmed = value.trim()
            if (confirmedAvailable[name] !== trimmed) {
                if (availabilityDebounceRef.current[name]) clearTimeout(availabilityDebounceRef.current[name])
                checkAvailability(name, formRef.current.email.trim(), formRef.current.phone.trim())
            }
        }
    }

    const handleRegisterSubmit = async (e) => {
        e.preventDefault()

        // ── Frontend format validation ────────────────────────────────────────
        const fe = {}
        ;['name', 'email', 'phone'].forEach(field => {
            const err = validateField(field, form[field])
            if (err) fe[field] = err
        })
        if (Object.keys(fe).length > 0) { setFieldErrors(fe); return }

        // ── Backend duplicate check before moving to face capture ─────────────
        setLoading(true)
        try {
            const res = await fetch(`${API_URL}/api/auth/check-availability`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: form.email.trim(), phone: form.phone.trim() }),
            })
            if (res.ok) {
                const data = await res.json()
                if (!data.available) {
                    const fieldErrs = {}
                    if (data.errors?.email) fieldErrs.email = data.errors.email
                    if (data.errors?.phone) fieldErrs.phone = data.errors.phone
                    setFieldErrors(fe => ({ ...fe, ...fieldErrs }))
                    const dupField = data.errors?.email ? 'email' : data.errors?.phone ? 'phone' : ''
                    const msg = data.errors?.email || data.errors?.phone || 'An account with these details already exists.'
                    showDetailsError(msg, 'duplicate', dupField)
                    return
                }
            }
            // If check-availability itself fails (network, 500) we let the user
            // proceed — the real register call will catch any duplicate anyway.
        } catch {
            // Network error — proceed, the real submit will handle it
        } finally {
            setLoading(false)
        }

        // ── Details are clean — proceed to face capture ───────────────────────
        setPersistentError(''); setErrorType(''); setDuplicateField('')
        setStep(2)
    }

    // ── Face detection loop ──
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
                // Only set detection error if there's no persistent registration error
                if (!persistentError) {
                    setError(data.face_count === 0 ? 'No face detected. Please position your face.'
                        : 'Multiple faces detected. Ensure only your face is visible.')
                }
                return
            }
            setMultipleFaces(false)
            // Only clear detection error if there's no persistent error
            if (!persistentError) setError('')
            const [x1, y1, x2, y2] = data.primary_box
            const scaleX = dispW / CAPTURE_W, scaleY = dispH / CAPTURE_H
            const sx1 = x1 * scaleX, sy1 = y1 * scaleY, sx2 = x2 * scaleX, sy2 = y2 * scaleY
            const drawX = dispW - sx2, drawY = sy1, drawW = sx2 - sx1, drawH = sy2 - sy1
            ctx.strokeStyle = '#22c55e'; ctx.lineWidth = 3
            ctx.strokeRect(drawX, drawY, drawW, drawH)
        } catch (err) { console.error('Detection error:', err) }
    }, [step, persistentError])

    useEffect(() => {
        let interval
        if (step === 2) interval = setInterval(detectAndDraw, 300)
        return () => clearInterval(interval)
    }, [step, detectAndDraw])

    // ── Enrolment ──
    const startEnrolment = async () => {
        if (enrolmentActive) return
        setFaceImages([]); setCaptureCount(0); setEnrolmentActive(true)
        setError(''); setPersistentError(''); setErrorType(''); setDuplicateField(''); setMultipleFaces(false)
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
                if (data.face_count === 1) { valid = true; setMultipleFaces(false); setError('') }
                else {
                    setMultipleFaces(data.face_count > 1)
                    if (!persistentError) {
                        setError(data.face_count === 0 ? 'No face detected. Please position your face.'
                            : 'Multiple faces detected. Ensure only your face is visible.')
                    }
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
        else if (!persistentError) setError('Enrolment was interrupted. Click "Resume Enrollment" to continue.')
        abortControllerRef.current = null
    }

    const resetEnrolment = () => {
        if (abortControllerRef.current) { abortControllerRef.current.abort(); abortControllerRef.current = null }
        setFaceImages([]); setCaptureCount(0); setEnrolmentActive(false)
        setError(''); setPersistentError(''); setErrorType(''); setDuplicateField(''); setMultipleFaces(false); setInstruction('')
    }

    const removeImage = (idx) => {
        const newImages = faceImages.filter((_, i) => i !== idx)
        setFaceImages(newImages); setCaptureCount(newImages.length)
        if (abortControllerRef.current) { abortControllerRef.current.abort(); abortControllerRef.current = null }
        setEnrolmentActive(false); setInstruction(''); setError(''); setPersistentError(''); setErrorType(''); setDuplicateField('')
    }

    // ── Auto-dismiss timer ref for step-1 banner ──
    const detailsErrorTimerRef = useRef(null)

    const showDetailsError = (msg, type = '', field = '') => {
        setPersistentError(msg)
        setErrorType(type)
        setDuplicateField(field)
        setStep(1)
        // Clear any previous timer
        if (detailsErrorTimerRef.current) clearTimeout(detailsErrorTimerRef.current)
        // Auto-dismiss after 8 seconds so user has time to read it
        detailsErrorTimerRef.current = setTimeout(() => {
            setPersistentError(''); setErrorType(''); setDuplicateField('')
        }, 8000)
    }

    // ── Submit registration ──
    const submitFaceAndRegister = async () => {
        if (faceImages.length < 3) {
            setError('Please capture at least 3 face images')
            return
        }
        setLoading(true)
        setPersistentError('')
        setError('')
        setErrorType('')
        setDuplicateField('')
        try {
            const res = await fetch(`${API_URL}/api/auth/register`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: form.name, email: form.email, phone: form.phone, face_images: faceImages }),
            })
            if (!res.ok) {
                const err = await res.json()
                const msg = err.detail || 'Registration failed'
                if (msg.toLowerCase().includes('already registered') || msg.toLowerCase().includes('already exists')) {
                    // Duplicate account — details issue, send back to step 1
                    const dupField = msg.toLowerCase().includes('email') ? 'email'
                        : msg.toLowerCase().includes('phone') ? 'phone' : ''
                    if (dupField) {
                        setFieldErrors(fe => ({ ...fe, [dupField]: msg }))
                    }
                    showDetailsError(msg, 'duplicate', dupField)
                } else {
                    // Any other error from the backend that relates to submitted details
                    showDetailsError(msg)
                }
                return
            }
            const data = await res.json()
            setSmsInfo({ masked_phone: data.masked_phone, sms_sent: data.sms_sent, pin: data.pin })
            setStep(3)
        } catch (err) {
            // Network-level failure — also show on step 1 since it's not a face issue
            showDetailsError(err.message)
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

    // ── Render ──
    return (
        <div className="register-container">
            <style>{`@keyframes rf-spin { to { transform: rotate(360deg); } }`}</style>
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

                {/* ── General (non-field) error banner — step 1 only. Duplicate-account errors ──
                     render inline under the relevant field instead, see form-group below. ── */}
                {persistentError && step === 1 && !duplicateField && (
                    <div style={{
                        display: 'flex', alignItems: 'flex-start', gap: 8, position: 'relative', overflow: 'hidden',
                        background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.25)',
                        borderRadius: 8, padding: '10px 12px', marginBottom: 16,
                    }}>
                        <span style={{ color: '#f87171', flexShrink: 0, marginTop: 1 }}><AlertCircleIcon /></span>
                        <span style={{ flex: 1, fontSize: 13, color: '#f2b8b8', lineHeight: 1.5 }}>{persistentError}</span>
                        <button
                            onClick={() => { setPersistentError(''); setErrorType(''); setDuplicateField(''); if (detailsErrorTimerRef.current) clearTimeout(detailsErrorTimerRef.current) }}
                            aria-label="Dismiss"
                            style={{ background: 'none', border: 'none', color: '#f2b8b8', cursor: 'pointer', fontSize: 14, flexShrink: 0, lineHeight: 1 }}
                        >✕</button>
                        <div style={{
                            position: 'absolute', bottom: 0, left: 0, height: 2,
                            background: 'rgba(248,113,113,0.4)',
                            animation: 'shrink-bar 8s linear forwards',
                        }} />
                    </div>
                )}

                {/* ── Face detection error banner — step 2 only ── */}
                {error && step === 2 && (
                    <div className="message error" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span>{error}</span>
                        <button
                            onClick={() => setError('')}
                            style={{ background: 'none', border: 'none', color: 'inherit', cursor: 'pointer', fontSize: 16 }}
                        >✕</button>
                    </div>
                )}

                {/* ── Step 1: Details ── */}
                {step === 1 && (
                    <form onSubmit={handleRegisterSubmit} className="register-form" noValidate>
                        <FormField
                            label="Full name" name="name" type="text" value={form.name}
                            placeholder="e.g. Priya Sharma"
                            status={fieldStatus('name')} errorMessage={fieldErrors.name}
                            onChange={handleChange} onBlur={handleBlur}
                        />
                        <FormField
                            label="Email" name="email" type="email" value={form.email}
                            placeholder="e.g. priya@company.com"
                            status={fieldStatus('email')} errorMessage={fieldErrors.email}
                            showLoginLink={duplicateField === 'email'} onLoginClick={onBackToLogin}
                            onChange={handleChange} onBlur={handleBlur}
                        />
                        <FormField
                            label="Phone" name="phone" type="tel" value={form.phone}
                            hint="E.164 format, e.g. +919876543210"
                            placeholder="+919876543210"
                            status={fieldStatus('phone')} errorMessage={fieldErrors.phone}
                            showLoginLink={duplicateField === 'phone'} onLoginClick={onBackToLogin}
                            onChange={handleChange} onBlur={handleBlur}
                        />
                        <button type="submit" className="btn-primary" disabled={loading || hasBlockingFieldIssues}>
                            {(loading || checkingFields.email || checkingFields.phone)
                                ? 'Checking...'
                                : hasBlockingFieldIssues ? 'Fix the highlighted fields' : 'Continue to face capture →'}
                        </button>
                        <button type="button" className="btn-secondary" onClick={onBackToLogin}>← Back to login</button>
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