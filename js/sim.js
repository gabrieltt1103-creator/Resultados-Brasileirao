// Simulação do restante do campeonato (Monte Carlo) e sorteio de placares.
// Modelo simples de Poisson: força de ataque e de defesa de cada time pelos gols marcados e
// sofridos, com vantagem de jogar em casa medida nos próprios jogos da temporada.

export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function poisson(lambda, rand) {
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do { k++; p *= rand(); } while (p > L);
  return k - 1;
}

/** Força dos times a partir da tabela de jogos encerrados e dos placares em casa e fora. */
export function model(rows, events) {
  const list = [...rows.values()];
  const gp = list.reduce((s, r) => s + r.gp, 0);
  const goals = list.reduce((s, r) => s + r.gf, 0);
  const avg = gp ? Math.max(0.6, goals / gp) : 1.2;
  let hg = 0;
  let ag = 0;
  let n = 0;
  for (const e of events) {
    if (e.status.kind !== 'post' || e.home.score == null) continue;
    hg += e.home.score;
    ag += e.away.score;
    n++;
  }
  const ratio = n >= 30 && ag > 0 ? Math.min(1.8, Math.max(1, hg / ag)) : 1.3;
  const K = 6; // jogos "fictícios" na média, para não exagerar no começo do campeonato
  const att = new Map();
  const def = new Map();
  for (const r of list) {
    att.set(r.id, (r.gf + K * avg) / (r.gp + K) / avg);
    def.set(r.id, (r.ga + K * avg) / (r.gp + K) / avg);
  }
  return { avg, home: Math.sqrt(ratio), away: 1 / Math.sqrt(ratio), att, def };
}

export function expectedGoals(m, homeId, awayId) {
  return [
    m.avg * (m.att.get(homeId) ?? 1) * (m.def.get(awayId) ?? 1) * m.home,
    m.avg * (m.att.get(awayId) ?? 1) * (m.def.get(homeId) ?? 1) * m.away,
  ];
}

/** Placar sorteado para um jogo. */
export function randomScore(m, ev, rand = Math.random) {
  const [lh, la] = expectedGoals(m, ev.home.id, ev.away.id);
  return { h: poisson(lh, rand), a: poisson(la, rand) };
}

// Fração do jogo que ainda falta, pelo minuto exibido.
function remaining(ev) {
  if (ev.status.half) return 0.5;
  const m = /(\d+)/.exec(ev.status.label || '');
  if (!m) return 0.5;
  return Math.max(0, Math.min(1, (90 - Number(m[1])) / 90));
}

/**
 * Chances de cada time terminar em cada faixa da tabela.
 * finished: Map id -> linha com todos os jogos encerrados (precisa da temporada completa).
 * Devolve null quando não dá para saber quais jogos faltam.
 */
export function chances({ finished, events, overrides = {}, zones, runs = 4000, seed = 7 }) {
  const rows = [...finished.values()];
  const n = rows.length;
  if (n < 4) return null;
  const idx = new Map(rows.map((r, i) => [r.id, i]));
  const perTeam = 2 * (n - 1);

  const played = new Set();
  for (const e of events) if (e.status.kind === 'post' && e.home.score != null) played.add(`${e.home.id}|${e.away.id}`);

  const pts = new Float64Array(n);
  const w = new Float64Array(n);
  const gd = new Float64Array(n);
  const gf = new Float64Array(n);
  rows.forEach((r, i) => { pts[i] = r.pts; w[i] = r.w; gd[i] = r.gd; gf[i] = r.gf; });
  const fix = (h, a, hs, as) => {
    gf[h] += hs; gf[a] += as; gd[h] += hs - as; gd[a] += as - hs;
    if (hs > as) { pts[h] += 3; w[h]++; } else if (hs < as) { pts[a] += 3; w[a]++; } else { pts[h]++; pts[a]++; }
  };

  // Jogos fixados (simulados pelo usuário) e ao vivo (sorteia só o que falta).
  const m = model(finished, events);
  const live = [];
  const taken = new Set(played);
  for (const e of events) {
    const key = `${e.home.id}|${e.away.id}`;
    if (e.status.kind === 'post' || !idx.has(e.home.id) || !idx.has(e.away.id)) continue;
    const ov = overrides[e.id];
    if (ov) { fix(idx.get(e.home.id), idx.get(e.away.id), ov.h, ov.a); taken.add(key); } else if (e.status.kind === 'live' && e.home.score != null) {
      const [lh, la] = expectedGoals(m, e.home.id, e.away.id);
      const f = remaining(e);
      live.push([idx.get(e.home.id), idx.get(e.away.id), e.home.score, e.away.score, lh * f, la * f]);
      taken.add(key);
    }
  }

  // O que falta: todo par mandante x visitante que ainda não aconteceu (turno e returno).
  const left = [];
  for (const a of rows) {
    for (const b of rows) {
      if (a.id === b.id || taken.has(`${a.id}|${b.id}`)) continue;
      const [lh, la] = expectedGoals(m, a.id, b.id);
      left.push([idx.get(a.id), idx.get(b.id), lh, la]);
    }
  }
  // Conferência: cada time precisa somar 38 jogos (encerrados na tabela + fixados + ao vivo + restantes).
  // Se a tabela tem jogos que não estão na lista, não dá para saber quais confrontos faltam.
  const count = rows.map((r) => r.gp);
  for (const key of taken) {
    if (played.has(key)) continue;
    const [h, a] = key.split('|');
    count[idx.get(h)]++;
    count[idx.get(a)]++;
  }
  for (const [h, a] of left) { count[h]++; count[a]++; }
  if (count.some((c) => c !== perTeam)) return null;

  const rand = rng(seed);
  const posCount = new Uint32Array(n * n);
  const ptsSum = new Float64Array(n);
  const P = new Float64Array(n);
  const W = new Float64Array(n);
  const D = new Float64Array(n);
  const F = new Float64Array(n);
  const jitter = new Float64Array(n);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let s = 0; s < runs; s++) {
    P.set(pts); W.set(w); D.set(gd); F.set(gf);
    const play = (h, a, hs, as) => {
      F[h] += hs; F[a] += as; D[h] += hs - as; D[a] += as - hs;
      if (hs > as) { P[h] += 3; W[h]++; } else if (hs < as) { P[a] += 3; W[a]++; } else { P[h]++; P[a]++; }
    };
    for (const [h, a, hs, as, lh, la] of live) play(h, a, hs + poisson(lh, rand), as + poisson(la, rand));
    for (const [h, a, lh, la] of left) play(h, a, poisson(lh, rand), poisson(la, rand));
    for (let i = 0; i < n; i++) jitter[i] = rand();
    order.sort((x, y) => P[y] - P[x] || W[y] - W[x] || D[y] - D[x] || F[y] - F[x] || jitter[y] - jitter[x]);
    for (let p = 0; p < n; p++) posCount[order[p] * n + p]++;
    for (let i = 0; i < n; i++) ptsSum[i] += P[i];
  }

  const out = new Map();
  rows.forEach((r, i) => {
    const at = (p) => posCount[i * n + p - 1] / runs;
    let g = 0;
    for (let p = 1; p <= (zones?.g || 0); p++) g += at(p);
    let z = 0;
    if (zones?.zStart) for (let p = zones.zStart; p <= n; p++) z += at(p);
    out.set(r.id, { title: at(1), g, z, pts: ptsSum[i] / runs });
  });
  return { byId: out, runs, left: left.length + live.length };
}
