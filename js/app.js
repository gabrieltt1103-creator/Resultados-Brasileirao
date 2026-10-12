import * as espn from './espn.js';
import { buildRounds, dropReplaced, isFinished, pickDefault, playsIn, roundName, sortEvents } from './rounds.js';
import { computeTable, finishedTable, formOf, scenarios, zonesFor } from './table.js';
import { headlines, impactLines, matchStory, roundStats, trends } from './insights.js';
import { chances, model, randomScore } from './sim.js';
import * as fx from './fx.js';
import * as ui from './ui.js';
import { HOUR, addDays, dayLabel, doo, esc, fmtClock, o, sameDay, save, shortDay, store, ymd } from './util.js';

const LIVE_MS = 30e3;            // com jogo rolando (ou prestes a começar)
const IDLE_MS = 120e3;           // sem jogo agora
const SEASON_MS = 30 * 60e3;     // recarrega a temporada inteira
const STANDINGS_MS = 5 * 60e3;
const SUMMARY_MS = 25e3;
const FLASH_MS = 90e3;
const CACHE_KEY = 'temporada:v1';
const SIM_KEY = 'simulacao:v1';
const ODDS_RUNS = 3000;

const $ = (id) => document.getElementById(id);
const el = {
  season: $('season'), refresh: $('refresh'), pulse: $('pulse'), updated: $('updated'), sound: $('sound'),
  prev: $('prev'), next: $('next'), roundName: $('round-name'), roundDates: $('round-dates'),
  tabs: [...document.querySelectorAll('.tab')], views: [...document.querySelectorAll('[role="tabpanel"]')],
  fav: $('fav'), others: $('others'), news: $('news'), summary: $('summary'), matches: $('matches'), share: $('share'),
  tableNote: $('table-note'), tableWrap: $('table-wrap'), legend: $('legend'), stats: $('stats'), sim: $('sim'),
  error: $('error'), errorText: $('error-text'), retry: $('retry'), diag: $('diag'),
  sheet: $('sheet'), sheetBody: $('sheet-body'), sheetBack: $('sheet-back'), toasts: $('toasts'),
};

const state = {
  events: new Map(),
  logos: new Map(),
  rounds: [],
  roundOf: new Map(),
  roundIdx: -1,
  focusIdx: -1,           // rodada em andamento: a tabela ao vivo vale para ela
  pinned: null,           // id de um jogo da rodada escolhida; null = seguir automático
  standings: [],
  seasonComplete: false,  // todos os meses da temporada vieram da ESPN
  complete: false,        // ... e batem com a classificação oficial
  ctx: null,
  table: null,
  simTable: null,
  zones: zonesFor([]),
  formById: new Map(),
  trends: null,
  sims: cleanSims(store(SIM_KEY, {})),
  odds: null,
  oddsBase: null,
  oddsSig: '',
  oddsBaseSig: '',
  oddsTimer: 0,
  scores: new Map(),
  baseline: false,        // só avisa gol depois da primeira leitura da rede
  flashes: new Map(),
  alerts: [],
  summaries: new Map(),
  lastFull: 0,
  lastStandings: 0,
  lastOk: 0,
  lastCache: 0,
  failed: false,
  loading: false,
  timer: 0,
  favorite: store('meu-time', null),
  hintOff: store('dica-time', false) === true,
  sheet: null,
  sheetStack: [],
  selectedBar: null,
  scrollTo: null,
  diag: { season: null, standings: null, refresh: null, summary: null, cache: null, errors: [] },
};

function cleanSims(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const [id, v] of Object.entries(raw)) if (Number.isInteger(v?.h) && Number.isInteger(v?.a)) out[id] = { h: v.h, a: v.a };
  }
  return out;
}

// Jogos válidos: sem o registro antigo de jogos adiados que já ganharam nova data.
const eventList = () => dropReplaced([...state.events.values()]);
const focusRound = () => state.rounds[state.focusIdx];
const preRank = (id) => state.table?.preById.get(id)?.pos;
const liveRank = (id) => state.table?.byId.get(id)?.pos;
const errText = (err) => String(err?.message || err || 'erro');

// ---------- dados ----------
function ingest(list, { quiet = false } = {}) {
  for (const raw of list || []) {
    let ev;
    try { ev = espn.parseEvent(raw); } catch { continue; }
    addEvent(ev, quiet);
  }
}

function addEvent(ev, quiet) {
  for (const t of [ev.home, ev.away]) {
    if (t.logo) state.logos.set(t.id, t.logo);
    else t.logo = state.logos.get(t.id) || '';
  }
  if (quiet || !state.baseline) state.scores.set(ev.id, { h: ev.home.score ?? 0, a: ev.away.score ?? 0 });
  else detectGoal(ev);
  state.events.set(ev.id, ev);
}

function detectGoal(ev) {
  const h = ev.home.score ?? 0;
  const a = ev.away.score ?? 0;
  const before = state.scores.get(ev.id);
  state.scores.set(ev.id, { h, a });
  if (!before || ev.status.kind !== 'live') return;
  const sides = new Set();
  if (h > before.h) sides.add('home');
  if (a > before.a) sides.add('away');
  if (!sides.size) return;
  state.flashes.set(ev.id, { sides, until: Date.now() + FLASH_MS, fresh: true });
  state.alerts.push({ ev, sides });
}

async function loadSeason() {
  const year = new Date().getFullYear();
  const res = await espn.fetchSeason(year);
  state.diag.season = { t: Date.now(), count: res.events.length, failed: res.failed };
  if (res.season) el.season.textContent = res.season;
  if (!res.events.length) {
    // Sem a temporada: pelo menos a rodada atual.
    const json = await espn.fetchScoreboard();
    state.events.clear();
    ingest(json?.events);
    state.seasonComplete = false;
    state.diag.season.fallback = (json?.events || []).length;
  } else {
    state.events.clear();
    ingest(res.events);
    state.seasonComplete = res.failed.length === 0;
  }
  state.baseline = true;
  state.lastFull = Date.now();
  if (!state.standings.length || Date.now() - state.lastStandings > STANDINGS_MS) await loadStandings();
  saveCache();
}

// Atualização rápida, dia a dia: ontem, hoje e amanhã (onde estão os jogos ao vivo) e os dias
// da rodada aberta que ainda têm jogo por terminar.
async function refreshHot() {
  const today = new Date();
  const days = new Map();
  for (const d of [addDays(today, -1), today, addDays(today, 1)]) days.set(ymd(d), d);
  const r = state.rounds[state.roundIdx];
  if (r) for (const e of r.events) if (e.status.kind === 'pre' || e.status.kind === 'live') days.set(ymd(e.date), e.date);
  const finished = () => eventList().filter((e) => e.status.kind === 'post').length;
  const before = finished();
  const res = await Promise.all([...days.values()].slice(0, 6).map((d) => espn.fetchDay(d)));
  res.forEach((json) => ingest(json?.events));
  if (finished() !== before || Date.now() - state.lastStandings > STANDINGS_MS) await loadStandings();
  if (Date.now() - state.lastCache > 5 * 60e3) saveCache();
}

async function loadStandings() {
  try {
    const rows = espn.parseStandings(await espn.fetchStandings());
    for (const t of rows) {
      if (t.logo) state.logos.set(t.id, t.logo);
      else t.logo = state.logos.get(t.id) || '';
    }
    if (rows.length) state.standings = rows;
    state.diag.standings = { t: Date.now(), ok: rows.length > 0, count: rows.length, error: rows.length ? null : 'veio sem times' };
  } catch (err) {
    state.diag.standings = { t: Date.now(), ok: false, error: errText(err) };
  }
  state.lastStandings = Date.now();
}

async function loadSummary(id, force = false) {
  const ev = state.events.get(id);
  if (!ev || ev.status.kind === 'pre' || ev.status.kind === 'off') return;
  const cached = state.summaries.get(id);
  if (cached?.loading) return;
  if (cached && !force && (ev.status.kind === 'post' || Date.now() - cached.t < SUMMARY_MS)) return;
  state.summaries.set(id, { ...cached, loading: true });
  try {
    const stats = espn.parseSummaryStats(await espn.fetchSummary(id));
    state.summaries.set(id, { stats, t: Date.now() });
    state.diag.summary = { t: Date.now(), ok: Object.keys(stats).length > 0, error: Object.keys(stats).length ? null : 'sem estatísticas' };
  } catch (err) {
    state.summaries.set(id, { ...cached, loading: false, t: Date.now() });
    state.diag.summary = { t: Date.now(), ok: false, error: errText(err) };
  }
  if (state.sheet?.type === 'match' && state.sheet.id === id) safe('detalhe', renderSheet, el.sheetBody);
}

function saveCache() {
  try {
    const events = eventList().map((e) => ({ ...e, date: e.date.getTime() }));
    const json = JSON.stringify({ t: Date.now(), year: new Date().getFullYear(), complete: state.seasonComplete, season: el.season.textContent, events });
    if (json.length < 3e6) localStorage.setItem(CACHE_KEY, json);
    state.lastCache = Date.now();
  } catch { /* sem espaço: segue sem cache */ }
}

function loadCache() {
  const c = store(CACHE_KEY, null);
  if (!c || c.year !== new Date().getFullYear() || !Array.isArray(c.events)) return false;
  for (const e of c.events) addEvent({ ...e, date: new Date(e.date) }, true);
  state.seasonComplete = !!c.complete;
  if (c.season) el.season.textContent = c.season;
  state.diag.cache = { t: c.t, count: c.events.length };
  return state.events.size > 0;
}

async function tick() {
  clearTimeout(state.timer);
  if (state.loading) return;
  state.loading = true;
  el.refresh.classList.add('loading');
  try {
    if (!state.baseline || Date.now() - state.lastFull > SEASON_MS) await loadSeason();
    else await refreshHot();
    state.failed = false;
    state.lastOk = Date.now();
    state.diag.refresh = { t: Date.now(), ok: true };
  } catch (err) {
    state.failed = true;
    state.diag.refresh = { t: Date.now(), ok: false, error: errText(err) };
    console.warn('Falha ao atualizar', err);
  } finally {
    state.loading = false;
    el.refresh.classList.remove('loading');
    refresh();
    schedule();
    if (state.sheet?.type === 'match' && state.events.get(state.sheet.id)?.status.kind === 'live') loadSummary(state.sheet.id, true);
  }
}

function schedule() {
  clearTimeout(state.timer);
  if (document.hidden) return;
  const now = Date.now();
  const hot = eventList().some((e) => e.status.kind === 'live'
    || (e.status.kind === 'pre' && e.date - now < 10 * 60e3 && now - e.date < 3 * HOUR));
  state.timer = setTimeout(tick, state.failed || hot ? LIVE_MS : IDLE_MS);
}

// ---------- derivados ----------
function derive() {
  const list = eventList();
  state.rounds = buildRounds(list, { standings: state.standings, fullSeason: state.seasonComplete });
  state.roundOf = new Map();
  for (const r of state.rounds) for (const e of r.events) state.roundOf.set(e.id, r);
  state.focusIdx = pickDefault(state.rounds);
  let idx = -1;
  if (state.pinned) idx = state.rounds.findIndex((r) => r.events.some((e) => e.id === state.pinned));
  if (idx < 0) { state.pinned = null; idx = state.focusIdx; }
  state.roundIdx = idx;

  // A tabela calculada pelos jogos só vale se nenhum time tiver menos jogos que na classificação oficial.
  let complete = state.seasonComplete;
  if (complete && state.standings.length) {
    const fin = finishedTable({ standings: state.standings, events: list, complete: true });
    complete = state.standings.every((t) => (fin.rows.get(t.id)?.gp ?? 0) >= t.gp);
  }
  state.complete = complete;

  for (const id of Object.keys(state.sims)) {
    const e = state.events.get(id);
    if (!e || e.status.kind === 'post') delete state.sims[id];
  }
  save(SIM_KEY, state.sims);

  state.ctx = { standings: state.standings, events: list, round: focusRound(), complete };
  state.table = computeTable(state.ctx);
  state.simTable = Object.keys(state.sims).length ? computeTable({ ...state.ctx, overrides: state.sims }) : state.table;
  state.zones = zonesFor(state.standings, state.table?.rows.length || 0);
  const teams = state.table?.rows || state.standings;
  state.formById = new Map(teams.map((t) => [t.id, formOf(list, t.id)]));
  state.trends = teams.length ? trends(list, teams) : null;
  scheduleOdds();
}

// Chances (Monte Carlo): num worker quando possível, só quando algo muda.
let worker = null;
let workerSeq = 0;
const pendingOdds = new Map();
try {
  worker = new Worker(new URL('./odds-worker.js', import.meta.url), { type: 'module' });
  worker.onmessage = (e) => { pendingOdds.get(e.data.id)?.(e.data.result); pendingOdds.delete(e.data.id); };
  worker.onerror = () => { worker = null; pendingOdds.forEach((done) => done(undefined)); pendingOdds.clear(); };
} catch { worker = null; }

const compactEvent = (e) => ({
  id: e.id,
  home: { id: e.home.id, score: e.home.score },
  away: { id: e.away.id, score: e.away.score },
  status: { kind: e.status.kind, label: e.status.label, half: !!e.status.half },
});

function runOdds(finished, events, overrides) {
  const input = { finished: [...finished.values()], events: events.map(compactEvent), overrides, zones: { g: state.zones.g, zStart: state.zones.zStart }, runs: ODDS_RUNS };
  const local = () => {
    const out = chances({ ...input, finished });
    return out ? { byId: [...out.byId], runs: out.runs, left: out.left } : null;
  };
  if (!worker) return Promise.resolve(local());
  return new Promise((resolve) => {
    const id = ++workerSeq;
    pendingOdds.set(id, (result) => resolve(result === undefined ? local() : result));
    worker.postMessage({ id, ...input });
  });
}

let oddsToken = 0;
const asOdds = (r) => (r ? { byId: new Map(r.byId), runs: r.runs, left: r.left } : null);

function scheduleOdds(delay = 30) {
  const t = state.table;
  if (!t || t.mode !== 'jogos') { state.odds = null; state.oddsBase = null; state.oddsSig = ''; return; }
  const list = eventList();
  const live = list.filter((e) => e.status.kind === 'live').map((e) => `${e.id}:${e.home.score}-${e.away.score}@${e.status.label}`).join(',');
  const done = list.filter((e) => e.status.kind === 'post').length;
  const baseSig = `${done}|${live}|${state.zones.g}|${state.zones.zStart}`;
  const sig = `${baseSig}|${JSON.stringify(state.sims)}`;
  if (sig === state.oddsSig) return;
  clearTimeout(state.oddsTimer);
  const token = ++oddsToken;
  state.oddsTimer = setTimeout(async () => {
    try {
      const sims = { ...state.sims };
      if (baseSig !== state.oddsBaseSig) {
        const base = asOdds(await runOdds(t.finished, list, {}));
        if (token !== oddsToken) return;
        state.oddsBase = base;
        state.oddsBaseSig = baseSig;
      }
      const odds = Object.keys(sims).length ? asOdds(await runOdds(t.finished, list, sims)) : state.oddsBase;
      if (token !== oddsToken) return;
      state.odds = odds;
      state.oddsSig = sig;
    } catch (err) {
      state.odds = null;
      state.diag.errors.push({ part: 'chances', error: errText(err) });
    }
    safe('o simulador', renderSim, el.sim);
    if (state.sheet?.type === 'team') safe('o detalhe', renderSheet, el.sheetBody);
  }, delay);
}

// ---------- tela ----------
// Cada parte é desenhada isolada: se uma falhar, as outras continuam.
function safe(part, fn, container) {
  try { fn(); } catch (err) {
    console.error(`Erro em ${part}`, err);
    state.diag.errors.push({ part, error: errText(err), t: Date.now() });
    if (state.diag.errors.length > 10) state.diag.errors.shift();
    if (container) container.innerHTML = `<p class="empty">Não foi possível mostrar ${esc(part)} agora. Toque em “Status dos dados” no rodapé para ver o motivo.</p>`;
  }
}

function refresh() {
  safe('a rodada', derive, el.matches);
  render();
}

function render() {
  safe('o topo', renderHeader);
  safe('os jogos', renderGames, el.matches);
  safe('a tabela', renderTable, el.tableWrap);
  safe('o simulador', renderSim, el.sim);
  safe('os números', renderStats, el.stats);
  safe('o detalhe', renderSheet, el.sheetBody);
  safe('os avisos', flushAlerts);
  if (state.scrollTo) {
    const target = document.getElementById(state.scrollTo);
    state.scrollTo = null;
    target?.scrollIntoView({ block: 'center' });
  }
}

function renderHeader() {
  const r = state.rounds[state.roundIdx];
  el.prev.disabled = state.roundIdx <= 0;
  el.next.disabled = state.roundIdx < 0 || state.roundIdx >= state.rounds.length - 1;
  if (r) {
    el.roundName.textContent = roundName(r);
    const core = sameDay(r.coreFirst, r.coreLast) ? shortDay(r.coreFirst) : `${shortDay(r.coreFirst)} a ${shortDay(r.coreLast)}`;
    el.roundDates.textContent = r.movedCount ? `${core} · +${r.movedCount} em outra data` : core;
  }
  const anyLive = eventList().some((e) => e.status.kind === 'live');
  el.pulse.hidden = !anyLive;
  if (state.failed) el.updated.textContent = state.lastOk ? 'Sem conexão, tentando de novo' : 'Sem conexão';
  else if (state.lastOk) el.updated.textContent = fmtClock.format(state.lastOk);
  else if (state.diag.cache) el.updated.textContent = 'Atualizando…';
  el.refresh.setAttribute('aria-label', `${anyLive ? 'Jogos ao vivo. ' : ''}Atualizado às ${el.updated.textContent}. Toque para atualizar agora.`);
  document.title = anyLive ? `● ${roundName(focusRound())} ao vivo` : 'Rodada ao Vivo';

  const empty = !state.events.size;
  el.error.hidden = !(state.failed && empty);
  if (state.failed && empty) el.errorText.textContent = 'Não foi possível carregar os jogos. Confira sua conexão com a internet; o app tenta de novo a cada 30 segundos.';
}

function renderGames() {
  const r = state.rounds[state.roundIdx];
  if (!r) {
    el.summary.hidden = true;
    el.share.hidden = true;
    el.news.innerHTML = '';
    el.fav.innerHTML = '';
    el.others.innerHTML = '';
    if (state.failed) el.matches.innerHTML = '';
    else if (state.lastOk) el.matches.innerHTML = '<p class="empty">Nenhum jogo do Brasileirão encontrado.</p>';
    return;
  }
  const isFocus = state.roundIdx === state.focusIdx;
  const now = new Date();
  safe('o seu time', () => { el.fav.innerHTML = favoriteHtml(); }, el.fav);
  safe('o resumo', () => {
    const news = headlines({ round: r, table: state.table, zones: state.zones, focus: isFocus, now });
    const started = r.events.some((e) => e.status.kind === 'post' || e.status.kind === 'live');
    el.news.innerHTML = ui.newsCard(news, started ? 'Resumo da rodada' : 'Prévia da rodada');
  }, el.news);

  const counts = { live: 0, post: 0, pre: 0, off: 0 };
  let goals = 0;
  r.events.forEach((e) => {
    counts[e.status.kind]++;
    if (e.status.kind === 'post' || e.status.kind === 'live') goals += (e.home.score ?? 0) + (e.away.score ?? 0);
  });
  const parts = [`<b>${r.events.length}</b> jogos`];
  if (counts.live) parts.push(`<b class="live-count">${counts.live}</b> <span class="live-count">ao vivo</span>`);
  if (counts.post) parts.push(`<b>${counts.post}</b> ${counts.post === 1 ? 'encerrado' : 'encerrados'}`);
  if (counts.pre) parts.push(`<b>${counts.pre}</b> a seguir`);
  if (counts.off) parts.push(`<b>${counts.off}</b> ${counts.off === 1 ? 'adiado' : 'adiados'}`);
  if (counts.live || counts.post) parts.push(`<b>${goals}</b> ${goals === 1 ? 'gol' : 'gols'}`);
  el.summary.innerHTML = parts.join(' · ');
  el.summary.hidden = false;

  const ctxBase = {
    rank: liveRank,
    delta: (id) => (isFocus ? state.table?.byId.get(id)?.delta || 0 : 0),
    favorite: state.favorite,
  };
  // Zebra compara com a tabela de agora, então só vale na rodada em andamento.
  const card = (ev, note) => ui.matchCard(ev, { ...ctxBase, flash: takeFlash(ev.id), story: matchStory(ev, isFocus ? preRank : null), note });

  // Jogos de hoje que são de outras rodadas (remarcados), para não passarem despercebidos.
  const others = isFocus ? sortEvents(eventList()).filter((e) => !r.events.includes(e)
    && (e.status.kind === 'live' || (sameDay(e.date, now) && e.status.kind !== 'off'))) : [];
  el.others.innerHTML = others.length ? `
    <section class="day">
      <h2 class="day-label">Hoje, de outras rodadas</h2>
      ${others.map((e) => card(e, roundName(state.roundOf.get(e.id)))).join('')}
    </section>` : '';

  const days = [];
  for (const ev of r.events) {
    const last = days[days.length - 1];
    if (last && sameDay(last.date, ev.date)) last.events.push(ev);
    else days.push({ date: ev.date, events: [ev] });
  }
  el.matches.innerHTML = days.map((d) => `
    <section class="day">
      <h2 class="day-label">${esc(dayLabel(d.date, now))}${d.events.every((e) => e.moved) ? ' <small>jogo remarcado</small>' : ''}</h2>
      ${d.events.map((ev) => card(ev)).join('')}
    </section>`).join('');
  el.share.hidden = false;
}

function takeFlash(id) {
  const f = state.flashes.get(id);
  if (!f) return null;
  if (f.until < Date.now()) { state.flashes.delete(id); return null; }
  const out = { ...f };
  f.fresh = false;
  return out;
}

function allTeams() {
  if (state.table) return state.table.rows;
  const seen = new Map();
  for (const e of state.events.values()) for (const t of [e.home, e.away]) if (!seen.has(t.id)) seen.set(t.id, t);
  return [...seen.values()];
}

function favoriteHtml() {
  const id = state.favorite;
  if (!id) return state.hintOff || !state.events.size ? '' : ui.favoriteHint();
  const team = allTeams().find((t) => t.id === id);
  if (!team) return '';
  const now = new Date();
  const roundGame = focusRound()?.events.find((e) => playsIn(e, id) && (e.status.kind === 'pre' || e.status.kind === 'off'));
  const nextGame = sortEvents(eventList()).find((e) => playsIn(e, id) && e.status.kind === 'pre' && e.date > now);
  return ui.favoriteCard({ team, row: state.table?.byId.get(id), roundGame, nextGame, zones: state.zones, rankOf: liveRank, now });
}

function renderTable() {
  const t = state.table;
  if (!t) {
    el.tableNote.textContent = '';
    el.tableWrap.innerHTML = `<p class="empty">${state.lastOk ? 'Classificação indisponível no momento. Toque em “Status dos dados” no rodapé para ver o motivo.' : 'Carregando classificação…'}</p>`;
    el.legend.innerHTML = '';
    return;
  }
  el.tableNote.innerHTML = t.anyLive
    ? '<span class="pulse"></span> <b>Ao vivo:</b> como fica se os jogos terminarem agora. As setas mostram quem subiu ou caiu na rodada.'
    : t.started
      ? `Com os resultados da ${esc(roundName(focusRound()).toLowerCase())}. As setas mostram quem subiu ou caiu na rodada.`
      : 'Classificação atual. Toque num time para ver os detalhes.';
  const { html, legend } = ui.standingsTable({ table: t, zones: state.zones, formById: state.formById, favorite: state.favorite });
  el.tableWrap.innerHTML = html;
  el.legend.innerHTML = legend;
}

function renderSim() {
  const r = state.rounds[state.roundIdx];
  if (!r) { el.sim.innerHTML = '<p class="empty">Carregando jogos…</p>'; return; }
  const impact = state.table && state.simTable
    ? impactLines({ before: state.table, after: state.simTable, zones: state.zones, favorite: state.favorite }) : [];
  let oddsNote;
  if (!state.table) oddsNote = 'As chances aparecem quando a classificação carregar.';
  else if (state.table.mode !== 'jogos') oddsNote = 'As chances precisam de todos os jogos da temporada, que não carregaram por completo. Toque em “Status dos dados” no rodapé para ver o motivo.';
  else if (!state.odds) oddsNote = 'Calculando as chances…';
  else oddsNote = `${state.odds.runs.toLocaleString('pt-BR')} simulações dos ${state.odds.left} jogos que faltam, com base nos gols marcados e sofridos de cada time e na vantagem de jogar em casa. Os placares que você escolheu entram como resultado. É uma estimativa, não uma previsão.`;
  el.sim.innerHTML = ui.simView({
    round: r,
    roundLabel: roundName(r),
    sims: state.sims,
    real: state.table,
    sim: state.simTable,
    zones: state.zones,
    impact,
    odds: state.odds,
    oddsBase: state.oddsBase,
    oddsNote,
    favorite: state.favorite,
    finished: isFinished(r),
  });
}

function renderStats() {
  const r = state.rounds[state.roundIdx];
  if (!r) { el.stats.innerHTML = ''; return; }
  el.stats.innerHTML = ui.statsView({ roundLabel: roundName(r), st: roundStats(r), trends: state.trends, selectedBar: state.selectedBar });
}

// ---------- telas de detalhe ----------
const hasModal = typeof HTMLDialogElement === 'function' && typeof el.sheet.showModal === 'function';

function openSheet(spec) {
  if (state.sheet && !(state.sheet.type === spec.type && state.sheet.id === spec.id)) state.sheetStack.push(state.sheet);
  state.sheet = spec;
  safe('o detalhe', renderSheet, el.sheetBody);
  if (!el.sheet.open) {
    if (hasModal) el.sheet.showModal();
    else { el.sheet.setAttribute('open', ''); el.sheet.classList.add('fallback'); }
    el.sheet.append(el.toasts);
    document.documentElement.classList.add('sheet-open');
  }
  el.sheet.querySelector('.sheet-scroll').scrollTop = 0;
  if (spec.type === 'match') loadSummary(spec.id);
}

function closeSheet() {
  if (hasModal && el.sheet.open) { el.sheet.close(); return; }
  el.sheet.removeAttribute('open');
  sheetClosed();
}

function sheetClosed() {
  state.sheet = null;
  state.sheetStack = [];
  document.body.append(el.toasts);
  document.documentElement.classList.remove('sheet-open');
}

function renderSheet() {
  const spec = state.sheet;
  if (!spec) return;
  el.sheetBack.hidden = !state.sheetStack.length;
  const list = eventList();
  const now = new Date();
  let html = '';
  if (spec.type === 'match') {
    const ev = state.events.get(spec.id);
    if (!ev) { closeSheet(); return; }
    const focus = focusRound();
    const inFocus = !!focus?.events.includes(ev);
    let scen = null;
    if (inFocus && state.table && (ev.status.kind === 'pre' || ev.status.kind === 'live')) {
      try { scen = scenarios(state.ctx, ev); } catch { scen = null; }
    }
    const sum = state.summaries.get(ev.id);
    const own = Object.keys(ev.home.stats).length ? { [ev.home.id]: ev.home.stats, [ev.away.id]: ev.away.stats } : null;
    const stats = sum?.stats && Object.keys(sum.stats).length ? sum.stats : own;
    html = ui.matchSheet(ev, {
      table: state.table, scen, stats,
      statsLoading: !!sum?.loading || (!sum && (ev.status.kind === 'live' || ev.status.kind === 'post')),
      formById: state.formById, favorite: state.favorite, story: matchStory(ev, inFocus ? preRank : null),
      roundLabel: roundName(state.roundOf.get(ev.id)), now,
    });
  } else if (spec.type === 'team') {
    const team = allTeams().find((t) => t.id === spec.id);
    if (!team) { closeSheet(); return; }
    // Próximos 5 jogos (o que está rolando primeiro); adiados ainda sem data vêm no fim.
    const mine = sortEvents(list).filter((e) => playsIn(e, spec.id));
    const upcoming = [
      ...mine.filter((e) => e.status.kind === 'live' || (e.status.kind === 'pre' && e.date > now - 3 * HOUR)),
      ...mine.filter((e) => e.status.kind === 'off'),
    ].slice(0, 5);
    html = ui.teamSheet({
      team, row: state.table?.byId.get(spec.id), table: state.table, zones: state.zones,
      form: state.formById.get(spec.id) || formOf(list, spec.id), upcoming, favorite: state.favorite,
      odds: state.oddsBase?.byId.get(spec.id) || null,
      rankOf: liveRank, roundOf: (e) => state.roundOf.get(e.id),
    });
  } else if (spec.type === 'picker') {
    html = ui.teamPicker(allTeams(), state.favorite);
  } else if (spec.type === 'diag') {
    html = ui.diagSheet({ ...state.diag, events: state.events.size, rounds: state.rounds.length, roundsMethod: state.rounds.method, roundsWhy: state.rounds.why, focus: roundName(focusRound()), complete: state.complete, seasonComplete: state.seasonComplete, mode: state.table?.mode || null, odds: !!state.oddsBase, ua: navigator.userAgent, modal: hasModal });
  }
  el.sheetBody.innerHTML = html;
}

// ---------- avisos ----------
function toast(html, matchId) {
  const t = document.createElement(matchId ? 'button' : 'div');
  t.className = 'toast';
  if (matchId) { t.type = 'button'; t.dataset.match = matchId; }
  t.innerHTML = html;
  el.toasts.prepend(t);
  while (el.toasts.children.length > 3) el.toasts.lastChild.remove();
  setTimeout(() => t.classList.add('out'), 6000);
  setTimeout(() => t.remove(), 6500);
}

function flushAlerts() {
  const alerts = state.alerts.splice(0);
  let celebrate = null;
  for (const a of alerts.slice(-4)) {
    const ev = state.events.get(a.ev.id) || a.ev;
    const score = `${esc(ev.home.name)} <b>${ev.home.score} x ${ev.away.score}</b> ${esc(ev.away.name)}`;
    for (const side of a.sides) {
      const team = ev[side];
      const g = [...ev.incidents].reverse().find((i) => i.kind === 'goal' && i.team === team.id);
      toast(`<b class="tag tone-gol">Gol</b><span class="toast-body"><span>${score}</span><small>Gol ${esc(doo(team.name))}${g?.who ? ` · ${esc(g.who)} ${esc(g.min.label)}` : ''}</small></span>`, ev.id);
      if (team.id === state.favorite) celebrate = [team.color, team.color2, '#f5c518'].filter(Boolean);
    }
  }
  if (alerts.length) { fx.playGoal(); fx.buzz(); }
  if (celebrate) fx.confetti(celebrate.length > 1 ? celebrate : ['#f5c518', '#0b6b3a', '#ffffff']);
}

// ---------- interações ----------
function selectRound(idx) {
  if (idx < 0 || idx >= state.rounds.length) return;
  state.roundIdx = idx;
  state.pinned = idx === state.focusIdx ? null : state.rounds[idx].events[0].id;
  state.selectedBar = null;
}

// Trocar de rodada não busca nada na rede, a não ser que a rodada ainda tenha jogo por terminar.
let goTimer = 0;
function go(delta) {
  selectRound(state.roundIdx + delta);
  render();
  clearTimeout(goTimer);
  const r = state.rounds[state.roundIdx];
  if (r && !isFinished(r)) goTimer = setTimeout(tick, 700);
}

function setTab(tab) {
  el.tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  el.views.forEach((v) => { v.hidden = v.dataset.tab !== tab; });
  save('aba', tab);
}

function setFavorite(id) {
  state.favorite = id;
  save('meu-time', id);
  const team = allTeams().find((t) => t.id === id);
  if (team) toast(`<b class="tag tone-good">Meu time</b><span class="toast-body"><span>Agora você acompanha ${esc(o(team.name))} de perto</span></span>`);
  render();
}

function simChanged() {
  save(SIM_KEY, state.sims);
  state.simTable = Object.keys(state.sims).length ? computeTable({ ...state.ctx, overrides: state.sims }) : state.table;
  scheduleOdds(350);
  safe('o simulador', renderSim, el.sim);
}

function handleAction(btn) {
  const { action, id } = btn.dataset;
  const ev = id ? state.events.get(id) : null;
  if (action === 'sim-step' && ev && ev.status.kind !== 'post') {
    const live = ev.status.kind === 'live' ? { h: ev.home.score ?? 0, a: ev.away.score ?? 0 } : { h: 0, a: 0 };
    const cur = { ...(state.sims[id] || live) };
    cur[btn.dataset.side] = Math.max(0, Math.min(15, cur[btn.dataset.side] + Number(btn.dataset.delta)));
    state.sims[id] = cur;
    simChanged();
  } else if (action === 'sim-set' && ev && ev.status.kind !== 'post') {
    state.sims[id] = { h: Number(btn.dataset.h), a: Number(btn.dataset.a) };
    simChanged();
  } else if (action === 'sim-reset') {
    delete state.sims[id];
    simChanged();
  } else if (action === 'sim-clear') {
    state.sims = {};
    simChanged();
  } else if (action === 'sim-random') {
    const r = state.rounds[state.roundIdx];
    const m = model(state.table?.finished || new Map(), eventList());
    for (const e of r?.events || []) if (e.status.kind !== 'post') state.sims[e.id] = randomScore(m, e);
    simChanged();
  } else if (action === 'simulate' && ev) {
    closeSheet();
    const idx = state.rounds.indexOf(state.roundOf.get(ev.id));
    if (idx >= 0 && idx !== state.roundIdx) selectRound(idx);
    setTab('simular');
    state.scrollTo = `sim-${ev.id}`;
    render();
  } else if (action === 'follow') {
    if (state.favorite === id) { state.favorite = null; save('meu-time', null); render(); } else setFavorite(id);
  } else if (action === 'set-fav') {
    closeSheet();
    setFavorite(id);
  } else if (action === 'picker') {
    openSheet({ type: 'picker' });
  } else if (action === 'hide-hint') {
    state.hintOff = true;
    save('dica-time', true);
    safe('os jogos', renderGames, el.matches);
  } else if (action === 'bar') {
    state.selectedBar = Number(btn.dataset.i);
    safe('os números', renderStats, el.stats);
  } else if (action === 'diag') {
    openSheet({ type: 'diag' });
  }
}

async function share() {
  const r = state.rounds[state.roundIdx];
  if (!r) return;
  const text = ui.shareText(r, roundName(r), el.season.textContent, state.roundIdx === state.focusIdx ? state.table : null);
  const url = location.href.split('#')[0];
  try {
    if (navigator.share) { await navigator.share({ title: `Brasileirão · ${roundName(r)}`, text: `${text}\n\n${url}` }); return; }
  } catch (err) {
    if (err?.name === 'AbortError') return;
  }
  try {
    await navigator.clipboard.writeText(`${text}\n\n${url}`);
    toast('<b class="tag tone-good">Pronto</b><span class="toast-body"><span>Placares copiados. É só colar na conversa.</span></span>');
  } catch {
    toast('<b class="tag tone-plain">Ops</b><span class="toast-body"><span>Não deu para compartilhar daqui.</span></span>');
  }
}

function setSoundButton() {
  const on = fx.isSoundOn();
  el.sound.setAttribute('aria-pressed', String(on));
  el.sound.setAttribute('aria-label', on ? 'Som de gol ligado' : 'Som de gol desligado');
  el.sound.classList.toggle('on', on);
}

document.addEventListener('click', (e) => {
  const act = e.target.closest('[data-action]');
  if (act) { if (!act.disabled) handleAction(act); return; }
  const team = e.target.closest('[data-team]');
  if (team) { openSheet({ type: 'team', id: team.dataset.team }); return; }
  const match = e.target.closest('[data-match]');
  if (match) openSheet({ type: 'match', id: match.dataset.match });
});
document.addEventListener('keydown', (e) => {
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('[role="button"]:not(button)')) {
    e.preventDefault();
    e.target.click();
  }
  if (e.key === 'Escape' && state.sheet && !hasModal) closeSheet();
});

el.prev.addEventListener('click', () => go(-1));
el.next.addEventListener('click', () => go(1));
el.refresh.addEventListener('click', () => tick());
el.retry.addEventListener('click', () => tick());
el.share.addEventListener('click', share);
el.sound.addEventListener('click', () => {
  const on = fx.toggleSound();
  setSoundButton();
  toast(`<b class="tag tone-plain">Som</b><span class="toast-body"><span>${on ? 'Som de gol ligado' : 'Som de gol desligado'}</span></span>`);
});
el.tabs.forEach((b) => b.addEventListener('click', () => setTab(b.dataset.tab)));

$('sheet-close').addEventListener('click', closeSheet);
el.sheetBack.addEventListener('click', () => {
  state.sheet = state.sheetStack.pop() || null;
  if (!state.sheet) closeSheet();
  else { safe('o detalhe', renderSheet, el.sheetBody); if (state.sheet.type === 'match') loadSummary(state.sheet.id); }
});
el.sheet.addEventListener('click', (e) => { if (e.target === el.sheet) closeSheet(); });
el.sheet.addEventListener('close', sheetClosed);

// Escudo que não carrega: tenta a imagem original; se ela também falhar, mostra as iniciais do time.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement) || !img.dataset.name) return;
  if (img.dataset.original) { img.src = img.dataset.original; delete img.dataset.original; return; }
  const span = document.createElement('span');
  span.className = 'crest-fallback';
  span.style.cssText = img.style.cssText;
  span.textContent = img.dataset.name;
  span.setAttribute('aria-hidden', 'true');
  img.replaceWith(span);
}, true);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(state.timer); return; }
  if (Date.now() - state.lastOk > 15e3) tick(); else schedule();
});
window.addEventListener('online', () => tick());

const savedTab = store('aba', 'jogos');
setTab(['jogos', 'tabela', 'simular', 'numeros'].includes(savedTab) ? savedTab : 'jogos');
setSoundButton();
if (loadCache()) refresh();
tick();
