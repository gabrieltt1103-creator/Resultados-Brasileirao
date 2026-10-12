// Acesso à API pública (não oficial) da ESPN e normalização dos dados.
import { fmtTime, parseMinute } from './util.js';

const BASE = 'https://site.api.espn.com/apis';
export const SCOREBOARD = `${BASE}/site/v2/sports/soccer/bra.1/scoreboard`;
export const STANDINGS = `${BASE}/v2/sports/soccer/bra.1/standings`;
export const SUMMARY = `${BASE}/site/v2/sports/soccer/bra.1/summary`;

// Sem resposta no prazo, a requisição é cancelada: uma chamada lenta da ESPN (já vimos 30 s)
// não pode segurar o resto do app.
export async function getJSON(url, timeout = 15e3) {
  const ctrl = typeof AbortController === 'function' ? new AbortController() : null;
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeout) : 0;
  try {
    const res = await fetch(url, { cache: 'no-store', signal: ctrl?.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`sem resposta em ${Math.round(timeout / 1000)} s`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

export const fetchScoreboard = (range, limit = 300, timeout) => getJSON(range ? `${SCOREBOARD}?dates=${range}&limit=${limit}` : SCOREBOARD, timeout);
export const fetchStandings = () => getJSON(STANDINGS, 12e3);
export const fetchSummary = (id) => getJSON(`${SUMMARY}?event=${encodeURIComponent(id)}`);

const pad = (n) => String(n).padStart(2, '0');

// A ESPN aceita no parâmetro dates um ano (2026), um mês (202610) ou um dia (20261011);
// intervalos como 20261001-20261031 voltam com erro 400 no Brasileirão.
export const fetchDay = (d) => fetchScoreboard(`${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`, 100, 12e3);

/**
 * Todos os jogos do ano numa chamada; se ela falhar, mês a mês em paralelo.
 * Devolve {events, failed, season}: failed lista os meses que não vieram.
 */
export async function fetchSeason(year) {
  try {
    const json = await fetchScoreboard(String(year), 1000, 25e3);
    if (json?.events?.length) return { events: json.events, failed: [], season: json.leagues?.[0]?.season?.year || null };
  } catch { /* tenta por mês */ }
  return fetchMonths(year, Array.from({ length: 12 }, (_, i) => i + 1));
}

/** Só alguns meses do ano, em paralelo. Devolve {events, failed, season}. */
export async function fetchMonths(year, months) {
  const results = await Promise.allSettled(months.map((m) => fetchScoreboard(`${year}${pad(m)}`, 200, 20e3)));
  const byId = new Map();
  const failed = [];
  let season = null;
  results.forEach((r, i) => {
    if (r.status !== 'fulfilled') { failed.push(months[i]); return; }
    for (const e of r.value?.events || []) byId.set(String(e.id), e);
    season ||= r.value?.leagues?.[0]?.season?.year || null;
  });
  return { events: [...byId.values()], failed, season };
}

const logoOf = (team) => team?.logo || team?.logos?.find((l) => (l.rel || []).includes('default'))?.href || team?.logos?.[0]?.href || '';

const hexColor = (c) => (/^#?[0-9a-f]{6}$/i.test(c || '') ? `#${c.replace('#', '')}` : null);

function parseStatus(st, date) {
  const t = st.type || {};
  const name = t.name || '';
  const phase = t.state || 'pre';
  if (/POSTPONED/.test(name)) return { kind: 'off', label: 'Adiado' };
  if (/CANCEL/.test(name)) return { kind: 'off', label: 'Cancelado' };
  if (/ABANDON|SUSPEND/.test(name)) return { kind: 'off', label: 'Suspenso' };
  if (phase === 'in') {
    if (/HALFTIME/.test(name)) return { kind: 'live', label: 'INT', note: 'Intervalo', half: true };
    let clock = (st.displayClock || '').replace("'+", '+');
    if (!clock || clock === "0'") clock = t.shortDetail || 'Ao vivo';
    return { kind: 'live', label: clock, note: 'Ao vivo' };
  }
  if (phase === 'post') return t.completed === false ? { kind: 'off', label: t.shortDetail || 'Adiado' } : { kind: 'post', label: 'FIM' };
  return { kind: 'pre', label: fmtTime.format(date) };
}

function statMap(list) {
  const out = {};
  for (const s of Array.isArray(list) ? list : []) {
    const v = parseFloat(String(s.displayValue ?? s.value ?? '').replace('%', '').replace(',', '.'));
    if (s.name && Number.isFinite(v)) out[s.name] = v;
  }
  return out;
}

export function parseEvent(e) {
  const c = e.competitions?.[0] || {};
  const date = new Date(c.date || e.date);
  const comps = c.competitors || [];
  const side = (x) => ({
    id: String(x?.team?.id ?? x?.id ?? ''),
    name: x?.team?.shortDisplayName || x?.team?.displayName || x?.team?.name || '?',
    abbr: x?.team?.abbreviation || '',
    logo: logoOf(x?.team),
    color: hexColor(x?.team?.color),
    color2: hexColor(x?.team?.alternateColor),
    score: x?.score == null || x.score === '' ? null : Number(x.score),
    stats: statMap(x?.statistics),
  });
  const home = side(comps.find((x) => x.homeAway === 'home') || comps[0]);
  const away = side(comps.find((x) => x.homeAway === 'away') || comps[1]);
  const status = parseStatus(c.status || e.status || {}, date);

  const details = Array.isArray(c.details) ? c.details : [];
  const incidents = [];
  for (const d of details) {
    const kind = d.scoringPlay ? 'goal' : d.redCard ? 'red' : d.yellowCard ? 'yellow' : null;
    if (!kind) continue;
    const a = d.athletesInvolved?.[0];
    incidents.push({
      kind,
      team: String(d.team?.id ?? ''),
      min: parseMinute(d.clock?.displayValue),
      // "Memphis Depay" cabe; "Alexander Barboza" vira "A. Barboza".
      who: (a?.displayName && a.displayName.length <= 14 ? a.displayName : a?.shortName || a?.displayName) || '',
      pen: !!d.penaltyKick,
      og: !!d.ownGoal,
    });
  }
  incidents.sort((x, y) => x.min.sort - y.min.sort);

  // Gol contra: se a contagem não bate com o placar, o time do lance está do lado do jogador.
  const goals = incidents.filter((i) => i.kind === 'goal');
  const count = (id) => goals.filter((g) => g.team === id).length;
  const fits = () => count(home.id) === (home.score ?? 0) && count(away.id) === (away.score ?? 0);
  if (goals.some((g) => g.og) && !fits()) {
    const flip = () => goals.forEach((g) => { if (g.og) g.team = g.team === home.id ? away.id : home.id; });
    flip();
    if (!fits()) flip();
  }

  return {
    id: String(e.id),
    date,
    status,
    home,
    away,
    incidents,
    goalsComplete: fits(),
    venue: [c.venue?.fullName, c.venue?.address?.city].filter(Boolean).join(' · '),
  };
}

export const seasonYear = (json) => json?.leagues?.[0]?.season?.year || json?.events?.[0]?.season?.year || null;

const ABBR = { gamesPlayed: 'GP', wins: 'W', ties: 'D', losses: 'L', points: 'P', pointsFor: 'F', pointsAgainst: 'A', pointDifferential: 'GD', rank: 'R' };

export function parseStandings(json) {
  const groups = json?.children?.length ? json.children.map((c) => c.standings) : [json?.standings];
  const entries = groups.flatMap((g) => g?.entries || []);
  const rows = entries.map((en) => {
    const stat = (name) => {
      const list = en.stats || [];
      const s = list.find((x) => x.name === name) || list.find((x) => x.type === name.toLowerCase()) || list.find((x) => x.abbreviation === ABBR[name]);
      const v = s == null ? null : Number(s.value ?? s.displayValue);
      return Number.isFinite(v) ? v : null;
    };
    const gf = stat('pointsFor') ?? 0;
    const ga = stat('pointsAgainst') ?? 0;
    return {
      id: String(en.team?.id ?? ''),
      name: en.team?.shortDisplayName || en.team?.displayName || '?',
      logo: logoOf(en.team),
      rank: stat('rank'),
      pts: stat('points') ?? 0,
      gp: stat('gamesPlayed') ?? 0,
      w: stat('wins') ?? 0,
      d: stat('ties') ?? 0,
      l: stat('losses') ?? 0,
      gf,
      ga,
      gd: stat('pointDifferential') ?? gf - ga,
      note: en.note ? { color: hexColor(en.note.color) || en.note.color, description: en.note.description || '' } : null,
    };
  });
  const ranked = rows.length && rows.every((t) => t.rank != null);
  rows.sort(ranked ? (a, b) => a.rank - b.rank : (a, b) => b.pts - a.pts || b.w - a.w || b.gd - a.gd || b.gf - a.gf);
  return rows;
}

// Estatísticas do jogo pelo endpoint de resumo: {teamId: {possessionPct: 55, ...}}
export function parseSummaryStats(json) {
  const out = {};
  for (const t of json?.boxscore?.teams || []) {
    const id = String(t.team?.id ?? '');
    if (id) out[id] = statMap(t.statistics);
  }
  return out;
}

/**
 * Lance a lance do resumo do jogo, para o fluxo da partida: [{type, side, period, base, extra, x, t}].
 * side: 'home' ou 'away' (null em lances sem time, como o apito inicial); x: posição no campo no
 * sentido do ataque de quem fez o lance (0 = o próprio gol, 100 = o gol adversário).
 */
export function parseSummaryPlays(json) {
  const side = new Map();
  for (const c of json?.header?.competitions?.[0]?.competitors || []) if (c.team?.displayName) side.set(c.team.displayName, c.homeAway);
  if (side.size !== 2) return [];
  const out = [];
  for (const x of json?.commentary || []) {
    const p = x.play;
    const type = p?.type?.type;
    const m = /(\d+)'(?:\+(\d+))?/.exec(x.time?.displayValue || p?.clock?.displayValue || '');
    if (!type || !m) continue;
    const base = Number(m[1]);
    out.push({
      type,
      side: side.get(p.team?.displayName) || null,
      period: p.period?.number || (base > 45 ? 2 : 1),
      base,
      extra: Number(m[2] || 0),
      x: Number.isFinite(p.fieldPositionX) ? p.fieldPositionX : null,
      t: x.time?.value ?? null,
    });
  }
  return out;
}

// "2025 Brasileiro Serie B" -> "Série B 2025"; "2025 CONMEBOL Libertadores" -> "Libertadores 2025".
const COMPETITION = [
  [/brasileiro serie a/i, 'Série A'], [/brasileiro serie b/i, 'Série B'], [/copa do brasil/i, 'Copa do Brasil'],
  [/libertadores/i, 'Libertadores'], [/sudamericana|sul-americana/i, 'Sul-Americana'], [/supercopa/i, 'Supercopa'],
];
function competitionLabel(name) {
  const text = String(name || '').trim();
  const year = /\b(19|20)\d{2}\b/.exec(text)?.[0] || '';
  const known = COMPETITION.find(([re]) => re.test(text))?.[1];
  const label = known || text.replace(/\b(19|20)\d{2}\b/, '').trim();
  return [label, year].filter(Boolean).join(' ');
}

/**
 * Últimos confrontos entre os dois times, de qualquer competição, do mais recente para o mais antigo,
 * sem o próprio jogo. Mata-mata decidido nos pênaltis vem com placar igual e um vencedor: pens = 'home' ou 'away'.
 */
export function parseHeadToHead(json, eventId) {
  const series = (json?.seasonseries || []).find((s) => s.type === 'head-to-head');
  const games = [];
  for (const e of series?.events || []) {
    if (String(e.id) === String(eventId) || e.statusType?.completed === false || e.status === 'pre') continue;
    const side = (key) => {
      const c = (e.competitors || []).find((x) => x.homeAway === key);
      const score = c?.score === '' || c?.score == null ? null : Number(c.score);
      return c ? { id: String(c.team?.id ?? ''), name: c.team?.displayName || '?', score, winner: !!c.winner } : null;
    };
    const home = side('home');
    const away = side('away');
    if (!home || !away || !Number.isFinite(home.score) || !Number.isFinite(away.score)) continue;
    const pens = home.score === away.score ? (home.winner ? 'home' : away.winner ? 'away' : null) : null;
    games.push({ id: String(e.id), date: new Date(e.date), competition: competitionLabel(e.competitionName), home, away, pens });
  }
  return games.sort((a, b) => b.date - a.date);
}
