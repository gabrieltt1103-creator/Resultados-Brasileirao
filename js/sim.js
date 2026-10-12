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

// Peso de cada janela na força do time: últimos 5 jogos, últimos 10 e a temporada (0 = todos).
// Escolhidos testando na temporada 2026: cada jogo previsto só com os jogos anteriores a ele.
export const WEIGHTS = [[0.40, 5], [0.35, 10], [0.25, 0]];
// Cada janela recebe K jogos "fictícios" na média, para poucos jogos não pesarem demais.
const K = 8;

/**
 * Força de ataque e de defesa de cada time (1 = média do campeonato) e vantagem de jogar em casa.
 * rows: tabela com todos os jogos encerrados (gp, gf, ga); events: jogos, para as janelas recentes.
 */
export function model(rows, events) {
  const list = [...rows.values()];
  const gp = list.reduce((s, r) => s + r.gp, 0);
  const goals = list.reduce((s, r) => s + r.gf, 0);
  const avg = gp ? Math.max(0.6, goals / gp) : 1.2;
  let hg = 0;
  let ag = 0;
  let n = 0;
  const recent = new Map();
  const done = events.filter((e) => e.status.kind === 'post' && e.home.score != null).sort((x, y) => x.date - y.date);
  for (const e of done) {
    hg += e.home.score;
    ag += e.away.score;
    n++;
    for (const [id, gf, ga] of [[e.home.id, e.home.score, e.away.score], [e.away.id, e.away.score, e.home.score]]) {
      if (!recent.has(id)) recent.set(id, []);
      recent.get(id).push([gf, ga]);
    }
  }
  const ratio = n >= 30 && ag > 0 ? Math.min(1.8, Math.max(1, hg / ag)) : 1.3;
  const rate = (r, i) => {
    let sum = 0;
    for (const [w, k] of WEIGHTS) {
      let total;
      let games;
      if (k) {
        const last = (recent.get(r.id) || []).slice(-k);
        total = last.reduce((s, g) => s + g[i], 0);
        games = last.length;
      } else {
        total = i === 0 ? r.gf : r.ga;
        games = r.gp;
      }
      sum += w * ((total + K * avg) / (games + K));
    }
    return sum / avg;
  };
  const att = new Map();
  const def = new Map();
  for (const r of list) {
    att.set(r.id, rate(r, 0));
    def.set(r.id, rate(r, 1));
  }
  return { avg, home: Math.sqrt(ratio), away: 1 / Math.sqrt(ratio), att, def };
}

export function expectedGoals(m, homeId, awayId) {
  return [
    m.avg * (m.att.get(homeId) ?? 1) * (m.def.get(awayId) ?? 1) * m.home,
    m.avg * (m.att.get(awayId) ?? 1) * (m.def.get(homeId) ?? 1) * m.away,
  ];
}

const FACT = [1, 1, 2, 6, 24, 120, 720, 5040, 40320, 362880, 3628800];
const pmf = (l, k) => Math.exp(-l) * l ** k / FACT[k];

/**
 * Chances de vitória do mandante, empate e vitória do visitante, e a matriz de placares finais.
 * Num jogo ao vivo, parte do placar atual e só considera os gols do tempo que falta.
 */
export function matchOdds(m, ev) {
  let [lh, la] = expectedGoals(m, ev.home.id, ev.away.id);
  let h0 = 0;
  let a0 = 0;
  if (ev.status.kind === 'live' && ev.home.score != null) {
    const f = remaining(ev);
    lh *= f;
    la *= f;
    h0 = ev.home.score;
    a0 = ev.away.score;
  }
  const scores = [];
  let home = 0;
  let draw = 0;
  let away = 0;
  for (let i = 0; i <= 10; i++) {
    for (let j = 0; j <= 10; j++) {
      const p = pmf(lh, i) * pmf(la, j);
      const h = h0 + i;
      const a = a0 + j;
      scores.push({ h, a, p });
      if (h > a) home += p; else if (h === a) draw += p; else away += p;
    }
  }
  const t = home + draw + away;
  return { home: home / t, draw: draw / t, away: away / t, scores, expected: [h0 + lh, a0 + la] };
}

// Jogo equilibrado (diferença menor que isso entre as chances dos dois times) vira sugestão de empate.
const DRAW_MARGIN = 0.08;

/**
 * Chances do jogo e o placar mais provável de cada resultado (1 = mandante, 0 = empate, -1 = visitante).
 * suggest: o resultado sugerido, que é o mais provável, ou empate se o jogo é equilibrado.
 */
export function matchPicks(m, ev) {
  const o = matchOdds(m, ev);
  const picks = {};
  for (const s of o.scores) {
    const k = Math.sign(s.h - s.a);
    if (!picks[k] || s.p > picks[k].p) picks[k] = s;
  }
  const suggest = Math.abs(o.home - o.away) < DRAW_MARGIN && picks[0] ? 0 : o.home > o.away ? 1 : -1;
  return { odds: o, picks, suggest };
}

/** Placar sugerido: o resultado mais provável (empate se o jogo é equilibrado) com o placar mais provável dentro dele. */
export function suggestScore(m, ev) {
  const { picks, suggest } = matchPicks(m, ev);
  const s = picks[suggest] || picks[1] || picks[-1];
  return { h: s.h, a: s.a };
}

/** Placar sorteado para um jogo (usado nas simulações do campeonato). */
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
