export const HOUR = 3600e3;

export const pad = (n) => String(n).padStart(2, '0');
export const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
export const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
export const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ESC[c]);

export const fmtTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const fmtWeekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' });
const fmtWeekdayShort = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });
export const dm = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
export const weekdayShort = (d) => fmtWeekdayShort.format(d).replace('.', '');
export const shortDay = (d) => `${weekdayShort(d)} ${dm(d)}`;
export const decimal = (n) => n.toLocaleString('pt-BR', { maximumFractionDigits: 1 });

export function dayLabel(d, now = new Date()) {
  if (sameDay(d, now)) return `Hoje, ${dm(d)}`;
  if (sameDay(d, addDays(now, -1))) return `Ontem, ${dm(d)}`;
  if (sameDay(d, addDays(now, 1))) return `Amanhã, ${dm(d)}`;
  return `${fmtWeekday.format(d)}, ${dm(d)}`;
}

// "Hoje 16:00", "sáb 16:00"
export function kickoff(d, now = new Date()) {
  if (sameDay(d, now)) return `hoje às ${fmtTime.format(d)}`;
  if (sameDay(d, addDays(now, 1))) return `amanhã às ${fmtTime.format(d)}`;
  return `${weekdayShort(d)} ${dm(d)} às ${fmtTime.format(d)}`;
}

// "45'+2'" -> {base: 45, extra: 2, label: "45+2'"}
export function parseMinute(s) {
  const m = /(\d+)'?\s*(?:\+\s*(\d+))?/.exec(String(s || ''));
  if (!m) return { base: null, extra: 0, label: '', sort: 999 };
  const base = Number(m[1]);
  const extra = m[2] ? Number(m[2]) : 0;
  return { base, extra, label: extra ? `${base}+${extra}'` : `${base}'`, sort: base + extra / 100 };
}

export const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
export const scoreText = (a, b) => `${a} a ${b}`;

export function store(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}
export function save(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* armazenamento indisponível */ }
}

// Artigos para nomes de clubes: "o Flamengo", "a Chapecoense".
const FEMININE = /chapecoense|ponte preta|portuguesa|ferroviária|tombense|aparecidense|caldense|desportiva/i;
const fem = (name) => FEMININE.test(name || '');
export const o = (name) => `${fem(name) ? 'a' : 'o'} ${name}`;
export const doo = (name) => `${fem(name) ? 'da' : 'do'} ${name}`;
export const ao = (name) => `${fem(name) ? 'à' : 'ao'} ${name}`;
