// Bolão pessoal: palpites guardados só neste aparelho.
// Placar exato vale 3 pontos; acertar vencedor ou empate vale 1.
import { save, store } from './util.js';

const KEY = 'bolao:v1';
let data = store(KEY, null);
if (!data || typeof data !== 'object' || !data.picks) data = { picks: {}, finals: {} };

const persist = () => save(KEY, data);

export const canPick = (ev, now = Date.now()) => ev.status.kind === 'pre' && ev.date.getTime() > now;
export const getPick = (id) => data.picks[id] || null;

export function setPick(ev, h, a) {
  if (!canPick(ev)) return null;
  const clamp = (n) => Math.max(0, Math.min(15, n | 0));
  data.picks[ev.id] = { h: clamp(h), a: clamp(a), home: ev.home.name, away: ev.away.name, t: ev.date.getTime() };
  persist();
  return data.picks[ev.id];
}

export function clearPick(ev) {
  if (!canPick(ev)) return;
  delete data.picks[ev.id];
  persist();
}

export function grade(pick, h, a) {
  if (!pick || h == null || a == null) return null;
  if (pick.h === h && pick.a === a) return { pts: 3, kind: 'exato', label: 'Na mosca' };
  if (Math.sign(pick.h - pick.a) === Math.sign(h - a)) return { pts: 1, kind: 'resultado', label: 'Acertou o resultado' };
  return { pts: 0, kind: 'erro', label: 'Errou' };
}

/** Guarda o placar final dos jogos palpitados. Devolve a nota quando o jogo acabou de terminar. */
export function observe(ev) {
  const pick = data.picks[ev.id];
  if (!pick || ev.status.kind !== 'post' || ev.home.score == null || data.finals[ev.id]) return null;
  data.finals[ev.id] = { h: ev.home.score, a: ev.away.score };
  persist();
  return grade(pick, ev.home.score, ev.away.score);
}

/** Pontos somados, opcionalmente só para alguns jogos. */
export function totals(ids) {
  const out = { pts: 0, exact: 0, right: 0, graded: 0, open: 0 };
  for (const [id, pick] of Object.entries(data.picks)) {
    if (ids && !ids.has(id)) continue;
    const f = data.finals[id];
    if (!f) { out.open++; continue; }
    const g = grade(pick, f.h, f.a);
    out.graded++;
    out.pts += g.pts;
    if (g.kind === 'exato') out.exact++;
    if (g.kind !== 'erro') out.right++;
  }
  return out;
}
