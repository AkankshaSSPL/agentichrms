/**
 * useDocuments — fetch document list, serve raw files, log views.
 * Mirrors the useBehaviorAlerts pattern: API='/api', token from localStorage.
 */

import { useState, useCallback } from 'react'

const API = '/api'

function getToken() {
    return localStorage.getItem('hrms_token') || ''
}

export function useDocuments() {
    const [documents, setDocuments] = useState([])
    const [loading, setLoading]     = useState(false)
    const [error, setError]         = useState(null)

    /** Fetch the full document list from ChromaDB metadata. */
    const loadDocuments = useCallback(async () => {
        setLoading(true)
        setError(null)
        try {
            const res = await fetch(`${API}/documents`, {
                headers: { Authorization: `Bearer ${getToken()}` },
            })
            if (!res.ok) throw new Error(`Server ${res.status}`)
            const data = await res.json()
            setDocuments(data.documents || [])
        } catch (e) {
            setError(e.message)
        } finally {
            setLoading(false)
        }
    }, [])

    /**
     * Fetch a document as a Blob and return an object URL for inline rendering.
     * The Authorization header is required — that's why we fetch-to-blob
     * instead of putting the URL directly in an <iframe src>.
     * Caller is responsible for revoking the URL with URL.revokeObjectURL().
     */
    const openRaw = useCallback(async (filename) => {
        const enc = encodeURIComponent(filename)
        const res = await fetch(`${API}/documents/${enc}/raw`, {
            headers: { Authorization: `Bearer ${getToken()}` },
        })
        if (!res.ok) throw new Error(`Could not load document (${res.status})`)
        const blob = await res.blob()
        return { url: URL.createObjectURL(blob), contentType: blob.type }
    }, [])

    /**
     * Fire-and-forget view log — feeds behavioral analytics.
     * Never throws; viewer must not break if analytics is down.
     */
    const logView = useCallback(async (filename) => {
        try {
            const enc = encodeURIComponent(filename)
            await fetch(`${API}/documents/${enc}/view`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${getToken()}` },
            })
        } catch {
            // non-fatal — analytics failure is silent
        }
    }, [])

    /**
     * Upload a new document. HR/Admin only — backend enforces this too,
     * this is just the client call. Returns the parsed JSON response.
     */
    const uploadDocument = useCallback(async (file) => {
        const formData = new FormData()
        formData.append('file', file)
        const res = await fetch(`${API}/documents/upload`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${getToken()}` },
            body: formData,
        })
        if (!res.ok) {
            const text = await res.text().catch(() => '')
            throw new Error(text || `Upload failed (${res.status})`)
        }
        return res.json()
    }, [])

    return { documents, loading, error, loadDocuments, openRaw, logView, uploadDocument }
}