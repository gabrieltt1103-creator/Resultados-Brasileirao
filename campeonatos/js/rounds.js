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

/**
 * Quando um jogo é adiado e remarcado, a ESPN mantém o original como "adiado" e cria outro
 * com a nova data. Fica só o novo; o adiado sem nova data continua (ainda vai ser jogado).
 */
export function dropReplaced(events) {
  const live = new Set();
  for (const e of events) if (e.status.kind !== 'off') live.add(`${e.home.id}|${e.away.id}`);
  return events.filter((e) => e.status.kind !== 'off' || !live.has(`${e.home.id}|${e.away.id}`));
}

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
  let why = 'temporada incompleta';
  if (fullSeason) {
    const mirrored = byMirror(list);
    if (Array.isArray(mirrored)) { mirrored.method = 'espelho'; return mirrored; }
    why = mirrored;
    for (const ev of list) ev.moved = false;
  }
  const rounds = byWindows(list, standings, fullSeason);
  rounds.method = 'janelas';
  rounds.why = why;
  return rounds;
}

// Janelas de datas: um intervalo de mais de 36 h começa outra janela.
function windowsOf(games) {
  const index = new Map();
  let w = -1;
  let last = null;
  for (const ev of games) {
    if (last === null || ev.date - last > WINDOW_GAP_MS) w++;
    index.set(ev, w);
    last = ev.date;
  }
  return index;
}

/**
 * Rodadas pelo espelho do turno: no Brasileirão a rodada r+19 repete a rodada r com o mando
 * invertido, então os dois jogos de cada confronto ficam no mesmo "par de rodadas". Se um dos
 * dois foi adiado ou a rodada foi dividida em datas diferentes, o outro jogo mostra onde o
 * confronto pertence. Precisa da temporada inteira; se algo não fechar, devolve o motivo.
 */
export function byMirror(list) {
  const teams = new Set(list.flatMap((e) => [e.home.id, e.away.id]));
  const n = teams.size;
  if (n < 4 || n % 2) return `número de times: ${n}`;
  const pairs = new Map();
  for (const ev of list) {
    const k = [ev.home.id, ev.away.id].sort().join('|');
    if (!pairs.has(k)) pairs.set(k, []);
    pairs.get(k).push(ev);
  }
  if (pairs.size !== (n * (n - 1)) / 2) return `confrontos: ${pairs.size}`;
  for (const g of pairs.values()) if (g.length !== 2 || g[0].home.id === g[1].home.id) return `confronto ${g[0].home.name} x ${g[0].away.name} sem ida e volta`;

  // Janelas de datas da temporada inteira; liga duas janelas quando vários confrontos têm a ida
  // numa e a volta na outra. Cada grupo ligado é um "par de rodadas" (r e r+19).
  const win = windowsOf(list);
  const size = new Map();
  const start = new Map();
  for (const ev of list) {
    const w = win.get(ev);
    size.set(w, (size.get(w) || 0) + 1);
    if (!start.has(w)) start.set(w, ev.date.getTime());
  }
  const edges = new Map();
  for (const [a, b] of pairs.values()) {
    const key = [win.get(a), win.get(b)].sort((x, y) => x - y).join('|');
    edges.set(key, (edges.get(key) || 0) + 1);
  }
  const parent = new Map([...size.keys()].map((w) => [w, w]));
  const find = (x) => { while (parent.get(x) !== x) { parent.set(x, parent.get(parent.get(x))); x = parent.get(x); } return x; };
  for (const [key, w] of edges) {
    const [i, j] = key.split('|').map(Number);
    if (i !== j && w >= Math.max(2, 0.34 * Math.min(size.get(i), size.get(j)))) parent.set(find(i), find(j));
  }

  // Confrontos com ida e volta no mesmo grupo entram direto.
  const slots = new Map();
  const doubt = [];
  const put = (root, g) => {
    if (!slots.has(root)) slots.set(root, { pairs: [], teams: new Set() });
    const s = slots.get(root);
    s.pairs.push(g);
    s.teams.add(g[0].home.id).add(g[0].away.id);
  };
  for (const g of pairs.values()) {
    const a = find(win.get(g[0]));
    const b = find(win.get(g[1]));
    if (a === b) put(a, g); else doubt.push(g);
  }
  // Grupo de cada janela: o lado da ida (mais cedo) e o da volta.
  const windowsBySlot = new Map();
  for (const w of size.keys()) {
    const r = find(w);
    if (!slots.has(r)) continue;
    if (!windowsBySlot.has(r)) windowsBySlot.set(r, []);
    windowsBySlot.get(r).push(w);
  }
  const sideOf = new Map();
  for (const ws of windowsBySlot.values()) {
    const t = ws.map((w) => start.get(w));
    const cut = (Math.min(...t) + Math.max(...t)) / 2;
    for (const w of ws) sideOf.set(w, start.get(w) <= cut ? 0 : 1);
    if (ws.every((w) => sideOf.get(w) === 0)) return 'par de rodadas sem jogos de volta';
  }

  // Jogos adiados: vão para o grupo em que os dois times ainda não jogaram (o mais próximo nas datas).
  const established = [...slots.keys()];
  for (const g of doubt) {
    const free = established.filter((r) => {
      const s = slots.get(r);
      return s.pairs.length < n / 2 && !s.teams.has(g[0].home.id) && !s.teams.has(g[0].away.id);
    });
    if (!free.length) return `sem rodada para ${g[0].home.name} x ${g[0].away.name}`;
    const own = free.filter((r) => r === find(win.get(g[0])) || r === find(win.get(g[1])));
    const dist = (r) => Math.min(...windowsBySlot.get(r).flatMap((w) => g.map((e) => Math.abs(e.date.getTime() - start.get(w)))));
    const root = (own.length ? own : free).sort((x, y) => dist(x) - dist(y))[0];
    put(root, g);
  }
  const all = [...slots.entries()];
  if (all.length !== n - 1) return `${all.length} pares de rodadas em vez de ${n - 1}`;
  if (all.some(([, s]) => s.pairs.length !== n / 2 || s.teams.size !== n)) return 'par de rodadas incompleto';

  // Ida ou volta de cada confronto: pelo lado da janela; se os dois jogos estão fora, o mais cedo é a ida.
  const legs = (r, g) => {
    for (const [i, e] of g.entries()) {
      const w = win.get(e);
      if (find(w) === r && sideOf.has(w)) return sideOf.get(w) === 0 ? [e, g[1 - i]] : [g[1 - i], e];
    }
    return g[0].date <= g[1].date ? [g[0], g[1]] : [g[1], g[0]];
  };
  const mid = ([r, s]) => {
    const d = s.pairs.map((g) => legs(r, g)[0].date.getTime()).sort((x, y) => x - y);
    return d[Math.floor(d.length / 2)];
  };
  all.sort((x, y) => mid(x) - mid(y));

  const rounds = [];
  all.forEach(([r, s], i) => {
    const pair = [newRound(), newRound()];
    pair[0].number = i + 1;
    pair[1].number = i + n;
    for (const g of s.pairs) { const [ida, volta] = legs(r, g); addTo(pair[0], ida); addTo(pair[1], volta); }
    rounds[i] = pair[0];
    rounds[i + n - 1] = pair[1];
  });

  // Jogo remarcado: a mais de 60 h da janela que concentra a rodada (jogo de segunda-feira não conta).
  for (const r of rounds) {
    const span = new Map();
    for (const e of r.events) {
      const w = win.get(e);
      const x = span.get(w) || { n: 0, from: e.date, to: e.date };
      x.n++;
      if (e.date < x.from) x.from = e.date;
      if (e.date > x.to) x.to = e.date;
      span.set(w, x);
    }
    const top = [...span.values()].sort((a, b) => b.n - a.n || a.from - b.from)[0];
    for (const e of r.events) {
      const x = span.get(win.get(e));
      e.moved = x !== top && Math.max(x.from - top.to, top.from - x.to) > 60 * HOUR;
    }
    r.events.sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
    const main = r.events.filter((e) => !e.moved);
    const core = main.length ? main : r.events;
    r.coreFirst = core[0].date;
    r.coreLast = core[core.length - 1].date;
    r.first = r.events[0].date;
    r.last = r.events[r.events.length - 1].date;
    r.movedCount = r.events.length - main.length;
  }
  return rounds;
}

// Reserva quando a temporada não está completa: agrupa por janelas de datas.
function byWindows(list, standings, fullSeason) {

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
