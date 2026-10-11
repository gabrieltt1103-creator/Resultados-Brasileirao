// Classificação ao vivo: a tabela oficial da ESPN mais os placares atuais da rodada.
import { gameIndex, playsIn, sortEvents } from './rounds.js';

const outcome = (gf, ga) => (gf > ga ? 'V' : gf === ga ? 'E' : 'D');

function apply(row, gf, ga, sign) {
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

// A tabela oficial já conta este jogo? Compara os jogos disputados com o número da rodada.
function counted(ev, teamId, played, roundNumber, list) {
  if (roundNumber == null) return ev.status.kind === 'post';
  const base = gameIndex(ev, teamId, played, list) - (ev.status.kind === 'post' ? 0 : 1);
  return base >= roundNumber;
}

/**
 * Monta a tabela antes da rodada e a tabela "se terminasse agora".
 * overrides: {eventId: {h, a}} para simular um placar.
 */
export function computeTable(standings, round, events, overrides = {}) {
  if (!standings?.length) return null;
  const list = sortEvents(events);
  const official = new Map(standings.map((t) => [t.id, t]));
  const pre = new Map(standings.map((t, i) => [t.id, { ...t, order: i }]));
  const games = [];
  for (const ev of round?.events || []) {
    const started = (ev.status.kind === 'post' || ev.status.kind === 'live') && ev.home.score != null && ev.away.score != null;
    const ov = overrides[ev.id];
    if (!started && !ov) continue;
    if (started) {
      for (const [side, other] of [[ev.home, ev.away], [ev.away, ev.home]]) {
        const row = pre.get(side.id);
        if (row && counted(ev, side.id, official.get(side.id).gp, round.number, list)) apply(row, side.score, other.score, -1);
      }
    }
    games.push({ ev, h: ov ? ov.h : ev.home.score, a: ov ? ov.a : ev.away.score, sim: !!ov });
  }

  const live = new Map([...pre].map(([id, r]) => [id, { ...r }]));
  const results = new Map();
  for (const g of games) {
    for (const [side, other, gf, ga] of [[g.ev.home, g.ev.away, g.h, g.a], [g.ev.away, g.ev.home, g.a, g.h]]) {
      const row = live.get(side.id);
      if (!row) continue;
      apply(row, gf, ga, 1);
      results.set(side.id, { ev: g.ev, opp: other, gf, ga, res: outcome(gf, ga), live: g.ev.status.kind === 'live' && !g.sim });
    }
  }

  const preRows = sortRows([...pre.values()]);
  preRows.forEach((r, i) => { r.pos = i + 1; });

  // Posições só com os jogos já encerrados: separa o que já está garantido do que depende de jogo em andamento.
  const settled = new Map([...pre].map(([id, r]) => [id, { ...r }]));
  for (const g of games) {
    if (g.sim || g.ev.status.kind !== 'post') continue;
    const h = settled.get(g.ev.home.id);
    const a = settled.get(g.ev.away.id);
    if (h) apply(h, g.h, g.a, 1);
    if (a) apply(a, g.a, g.h, 1);
  }
  const settledPos = new Map(sortRows([...settled.values()]).map((r, i) => [r.id, i + 1]));
  const rows = sortRows([...live.values()]);
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
    started: games.some((g) => !g.sim),
    anyLive: games.some((g) => !g.sim && g.ev.status.kind === 'live'),
  };
}

export function zoneName(desc) {
  if (/libertadores/i.test(desc)) return /qualif|pré|pre-/i.test(desc) ? 'Pré-Libertadores' : 'Libertadores';
  if (/sudamericana|sul-americana/i.test(desc)) return 'Sul-Americana';
  if (/relegat|rebaix/i.test(desc)) return 'Rebaixamento';
  return desc;
}

// Zonas por posição, a partir das notas da ESPN na tabela oficial.
export function zonesFor(standings) {
  const n = standings.length;
  const byPos = new Array(n + 1).fill(null);
  const hasNotes = standings.some((t) => t.note?.color);
  standings.forEach((t, i) => {
    const pos = i + 1;
    if (hasNotes && t.note) byPos[pos] = { name: zoneName(t.note.description), color: t.note.color };
    else if (!hasNotes && n === 20 && pos >= 17) byPos[pos] = { name: 'Rebaixamento', color: 'var(--live)' };
  });
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
    .filter((e) => e.status.kind === 'post' && playsIn(e, teamId) && e.home.score != null)
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
export function scenarios(standings, round, events, ev) {
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
    const t = computeTable(standings, round, events, { [ev.id]: { h: sh, a: sa } });
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
  if (zones.zStart) {
    if (t.pos >= zones.zStart) out.push({ label: `Para sair do ${zones.zLabel}`, value: `${rows[zones.zStart - 2].pts - t.pts} pts` });
    else out.push({ label: `Acima do ${zones.zLabel}`, value: `${t.pts - rows[zones.zStart - 1].pts} pts` });
  }
  return out;
}
