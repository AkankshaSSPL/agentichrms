/**
 * ErrorBoundary.jsx
 * Catches any unhandled React render errors and shows a clean fallback UI
 * instead of a blank screen. Wrap the root <App /> with this in main.jsx.
 *
 * Usage in main.jsx:
 *   import ErrorBoundary from './components/ErrorBoundary'
 *   <ErrorBoundary><App /></ErrorBoundary>
 */

import { Component } from 'react'

export default class ErrorBoundary extends Component {
    constructor(props) {
        super(props)
        this.state = { hasError: false, error: null, errorInfo: null }
    }

    static getDerivedStateFromError(error) {
        return { hasError: true, error }
    }

    componentDidCatch(error, errorInfo) {
        this.setState({ errorInfo })
        // Log to console — replace with your error tracking service if needed
        console.error('[ErrorBoundary] Uncaught error:', error, errorInfo)
    }

    handleReload = () => {
        // Clear state and attempt re-render; if it fails again the boundary catches it
        this.setState({ hasError: false, error: null, errorInfo: null })
    }

    render() {
        if (!this.state.hasError) return this.props.children

        const { error, errorInfo } = this.state
        const isDev = import.meta.env?.DEV ?? false

        return (
            <div style={{
                minHeight: '100vh',
                background: 'var(--bg-primary, #0e0d1a)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 24,
                fontFamily: 'system-ui, sans-serif',
            }}>
                <div style={{
                    background: 'var(--bg-card, #181726)',
                    border: '1px solid var(--border, rgba(255,255,255,0.08))',
                    borderRadius: 20,
                    padding: '40px 36px',
                    maxWidth: 520,
                    width: '100%',
                    textAlign: 'center',
                    boxShadow: '0 24px 80px rgba(0,0,0,0.5)',
                }}>
                    {/* Icon */}
                    <div style={{ fontSize: 44, marginBottom: 16 }}>⚠️</div>

                    {/* Title */}
                    <h2 style={{
                        margin: '0 0 8px',
                        fontSize: 20,
                        fontWeight: 700,
                        color: 'var(--text-primary, #eeedf8)',
                    }}>
                        Something went wrong
                    </h2>

                    {/* Subtitle */}
                    <p style={{
                        margin: '0 0 28px',
                        fontSize: 13,
                        color: 'var(--text-muted, #6b7280)',
                        lineHeight: 1.6,
                    }}>
                        The application encountered an unexpected error.
                        Your data is safe — please try reloading the page.
                    </p>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                        <button
                            onClick={() => window.location.reload()}
                            style={{
                                padding: '10px 24px',
                                borderRadius: 10,
                                border: 'none',
                                background: 'var(--accent, #4f8ef7)',
                                color: '#fff',
                                fontSize: 13,
                                fontWeight: 600,
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                            }}
                        >
                            Reload page
                        </button>
                        <button
                            onClick={this.handleReload}
                            style={{
                                padding: '10px 24px',
                                borderRadius: 10,
                                border: '1px solid var(--border, rgba(255,255,255,0.08))',
                                background: 'transparent',
                                color: 'var(--text-secondary, #9896c8)',
                                fontSize: 13,
                                fontWeight: 500,
                                cursor: 'pointer',
                                fontFamily: 'inherit',
                            }}
                        >
                            Try again
                        </button>
                    </div>

                    {/* Dev-only error details */}
                    {isDev && error && (
                        <details style={{ marginTop: 28, textAlign: 'left' }}>
                            <summary style={{
                                fontSize: 11,
                                color: 'var(--text-muted, #6b7280)',
                                cursor: 'pointer',
                                userSelect: 'none',
                                marginBottom: 8,
                            }}>
                                Show error details (dev only)
                            </summary>
                            <pre style={{
                                fontSize: 11,
                                color: '#f87171',
                                background: 'rgba(248,113,113,0.06)',
                                border: '1px solid rgba(248,113,113,0.15)',
                                borderRadius: 8,
                                padding: '10px 12px',
                                overflowX: 'auto',
                                lineHeight: 1.5,
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-word',
                            }}>
                                {error.toString()}
                                {errorInfo?.componentStack || ''}
                            </pre>
                        </details>
                    )}
                </div>
            </div>
        )
    }
}