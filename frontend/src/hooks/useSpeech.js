import { useState } from 'react'

export function useSpeech() {
    const [isListening, setIsListening] = useState(false)
    const [isSpeaking, setIsSpeaking] = useState(false)
    const [voiceCooldown, setVoiceCooldown] = useState(false)
    const [playingMsgIndex, setPlayingMsgIndex] = useState(null)

    let activeRecognition = null

    const startCooldown = () => {
        setVoiceCooldown(true)
        setTimeout(() => setVoiceCooldown(false), 800)
    }

    const speakText = (text, index) => {
        if (!('speechSynthesis' in window)) return
        if (playingMsgIndex === index) {
            window.speechSynthesis.cancel()
            setPlayingMsgIndex(null)
            setIsSpeaking(false)
            startCooldown()
            return
        }
        window.speechSynthesis.cancel()
        const u = new SpeechSynthesisUtterance(text)
        u.lang = 'en-US'
        u.onstart = () => setIsSpeaking(true)
        u.onend = () => { setIsSpeaking(false); setPlayingMsgIndex(null); startCooldown() }
        u.onerror = () => { setIsSpeaking(false); setPlayingMsgIndex(null); startCooldown() }
        window.speechSynthesis.speak(u)
        setPlayingMsgIndex(index)
    }

    const startVoiceRecognition = (onResult) => {
        if (isSpeaking || voiceCooldown) {
            alert('Please wait a moment before using voice input.')
            return
        }
        if (activeRecognition) {
            try { activeRecognition.abort() } catch { }
            activeRecognition = null
        }
        const SR = window.SpeechRecognition || window.webkitSpeechRecognition
        if (!SR) {
            alert('Speech recognition not supported. Please use Chrome, Edge, or Safari.')
            return
        }
        const r = new SR()
        r.continuous = false
        r.interimResults = false
        r.lang = 'en-US'
        activeRecognition = r
        setIsListening(true)
        r.onresult = (e) => {
            onResult(e.results[0][0].transcript)
            r.stop()
            setIsListening(false)
            activeRecognition = null
        }
        r.onerror = (e) => {
            if (e.error === 'not-allowed') alert('Microphone access denied.')
            setIsListening(false)
            activeRecognition = null
        }
        r.onend = () => {
            setIsListening(false)
            if (activeRecognition === r) activeRecognition = null
        }
        r.start()
    }

    return { isListening, isSpeaking, voiceCooldown, playingMsgIndex, speakText, startVoiceRecognition }
}