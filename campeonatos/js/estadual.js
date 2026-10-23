// Chances nos estaduais (Paulista e Carioca): sorteia o que falta da primeira fase, o rebaixamento e o
// mata-mata, seguindo o formato do ano (que muda quase todo ano e vem de FORMATS, em comps.js).
import { rng } from './sim.js';
import { tiesOf } from './comps.js';

function poisson(lambda, rand) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do { k++; p *= rand(); } while (p > L);
  return k - 1;
}

function gauss(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

function remaining(ev) {
  if (ev.status.half) return 0.5;
  const m = /(\d+)/.exec(ev.status.label || '');
  if (!m) return 0.5;
  return Math.max(0, Math.min(1, (90 - Number(m[1])) / 90));
}

const pairKey = (x, y) => [x, y].sort().join('|');

/**
 * O formato vale para estes jogos? A primeira fase precisa existir, com o número de times do formato
 * e, se for por grupos, com cada time num grupo conhecido.
 */
export function formatFits(format, events, groups) {
  if (!format) return false;
  const first = events.filter((e) => e.phase === format.first.slug);
  if (!first.length) return false;
  const teams = new Set(first.flatMap((e) => [e.home.id, e.away.id]));
  if (format.first.teams && teams.size !== format.first.teams) return false;
  if (format.first.groups) {
    const letters = new Set([...teams].map((id) => groups?.get(id)).filter(Boolean));
    if (letters.size !== format.first.groups || [...teams].some((id) => !groups?.get(id))) return false;
  }
  return true;
}

/**
 * Chances no estadual: classificar para o mata-mata, chegar à final, ser campeão e cair.
 * events: todos os jogos do estadual no ano; format: FORMATS de comps.js; groups: Map id -> letra do grupo
 * (formato por grupos); lambda(home, away, neutral) -> [gols esperados de cada um] ou null.
 * Devolve {byTeam: Map id -> {qualify, final, title, relegate}, reach: [Map id -> chance de chegar a cada fase do
 * mata-mata], runs, firstLeft} ou null.
 */
export function stateOdds({ events, format, groups = null, lambda, runs = 5000, seed = 9, spread = 0.08 }) {
  if (!formatFits(format, events, groups)) return null;
  const F = format.first;
  const first = events.filter((e) => e.phase === F.slug);
  const teams = [...new Set(first.flatMap((e) => [e.home.id, e.away.id]))];
  for (const x of teams) for (const y of teams) if (x !== y && !lambda(x, y, false)) return null;
  const idx = new Map(teams.map((id, i) => [id, i]));
  const n = teams.length;
  const groupOf = (id) => (F.groups ? groups.get(id) : '');
  const rand = rng(seed);
  const ea = new Float64Array(n);
  const ed = new Float64Array(n);
  const goals = (h, a, neutral, f = 1) => {
    const l = lambda(h, a, neutral);
    const i = idx.get(h);
    const j = idx.get(a);
    return [poisson(l[0] * ea[i] * ed[j] * f, rand), poisson(l[1] * ea[j] * ed[i] * f, rand)];
  };
  const byPhase = new Map();
  for (const e of events) {
    if (!byPhase.has(e.phase)) byPhase.set(e.phase, []);
    byPhase.get(e.phase).push(e);
  }
  // Confrontos reais de cada fase do mata-mata (os que a ESPN já tem), pelos dois times.
  const realTies = new Map();
  for (const round of format.bracket) {
    for (const t of tiesOf((byPhase.get(round.slug) || []).filter((e) => !e.home.tbd && !e.away.tbd))) realTies.set(`${round.slug}|${pairKey(t.a.id, t.b.id)}`, t);
  }
  const relegation = F.relegationStage ? (byPhase.get(F.relegationStage.slug) || []) : [];
  const firstLeft = first.filter((e) => e.status.kind !== 'post').length;

  const P = new Float64Array(n);
  const W = new Float64Array(n);
  const D = new Float64Array(n);
  const G = new Float64Array(n);
  const J = new Float64Array(n);
  const play = (h, a, x, y) => {
    const i = idx.get(h);
    const j = idx.get(a);
    G[i] += x; G[j] += y; D[i] += x - y; D[j] += y - x;
    if (x > y) { P[i] += 3; W[i]++; } else if (x < y) { P[j] += 3; W[j]++; } else { P[i]++; P[j]++; }
  };
  const better = (x, y) => P[idx.get(y)] - P[idx.get(x)] || W[idx.get(y)] - W[idx.get(x)] || D[idx.get(y)] - D[idx.get(x)] || G[idx.get(y)] - G[idx.get(x)] || J[idx.get(y)] - J[idx.get(x)];
  // Um jogo do mata-mata: em casa do mais bem colocado (ou campo neutro); empate vai aos pênaltis.
  const single = (x, y, neutral) => {
    const [gx, gy] = neutral ? goals(x, y, true) : goals(x, y, false);
    if (gx !== gy) return gx > gy ? x : y;
    return rand() < 0.5 ? x : y;
  };
  // Ida e volta: o mais bem colocado (x) decide em casa; empate no agregado vai aos pênaltis.
  const twoLegs = (x, y) => {
    const [b1, a1] = goals(y, x, false);
    const [a2, b2] = goals(x, y, false);
    if (a1 + a2 !== b1 + b2) return a1 + a2 > b1 + b2 ? x : y;
    return rand() < 0.5 ? x : y;
  };
  // Confronto que a ESPN já tem: o que foi jogado vale, o resto é sorteado.
  const fromReal = (t, round) => {
    if (t.done) return t.winner;
    const agg = { [t.a.id]: 0, [t.b.id]: 0 };
    for (const e of t.legs) {
      if (e.status.kind === 'post') { agg[e.home.id] += e.home.score ?? 0; agg[e.away.id] += e.away.score ?? 0; continue; }
      const f = e.status.kind === 'live' ? remaining(e) : 1;
      const [gh, ga] = goals(e.home.id, e.away.id, !!round.neutral, f);
      agg[e.home.id] += (e.status.kind === 'live' ? e.home.score ?? 0 : 0) + gh;
      agg[e.away.id] += (e.status.kind === 'live' ? e.away.score ?? 0 : 0) + ga;
    }
    if (t.legs.length < (round.legs || 1)) {
      const [gb, ga] = goals(t.b.id, t.a.id, false);
      agg[t.b.id] += gb;
      agg[t.a.id] += ga;
    }
    if (agg[t.a.id] !== agg[t.b.id]) return agg[t.a.id] > agg[t.b.id] ? t.a.id : t.b.id;
    return rand() < 0.5 ? t.a.id : t.b.id;
  };

  const qualify = new Float64Array(n);
  // Chegar a cada fase do mata-mata (a primeira é classificar).
  const reach = format.bracket.map(() => new Float64Array(n));
  const fin = new Float64Array(n);
  const title = new Float64Array(n);
  const down = new Float64Array(n);
  for (let s = 0; s < runs; s++) {
    for (let i = 0; i < n; i++) { ea[i] = Math.exp(spread * gauss(rand)); ed[i] = Math.exp(spread * gauss(rand)); }
    P.fill(0); W.fill(0); D.fill(0); G.fill(0);
    for (let i = 0; i < n; i++) J[i] = rand();
    // Primeira fase: o que foi jogado vale; jogo ao vivo, só o que falta; o resto é sorteado.
    for (const e of first) {
      if (e.status.kind === 'post') { play(e.home.id, e.away.id, e.home.score ?? 0, e.away.score ?? 0); continue; }
      const f = e.status.kind === 'live' ? remaining(e) : 1;
      const [x, y] = goals(e.home.id, e.away.id, false, f);
      const live = e.status.kind === 'live';
      play(e.home.id, e.away.id, (live ? e.home.score ?? 0 : 0) + x, (live ? e.away.score ?? 0 : 0) + y);
    }
    // Classificação geral (a campanha) e a de cada grupo.
    const overall = [...teams].sort(better);
    const rankOf = new Map(overall.map((id, i) => [id, i]));
    const seedOf = new Map();
    const byGroup = new Map();
    for (const id of overall) {
      const g = groupOf(id);
      if (!byGroup.has(g)) byGroup.set(g, []);
      byGroup.get(g).push(id);
    }
    for (const [g, list] of byGroup) list.forEach((id, i) => seedOf.set(`${g}${i + 1}`, id));
    // Rebaixamento: os últimos da campanha, ou um quadrangular entre os piores de cada grupo.
    if (F.relegate) for (const id of overall.slice(-F.relegate)) down[idx.get(id)]++;
    if (F.relegationStage) {
      const R = F.relegationStage;
      const four = R.seeds.map((k) => seedOf.get(k));
      const pts = new Map(four.map((id) => [id, [0, 0, 0, 0, rand()]]));
      const add = (h, a, x, y) => {
        const ph = pts.get(h);
        const pa = pts.get(a);
        ph[2] += x - y; pa[2] += y - x; ph[3] += x; pa[3] += y;
        if (x > y) { ph[0] += 3; ph[1]++; } else if (x < y) { pa[0] += 3; pa[1]++; } else { ph[0]++; pa[0]++; }
      };
      const real = relegation.filter((e) => pts.has(e.home.id) && pts.has(e.away.id));
      const done = new Set();
      for (const e of real) {
        done.add(`${e.home.id}>${e.away.id}`);
        if (e.status.kind === 'post') add(e.home.id, e.away.id, e.home.score ?? 0, e.away.score ?? 0);
        else { const [x, y] = goals(e.home.id, e.away.id, false); add(e.home.id, e.away.id, x, y); }
      }
      for (const h of four) for (const a of four) if (h !== a && !done.has(`${h}>${a}`)) { const [x, y] = goals(h, a, false); add(h, a, x, y); }
      const last = [...four].sort((x, y) => { const a = pts.get(x); const b = pts.get(y); return b[0] - a[0] || b[1] - a[1] || b[2] - a[2] || b[3] - a[3] || b[4] - a[4]; });
      for (const id of last.slice(-R.relegate)) down[idx.get(id)]++;
    }
    // Mata-mata: a primeira rodada pelos lugares na primeira fase; as seguintes, chave fixa ou recruzamento.
    let pairs = format.bracket[0].pairs.map(([x, y]) => [seedOf.get(String(x)), seedOf.get(String(y))]);
    for (const [x, y] of pairs) { qualify[idx.get(x)]++; qualify[idx.get(y)]++; }
    let winners = [];
    format.bracket.forEach((round, r) => {
      if (r > 0) {
        if (round.pairing === 'reseed') {
          const list = [...winners].sort((x, y) => rankOf.get(x) - rankOf.get(y));
          pairs = [];
          for (let i = 0; i < list.length / 2; i++) pairs.push([list[i], list[list.length - 1 - i]]);
        } else {
          pairs = [];
          for (let i = 0; i + 1 < winners.length; i += 2) pairs.push([winners[i], winners[i + 1]]);
        }
      }
      for (const [x, y] of pairs) { reach[r][idx.get(x)]++; reach[r][idx.get(y)]++; }
      if (r === format.bracket.length - 1) for (const [x, y] of pairs) { fin[idx.get(x)]++; fin[idx.get(y)]++; }
      winners = pairs.map(([x, y]) => {
        const [hi, lo] = rankOf.get(x) <= rankOf.get(y) ? [x, y] : [y, x];
        const real = realTies.get(`${round.slug}|${pairKey(x, y)}`);
        if (real) return fromReal(real, round);
        return (round.legs || 1) === 2 ? twoLegs(hi, lo) : single(hi, lo, !!round.neutral);
      });
    });
    if (winners.length === 1) title[idx.get(winners[0])]++;
  }
  const byTeam = new Map(teams.map((id, i) => [id, { qualify: qualify[i] / runs, final: fin[i] / runs, title: title[i] / runs, relegate: down[i] / runs }]));
  return { byTeam, runs, firstLeft, teams, reach: reach.map((arr) => new Map(teams.map((id, i) => [id, arr[i] / runs]))) };
}
