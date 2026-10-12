// Leitura da rodada: histórias de cada jogo, manchetes e números.
import { formOf, formPoints } from './table.js';
import { ao, doo, kickoff, o, plural, scoreText } from './util.js';

const started = (e) => (e.status.kind === 'post' || e.status.kind === 'live') && e.home.score != null && e.away.score != null;
const ord = (n) => `${n}º`;
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pts = (n) => `${n} ${n === 1 ? 'ponto' : 'pontos'}`;
const scoreOf = (ev) => `${ev.home.score}–${ev.away.score}`;

/** O que aconteceu de especial num jogo: virada, goleada, hat-trick, gol no fim, zebra. */
export function matchStory(ev, rankOf) {
  const s = {};
  if (!started(ev)) return s;
  const h = ev.home.score;
  const a = ev.away.score;
  const goals = ev.incidents.filter((i) => i.kind === 'goal');
  const winner = h > a ? ev.home : a > h ? ev.away : null;
  const loser = winner === ev.home ? ev.away : winner === ev.away ? ev.home : null;

  if (ev.goalsComplete && goals.length) {
    let ch = 0;
    let ca = 0;
    let trailed = false;
    const prog = [];
    for (const g of goals) {
      if (g.team === ev.home.id) ch++; else ca++;
      if (winner && (winner === ev.home ? ch < ca : ca < ch)) trailed = true;
      prog.push([ch, ca]);
    }
    if (winner && trailed) s.virada = { winner, loser };

    // Último gol aos 88' ou depois que mudou o resultado.
    const last = goals[goals.length - 1];
    const [bh, ba] = prog.length > 1 ? prog[prog.length - 2] : [0, 0];
    const before = Math.sign(bh - ba);
    if (last.min.base >= 88 && before !== Math.sign(h - a)) {
      const team = last.team === ev.home.id ? ev.home : ev.away;
      s.late = { who: last.who, min: last.min.label, team, effect: h === a ? 'empate' : 'vitória' };
    }
  }
  if (Math.abs(h - a) >= 3) s.goleada = true;
  if (h + a >= 6) s.maluco = true;

  const byPlayer = new Map();
  for (const g of goals) {
    if (g.og || !g.who) continue;
    const k = `${g.who}|${g.team}`;
    byPlayer.set(k, { who: g.who, team: g.team === ev.home.id ? ev.home : ev.away, n: (byPlayer.get(k)?.n || 0) + 1 });
  }
  const hat = [...byPlayer.values()].filter((p) => p.n >= 3);
  if (hat.length) s.hattricks = hat;

  if (winner && rankOf) {
    const wr = rankOf(winner.id);
    const lr = rankOf(loser.id);
    if (wr && lr && wr - lr >= 10) s.zebra = { winner, loser, wr, lr };
  }
  return s;
}

/**
 * O que mudou no placar de um jogo que estava ao vivo (vale também para o gol no último lance antes
 * do apito final). before: {h, a, kind} da leitura anterior.
 * Devolve null, {sides: Set('home'|'away')} para gol ou {annulled: true} quando o placar desceu.
 */
export function scoreChange(before, ev) {
  if (!before || before.kind !== 'live' || (ev.status.kind !== 'live' && ev.status.kind !== 'post')) return null;
  const h = ev.home.score ?? 0;
  const a = ev.away.score ?? 0;
  if (h < before.h || a < before.a) return { annulled: true };
  const sides = new Set();
  if (h > before.h) sides.add('home');
  if (a > before.a) sides.add('away');
  return sides.size ? { sides } : null;
}

/** Lance do último gol do time, só se a ESPN já registrou todos os gols dele (senão seria o do gol anterior). */
export function lastGoal(ev, team) {
  const goals = ev.incidents.filter((i) => i.kind === 'goal' && i.team === team.id);
  return goals.length && goals.length === (team.score ?? 0) ? goals[goals.length - 1] : null;
}

/** Etiquetas curtas para o cartão do jogo. */
export function storyTags(s) {
  const tags = [];
  if (s.virada) tags.push('Virada');
  if (s.zebra) tags.push('Zebra');
  if (s.hattricks) tags.push('Hat-trick');
  if (s.late) tags.push('Gol no fim');
  if (s.goleada) tags.push('Goleada');
  else if (s.maluco) tags.push('Chuva de gols');
  return tags;
}

/**
 * Manchetes da rodada, da mais importante para a menos.
 * focus: true quando é a rodada em andamento (a tabela ao vivo vale para ela).
 */
export function headlines({ round, table, zones, focus, now = new Date() }) {
  const items = [];
  // big: destaque curto da manchete (minuto, placar, sigla da zona), usado pela v2.
  const add = (prio, tag, text, ev, tone = 'gol', big = '') => items.push({ prio, tag, text, tone, big, ev: ev?.id || null, t: ev?.date?.getTime?.() || 0 });
  const rankOf = table && focus ? (id) => table.preById.get(id)?.pos : null;
  const liveRank = table ? (id) => table.byId.get(id)?.pos : null;

  if (focus && table?.started) {
    const pre = table.pre;
    const rows = table.rows;
    const leader = rows[0];
    // Condicional quando a mudança ainda depende de jogo em andamento.
    const pending = (r, inside) => inside(table.settledPos.get(r.id)) !== inside(r.pos);
    if (pre[0].id !== leader.id) {
      const ifNow = pending(leader, (p) => p === 1);
      add(10, 'Líder', ifNow ? `Se terminar assim, ${leader.name} assume a liderança` : `${leader.name} assumiu a liderança`, leader.result?.ev, 'good', '1º');
    } else if (leader.result) {
      const gap = leader.pts - rows[1].pts;
      add(6, 'Líder', `${leader.name} ${table.anyLive ? 'segue' : 'continua'} líder, ${gap} ${gap === 1 ? 'ponto' : 'pontos'} à frente ${doo(rows[1].name)}`, leader.result.ev, 'good', `${leader.pts} pts`);
    }
    const zoneMoves = (limit, inside, label, prio, tone) => {
      if (!limit) return;
      for (const r of rows) {
        const was = inside(r.prePos);
        const is = inside(r.pos);
        if (was === is) continue;
        const enter = is;
        const text = pending(r, inside)
          ? `Se terminar assim, ${r.name} ${enter ? 'entra no' : 'sai do'} ${label}`
          : `${r.name} ${enter ? 'entrou no' : 'saiu do'} ${label}`;
        add(prio, label, text, r.result?.ev, tone, label);
      }
    };
    zoneMoves(zones?.zStart, (p) => p >= zones.zStart, zones?.zLabel, 9, 'bad');
    zoneMoves(zones?.g, (p) => p <= zones.g, zones?.gLabel, 8, 'good');
  }

  for (const ev of round.events) {
    if (!started(ev)) continue;
    const live = ev.status.kind === 'live';
    const s = matchStory(ev, rankOf);
    const score = `${ev.home.name} ${ev.home.score} x ${ev.away.score} ${ev.away.name}`;
    if (s.virada) {
      const { winner, loser } = s.virada;
      const sc = scoreText(Math.max(ev.home.score, ev.away.score), Math.min(ev.home.score, ev.away.score));
      add(7, 'Virada', live ? `${winner.name} buscou a virada e vence ${o(loser.name)} por ${sc}` : `${winner.name} virou e venceu ${o(loser.name)} por ${sc}`, ev, 'gol', scoreOf(ev));
    }
    if (s.zebra) {
      const { winner, loser, wr, lr } = s.zebra;
      add(7, 'Zebra', `${winner.name} (${ord(wr)}) ${live ? 'vence' : 'venceu'} ${o(loser.name)} (${ord(lr)})`, ev, 'gol', scoreOf(ev));
    }
    if (s.late) {
      const { who, min, team, effect } = s.late;
      add(6, 'Gol no fim', `${who || team.name} marcou aos ${min} e ${effect === 'empate' ? `garantiu o empate ${doo(team.name)}` : `deu a vitória ${ao(team.name)}`}`, ev, 'gol', min);
    }
    for (const p of s.hattricks || []) add(6, 'Hat-trick', `${p.n === 3 ? 'Hat-trick' : `${p.n} gols`} de ${p.who} (${p.team.name})`, ev, 'gol', `${p.n} gols`);
    if (s.goleada) add(5, 'Goleada', live ? `Goleada em andamento: ${score}` : `Goleada: ${score}`, ev, 'gol', scoreOf(ev));
    else if (s.maluco) add(4, 'Chuva de gols', `Jogo de ${ev.home.score + ev.away.score} gols: ${score}`, ev, 'gol', `${ev.home.score + ev.away.score} gols`);
  }

  // Prévia dos jogos que ainda vão acontecer.
  if (table) {
    const upcoming = round.events.filter((e) => e.status.kind === 'pre');
    const pos = (t) => liveRank(t.id);
    const best = (filter, score) => upcoming.filter(filter).sort((x, y) => score(x) - score(y))[0];
    const big = best((e) => pos(e.home) <= 6 && pos(e.away) <= 6, (e) => pos(e.home) + pos(e.away));
    const prio = table.started ? 3 : 5;
    if (big) add(prio, 'Jogão', `${big.home.name} (${ord(pos(big.home))}) x ${big.away.name} (${ord(pos(big.away))}), ${kickoff(big.date, now)}`, big, 'plain', `${ord(pos(big.home))} x ${ord(pos(big.away))}`);
    const low = zones?.zStart ? zones.zStart - 2 : 15;
    const fight = best((e) => pos(e.home) >= low && pos(e.away) >= low, (e) => -(pos(e.home) + pos(e.away)));
    if (fight) add(prio, 'Contra a queda', `${fight.home.name} (${ord(pos(fight.home))}) x ${fight.away.name} (${ord(pos(fight.away))}), ${kickoff(fight.date, now)}`, fight, 'plain', `${ord(pos(fight.home))} x ${ord(pos(fight.away))}`);
    if (!table.started) {
      const leader = table.rows[0];
      const g = upcoming.find((e) => e.home.id === leader.id || e.away.id === leader.id);
      if (g && g !== big) {
        const opp = g.home.id === leader.id ? g.away : g.home;
        add(4, 'Líder', `Líder com ${leader.pts} pontos, ${o(leader.name)} pega ${o(opp.name)} (${ord(pos(opp))}) ${kickoff(g.date, now)}`, g, 'plain', `${leader.pts} pts`);
      }
    }
  }

  items.sort((x, y) => y.prio - x.prio || x.t - y.t);
  const perGame = new Map();
  return items.filter((i) => {
    if (!i.ev || ['good', 'bad'].includes(i.tone)) return true;
    perGame.set(i.ev, (perGame.get(i.ev) || 0) + 1);
    return perGame.get(i.ev) <= 2;
  }).slice(0, 6);
}

const BUCKETS = ['0–15', '16–30', '31–45', '46–60', '61–75', '76–90'];
export const bucketLabels = BUCKETS;
const bucketOf = (base) => (base <= 15 ? 0 : base <= 30 ? 1 : base <= 45 ? 2 : base <= 60 ? 3 : base <= 75 ? 4 : 5);

/** Números da rodada a partir dos jogos já iniciados. */
export function roundStats(round) {
  const games = round.events.filter(started);
  const st = {
    games: games.length,
    live: games.filter((e) => e.status.kind === 'live').length,
    goals: 0,
    homeW: 0,
    draws: 0,
    awayW: 0,
    buckets: BUCKETS.map(() => 0),
    timed: 0,
    reds: 0,
    yellows: 0,
    scorers: [],
    biggest: null,
    mostGoals: null,
    zeroes: 0,
  };
  const scorers = new Map();
  for (const ev of games) {
    const h = ev.home.score;
    const a = ev.away.score;
    st.goals += h + a;
    if (h > a) st.homeW++; else if (h === a) st.draws++; else st.awayW++;
    if (h + a === 0) st.zeroes++;
    if (Math.abs(h - a) >= 2 && (!st.biggest || Math.abs(h - a) > st.biggest.margin || (Math.abs(h - a) === st.biggest.margin && h + a > st.biggest.total))) {
      st.biggest = { ev, margin: Math.abs(h - a), total: h + a };
    }
    if (h + a >= 3 && (!st.mostGoals || h + a > st.mostGoals.total)) st.mostGoals = { ev, total: h + a };
    for (const i of ev.incidents) {
      if (i.kind === 'red') st.reds++;
      if (i.kind === 'yellow') st.yellows++;
      if (i.kind !== 'goal') continue;
      if (i.min.base != null) { st.buckets[bucketOf(i.min.base)]++; st.timed++; }
      if (i.og || !i.who) continue;
      const team = i.team === ev.home.id ? ev.home : ev.away;
      const k = `${i.who}|${team.id}`;
      const p = scorers.get(k) || { who: i.who, team, n: 0, first: i.min.sort, ev };
      p.n++;
      scorers.set(k, p);
    }
  }
  st.avg = st.games ? st.goals / st.games : 0;
  st.scorerCount = scorers.size;
  st.scorers = [...scorers.values()].sort((x, y) => y.n - x.n || x.ev.date - y.ev.date || x.first - y.first).slice(0, 6);
  return st;
}

/** Times em alta e em baixa (últimos 5 jogos) e destaques da tabela. */
export function trends(events, standings) {
  const rows = standings
    .map((t) => {
      const form = formOf(events, t.id, 5);
      return { team: t, form, pts: formPoints(form), gd: form.reduce((s, g) => s + g.gf - g.ga, 0) };
    })
    .filter((x) => x.form.length >= 3)
    .map((x) => ({ ...x, rate: x.pts / (x.form.length * 3) }));
  const hot = [...rows].sort((x, y) => y.rate - x.rate || y.gd - x.gd).slice(0, 3);
  const cold = [...rows].sort((x, y) => x.rate - y.rate || x.gd - y.gd).slice(0, 3);
  const attack = [...standings].sort((x, y) => y.gf - x.gf)[0];
  const defense = [...standings].sort((x, y) => x.ga - y.ga)[0];
  return { hot, cold, attack, defense };
}

/** O que muda na tabela entre duas versões (atual x simulada). */
export function impactLines({ before, after, zones, favorite }) {
  const items = [];
  const add = (prio, tag, text, tone) => items.push({ prio, tag, text, tone });
  const lead = after.rows[0];
  if (before.rows[0].id !== lead.id) add(10, 'Líder', `${lead.name} assume a liderança`, 'good');
  else {
    const gap = lead.pts - after.rows[1].pts;
    add(3, 'Líder', `${lead.name} segue líder, ${gap} ${gap === 1 ? 'ponto' : 'pontos'} à frente ${doo(after.rows[1].name)}`, 'good');
  }
  const zone = (limit, inside, label, tone) => {
    if (!limit) return;
    for (const r of after.rows) {
      const was = before.byId.get(r.id);
      if (!was || inside(was.pos) === inside(r.pos)) continue;
      add(8, label, `${r.name} ${inside(r.pos) ? 'entra no' : 'sai do'} ${label}`, tone);
    }
  };
  zone(zones?.zStart, (p) => p >= zones.zStart, zones?.zLabel, 'bad');
  zone(zones?.g, (p) => p <= zones.g, zones?.gLabel, 'good');
  const moves = after.rows.map((r) => ({ r, d: (before.byId.get(r.id)?.pos ?? r.pos) - r.pos })).filter((m) => m.d);
  const up = moves.filter((m) => m.d >= 2).sort((x, y) => y.d - x.d)[0];
  const down = moves.filter((m) => m.d <= -2).sort((x, y) => x.d - y.d)[0];
  if (up) add(5, 'Sobe', `${up.r.name} sobe ${up.d} posições, para ${up.r.pos}º`, 'good');
  if (down) add(5, 'Cai', `${down.r.name} cai ${-down.d} posições, para ${down.r.pos}º`, 'bad');
  const fav = favorite && after.byId.get(favorite);
  const favBefore = favorite && before.byId.get(favorite);
  if (fav && favBefore && (fav.pos !== favBefore.pos || fav.pts !== favBefore.pts)) {
    add(9, 'Meu time', `${fav.name}: de ${favBefore.pos}º para ${fav.pos}º, com ${fav.pts} pontos`, 'plain');
  }
  return items.sort((x, y) => y.prio - x.prio).slice(0, 6);
}

// ---------- frases da v2: cada bloco termina dizendo o que o número mostra ----------

/** Quem venceu mais na rodada. open: ainda há jogo por terminar. */
export function homeAwayNote(st, open = false) {
  if (!st.homeW && !st.draws && !st.awayW) return '';
  const yet = open ? ' até agora' : '';
  if (st.homeW && !st.awayW) return `Nenhum visitante venceu nesta rodada${yet}.`;
  if (st.awayW && !st.homeW) return `Nenhum mandante venceu nesta rodada${yet}.`;
  if (st.awayW > st.homeW) return 'Rodada boa para quem jogou fora de casa.';
  if (st.draws >= st.homeW && st.draws >= st.awayW) return 'Rodada de muitos empates.';
  if (st.homeW > st.awayW + st.draws) return 'Os mandantes dominaram a rodada.';
  return 'Vantagem para os mandantes, como de costume.';
}

/** Em que momento saíram os gols (só com 4 ou mais gols com minuto). */
export function goalTimeNote(st) {
  const b = st.buckets;
  const n = st.timed;
  if (n < 4) return '';
  const late = b[2] + b[5];
  if (late / n >= 0.45) return `${late} dos ${n} gols saíram nos 15 minutos finais de cada tempo, contando os acréscimos.`;
  const i = b.indexOf(Math.max(...b));
  const [from, to] = BUCKETS[i].split('–');
  return `O período com mais gols foi entre ${from} e ${to} minutos: ${plural(b[i], 'gol', 'gols')}.`;
}

/** O que o resultado faz com o time na tabela (tabela ao vivo da rodada em andamento). */
export function tableLine(id, table, zones) {
  const r = table?.byId.get(id);
  if (!r) return '';
  const rows = table.rows;
  const live = !!r.result?.live;
  const verb = r.delta > 0 ? `${live ? 'sobe' : 'subiu'} para ${ord(r.pos)}`
    : r.delta < 0 ? `${live ? 'cai' : 'caiu'} para ${ord(r.pos)}` : `${live ? 'fica' : 'segue'} em ${ord(r.pos)}`;
  let extra = '';
  const g = zones?.g;
  const z = zones?.zStart;
  if (r.pos === 1 && rows[1]) {
    const gap = r.pts - rows[1].pts;
    extra = gap ? `, ${pts(gap)} à frente ${doo(rows[1].name)}` : `, empatado em pontos com ${o(rows[1].name)}`;
  } else if (z && r.pos >= z && rows[z - 2]) {
    const gap = rows[z - 2].pts - r.pts;
    extra = gap > 0 ? `, a ${pts(gap)} de sair do ${zones.zLabel}` : `, no ${zones.zLabel} pelos critérios de desempate`;
  } else if (g && r.pos <= g && rows[g]) {
    const lead = r.pts - rows[g].pts;
    if (lead <= 3) extra = lead > 0 ? `, ${pts(lead)} acima do ${ord(g + 1)}` : `, com os mesmos pontos do ${ord(g + 1)}`;
  } else if (g && r.pos > g) {
    const gap = rows[g - 1].pts - r.pts;
    if (gap <= 6) extra = gap > 0 ? `, a ${pts(gap)} do ${zones.gLabel}` : `, com os mesmos pontos do ${ord(g)}`;
    else if (z && rows[z - 1] && r.pts - rows[z - 1].pts <= 4) extra = `, ${pts(r.pts - rows[z - 1].pts)} acima do ${zones.zLabel}`;
  }
  return `${cap(o(r.name))} ${verb}${extra}.`;
}

// ---------- fluxo da partida ----------

// Peso de cada lance de ataque para o time que atacou.
const FLOW_W = {
  goal: 1.5, 'goal---header': 1.5, 'goal---volley': 1.5, 'goal---free-kick': 1.5, 'penalty---scored': 1.5, 'own-goal': 1.2,
  'shot-on-target': 1, 'shot-hit-woodwork': 1, 'penalty---saved': 1, 'deleted-after-review': 1,
  'shot-off-target': 0.6, 'penalty---missed': 0.6, 'shot-blocked': 0.5,
  'corner-awarded': 0.4, offside: 0.2,
};
const FLOW_FOUL = 0.25;                       // falta sofrida perto da área adversária
const FLOW_KERNEL = [1, 0.7, 0.45, 0.25, 0.1]; // um lance pesa no minuto dele e, cada vez menos, nos 4 seguintes
const FLOW_GOAL = /^(goal|own-goal|penalty---scored)/;

/** Relógio de um jogo ao vivo no formato do lance a lance: {period, base, extra}. */
export function liveClock(ev) {
  if (ev?.status?.kind !== 'live') return null;
  if (ev.status.half) return { period: 1, base: 45, extra: 99 };
  const m = /(\d+)'?\s*(?:\+\s*(\d+))?/.exec(ev.status.label || '');
  if (!m) return null;
  const base = Number(m[1]);
  return { period: base > 45 ? 2 : 1, base, extra: Number(m[2] || 0) };
}

/**
 * Pressão de cada time minuto a minuto, pelo lance a lance (chutes, escanteios, faltas perto da área).
 * Cada minuto mostra a diferença entre os dois: positivo para o mandante, negativo para o visitante.
 * now: relógio do jogo ao vivo (liveClock). Devolve null quando há poucos lances.
 */
export function matchFlow(plays, now = null) {
  if (!plays?.length) return null;
  let stop1 = 0;
  let stop2 = 0;
  const used = [];
  const fouls = new Set();
  for (const p of plays) {
    if (p.period === 1 && p.base >= 45) stop1 = Math.max(stop1, p.extra);
    if (p.period === 2 && p.base >= 90) stop2 = Math.max(stop2, p.extra);
    if (p.side !== 'home' && p.side !== 'away') continue;
    let w = FLOW_W[p.type] || 0;
    let side = p.side;
    if (p.type === 'foul') {
      // A ESPN registra a falta duas vezes, com o time de quem fez a falta; quem sofreu é quem ataca.
      const key = `${p.t}|${p.side}`;
      if (fouls.has(key) || p.x == null || p.x > 30) { fouls.add(key); continue; }
      fouls.add(key);
      side = p.side === 'home' ? 'away' : 'home';
      w = FLOW_FOUL;
    }
    if (w) used.push({ ...p, side, w });
  }
  if (now?.period === 1 && now.base >= 45 && now.extra < 99) stop1 = Math.max(stop1, now.extra);
  if (now?.period === 2 && now.base >= 90) stop2 = Math.max(stop2, now.extra);
  if (used.length < 6) return null;
  const half = 45 + stop1;
  const slots = half + 45 + stop2;
  const slotOf = (p) => {
    const i = p.period === 1 ? Math.min(p.base, 45) + Math.min(p.extra, stop1) : half + Math.min(Math.max(p.base, 46), 90) - 45 + p.extra;
    return Math.max(0, Math.min(slots - 1, i - 1));
  };
  const raw = { home: new Float64Array(slots), away: new Float64Array(slots) };
  const goals = [];
  for (const p of used) {
    const i = slotOf(p);
    raw[p.side][i] += p.w;
    if (FLOW_GOAL.test(p.type)) goals.push({ i, side: p.side });
  }
  const wave = (a, i) => {
    const start = i < half ? 0 : half; // o intervalo zera a onda
    let s = 0;
    for (let j = 0; j < FLOW_KERNEL.length && i - j >= start; j++) s += FLOW_KERNEL[j] * a[i - j];
    return s;
  };
  let nowSlot = null;
  if (now) nowSlot = now.extra === 99 ? half : slotOf(now) + 1;
  const net = Array.from({ length: slots }, (_, i) => (nowSlot != null && i >= nowSlot ? 0 : wave(raw.home, i) - wave(raw.away, i)));
  const label = (i) => {
    const m = i < half ? i + 1 : 46 + (i - half);
    return i < half ? (m <= 45 ? `${m}'` : `45+${m - 45}'`) : (m <= 90 ? `${m}'` : `90+${m - 90}'`);
  };
  // Lances usados, com o minuto (posição no gráfico), para a leitura do jogo contar chutes e escanteios.
  const list = used.map((p) => ({ type: p.type, side: p.side, w: p.w, i: slotOf(p) }));
  return { slots, half, net, goals, now: nowSlot, plays: used.length, list, label };
}

// ---------- leitura do jogo ----------

const SHOT_TYPES = /^(goal|own-goal|penalty---|shot-|deleted-after-review)/;
const list2 = (items) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} e ${items[items.length - 1]}` : items[0] || '');

// Autor do gol para a frase: "gol contra de Marçal", "Hulk, de pênalti", "Pedro".
const goalWho = (g) => (g.og ? (g.who ? `gol contra de ${g.who}` : 'gol contra') : g.pen ? (g.who ? `${g.who}, de pênalti` : 'de pênalti') : g.who);

/**
 * Como o placar andou: "O Coritiba abriu o placar aos 22' (gol contra de Marçal) e o Botafogo empatou
 * aos 34' (Danilo Santos)." Com 5 gols ou mais, resume pelo intervalo.
 */
function goalStory(ev, plays) {
  const live = ev.status.kind === 'live';
  const h = ev.home.score ?? 0;
  const a = ev.away.score ?? 0;
  let goals = ev.incidents.filter((i) => i.kind === 'goal');
  let complete = ev.goalsComplete;
  // O placar da ESPN às vezes chega sem os autores; o lance a lance tem os gols com minuto e autor.
  if ((!complete || !goals.length) && plays?.length) {
    const fromPlays = plays.filter((p) => FLOW_GOAL.test(p.type) && p.side).map((p) => ({
      kind: 'goal', team: p.side === 'home' ? ev.home.id : ev.away.id, who: p.who || '', og: p.type === 'own-goal', pen: p.type === 'penalty---scored',
      min: { base: p.base, extra: p.extra, label: p.extra ? `${p.base}+${p.extra}'` : `${p.base}'` },
    }));
    const count = (id) => fromPlays.filter((g) => g.team === id).length;
    if (count(ev.home.id) === h && count(ev.away.id) === a) {
      goals = fromPlays;
      complete = true;
    }
  }
  if (!h && !a) return live ? 'Ainda sem gols.' : 'Ficou no 0 a 0.';
  const lead = h > a ? ev.home : a > h ? ev.away : null;
  const plain = lead ? `${cap(o(lead.name))} ${live ? 'vence' : 'venceu'} por ${Math.max(h, a)} a ${Math.min(h, a)}.` : `${live ? 'Empate' : 'Terminou empatado'} em ${h} a ${a}.`;
  if (!complete || !goals.length) return plain;
  if (goals.length === 1 && !live) {
    const g = goals[0];
    const t = g.team === ev.home.id ? ev.home : ev.away;
    return `${cap(o(t.name))} venceu com ${g.og ? `gol contra${g.who ? ` de ${g.who}` : ''}` : `gol${g.pen ? ' de pênalti' : ''}${g.who ? ` de ${g.who}` : ''}`} aos ${g.min.label}.`;
  }
  if (goals.length >= 5) {
    // Muitos gols: pelo placar do intervalo e do fim, sem listar um por um.
    const ht = goals.filter((g) => (g.min.base ?? 0) <= 45);
    const hh = ht.filter((g) => g.team === ev.home.id).length;
    const ha = ht.length - hh;
    const htLead = hh > ha ? ev.home : ha > hh ? ev.away : null;
    const end = lead ? `${Math.max(h, a)} a ${Math.min(h, a)}` : `${h} a ${a}`;
    let text = `Jogo de ${goals.length} gols: `;
    if (htLead && htLead === lead) text += `${o(htLead.name)} foi para o intervalo vencendo por ${Math.max(hh, ha)} a ${Math.min(hh, ha)} e ${live ? 'agora vence por' : 'fechou em'} ${end}`;
    else if (htLead) text += `${o(htLead.name)} foi para o intervalo vencendo por ${Math.max(hh, ha)} a ${Math.min(hh, ha)}, mas ${lead ? `${o(lead.name)} ${live ? 'vira para' : 'virou para'} ${end}` : `${live ? 'está' : 'terminou'} ${end}`}`;
    else text += `${hh} a ${ha} no intervalo e ${lead ? `${end} para ${o(lead.name)}` : end} ${live ? 'agora' : 'no fim'}`;
    return `${text}.`;
  }
  // Placar a cada gol, do ponto de vista de quem marcou: abriu, ampliou, diminuiu, empatou, virou.
  let sh = 0;
  let sa = 0;
  const last = {}; // último estado de cada time antes de empatar: 'led' ou 'trailed'
  const clauses = [];
  let prev = null;
  for (const g of goals) {
    const home = g.team === ev.home.id;
    const t = home ? ev.home : ev.away;
    const before = home ? sh - sa : sa - sh;
    if (home) sh++; else sa++;
    const after = home ? sh - sa : sa - sh;
    let verb;
    if (!clauses.length) verb = 'abriu o placar';
    else if (before > 0) verb = 'ampliou';
    else if (after < 0) verb = 'diminuiu';
    else if (after === 0) verb = 'empatou';
    else verb = last[t.id] === 'trailed' ? 'virou' : 'voltou à frente';
    if (after > 0) last[t.id] = 'led';
    if (after < 0) last[t.id] = 'trailed';
    const other = home ? ev.away : ev.home;
    if (after > 0) last[other.id] = 'trailed';
    if (after < 0) last[other.id] = 'led';
    const who = goalWho(g);
    clauses.push(`${prev === t.id ? '' : `${clauses.length ? o(t.name) : cap(o(t.name))} `}${verb} aos ${g.min.label}${who ? ` (${who})` : ''}`);
    prev = t.id;
  }
  return `${list2(clauses)}.`;
}

// Lances que mudaram o jogo sem virar gol: expulsão, gol anulado pelo VAR, pênalti perdido, bola na trave.
function highlights(ev, plays, live) {
  const team = (side) => (side === 'home' ? ev.home : ev.away);
  const out = [];
  for (const r of ev.incidents.filter((i) => i.kind === 'red')) {
    const t = r.team === ev.home.id ? ev.home : ev.away;
    out.push(`${cap(o(t.name))} ${live ? 'está' : 'ficou'} com um a menos desde os ${r.min.label}${r.who ? ` (${r.who} expulso)` : ''}.`);
  }
  for (const p of (plays || []).filter((x) => x.type === 'deleted-after-review' && x.side)) {
    out.push(`${cap(o(team(p.side).name))} teve um gol${p.who ? ` de ${p.who}` : ''} anulado pelo VAR aos ${p.extra ? `${p.base}+${p.extra}` : p.base}'.`);
  }
  for (const p of (plays || []).filter((x) => /^penalty---(missed|saved)$/.test(x.type) && x.side)) {
    out.push(`${p.who || cap(o(team(p.side).name))} perdeu um pênalti aos ${p.extra ? `${p.base}+${p.extra}` : p.base}'${p.keeper ? ` (defesa de ${p.keeper})` : ''}.`);
  }
  const wood = { home: 0, away: 0 };
  for (const p of plays || []) if (p.type === 'shot-hit-woodwork' && p.side) wood[p.side]++;
  for (const side of ['home', 'away']) {
    if (wood[side]) out.push(`${cap(o(team(side).name))} acertou a trave${wood[side] > 1 ? ` ${wood[side]} vezes` : ''}.`);
  }
  return out.slice(0, 2).join(' ');
}

// Quem manda pelos números: posse, finalizações e chutes no gol, e se o placar acompanha.
function dominance(ev, stats, flow, live) {
  const h = stats?.[ev.home.id];
  const a = stats?.[ev.away.id];
  const hs = ev.home.score ?? 0;
  const as = ev.away.score ?? 0;
  const ok = (k) => Number.isFinite(h?.[k]) && Number.isFinite(a?.[k]);
  if (ok('totalShots') && h.totalShots + a.totalShots >= 4) {
    const pos = ok('possessionPct') ? [h.possessionPct, a.possessionPct] : null;
    const shots = [h.totalShots, a.totalShots];
    const on = ok('shotsOnTarget') ? [h.shotsOnTarget, a.shotsOnTarget] : null;
    const lead = shots[0] > shots[1] ? 0 : shots[1] > shots[0] ? 1 : pos && Math.abs(pos[0] - pos[1]) >= 10 ? (pos[0] > pos[1] ? 0 : 1) : -1;
    const big = lead >= 0 && (shots[lead] >= 2 * shots[1 - lead] && shots[lead] - shots[1 - lead] >= 4);
    const edge = lead >= 0 && (shots[lead] - shots[1 - lead] >= 3 || (pos && pos[lead] >= 55));
    const onText = on ? ` (${on[lead >= 0 ? lead : 0]} a ${on[lead >= 0 ? 1 - lead : 1]} no gol)` : '';
    if (big || edge) {
      const t = lead === 0 ? ev.home : ev.away;
      const p = pos && pos[lead] >= 52 ? `${Math.round(pos[lead])}% de posse e ` : '';
      let text = `${cap(o(t.name))} ${big ? 'domina' : 'tem mais o jogo'}: ${p}${shots[lead]} finalizações contra ${shots[1 - lead]}${onText}`;
      if (!live) text = text.replace(' domina:', ' dominou:').replace(' tem mais o jogo:', ' teve mais o jogo:');
      const mine = lead === 0 ? hs - as : as - hs;
      if (mine < 0) text += `, mas quem ${live ? 'vence' : 'venceu'} é ${o((lead === 0 ? ev.away : ev.home).name)}`;
      else if (mine === 0 && hs + as > 0) text += `, mas o placar ${live ? 'está' : 'ficou'} empatado`;
      else if (mine === 0) text += `, mas ${live ? 'ainda não' : 'não'} conseguiu marcar`;
      text += '.';
      // Goleiro que segurou o resultado.
      const keeper = lead === 0 ? a?.saves : h?.saves;
      if (Number.isFinite(keeper) && keeper >= 4 && mine <= 0) text += ` O goleiro ${doo((lead === 0 ? ev.away : ev.home).name)} fez ${keeper} defesas.`;
      return text;
    }
    return `Jogo equilibrado: ${shots[0]} finalizações ${doo(ev.home.name)} e ${shots[1]} ${doo(ev.away.name)}${on ? `, ${on[0]} e ${on[1]} no gol` : ''}.`;
  }
  // Sem estatísticas: pela pressão do lance a lance.
  if (!flow?.list?.length) return '';
  let wh = 0;
  let wa = 0;
  for (const p of flow.list) { if (p.side === 'home') wh += p.w; else wa += p.w; }
  if (wh + wa < 3) return '';
  const share = wh / (wh + wa);
  if (share >= 0.6 || share <= 0.4) return `${cap(o((share >= 0.6 ? ev.home : ev.away).name))} ${live ? 'pressiona' : 'pressionou'} mais.`;
  return `Jogo equilibrado${live ? ' até agora' : ''}.`;
}

// Conta chutes e escanteios de um time num trecho do jogo: "3 finalizações e 2 escanteios".
function chances(list, side) {
  const shots = list.filter((p) => p.side === side && SHOT_TYPES.test(p.type)).length;
  const corners = list.filter((p) => p.side === side && p.type === 'corner-awarded').length;
  const parts = [];
  if (shots) parts.push(plural(shots, 'finalização', 'finalizações'));
  if (corners) parts.push(plural(corners, 'escanteio', 'escanteios'));
  return list2(parts);
}

// Ao vivo: o que aconteceu nos últimos 10 minutos (ou desde o começo do 2º tempo, se foi há pouco).
function lately(ev, flow) {
  if (!flow?.list || flow.now == null) return null;
  if (ev.status.half) return halves(ev, flow, true);
  const end = flow.now;
  // Nos acréscimos do 1º tempo, end é o próprio fim do 1º tempo no gráfico; o 2º começa depois dele.
  const start = Math.max(end > flow.half ? flow.half : 0, end - 10);
  if (end - start < 5) return null;
  const when = start === flow.half ? 'Neste começo de 2º tempo' : 'Nos últimos 10 minutos';
  const win = flow.list.filter((p) => p.i >= start && p.i < end);
  let wh = 0;
  let wa = 0;
  for (const p of win) { if (p.side === 'home') wh += p.w; else wa += p.w; }
  if (wh + wa < 1.2) return { label: 'Agora', text: `${when}, quase nada aconteceu: jogo travado.` };
  const share = wh / (wh + wa);
  if (share >= 0.65 || share <= 0.35) {
    const side = share >= 0.65 ? 'home' : 'away';
    const t = side === 'home' ? ev.home : ev.away;
    const c = chances(win, side);
    return { label: 'Agora', text: `${when}, ${o(t.name)} pressiona${c ? `: ${c}` : ''}.` };
  }
  const ch = chances(win, 'home') || 'nenhuma chance';
  const ca = chances(win, 'away') || 'nenhuma';
  return { label: 'Agora', text: `${when}, jogo lá e cá: ${ch} ${doo(ev.home.name)}, ${ca} ${doo(ev.away.name)}.` };
}

// Encerrado (ou no intervalo): quem foi melhor em cada tempo.
function halves(ev, flow, interval = false) {
  if (!flow?.list) return null;
  const sum = (from, to) => {
    let wh = 0;
    let wa = 0;
    for (const p of flow.list) if (p.i >= from && p.i < to) { if (p.side === 'home') wh += p.w; else wa += p.w; }
    if (wh + wa < 3) return 'quiet';
    const share = wh / (wh + wa);
    return share >= 0.6 ? 'home' : share <= 0.4 ? 'away' : 'even';
  };
  const name = (side) => o(side === 'home' ? ev.home.name : ev.away.name);
  const b1 = sum(0, flow.half);
  if (interval) {
    const text = b1 === 'quiet' ? 'Primeiro tempo de poucas chances.' : b1 === 'even' ? 'Primeiro tempo equilibrado.' : `${cap(name(b1))} foi melhor no 1º tempo.`;
    return { label: '1º tempo', text };
  }
  const b2 = sum(flow.half, flow.slots);
  let text;
  if (b1 === 'quiet' && b2 === 'quiet') text = 'Jogo de poucas chances.';
  else if (b1 === b2 && (b1 === 'home' || b1 === 'away')) text = `${cap(name(b1))} foi melhor nos dois tempos.`;
  else if (b1 === b2) text = 'Equilibrado nos dois tempos.';
  else {
    const first = b1 === 'home' || b1 === 'away' ? `${cap(name(b1))} foi melhor no 1º tempo` : b1 === 'even' ? '1º tempo equilibrado' : '1º tempo de poucas chances';
    const other = (side) => (side === 'home' ? 'away' : 'home');
    let second;
    if (b2 === 'home' || b2 === 'away') second = b1 === 'home' || b1 === 'away' ? `no 2º, ${name(b2)} cresceu` : `no 2º, ${name(b2)} pressionou mais`;
    else if (b2 === 'even') second = b1 === 'home' || b1 === 'away' ? `no 2º, ${name(other(b1))} equilibrou` : 'o 2º foi equilibrado';
    else second = 'o 2º teve poucas chances';
    text = `${first}; ${second}.`;
  }
  return { label: 'Os tempos', text };
}

/**
 * Leitura do jogo em até 4 linhas curtas, para o torcedor comum: como o placar andou, os lances que
 * mudaram o jogo sem virar gol, quem manda pelos números e o momento (ao vivo, os últimos 10 minutos;
 * no intervalo e no fim, cada tempo). plays: parseSummaryPlays; stats: {timeId: {...}}; flow: matchFlow.
 * Devolve [{label, text}] (vazio antes do jogo).
 */
export function matchReading(ev, { plays = null, stats = null, flow = null } = {}) {
  const live = ev.status.kind === 'live';
  if (!live && ev.status.kind !== 'post') return [];
  const out = [{ label: ev.home.score || ev.away.score ? 'Gols' : 'Placar', text: goalStory(ev, plays) }];
  const hl = highlights(ev, plays, live);
  if (hl) out.push({ label: 'Destaques', text: hl });
  const dom = dominance(ev, stats, flow, live);
  if (dom) out.push({ label: 'Domínio', text: dom });
  const moment = live ? lately(ev, flow) : halves(ev, flow);
  if (moment) out.push(moment);
  return out;
}

// ---------- últimos confrontos ----------

/**
 * Retrospecto dos dois times nos últimos confrontos (games: parseHeadToHead).
 * Empate nos 90 minutos conta como empate, mesmo que alguém tenha passado nos pênaltis.
 * Devolve {n, wins: {id: n}, draws, note} ou null sem jogos.
 */
export function h2hSummary(games, home, away) {
  if (!games?.length) return null;
  const wins = { [home.id]: 0, [away.id]: 0 };
  let draws = 0;
  const winnerOf = (g) => (g.home.score > g.away.score ? g.home.id : g.away.score > g.home.score ? g.away.id : null);
  for (const g of games) {
    const w = winnerOf(g);
    if (w == null) draws++;
    else if (w in wins) wins[w]++;
  }
  // Sequência mais recente: vitórias seguidas ou jogos sem perder de um dos dois.
  const streak = (id, ok) => { let n = 0; for (const g of games) { if (!ok(winnerOf(g), id)) break; n++; } return n; };
  const name = { [home.id]: home.name, [away.id]: away.name };
  const other = (id) => (id === home.id ? away.id : home.id);
  let note = '';
  for (const id of [home.id, away.id]) {
    const won = streak(id, (w, x) => w === x);
    const unbeaten = streak(id, (w, x) => w !== other(x));
    if (won >= 3) { note = `${cap(o(name[id]))} venceu os últimos ${won} confrontos.`; break; }
    if (unbeaten >= 3 && unbeaten > won && wins[id] > 0) { note = `${cap(o(name[id]))} não perde para ${o(name[other(id)])} há ${unbeaten} jogos.`; break; }
  }
  const n = games.length;
  const tally = [home, away].filter((t) => wins[t.id]).map((t) => `${wins[t.id]} ${wins[t.id] === 1 ? 'vitória' : 'vitórias'} ${doo(t.name)}`);
  if (draws) tally.push(`${draws} ${draws === 1 ? 'empate' : 'empates'}`);
  const list = tally.length > 1 ? `${tally.slice(0, -1).join(', ')} e ${tally[tally.length - 1]}` : tally[0];
  const total = `Nos últimos ${n === 1 ? 'confronto' : `${n} confrontos`}: ${list}.`;
  return { n, wins, draws, streak: note, total, note: [note, total].filter(Boolean).join(' ') };
}
