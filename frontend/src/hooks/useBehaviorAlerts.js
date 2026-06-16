/**
 * frontend/src/hooks/useBehaviorAlerts.js
 * Mirrors useChatSessions.js — data fetching + actions for behavioral alerts.
 */

import { useState, useCallback } from 'react'

const API = '/api'

function getToken() {
    return localStorage.getItem('hrms_token')
}

export function useBehaviorAlerts() {
    const [alerts, setAlerts]   = useState([])
    const [loading, setLoading] = useState(false)
    const [error, setError]     = useState(null)

    const loadAlerts = useCallback(async (status = 'open') => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch(`${API}/behavior/alerts?status=${status}`, {
                headers: { Authorization: `Bearer ${getToken()}` },
            })
            if (!res.ok) throw new Error(`Server ${res.status}`)
            setAlerts(await res.json())
        } catch (err) {
            console.error('Failed to load behavior alerts', err)
            setError(err.message)
        } finally {
            setLoading(false)
        }
    }, [])

    const resolveAlert = useCallback(async (alertId, hrNote = '') => {
        try {
            const res = await fetch(`${API}/behavior/alerts/${alertId}/resolve`, {
                method:  'PATCH',
                headers: {
                    'Content-Type': 'application/json',
                    Authorization: `Bearer ${getToken()}`,
                },
                body: JSON.stringify({ hr_note: hrNote || null }),
            })
            if (!res.ok) throw new Error(`Server ${res.status}`)
            // Optimistically remove from list
            setAlerts(prev => prev.filter(a => a.id !== alertId))
            return true
        } catch (err) {
            console.error('Failed to resolve alert', err)
            return false
        }
    }, [])

    return { alerts, loading, error, loadAlerts, resolveAlert }
}