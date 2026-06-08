import { useState } from 'react'

const API = '/api'

export function useAuth() {
    const [authed, setAuthed] = useState(() => !!localStorage.getItem('hrms_token'))
    const [employee, setEmployee] = useState(() => {
        try { return JSON.parse(localStorage.getItem('hrms_employee') || 'null') } catch { return null }
    })

    async function handleLoginSuccess(token, emp) {
        localStorage.setItem('hrms_token', token)
        try {
            const res = await fetch(`${API}/onboarding-profile/me`, {
                headers: { Authorization: `Bearer ${token}` }
            })
            if (res.ok) {
                const fresh = await res.json()
                const merged = { ...emp, ...fresh, role: emp.role }
                localStorage.setItem('hrms_employee', JSON.stringify(merged))
                setEmployee(merged)
            } else {
                localStorage.setItem('hrms_employee', JSON.stringify(emp))
                setEmployee(emp)
            }
        } catch {
            localStorage.setItem('hrms_employee', JSON.stringify(emp))
            setEmployee(emp)
        }
        setAuthed(true)
    }

    function handleLogout() {
        localStorage.removeItem('hrms_token')
        localStorage.removeItem('hrms_employee')
        setEmployee(null)
        setAuthed(false)
    }

    function updateEmployee(updated) {
        const merged = { ...employee, ...updated }
        localStorage.setItem('hrms_employee', JSON.stringify(merged))
        setEmployee(merged)
    }

    return { authed, employee, handleLoginSuccess, handleLogout, updateEmployee }
}