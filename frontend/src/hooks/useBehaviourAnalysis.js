/**
 * frontend/src/hooks/useBehaviourAnalysis.js
 * Mirrors useBehaviorAlerts.js — fetch + action pattern.
 */

import { useState, useCallback } from 'react'

const API = '/api'

function getToken() {
    return localStorage.getItem('hrms_token') || ''
}

export function useBehaviourAnalysis() {
    const [dashboard, setDashboard] = useState([])
    const [loadingDashboard, setLoadingDashboard] = useState(false)
    const [analysis, setAnalysis] = useState(null)
    const [analyzing, setAnalyzing] = useState(false)
    const [overview, setOverview] = useState(null)
    const [loadingOverview, setLoadingOverview] = useState(false)
    const [history, setHistory] = useState([])
    const [loadingHistory, setLoadingHistory] = useState(false)
    const [error, setError] = useState(null)

    const loadDashboard = useCallback(async () => {
        setLoadingDashboard(true)
        setError(null)
        try {
            const res = await fetch(`${API}/behaviour-analysis`, {
                headers: { Authorization: `Bearer ${getToken()}` },
            })
            if (!res.ok) throw new Error(`Server ${res.status}`)
            setDashboard(await res.json())
        } catch (e) {
            setError(e.message)
        } finally {
            setLoadingDashboard(false)
        }
    }, [])

    const loadOverview = useCallback(async () => {
        setLoadingOverview(true)
        setError(null)
        try {
            const res = await fetch(`${API}/behaviour-analysis/overview`, {
                headers: { Authorization: `Bearer ${getToken()}` },
            })
            if (!res.ok) throw new Error(`Server ${res.status}`)
            setOverview(await res.json())
        } catch (e) {
            setError(e.message)
        } finally {
            setLoadingOverview(false)
        }
    }, [])

    const loadHistory = useCallback(async (employeeId) => {
        setLoadingHistory(true)
        try {
            const res = await fetch(`${API}/behaviour-analysis/${employeeId}/history`, {
                headers: { Authorization: `Bearer ${getToken()}` },
            })
            if (!res.ok) throw new Error(`Server ${res.status}`)
            const data = await res.json()
            setHistory(Array.isArray(data) ? data : [])
            return data
        } catch (e) {
            setError(e.message)
            setHistory([])
            return []
        } finally {
            setLoadingHistory(false)
        }
    }, [])

    const getAnalysis = useCallback(async (employeeId) => {
        try {
            const res = await fetch(`${API}/behaviour-analysis/${employeeId}`, {
                headers: { Authorization: `Bearer ${getToken()}` },
            })
            if (!res.ok) throw new Error(`Server ${res.status}`)
            const data = await res.json()
            setAnalysis(data)
            return data
        } catch (e) {
            setError(e.message)
            return null
        }
    }, [])

    const runAnalysis = useCallback(async (employeeId) => {
        setAnalyzing(true)
        setError(null)
        try {
            const res = await fetch(`${API}/behaviour-analysis/${employeeId}`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${getToken()}` },
            })
            if (!res.ok) throw new Error(`Server ${res.status}`)
            const data = await res.json()
            setAnalysis(data)
            return data
        } catch (e) {
            setError(e.message)
            return { status: 'error', detail: e.message }
        } finally {
            setAnalyzing(false)
        }
    }, [])

    return {
        dashboard, loadingDashboard, loadDashboard,
        analysis, setAnalysis, getAnalysis,
        runAnalysis, analyzing,
        overview, loadingOverview, loadOverview,
        history, loadingHistory, loadHistory,
        error,
    }
}