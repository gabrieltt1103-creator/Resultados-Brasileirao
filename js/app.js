import * as espn from './espn.js';
import { buildRounds, pickDefault, playsIn, roundName, sortEvents } from './rounds.js';
import { computeTable, formOf, scenarios, zonesFor } from './table.js';
import { headlines, matchStory, roundStats, trends } from './insights.js';
import * as bolao from './bolao.js';
import * as fx from './fx.js';
import * as ui from './ui.js';
import { HOUR, addDays, dayLabel, doo, esc, fmtClock, o, sameDay, save, shortDay, store, ymd } from './util.js';

const LIVE_MS = 30e3;          // com jogo rolando (ou prestes a começar)
const IDLE_MS = 120e3;         // sem jogo agora
const FULL_MS = 15 * 60e3;     // recarrega a janela inteira de jogos
const STANDINGS_MS = 5 * 60e3;
const SUMMARY_MS = 25e3;
const BACK_DAYS = 35;          // histórico para "últimos 5 jogos"
const AHEAD_DAYS = 10;
const FLASH_MS = 90e3;

const $ = (id) => document.getElementById(id);
const el = {
  season: $('season'), refresh: $('refresh'), pulse: $('pulse'), updated: $('updated'), sound: $('sound'),
  prev: $('prev'), next: $('next'), roundName: $('round-name'), roundDates: $('round-dates'),
  tabs: [...document.querySelectorAll('.tab')], views: [...document.querySelectorAll('[role="tabpanel"]')],
  fav: $('fav'), news: $('news'), summary: $('summary'), matches: $('matches'), share: $('share'),
  tableNote: $('table-note'), tableWrap: $('table-wrap'), legend: $('legend'), stats: $('stats'),
  error: $('error'), errorText: $('error-text'), retry: $('retry'),
  sheet: $('sheet'), sheetBody: $('sheet-body'), sheetBack: $('sheet-back'), toasts: $('toasts'),
};

const state = {
  events: new Map(),
  rounds: [],
  roundIdx: -1,
  focusIdx: -1,           // rodada em andamento: a tabela ao vivo vale para ela
  pinned: null,           // id de um jogo da rodada escolhida; null = seguir automático
  standings: [],
  table: null,
  zones: null,
  formById: new Map(),
  trends: null,
  scores: new Map(),
  flashes: new Map(),
  alerts: [],
  summaries: new Map(),
  lastFull: 0,
  lastStandings: 0,
  lastOk: 0,
  failed: false,
  loading: false,
  timer: 0,
  favorite: store('meu-time', null),
  hintOff: store('dica-time', false) === true,
  sheet: null,
  sheetStack: [],
  selectedBar: null,
};

const eventList = () => [...state.events.values()];
const focusRound = () => state.rounds[state.focusIdx];
const preRank = (id) => state.table?.preById.get(id)?.pos;
const liveRank = (id) => state.table?.byId.get(id)?.pos;

// ---------- dados ----------
function ingest(json) {
  const list = Array.isArray(json?.events) ? json.events : [];
  for (const raw of list) {
    let ev;
    try { ev = espn.parseEvent(raw); } catch { continue; }
    detectGoal(ev);
    const g = bolao.observe(ev);
    if (g) state.alerts.push({ type: 'bolao', ev, grade: g });
    state.events.set(ev.id, ev);
  }
  const year = espn.seasonYear(json);
  if (year) el.season.textContent = year;
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
  state.alerts.push({ type: 'goal', ev, sides });
}

function derive() {
  const list = eventList();
  state.rounds = buildRounds(list, state.standings);
  state.focusIdx = pickDefault(state.rounds);
  let idx = -1;
  if (state.pinned) idx = state.rounds.findIndex((r) => r.events.some((e) => e.id === state.pinned));
  if (idx < 0) { state.pinned = null; idx = state.focusIdx; }
  state.roundIdx = idx;
  state.zones = zonesFor(state.standings);
  state.table = computeTable(state.standings, focusRound(), list);
  state.formById = new Map(state.standings.map((t) => [t.id, formOf(list, t.id)]));
  state.trends = state.standings.length ? trends(list, state.standings) : null;
}

async function loadAll() {
  const today = new Date();
  const range = `${ymd(addDays(today, -BACK_DAYS))}-${ymd(addDays(today, AHEAD_DAYS))}`;
  const standings = loadStandings();
  let json;
  try {
    json = await espn.fetchScoreboard(range);
    if (!json?.events?.length) throw new Error('vazio');
  } catch {
    json = await espn.fetchScoreboard();
  }
  state.events.clear();
  ingest(json);
  await standings;
  state.lastFull = Date.now();
}

async function refreshRounds() {
  const rounds = [state.rounds[state.roundIdx], focusRound()].filter(Boolean);
  if (!rounds.length) return loadAll();
  const first = new Date(Math.min(...rounds.map((r) => r.first)));
  const last = new Date(Math.max(...rounds.map((r) => r.last)));
  const finished = () => eventList().filter((e) => e.status.kind === 'post').length;
  const before = finished();
  ingest(await espn.fetchScoreboard(`${ymd(addDays(first, -1))}-${ymd(addDays(last, 1))}`, 100));
  if (finished() !== before || Date.now() - state.lastStandings > STANDINGS_MS) await loadStandings();
}

async function loadStandings() {
  try {
    const rows = espn.parseStandings(await espn.fetchStandings());
    if (rows.length) state.standings = rows;
    state.lastStandings = Date.now();
  } catch { /* a tabela é complementar; os jogos seguem funcionando */ }
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
  } catch {
    state.summaries.set(id, { ...cached, loading: false, t: Date.now() });
  }
  if (state.sheet?.type === 'match' && state.sheet.id === id) renderSheet();
}

async function tick() {
  clearTimeout(state.timer);
  if (state.loading) return;
  state.loading = true;
  el.refresh.classList.add('loading');
  try {
    if (!state.rounds.length || Date.now() - state.lastFull > FULL_MS) await loadAll();
    else await refreshRounds();
    state.failed = false;
    state.lastOk = Date.now();
  } catch (err) {
    state.failed = true;
    console.warn('Falha ao atualizar', err);
  } finally {
    state.loading = false;
    el.refresh.classList.remove('loading');
    derive();
    render();
    schedule();
    if (state.sheet?.type === 'match' && state.events.get(state.sheet.id)?.status.kind === 'live') loadSummary(state.sheet.id, true);
  }
}

function schedule() {
  clearTimeout(state.timer);
  if (document.hidden) return;
  const now = Date.now();
  const hot = [state.rounds[state.roundIdx], focusRound()].some((r) => r?.events.some((e) => e.status.kind === 'live'
    || (e.status.kind === 'pre' && e.date - now < 10 * 60e3 && now - e.date < 3 * HOUR)));
  state.timer = setTimeout(tick, state.failed || hot ? LIVE_MS : IDLE_MS);
}

// ---------- tela ----------
function render() {
  const r = state.rounds[state.roundIdx];
  el.prev.disabled = state.roundIdx <= 0;
  el.next.disabled = state.roundIdx < 0 || state.roundIdx >= state.rounds.length - 1;
  if (r) {
    el.roundName.textContent = roundName(r);
    el.roundDates.textContent = sameDay(r.first, r.last) ? shortDay(r.first) : `${shortDay(r.first)} a ${shortDay(r.last)}`;
  }
  const anyLive = [r, focusRound()].some((x) => x?.events.some((e) => e.status.kind === 'live'));
  el.pulse.hidden = !anyLive;
  if (state.failed) el.updated.textContent = state.lastOk ? 'Sem conexão, tentando de novo' : 'Sem conexão';
  else if (state.lastOk) el.updated.textContent = fmtClock.format(state.lastOk);
  el.refresh.setAttribute('aria-label', `${anyLive ? 'Jogos ao vivo. ' : ''}Atualizado às ${el.updated.textContent}. Toque para atualizar agora.`);
  document.title = anyLive ? `● ${roundName(focusRound())} ao vivo` : 'Rodada ao Vivo';

  const empty = !state.events.size;
  el.error.hidden = !(state.failed && empty);
  if (state.failed && empty) {
    el.errorText.textContent = 'Não foi possível carregar os jogos. Confira sua conexão com a internet; o app tenta de novo a cada 30 segundos.';
    el.matches.innerHTML = '';
  }

  renderGames();
  renderTable();
  renderStats();
  renderSheet();
  flushAlerts();
}

function renderGames() {
  const r = state.rounds[state.roundIdx];
  if (!r) {
    el.summary.hidden = true;
    el.share.hidden = true;
    el.news.innerHTML = '';
    el.fav.innerHTML = '';
    if (!state.failed && state.lastOk) el.matches.innerHTML = '<p class="empty">Nenhum jogo do Brasileirão nos próximos dias.</p>';
    return;
  }
  const isFocus = state.roundIdx === state.focusIdx;
  el.fav.innerHTML = favoriteHtml();

  const news = headlines({ round: r, table: state.table, zones: state.zones, focus: isFocus, now: new Date() });
  const started = r.events.some((e) => e.status.kind === 'post' || e.status.kind === 'live');
  el.news.innerHTML = ui.newsCard(news, started ? 'Resumo da rodada' : 'Prévia da rodada');

  const counts = { live: 0, post: 0, pre: 0, off: 0 };
  let goals = 0;
  r.events.forEach((e) => {
    counts[e.status.kind]++;
    if (e.status.kind === 'post' || e.status.kind === 'live') goals += (e.home.score ?? 0) + (e.away.score ?? 0);
  });
  const parts = [];
  if (counts.live) parts.push(`<b class="live-count">${counts.live}</b> <span class="live-count">ao vivo</span>`);
  if (counts.post) parts.push(`<b>${counts.post}</b> ${counts.post === 1 ? 'encerrado' : 'encerrados'}`);
  if (counts.pre) parts.push(`<b>${counts.pre}</b> a seguir`);
  if (counts.off) parts.push(`<b>${counts.off}</b> ${counts.off === 1 ? 'adiado' : 'adiados'}`);
  if (counts.live || counts.post) parts.push(`<b>${goals}</b> ${goals === 1 ? 'gol' : 'gols'}`);
  el.summary.innerHTML = parts.join(' · ');
  el.summary.hidden = !parts.length;

  const ctxBase = {
    rank: liveRank,
    delta: (id) => (isFocus ? state.table?.byId.get(id)?.delta || 0 : 0),
    favorite: state.favorite,
  };
  const days = [];
  for (const ev of r.events) {
    const last = days[days.length - 1];
    if (last && sameDay(last.date, ev.date)) last.events.push(ev);
    else days.push({ date: ev.date, events: [ev] });
  }
  const now = new Date();
  el.matches.innerHTML = days.map((d) => `
    <section class="day">
      <h2 class="day-label">${esc(dayLabel(d.date, now))}</h2>
      ${d.events.map((ev) => ui.matchCard(ev, { ...ctxBase, flash: takeFlash(ev.id), pick: bolao.getPick(ev.id), story: matchStory(ev, preRank) })).join('')}
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

function favoriteHtml() {
  if (!state.standings.length) return '';
  const id = state.favorite;
  if (!id) return state.hintOff ? '' : ui.favoriteHint();
  const team = state.standings.find((t) => t.id === id);
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
    el.tableWrap.innerHTML = `<p class="empty">${state.lastOk ? 'Classificação indisponível no momento.' : 'Carregando classificação…'}</p>`;
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

function renderStats() {
  const r = state.rounds[state.roundIdx];
  if (!r) { el.stats.innerHTML = ''; return; }
  el.stats.innerHTML = ui.statsView({
    roundLabel: roundName(r),
    st: roundStats(r),
    trends: state.trends,
    bolao: bolao.totals(),
    bolaoRound: bolao.totals(new Set(r.events.map((e) => e.id))),
    selectedBar: state.selectedBar,
  });
}

// ---------- telas de detalhe ----------
function openSheet(spec) {
  if (state.sheet && !(state.sheet.type === spec.type && state.sheet.id === spec.id)) state.sheetStack.push(state.sheet);
  state.sheet = spec;
  renderSheet();
  if (!el.sheet.open) {
    el.sheet.showModal();
    el.sheet.append(el.toasts);
    document.documentElement.classList.add('sheet-open');
  }
  el.sheet.querySelector('.sheet-scroll').scrollTop = 0;
  if (spec.type === 'match') loadSummary(spec.id);
}

function closeSheet() {
  state.sheet = null;
  state.sheetStack = [];
  if (el.sheet.open) el.sheet.close();
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
    const inFocus = !!focus?.events.some((e) => e.id === ev.id);
    const scen = inFocus && state.table && (ev.status.kind === 'pre' || ev.status.kind === 'live')
      ? scenarios(state.standings, focus, list, ev) : null;
    const sum = state.summaries.get(ev.id);
    const own = Object.keys(ev.home.stats).length ? { [ev.home.id]: ev.home.stats, [ev.away.id]: ev.away.stats } : null;
    const stats = sum?.stats && Object.keys(sum.stats).length ? sum.stats : own;
    html = ui.matchSheet(ev, {
      table: state.table, scen, stats, statsLoading: !!sum?.loading || (!sum && (ev.status.kind === 'live' || ev.status.kind === 'post')),
      pick: bolao.getPick(ev.id), formById: state.formById, favorite: state.favorite,
      story: matchStory(ev, preRank), now,
    });
  } else if (spec.type === 'team') {
    const team = state.standings.find((t) => t.id === spec.id) || teamFromEvents(spec.id);
    if (!team) { closeSheet(); return; }
    const upcoming = sortEvents(list).find((e) => playsIn(e, spec.id)
      && (e.status.kind === 'live' || (e.status.kind === 'pre' && e.date > now - 3 * HOUR)));
    html = ui.teamSheet({
      team, row: state.table?.byId.get(spec.id), table: state.table, zones: state.zones,
      form: state.formById.get(spec.id) || formOf(list, spec.id), upcoming, favorite: state.favorite,
    });
  } else if (spec.type === 'picker') {
    html = ui.teamPicker(state.standings, state.favorite);
  }
  el.sheetBody.innerHTML = html;
}

function teamFromEvents(id) {
  for (const e of state.events.values()) {
    if (e.home.id === id) return e.home;
    if (e.away.id === id) return e.away;
  }
  return null;
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
    if (a.type === 'goal') {
      goal = true;
      for (const side of a.sides) {
        const team = ev[side];
        const g = [...ev.incidents].reverse().find((i) => i.kind === 'goal' && i.team === team.id);
        toast(`<b class="tag tone-gol">Gol</b><span class="toast-body"><span>${score}</span><small>Gol ${esc(doo(team.name))}${g?.who ? ` · ${esc(g.who)} ${esc(g.min.label)}` : ''}</small></span>`, ev.id);
        if (team.id === state.favorite) celebrate = [team.color, team.color2, '#f5c518'].filter(Boolean);
      }
    } else if (a.type === 'bolao') {
      const p = bolao.getPick(ev.id);
      toast(`<b class="tag tone-${a.grade.pts ? 'good' : 'plain'}">Bolão</b><span class="toast-body"><span>${esc(a.grade.label)}${a.grade.pts ? ` +${a.grade.pts}` : ''}</span><small>Palpite ${p.h} x ${p.a} · ${score}</small></span>`, ev.id);
      if (a.grade.kind === 'exato') celebrate ||= ['#f5c518', '#0b6b3a', '#ffffff'];
    }
  }
  if (goal) { fx.playGoal(); fx.buzz(); }
  if (celebrate) fx.confetti(celebrate.length > 1 ? celebrate : ['#f5c518', '#0b6b3a', '#ffffff']);
}

// ---------- interações ----------
function go(delta) {
  const idx = state.roundIdx + delta;
  if (idx < 0 || idx >= state.rounds.length) return;
  state.roundIdx = idx;
  state.pinned = idx === state.focusIdx ? null : state.rounds[idx].events[0].id;
  state.selectedBar = null;
  render();
  tick();
}

function setTab(tab) {
  el.tabs.forEach((b) => b.setAttribute('aria-selected', String(b.dataset.tab === tab)));
  el.views.forEach((v) => { v.hidden = v.dataset.tab !== tab; });
  save('aba', tab);
}

function setFavorite(id) {
  state.favorite = id;
  save('meu-time', id);
  const team = state.standings.find((t) => t.id === id);
  if (team) toast(`<b class="tag tone-good">Meu time</b><span class="toast-body"><span>Agora você acompanha ${esc(o(team.name))} de perto</span></span>`);
  render();
}

function handleAction(btn) {
  const { action, id } = btn.dataset;
  if (action === 'pick') {
    const ev = state.events.get(id);
    if (!ev) return;
    const cur = bolao.getPick(id) || { h: 0, a: 0 };
    const next = { h: cur.h, a: cur.a };
    next[btn.dataset.side] += Number(btn.dataset.delta);
    bolao.setPick(ev, next.h, next.a);
    renderGames();
    renderStats();
    renderSheet();
  } else if (action === 'unpick') {
    const ev = state.events.get(id);
    if (ev) bolao.clearPick(ev);
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
    renderGames();
  } else if (action === 'bar') {
    state.selectedBar = Number(btn.dataset.i);
    renderStats();
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
  if (act) { handleAction(act); return; }
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
  if (!state.sheet) closeSheet(); else { renderSheet(); if (state.sheet.type === 'match') loadSummary(state.sheet.id); }
});
el.sheet.addEventListener('click', (e) => { if (e.target === el.sheet) closeSheet(); });
el.sheet.addEventListener('close', () => {
  state.sheet = null;
  state.sheetStack = [];
  document.body.append(el.toasts);
  document.documentElement.classList.remove('sheet-open');
});

// Escudo que não carrega: tenta a imagem original e, se falhar, esconde.
document.addEventListener('error', (e) => {
  const img = e.target;
  if (!(img instanceof HTMLImageElement)) return;
  if (img.dataset.fallback && img.src !== img.dataset.fallback) { img.src = img.dataset.fallback; delete img.dataset.fallback; }
  else img.style.visibility = 'hidden';
}, true);

document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(state.timer); return; }
  if (Date.now() - state.lastOk > 15e3) tick(); else schedule();
});
window.addEventListener('online', () => tick());

setTab(['jogos', 'tabela', 'numeros'].includes(store('aba', 'jogos')) ? store('aba', 'jogos') : 'jogos');
setSoundButton();
tick();
