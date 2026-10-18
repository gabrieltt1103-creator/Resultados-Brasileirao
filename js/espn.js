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
      full: a?.displayName || '',
      pen: !!d.penaltyKick,
      og: !!d.ownGoal,
      // Cartão sem jogador: técnico ou alguém da comissão técnica (o time não fica com um a menos).
      staff: kind !== 'goal' && !a,
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

// Ao vivo, a ESPN publica o chute mais recente como "temp-attempt" e só depois o reclassifica;
// o texto já diz o que foi ("Attempt blocked.", "Attempt saved.", "Attempt missed.").
const TEMP_ATTEMPT = [[/^attempt blocked/i, 'shot-blocked'], [/^attempt saved/i, 'shot-on-target'], [/(hits? the (bar|post|crossbar))|woodwork/i, 'shot-hit-woodwork'], [/^attempt missed/i, 'shot-off-target']];

// Nome curto do jogador citado no texto do lance: "GOAL OVERTURNED BY VAR: Danilo Santos (Botafogo)..."
// dá "Danilo Santos"; "Penalty saved. Paulinho (Palmeiras) right footed shot saved ... by Hugo Souza
// (Corinthians)." dá o batedor, "Paulinho", e o goleiro, "Hugo Souza".
const PENALTY = /^Penalty (?:saved|missed)[.!]\s*(?:Bad penalty by\s+)?([^():!.]+?)\s*\(/i;
// Gols: "Goal! Coritiba 1, Botafogo 1. Danilo Santos (Botafogo) left footed shot..." e "Own Goal by Marçal, Botafogo."
const SCORER = /^Goal![^.]*\.\s+([^().!]+?)\s*\(/i;
const WHO_IN = {
  'deleted-after-review': /:\s*([^():!]+?)\s*\(/, 'penalty---missed': PENALTY, 'penalty---saved': PENALTY,
  goal: SCORER, 'goal---header': SCORER, 'goal---volley': SCORER, 'goal---free-kick': SCORER, 'penalty---scored': SCORER, 'own-goal': /^Own Goal by ([^,(]+?)\s*[,(]/i,
  // "Wallace Yan (RB Bragantino) is shown the red card." e "Arthur Chaves went off injured after Botafogo had used all subs."
  'red-card': /^([^():!.]+?)\s*\(/, retired: /^(.+?)\s+went off injured/i,
  // "Delay in match because of an injury Neymar (Santos)."
  'start-delay': /injury\s+([^()]+?)\s*\(/i,
};
const KEEPER = /saved\b.*\bby\s+([^():!]+?)\s*\(/i;
// Como saiu o gol, pelo texto do lance: "header", "from outside the box", "Assisted by Josué with a cross following a corner".
const ASSIST = /Assisted by ([^.]+?)(?: with (?:a|an) (cross|through ball|headed pass))?(?: following (?:a|an) (fast break|corner|set piece situation))?\.\s*$/i;
function goalDetail(type, text) {
  const how = type === 'goal---header' ? 'header' : type === 'goal---free-kick' || /from a free kick/i.test(text) ? 'free-kick'
    : type === 'goal---volley' ? 'volley' : /from outside the box/i.test(text) ? 'outside' : '';
  const a = ASSIST.exec(text);
  const context = a?.[3] || /following (?:a|an) (fast break|corner|set piece situation)\.\s*$/i.exec(text)?.[1] || '';
  return { how, assist: a ? { name: a[1].trim(), with: (a[2] || '').toLowerCase() } : null, context: context.toLowerCase() };
}
const shortName = (name) => {
  if (!name || name.length <= 14) return name || '';
  const parts = name.split(/\s+/);
  return parts.length > 1 ? `${parts[0][0]}. ${parts[parts.length - 1]}` : name;
};

/**
 * Lance a lance do resumo do jogo, para o fluxo e a leitura da partida:
 * [{type, side, period, base, extra, x, t, who, keeper}].
 * side: 'home' ou 'away' (null em lances sem time, como o apito inicial); x: posição no campo no
 * sentido do ataque de quem fez o lance (0 = o próprio gol, 100 = o gol adversário); who: autor do gol
 * (ou do gol contra), do gol anulado pelo VAR, do pênalti perdido, do expulso ou de quem saiu machucado sem
 * substituições (full: o nome inteiro); keeper: goleiro que defendeu o pênalti. Nos gols, how ('header',
 * 'free-kick', 'volley', 'outside'), assist ({name, with: 'cross' | 'through ball' | 'headed pass' | ''}) e
 * context ('fast break', 'corner', 'set piece situation').
 */
export function parseSummaryPlays(json) {
  const side = new Map();
  for (const c of json?.header?.competitions?.[0]?.competitors || []) if (c.team?.displayName) side.set(c.team.displayName, c.homeAway);
  if (side.size !== 2) return [];
  const out = [];
  for (const x of json?.commentary || []) {
    const p = x.play;
    let type = p?.type?.type;
    if (type === 'temp-attempt') type = TEMP_ATTEMPT.find(([re]) => re.test(x.text || p?.text || ''))?.[1] || type;
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
      who: WHO_IN[type] ? shortName(WHO_IN[type].exec(x.text || p.text || '')?.[1]) : '',
      full: WHO_IN[type] ? (WHO_IN[type].exec(x.text || p.text || '')?.[1] || '').trim() : '',
      keeper: type === 'penalty---saved' ? shortName(KEEPER.exec(x.text || p.text || '')?.[1]) : '',
      ...(/^goal/.test(type) ? goalDetail(type, x.text || p.text || '') : {}),
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

// Escalação: linha do campo de cada posição da ESPN (defesa, volantes, meio, meias, pontas, ataque) e o
// lado, da direita para a esquerda, como na ficha técnica ("Vitinho, Ferraresi, Arthur Chaves e Alex Telles").
// O centroavante vem depois dos atacantes de lado: no 3-4-2-1, os "2" são CF-R e CF-L, e o "1" é o F.
const DEPTH = {
  RB: 1, LB: 1, RWB: 1, LWB: 1, CD: 1, 'CD-R': 1, 'CD-L': 1, SW: 1,
  DM: 2, 'DM-R': 2, 'DM-L': 2, CM: 3, 'CM-R': 3, 'CM-L': 3, RM: 3.5, LM: 3.5,
  AM: 4, 'AM-R': 4, 'AM-L': 4, RW: 4.5, LW: 4.5, SS: 4.8, 'CF-R': 5, 'CF-L': 5, RCF: 5, LCF: 5, RF: 5, LF: 5, F: 5.2, CF: 5.2, ST: 5.2,
};
const lateral = (pos) => (/^(RB|RWB|RM|RW|RF)$/.test(pos) ? 0 : /-R$|^RCF$/.test(pos) ? 1 : /-L$|^LCF$/.test(pos) ? 3 : /^(LB|LWB|LM|LW|LF)$/.test(pos) ? 4 : 2);
// Nome curto para listas estreitas: o da ESPN, se for mesmo mais curto; senão, inicial e sobrenome ("G. Marques").
const shortOf = (a) => (a?.shortName && a.shortName.length < (a.displayName || '').length ? a.shortName : shortName(a?.displayName || ''));
const playerName = (a) => (a?.displayName && a.displayName.length <= 16 ? a.displayName : a?.shortName || a?.displayName) || '';

// Titulares em linhas, pela formação ("4-2-3-1": goleiro, 4, 2, 3, 1). Sem formação que feche, pela posição.
function linesOf(starters, formation) {
  const gk = starters.find((p) => p.pos === 'G') || [...starters].sort((a, b) => a.place - b.place)[0];
  const rest = starters.filter((p) => p !== gk).sort((a, b) => (DEPTH[a.pos] ?? 3) - (DEPTH[b.pos] ?? 3) || a.place - b.place);
  const sizes = String(formation || '').split('-').map(Number);
  let groups = [];
  if (sizes.length > 1 && sizes.every((n) => n > 0) && sizes.reduce((a, b) => a + b, 0) === rest.length) {
    let k = 0;
    groups = sizes.map((n) => rest.slice(k, (k += n)));
  } else {
    for (const p of rest) {
      const d = Math.floor(DEPTH[p.pos] ?? 3);
      if (groups.length && groups[groups.length - 1].d === d) groups[groups.length - 1].push(p);
      else groups.push(Object.assign([p], { d }));
    }
  }
  const byLateral = (a, b) => lateral(a.pos) - lateral(b.pos) || a.place - b.place;
  return [[gk], ...groups.map((g) => [...g].sort(byLateral))].filter((g) => g.length && g[0]);
}

/**
 * Escalações do resumo do jogo, que a ESPN publica perto do início (antes disso, devolve null):
 * {home, away, subs}. Cada time: {formation, lines: [[jogador]], bench: [jogador]}; jogador:
 * {name, short, n, pos, place, goals, og, yellow, red, in, out}, com in/out = {min, ht, other} (quem saiu ou entrou).
 * subs: as trocas, em ordem, para o lance a lance: [{side, min, ht, in, out}]. ht: troca no intervalo.
 */
export function parseSummaryLineups(json) {
  // Troca de "45'" é do intervalo, a não ser que o lance a lance mostre uma troca desse time aos 45' ainda no
  // 1º tempo (os nomes no lance a lance nem sempre são os da escalação: "Doma" e "Eduardo Doma").
  const subsAt45 = (team, period) => (json?.commentary || []).filter((c) => c.play?.type?.type === 'substitution'
    && c.play?.team?.displayName === team && c.play?.period?.number === period && /^45'$/.test(c.time?.displayValue || ''));
  const out = { subs: [] };
  // Nome de cada jogador como na escalação, para quem entrou e saiu aparecer igual nos dois lugares.
  const names = new Map();
  for (const r of json?.rosters || []) for (const p of r.roster || []) if (p.athlete?.id) names.set(String(p.athlete.id), playerName(p.athlete));
  const nameOf = (a) => names.get(String(a?.id)) || playerName(a);
  for (const r of json?.rosters || []) {
    const side = r.homeAway === 'home' || r.homeAway === 'away' ? r.homeAway : null;
    const roster = Array.isArray(r.roster) ? r.roster : [];
    if (!side || !roster.some((p) => p.starter)) continue;
    const firstHalf45 = subsAt45(r.team?.displayName, 1);
    const secondHalf45 = subsAt45(r.team?.displayName, 2);
    const players = roster.map((p) => {
      const plays = Array.isArray(p.plays) ? p.plays : [];
      const swaps = plays.filter((x) => x.substitution).map((x) => parseMinute(x.clock?.displayValue));
      const name = playerName(p.athlete);
      const ht = (m, who) => m?.base === 45 && !m.extra
        && (!firstHalf45.length || !firstHalf45.some((c) => (c.text || '').includes(who)) || secondHalf45.some((c) => (c.text || '').includes(who)));
      const inMin = p.subbedIn ? swaps[0] : null;
      const outMin = p.subbedOut ? swaps[swaps.length - 1] : null;
      return {
        name, short: shortOf(p.athlete) || name, n: String(p.jersey ?? ''), pos: p.position?.abbreviation || '', place: Number(p.formationPlace) || 0, starter: !!p.starter,
        goals: plays.filter((x) => x.didScore && !x.ownGoal).length,
        og: plays.filter((x) => x.didScore && x.ownGoal).length,
        yellow: plays.some((x) => x.yellowCard), red: plays.some((x) => x.redCard),
        in: p.subbedIn ? { min: inMin || parseMinute(''), ht: ht(inMin, p.athlete?.displayName || name), other: nameOf(p.subbedInFor?.athlete) } : null,
        out: p.subbedOut ? { min: outMin || parseMinute(''), ht: ht(outMin, p.subbedOutFor?.athlete?.displayName || ''), other: nameOf(p.subbedOutFor?.athlete) } : null,
      };
    });
    const starters = players.filter((p) => p.starter);
    const bench = players.filter((p) => !p.starter).sort((a, b) => (Number(a.n) || 99) - (Number(b.n) || 99));
    out[side] = { formation: r.formation || '', lines: linesOf(starters, r.formation), bench };
    for (const p of players) if (p.in) out.subs.push({ side, min: p.in.min, ht: p.in.ht, in: p.name, out: p.in.other });
  }
  if (!out.home || !out.away) return null;
  out.subs.sort((a, b) => (a.ht ? 45.995 : a.min.sort) - (b.ht ? 45.995 : b.min.sort));
  return out;
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
