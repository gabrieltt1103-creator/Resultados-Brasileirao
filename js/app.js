import * as espn from './espn.js';
import { buildRounds, dropReplaced, isFinished, pickDefault, playsIn, roundName, sortEvents } from './rounds.js';
import { computeTable, finishedTable, formOf, reconcile, scenarios, zonesFor } from './table.js';
import { headlines, impactLines, lastGoal, liveClock, matchFlow, matchStory, roundStats, scoreChange, trends } from './insights.js';
import { chances, matchPicks, model, suggestScore } from './sim.js';
import { deltaMonths, vanished } from './season.js';
import * as fx from './fx.js';
import { HOUR, addDays, dayLabel, dm, doo, esc, fmtTime, o, sameDay, save, shortDay, store, ymd } from './util.js';

// Aparência: a página escolhe (index.html usa a atual, v2/index.html a nova). Dados e lógica são os mesmos.
const ui = await import(document.documentElement.dataset.ui === 'v2' ? './ui-v2.js' : './ui.js');

const LIVE_MS = 30e3;            // com jogo rolando (ou prestes a começar)
const IDLE_MS = 120e3;           // sem jogo agora
const WARM_MS = 5 * 60e3;        // ontem, amanhã e os dias da rodada aberta
const SEASON_MS = 30 * 60e3;     // meses da temporada que ainda podem mudar
const SEASON_RETRY_MS = 2 * 60e3;
const FULL_MS = 24 * HOUR;       // temporada inteira de novo
const STALE_MS = 90e3;           // com jogo ao vivo, placar parado há mais que isso merece aviso
const STANDINGS_MS = 5 * 60e3;
const SUMMARY_MS = 25e3;
const FLASH_MS = 90e3;
const ALERT_GAP_MS = 5 * 60e3;
const CACHE_KEY = 'temporada:v1';
const SIM_KEY = 'simulacao:v1';
const ODDS_RUNS = 3000;

const $ = (id) => document.getElementById(id);
const el = {
  season: $('season'), refresh: $('refresh'), pulse: $('pulse'), updated: $('updated'), sound: $('sound'),
  prev: $('prev'), next: $('next'), roundName: $('round-name'), roundDates: $('round-dates'),
  tabs: [...document.querySelectorAll('.tab')], views: [...document.querySelectorAll('[role="tabpanel"]')],
  fav: $('fav'), favHint: $('fav-hint'), others: $('others'), news: $('news'), summary: $('summary'), matches: $('matches'), share: $('share'),
  tableNote: $('table-note'), tableWrap: $('table-wrap'), legend: $('legend'), tableCheck: $('table-check'), stats: $('stats'), sim: $('sim'),
  error: $('error'), errorText: $('error-text'), retry: $('retry'), diag: $('diag'),
  sheet: $('sheet'), sheetBody: $('sheet-body'), sheetBack: $('sheet-back'), toasts: $('toasts'),
};

const state = {
  events: new Map(),
  fetchedAt: new Map(),   // id do jogo -> início da requisição que trouxe a versão guardada
  logos: new Map(),
  rounds: [],
  roundOf: new Map(),
  roundIdx: -1,
  focusIdx: -1,           // rodada em andamento: a tabela ao vivo vale para ela
  pinned: null,           // id de um jogo da rodada escolhida; null = seguir automático
  standings: [],
  seasonComplete: false,  // todos os meses da temporada vieram da ESPN
  complete: false,        // ... e batem com a classificação oficial
  adjust: new Map(),      // pontos da classificação oficial que os jogos não explicam (punições)
  check: null,            // conferência com a classificação oficial
  seasonT: 0,             // última leitura da temporada sem falhas (inteira ou só os meses recentes)
  fullT: 0,               // última leitura da temporada inteira
  seasonTry: 0,
  seasonOk: false,
  seasonLoading: false,
  lastWarm: 0,
  cacheT: 0,
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
  flashes: new Map(),
  alerts: [],
  summaries: new Map(),
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
  open: {},               // blocos recolhíveis abertos (sobrevivem às atualizações da tela)
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
// Mensagens do navegador para falha de rede vêm em inglês e variam: "Failed to fetch", "Load failed"...
const errText = (err) => {
  const msg = String(err?.message || err || 'erro');
  return /failed to fetch|load failed|networkerror|network request failed/i.test(msg) ? 'sem conexão com a ESPN' : msg;
};

// ---------- dados ----------
// Cada leitura guarda quando a requisição começou: um jogo só é trocado por uma leitura mais nova,
// então uma resposta lenta da temporada não desfaz o placar que a atualização rápida já trouxe.
function ingest(list, t0) {
  const ids = new Set();
  for (const raw of list || []) {
    let ev;
    try { ev = espn.parseEvent(raw); } catch { continue; }
    ids.add(ev.id);
    addEvent(ev, t0);
  }
  return ids;
}

// Aviso de gol só quando a leitura anterior do jogo é recente: ao abrir o app com dados salvos, ou
// ao voltar depois de um tempo, os placares mudam sem disparar uma fila de avisos antigos.
function addEvent(ev, t0, quiet = false) {
  const prev = state.fetchedAt.get(ev.id) || 0;
  if (prev > t0) return;
  state.fetchedAt.set(ev.id, t0);
  for (const t of [ev.home, ev.away]) {
    if (t.logo) state.logos.set(t.id, t.logo);
    else t.logo = state.logos.get(t.id) || '';
  }
  if (quiet || t0 - prev > ALERT_GAP_MS) state.scores.set(ev.id, { h: ev.home.score ?? 0, a: ev.away.score ?? 0, kind: ev.status.kind });
  else detectGoal(ev);
  state.events.set(ev.id, ev);
}

function detectGoal(ev) {
  const change = scoreChange(state.scores.get(ev.id), ev);
  state.scores.set(ev.id, { h: ev.home.score ?? 0, a: ev.away.score ?? 0, kind: ev.status.kind });
  if (!change) return;
  if (change.annulled) state.flashes.delete(ev.id);
  else state.flashes.set(ev.id, { sides: change.sides, until: Date.now() + FLASH_MS, fresh: true });
  state.alerts.push({ ev, ...change });
}

const seasonDue = (now) => !state.seasonLoading && now - state.seasonTry > (state.seasonOk ? SEASON_MS : SEASON_RETRY_MS);

/**
 * Temporada em segundo plano (o placar ao vivo não espera por ela). A primeira leitura traz o ano
 * inteiro; depois, só os meses que ainda podem mudar. Uma vez por dia, o ano inteiro de novo.
 */
async function loadSeason() {
  state.seasonLoading = true;
  const t0 = Date.now();
  state.seasonTry = t0;
  const now = new Date(t0);
  const year = now.getFullYear();
  const full = !state.seasonComplete || !state.fullT || t0 - state.fullT > FULL_MS;
  try {
    const months = full ? null : deltaMonths(eventList(), state.seasonT, now);
    const res = full ? await espn.fetchSeason(year) : await espn.fetchMonths(year, months);
    state.diag.season = { t: Date.now(), count: res.events.length, failed: res.failed, full, months };
    if (res.season) el.season.textContent = res.season;
    if (full && !res.events.length) {
      // Sem a temporada: pelo menos a rodada atual.
      const json = await espn.fetchScoreboard(null, 300, 12e3);
      ingest(json?.events, t0);
      state.diag.season.fallback = (json?.events || []).length;
      state.seasonOk = false;
    } else {
      const ids = ingest(res.events, t0);
      state.seasonOk = !res.failed.length;
      if (state.seasonOk) {
        // O que a ESPN tirou da lista some daqui também (a não ser que uma leitura mais nova o tenha trazido).
        for (const id of vanished([...state.events.values()], ids, months, year)) {
          if ((state.fetchedAt.get(id) || 0) <= t0) state.events.delete(id);
        }
        state.seasonT = t0;
        if (full) { state.fullT = t0; state.seasonComplete = true; }
      }
    }
    // Só conta como atualizado (e só regrava os dados salvos) se algum jogo veio.
    if (res.events.length) {
      state.lastOk = Math.max(state.lastOk, Date.now());
      saveCache();
    }
  } catch (err) {
    state.seasonOk = false;
    state.diag.season = { t: Date.now(), count: 0, failed: [], full, error: errText(err) };
  } finally {
    state.seasonLoading = false;
    refresh();
  }
}

// Atualização rápida, dia a dia: hoje e os dias com jogo rolando (ou prestes a começar). De tempos
// em tempos, ou quando pedido, também ontem, amanhã e os dias da rodada aberta com jogo por terminar.
async function refreshHot(warm) {
  const t0 = Date.now();
  const today = new Date(t0);
  const days = new Map([[ymd(today), today]]);
  for (const e of eventList()) {
    if (e.status.kind === 'live' || (e.status.kind === 'pre' && e.date - t0 < 15 * 60e3 && t0 - e.date < 3 * HOUR)) days.set(ymd(e.date), e.date);
  }
  if (warm) {
    for (const d of [addDays(today, -1), addDays(today, 1)]) days.set(ymd(d), d);
    const r = state.rounds[state.roundIdx];
    if (r) for (const e of r.events) if (e.status.kind === 'pre' || e.status.kind === 'live') days.set(ymd(e.date), e.date);
  }
  const finished = () => eventList().filter((e) => e.status.kind === 'post').length;
  const before = finished();
  const standingsDue = !state.standings.length || t0 - state.lastStandings > STANDINGS_MS;
  const [res] = await Promise.all([
    Promise.allSettled([...days.values()].slice(0, 6).map((d) => espn.fetchDay(d))),
    standingsDue ? loadStandings() : null,
  ]);
  const errors = [];
  for (const r of res) {
    if (r.status === 'fulfilled') {
      ingest(r.value?.events, t0);
      if (!el.season.textContent) el.season.textContent = espn.seasonYear(r.value) || '';
    } else errors.push(errText(r.reason));
  }
  if (errors.length === res.length) throw new Error(errors[0] || 'sem resposta');
  if (warm && !errors.length) state.lastWarm = t0;
  if (!standingsDue && finished() !== before) await loadStandings();
  if (Date.now() - state.lastCache > 5 * 60e3) saveCache();
  return { days: res.length, errors };
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

// Resumo do jogo: estatísticas e lance a lance (jogos encerrados e ao vivo) e os últimos confrontos (todos).
async function loadSummary(id, force = false) {
  const ev = state.events.get(id);
  if (!ev) return;
  const cached = state.summaries.get(id);
  if (cached?.loading) return;
  if (cached && !force && (ev.status.kind !== 'live' || Date.now() - cached.t < SUMMARY_MS)) return;
  state.summaries.set(id, { ...cached, loading: true });
  try {
    const json = await espn.fetchSummary(id);
    const stats = espn.parseSummaryStats(json);
    // Lance a lance, para o fluxo da partida (vem na mesma resposta das estatísticas).
    const plays = espn.parseSummaryPlays(json);
    const h2h = espn.parseHeadToHead(json, id);
    state.summaries.set(id, { stats, plays, h2h, t: Date.now() });
    const played = ev.status.kind === 'live' || ev.status.kind === 'post';
    const ok = !played || Object.keys(stats).length > 0;
    state.diag.summary = { t: Date.now(), ok, error: ok ? null : 'sem estatísticas' };
  } catch (err) {
    state.summaries.set(id, { ...cached, loading: false, t: Date.now() });
    state.diag.summary = { t: Date.now(), ok: false, error: errText(err) };
  }
  if (state.sheet?.type === 'match' && state.sheet.id === id) safe('detalhe', renderSheet, el.sheetBody);
}

function saveCache() {
  try {
    const events = eventList().map((e) => ({ ...e, date: e.date.getTime() }));
    const json = JSON.stringify({
      t: Date.now(), year: new Date().getFullYear(), complete: state.seasonComplete, seasonT: state.seasonT, fullT: state.fullT,
      season: el.season.textContent, adjust: [...state.adjust], events,
    });
    if (json.length < 3e6) localStorage.setItem(CACHE_KEY, json);
    state.lastCache = Date.now();
  } catch { /* sem espaço: segue sem cache */ }
}

function loadCache() {
  const c = store(CACHE_KEY, null);
  if (!c || c.year !== new Date().getFullYear() || !Array.isArray(c.events)) return false;
  for (const e of c.events) addEvent({ ...e, date: new Date(e.date) }, c.t, true);
  state.seasonComplete = !!c.complete;
  state.seasonT = Number(c.seasonT) || 0;
  state.fullT = Number(c.fullT) || 0;
  state.cacheT = c.t;
  if (Array.isArray(c.adjust)) state.adjust = new Map(c.adjust.filter(([id, pts]) => typeof id === 'string' && Number.isInteger(pts)));
  if (c.season) el.season.textContent = c.season;
  state.diag.cache = { t: c.t, count: c.events.length };
  return state.events.size > 0;
}

async function tick({ warm = false } = {}) {
  clearTimeout(state.timer);
  if (state.loading) return;
  state.loading = true;
  el.refresh.classList.add('loading');
  const now = Date.now();
  if (seasonDue(now)) loadSeason();
  try {
    const r = await refreshHot(warm || now - state.lastWarm > WARM_MS);
    state.failed = false;
    state.lastOk = Date.now();
    state.diag.refresh = { t: Date.now(), ok: true, days: r.days, errors: r.errors };
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
  // Com ela valendo, os pontos são conferidos com a oficial (punições entram como ajuste).
  let complete = state.seasonComplete;
  state.check = null;
  if (complete && state.standings.length) {
    const fin = finishedTable({ standings: state.standings, events: list, complete: true });
    complete = state.standings.every((t) => (fin.rows.get(t.id)?.gp ?? 0) >= t.gp);
    if (complete) {
      state.check = reconcile(fin.rows, state.standings, state.adjust);
      state.adjust = state.check.adjust;
    }
  }
  state.complete = complete;

  for (const id of Object.keys(state.sims)) {
    const e = state.events.get(id);
    if (!e || e.status.kind === 'post') delete state.sims[id];
  }
  save(SIM_KEY, state.sims);

  state.ctx = { standings: state.standings, events: list, round: focusRound(), complete, adjust: complete ? state.adjust : null };
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
  renderFreshness();
  document.title = anyLive ? `● ${roundName(focusRound())} ao vivo` : 'Rodada ao Vivo';

  const empty = !state.events.size;
  el.error.hidden = !(state.failed && empty);
  if (state.failed && empty) el.errorText.textContent = 'Não foi possível carregar os jogos. Confira sua conexão com a internet; o app tenta de novo a cada 30 segundos.';
}

const when = (t) => (sameDay(new Date(t), new Date()) ? `das ${fmtTime.format(t)}` : `de ${dm(new Date(t))}`);
const ago = (ms) => (ms < 10e3 ? 'agora' : ms < 60e3 ? `há ${Math.floor(ms / 10e3) * 10} s` : ms < HOUR ? `há ${Math.floor(ms / 60e3)} min` : `às ${fmtTime.format(Date.now() - ms)}`);

// Há quanto tempo os placares foram lidos. Fica em destaque quando está sem conexão ou, com jogo
// rolando, sem atualizar há mais de 1,5 min.
function freshness() {
  if (!state.lastOk) {
    if (state.cacheT) return [state.failed ? 'Sem conexão' : 'Atualizando…', `dados ${when(state.cacheT)}`, true];
    return [state.failed ? 'Sem conexão' : 'Carregando…', '', state.failed];
  }
  const age = Date.now() - state.lastOk;
  if (state.failed) return ['Sem conexão', `atualizado ${ago(age)}`, true];
  const live = eventList().some((e) => e.status.kind === 'live');
  if (live && age > STALE_MS) return ['Sem atualizar', ago(age), true];
  return ['Atualizado', ago(age), false];
}

function renderFreshness() {
  const [title, sub, warn] = freshness();
  el.updated.innerHTML = `<b>${esc(title)}</b>${sub ? `<small>${esc(sub)}</small>` : ''}`;
  el.updated.classList.toggle('warn', warn);
  el.refresh.setAttribute('aria-label', `${title}${sub ? ` ${sub}` : ''}. Toque para atualizar agora.`);
}

function renderGames() {
  const r = state.rounds[state.roundIdx];
  if (!r) {
    el.summary.hidden = true;
    el.share.hidden = true;
    el.news.innerHTML = '';
    el.fav.innerHTML = '';
    el.favHint.innerHTML = '';
    el.others.innerHTML = '';
    if (state.failed) el.matches.innerHTML = '';
    else if (state.lastOk) el.matches.innerHTML = '<p class="empty">Nenhum jogo do Brasileirão encontrado.</p>';
    return;
  }
  const isFocus = state.roundIdx === state.focusIdx;
  const now = new Date();
  // A rodada vem primeiro: o cartão do time escolhido fica no topo, o convite para escolher, no fim.
  safe('o seu time', () => {
    el.fav.innerHTML = state.favorite ? favoriteHtml() : '';
    el.favHint.innerHTML = state.favorite || state.hintOff || !state.events.size ? '' : ui.favoriteHint();
  }, el.fav);
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
  el.summary.innerHTML = ui.roundSummary({ total: r.events.length, counts, goals, loading: !state.seasonComplete && state.seasonLoading });
  el.summary.hidden = false;

  const ctxBase = {
    rank: liveRank,
    delta: (id) => (isFocus ? state.table?.byId.get(id)?.delta || 0 : 0),
    favorite: state.favorite,
    // Posição de cada time se ele vencer (usado pela v2 nos jogos ao vivo da rodada em andamento).
    scenarios: isFocus && state.table ? (ev) => { try { return scenarios(state.ctx, ev); } catch { return null; } } : null,
  };
  // Zebra compara com a tabela de agora, então só vale na rodada em andamento.
  const card = (ev, note) => ui.matchCard(ev, { ...ctxBase, flash: takeFlash(ev.id), story: matchStory(ev, isFocus ? preRank : null), note });

  // Jogos de hoje que são de outras rodadas (remarcados), para não passarem despercebidos.
  const others = isFocus ? sortEvents(eventList()).filter((e) => !r.events.includes(e)
    && (e.status.kind === 'live' || (sameDay(e.date, now) && e.status.kind !== 'off'))) : [];
  el.others.innerHTML = others.length ? ui.otherGames(others.map((e) => card(e, roundName(state.roundOf.get(e.id))))) : '';

  const days = [];
  for (const ev of r.events) {
    const last = days[days.length - 1];
    if (last && sameDay(last.date, ev.date)) last.events.push(ev);
    else days.push({ date: ev.date, events: [ev] });
  }
  el.matches.innerHTML = ui.daySections(days.map((d) => ({
    label: dayLabel(d.date, now), date: d.date, events: d.events, moved: d.events.every((e) => e.moved), cards: d.events.map((ev) => card(ev)),
  })));
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
    el.tableCheck.innerHTML = '';
    return;
  }
  const r = focusRound();
  const n = (k) => r?.events.filter((e) => e.status.kind === k).length || 0;
  const name = esc(roundName(r).toLowerCase());
  const arrows = 'As setas mostram quem subiu ou caiu na rodada.';
  if (t.anyLive) el.tableNote.innerHTML = `<span class="pulse"></span> <b>Ao vivo:</b> como fica se ${n('live') === 1 ? 'o jogo em andamento terminar' : `os ${n('live')} jogos em andamento terminarem`} agora. ${arrows}`;
  else if (t.started) {
    const left = n('pre');
    el.tableNote.innerHTML = left
      ? `Com ${n('post') === 1 ? 'o jogo já encerrado' : `os ${n('post')} jogos já encerrados`} da ${name}; ${left === 1 ? 'falta 1' : `faltam ${left}`}. ${arrows}`
      : `Com todos os jogos da ${name}${n('off') ? ` (${n('off') === 1 ? '1 adiado' : `${n('off')} adiados`})` : ''}. ${arrows}`;
  } else el.tableNote.textContent = 'Classificação atual. Toque num time para ver os detalhes.';
  const { html, legend } = ui.standingsTable({ table: t, zones: state.zones, formById: state.formById, favorite: state.favorite });
  // Mantém a rolagem para o lado (colunas de saldo, gols e últimos jogos) entre as atualizações.
  const x = el.tableWrap.scrollLeft;
  el.tableWrap.innerHTML = html;
  el.tableWrap.scrollLeft = x;
  el.legend.innerHTML = legend;
  el.tableCheck.innerHTML = ui.tableCheck({ mode: t.mode, check: state.check, adjust: state.adjust, teams: t.byId, at: state.diag.standings?.ok ? state.diag.standings.t : null });
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
  else oddsNote = `${state.odds.runs.toLocaleString('pt-BR')} simulações dos ${state.odds.left} jogos que faltam${Object.keys(state.sims).length ? ', com os seus placares' : ''}. É uma estimativa, não uma previsão.`;
  const m = state.table ? currentModel() : null;
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
    picksOf: (e) => (m && e.status.kind !== 'post' ? matchPicks(m, e) : null),
    open: state.open,
  });
}

// Gols por jogo no campeonato, com os jogos encerrados (só com a temporada completa).
function seasonAverage() {
  if (state.table?.mode !== 'jogos') return null;
  let goals = 0;
  let games = 0;
  for (const r of state.table.finished.values()) { goals += r.gf; games += r.gp; }
  return games >= 40 ? goals / (games / 2) : null;
}

// Modelo de força dos times com os jogos encerrados até agora.
function currentModel() {
  return model(state.table?.finished || new Map(), eventList());
}

function renderStats() {
  const r = state.rounds[state.roundIdx];
  if (!r) { el.stats.innerHTML = ''; return; }
  el.stats.innerHTML = ui.statsView({ roundLabel: roundName(r), st: roundStats(r), trends: state.trends, selectedBar: state.selectedBar, seasonAvg: seasonAverage(), open: !isFinished(r) });
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
      roundLabel: roundName(state.roundOf.get(ev.id)), now, zones: state.zones, inFocus,
      h2h: sum?.h2h || null,
      flow: sum?.plays?.length && (ev.status.kind === 'live' || ev.status.kind === 'post') ? matchFlow(sum.plays, liveClock(ev)) : null,
      picks: state.table && (ev.status.kind === 'pre' || ev.status.kind === 'live') ? matchPicks(currentModel(), ev) : null,
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
    html = ui.diagSheet({
      ...state.diag, events: state.events.size, rounds: state.rounds.length, roundsMethod: state.rounds.method, roundsWhy: state.rounds.why,
      focus: roundName(focusRound()), complete: state.complete, seasonComplete: state.seasonComplete, mode: state.table?.mode || null,
      odds: !!state.oddsBase, check: state.check, adjust: state.adjust, names: new Map(allTeams().map((t) => [t.id, t.name])),
      ua: navigator.userAgent, modal: hasModal,
    });
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
  let goal = false;
  for (const a of alerts.slice(-4)) {
    const ev = state.events.get(a.ev.id) || a.ev;
    const score = `${esc(ev.home.name)} <b>${ev.home.score} x ${ev.away.score}</b> ${esc(ev.away.name)}`;
    if (a.annulled) {
      toast(`<b class="tag tone-plain">Placar</b><span class="toast-body"><span>${score}</span><small>Gol retirado do placar (anulado ou corrigido)</small></span>`, ev.id);
      continue;
    }
    goal = true;
    for (const side of a.sides) {
      const team = ev[side];
      const g = lastGoal(ev, team);
      toast(`<b class="tag tone-gol">Gol</b><span class="toast-body"><span>${score}</span><small>Gol ${esc(doo(team.name))}${g?.who ? ` · ${esc(g.who)} ${esc(g.min.label)}` : ''}</small></span>`, ev.id);
      if (team.id === state.favorite) celebrate = [team.color, team.color2, '#f5c518'].filter(Boolean);
    }
  }
  if (goal) { fx.playGoal(); fx.buzz(); }
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
  if (r && !isFinished(r)) goTimer = setTimeout(() => tick({ warm: true }), 700);
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
  } else if (action === 'sim-suggest') {
    const r = state.rounds[state.roundIdx];
    const m = currentModel();
    for (const e of r?.events || []) if (e.status.kind !== 'post') state.sims[e.id] = suggestScore(m, e);
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
el.refresh.addEventListener('click', () => tick({ warm: true }));
el.retry.addEventListener('click', () => tick({ warm: true }));
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
  if (Date.now() - state.lastOk > 15e3) tick({ warm: true }); else schedule();
  renderFreshness();
});
window.addEventListener('online', () => tick({ warm: true }));
setInterval(() => { if (!document.hidden) safe('o topo', renderFreshness); }, 5e3);

// Blocos recolhíveis (<details data-keep>) continuam abertos depois de cada atualização da tela.
document.addEventListener('toggle', (e) => {
  const key = e.target?.dataset?.keep;
  if (key) state.open[key] = e.target.open;
}, true);

const savedTab = store('aba', 'jogos');
setTab(['jogos', 'tabela', 'simular', 'numeros'].includes(savedTab) ? savedTab : 'jogos');
setSoundButton();
// Com dados salvos, as rodadas são montadas antes de buscar (para saber quais dias atualizar),
// a busca começa e só então a tela é desenhada.
const cached = loadCache();
if (cached) safe('a rodada', derive, el.matches);
tick({ warm: true });
if (cached) render();
