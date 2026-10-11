'use strict';

(() => {
  const SCOREBOARD = 'https://site.api.espn.com/apis/site/v2/sports/soccer/bra.1/scoreboard';
  const STANDINGS = 'https://site.api.espn.com/apis/v2/sports/soccer/bra.1/standings';

  const LIVE_MS = 30e3;           // com jogo rolando (ou prestes a começar)
  const IDLE_MS = 120e3;          // sem jogo agora
  const FULL_MS = 10 * 60e3;      // recarrega a janela inteira de rodadas
  const STANDINGS_MS = 5 * 60e3;
  const WINDOW_DAYS = 10;         // dias para trás e para frente
  const ROUND_GAP_MS = 36 * 3600e3;
  const FLASH_MS = 90e3;
  const HOUR = 3600e3;

  const $ = (id) => document.getElementById(id);
  const el = {
    season: $('season'), refresh: $('refresh'), pulse: $('pulse'), updated: $('updated'),
    prev: $('prev'), next: $('next'), roundName: $('round-name'), roundDates: $('round-dates'),
    tabJogos: $('tab-jogos'), tabTabela: $('tab-tabela'),
    viewJogos: $('view-jogos'), viewTabela: $('view-tabela'),
    summary: $('summary'), matches: $('matches'), tableWrap: $('table-wrap'), legend: $('legend'),
    error: $('error'), errorText: $('error-text'), retry: $('retry'),
  };

  const state = {
    events: new Map(),      // id -> jogo normalizado
    rounds: [],
    roundIdx: -1,
    pinned: null,           // id de um jogo da rodada escolhida pelo usuário; null = seguir automático
    standings: [],
    scores: new Map(),      // id -> {h, a} para detectar gol
    flashes: new Map(),     // id -> {sides: Set, until, fresh}
    lastFull: 0,
    lastStandings: 0,
    lastOk: 0,
    failed: false,
    loading: false,
    timer: 0,
  };

  // ---------- utilidades ----------
  const pad = (n) => String(n).padStart(2, '0');
  const ymd = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const fmtTime = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const fmtClock = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  const fmtWeekday = new Intl.DateTimeFormat('pt-BR', { weekday: 'long' });
  const fmtWeekdayShort = new Intl.DateTimeFormat('pt-BR', { weekday: 'short' });
  const dm = (d) => `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  const shortDay = (d) => `${fmtWeekdayShort.format(d).replace('.', '')} ${dm(d)}`;

  async function getJSON(url) {
    const res = await fetch(url, { cache: 'no-store' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
  }

  // Logos da ESPN vêm em 500px; o "combiner" entrega uma versão pequena.
  function crestUrl(url) {
    const m = /^https?:\/\/a\.espncdn\.com(\/i\/teamlogos\/[^?]+)$/.exec(url || '');
    return m ? `https://a.espncdn.com/combiner/i?img=${m[1]}&w=64&h=64` : url;
  }
  function crest(url, name) {
    if (!url) return `<span class="crest-fallback">${esc((name || '?').slice(0, 3).toUpperCase())}</span>`;
    return `<img class="crest" src="${esc(crestUrl(url))}" data-fallback="${esc(url)}" alt="" loading="lazy" decoding="async">`;
  }

  // ---------- normalização dos dados da ESPN ----------
  function parseStatus(st, date) {
    const t = st.type || {};
    const name = t.name || '';
    const phase = t.state || 'pre';
    if (/POSTPONED/.test(name)) return { kind: 'off', label: 'Adiado' };
    if (/CANCEL/.test(name)) return { kind: 'off', label: 'Cancelado' };
    if (/ABANDON|SUSPEND/.test(name)) return { kind: 'off', label: 'Suspenso' };
    if (phase === 'in') {
      if (/HALFTIME/.test(name)) return { kind: 'live', label: 'INT', note: 'Intervalo' };
      let clock = (st.displayClock || '').replace("'+", '+');
      if (!clock || clock === "0'") clock = t.shortDetail || 'Ao vivo';
      return { kind: 'live', label: clock, note: 'Ao vivo' };
    }
    if (phase === 'post') return t.completed === false ? { kind: 'off', label: t.shortDetail || 'Adiado' } : { kind: 'post', label: 'FIM' };
    return { kind: 'pre', label: fmtTime.format(date) };
  }

  function playerName(a) {
    return a?.shortName || a?.displayName || '';
  }

  function parseEvent(e) {
    const c = e.competitions?.[0] || {};
    const date = new Date(c.date || e.date);
    const comps = c.competitors || [];
    const side = (x) => ({
      id: String(x?.team?.id ?? x?.id ?? ''),
      name: x?.team?.shortDisplayName || x?.team?.displayName || x?.team?.name || '?',
      logo: x?.team?.logo || x?.team?.logos?.[0]?.href || '',
      score: x?.score == null || x.score === '' ? null : Number(x.score),
      winner: x?.winner === true,
    });
    const home = side(comps.find((x) => x.homeAway === 'home') || comps[0]);
    const away = side(comps.find((x) => x.homeAway === 'away') || comps[1]);
    const status = parseStatus(c.status || e.status || {}, date);

    const details = Array.isArray(c.details) ? c.details : [];
    let goals = details.filter((d) => d.scoringPlay).map((d) => ({
      team: String(d.team?.id ?? ''),
      min: d.clock?.displayValue || '',
      who: playerName(d.athletesInvolved?.[0]),
      pen: !!d.penaltyKick,
      og: !!d.ownGoal,
    }));
    // Gol contra: se a contagem não bate com o placar, o time do lance está do lado do jogador.
    const count = (gs, id) => gs.filter((g) => g.team === id).length;
    const fits = (gs) => count(gs, home.id) === (home.score ?? 0) && count(gs, away.id) === (away.score ?? 0);
    if (goals.some((g) => g.og) && !fits(goals)) {
      const flipped = goals.map((g) => (g.og ? { ...g, team: g.team === home.id ? away.id : home.id } : g));
      if (fits(flipped)) goals = flipped;
    }
    const reds = details.filter((d) => d.redCard).map((d) => String(d.team?.id ?? ''));

    return {
      id: String(e.id),
      date,
      status,
      home: { ...home, goals: goals.filter((g) => g.team === home.id), reds: count(reds.map((t) => ({ team: t })), home.id) },
      away: { ...away, goals: goals.filter((g) => g.team === away.id), reds: count(reds.map((t) => ({ team: t })), away.id) },
      venue: [c.venue?.fullName, c.venue?.address?.city].filter(Boolean).join(' · '),
      season: e.season?.year,
    };
  }

  function ingest(json) {
    const list = Array.isArray(json?.events) ? json.events : [];
    for (const raw of list) {
      let ev;
      try { ev = parseEvent(raw); } catch { continue; }
      detectGoal(ev);
      state.events.set(ev.id, ev);
    }
    const year = json?.leagues?.[0]?.season?.year || list[0]?.season?.year;
    if (year) el.season.textContent = year;
    return list.length;
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
    try { navigator.vibrate?.([120, 60, 120]); } catch { /* sem vibração */ }
  }

  // ---------- rodadas ----------
  // A ESPN não informa o número da rodada. Agrupamos jogos em sequência: uma rodada nova
  // começa quando há um intervalo longo ou quando um time já jogou no grupo atual.
  function buildRounds() {
    const list = [...state.events.values()].sort((a, b) => a.date - b.date || a.id.localeCompare(b.id));
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
    numberRounds(rounds, list);
    return rounds;
  }

  // Número da rodada estimado pelos jogos disputados de cada time na classificação.
  function numberRounds(rounds, list) {
    const gp = new Map(state.standings.map((t) => [t.id, t.gp]));
    if (!gp.size) return;
    const done = (e) => e.status.kind === 'post';
    for (const r of rounds) {
      const votes = new Map();
      for (const ev of r.events) {
        if (ev.status.kind === 'live' || ev.status.kind === 'off') continue;
        for (const t of [ev.home, ev.away]) {
          const played = gp.get(t.id);
          if (played == null) continue;
          const mine = list.filter((e) => e !== ev && (e.home.id === t.id || e.away.id === t.id));
          const laterDone = mine.filter((e) => e.date > ev.date && done(e)).length;
          const earlierPending = mine.filter((e) => e.date < ev.date && (e.status.kind === 'pre' || e.status.kind === 'live')).length;
          const n = played - laterDone + earlierPending + (done(ev) ? 0 : 1);
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

  function pickDefault(rounds) {
    const now = Date.now();
    const live = rounds.findIndex((r) => r.events.some((e) => e.status.kind === 'live'));
    if (live >= 0) return live;
    let prev = -1;
    rounds.forEach((r, i) => { if (r.first <= now) prev = i; });
    const next = prev + 1 < rounds.length ? prev + 1 : -1;
    if (prev >= 0) {
      const r = rounds[prev];
      const pending = r.events.some((e) => e.status.kind === 'pre' && e.date > now - 3 * HOUR);
      if (pending || next < 0 || now - r.last < 20 * HOUR) return prev;
    }
    return next >= 0 ? next : rounds.length - 1;
  }

  function regroup() {
    state.rounds = buildRounds();
    let idx = -1;
    if (state.pinned) idx = state.rounds.findIndex((r) => r.events.some((e) => e.id === state.pinned));
    if (idx < 0) { state.pinned = null; idx = pickDefault(state.rounds); }
    state.roundIdx = idx;
  }

  // ---------- busca ----------
  async function loadAll() {
    const today = new Date();
    const range = `${ymd(addDays(today, -WINDOW_DAYS))}-${ymd(addDays(today, WINDOW_DAYS))}`;
    const standings = loadStandings();
    let json;
    try {
      json = await getJSON(`${SCOREBOARD}?dates=${range}&limit=200`);
      if (!json?.events?.length) throw new Error('vazio');
    } catch {
      json = await getJSON(SCOREBOARD);
    }
    state.events.clear();
    ingest(json);
    await standings;
    state.lastFull = Date.now();
  }

  async function refreshRound() {
    const r = state.rounds[state.roundIdx];
    if (!r) return loadAll();
    const range = `${ymd(addDays(r.first, -1))}-${ymd(addDays(r.last, 1))}`;
    const before = r.events.filter((e) => e.status.kind === 'post').length;
    ingest(await getJSON(`${SCOREBOARD}?dates=${range}&limit=100`));
    const after = r.events.reduce((n, e) => n + (state.events.get(e.id)?.status.kind === 'post' ? 1 : 0), 0);
    if (after !== before || Date.now() - state.lastStandings > STANDINGS_MS) await loadStandings();
  }

  async function loadStandings() {
    try {
      const json = await getJSON(STANDINGS);
      const group = json?.children?.[0]?.standings || json?.standings;
      const rows = (group?.entries || []).map(parseStanding);
      if (rows.length) {
        const ranked = rows.every((t) => t.rank != null);
        rows.sort(ranked ? (a, b) => a.rank - b.rank : (a, b) => b.pts - a.pts || b.w - a.w || b.gd - a.gd);
        rows.forEach((t, i) => { t.pos = ranked ? t.rank : i + 1; });
        state.standings = rows;
      }
      state.lastStandings = Date.now();
    } catch { /* a tabela é complementar; a rodada segue funcionando */ }
  }

  function parseStanding(en) {
    const stat = (name) => {
      const s = (en.stats || []).find((x) => x.name === name || x.type === name.toLowerCase());
      const v = s == null ? null : Number(s.value);
      return Number.isFinite(v) ? v : null;
    };
    return {
      id: String(en.team?.id ?? ''),
      name: en.team?.shortDisplayName || en.team?.displayName || '?',
      logo: en.team?.logos?.[0]?.href || '',
      rank: stat('rank'),
      pts: stat('points') ?? 0,
      gp: stat('gamesPlayed'),
      w: stat('wins') ?? 0,
      d: stat('ties') ?? 0,
      l: stat('losses') ?? 0,
      gd: stat('pointDifferential') ?? 0,
      note: en.note || null,
    };
  }

  async function tick() {
    clearTimeout(state.timer);
    if (state.loading) return;
    state.loading = true;
    el.refresh.classList.add('loading');
    try {
      if (!state.rounds.length || Date.now() - state.lastFull > FULL_MS) await loadAll();
      else await refreshRound();
      state.failed = false;
      state.lastOk = Date.now();
    } catch (err) {
      state.failed = true;
      console.warn('Falha ao atualizar', err);
    } finally {
      state.loading = false;
      el.refresh.classList.remove('loading');
      regroup();
      render();
      schedule();
    }
  }

  function schedule() {
    clearTimeout(state.timer);
    if (document.hidden) return;
    const r = state.rounds[state.roundIdx];
    const now = Date.now();
    const hot = !!r && r.events.some((e) => e.status.kind === 'live'
      || (e.status.kind === 'pre' && e.date - now < 10 * 60e3 && now - e.date < 3 * HOUR));
    state.timer = setTimeout(tick, state.failed ? LIVE_MS : hot ? LIVE_MS : IDLE_MS);
  }

  // ---------- renderização ----------
  function render() {
    const r = state.rounds[state.roundIdx];
    const liveIds = new Set();
    for (const ev of state.events.values()) {
      if (ev.status.kind === 'live') { liveIds.add(ev.home.id); liveIds.add(ev.away.id); }
    }

    // cabeçalho
    el.prev.disabled = state.roundIdx <= 0;
    el.next.disabled = state.roundIdx < 0 || state.roundIdx >= state.rounds.length - 1;
    if (r) {
      el.roundName.textContent = r.number ? `Rodada ${r.number}` : 'Rodada';
      el.roundDates.textContent = sameDay(r.first, r.last) ? shortDay(r.first) : `${shortDay(r.first)} a ${shortDay(r.last)}`;
    }
    const anyLive = !!r && r.events.some((e) => e.status.kind === 'live');
    el.pulse.hidden = !anyLive;
    if (state.failed) el.updated.textContent = state.lastOk ? 'Sem conexão, tentando de novo' : 'Sem conexão';
    else if (state.lastOk) el.updated.textContent = `${anyLive ? 'Ao vivo · ' : ''}${fmtClock.format(state.lastOk)}`;

    // erro sem dados
    const empty = !state.events.size;
    el.error.hidden = !(state.failed && empty);
    if (state.failed && empty) {
      el.errorText.textContent = 'Não foi possível carregar os jogos. Confira sua conexão com a internet; o app tenta de novo a cada 30 segundos.';
      el.matches.innerHTML = '';
    }

    renderMatches(r);
    renderTable(liveIds);
    document.title = anyLive ? `● ${r.number ? `Rodada ${r.number}` : 'Rodada'} ao vivo` : 'Rodada ao Vivo';
  }

  function renderMatches(r) {
    if (!r) {
      el.summary.hidden = true;
      if (!state.failed && state.lastOk) {
        el.matches.innerHTML = '<p class="empty">Nenhum jogo do Brasileirão nos próximos dias.</p>';
      }
      return;
    }
    const counts = { live: 0, post: 0, pre: 0, off: 0 };
    r.events.forEach((e) => { counts[e.status.kind]++; });
    const parts = [];
    if (counts.live) parts.push(`<b class="live-count">${counts.live}</b> <span class="live-count">ao vivo</span>`);
    if (counts.post) parts.push(`<b>${counts.post}</b> ${counts.post === 1 ? 'encerrado' : 'encerrados'}`);
    if (counts.pre) parts.push(`<b>${counts.pre}</b> a seguir`);
    if (counts.off) parts.push(`<b>${counts.off}</b> ${counts.off === 1 ? 'adiado' : 'adiados'}`);
    el.summary.innerHTML = parts.join(' · ');
    el.summary.hidden = !parts.length;

    const now = new Date();
    const days = [];
    for (const ev of r.events) {
      const last = days[days.length - 1];
      if (last && sameDay(last.date, ev.date)) last.events.push(ev);
      else days.push({ date: ev.date, events: [ev] });
    }
    el.matches.innerHTML = days.map((d) => `
      <section class="day">
        <h2 class="day-label">${esc(dayLabel(d.date, now))}</h2>
        ${d.events.map(matchCard).join('')}
      </section>`).join('');
  }

  function dayLabel(d, now) {
    if (sameDay(d, now)) return `Hoje, ${dm(d)}`;
    if (sameDay(d, addDays(now, -1))) return `Ontem, ${dm(d)}`;
    if (sameDay(d, addDays(now, 1))) return `Amanhã, ${dm(d)}`;
    return `${fmtWeekday.format(d)}, ${dm(d)}`;
  }

  function matchCard(ev) {
    const s = ev.status;
    const flash = state.flashes.get(ev.id);
    const flashOn = flash && flash.until > Date.now();
    if (flash && !flashOn) state.flashes.delete(ev.id);
    const fresh = flashOn && flash.fresh;
    if (fresh) flash.fresh = false;

    let status;
    if (s.kind === 'live') status = `${esc(s.label)}<span class="pulse" aria-hidden="true"></span>`;
    else if (s.kind === 'off') status = `<small>${esc(s.label)}</small>`;
    else status = esc(s.label);

    const decided = s.kind === 'post' && ev.home.score != null && ev.away.score != null;
    const row = (t, key) => {
      const other = key === 'home' ? ev.away : ev.home;
      const result = decided ? (t.score > other.score ? 'won' : t.score < other.score ? 'lost' : 'draw') : '';
      const scored = flashOn && flash.sides.has(key);
      const score = s.kind === 'pre' || s.kind === 'off' || t.score == null ? '–' : t.score;
      return `
        <div class="team ${result}">
          ${crest(t.logo, t.name)}
          <div class="team-info">
            <div class="team-name"><span>${esc(t.name)}</span>${'<i class="red-card" title="Cartão vermelho"></i>'.repeat(Math.min(t.reds, 4))}${scored ? '<b class="gol-tag">GOL</b>' : ''}</div>
            ${t.goals.length ? `<p class="scorers">${esc(scorers(t.goals))}</p>` : ''}
          </div>
          <span class="score${scored ? ' flash' : ''}"${scored && !fresh ? ' style="animation:none"' : ''}>${score}</span>
        </div>`;
    };

    const label = s.kind === 'live' ? s.note : s.kind === 'post' ? 'Encerrado' : s.kind === 'pre' ? `Começa às ${s.label}` : s.label;
    return `
      <article class="match is-${s.kind}" aria-label="${esc(`${ev.home.name} ${ev.home.score ?? ''} x ${ev.away.score ?? ''} ${ev.away.name}, ${label}`)}">
        <div class="status">${status}</div>
        <div class="teams">${row(ev.home, 'home')}${row(ev.away, 'away')}</div>
        ${ev.venue ? `<div class="venue">${esc(ev.venue)}</div>` : ''}
      </article>`;
  }

  // "Pedro 23', 67' · Arrascaeta 51' (pên.)"
  function scorers(goals) {
    const byPlayer = new Map();
    for (const g of goals) {
      const key = `${g.who}|${g.og ? 'og' : ''}`;
      if (!byPlayer.has(key)) byPlayer.set(key, { who: g.who || 'Gol', og: g.og, mins: [] });
      const min = g.min && !g.min.endsWith("'") ? `${g.min}'` : g.min;
      byPlayer.get(key).mins.push(`${min.replace("'+", '+')}${g.pen ? ' (pên.)' : ''}`);
    }
    return [...byPlayer.values()].map((p) => `${p.who}${p.og ? ' (contra)' : ''} ${p.mins.join(', ')}`.trim()).join(' · ');
  }

  function zoneName(desc) {
    if (/libertadores/i.test(desc)) return /qualif|pré|pre-/i.test(desc) ? 'Pré-Libertadores' : 'Libertadores';
    if (/sudamericana|sul-americana/i.test(desc)) return 'Sul-Americana';
    if (/relegat|rebaix/i.test(desc)) return 'Rebaixamento';
    return desc;
  }
  function zoneColor(c) {
    if (!c) return '';
    const hex = String(c).replace(/^#/, '');
    return /^[0-9a-f]{3,8}$/i.test(hex) ? `#${hex}` : '';
  }

  function renderTable(liveIds) {
    const rows = state.standings;
    if (!rows.length) {
      el.tableWrap.innerHTML = `<p class="empty">${state.lastOk ? 'Classificação indisponível no momento.' : 'Carregando classificação…'}</p>`;
      el.legend.innerHTML = '';
      return;
    }
    const hasNotes = rows.some((t) => t.note?.color);
    const legend = new Map();
    const body = rows.map((t) => {
      let zone = '';
      let zname = '';
      if (hasNotes && t.note) { zone = zoneColor(t.note.color); zname = zoneName(t.note.description || ''); }
      else if (!hasNotes && rows.length === 20 && t.pos >= 17) { zone = 'var(--live)'; zname = 'Rebaixamento'; }
      if (zone && zname && !legend.has(zname)) legend.set(zname, zone);
      const logo = t.logo ? `<img src="${esc(crestUrl(t.logo))}" data-fallback="${esc(t.logo)}" alt="" loading="lazy">` : '';
      const live = liveIds.has(t.id) ? '<span class="pulse" title="Jogando agora"></span>' : '';
      const gd = t.gd > 0 ? `+${t.gd}` : t.gd;
      return `<tr>
        <td class="pos"${zone ? ` style="--zone:${esc(zone)}"` : ''}>${t.pos}</td>
        <td class="club"><span class="club-cell">${logo}<span>${esc(t.name)}</span>${live}</span></td>
        <td class="pts">${t.pts}</td><td>${t.gp ?? '–'}</td><td>${t.w}</td><td>${t.d}</td><td>${t.l}</td><td>${gd}</td>
      </tr>`;
    }).join('');
    el.tableWrap.innerHTML = `<table>
      <thead><tr><th>#</th><th class="club">Clube</th><th title="Pontos">P</th><th title="Jogos">J</th><th title="Vitórias">V</th><th title="Empates">E</th><th title="Derrotas">D</th><th title="Saldo de gols">SG</th></tr></thead>
      <tbody>${body}</tbody></table>`;
    el.legend.innerHTML = [...legend].map(([name, color]) => `<li style="--zone:${esc(color)}"><i></i>${esc(name)}</li>`).join('');
  }

  // ---------- interações ----------
  function go(delta) {
    const idx = state.roundIdx + delta;
    if (idx < 0 || idx >= state.rounds.length) return;
    state.roundIdx = idx;
    const auto = pickDefault(state.rounds);
    state.pinned = idx === auto ? null : state.rounds[idx].events[0].id;
    render();
    tick();
  }

  function setTab(tab) {
    const jogos = tab === 'jogos';
    el.tabJogos.setAttribute('aria-selected', String(jogos));
    el.tabTabela.setAttribute('aria-selected', String(!jogos));
    el.viewJogos.hidden = !jogos;
    el.viewTabela.hidden = jogos;
    try { localStorage.setItem('aba', tab); } catch { /* armazenamento indisponível */ }
  }

  el.prev.addEventListener('click', () => go(-1));
  el.next.addEventListener('click', () => go(1));
  el.refresh.addEventListener('click', () => tick());
  el.retry.addEventListener('click', () => tick());
  el.tabJogos.addEventListener('click', () => setTab('jogos'));
  el.tabTabela.addEventListener('click', () => setTab('tabela'));

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

  try { if (localStorage.getItem('aba') === 'tabela') setTab('tabela'); } catch { /* idem */ }
  tick();
})();
