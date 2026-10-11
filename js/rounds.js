// Agrupamento dos jogos em rodadas. A ESPN não informa o número da rodada: uma rodada nova
// começa quando há um intervalo longo ou quando um time já jogou no grupo atual.
import { HOUR } from './util.js';

const ROUND_GAP_MS = 36 * HOUR;

export const playsIn = (ev, teamId) => ev.home.id === teamId || ev.away.id === teamId;
const done = (e) => e.status.kind === 'post';
const pending = (e) => e.status.kind === 'pre' || e.status.kind === 'live';

export function sortEvents(events) {
  return [...events].sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
}

export function buildRounds(events, standings) {
  const list = sortEvents(events);
  const rounds = [];
  let cur = null;
  for (const ev of list) {
    const clash = cur && (cur.teams.has(ev.home.id) || cur.teams.has(ev.away.id));
    if (!cur || ev.date - cur.last > ROUND_GAP_MS || clash) {
      cur = { events: [], teams: new Set(), first: ev.date, last: ev.date, number: null };
      rounds.push(cur);
    }
    cur.events.push(ev);
    cur.teams.add(ev.home.id);
    cur.teams.add(ev.away.id);
    cur.last = ev.date;
  }
  numberRounds(rounds, list, standings);
  return rounds;
}

// Em que rodada o time estaria neste jogo, pelos jogos disputados na classificação.
export function gameIndex(ev, teamId, played, list) {
  const mine = list.filter((e) => e !== ev && playsIn(e, teamId));
  const laterDone = mine.filter((e) => e.date > ev.date && done(e)).length;
  const earlierPending = mine.filter((e) => e.date < ev.date && pending(e)).length;
  return played - laterDone + earlierPending + (done(ev) ? 0 : 1);
}

function numberRounds(rounds, list, standings) {
  const gp = new Map((standings || []).map((t) => [t.id, t.gp]));
  if (!gp.size) return;
  for (const r of rounds) {
    const votes = new Map();
    for (const ev of r.events) {
      if (ev.status.kind === 'live' || ev.status.kind === 'off') continue;
      for (const t of [ev.home, ev.away]) {
        if (!gp.has(t.id)) continue;
        const n = gameIndex(ev, t.id, gp.get(t.id), list);
        if (n >= 1 && n <= 38) votes.set(n, (votes.get(n) || 0) + 1);
      }
    }
    let best = null;
    let bestVotes = 0;
    let total = 0;
    for (const [n, v] of votes) {
      total += v;
      if (v > bestVotes) { best = n; bestVotes = v; }
    }
    if (best != null && bestVotes * 2 >= total) r.number = best;
  }
  for (let i = 1; i < rounds.length; i++) {
    const p = rounds[i - 1];
    const r = rounds[i];
    if (r.number == null && p.number != null && p.events.length >= 8 && r.events.length >= 8) r.number = p.number + 1;
  }
}

// Rodada a mostrar ao abrir: a que tem jogo ao vivo, a que está em andamento,
// a que acabou há pouco ou a próxima.
export function pickDefault(rounds, now = Date.now()) {
  const live = rounds.findIndex((r) => r.events.some((e) => e.status.kind === 'live'));
  if (live >= 0) return live;
  let prev = -1;
  rounds.forEach((r, i) => { if (r.first <= now) prev = i; });
  const next = prev + 1 < rounds.length ? prev + 1 : -1;
  if (prev >= 0) {
    const r = rounds[prev];
    const waiting = r.events.some((e) => e.status.kind === 'pre' && e.date > now - 3 * HOUR);
    if (waiting || next < 0 || now - r.last < 20 * HOUR) return prev;
  }
  return next >= 0 ? next : rounds.length - 1;
}

export const roundName = (r) => (r?.number ? `Rodada ${r.number}` : 'Rodada');
