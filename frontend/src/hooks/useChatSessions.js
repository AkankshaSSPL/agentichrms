import { useState, useRef, useCallback } from 'react'

const API = '/api'

function getToken() {
    return localStorage.getItem('hrms_token')
}

export function useChatSessions(authed) {
    const [sessions, setSessions] = useState([])
    const [currentSessionId, setCurrentSessionId] = useState(null)
    const [loadingSessions, setLoadingSessions] = useState(true)
    const [menuOpen, setMenuOpen] = useState(null)

    const fetchSessions = useCallback(async (onLoaded) => {
        if (!authed) return
        try {
            const res = await fetch(`${API}/chat/sessions`, {
                headers: { Authorization: `Bearer ${getToken()}` }
            })
            if (!res.ok) throw new Error()
            const data = await res.json()
            const sorted = [...data].sort((a, b) => {
                if (a.is_pinned && !b.is_pinned) return -1
                if (!a.is_pinned && b.is_pinned) return 1
                return new Date(b.created_at) - new Date(a.created_at)
            })
            setSessions(sorted)
            if (onLoaded) onLoaded(sorted)
        } catch (err) {
            console.error('Failed to load sessions', err)
        } finally {
            setLoadingSessions(false)
        }
    }, [authed])

    const createNewSession = async () => {
        try {
            const res = await fetch(`${API}/chat/sessions`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${getToken()}` }
            })
            const s = await res.json()
            setSessions(prev => [{ ...s, is_pinned: false }, ...prev])
            setCurrentSessionId(s.id)
            return s.id
        } catch (err) {
            console.error('Failed to create session', err)
            return null
        }
    }

    const updateSessionTitle = async (sessionId, title) => {
        try {
            const res = await fetch(`${API}/chat/sessions/${sessionId}/title`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                body: JSON.stringify({ title })
            })
            if (!res.ok) throw new Error()
            const updated = await res.json()
            setSessions(prev => prev.map(s => s.id === sessionId ? { ...s, title: updated.title } : s))
        } catch (err) {
            console.error('Failed to update title', err)
        }
    }

    const togglePinSession = async (sessionId, currentPinned) => {
        try {
            const res = await fetch(`${API}/chat/sessions/${sessionId}/pin`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${getToken()}` },
                body: JSON.stringify({ is_pinned: !currentPinned })
            })
            if (!res.ok) throw new Error()
            await fetchSessions()
        } catch {
            alert('Could not pin/unpin chat. Please try again.')
        }
    }

    const deleteSession = async (sessionId, currentSessionId, onDeleted) => {
        if (!confirm('Delete this chat? This cannot be undone.')) return
        try {
            const res = await fetch(`${API}/chat/sessions/${sessionId}`, {
                method: 'DELETE',
                headers: { Authorization: `Bearer ${getToken()}` }
            })
            if (!res.ok) throw new Error(`Server responded ${res.status}`)
            setSessions(prev => prev.filter(s => s.id !== sessionId))
            setMenuOpen(null)
            if (onDeleted) onDeleted(sessionId === currentSessionId)
        } catch (err) {
            alert(`Could not delete chat: ${err.message}`)
        }
    }

    const renameSession = async (sessionId, currentTitle) => {
        const t = prompt('Enter new chat name:', currentTitle)
        if (!t || !t.trim()) return
        await updateSessionTitle(sessionId, t.trim().slice(0, 40))
        setMenuOpen(null)
    }

    const clearSessions = () => {
        setSessions([])
        setCurrentSessionId(null)
        setLoadingSessions(true)
    }

    return {
        sessions, setSessions,
        currentSessionId, setCurrentSessionId,
        loadingSessions,
        menuOpen, setMenuOpen,
        fetchSessions,
        createNewSession,
        updateSessionTitle,
        togglePinSession,
        deleteSession,
        renameSession,
        clearSessions,
    }
}