'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  motion,
  animate,
  useMotionValue,
  useTransform,
  AnimatePresence,
} from 'framer-motion';

const TICKS = 80;
const SZ = 380;
const C = SZ / 2;
const FACE_R = 138;
const T_IN = FACE_R + 10;

const BASE = 7;
const AMP_DIM = 4;
const AMP_ON = 19;
const AMP_TIP = 30;
const TAU = Math.PI * 2;

const GEO = Array.from({ length: TICKS }, (_, i) => {
  const a = (i / TICKS) * TAU - Math.PI / 2;
  return {
    i, cos: Math.cos(a), sin: Math.sin(a),
    x1: C + T_IN * Math.cos(a), y1: C + T_IN * Math.sin(a)
  };
});

function wave(i, t) {
  const p = i / TICKS;
  return (Math.sin(p * TAU * 3 + t * 0.0018) + 1) / 2 * 0.55
    + (Math.sin(p * TAU * 6 + t * 0.0032) + 1) / 2 * 0.28
    + (Math.sin(p * TAU * 1.5 + t * 0.001) + 1) / 2 * 0.17;
}

export default function FaceIDAnimation({
  captureIndex = 0,
  isScanning = false,
  demoMode = false,
  onComplete = null,
}) {
  const [done, setDone] = useState(false);
  const lineRefs = useRef(new Array(TICKS).fill(null));
  const greenRef = useRef(0);
  const fillCtrl = useRef(null);
  const scanCtrl = useRef(null);

  const beamRelY = useMotionValue(-1);
  const beamTop = useTransform(beamRelY, v => C + v * FACE_R * 0.84 - 34);

  const isComplete = demoMode ? done : captureIndex >= 5;

  useEffect(() => {
    const loop = (t) => {
      const gc = greenRef.current;
      GEO.forEach(({ i, cos, sin, x1, y1 }) => {
        const el = lineRefs.current[i];
        if (!el) return;
        const w = wave(i, t);
        const isOn = i < gc;
        const isTip = isOn && i >= gc - 3 && gc < TICKS;
        const amp = isTip ? AMP_TIP : isOn ? AMP_ON : AMP_DIM;
        el.setAttribute('x2', C + (T_IN + BASE + w * amp) * cos);
        el.setAttribute('y2', C + (T_IN + BASE + w * amp) * sin);
        const wasOn = el.dataset.on === '1';
        const wasTip = el.dataset.tip === '1';
        if (wasOn !== isOn || wasTip !== isTip) {
          el.dataset.on = isOn ? '1' : '0';
          el.dataset.tip = isTip ? '1' : '0';
          el.setAttribute('stroke',
            isTip ? '#d4ffe8' : isOn ? '#22c55e' : 'rgba(255,255,255,0.16)');
          el.setAttribute('stroke-width', isOn ? '3' : '2');
          el.style.filter = isTip ? 'drop-shadow(0 0 6px #4ade80) drop-shadow(0 0 12px #16a34a)'
            : isOn ? 'drop-shadow(0 0 2.5px #16a34a)'
              : 'none';
        }
      });
      requestAnimationFrame(loop);
    };
    const id = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    if (!demoMode) return;
    fillCtrl.current?.stop();
    setDone(false);
    greenRef.current = 0;
    fillCtrl.current = animate(0, TICKS, {
      duration: 9, ease: 'linear',
      onUpdate: v => { greenRef.current = v; },
      onComplete: () => { greenRef.current = TICKS; setDone(true); onComplete?.(); },
    });
    return () => fillCtrl.current?.stop();
  }, [demoMode]);

  useEffect(() => {
    if (demoMode) return;
    fillCtrl.current?.stop();
    const target = Math.round((Math.min(captureIndex, 5) / 5) * TICKS);
    if (Math.round(greenRef.current) === target) return;
    fillCtrl.current = animate(greenRef.current, target, {
      duration: 1.6, ease: 'linear',
      onUpdate: v => { greenRef.current = v; },
    });
    return () => fillCtrl.current?.stop();
  }, [captureIndex, demoMode]);

  useEffect(() => {
    scanCtrl.current?.stop();
    if ((!isScanning && !demoMode) || isComplete) return;
    scanCtrl.current = animate(beamRelY, [-1, 1], {
      duration: 2.2, repeat: Infinity, repeatType: 'reverse', ease: 'easeInOut',
    });
    return () => scanCtrl.current?.stop();
  }, [isScanning, demoMode, isComplete]);

  const label = isComplete ? 'Face ID Registered' : 'Move your head slowly to complete the circle';

  return (
    <motion.div
      style={S.root}
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
    >
      <svg width={SZ} height={SZ} viewBox={`0 0 ${SZ} ${SZ}`} style={{ overflow: 'visible' }}>
        <defs>
          <clipPath id="fc"><circle cx={C} cy={C} r={FACE_R} /></clipPath>
          <radialGradient id="be" cx="50%" cy="50%" r="50%">
            <stop offset="56%" stopColor="rgba(0,0,0,0)" />
            <stop offset="100%" stopColor="rgba(0,0,0,.97)" />
          </radialGradient>
          <filter id="rg" x="-22%" y="-22%" width="144%" height="144%">
            <feGaussianBlur stdDeviation="10" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="cg" x="-90%" y="-90%" width="280%" height="280%">
            <feGaussianBlur stdDeviation="4.5" result="b" />
            <feMerge><feMergeNode in="b" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
        </defs>

        {/* 🔥 CRITICAL: transparent inner circle – lets webcam show through */}
        <circle cx={C} cy={C} r={FACE_R} fill="none" />

        <AnimatePresence>
          {!isComplete && (
            <motion.g clipPath="url(#fc)"
              initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}
              transition={{ duration: 0.35 }}>
              <motion.rect x={C - FACE_R} width={FACE_R * 2} height={68}
                fill="url(#bg)" style={{ y: beamTop }} />
              <circle cx={C} cy={C} r={FACE_R} fill="url(#be)" />
            </motion.g>
          )}
        </AnimatePresence>

        <motion.circle cx={C} cy={C} r={FACE_R} fill="none" strokeWidth={5}
          animate={{ stroke: isComplete ? '#15803d' : '#1c1c1e' }}
          transition={{ duration: 0.8 }} />

        {GEO.map(({ i, x1, y1 }) => (
          <line key={i}
            ref={el => { lineRefs.current[i] = el; }}
            x1={x1} y1={y1} x2={x1} y2={y1}
            stroke="rgba(255,255,255,0.16)" strokeWidth="2" strokeLinecap="round"
            style={{ opacity: 0, animation: `tIn .35s ease-out ${(i * .007).toFixed(3)}s both` }}
          />
        ))}

        <AnimatePresence>
          {isComplete && (
            <>
              <motion.circle cx={C} cy={C} r={FACE_R + 18} fill="none"
                stroke="rgba(34,197,94,0.6)" strokeWidth={3} filter="url(#rg)"
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: [0, 1, .38, 1, .38], scale: [.9, 1.02, .99, 1.02, .99] }}
                exit={{ opacity: 0 }}
                transition={{ duration: 2.6, repeat: Infinity, ease: 'easeInOut' }} />
              <motion.path
                d={`M ${C - 28} ${C + 2} L ${C - 5} ${C + 26} L ${C + 32} ${C - 24}`}
                fill="none" stroke="#22c55e" strokeWidth={4}
                strokeLinecap="round" strokeLinejoin="round" filter="url(#cg)"
                initial={{ pathLength: 0, opacity: 0 }}
                animate={{ pathLength: 1, opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{
                  pathLength: { duration: 0.7, ease: [0.16, 1, 0.3, 1], delay: 0.1 },
                  opacity: { duration: 0.25 },
                }} />
            </>
          )}
        </AnimatePresence>
      </svg>

      <motion.p style={S.label}
        animate={{ color: isComplete ? '#22c55e' : 'rgba(255,255,255,0.7)' }}
        transition={{ duration: 0.55 }}>
        {label}
      </motion.p>

      <style>{`@keyframes tIn { from{opacity:0} to{opacity:1} }`}</style>
    </motion.div>
  );
}

const S = {
  root: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: '2.4rem', padding: '3.5rem 3rem', background: 'transparent', borderRadius: '2rem',
  },
  label: {
    margin: 0, textAlign: 'center', maxWidth: '28ch',
    fontFamily: "-apple-system,'SF Pro Text','Geist',system-ui,sans-serif",
    fontSize: '0.95rem', fontWeight: 400, lineHeight: 1.5, letterSpacing: '0.01em',
  },
};