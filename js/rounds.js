// Montagem das rodadas. A ESPN não informa a rodada de cada jogo, então ela é deduzida:
// numa rodada cada time joga uma vez. Os jogos se concentram numa janela de datas (o "miolo"
// da rodada); jogos adiados ou antecipados ficam soltos em outras datas e voltam para a rodada
// em que faltam os dois times.
import { HOUR } from './util.js';

const WINDOW_GAP_MS = 36 * HOUR;
const CORE_MIN = 5;

export const playsIn = (ev, teamId) => ev.home.id === teamId || ev.away.id === teamId;
const done = (e) => e.status.kind === 'post';
const pending = (e) => e.status.kind === 'pre' || e.status.kind === 'live';
const median = (list) => list[Math.floor(list.length / 2)].date.getTime();

export function sortEvents(events) {
  return [...events].sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
}

function newRound() {
  return { events: [], teams: new Set(), number: null };
}
function addTo(round, ev) {
  round.events.push(ev);
  round.teams.add(ev.home.id);
  round.teams.add(ev.away.id);
}

/**
 * @param events jogos normalizados
 * @param opts.standings classificação da ESPN (para numerar quando a temporada não está completa)
 * @param opts.fullSeason true quando os jogos cobrem a temporada desde a 1ª rodada
 */
export function buildRounds(events, { standings = [], fullSeason = false } = {}) {
  const list = sortEvents(events);
  for (const ev of list) ev.moved = false;

  // 1. Janelas de datas.
  const windows = [];
  let cur = null;
  for (const ev of list) {
    if (!cur || ev.date - cur.last > WINDOW_GAP_MS) { cur = { events: [], last: ev.date }; windows.push(cur); }
    cur.events.push(ev);
    cur.last = ev.date;
  }

  // 2. O miolo de cada janela: jogos sem repetir time, começando pelos mais próximos do meio da janela.
  const cores = [];
  const loose = [];
  for (const w of windows) {
    const mid = median(w.events);
    const byCenter = [...w.events].sort((a, b) => Math.abs(a.date - mid) - Math.abs(b.date - mid));
    const core = newRound();
    const rest = [];
    for (const ev of byCenter) {
      if (core.events.length < 10 && !core.teams.has(ev.home.id) && !core.teams.has(ev.away.id)) addTo(core, ev);
      else rest.push(ev);
    }
    if (core.events.length >= CORE_MIN) { cores.push(core); loose.push(...rest); } else loose.push(...w.events);
  }
  for (const c of cores) {
    c.events.sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
    c.coreFirst = c.events[0].date;
    c.coreLast = c.events[c.events.length - 1].date;
  }

  // 3. Jogos soltos voltam para a rodada mais próxima em que os dois times ainda não jogaram.
  const orphans = [];
  for (const ev of loose) {
    let best = null;
    let bestDist = Infinity;
    for (const c of cores) {
      if (c.events.length >= 10 || c.teams.has(ev.home.id) || c.teams.has(ev.away.id)) continue;
      const mid = (c.coreFirst.getTime() + c.coreLast.getTime()) / 2;
      const dist = Math.abs(ev.date - mid);
      if (dist < bestDist) { best = c; bestDist = dist; }
    }
    ev.moved = true;
    if (best) addTo(best, ev); else orphans.push(ev);
  }

  // Jogos que não couberam em nenhuma rodada ficam juntos, por janela.
  const rounds = [...cores];
  let extra = null;
  for (const ev of orphans) {
    if (!extra || ev.date - extra.coreLast > WINDOW_GAP_MS) {
      extra = { ...newRound(), coreFirst: ev.date, coreLast: ev.date, loose: true };
      rounds.push(extra);
    }
    addTo(extra, ev);
    extra.coreLast = ev.date;
  }

  for (const r of rounds) {
    r.events.sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
    r.first = r.events[0].date;
    r.last = r.events[r.events.length - 1].date;
    r.movedCount = r.events.filter((e) => e.moved).length;
  }
  rounds.sort((a, b) => a.coreFirst - b.coreFirst);

  const regular = rounds.filter((r) => !r.loose);
  if (fullSeason && regular.length <= 38) regular.forEach((r, i) => { r.number = i + 1; });
  else numberByStandings(regular, list, standings);
  return rounds;
}

// Em que jogo da temporada o time estaria nesta partida, pelos jogos disputados na classificação.
export function gameIndex(ev, teamId, played, list) {
  const mine = list.filter((e) => e !== ev && playsIn(e, teamId));
  const laterDone = mine.filter((e) => e.date > ev.date && done(e)).length;
  const earlierPending = mine.filter((e) => e.date < ev.date && pending(e)).length;
  return played - laterDone + earlierPending + (done(ev) ? 0 : 1);
}

function numberByStandings(rounds, list, standings) {
  const gp = new Map((standings || []).map((t) => [t.id, t.gp]));
  if (!gp.size) return;
  for (const r of rounds) {
    const votes = new Map();
    for (const ev of r.events) {
      if (ev.moved || ev.status.kind === 'live' || ev.status.kind === 'off') continue;
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
    if (rounds[i].number == null && rounds[i - 1].number != null) rounds[i].number = rounds[i - 1].number + 1;
  }
  for (let i = rounds.length - 2; i >= 0; i--) {
    if (rounds[i].number == null && rounds[i + 1].number != null && rounds[i + 1].number > 1) rounds[i].number = rounds[i + 1].number - 1;
  }
}

// Rodada a mostrar ao abrir: a que tem jogo ao vivo no miolo, a que está em andamento,
// a que acabou há pouco ou a próxima. Jogos remarcados não puxam a rodada antiga.
export function pickDefault(rounds, now = Date.now()) {
  const main = (r) => r.events.filter((e) => !e.moved);
  const live = rounds.findIndex((r) => !r.loose && main(r).some((e) => e.status.kind === 'live'));
  if (live >= 0) return live;
  let prev = -1;
  rounds.forEach((r, i) => { if (!r.loose && r.coreFirst <= now) prev = i; });
  let next = -1;
  for (let i = prev + 1; i < rounds.length; i++) if (!rounds[i].loose) { next = i; break; }
  if (prev >= 0) {
    const r = rounds[prev];
    const waiting = main(r).some((e) => e.status.kind === 'pre' && e.date > now - 3 * HOUR);
    if (waiting || next < 0 || now - r.coreLast < 20 * HOUR) return prev;
  }
  return next >= 0 ? next : rounds.length - 1;
}

export const roundName = (r) => (r?.loose ? 'Jogos avulsos' : r?.number ? `Rodada ${r.number}` : 'Rodada');
export const isFinished = (r) => r.events.every((e) => e.status.kind === 'post' || e.status.kind === 'off');
