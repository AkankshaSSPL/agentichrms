import { useState } from 'react'

const API = '/api'

export function useNudges() {
    const [pendingNudge, setPendingNudge] = useState(null)
    const [loading, setLoading] = useState(false)

    const fetchPendingNudge = async (token) => {
        if (!token) return null
        setLoading(true)
        try {
            const res = await fetch(`${API}/chat/pending-nudge`, {
                headers: { Authorization: `Bearer ${token}` }
            })
            if (!res.ok) {
                // 401 or other error -> return null
                return null
            }
            const data = await res.json()
            if (data && data.id && data.nudge_text) {
                setPendingNudge(data)
                return data
            }
            setPendingNudge(null)
            return null
        } catch (e) {
            console.warn('Failed to fetch nudge:', e)
            setPendingNudge(null)
            return null
        } finally {
            setLoading(false)
        }
    }

    const dismissNudge = async (id, token) => {
        if (!id || !token) return
        try {
            await fetch(`${API}/chat/nudge/${id}/dismiss`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` }
            })
            setPendingNudge(null)
        } catch (e) {
            console.warn('Failed to dismiss nudge:', e)
        }
    }

    return { pendingNudge, loading, fetchPendingNudge, dismissNudge }
}