// Classificação: calculada a partir dos jogos quando a temporada está completa; senão,
// a tabela oficial da ESPN corrigida com os jogos que ela ainda não contou.
import { gameIndex, playsIn, sortEvents } from './rounds.js';

const outcome = (gf, ga) => (gf > ga ? 'V' : gf === ga ? 'E' : 'D');
const scored = (e) => e.home.score != null && e.away.score != null;

export function apply(row, gf, ga, sign = 1) {
  const r = outcome(gf, ga);
  row.pts += sign * (r === 'V' ? 3 : r === 'E' ? 1 : 0);
  row.gp += sign;
  row.w += sign * (r === 'V');
  row.d += sign * (r === 'E');
  row.l += sign * (r === 'D');
  row.gf += sign * gf;
  row.ga += sign * ga;
  row.gd += sign * (gf - ga);
}

// Critérios do Brasileirão: pontos, vitórias, saldo, gols pró; depois a ordem oficial.
export function sortRows(rows) {
  return rows.sort((a, b) => b.pts - a.pts || b.w - a.w || b.gd - a.gd || b.gf - a.gf || a.order - b.order);
}

/** Times do campeonato: da classificação da ESPN ou, sem ela, dos próprios jogos. */
export function teamList(standings, events) {
  if (standings?.length) return standings.map((t, i) => ({ id: t.id, name: t.name, logo: t.logo, note: t.note, order: i }));
  const seen = new Map();
  for (const e of sortEvents(events)) for (const t of [e.home, e.away]) if (!seen.has(t.id)) seen.set(t.id, { id: t.id, name: t.name, logo: t.logo, note: null });
  return [...seen.values()].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')).map((t, i) => ({ ...t, order: i }));
}

const blank = (t) => ({ ...t, pts: 0, gp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0 });
const clone = (m) => new Map([...m].map(([id, r]) => [id, { ...r }]));
const ranked = (m) => sortRows([...m.values()]);

/**
 * A tabela oficial da ESPN já conta este jogo? Compara os jogos disputados com o número da rodada.
 * Só usada quando a temporada não está completa.
 */
function counted(ev, teamId, played, roundNumber, list) {
  if (roundNumber == null) return ev.status.kind === 'post';
  const base = gameIndex(ev, teamId, played, list) - (ev.status.kind === 'post' ? 0 : 1);
  return base >= roundNumber;
}

/** Tabela com todos os jogos encerrados. */
export function finishedTable({ standings, events, round, complete }) {
  if (complete) {
    const rows = new Map(teamList(standings, events).map((t) => [t.id, blank(t)]));
    for (const ev of events) {
      if (ev.status.kind !== 'post' || !scored(ev)) continue;
      const h = rows.get(ev.home.id);
      const a = rows.get(ev.away.id);
      if (h) apply(h, ev.home.score, ev.away.score);
      if (a) apply(a, ev.away.score, ev.home.score);
    }
    return { rows, mode: 'jogos' };
  }
  if (!standings?.length) return null;
  const list = sortEvents(events);
  const rows = new Map(standings.map((t, i) => [t.id, { ...t, order: i }]));
  for (const ev of round?.events || []) {
    if (ev.status.kind !== 'post' || !scored(ev)) continue;
    for (const [side, other] of [[ev.home, ev.away], [ev.away, ev.home]]) {
      const row = rows.get(side.id);
      const official = standings.find((t) => t.id === side.id);
      if (row && !counted(ev, side.id, official.gp, round.number, list)) apply(row, side.score, other.score);
    }
  }
  return { rows, mode: 'espn' };
}

/**
 * Tabela antes da rodada, tabela "agora" (encerrados + ao vivo + simulações) e posições
 * só com os jogos encerrados.
 * overrides: {eventId: {h, a}} placares simulados (valem para jogos ainda não encerrados).
 */
export function computeTable({ standings, events, round, complete, overrides = {} }) {
  const base = finishedTable({ standings, events, round, complete });
  if (!base) return null;
  const list = sortEvents(events);
  const B = base.rows;
  const results = new Map();
  const roundIds = new Set((round?.events || []).map((e) => e.id));

  const pre = clone(B);
  for (const ev of round?.events || []) {
    if (ev.status.kind !== 'post' || !scored(ev)) continue;
    const h = pre.get(ev.home.id);
    const a = pre.get(ev.away.id);
    if (h) apply(h, ev.home.score, ev.away.score, -1);
    if (a) apply(a, ev.away.score, ev.home.score, -1);
    results.set(ev.home.id, { ev, opp: ev.away, gf: ev.home.score, ga: ev.away.score, res: outcome(ev.home.score, ev.away.score), live: false });
    results.set(ev.away.id, { ev, opp: ev.home, gf: ev.away.score, ga: ev.home.score, res: outcome(ev.away.score, ev.home.score), live: false });
  }

  const now = clone(B);
  let anyLive = false;
  let anySim = false;
  for (const ev of list) {
    if (ev.status.kind === 'post') continue;
    const ov = overrides[ev.id];
    let h;
    let a;
    if (ov) { h = ov.h; a = ov.a; anySim = true; } else if (ev.status.kind === 'live' && scored(ev)) {
      if (base.mode === 'espn' && counted(ev, ev.home.id, B.get(ev.home.id)?.gp ?? 0, round?.number, list)) continue;
      h = ev.home.score; a = ev.away.score; anyLive = true;
    } else continue;
    const hr = now.get(ev.home.id);
    const ar = now.get(ev.away.id);
    if (hr) apply(hr, h, a);
    if (ar) apply(ar, a, h);
    if (roundIds.has(ev.id) || !results.has(ev.home.id)) results.set(ev.home.id, { ev, opp: ev.away, gf: h, ga: a, res: outcome(h, a), live: !ov, sim: !!ov });
    if (roundIds.has(ev.id) || !results.has(ev.away.id)) results.set(ev.away.id, { ev, opp: ev.home, gf: a, ga: h, res: outcome(a, h), live: !ov, sim: !!ov });
  }

  const preRows = ranked(pre);
  preRows.forEach((r, i) => { r.pos = i + 1; });
  const settledPos = new Map(ranked(B).map((r, i) => [r.id, i + 1]));
  const rows = ranked(now);
  rows.forEach((r, i) => {
    r.pos = i + 1;
    r.prePos = pre.get(r.id).pos;
    r.delta = r.prePos - r.pos;
    r.result = results.get(r.id) || null;
  });
  return {
    rows,
    byId: new Map(rows.map((r) => [r.id, r])),
    pre: preRows,
    preById: new Map(preRows.map((r) => [r.id, r])),
    settledPos,
    finished: B,
    mode: base.mode,
    started: (round?.events || []).some((e) => e.status.kind === 'post' || e.status.kind === 'live'),
    anyLive,
    anySim,
  };
}

export function zoneName(desc) {
  if (/libertadores/i.test(desc)) return /qualif|pré|pre-/i.test(desc) ? 'Pré-Libertadores' : 'Libertadores';
  if (/sudamericana|sul-americana/i.test(desc)) return 'Sul-Americana';
  if (/relegat|rebaix/i.test(desc)) return 'Rebaixamento';
  return desc;
}

// Zonas por posição, a partir das notas da ESPN na tabela oficial.
export function zonesFor(standings, teamCount = standings.length) {
  const n = standings.length || teamCount;
  const byPos = new Array(n + 1).fill(null);
  const hasNotes = standings.some((t) => t.note?.color);
  if (hasNotes) standings.forEach((t, i) => { if (t.note) byPos[i + 1] = { name: zoneName(t.note.description), color: t.note.color }; });
  else if (n === 20) for (let p = 17; p <= 20; p++) byPos[p] = { name: 'Rebaixamento', color: 'var(--live)' };
  let g = 0;
  while (byPos[g + 1] && /Libertadores/.test(byPos[g + 1].name)) g++;
  const rel = byPos.map((z, i) => (z?.name === 'Rebaixamento' ? i : null)).filter((x) => x != null);
  return {
    byPos,
    g,
    gLabel: g ? `G${g}` : null,
    zStart: rel.length ? Math.min(...rel) : null,
    zLabel: rel.length ? `Z${rel.length}` : null,
  };
}

// Últimos n jogos encerrados do time, do mais antigo para o mais recente.
export function formOf(events, teamId, n = 5) {
  return sortEvents(events)
    .filter((e) => e.status.kind === 'post' && playsIn(e, teamId) && scored(e))
    .slice(-n)
    .map((e) => {
      const home = e.home.id === teamId;
      const gf = home ? e.home.score : e.away.score;
      const ga = home ? e.away.score : e.home.score;
      return { ev: e, home, opp: home ? e.away : e.home, gf, ga, res: outcome(gf, ga) };
    });
}

export const formPoints = (form) => form.reduce((s, g) => s + (g.res === 'V' ? 3 : g.res === 'E' ? 1 : 0), 0);

// Posição de cada time se o jogo terminar com vitória do mandante, empate ou vitória do visitante,
// mantendo os outros placares atuais.
export function scenarios(ctx, ev) {
  const h = ev.status.kind === 'live' ? ev.home.score ?? 0 : 0;
  const a = ev.status.kind === 'live' ? ev.away.score ?? 0 : 0;
  const top = Math.max(h, a);
  const cases = [
    ['home', h > a ? [h, a] : [a + 1, a]],
    ['draw', [top, top]],
    ['away', a > h ? [h, a] : [h, h + 1]],
  ];
  const out = {};
  for (const [key, [sh, sa]] of cases) {
    const t = computeTable({ ...ctx, overrides: { [ev.id]: { h: sh, a: sa } } });
    if (!t) return null;
    out[key] = { home: t.byId.get(ev.home.id), away: t.byId.get(ev.away.id) };
  }
  return out;
}

// Distâncias para o líder, para a zona da Libertadores e para o rebaixamento.
export function distances(table, zones, teamId) {
  const rows = table.rows;
  const t = table.byId.get(teamId);
  if (!t) return [];
  const out = [];
  if (t.pos === 1) out.push({ label: 'Vantagem na liderança', value: `${t.pts - (rows[1]?.pts ?? t.pts)} pts` });
  else out.push({ label: 'Para o líder', value: `${rows[0].pts - t.pts} pts` });
  if (zones.g) {
    if (t.pos <= zones.g) out.push({ label: `Folga no ${zones.gLabel}`, value: `${t.pts - (rows[zones.g]?.pts ?? t.pts)} pts` });
    else out.push({ label: `Para o ${zones.gLabel}`, value: `${rows[zones.g - 1].pts - t.pts} pts` });
  }
  if (zones.zStart && rows[zones.zStart - 1]) {
    if (t.pos >= zones.zStart) out.push({ label: `Para sair do ${zones.zLabel}`, value: `${rows[zones.zStart - 2].pts - t.pts} pts` });
    else out.push({ label: `Acima do ${zones.zLabel}`, value: `${t.pts - rows[zones.zStart - 1].pts} pts` });
  }
  return out;
}
