// Efeitos de gol: som sintetizado, vibração e confete.
import { save, store } from './util.js';

const SOUND_KEY = 'som';
let soundOn = store(SOUND_KEY, false) === true;
let audio = null;

export const isSoundOn = () => soundOn;

// O navegador só libera áudio depois de um toque; o contexto é criado no primeiro gesto.
function unlock() {
  if (!soundOn) return;
  try {
    audio ||= new (window.AudioContext || window.webkitAudioContext)();
    if (audio.state === 'suspended') audio.resume();
  } catch { audio = null; }
}
document.addEventListener('pointerdown', unlock, { passive: true });

export function toggleSound() {
  soundOn = !soundOn;
  save(SOUND_KEY, soundOn);
  if (soundOn) { unlock(); playGoal(); }
  return soundOn;
}

// Torcida (ruído filtrado que sobe e desce) e duas notas de corneta.
export function playGoal() {
  if (!soundOn || !audio || audio.state !== 'running') return;
  const t = audio.currentTime;
  const len = 2.2;
  const buf = audio.createBuffer(1, audio.sampleRate * len, audio.sampleRate);
  const ch = buf.getChannelData(0);
  for (let i = 0; i < ch.length; i++) ch[i] = Math.random() * 2 - 1;
  const noise = audio.createBufferSource();
  noise.buffer = buf;
  const band = audio.createBiquadFilter();
  band.type = 'bandpass';
  band.frequency.setValueAtTime(700, t);
  band.frequency.linearRampToValueAtTime(1300, t + 0.4);
  band.Q.value = 0.8;
  const crowd = audio.createGain();
  crowd.gain.setValueAtTime(0.0001, t);
  crowd.gain.exponentialRampToValueAtTime(0.5, t + 0.35);
  crowd.gain.exponentialRampToValueAtTime(0.0001, t + len);
  noise.connect(band).connect(crowd).connect(audio.destination);
  noise.start(t);
  noise.stop(t + len);

  [[440, 0.05], [587, 0.3]].forEach(([f, at]) => {
    const osc = audio.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = f;
    const g = audio.createGain();
    g.gain.setValueAtTime(0.0001, t + at);
    g.gain.exponentialRampToValueAtTime(0.18, t + at + 0.03);
    g.gain.exponentialRampToValueAtTime(0.0001, t + at + 0.24);
    osc.connect(g).connect(audio.destination);
    osc.start(t + at);
    osc.stop(t + at + 0.26);
  });
}

export function buzz() {
  try { navigator.vibrate?.([120, 60, 120]); } catch { /* sem vibração */ }
}

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

export function confetti(colors = ['#f5c518', '#0b6b3a', '#ffffff']) {
  if (reduceMotion()) return;
  const canvas = document.createElement('canvas');
  canvas.className = 'confetti';
  document.body.appendChild(canvas);
  const ctx = canvas.getContext('2d');
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth;
  const h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  ctx.scale(dpr, dpr);
  const parts = Array.from({ length: 140 }, () => ({
    x: w / 2 + (Math.random() - 0.5) * w * 0.4,
    y: h * 0.35,
    vx: (Math.random() - 0.5) * 9,
    vy: -Math.random() * 11 - 4,
    r: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    s: 5 + Math.random() * 5,
    c: colors[Math.floor(Math.random() * colors.length)],
  }));
  const start = performance.now();
  const frame = (now) => {
    const elapsed = now - start;
    ctx.clearRect(0, 0, w, h);
    for (const p of parts) {
      p.vy += 0.32;
      p.vx *= 0.99;
      p.x += p.vx;
      p.y += p.vy;
      p.r += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.r);
      ctx.globalAlpha = Math.max(0, 1 - elapsed / 2600);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
      ctx.restore();
    }
    if (elapsed < 2600) requestAnimationFrame(frame); else canvas.remove();
  };
  requestAnimationFrame(frame);
}
