import * as espn from './espn.js';
import { buildRounds, dropReplaced, isFinished, pickDefault, playsIn, roundName, sortEvents } from './rounds.js';
import { computeTable, finishedTable, formOf, reconcile, scenarios, zonesFor } from './table.js';
import { headlines, impactLines, lastGoal, liveClock, matchFlow, matchReading, matchStory, roundStats, scoreChange, trends } from './insights.js';
import { PROMOTED, chances, expectedGoals, matchPicks, model, priorFrom, secador, suggestScore } from './sim.js';
import { COMPS, CUPS, compByKey, compOf, involves, phaseLabel, phasesOf, pickPhase, tiesOf } from './comps.js';
import { knockoutOdds } from './knockout.js';
import { objectiveFor, pick, restate, rivalsOf, sameState, secadorSummary, stakeOf, verdict, verdictText } from './secador.js';
import { deltaMonths, vanished } from './season.js';
import { coachFits, fetchCoaches } from './coach.js';
import * as fx from './fx.js';
import { HOUR, addDays, dayLabel, dm, doo, esc, fmtTime, keyOf, o, sameDay, save, shortDay, store, ymd } from './util.js';
import * as ui from './ui.js';

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
const SECADOR_RUNS = 4000;
const SECADOR_KEY = 'secador';
const RIVALS_KEY = 'rivais:v1';
const ADVICE_KEY = 'secador-conselhos:v1';
const COACH_KEY = 'tecnicos:v1';
const COACH_MS = 12 * HOUR;          // técnico conhecido vale por meio dia
const COACH_RETRY_MS = 10 * 60e3;   // sem resposta das fontes, tenta de novo depois disso
const LINEUP_MS = 2 * 60e3;         // perto do jogo, sem escalação ainda: busca o resumo de novo
const PRIOR_KEY = 'forca-anterior:v1';
const PRIOR_RETRY_MS = 30 * 60e3;   // sem a temporada anterior, tenta de novo depois disso
const COMP_KEY = 'competicao';
const CUP_KEY = (slug) => `copa:${slug}:v1`;
const CONT_KEY = 'continental-anterior:v1';
const CUP_MS = 30 * 60e3;           // competição com jogo nos próximos dias: temporada de novo depois disso
const CUP_IDLE_MS = 12 * HOUR;      // sem jogo por perto
const GROUPS_MS = 5 * 60e3;
const CUP_RUNS = 10000;
// Estrangeiros (Libertadores, Sul-Americana) começam abaixo da média brasileira: testado de 2018 a 2025.
const FOREIGN = { att: 0.8, def: 1.2 };

const $ = (id) => document.getElementById(id);
const el = {
  season: $('season'), refresh: $('refresh'), pulse: $('pulse'), updated: $('updated'), sound: $('sound'),
  prev: $('prev'), next: $('next'), roundName: $('round-name'), roundDates: $('round-dates'),
  tabs: [...document.querySelectorAll('.tab')], views: [...document.querySelectorAll('[role="tabpanel"]')],
  fav: $('fav'), secador: $('secador'), favHint: $('fav-hint'), others: $('others'), news: $('news'), summary: $('summary'), matches: $('matches'), share: $('share'),
  tableNote: $('table-note'), tableWrap: $('table-wrap'), legend: $('legend'), tableCheck: $('table-check'), stats: $('stats'), sim: $('sim'),
  error: $('error'), errorText: $('error-text'), retry: $('retry'), diag: $('diag'),
  sheet: $('sheet'), sheetBody: $('sheet-body'), sheetBack: $('sheet-back'), toasts: $('toasts'),
  comps: $('comps'), viewComp: $('view-comp'), tabsBar: document.querySelector('.tabs'), league: $('league'),
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
  coaches: store(COACH_KEY, {}), // id do time -> {c: técnico ou null, t}
  coachTry: {},
  prior: priorCached(new Date().getFullYear() - 1), // força de cada time no fim da temporada anterior
  priorTry: 0,
  priorLoading: false,
  lastStandings: 0,
  lastOk: 0,
  lastCache: 0,
  failed: false,
  loading: false,
  timer: 0,
  favorite: store('meu-time', null),
  hintOff: store('dica-time', false) === true,
  secadorOn: store(SECADOR_KEY, false) === true,
  rivals: cleanRivals(store(RIVALS_KEY, {})),
  secador: null,          // contas do secador: {round, teamId, teams: {id: {base, games}}}
  secLines: null,         // linha do secador de cada jogo da rodada vista (para os avisos de gol)
  secFrozen: loadAdvice(), // conselho de cada jogo na hora em que ele começou (fica salvo no celular)
  secadorSig: '',
  sheet: null,
  sheetStack: [],
  selectedBar: null,
  scrollTo: null,
  open: {},               // blocos recolhíveis abertos (sobrevivem às atualizações da tela)
  diag: { season: null, standings: null, refresh: null, summary: null, cache: null, prior: null, cups: {}, errors: [] },
  // Todos os campeonatos: 'hoje' (jogos do dia de todas as competições), 'bra.1' (o Brasileirão, como no app
  // de sempre) ou o identificador de outra competição.
  comp: compKeyToSlug(store(COMP_KEY, 'hoje')),
  cups: {},               // competição -> {events, phases, phaseIdx, pinned, t, ok, loading, groups, groupsT}
  cupTab: 'jogos',        // na competição: 'jogos' ou 'tabela'
  tab: 'jogos',           // aba do Brasileirão
  day: 0,                 // em Hoje: dias a partir de hoje
  contPast: null,         // jogos da Libertadores e da Sul-Americana do ano anterior (força dos estrangeiros)
  contTry: 0,
  cupOdds: new Map(),     // competição -> {sig, res}
};

function compKeyToSlug(v) {
  if (v === 'hoje' || v === 'bra.1') return v;
  return compOf(v) ? v : compByKey(v)?.slug || 'hoje';
}

// Força de partida guardada no celular: a temporada passada não muda mais, então vale o ano inteiro.
function priorCached(year) {
  const c = store(PRIOR_KEY, null);
  if (c?.year !== year || !Array.isArray(c.teams)) return null;
  const ok = c.teams.filter((t) => Array.isArray(t) && typeof t[0] === 'string' && t[1] > 0 && t[2] > 0);
  return ok.length >= 4 ? new Map(ok.map(([id, att, def]) => [id, { att, def }])) : null;
}

function cleanSims(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const [id, v] of Object.entries(raw)) if (Number.isInteger(v?.h) && Number.isInteger(v?.a)) out[id] = { h: v.h, a: v.a };
  }
  return out;
}

// Conselhos do secador já fixados (jogos que começaram), para valerem também depois de recarregar.
function loadAdvice() {
  const raw = store(ADVICE_KEY, null);
  const byId = new Map(raw && typeof raw.key === 'string' && raw.byId && typeof raw.byId === 'object' ? Object.entries(raw.byId) : []);
  return { key: raw?.key || '', byId };
}

function saveAdvice() {
  const { key, byId } = state.secFrozen;
  const team = (t) => (t ? { id: t.id, name: t.name } : null);
  const slim = {};
  for (const [id, v] of byId) slim[id] = { ...v, cheer: team(v.cheer), dry: team(v.dry), state: null, keep: undefined };
  save(ADVICE_KEY, { key, byId: slim });
}

// Rivais escolhidos por time: {idDoTime: [ids]}.
function cleanRivals(raw) {
  const out = {};
  if (raw && typeof raw === 'object') {
    for (const [id, list] of Object.entries(raw)) if (Array.isArray(list)) out[id] = list.filter((x) => typeof x === 'string');
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
    maybePrior();
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
    refreshCupsHot(warm, t0).catch(() => null),
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
  const ev = findEvent(id);
  if (!ev) return;
  const cached = state.summaries.get(id);
  if (cached?.loading) return;
  // Ao vivo, o resumo é refeito a cada SUMMARY_MS; perto do início, até a escalação sair.
  const waitLineup = ev.status.kind === 'pre' && ev.date - Date.now() < 2 * HOUR && !cached?.lineups;
  const maxAge = ev.status.kind === 'live' ? SUMMARY_MS : waitLineup ? LINEUP_MS : Infinity;
  if (cached && !force && Date.now() - cached.t < maxAge) return;
  state.summaries.set(id, { ...cached, loading: true });
  try {
    const json = await espn.fetchSummary(id);
    const stats = espn.parseSummaryStats(json);
    // Lance a lance, para o fluxo da partida (vem na mesma resposta das estatísticas).
    const plays = espn.parseSummaryPlays(json);
    const h2h = espn.parseHeadToHead(json, id);
    // Escalações (e substituições), publicadas pela ESPN cerca de uma hora antes do jogo.
    const lineups = espn.parseSummaryLineups(json);
    state.summaries.set(id, { stats, plays, h2h, lineups, t: Date.now() });
    const played = ev.status.kind === 'live' || ev.status.kind === 'post';
    const ok = !played || Object.keys(stats).length > 0;
    state.diag.summary = { t: Date.now(), ok, error: ok ? null : 'sem estatísticas' };
  } catch (err) {
    state.summaries.set(id, { ...cached, loading: false, t: Date.now() });
    state.diag.summary = { t: Date.now(), ok: false, error: errText(err) };
  }
  if (state.sheet?.type === 'match' && state.sheet.id === id) safe('detalhe', renderSheet, el.sheetBody);
}

// Técnico dos dois times (a ESPN não traz; vem da Wikipédia e do Wikidata), guardado por meio dia.
// O detalhe do jogo é redesenhado quando chega.
async function loadCoaches(ev) {
  const now = Date.now();
  const ids = [ev.home.id, ev.away.id].filter((id) => {
    const c = state.coaches[id];
    return !(c && now - c.t < COACH_MS) && now - (state.coachTry[id] || 0) > COACH_RETRY_MS;
  });
  if (!ids.length) return;
  for (const id of ids) state.coachTry[id] = now;
  let got = {};
  try { got = await fetchCoaches(ids); } catch { return; }
  if (!Object.keys(got).length) return;
  for (const [id, c] of Object.entries(got)) state.coaches[id] = { c, t: Date.now() };
  save(COACH_KEY, state.coaches);
  const open = state.sheet?.type === 'match' ? findEvent(state.sheet.id) : null;
  if (open && ids.some((id) => playsIn(open, id))) safe('detalhe', renderSheet, el.sheetBody);
}

function saveCache() {
  try {
    const events = eventList().map((e) => ({ ...e, date: e.date.getTime() }));
    const json = JSON.stringify({
      t: Date.now(), year: new Date().getFullYear(), complete: state.seasonComplete, seasonT: state.seasonT, fullT: state.fullT,
      season: el.season.textContent, adjust: [...state.adjust], events,
    });
    if (json.length < 3e6) localStorage.setItem(keyOf(CACHE_KEY), json);
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

/**
 * Força de cada time no fim da temporada anterior, ponto de partida do modelo das chances e dos palpites
 * (quem subiu começa na força média dos que sobem). Uma leitura por ano, depois da temporada atual.
 */
// Com a temporada atual já carregada, busca a anterior (se ainda não tem e não tentou há pouco).
function maybePrior() {
  if (!state.prior && !state.priorLoading && state.seasonOk && Date.now() - state.priorTry > PRIOR_RETRY_MS) loadPrior();
}

async function loadPrior() {
  const year = new Date().getFullYear() - 1;
  state.priorTry = Date.now();
  state.priorLoading = true;
  try {
    const res = await espn.fetchSeason(year);
    const prior = res.failed.length ? null : priorFrom(res.events.map(espn.parseEvent));
    state.diag.prior = { t: Date.now(), year, count: res.events.length, failed: res.failed, teams: prior?.size || 0 };
    if (prior) {
      state.prior = prior;
      save(PRIOR_KEY, { year, teams: [...prior].map(([id, p]) => [id, +p.att.toFixed(4), +p.def.toFixed(4)]) });
      refresh();
    }
  } catch (err) {
    state.diag.prior = { t: Date.now(), year, error: errText(err) };
  } finally {
    state.priorLoading = false;
  }
}

async function tick({ warm = false } = {}) {
  clearTimeout(state.timer);
  if (state.loading) return;
  state.loading = true;
  el.refresh.classList.add('loading');
  const now = Date.now();
  if (seasonDue(now)) loadSeason();
  else maybePrior();
  loadCups();
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
    // Detalhe aberto: ao vivo, o resumo é refeito; antes do jogo, até a escalação sair (loadSummary decide).
    const open = state.sheet?.type === 'match' ? findEvent(state.sheet.id) : null;
    if (open?.status.kind === 'live') loadSummary(open.id, true);
    else if (open?.status.kind === 'pre') loadSummary(open.id);
  }
}

function schedule() {
  clearTimeout(state.timer);
  if (document.hidden) return;
  const now = Date.now();
  const hot = allEvents().some((e) => e.status.kind === 'live'
    || (e.status.kind === 'pre' && e.date - now < 10 * 60e3 && now - e.date < 3 * HOUR));
  state.timer = setTimeout(tick, state.failed || hot ? LIVE_MS : IDLE_MS);
}

// ---------- outras competições ----------
// Cada competição tem os seus jogos (a temporada inteira, numa chamada só, de 85 a 130 KB), guardados no
// celular, e é atualizada dia a dia quando tem jogo rolando, como o Brasileirão.
const cupOf = (slug) => (state.cups[slug] ||= { events: new Map(), phases: [], phaseIdx: -1, pinned: null, t: 0, tried: 0, ok: false, loading: false, groups: null, groupsT: 0 });
const cupEvents = (slug) => [...(state.cups[slug]?.events.values() || [])];
// Todos os jogos de todas as competições (o Brasileirão primeiro).
const allEvents = () => [...eventList(), ...CUPS.flatMap((c) => cupEvents(c.slug))];
// Clubes da Série A deste ano (pelos jogos do Brasileirão).
function serieA() {
  const ids = new Set();
  for (const e of state.events.values()) { ids.add(e.home.id); ids.add(e.away.id); }
  return ids;
}

function findEvent(id) {
  const ev = state.events.get(id);
  if (ev) return ev;
  for (const c of Object.values(state.cups)) {
    const e = c.events.get(id);
    if (e) return e;
  }
  return null;
}

const compName = (ev) => (ev?.comp ? compOf(ev.comp)?.name || '' : 'Brasileirão');
// "Copa do Brasil · Semifinal, ida"
function cupLabel(ev, withComp = true) {
  const comp = compOf(ev.comp);
  const phase = phaseLabel(ev.phase, comp);
  const leg = ev.leg === 1 ? ', ida' : ev.leg === 2 ? ', volta' : '';
  return withComp && comp ? `${comp.name} · ${phase}${leg}` : `${phase}${leg}`;
}

// Gol só avisa em jogo de clube da Série A (a Libertadores tem jogos só de estrangeiros).
function addCupEvent(slug, ev, t0, quiet = false) {
  const prev = state.fetchedAt.get(ev.id) || 0;
  if (prev > t0) return;
  state.fetchedAt.set(ev.id, t0);
  ev.comp = slug;
  for (const t of [ev.home, ev.away]) {
    if (t.logo) state.logos.set(t.id, t.logo);
    else t.logo = state.logos.get(t.id) || '';
  }
  const ours = involves(ev, serieA());
  if (quiet || !ours || t0 - prev > ALERT_GAP_MS) state.scores.set(ev.id, { h: ev.home.score ?? 0, a: ev.away.score ?? 0, kind: ev.status.kind });
  else detectGoal(ev);
  cupOf(slug).events.set(ev.id, ev);
}

function ingestCup(slug, list, t0, quiet = false) {
  const ids = new Set();
  for (const raw of list || []) {
    let ev;
    try { ev = espn.parseEvent(raw); } catch { continue; }
    ids.add(ev.id);
    addCupEvent(slug, ev, t0, quiet);
  }
  return ids;
}

// Guardado no celular enxuto (o app do Brasileirão divide o mesmo espaço): sem cores, sem cartões amarelos,
// das estatísticas só os chutes no gol (que o modelo usa) e os escudos num mapa à parte.
const slimSide = ({ stats, color, color2, abbr, logo, ...rest }) => ({ ...rest, stats: stats?.shotsOnTarget != null ? { shotsOnTarget: stats.shotsOnTarget } : {} });
function saveCup(slug) {
  const c = state.cups[slug];
  if (!c) return;
  try {
    const logos = {};
    const events = [...c.events.values()].map((e) => {
      for (const t of [e.home, e.away]) if (t.logo) logos[t.id] = t.logo;
      return { ...e, date: e.date.getTime(), home: slimSide(e.home), away: slimSide(e.away), incidents: e.incidents.filter((i) => i.kind !== 'yellow') };
    });
    localStorage.setItem(keyOf(CUP_KEY(slug)), JSON.stringify({ year: new Date().getFullYear(), t: c.t, logos, events }));
  } catch { /* sem espaço: segue sem guardar esta competição */ }
}

function loadCupCaches() {
  const year = new Date().getFullYear();
  for (const comp of CUPS) {
    const c = store(CUP_KEY(comp.slug), null);
    if (!c || c.year !== year || !Array.isArray(c.events)) continue;
    for (const [id, url] of Object.entries(c.logos || {})) if (!state.logos.has(id)) state.logos.set(id, url);
    for (const e of c.events) addCupEvent(comp.slug, { ...e, date: new Date(e.date) }, c.t, true);
    cupOf(comp.slug).t = c.t;
  }
}

// Temporada de novo: a cada 30 min com jogo nos próximos 3 dias, a cada 12 h sem; falhou, tenta em 2 min.
function cupDue(slug, now) {
  const c = cupOf(slug);
  if (c.loading) return false;
  if (!c.ok && c.tried && now - c.tried < SEASON_RETRY_MS) return false;
  const near = cupEvents(slug).some((e) => e.status.kind !== 'post' && Math.abs(e.date - now) < 3 * 24 * HOUR);
  return !c.ok || now - c.t > (near ? CUP_MS : CUP_IDLE_MS);
}

let cupsLoading = false;
async function loadCups() {
  if (cupsLoading) return;
  const now = Date.now();
  const due = CUPS.filter((c) => cupDue(c.slug, now));
  if (!due.length) return;
  cupsLoading = true;
  try {
    // Duas por vez, para não disputar a rede com o placar ao vivo.
    for (let i = 0; i < due.length; i += 2) await Promise.all(due.slice(i, i + 2).map((c) => loadCup(c.slug)));
  } finally {
    cupsLoading = false;
    refresh();
    maybeContPast();
  }
}

async function loadCup(slug) {
  const c = cupOf(slug);
  const t0 = Date.now();
  c.loading = true;
  c.tried = t0;
  try {
    const json = await espn.fetchCompYear(slug, new Date(t0).getFullYear());
    const first = !c.t;
    const ids = ingestCup(slug, json?.events, t0, first);
    // O que a ESPN tirou da lista some daqui também.
    for (const [id] of c.events) if (!ids.has(id) && (state.fetchedAt.get(id) || 0) <= t0) c.events.delete(id);
    c.t = t0;
    c.ok = true;
    state.diag.cups[slug] = { t: Date.now(), ok: true, count: ids.size };
    saveCup(slug);
  } catch (err) {
    c.ok = false;
    state.diag.cups[slug] = { t: Date.now(), ok: false, error: errText(err) };
  } finally {
    c.loading = false;
  }
}

// Dias a buscar de cada competição: o de hoje, se tem jogo por terminar, e o de cada jogo ao vivo.
// De tempos em tempos (warm), também ontem e amanhã, se tiver jogo da competição.
function cupDays(warm, t0) {
  const out = new Map();
  const today = new Date(t0);
  const days = warm ? [addDays(today, -1), today, addDays(today, 1)] : [today];
  for (const comp of CUPS) {
    for (const e of cupEvents(comp.slug)) {
      const soon = e.status.kind === 'pre' && e.date - t0 < 15 * 60e3 && t0 - e.date < 3 * HOUR;
      const day = e.status.kind === 'live' || soon ? e.date : days.find((d) => sameDay(d, e.date) && (warm || e.status.kind !== 'post'));
      if (day) out.set(`${comp.slug}|${ymd(day)}`, [comp.slug, day]);
    }
  }
  return [...out.values()].slice(0, 8);
}

async function refreshCupsHot(warm, t0) {
  const list = cupDays(warm, t0);
  const res = await Promise.allSettled(list.map(([slug, d]) => espn.fetchCompDay(slug, d)));
  res.forEach((r, i) => { if (r.status === 'fulfilled') ingestCup(list[i][0], r.value?.events, t0); });
  if (list.length && Date.now() - state.lastCache > 5 * 60e3) for (const slug of new Set(list.map((x) => x[0]))) saveCup(slug);
}

// Grupos ou tabela (Libertadores, Sul-Americana, estaduais), da ESPN, quando a aba Tabela é aberta.
async function loadGroups(slug) {
  const c = cupOf(slug);
  if (c.groupsLoading || (c.groups && Date.now() - c.groupsT < GROUPS_MS)) return;
  c.groupsLoading = true;
  try {
    c.groups = espn.parseGroups(await espn.fetchCompStandings(slug, new Date().getFullYear()));
    for (const g of c.groups) for (const t of g.rows) if (t.logo) state.logos.set(t.id, t.logo);
  } catch { c.groups = c.groups || []; }
  c.groupsT = Date.now();
  c.groupsLoading = false;
  if (state.comp === slug) safe('a competição', renderComp, el.viewComp);
}

// Força dos estrangeiros: jogos da Libertadores e da Sul-Americana do ano anterior (os deste ano já estão
// carregados), lidos uma vez por ano e guardados no celular.
const CONT = ['conmebol.libertadores', 'conmebol.sudamericana'];
function contCached(year) {
  const c = store(CONT_KEY, null);
  return c?.year === year && Array.isArray(c.events) ? c.events.map((e) => ({ ...e, date: new Date(e.date) })) : null;
}
state.contPast = contCached(new Date().getFullYear() - 1);

function maybeContPast() {
  if (state.contPast || Date.now() - state.contTry < PRIOR_RETRY_MS) return;
  // Só vale a leitura se um clube da Série A ainda está vivo no mata-mata de uma delas.
  const ours = serieA();
  const alive = CONT.some((slug) => cupEvents(slug).some((e) => e.status.kind !== 'post' && involves(e, ours)));
  if (alive) loadContPast();
}

async function loadContPast() {
  state.contTry = Date.now();
  const year = new Date().getFullYear() - 1;
  try {
    const res = await Promise.all(CONT.map((slug) => espn.fetchCompYear(slug, year)));
    const events = res.flatMap((j) => (j?.events || []).map((raw) => { try { return espn.parseEvent(raw); } catch { return null; } }))
      .filter((e) => e && e.status.kind === 'post' && e.home.score != null && e.away.score != null)
      .map((e) => ({
        id: e.id, date: e.date, status: { kind: 'post' },
        home: { id: e.home.id, score: e.home.score, sot: e.home.stats?.shotsOnTarget ?? null },
        away: { id: e.away.id, score: e.away.score, sot: e.away.stats?.shotsOnTarget ?? null },
      }));
    if (events.length < 100) return;
    state.contPast = events;
    save(CONT_KEY, { year, events: events.map((e) => ({ ...e, date: +e.date })) });
    state.cupOdds.clear();
    render();
  } catch { /* tenta de novo mais tarde */ }
}

// Gols esperados de um jogo pelo modelo (em campo neutro: a média de jogar em casa e fora). Null sem força.
const lambdaOf = (m) => (h, a, neutral) => {
  if (!m?.att.has(h) || !m.att.has(a)) return null;
  const [x1, y1] = expectedGoals(m, h, a);
  if (!neutral) return [x1, y1];
  const [y2, x2] = expectedGoals(m, a, h);
  return [Math.sqrt(x1 * x2), Math.sqrt(y1 * y2)];
};

/**
 * Modelo de força para uma competição: o do Brasileirão (clubes da Série A); na Libertadores e na
 * Sul-Americana, um ajuste conjunto com os jogos continentais deste ano e do anterior, que dá força aos
 * estrangeiros (partindo de ataque 0,8 e defesa 1,2, abaixo da média brasileira).
 */
let contMemo = { key: '', m: null };
function cupModel(slug) {
  if (!state.table) return null;
  if (compOf(slug)?.kind !== 'continental') return currentModel();
  if (!state.contPast) return null;
  const games = [...eventList(), ...CONT.flatMap((c) => cupEvents(c)), ...state.contPast];
  // Refeito só quando entra jogo encerrado ou chega a força da temporada anterior.
  const key = `${games.filter((e) => e.status.kind === 'post').length}|${!!state.prior}`;
  if (contMemo.key === key) return contMemo.m;
  const ids = new Set(games.flatMap((e) => [e.home.id, e.away.id]));
  const ours = serieA();
  const prior = new Map([...ids].map((id) => [id, ours.has(id) ? state.prior?.get(id) || (state.prior ? PROMOTED : { att: 1, def: 1 }) : FOREIGN]));
  contMemo = { key, m: model(new Map([...ids].map((id) => [id, { id }])), games, prior) };
  return contMemo.m;
}

// Chances do mata-mata da competição, refeitas só quando algum jogo muda.
function cupOddsOf(slug) {
  const c = state.cups[slug];
  if (!c?.phases.length) return null;
  const sig = [cupEvents(slug).map((e) => `${e.id}:${e.status.kind}:${e.home.score}-${e.away.score}@${e.status.label}`).join(','),
    eventList().filter((e) => e.status.kind === 'post').length, !!state.prior, !!state.contPast, !!state.table].join('|');
  const hit = state.cupOdds.get(slug);
  if (hit?.sig === sig) return hit.res;
  let res = null;
  try {
    const m = cupModel(slug);
    if (m) res = knockoutOdds({ phases: c.phases, comp: compOf(slug), lambda: lambdaOf(m), runs: CUP_RUNS, seed: 5 });
  } catch (err) {
    state.diag.errors.push({ part: 'chances do mata-mata', error: errText(err), t: Date.now() });
  }
  state.cupOdds.set(slug, { sig, res });
  return res;
}

// Palpite de um jogo de outra competição (só com a força dos dois times conhecida).
function cupPicks(ev) {
  if (ev.status.kind !== 'pre' && ev.status.kind !== 'live') return null;
  const m = cupModel(ev.comp);
  return m?.att.has(ev.home.id) && m.att.has(ev.away.id) ? matchPicks(m, ev) : null;
}

function deriveCups() {
  for (const comp of CUPS) {
    const c = state.cups[comp.slug];
    if (!c) continue;
    c.phases = phasesOf(cupEvents(comp.slug), comp);
    let idx = c.pinned ? c.phases.findIndex((p) => p.slug === c.pinned) : -1;
    if (idx < 0) { c.pinned = null; idx = pickPhase(c.phases); }
    c.phaseIdx = idx;
  }
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

// A data entra como número (no modelo, jogo antigo pesa menos), com os chutes no gol de cada time.
const compactEvent = (e) => ({
  id: e.id,
  date: e.date.getTime(),
  home: { id: e.home.id, score: e.home.score, sot: e.home.stats?.shotsOnTarget ?? null },
  away: { id: e.away.id, score: e.away.score, sot: e.away.stats?.shotsOnTarget ?? null },
  status: { kind: e.status.kind, label: e.status.label, half: !!e.status.half },
});

// Manda a conta para o worker; sem worker (ou se ele falhar), faz aqui mesmo.
function inWorker(input, local) {
  if (!worker) return Promise.resolve(local());
  return new Promise((resolve) => {
    const id = ++workerSeq;
    pendingOdds.set(id, (result) => resolve(result === undefined ? local() : result));
    worker.postMessage({ id, ...input });
  });
}

function runOdds(finished, events, overrides) {
  const input = { kind: 'odds', finished: [...finished.values()], events: events.map(compactEvent), overrides, zones: { g: state.zones.g, zStart: state.zones.zStart }, runs: ODDS_RUNS, prior: priorList() };
  return inWorker(input, () => {
    const out = chances({ ...input, finished, prior: state.prior });
    return out ? { byId: [...out.byId], runs: out.runs, left: out.left } : null;
  });
}

const priorList = () => (state.prior ? [...state.prior] : null);

let oddsToken = 0;
const asOdds = (r) => (r ? { byId: new Map(r.byId), runs: r.runs, left: r.left } : null);

function scheduleOdds(delay = 30) {
  const t = state.table;
  if (!t || t.mode !== 'jogos') { state.odds = null; state.oddsBase = null; state.oddsSig = ''; return; }
  const list = eventList();
  const live = list.filter((e) => e.status.kind === 'live').map((e) => `${e.id}:${e.home.score}-${e.away.score}@${e.status.label}`).join(',');
  const done = list.filter((e) => e.status.kind === 'post').length;
  const baseSig = `${done}|${live}|${state.zones.g}|${state.zones.zStart}|${state.prior ? 'p' : ''}`;
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

// Secador: contas da rodada vista para o time do torcedor e os rivais (só a rodada atual e as próximas).
let secadorToken = 0;
function scheduleSecador() {
  const t = state.table;
  const r = state.rounds[state.roundIdx];
  if (!state.secadorOn || !state.favorite || !t || t.mode !== 'jogos' || !r || state.roundIdx < state.focusIdx) return;
  const team = allTeams().find((x) => x.id === state.favorite);
  if (!team) return;
  const teamIds = [team.id, ...[...rivalsOf(team, allTeams(), state.rivals)].sort()];
  const list = eventList();
  const live = list.filter((e) => e.status.kind === 'live').map((e) => `${e.id}:${e.home.score}-${e.away.score}@${e.status.label}`).join(',');
  const done = list.filter((e) => e.status.kind === 'post').length;
  const sig = `${r.number}|${teamIds.join(',')}|${done}|${live}|${state.zones.g}|${state.zones.zStart}|${state.prior ? 'p' : ''}`;
  if (sig === state.secadorSig) return;
  state.secadorSig = sig;
  const token = ++secadorToken;
  const round = r.number;
  const input = {
    kind: 'secador', finished: [...t.finished.values()], events: list.map(compactEvent), zones: { g: state.zones.g, zStart: state.zones.zStart },
    targets: r.events.filter((e) => e.status.kind !== 'off').map((e) => e.id), teamIds, runs: SECADOR_RUNS, prior: priorList(),
  };
  const local = () => secador({ ...input, finished: t.finished, prior: state.prior });
  // Um worker antigo (do cache do navegador) responderia em outro formato: confere antes de usar.
  inWorker(input, local)
    .then((res) => (res === null || res?.teams?.[team.id] ? res : local()))
    .then((res) => {
      if (token !== secadorToken) return;
      // Sem as contas (temporada que não fecha), o secador avisa e espera.
      state.secador = res ? { ...res, round, teamId: team.id } : { round, teamId: team.id, teams: {}, failed: true };
      safe('os jogos', renderGames, el.matches);
    })
    .catch((err) => { state.diag.errors.push({ part: 'secador', error: errText(err), t: Date.now() }); });
}

// O que o secador mostra na rodada r: o cartão e a linha de cada jogo.
function secadorView(r) {
  const teams = allTeams();
  const team = teams.find((t) => t.id === state.favorite);
  if (!team) return null;
  if (!state.secadorOn) return { on: false, team };
  const rivals = rivalsOf(team, teams, state.rivals);
  const rivalNames = teams.filter((t) => rivals.has(t.id)).map((t) => t.name).sort((a, b) => a.localeCompare(b, 'pt-BR'));
  if (state.roundIdx < state.focusIdx) return { on: true, team, rivals: rivalNames, past: true };
  const got = state.secador?.round === r.number && state.secador.teamId === team.id ? state.secador : null;
  const mine = got?.teams?.[team.id] || null;
  const objective = mine ? objectiveFor(mine.base, state.zones) : null;
  const odds = new Map((mine?.games || []).map((g) => [g.id, g]));
  // O conselho de um jogo fica fixo quando ele começa: durante a partida o secador só acompanha se
  // está dando certo (recalcular a cada gol faria a linha mudar ou sumir no meio do jogo).
  const key = `${r.number}|${team.id}|${[...rivals].sort().join(',')}|${objective}`;
  if (state.secFrozen.key !== key) state.secFrozen = { key, byId: new Map() };
  const frozen = state.secFrozen.byId;
  const verdicts = pick(r.events.map((ev) => {
    if (!mine) return { ev, v: null };
    const before = frozen.get(ev.id);
    if (ev.status.kind !== 'pre' && before) return { ev, v: { ...restate(ev, before), keep: before.shown } };
    const stakes = new Map();
    for (const id of rivals) {
      const st = stakeOf(got?.teams?.[id], ev, id, state.zones);
      if (st) stakes.set(id, st);
    }
    return { ev, v: verdict(ev, { team, rivals, objective, odds: odds.get(ev.id), stakes }) };
  }));
  // Guarda o conselho de cada jogo: o dos que vão começar é refeito a cada conta; o dos que já
  // começaram fica o da primeira vez em que foi visto (e é salvo, para valer depois de recarregar).
  let fixed = false;
  for (const { ev, v } of verdicts) {
    if (!v || (ev.status.kind !== 'pre' && frozen.has(ev.id))) continue;
    frozen.set(ev.id, v);
    if (ev.status.kind !== 'pre') fixed = true;
  }
  if (fixed) saveAdvice();
  const ready = state.table?.mode === 'jogos' && !got?.failed;
  const summary = secadorSummary({ team, objective, base: mine?.base || null, verdicts, zones: state.zones, ready, rivals: rivals.size });
  // Jogo sem linha ganha só um aviso discreto, para ficar claro que o secador olhou o jogo
  // (a v2 ainda apaga um pouco os que não importam).
  const lines = new Map();
  for (const { ev, v } of verdicts) {
    if (!v) continue;
    if (v.shown) lines.set(ev.id, { kind: v.kind, good: v.state === 'ok', ...verdictText(ev, v, { objective, zones: state.zones }) });
    else if (v.kind === 'mine') lines.set(ev.id, { kind: 'mine' });
    else lines.set(ev.id, { kind: 'none', quiet: v.kind === 'none' ? 'Tanto faz pra você' : 'Pesa pouco pra você' });
  }
  return { on: true, team, rivals: rivalNames, summary, lines };
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
  safe('as competições', deriveCups);
  render();
}

function render() {
  safe('o secador', scheduleSecador);
  safe('o topo', renderHeader);
  safe('os campeonatos', renderComps, el.viewComp);
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
    if (el.secador) el.secador.innerHTML = '';
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
  let sec = null;
  safe('o secador', () => {
    sec = state.favorite ? secadorView(r) : null;
    state.secLines = sec?.lines || null;
    if (el.secador) el.secador.innerHTML = sec ? ui.secadorCard(sec) : '';
  }, el.secador);
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
  const card = (ev, note) => ui.matchCard(ev, { ...ctxBase, flash: takeFlash(ev.id), story: matchStory(ev, isFocus ? preRank : null), note, secador: note ? null : sec?.lines?.get(ev.id) || null });

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
    // A rodada só acabou para o simulador quando todos os jogos terminaram (adiado ainda vai ser jogado).
    finished: r.events.every((e) => e.status.kind === 'post'),
    postponed: postponedElsewhere(r).map((e) => ({ ev: e, label: roundName(state.roundOf.get(e.id)) })),
    picksOf: (e) => (m && e.status.kind !== 'post' ? matchPicks(m, e) : null),
    open: state.open,
  });
}

// Jogos adiados ainda sem data que são de outras rodadas: aparecem no simulador de qualquer rodada,
// para quem quer simular o campeonato até o fim não ficar com um jogo faltando.
function postponedElsewhere(r) {
  return sortEvents(eventList()).filter((e) => e.status.kind === 'off' && !r.events.includes(e) && state.roundOf.has(e.id));
}

// Gols por jogo no campeonato, com os jogos encerrados (só com a temporada completa).
function seasonAverage() {
  if (state.table?.mode !== 'jogos') return null;
  let goals = 0;
  let games = 0;
  for (const r of state.table.finished.values()) { goals += r.gf; games += r.gp; }
  return games >= 40 ? goals / (games / 2) : null;
}

// Modelo de força dos times com os jogos encerrados até agora (e a temporada anterior, quando já veio).
function currentModel() {
  return model(state.table?.finished || new Map(), eventList(), state.prior);
}

function renderStats() {
  const r = state.rounds[state.roundIdx];
  if (!r) { el.stats.innerHTML = ''; return; }
  el.stats.innerHTML = ui.statsView({ roundLabel: roundName(r), st: roundStats(r), trends: state.trends, selectedBar: state.selectedBar, seasonAvg: seasonAverage(), open: !isFinished(r) });
}

// ---------- competições na tela ----------
// Botões de campeonato no topo: Hoje, Brasileirão e as competições com jogos no ano (ponto vermelho: ao vivo).
function navItems() {
  const ours = serieA();
  const live = (list) => list.some((e) => e.status.kind === 'live');
  const items = [
    { id: 'hoje', label: 'Hoje', live: live(allEvents().filter((e) => !e.comp || involves(e, ours))) },
    { id: 'bra.1', label: 'Brasileirão', live: live(eventList()) },
  ];
  for (const comp of CUPS) {
    const list = cupEvents(comp.slug);
    if (list.length) items.push({ id: comp.slug, label: comp.name, live: live(list.filter((e) => involves(e, ours))) });
  }
  return items;
}

function renderComps() {
  const comp = state.comp;
  // Mantém a rolagem da linha de campeonatos entre as atualizações; ao trocar, mostra o escolhido.
  const x = el.comps.scrollLeft;
  el.comps.innerHTML = ui.compNav(navItems(), comp);
  el.comps.scrollLeft = x;
  if (state.compShown !== comp) {
    state.compShown = comp;
    el.comps.querySelector('.comp-chip.on')?.scrollIntoView({ block: 'nearest', inline: 'center' });
  }
  const bra = comp === 'bra.1';
  el.tabsBar.hidden = !bra;
  el.viewComp.hidden = bra;
  if (bra) {
    el.league.textContent = 'Brasileirão';
    showTab(state.tab);
    return;
  }
  el.views.forEach((v) => { v.hidden = true; });
  el.league.textContent = comp === 'hoje' ? 'Campeonatos' : compOf(comp)?.name || '';
  renderCompHeader();
  safe('a competição', renderComp, el.viewComp);
}

// Topo fora do Brasileirão: o dia (em Hoje) ou a fase da competição, com as setas para trocar.
function renderCompHeader() {
  const now = new Date();
  if (state.comp === 'hoje') {
    const d = addDays(now, state.day);
    el.roundName.textContent = state.day === 0 ? 'Hoje' : state.day === 1 ? 'Amanhã' : state.day === -1 ? 'Ontem' : shortDay(d);
    el.roundDates.textContent = `${dayLabel(d, now).replace(/^(Hoje|Ontem|Amanhã), /, '')} · jogos dos clubes da Série A`;
    el.prev.disabled = state.day <= -60;
    el.next.disabled = state.day >= 60;
    return;
  }
  const c = state.cups[state.comp];
  const p = c?.phases[c.phaseIdx];
  el.roundName.textContent = p ? p.label : compOf(state.comp)?.name || '';
  el.roundDates.textContent = p ? (sameDay(p.first, p.last) ? shortDay(p.first) : `${shortDay(p.first)} a ${shortDay(p.last)}`) : ' ';
  el.prev.disabled = !p || c.phaseIdx <= 0;
  el.next.disabled = !p || c.phaseIdx >= c.phases.length - 1;
}

function renderComp() {
  el.viewComp.innerHTML = state.comp === 'hoje' ? hojeHtml() : cupHtml(state.comp);
}

// Cartão de jogo de qualquer competição (fora do Brasileirão, sem posição na tabela).
function anyCard(ev, note) {
  return ui.matchCard(ev, {
    rank: ev.comp ? () => null : liveRank,
    delta: () => 0,
    favorite: state.favorite,
    flash: takeFlash(ev.id),
    story: null,
    note: note ?? (ev.comp ? cupLabel(ev, false) : roundName(state.roundOf.get(ev.id))),
    secador: null,
  });
}

// Hoje: os jogos do dia dos clubes da Série A, de todas as competições, agrupados por campeonato.
function hojeHtml() {
  const now = new Date();
  const ours = serieA();
  const day = addDays(now, state.day);
  const show = (e) => !e.home.tbd && !e.away.tbd && (!e.comp || involves(e, ours));
  const list = sortEvents(allEvents()).filter((e) => show(e) && (sameDay(e.date, day) || (state.day === 0 && e.status.kind === 'live')));
  const groups = COMPS.map((comp) => ({ comp, events: list.filter((e) => (e.comp || 'bra.1') === comp.slug) })).filter((g) => g.events.length);
  if (!groups.length) {
    // Sem jogo no dia: atalhos para o dia com jogo mais perto, para frente e para trás.
    const days = [...new Set(allEvents().filter(show).map((e) => Math.round((new Date(e.date.getFullYear(), e.date.getMonth(), e.date.getDate()) - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 864e5)))];
    const after = days.filter((n) => n > state.day).sort((a, b) => a - b)[0];
    const before = days.filter((n) => n < state.day).sort((a, b) => b - a)[0];
    const jump = (n) => ({ n, label: dayLabel(addDays(now, n), now) });
    return ui.hojeEmpty({ loading: !state.lastOk, after: after != null ? jump(after) : null, before: before != null ? jump(before) : null });
  }
  const counts = { live: 0, post: 0, pre: 0, off: 0 };
  let goals = 0;
  for (const e of list) {
    counts[e.status.kind]++;
    if (e.status.kind === 'post' || e.status.kind === 'live') goals += (e.home.score ?? 0) + (e.away.score ?? 0);
  }
  return ui.hojeView({
    summary: ui.roundSummary({ total: list.length, counts, goals, loading: false }),
    groups: groups.map((g) => ({ key: g.comp.slug, title: g.comp.name, cards: g.events.map((e) => anyCard(e, e.comp ? [cupLabel(e, false), e.home.pens != null ? `pênaltis ${e.home.pens} x ${e.away.pens}` : ''].filter(Boolean).join(' · ') : roundName(state.roundOf.get(e.id)))) })),
  });
}

// Por que as chances do mata-mata não aparecem (ou null quando não há o que explicar).
function oddsWhy(slug, phase) {
  if (!phase?.knockout || tiesOf(phase.events).every((t) => t.done)) return null;
  if (!state.table) return 'As chances aparecem quando o Brasileirão terminar de carregar.';
  if (compOf(slug)?.kind === 'continental' && !state.contPast) { maybeContPast(); return 'Calculando a força dos times estrangeiros…'; }
  return 'Sem chances para esta fase: há times de outras divisões, sem força conhecida pelo modelo.';
}

// Uma competição: a fase escolhida (confrontos, no mata-mata; jogos por dia, nos grupos), ou a tabela.
function cupHtml(slug) {
  const comp = compOf(slug);
  const c = state.cups[slug];
  if (!c?.phases.length) return `<p class="empty">${c?.loading || !c ? 'Carregando os jogos…' : 'Nenhum jogo encontrado nesta competição.'}</p>`;
  const phase = c.phases[c.phaseIdx];
  const hasTable = c.phases.some((p) => !p.knockout);
  const tabs = hasTable ? ui.cupTabs(state.cupTab) : '';
  if (hasTable && state.cupTab === 'tabela') {
    loadGroups(slug);
    return tabs + ui.groupsView(c.groups, { favorite: state.favorite, ours: serieA(), loading: !c.groups });
  }
  const ours = serieA();
  const odds = cupOddsOf(slug);
  const openIdx = odds ? c.phases.indexOf(odds.phase) : -1;
  let body;
  if (phase.knockout) {
    const ties = tiesOf(phase.events);
    const lastFinal = c.phaseIdx === c.phases.length - 1 && /final/.test(phase.slug) && ties.length === 1;
    const mine = (t) => ours.has(t.a.id) || ours.has(t.b.id);
    const block = (t) => ui.tieBlock({
      tie: t,
      cards: t.legs.map((e) => anyCard(e, legNote(e))),
      p: openIdx === c.phaseIdx ? odds.ties.find((x) => x.key === t.key)?.p || null : null,
      // Final da competição (a última fase): quem vence é campeão.
      final: lastFinal,
    });
    // Continentais: os confrontos com clube brasileiro primeiro; os outros, recolhidos.
    const main = comp.kind === 'continental' ? ties.filter(mine) : ties;
    const rest = comp.kind === 'continental' ? ties.filter((t) => !mine(t)) : [];
    body = main.map(block).join('') + (rest.length ? ui.moreBlock(`Outros confrontos (${rest.length})`, rest.map(block).join(''), `outros-${slug}`, state.open) : '');
  } else {
    const list = comp.kind === 'continental' ? phase.events.filter((e) => involves(e, ours)) : phase.events;
    const days = [];
    for (const ev of list) {
      const last = days[days.length - 1];
      if (last && sameDay(last.date, ev.date)) last.events.push(ev);
      else days.push({ date: ev.date, events: [ev] });
    }
    body = ui.daySections(days.map((d) => ({ label: dayLabel(d.date, new Date()), events: d.events, cards: d.events.map((e) => anyCard(e, '')) })))
      + (comp.kind === 'continental' && list.length < phase.events.length ? `<p class="chart-note center">Mostrando só os jogos dos clubes da Série A (${list.length} de ${phase.events.length}).</p>` : '');
  }
  // As chances de título aparecem na fase em aberto, nas seguintes e na que acabou de terminar.
  const showOdds = odds && c.phaseIdx >= openIdx - 1;
  const chances = showOdds ? ui.titleOdds(odds, { favorite: state.favorite }) : (c.phaseIdx === c.phases.length - 1 || phase.knockout ? noteOr(oddsWhy(slug, phase)) : '');
  return tabs + chances + (body || '<p class="empty">Nenhum jogo nesta fase.</p>');
}
const noteOr = (text) => (text ? `<p class="chart-note">${esc(text)}</p>` : '');

// "Ida · dom 01/11", "Volta · pênaltis 5 x 3"
function legNote(e) {
  const parts = [e.leg === 1 ? 'Ida' : e.leg === 2 ? 'Volta' : ''];
  if (e.status.kind === 'pre' || e.status.kind === 'off') parts.push(shortDay(e.date));
  if (e.home.pens != null && e.away.pens != null) parts.push(`pênaltis ${e.home.pens} x ${e.away.pens}`);
  return parts.filter(Boolean).join(' · ');
}

// Detalhe de um jogo de outra competição: o mesmo do Brasileirão, sem tabela nem simulador.
function cupMatchSheet(ev, now) {
  const sum = state.summaries.get(ev.id);
  const stats = sum?.stats && Object.keys(sum.stats).length ? sum.stats : null;
  const flow = sum?.plays?.length && (ev.status.kind === 'live' || ev.status.kind === 'post') ? matchFlow(sum.plays, liveClock(ev)) : null;
  const all = allEvents();
  const phase = state.cups[ev.comp]?.phases.find((p) => p.slug === ev.phase);
  const tie = phase?.knockout ? tiesOf(phase.events).find((t) => t.legs.includes(ev)) : null;
  return ui.matchSheet(ev, {
    table: null, scen: null, stats,
    statsLoading: !!sum?.loading || (!sum && (ev.status.kind === 'live' || ev.status.kind === 'post')),
    formById: new Map([ev.home.id, ev.away.id].map((id) => [id, formOf(all, id)])),
    favorite: state.favorite, story: null, roundLabel: cupLabel(ev), now, zones: state.zones, inFocus: false,
    h2h: sum?.h2h || null,
    flow,
    reading: matchReading(ev, { plays: sum?.plays || null, stats, flow }),
    lineups: sum?.lineups || null,
    coaches: { home: coachOf(ev, ev.home), away: coachOf(ev, ev.away) },
    picks: cupPicks(ev),
    canSim: false,
    tieNote: tie ? ui.tieText(tie, { final: phase === state.cups[ev.comp]?.phases.at(-1) && /final/.test(phase.slug) && tiesOf(phase.events).length === 1 }) : '',
  });
}

function setComp(slug) {
  state.comp = slug;
  save(COMP_KEY, slug);
  const key = slug === 'hoje' ? '' : slug === 'bra.1' ? 'brasileirao' : compOf(slug)?.key || '';
  try { history.replaceState(null, '', key ? `#${key}` : location.pathname + location.search); } catch { /* sem histórico */ }
  render();
  window.scrollTo({ top: 0 });
  // Na volta ao app, a competição aberta é atualizada na hora.
  if (slug !== 'hoje' && slug !== 'bra.1' && cupDue(slug, Date.now())) loadCup(slug).then(refresh);
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
  if (spec.type === 'match') {
    loadSummary(spec.id);
    const ev = findEvent(spec.id);
    if (ev) loadCoaches(ev);
  }
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

function coachOf(ev, team) {
  const c = state.coaches[team.id]?.c;
  return coachFits(c, ev) ? c : null;
}

function renderSheet() {
  const spec = state.sheet;
  if (!spec) return;
  el.sheetBack.hidden = !state.sheetStack.length;
  const list = eventList();
  const now = new Date();
  let html = '';
  if (spec.type === 'match') {
    const ev = findEvent(spec.id);
    if (!ev) { closeSheet(); return; }
    if (ev.comp) { html = cupMatchSheet(ev, now); el.sheetBody.innerHTML = html; return; }
    const focus = focusRound();
    const inFocus = !!focus?.events.includes(ev);
    let scen = null;
    if (inFocus && state.table && (ev.status.kind === 'pre' || ev.status.kind === 'live')) {
      try { scen = scenarios(state.ctx, ev); } catch { scen = null; }
    }
    const sum = state.summaries.get(ev.id);
    const own = Object.keys(ev.home.stats).length ? { [ev.home.id]: ev.home.stats, [ev.away.id]: ev.away.stats } : null;
    const stats = sum?.stats && Object.keys(sum.stats).length ? sum.stats : own;
    const flow = sum?.plays?.length && (ev.status.kind === 'live' || ev.status.kind === 'post') ? matchFlow(sum.plays, liveClock(ev)) : null;
    html = ui.matchSheet(ev, {
      table: state.table, scen, stats,
      statsLoading: !!sum?.loading || (!sum && (ev.status.kind === 'live' || ev.status.kind === 'post')),
      formById: state.formById, favorite: state.favorite, story: matchStory(ev, inFocus ? preRank : null),
      roundLabel: roundName(state.roundOf.get(ev.id)), now, zones: state.zones, inFocus,
      h2h: sum?.h2h || null,
      flow,
      // Leitura do jogo: gols, lances que mudaram o jogo, quem manda e o momento.
      reading: matchReading(ev, { plays: sum?.plays || null, stats, flow }),
      // Escalações e substituições (resumo da ESPN) e o técnico de cada time, quando vale para este jogo.
      lineups: sum?.lineups || null,
      coaches: { home: coachOf(ev, ev.home), away: coachOf(ev, ev.away) },
      picks: state.table && (ev.status.kind === 'pre' || ev.status.kind === 'live') ? matchPicks(currentModel(), ev) : null,
    });
  } else if (spec.type === 'team') {
    const team = allTeams().find((t) => t.id === spec.id);
    if (!team) { closeSheet(); return; }
    // Próximos 5 jogos de todas as competições (o que está rolando primeiro); adiados ainda sem data vêm no fim.
    const mine = sortEvents(allEvents()).filter((e) => playsIn(e, spec.id) && !e.home.tbd && !e.away.tbd);
    const upcoming = [
      ...mine.filter((e) => e.status.kind === 'live' || (e.status.kind === 'pre' && e.date > now - 3 * HOUR)),
      ...mine.filter((e) => e.status.kind === 'off'),
    ].slice(0, 5);
    html = ui.teamSheet({
      team, row: state.table?.byId.get(spec.id), table: state.table, zones: state.zones,
      form: state.formById.get(spec.id) || formOf(list, spec.id), upcoming, favorite: state.favorite,
      odds: state.oddsBase?.byId.get(spec.id) || null,
      rankOf: liveRank, roundOf: (e) => (e.comp ? { tag: compOf(e.comp)?.name } : state.roundOf.get(e.id)),
      rivals: spec.id === state.favorite ? rivalsPanel(team) : null, open: state.open,
    });
  } else if (spec.type === 'picker') {
    html = ui.teamPicker(allTeams(), state.favorite);
  } else if (spec.type === 'diag') {
    html = ui.diagSheet({
      ...state.diag, events: state.events.size, rounds: state.rounds.length, roundsMethod: state.rounds.method, roundsWhy: state.rounds.why,
      focus: roundName(focusRound()), complete: state.complete, seasonComplete: state.seasonComplete, mode: state.table?.mode || null,
      odds: !!state.oddsBase, priorTeams: state.prior?.size || 0, check: state.check, adjust: state.adjust, names: new Map(allTeams().map((t) => [t.id, t.name])),
      cupsDiag: CUPS.map((c) => ({ name: c.name, ...(state.diag.cups[c.slug] || {}), cached: state.cups[c.slug]?.events.size || 0 })),
      contPast: state.contPast?.length || 0,
      ua: navigator.userAgent, modal: hasModal,
    });
  }
  el.sheetBody.innerHTML = html;
}

// Rivais do time escolhido, para a página do time: os do mesmo estado e os outros.
function rivalsPanel(team) {
  const teams = allTeams();
  const same = sameState(team, teams);
  const ids = new Set(same.map((t) => t.id));
  const others = teams.filter((t) => t.id !== team.id && !ids.has(t.id)).sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return { on: rivalsOf(team, teams, state.rivals), same, others, secadorOn: state.secadorOn };
}

function toggleRival(id) {
  const teams = allTeams();
  const team = teams.find((t) => t.id === state.favorite);
  if (!team || id === team.id) return;
  const set = rivalsOf(team, teams, state.rivals);
  if (set.has(id)) set.delete(id); else set.add(id);
  state.rivals = { ...state.rivals, [team.id]: [...set] };
  save(RIVALS_KEY, state.rivals);
  safe('o detalhe', renderSheet, el.sheetBody);
  safe('os jogos', renderGames, el.matches);
}

// ---------- avisos ----------
function toast(html, matchId, { action = null, ms = 6000 } = {}) {
  const t = document.createElement(matchId || action ? 'button' : 'div');
  t.className = 'toast';
  if (matchId || action) t.type = 'button';
  if (matchId) t.dataset.match = matchId;
  if (action) t.dataset.action = action;
  t.innerHTML = html;
  el.toasts.prepend(t);
  while (el.toasts.children.length > 3) el.toasts.lastChild.remove();
  setTimeout(() => t.classList.add('out'), ms);
  setTimeout(() => t.remove(), ms + 500);
}

// ---------- versão nova do app ----------
// O GitHub Pages marca todos os arquivos com a hora da publicação (Last-Modified). Quando o servidor tem
// uma publicação mais nova que a página aberta (comum no celular, onde a aba fica aberta por horas ou volta
// do cache ao reabrir), o app baixa os arquivos novos e recarrega, reabrindo o jogo ou time que estava na tela.
// Ao abrir o app ou voltar para ele, atualiza sozinho; com o app em uso, avisa e atualiza com um toque.
const BUILT = Date.parse(document.lastModified);
const VERSION_MS = 5 * 60e3;
const TRIED_KEY = keyOf('versao-tentada');
const REOPEN_KEY = keyOf('reabrir');
const session = {
  get(k) { try { return sessionStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { if (v == null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* sem sessão */ } },
};

async function checkVersion({ auto = false } = {}) {
  if (!Number.isFinite(BUILT) || state.update?.busy || Date.now() - (state.update?.t || 0) < 30e3) return;
  state.update = { t: Date.now() };
  let served = NaN;
  try {
    const res = await fetch(location.pathname, { method: 'HEAD', cache: 'no-store' });
    if (res.ok) served = Date.parse(res.headers.get('last-modified') || '');
  } catch { return; }
  // Mesma publicação, ou uma que já foi tentada nesta aba (servidor ainda entregando a antiga): nada a fazer.
  if (!Number.isFinite(served) || served - BUILT < 2000 || session.get(TRIED_KEY) === String(served)) return;
  state.update.served = served;
  if (auto) updateNow();
  else toast('<b class="tag tone-good">Novidade</b><span class="toast-body"><span>Saiu uma versão nova do app</span><small>Toque para atualizar</small></span>', null, { action: 'update', ms: 15000 });
}

async function updateNow() {
  if (!state.update?.served || state.update.busy) return;
  state.update.busy = true;
  session.set(TRIED_KEY, String(state.update.served));
  session.set(REOPEN_KEY, state.sheet ? JSON.stringify({ type: state.sheet.type, id: state.sheet.id }) : null);
  // Troca no cache do navegador os arquivos do app (inclusive os do cálculo em segundo plano) antes de recarregar.
  const files = new Set(performance.getEntriesByType('resource').map((r) => r.name)
    .filter((u) => u.startsWith(location.origin) && /\.(js|css|webmanifest)([?#]|$)/.test(u)));
  for (const f of ['odds-worker.js', 'sim.js']) files.add(new URL(f, import.meta.url).href);
  await Promise.all([...files].map((u) => fetch(u, { cache: 'reload' }).catch(() => null)));
  location.reload();
}

// Depois de atualizar: volta ao jogo ou time que estava aberto.
function reopenAfterUpdate() {
  const raw = session.get(REOPEN_KEY);
  if (!raw) return;
  session.set(REOPEN_KEY, null);
  try {
    const spec = JSON.parse(raw);
    if (spec?.type === 'match' && findEvent(spec.id)) openSheet(spec);
    else if (spec?.type === 'team') openSheet(spec);
  } catch { /* nada a reabrir */ }
}

function flushAlerts() {
  const alerts = state.alerts.splice(0);
  let celebrate = null;
  let goal = false;
  for (const a of alerts.slice(-4)) {
    const ev = findEvent(a.ev.id) || a.ev;
    const score = `${esc(ev.home.name)} <b>${ev.home.score} x ${ev.away.score}</b> ${esc(ev.away.name)}`;
    if (a.annulled) {
      toast(`<b class="tag tone-plain">Placar</b><span class="toast-body"><span>${score}</span><small>Gol retirado do placar (anulado ou corrigido)</small></span>`, ev.id);
      continue;
    }
    goal = true;
    for (const side of a.sides) {
      const team = ev[side];
      const g = lastGoal(ev, team);
      // Com o secador ligado, o aviso diz se a secada daquele jogo está dando certo.
      const sec = state.secLines?.get(ev.id);
      const secNote = sec?.state ? `<small class="toast-sec ${sec.good ? 'sec-ok' : 'sec-no'}">Secador: ${sec.good ? '✓' : '✗'} ${esc(sec.state.toLowerCase())}</small>` : '';
      toast(`<b class="tag tone-gol">Gol</b><span class="toast-body"><span>${score}</span><small>Gol ${esc(doo(team.name))}${g?.who ? ` · ${esc(g.who)} ${esc(g.min.label)}` : ''}</small>${secNote}</span>`, ev.id);
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
  if (state.comp === 'hoje') { state.day += delta; render(); return; }
  if (state.comp !== 'bra.1') {
    const c = state.cups[state.comp];
    const idx = (c?.phaseIdx ?? -1) + delta;
    if (!c || idx < 0 || idx >= c.phases.length) return;
    c.phaseIdx = idx;
    c.pinned = c.phases[idx].slug;
    render();
    return;
  }
  selectRound(state.roundIdx + delta);
  render();
  clearTimeout(goTimer);
  const r = state.rounds[state.roundIdx];
  if (r && !isFinished(r)) goTimer = setTimeout(() => tick({ warm: true }), 700);
}

function showTab(tab) {
  el.tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  el.views.forEach((v) => { v.hidden = v.dataset.tab !== tab; });
}

function setTab(tab) {
  state.tab = tab;
  showTab(tab);
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
  } else if (action === 'update') {
    updateNow();
  } else if (action === 'sim-reset') {
    delete state.sims[id];
    simChanged();
  } else if (action === 'sim-clear') {
    state.sims = {};
    simChanged();
  } else if (action === 'sim-suggest') {
    const r = state.rounds[state.roundIdx];
    const m = currentModel();
    for (const e of [...(r?.events || []), ...(r ? postponedElsewhere(r) : [])]) if (e.status.kind !== 'post') state.sims[e.id] = suggestScore(m, e);
    simChanged();
  } else if (action === 'simulate' && ev) {
    closeSheet();
    if (state.comp !== 'bra.1') setComp('bra.1');
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
  } else if (action === 'secador') {
    state.secadorOn = !state.secadorOn;
    save(SECADOR_KEY, state.secadorOn);
    safe('o secador', scheduleSecador);
    safe('os jogos', renderGames, el.matches);
  } else if (action === 'rival' && id) {
    toggleRival(id);
  } else if (action === 'comp' && id) {
    setComp(id);
  } else if (action === 'cup-tab' && id) {
    state.cupTab = id;
    safe('a competição', renderComp, el.viewComp);
  } else if (action === 'day-jump' && id) {
    state.day = Number(id);
    render();
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
  // Só os clubes da Série A têm página (estrangeiros e times de outras divisões não).
  if (team) { if (allTeams().some((t) => t.id === team.dataset.team)) openSheet({ type: 'team', id: team.dataset.team }); return; }
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
  checkVersion({ auto: true });
});
window.addEventListener('online', () => tick({ warm: true }));
setInterval(() => {
  if (document.hidden) return;
  safe('o topo', renderFreshness);
  if (Date.now() - (state.update?.t || 0) > VERSION_MS) checkVersion();
}, 5e3);

// Blocos recolhíveis (<details data-keep>) continuam abertos depois de cada atualização da tela.
document.addEventListener('toggle', (e) => {
  const key = e.target?.dataset?.keep;
  if (key) state.open[key] = e.target.open;
}, true);

const savedTab = store('aba', 'jogos');
setTab(['jogos', 'tabela', 'simular', 'numeros'].includes(savedTab) ? savedTab : 'jogos');
setSoundButton();
// Endereço com a competição (#libertadores) vale mais que a última aberta.
if (location.hash.length > 1) state.comp = compKeyToSlug(decodeURIComponent(location.hash.slice(1)));
// Com dados salvos, as rodadas são montadas antes de buscar (para saber quais dias atualizar),
// a busca começa e só então a tela é desenhada.
const cached = loadCache();
loadCupCaches();
if (cached) safe('a rodada', derive, el.matches);
safe('as competições', deriveCups);
tick({ warm: true }).then(reopenAfterUpdate);
render();
setTimeout(() => checkVersion({ auto: true }), 4e3);
