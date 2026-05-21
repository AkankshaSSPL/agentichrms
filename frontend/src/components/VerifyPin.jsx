/**
 * VerifyPin.jsx – Registration Complete screen
 * Shows the default PIN and redirects to login.
 * No verification step – the PIN is used later on the login page.
 *
 * Props:
 *   pinData   — { pin_record_id, masked_phone, message, default_pin? }
 *   onBack    — () => void (go back to face capture)
 *   onLoginRedirect — () => void (go to login screen)
 */

import { useState } from 'react'

const hoverCSS = `
@keyframes fadeUp{from{opacity:0;transform:translateY(14px)}to{opacity:1;transform:translateY(0)}}
.vp-card{animation:fadeUp .3s ease}
.vp-btn:hover{background:#3b7de8!important;transform:translateY(-1px);box-shadow:0 6px 20px rgba(79,142,247,.3)!important}
.vp-digit:hover{transform:scale(1.1) translateY(-2px)!important}
.vp-toggle:hover{border-color:var(--accent)!important;color:var(--accent)!important}
`

export default function VerifyPin({ pinData, onBack, onLoginRedirect }) {
    const { masked_phone, default_pin } = pinData
    const [pinVisible, setPinVisible] = useState(true)

    return (
        <>
        <style>{hoverCSS}</style>
        <div style={S.page}>
            <div className="vp-card" style={S.card}>
                <div style={S.logo}>✓</div>
                <h1 style={S.title}>Registration Complete!</h1>

                {/* SMS info */}
                <div style={S.infoBox}>
                    <span style={{ fontSize: 22 }}></span>
                    <div>
                        <p style={S.infoLabel}>PIN sent via SMS to</p>
                        <p style={S.infoPhone}>{masked_phone}</p>
                    </div>
                </div>

                {/* Default PIN display */}
                {default_pin && (
                    <div style={S.pinDisplayBox}>
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                            <span style={S.pinDisplayLabel}>Your Default PIN</span>
                            <button
                                className="vp-toggle"
                                onClick={() => setPinVisible(v => !v)}
                                style={{...S.toggleBtn, transition:"all .15s"}}
                            >
                                {pinVisible ? ' Hide' : 'Show'}
                            </button>
                        </div>
                        <div style={S.pinDisplayValue}>
                            {pinVisible
                                ? default_pin.toString().split('').map((d, i) => (
                                    <span key={i} className="vp-digit" style={{...S.pinDigitBadge, transition:"transform .15s", display:"inline-flex", alignItems:"center", justifyContent:"center"}}>{d}</span>
                                ))
                                : <span style={{ color: 'var(--text-muted)', fontSize: 24, letterSpacing: 8 }}>••••••</span>
                            }
                        </div>
                        <p style={S.pinDisplayHint}>
                            Use this PIN to log in. You can change it later from your profile settings.
                        </p>
                    </div>
                )}

                <button className="vp-btn" onClick={onLoginRedirect} style={{...S.btn, transition:"all .2s"}}>
                    Go to Login →
                </button>

                <button onClick={onBack} style={S.backBtn}>
                    ← Go back and scan face again
                </button>
            </div>
        </div>
        </>
    )
}

const S = {
    page: {
        minHeight: '100vh',
        background: 'var(--bg-primary)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontFamily: "'Inter', sans-serif",
    },
    card: {
        background: 'var(--bg-card)',
        border: '1px solid var(--border)',
        borderRadius: 16,
        padding: '40px 36px',
        width: 440,
        maxWidth: '95vw',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
    },
    logo: {
        width: 52,
        height: 52,
        background: 'var(--accent-dim)',
        borderRadius: '50%',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 26,
        fontWeight: 500,
        color: 'var(--accent)',
        fontFamily: 'monospace',
    },
    title: { fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', margin: 0 },
    infoBox: {
        width: '100%',
        background: 'var(--accent-dim)',
        border: '1px solid var(--border)',
        borderRadius: 10,
        padding: '14px 16px',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
    },
    infoLabel: {
        fontSize: 11,
        color: 'var(--text-muted)',
        margin: '0 0 2px',
        textTransform: 'uppercase',
        letterSpacing: '0.5px',
    },
    infoPhone: {
        fontSize: 16,
        fontWeight: 700,
        color: 'var(--accent)',
        margin: 0,
        fontFamily: 'monospace',
    },
    pinDisplayBox: {
        width: '100%',
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 12,
        padding: '16px 18px',
    },
    pinDisplayLabel: { fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', letterSpacing: '0.3px' },
    toggleBtn: {
        background: 'transparent',
        border: '1px solid var(--border)',
        borderRadius: 6,
        padding: '3px 10px',
        color: 'var(--text-muted)',
        fontSize: 11,
        cursor: 'pointer',
        transition: 'all 0.15s',
    },
    pinDisplayValue: {
        display: 'flex',
        gap: 6,
        justifyContent: 'center',
        margin: '10px 0 8px',
    },
    pinDigitBadge: {
        width: 36,
        height: 44,
        background: 'var(--bg-secondary)',
        border: '1px solid var(--border)',
        borderRadius: 8,
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 22,
        fontWeight: 600,
        color: 'var(--text-primary)',
        fontFamily: 'monospace',
    },
    pinDisplayHint: {
        fontSize: 11,
        color: 'var(--text-muted)',
        margin: 0,
        textAlign: 'center',
        lineHeight: 1.5,
    },
    btn: {
        width: '100%',
        padding: '14px 0',
        background: 'var(--accent)',
        border: 'none',
        borderRadius: 10,
        color: '#fff',
        fontSize: 15,
        fontWeight: 600,
        fontFamily: 'inherit',
        cursor: 'pointer',
        textDecoration: 'none',
    },
    backBtn: {
        background: 'transparent',
        border: 'none',
        color: 'var(--text-muted)',
        fontSize: 13,
        cursor: 'pointer',
        fontFamily: 'inherit',
        textDecoration: 'underline',
    },
}