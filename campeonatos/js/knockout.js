// Chances no mata-mata: sorteia os confrontos que faltam (ida e volta, final em jogo único com
// prorrogação e pênaltis) com a força de cada time, do mesmo modelo das chances do Brasileirão.
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

// Fração do jogo que ainda falta, pelo minuto exibido (intervalo: metade).
function remaining(ev) {
  if (ev.status.half) return 0.5;
  const m = /(\d+)/.exec(ev.status.label || '');
  if (!m) return 0.5;
  return Math.max(0, Math.min(1, (90 - Number(m[1])) / 90));
}

/**
 * Fase de onde as contas partem: a primeira de mata-mata com confronto em aberto (times já definidos).
 * Devolve {idx, ties} ou null quando o mata-mata acabou ou ainda não tem confrontos definidos.
 */
export function openPhase(phases) {
  for (let i = 0; i < phases.length; i++) {
    const p = phases[i];
    if (!p.knockout) continue;
    const ties = tiesOf(p.events);
    if (!ties.length || ties.every((t) => t.done)) continue;
    if (ties.some((t) => t.tbd)) return null;
    return { idx: i, ties };
  }
  return null;
}

/**
 * Chances de passar da fase em aberto, de chegar à final e de ser campeão.
 * phases: fases da competição (phasesOf); comp: a competição (finalSingle: final em jogo único, em campo neutro);
 * lambda(homeId, awayId, neutral) -> [gols esperados do mandante, do visitante], ou null sem força conhecida.
 * spread: incerteza da força (desvio do log do ataque e da defesa, sorteado a cada simulação).
 * Devolve {phase, ties: [{key, a, b, p: {id: chance de passar}}], byTeam: Map id -> {next, final, title}, runs}
 * ou null (mata-mata encerrado, confronto indefinido ou time sem força conhecida).
 */
export function knockoutOdds({ phases, comp, lambda, runs = 10000, seed = 5, spread = 0.05 }) {
  const open = openPhase(phases);
  if (!open) return null;
  const { idx, ties } = open;
  const phase = phases[idx];
  const teams = ties.flatMap((t) => [t.a.id, t.b.id]);
  // A força tem que ser conhecida para todo mundo que ainda pode cruzar com todo mundo.
  for (const x of teams) for (const y of teams) if (x !== y && !lambda(x, y, false)) return null;
  const isFinal = (n) => n === 2;
  const finalHere = /^final/.test(phase.slug) || (ties.length === 1 && phases.slice(idx + 1).every((p) => !p.knockout));
  const rand = rng(seed);
  const ea = new Map();
  const ed = new Map();
  const goals = (h, a, neutral, f = 1) => {
    const l = lambda(h, a, neutral);
    return [poisson(l[0] * ea.get(h) * ed.get(a) * f, rand), poisson(l[1] * ea.get(a) * ed.get(h) * f, rand)];
  };
  // Jogo único em campo neutro: 90 minutos, prorrogação (um terço de jogo) e pênaltis.
  const single = (x, y) => {
    let [gx, gy] = goals(x, y, true);
    if (gx === gy) [gx, gy] = goals(x, y, true, 1 / 3);
    if (gx !== gy) return gx > gy ? x : y;
    return rand() < 0.5 ? x : y;
  };
  // Ida e volta, sem gol fora de casa: empate no agregado vai para os pênaltis.
  const twoLegs = (x, y) => {
    const [a1, b1] = goals(x, y, false);
    const [b2, a2] = goals(y, x, false);
    if (a1 + a2 !== b1 + b2) return a1 + a2 > b1 + b2 ? x : y;
    return rand() < 0.5 ? x : y;
  };
  const next = new Map(teams.map((id) => [id, 0]));
  const fin = new Map(teams.map((id) => [id, 0]));
  const title = new Map(teams.map((id) => [id, 0]));
  const tieWins = ties.map(() => 0);
  for (let s = 0; s < runs; s++) {
    for (const id of teams) { ea.set(id, Math.exp(spread * gauss(rand))); ed.set(id, Math.exp(spread * gauss(rand))); }
    // Fase em aberto: o que já foi jogado vale; jogo ao vivo, só o que falta; o resto é sorteado.
    const alive = [];
    ties.forEach((t, k) => {
      if (t.done) { alive.push(t.winner); if (t.winner === t.a.id) tieWins[k]++; return; }
      const agg = { [t.a.id]: 0, [t.b.id]: 0 };
      for (const e of t.legs) {
        if (e.status.kind === 'post') { agg[e.home.id] += e.home.score ?? 0; agg[e.away.id] += e.away.score ?? 0; continue; }
        const neutral = t.legsTotal === 1 && comp?.finalSingle && finalHere;
        const f = e.status.kind === 'live' ? remaining(e) : 1;
        const [gh, ga] = goals(e.home.id, e.away.id, neutral, f);
        agg[e.home.id] += (e.status.kind === 'live' ? e.home.score ?? 0 : 0) + gh;
        agg[e.away.id] += (e.status.kind === 'live' ? e.away.score ?? 0 : 0) + ga;
      }
      // Volta que a ESPN ainda não listou: o mandante da ida joga fora.
      if (t.legs.length < t.legsTotal) {
        const [gb, gaa] = goals(t.b.id, t.a.id, false);
        agg[t.b.id] += gb;
        agg[t.a.id] += gaa;
      }
      let w;
      if (agg[t.a.id] !== agg[t.b.id]) w = agg[t.a.id] > agg[t.b.id] ? t.a.id : t.b.id;
      else if (t.legsTotal === 1 && finalHere) {
        // Final única empatada: prorrogação, depois pênaltis.
        const [x, y] = goals(t.a.id, t.b.id, !!comp?.finalSingle, 1 / 3);
        w = x !== y ? (x > y ? t.a.id : t.b.id) : rand() < 0.5 ? t.a.id : t.b.id;
      } else w = rand() < 0.5 ? t.a.id : t.b.id;
      alive.push(w);
      if (w === t.a.id) tieWins[k]++;
    });
    for (const id of alive) next.set(id, next.get(id) + 1);
    // Fases seguintes: os vencedores se cruzam (sorteio, como na Copa do Brasil), até sobrar o campeão.
    let left = alive;
    if (finalHere) for (const id of teams) if (ties.some((t) => t.a.id === id || t.b.id === id)) fin.set(id, fin.get(id) + 1);
    while (left.length > 1) {
      if (isFinal(left.length)) for (const id of left) fin.set(id, fin.get(id) + 1);
      const pool = [...left];
      for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rand() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
      const won = [];
      for (let i = 0; i + 1 < pool.length; i += 2) {
        const last = pool.length === 2;
        won.push(last && comp?.finalSingle ? single(pool[i], pool[i + 1]) : twoLegs(pool[i], pool[i + 1]));
      }
      if (pool.length % 2) won.push(pool[pool.length - 1]);
      left = won;
    }
    if (left.length === 1) title.set(left[0], title.get(left[0]) + 1);
  }
  const byTeam = new Map(teams.map((id) => [id, { next: next.get(id) / runs, final: fin.get(id) / runs, title: title.get(id) / runs }]));
  return {
    phase,
    final: finalHere,
    ties: ties.map((t, k) => ({ key: t.key, a: t.a, b: t.b, done: t.done, p: { [t.a.id]: tieWins[k] / runs, [t.b.id]: 1 - tieWins[k] / runs } })),
    byTeam,
    runs,
  };
}
