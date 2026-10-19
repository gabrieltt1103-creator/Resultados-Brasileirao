// Simulação do restante do campeonato (Monte Carlo) e sorteio de placares.
// Modelo de Poisson: força de ataque e de defesa de cada time pelos gols e chutes no gol, descontando a
// força dos adversários, com o mando de campo medido na temporada e a temporada anterior como ponto de partida.

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

// Força dos times, com os parâmetros escolhidos testando de 2015 a 2026 (cada jogo e cada fim de campeonato
// previstos só com o que se sabia antes):
const HALF_LIFE = 240;   // dias: um jogo de 8 meses atrás pesa metade
const K_PRIOR = 20;      // jogos fictícios na força de partida (a da temporada anterior)
const K_FLAT = 10;       // sem a temporada anterior, jogos fictícios na média do campeonato
const SHOTS = 0.25;      // peso dos chutes no gol (convertidos em gols) junto com os gols
const CARRY = 0.8;       // a força do ano anterior, puxada para a média (expoente)
// Quem subiu da Série B começa com a força média dos que subiram de 2015 a 2026.
export const PROMOTED = { att: 0.89, def: 1.1 };

const sotOf = (side) => side.sot ?? side.stats?.shotsOnTarget;

/**
 * Ajuste de Poisson (Maher, Dixon-Coles): ataque e defesa de cada time descontando a força de quem ele
 * enfrentou, mando de campo medido na amostra, jogos antigos pesando menos e K jogos fictícios na força de
 * partida (prior, Map id -> {att, def}; sem ela, 1 = média). Os gols de cada jogo entram misturados com os
 * chutes no gol daquele jogo (mais estáveis que os gols). Devolve {avg, home, away, att, def}.
 */
function fit(games, ids, { prior = null, K = K_FLAT, half = HALF_LIFE } = {}) {
  const n = ids.length;
  const at = new Map(ids.map((id, i) => [id, i]));
  const list = games.filter((e) => at.has(e.home.id) && at.has(e.away.id));
  const t0 = list.reduce((m, e) => Math.max(m, +e.date || 0), 0);
  let goals = 0;
  let shots = 0;
  for (const e of list) {
    const h = sotOf(e.home);
    const a = sotOf(e.away);
    if (h != null && a != null) { goals += e.home.score + e.away.score; shots += h + a; }
  }
  const conv = shots ? goals / shots : 0.3; // gols por chute no gol
  const value = (score, sot) => (sot != null && shots ? (1 - SHOTS) * score + SHOTS * conv * sot : score);
  const G = list.map((e) => ({
    h: at.get(e.home.id), a: at.get(e.away.id),
    hs: value(e.home.score, sotOf(e.home)), as: value(e.away.score, sotOf(e.away)),
    w: half && t0 ? 0.5 ** ((t0 - (+e.date || t0)) / 864e5 / half) : 1,
  }));
  const W = G.reduce((s, g) => s + g.w, 0);
  const avg = W ? Math.max(0.6, G.reduce((s, g) => s + g.w * (g.hs + g.as), 0) / (2 * W)) : 1.2;
  const p0 = (k) => ids.map((id) => prior?.get(id)?.[k] ?? (prior ? PROMOTED[k] : 1));
  const pa = p0('att');
  const pd = p0('def');
  const att = Float64Array.from(pa);
  const def = Float64Array.from(pd);
  let hf = 1.14; // sem jogos suficientes, o mando de sempre (1,3 gol do mandante para cada 1 do visitante)
  let af = 0.88;
  const y = new Float64Array(n);
  const x = new Float64Array(n);
  for (let it = 0; it < 30; it++) {
    if (G.length >= 30) {
      let hy = 0, he = 0, ay = 0, ae = 0;
      for (const g of G) {
        hy += g.w * g.hs; he += g.w * avg * att[g.h] * def[g.a];
        ay += g.w * g.as; ae += g.w * avg * att[g.a] * def[g.h];
      }
      hf = hy / he;
      af = ay / ae;
    }
    // Ataque: gols feitos sobre os esperados contra aquelas defesas; depois a defesa, contra aqueles ataques.
    y.fill(0); x.fill(0);
    for (const g of G) {
      y[g.h] += g.w * g.hs; x[g.h] += g.w * avg * def[g.a] * hf;
      y[g.a] += g.w * g.as; x[g.a] += g.w * avg * def[g.h] * af;
    }
    for (let i = 0; i < n; i++) att[i] = (y[i] + K * avg * pa[i]) / (x[i] + K * avg);
    y.fill(0); x.fill(0);
    for (const g of G) {
      y[g.a] += g.w * g.hs; x[g.a] += g.w * avg * att[g.h] * hf;
      y[g.h] += g.w * g.as; x[g.h] += g.w * avg * att[g.a] * af;
    }
    for (let i = 0; i < n; i++) def[i] = (y[i] + K * avg * pd[i]) / (x[i] + K * avg);
    // Média geométrica 1 no ataque e na defesa: o nível do campeonato fica em avg e no mando.
    for (const v of [att, def]) {
      const gm = Math.exp(v.reduce((s, z) => s + Math.log(z), 0) / n);
      for (let i = 0; i < n; i++) v[i] /= gm;
    }
  }
  // Nível: os gols esperados somam os gols da amostra.
  let exp = 0;
  let real = 0;
  for (const g of G) {
    exp += g.w * avg * (att[g.h] * def[g.a] * hf + att[g.a] * def[g.h] * af);
    real += g.w * (g.hs + g.as);
  }
  return {
    avg: avg * (exp ? real / exp : 1),
    home: hf,
    away: af,
    att: new Map(ids.map((id, i) => [id, att[i]])),
    def: new Map(ids.map((id, i) => [id, def[i]])),
  };
}

const done = (events) => events.filter((e) => e.status.kind === 'post' && e.home.score != null && e.away.score != null);

/**
 * Força de ataque e de defesa de cada time (1 = média do campeonato) e vantagem de jogar em casa.
 * rows: tabela (os times); events: jogos da temporada; prior: força de partida pela temporada anterior
 * (priorFrom), que pesa como K_PRIOR jogos, com quem subiu na força média dos que sobem.
 */
export function model(rows, events, prior = null) {
  return fit(done(events), [...rows.keys()], prior?.size ? { prior, K: K_PRIOR } : {});
}

/**
 * Força de partida para a temporada seguinte, pelos jogos da temporada anterior: a força final de cada
 * time, puxada para a média. Map id -> {att, def}.
 */
export function priorFrom(events) {
  const games = done(events);
  const ids = [...new Set(games.flatMap((e) => [e.home.id, e.away.id]))];
  if (ids.length < 4 || games.length < ids.length * 4) return null;
  const m = fit(games, ids, { half: 0 });
  return new Map(ids.map((id) => [id, { att: m.att.get(id) ** CARRY, def: m.def.get(id) ** CARRY }]));
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
 * Ponto de partida das simulações: a tabela com os jogos encerrados e os fixados pelo usuário, os
 * jogos ao vivo (com o que falta sortear) e todo confronto que ainda não aconteceu.
 * Devolve null quando não dá para saber quais jogos faltam.
 */
function prepare({ finished, events, overrides = {}, prior = null }) {
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
  const m = model(finished, events, prior);
  const live = [];
  const taken = new Set(played);
  for (const e of events) {
    const key = `${e.home.id}|${e.away.id}`;
    if (e.status.kind === 'post' || !idx.has(e.home.id) || !idx.has(e.away.id)) continue;
    const ov = overrides[e.id];
    if (ov) { fix(idx.get(e.home.id), idx.get(e.away.id), ov.h, ov.a); taken.add(key); } else if (e.status.kind === 'live' && e.home.score != null) {
      const [lh, la] = expectedGoals(m, e.home.id, e.away.id);
      const f = remaining(e);
      live.push([idx.get(e.home.id), idx.get(e.away.id), e.home.score, e.away.score, lh * f, la * f, e.id]);
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
  return { rows, n, idx, pts, w, gd, gf, live, left, spread: spreadFor(left.length + live.length, n) };
}

// Incerteza da força: em cada campeonato sorteado, a força de cada time varia um pouco (desvio do log do
// ataque e da defesa), mais quando falta muito campeonato: a força medida tem erro e muda até o fim (técnico,
// lesões, reforços). Sem isso, as chances ficavam confiantes demais: o que o modelo dava como menos de 2%
// acontecia 5 vezes mais do que isso (temporadas de 2015 a 2025).
const spreadFor = (left, n) => 0.02 + 0.15 * Math.sqrt(Math.min(1, left / Math.max(1, n * (n - 1))));

function gauss(rand) {
  let u = 0;
  while (u === 0) u = rand();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
}

// Sorteia a força de cada time para um campeonato: fator do ataque (ea) e da defesa (ed).
function jolt(ea, ed, spread, rand) {
  for (let i = 0; i < ea.length; i++) {
    ea[i] = Math.exp(spread * gauss(rand));
    ed[i] = Math.exp(spread * gauss(rand));
  }
}

/**
 * Chances de cada time terminar em cada faixa da tabela.
 * finished: Map id -> linha com todos os jogos encerrados (precisa da temporada completa).
 * Devolve null quando não dá para saber quais jogos faltam.
 */
export function chances({ finished, events, overrides = {}, zones, runs = 4000, seed = 7, prior = null }) {
  const prep = prepare({ finished, events, overrides, prior });
  if (!prep) return null;
  const { rows, n, pts, w, gd, gf, live, left, spread } = prep;

  const rand = rng(seed);
  const posCount = new Uint32Array(n * n);
  const ptsSum = new Float64Array(n);
  const P = new Float64Array(n);
  const W = new Float64Array(n);
  const D = new Float64Array(n);
  const F = new Float64Array(n);
  const jitter = new Float64Array(n);
  const ea = new Float64Array(n);
  const ed = new Float64Array(n);
  const order = Array.from({ length: n }, (_, i) => i);
  for (let s = 0; s < runs; s++) {
    P.set(pts); W.set(w); D.set(gd); F.set(gf);
    jolt(ea, ed, spread, rand);
    const play = (h, a, hs, as) => {
      F[h] += hs; F[a] += as; D[h] += hs - as; D[a] += as - hs;
      if (hs > as) { P[h] += 3; W[h]++; } else if (hs < as) { P[a] += 3; W[a]++; } else { P[h]++; P[a]++; }
    };
    for (const [h, a, hs, as, lh, la] of live) play(h, a, hs + poisson(lh * ea[h] * ed[a], rand), as + poisson(la * ea[a] * ed[h], rand));
    for (const [h, a, lh, la] of left) play(h, a, poisson(lh * ea[h] * ed[a], rand), poisson(la * ea[a] * ed[h], rand));
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

// Resultado testado em cada jogo do secador: vitória do mandante, empate, vitória do visitante.
// Quando o placar sorteado já é desse resultado, fica ele; senão, o placar mais comum do resultado.
const OUTCOMES = [(h, a) => (h > a ? [h, a] : [1, 0]), (h, a) => (h === a ? [h, a] : [1, 1]), (h, a) => (h < a ? [h, a] : [0, 1])];

/**
 * Secador: para cada jogo escolhido, a chance de cada time pedido terminar campeão, no G e no Z com
 * cada resultado (vitória do mandante, empate, vitória do visitante), sem os placares simulados pelo
 * usuário. Os três resultados são testados no mesmo sorteio do resto do campeonato (números
 * aleatórios comuns): a diferença entre eles vem só do jogo trocado, sem o ruído de sorteios diferentes.
 * Jogo já encerrado também entra: troca o placar real pelo resultado testado.
 * teamIds: o time do torcedor e os rivais.
 * Devolve {runs, teams: {id: {base: {title, g, z}, games: [{id, title: [m, e, v], g: [...], z: [...]}]}}} ou null.
 */
export function secador({ finished, events, targets, teamIds, zones, runs = 4000, seed = 11, prior = null }) {
  const prep = prepare({ finished, events, prior });
  if (!prep) return null;
  const { n, idx, pts, w, gd, gf, live, left, spread } = prep;
  const ids = teamIds.filter((id, i) => idx.has(id) && teamIds.indexOf(id) === i);
  if (!ids.length) return null;
  const who = ids.map((id) => idx.get(id));
  const byId = new Map(events.map((e) => [e.id, e]));
  const leftAt = new Map(left.map((g, k) => [`${g[0]}|${g[1]}`, k]));
  const liveAt = new Map(live.map((g, k) => [g[6], k]));
  const tg = [];
  for (const id of targets) {
    const e = byId.get(id);
    if (!e || !idx.has(e.home.id) || !idx.has(e.away.id)) continue;
    const h = idx.get(e.home.id);
    const a = idx.get(e.away.id);
    if (e.status.kind === 'post') {
      if (e.home.score != null && e.away.score != null) tg.push({ id, h, a, done: [e.home.score, e.away.score] });
    } else if (liveAt.has(id)) tg.push({ id, h, a, live: liveAt.get(id) });
    else if (leftAt.has(`${h}|${a}`)) tg.push({ id, h, a, left: leftAt.get(`${h}|${a}`) });
  }

  const g = zones?.g || 0;
  const zFrom = zones?.zStart ? zones.zStart - 1 : Infinity;
  const rand = rng(seed);
  const P = new Float64Array(n);
  const W = new Float64Array(n);
  const D = new Float64Array(n);
  const F = new Float64Array(n);
  const J = new Float64Array(n);
  const ea = new Float64Array(n);
  const ed = new Float64Array(n);
  const liveRes = new Int32Array(live.length * 2);
  const leftRes = new Int32Array(left.length * 2);
  const T = ids.length;
  const base = new Uint32Array(T * 3);
  const hit = new Uint32Array(T * tg.length * 9);
  const add = (h, a, hs, as, s) => {
    F[h] += s * hs; F[a] += s * as; D[h] += s * (hs - as); D[a] += s * (as - hs);
    if (hs > as) { P[h] += 3 * s; W[h] += s; } else if (hs < as) { P[a] += 3 * s; W[a] += s; } else { P[h] += s; P[a] += s; }
  };
  // Posição do time m (0 = líder), com os mesmos critérios de desempate de chances().
  const rank = (m) => {
    let r = 0;
    for (let j = 0; j < n; j++) {
      if (j === m) continue;
      if (P[j] > P[m] || (P[j] === P[m] && (W[j] > W[m] || (W[j] === W[m] && (D[j] > D[m] || (D[j] === D[m] && (F[j] > F[m] || (F[j] === F[m] && J[j] > J[m])))))))) r++;
    }
    return r;
  };
  const tally = (out, at) => {
    for (let k = 0; k < T; k++) {
      const r = rank(who[k]);
      const i = at(k);
      if (r === 0) out[i]++;
      if (r < g) out[i + 1]++;
      if (r >= zFrom) out[i + 2]++;
    }
  };
  for (let s = 0; s < runs; s++) {
    P.set(pts); W.set(w); D.set(gd); F.set(gf);
    jolt(ea, ed, spread, rand);
    live.forEach(([h, a, hs, as, lh, la], k) => {
      const x = hs + poisson(lh * ea[h] * ed[a], rand);
      const y = as + poisson(la * ea[a] * ed[h], rand);
      liveRes[2 * k] = x; liveRes[2 * k + 1] = y;
      add(h, a, x, y, 1);
    });
    left.forEach(([h, a, lh, la], k) => {
      const x = poisson(lh * ea[h] * ed[a], rand);
      const y = poisson(la * ea[a] * ed[h], rand);
      leftRes[2 * k] = x; leftRes[2 * k + 1] = y;
      add(h, a, x, y, 1);
    });
    for (let i = 0; i < n; i++) J[i] = rand();
    tally(base, (k) => k * 3);
    tg.forEach((t, ti) => {
      const [x, y] = t.done || (t.live != null ? [liveRes[2 * t.live], liveRes[2 * t.live + 1]] : [leftRes[2 * t.left], leftRes[2 * t.left + 1]]);
      add(t.h, t.a, x, y, -1);
      OUTCOMES.forEach((pick, o) => {
        const [hs, as] = pick(x, y);
        add(t.h, t.a, hs, as, 1);
        tally(hit, (k) => (k * tg.length + ti) * 9 + o * 3);
        add(t.h, t.a, hs, as, -1);
      });
      add(t.h, t.a, x, y, 1);
    });
  }
  const teams = {};
  ids.forEach((id, k) => {
    const at = (ti, o, j) => hit[(k * tg.length + ti) * 9 + o * 3 + j] / runs;
    const three = (ti, j) => [0, 1, 2].map((o) => at(ti, o, j));
    teams[id] = {
      base: { title: base[k * 3] / runs, g: base[k * 3 + 1] / runs, z: base[k * 3 + 2] / runs },
      games: tg.map((t, ti) => ({ id: t.id, title: three(ti, 0), g: three(ti, 1), z: three(ti, 2) })),
    };
  });
  return { runs, teams };
}
