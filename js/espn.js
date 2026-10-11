// Acesso à API pública (não oficial) da ESPN e normalização dos dados.
import { fmtTime, parseMinute } from './util.js';

const BASE = 'https://site.api.espn.com/apis';
export const SCOREBOARD = `${BASE}/site/v2/sports/soccer/bra.1/scoreboard`;
export const STANDINGS = `${BASE}/v2/sports/soccer/bra.1/standings`;
export const SUMMARY = `${BASE}/site/v2/sports/soccer/bra.1/summary`;

export async function getJSON(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

export const fetchScoreboard = (range, limit = 300) => getJSON(range ? `${SCOREBOARD}?dates=${range}&limit=${limit}` : SCOREBOARD);
export const fetchStandings = () => getJSON(STANDINGS);
export const fetchSummary = (id) => getJSON(`${SUMMARY}?event=${encodeURIComponent(id)}`);

// Logos da ESPN vêm em 500px; o "combiner" entrega uma versão pequena.
export function crestUrl(url, size = 64) {
  const m = /^https?:\/\/a\.espncdn\.com(\/i\/teamlogos\/[^?]+)$/.exec(url || '');
  return m ? `https://a.espncdn.com/combiner/i?img=${m[1]}&w=${size}&h=${size}` : url;
}

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
    logo: x?.team?.logo || x?.team?.logos?.[0]?.href || '',
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
      who: a?.shortName || a?.displayName || '',
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

export function parseStandings(json) {
  const group = json?.children?.[0]?.standings || json?.standings;
  const rows = (group?.entries || []).map((en) => {
    const stat = (name) => {
      const s = (en.stats || []).find((x) => x.name === name);
      const v = s == null ? null : Number(s.value);
      return Number.isFinite(v) ? v : null;
    };
    const gf = stat('pointsFor') ?? 0;
    const ga = stat('pointsAgainst') ?? 0;
    return {
      id: String(en.team?.id ?? ''),
      name: en.team?.shortDisplayName || en.team?.displayName || '?',
      logo: en.team?.logos?.[0]?.href || '',
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
