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
  // Pressão de cada time no minuto (a onda dos lances dele) e o saldo entre os dois.
  const side = (a) => Array.from({ length: slots }, (_, i) => (nowSlot != null && i >= nowSlot ? 0 : wave(a, i)));
  const home = side(raw.home);
  const away = side(raw.away);
  const net = home.map((v, i) => v - away[i]);
  const label = (i) => {
    const m = i < half ? i + 1 : 46 + (i - half);
    return i < half ? (m <= 45 ? `${m}'` : `45+${m - 45}'`) : (m <= 90 ? `${m}'` : `90+${m - 90}'`);
  };
  // Lances usados, com o minuto (posição no gráfico), para a leitura do jogo contar chutes e escanteios.
  const list = used.map((p) => ({ type: p.type, side: p.side, w: p.w, i: slotOf(p) }));
  return { slots, half, home, away, net, goals, now: nowSlot, plays: used.length, list, label, slotOf };
}

// ---------- leitura do jogo ----------

const minLabel = (m) => (m.extra ? `${m.base}+${m.extra}'` : `${m.base}'`);
const halfOf = (m) => (m.period ? m.period : (m.base ?? 0) > 45 ? 2 : 1);
const minuteOf = (m) => (m.base ?? 0) + (m.extra || 0);
const stoppage = (e) => e.half === 2 && (e.min.base ?? 0) >= 90 && e.min.extra > 0;
const ORD = ['', 'primeiro', 'segundo', 'terceiro', 'quarto', 'quinto', 'sexto', 'sétimo', 'oitavo'];
const NUM = ['', 'uma', 'duas', 'três', 'quatro', 'cinco'];
// Depois de um gol anulado pelo VAR, o gol que valeu: "O empate veio pouco depois".
const CAME = { 'abriu o placar': 'o gol', empatou: 'o empate', virou: 'a virada' };
// Variação de palavras, sempre a mesma para o mesmo jogo (não muda a cada atualização).
const vary = (id, words) => words[[...String(id ?? '')].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % words.length];

// Autor do gol no fim da frase: ", com Pedro", ", de novo com Pedro", ", num gol contra de Marçal", ", de pênalti, com Hulk".
function scorerOf(e) {
  const g = e.g;
  if (g.og) return g.who ? `, num gol contra de ${g.who}` : ', num gol contra';
  const pen = g.pen ? ', de pênalti' : '';
  if (!g.who) return pen;
  if (e.again) return `${pen}, com o próprio ${g.who}`;
  if (e.nth === 2) return `${pen}, de novo com ${g.who}`;
  if (e.nth === 3) return `${pen}, com ${g.who} completando o hat-trick`;
  if (e.nth > 3) return `${pen}, com ${g.who}, que fez ${NUM[e.nth] || e.nth} no jogo`;
  return `${pen}, com ${g.who}`;
}

// Gols do jogo: do placar da ESPN ou, se ele ainda não trouxe os autores, do lance a lance.
function goalsOf(ev, plays) {
  const h = ev.home.score ?? 0;
  const a = ev.away.score ?? 0;
  let goals = ev.incidents.filter((i) => i.kind === 'goal');
  if ((!ev.goalsComplete || goals.length !== h + a) && plays?.length) {
    const fromPlays = plays.filter((p) => FLOW_GOAL.test(p.type) && p.side).map((p) => ({
      kind: 'goal', team: p.side === 'home' ? ev.home.id : ev.away.id, who: p.who || '', og: p.type === 'own-goal', pen: p.type === 'penalty---scored',
      min: { base: p.base, extra: p.extra, period: p.period },
    }));
    const count = (id) => fromPlays.filter((g) => g.team === id).length;
    if (count(ev.home.id) === h && count(ev.away.id) === a) goals = fromPlays;
  }
  return goals.length === h + a ? goals : null;
}

// Quem foi melhor num trecho do jogo, pela pressão do lance a lance (chutes, escanteios, faltas perto da área).
function phase(flow, from, to, cut = 0.62) {
  let h = 0;
  let a = 0;
  for (const p of flow?.list || []) if (p.i >= from && p.i < to) { if (p.side === 'home') h += p.w; else a += p.w; }
  const t = h + a;
  if (!flow || to - from < 8) return null;
  if (t < 2.5 * ((to - from) / 45)) return 'quiet';
  const share = h / t;
  return share >= cut ? 'home' : share <= 1 - cut ? 'away' : 'even';
}

// Domínio no jogo todo, pelas estatísticas (finalizações e posse) ou, sem elas, pelo lance a lance.
function overall(ev, stats, flow) {
  const h = stats?.[ev.home.id];
  const a = stats?.[ev.away.id];
  if (Number.isFinite(h?.totalShots) && Number.isFinite(a?.totalShots) && h.totalShots + a.totalShots >= 6) {
    const [sh, sa] = [h.totalShots, a.totalShots];
    const lead = sh > sa ? 'home' : sa > sh ? 'away' : null;
    if (!lead) return { side: null, known: true, busy: sh + sa >= 22, quiet: sh + sa < 22 };
    const [m, n] = lead === 'home' ? [sh, sa] : [sa, sh];
    const pos = lead === 'home' ? h.possessionPct : a.possessionPct;
    const strong = (m >= 2 * n && m - n >= 4) || (m - n >= 5 && Number.isFinite(pos) && pos >= 55);
    const edge = strong || m - n >= 3;
    const keeper = lead === 'home' ? a.saves : h.saves;
    return { side: edge ? lead : null, strong, ratio: n ? m / n : 9, keeper: Number.isFinite(keeper) ? keeper : 0, known: true, busy: sh + sa >= 22, quiet: sh + sa < 22 };
  }
  const p = phase(flow, 0, flow ? (flow.now ?? flow.slots) : 0, 0.58);
  return { side: p === 'home' || p === 'away' ? p : null, strong: false, ratio: 0, keeper: 0, known: p != null, quiet: p === 'quiet' };
}

const ratioWords = (r) => (r >= 3 ? 'o triplo' : r >= 2 ? 'o dobro' : '');

/**
 * Como está (ou como foi) o jogo, contado como para um amigo: um parágrafo por tempo, com quem foi
 * melhor e os lances na ordem (gols, gol anulado pelo VAR, pênalti perdido, expulsão, bola na trave),
 * e no fim como está agora (ao vivo) ou o veredito (encerrado). Números, só o minuto dos gols e lances.
 * plays: parseSummaryPlays; stats: {timeId: {...}}; flow: matchFlow. Devolve uma lista de parágrafos.
 */
export function matchReading(ev, { plays = null, stats = null, flow = null } = {}) {
  const live = ev.status.kind === 'live';
  if (!live && ev.status.kind !== 'post') return [];
  const T = (side) => (side === 'home' ? ev.home : ev.away);
  const name = (side) => o(T(side).name);
  const Name = (side) => cap(name(side));
  const other = (side) => (side === 'home' ? 'away' : 'home');
  const sideOf = (teamId) => (teamId === ev.home.id ? 'home' : 'away');
  const hs = ev.home.score ?? 0;
  const as = ev.away.score ?? 0;
  const goals = goalsOf(ev, plays);
  const dom = overall(ev, stats, flow);

  // Lances do jogo, em ordem, com o tempo de cada um.
  const events = [];
  for (const g of goals || []) events.push({ kind: 'goal', side: sideOf(g.team), min: g.min, half: halfOf(g.min), g });
  for (const r of ev.incidents.filter((i) => i.kind === 'red')) events.push({ kind: 'red', side: sideOf(r.team), min: r.min, half: halfOf(r.min), who: r.who });
  for (const p of plays || []) {
    if (!p.side) continue;
    const min = { base: p.base, extra: p.extra, period: p.period };
    if (p.type === 'deleted-after-review') events.push({ kind: 'var', side: p.side, min, half: p.period, who: p.who });
    if (/^penalty---(missed|saved)$/.test(p.type)) events.push({ kind: 'pen', side: p.side, min, half: p.period, who: p.who, keeper: p.keeper });
    if (p.type === 'shot-hit-woodwork') events.push({ kind: 'wood', side: p.side, min, half: p.period });
  }
  const order = (e) => e.half * 1000 + (e.min.base ?? 0) + (e.min.extra || 0) / 100;
  events.sort((x, y) => order(x) - order(y));

  // O placar ao longo do jogo: o verbo de cada gol (abriu, ampliou, empatou, virou) e a situação de cada lance.
  let sh = 0;
  let sa = 0;
  const last = {}; // quem esteve na frente por último: 'led' ou 'trailed'
  const byPlayer = new Map();
  const reds = { home: 0, away: 0 };
  for (const e of events) {
    e.diff = e.side === 'home' ? sh - sa : sa - sh;
    e.total = sh + sa;
    if (e.kind === 'red') e.n = ++reds[e.side];
    e.down = reds[e.side] - reds[other(e.side)];
    if (e.kind !== 'goal') continue;
    if (e.side === 'home') sh++; else sa++;
    const after = e.side === 'home' ? sh - sa : sa - sh;
    const n = e.side === 'home' ? sh : sa;
    if (sh + sa === 1) e.verb = 'abriu o placar';
    else if (e.diff > 0) e.verb = n >= 3 && ORD[n] ? `fez o ${ORD[n]}` : 'ampliou';
    else if (after < 0) e.verb = 'diminuiu';
    else if (after === 0) e.verb = 'empatou';
    else e.verb = last[e.side] === 'trailed' ? 'virou' : 'voltou à frente';
    if (after > 0) { last[e.side] = 'led'; last[other(e.side)] = 'trailed'; }
    if (after < 0) { last[e.side] = 'trailed'; last[other(e.side)] = 'led'; }
    if (!e.g.og && e.g.who) {
      const key = `${e.side}|${e.g.who}`;
      e.nth = (byPlayer.get(key) || 0) + 1;
      byPlayer.set(key, e.nth);
    }
  }

  // Um parágrafo por tempo: quem foi melhor e o que aconteceu, na ordem.
  const p1 = flow ? phase(flow, 0, flow.now != null && flow.now < flow.half ? flow.now : flow.half) : null;
  const p2 = flow && (flow.now == null || flow.now > flow.half) ? phase(flow, flow.half, flow.now ?? flow.slots) : null;
  const inSecond = live && !ev.status.half && flow?.now != null && flow.now > flow.half;
  const dominatedBoth = (p1 === 'home' || p1 === 'away') && p1 === p2 && !live;
  const cur = { better: null, phase: null };
  const even = vary(ev.id, ['equilibrado', 'parelho', 'equilibrado', 'bem disputado']);
  const downSaid = {};
  const paragraphs = [];
  for (const half of [1, 2]) {
    if (half === 2 && live && !inSecond) break;
    const current = live && (half === 2 ? inSecond : !inSecond && !ev.status.half);
    const p = half === 1 ? p1 : p2;
    const list = events.filter((x) => x.half === half);
    const better = dominatedBoth ? p1 : p === 'home' || p === 'away' ? p : null;
    if (current) Object.assign(cur, { better, phase: p });
    // Frase de abertura: quem foi melhor no tempo. lead: o time de quem ela fala.
    let opener = '';
    let lead = null;
    let joinable = true; // aceita o primeiro lance emendado (": abriu o placar", ", mas o Y empatou")
    const ratio = (side) => (dom.side === side && dom.strong ? ratioWords(dom.ratio) : '');
    if (half === 1) {
      if (dominatedBoth) {
        opener = `${Name(p1)} mandou no jogo do começo ao fim`;
        if (ratio(p1)) opener += `, finalizando ${ratio(p1)} ${doo(T(other(p1)).name)}`;
        lead = p1;
      } else if (better) {
        opener = current ? `${Name(better)} é melhor até aqui` : `${Name(better)} foi melhor no primeiro tempo`;
        if (current && ratio(better)) opener += `, finalizando ${ratio(better)} ${doo(T(other(better)).name)}`;
        lead = better;
      } else if (p === 'even') opener = current ? `Jogo ${even} até aqui` : `Primeiro tempo ${even}`;
      else if (p === 'quiet') opener = current ? 'Jogo truncado, de poucas chances até aqui' : 'Primeiro tempo truncado, de poucas chances';
    } else if (!dominatedBoth) {
      if (better) {
        opener = p1 === better ? `${Name(better)} ${current ? 'segue' : 'seguiu'} melhor no segundo tempo` : `No segundo tempo, ${name(better)} ${p1 === other(better) ? 'voltou melhor' : 'cresceu'}`;
        lead = better;
      } else if (p === 'even' && (p1 === 'home' || p1 === 'away')) {
        opener = `No segundo tempo, ${name(other(p1))} equilibrou`;
        lead = other(p1);
      } else if (p === 'even') opener = `O segundo tempo ${current ? 'segue' : 'seguiu'} ${even}`;
      else if (p === 'quiet') opener = current ? 'O segundo tempo está morno' : 'O segundo tempo foi morno';
    }
    if (opener.includes(',') && !opener.startsWith('No segundo tempo,')) joinable = false;
    // Sem nenhum lance no tempo: o que faltou.
    if (opener && !list.length && !dominatedBoth) {
      const score = half === 1 && !current ? null : [hs, as];
      const diffEnd = (side) => {
        const [h, a] = score || events.filter((x) => x.kind === 'goal' && x.half === 1).reduce(([h0, a0], x) => (x.side === 'home' ? [h0 + 1, a0] : [h0, a0 + 1]), [0, 0]);
        return { d: side === 'home' ? h - a : a - h, zero: !h && !a };
      };
      if (better && lead === better) {
        const { d, zero } = diffEnd(better);
        const need = d > 0 ? 'ampliar' : d === 0 ? (zero ? 'marcar' : 'desempatar') : d === -1 ? 'empatar' : 'diminuir';
        if (!(current && d > 0)) opener += `, mas ${current ? 'ainda não conseguiu' : 'não conseguiu'} ${need}`;
      } else if (p === 'even' && !lead) opener += current ? (hs || as ? '' : ', ainda sem gols') : ' e sem gols';
      else if (lead) opener += current ? ', e o placar ainda não mudou' : ', e o placar não mudou';
    }
    const out = opener ? [opener] : [];
    if (half === 1 && dominatedBoth && !list.length && events.length) out.push('o primeiro tempo terminou sem gols');
    let subj = lead;
    let prev = null;
    let inSentence = 0; // gols na última frase (para emendar no máximo dois)
    const push = (text, side, n = 0) => { out.push(text); subj = side; inSentence = n; };
    const who = (side) => (side === subj ? '' : `${name(side)} `);
    const woods = list.filter((x) => x.kind === 'wood');
    for (const e of list) {
      if (e.kind === 'wood' && woods.some((w) => w.side === e.side && order(w) < order(e))) continue;
      const min = minLabel(e.min);
      const where = stoppage(e) && !(prev && stoppage(prev)) ? 'nos acréscimos' : !out.length && half === 2 && paragraphs.length ? 'no segundo tempo' : '';
      const pre = where ? `${where}, ` : '';
      const fresh = out.length === 1 && opener && !prev && joinable && lead && !pre;
      const hasBut = out.length && out[out.length - 1].includes(', mas ');
      if (e.kind === 'goal') {
        const first = e.half === 1 && e.min.base === 1 && !e.min.extra;
        const at = first ? 'logo no primeiro minuto' : `${(e.half === 1 ? e.verb === 'abriu o placar' && e.min.base <= 6 : e.min.base <= 47) ? 'logo aos' : 'aos'} ${min}`;
        const tail = `${e.verb} ${at}${scorerOf(e)}`;
        const against = better && better !== e.side && ['abriu o placar', 'voltou à frente', 'virou'].includes(e.verb);
        // Gol de quem está com um a menos: dito uma vez.
        const down = e.down > 0 && !downSaid[e.side] ? 'mesmo com um a menos' : '';
        if (down) downSaid[e.side] = true;
        const named = (side) => `${name(side)}${down ? `, ${down},` : ''}`;
        const frustrated = list.filter((x) => x.side === e.side && /^(var|wood|pen)$/.test(x.kind) && order(x) < order(e) && order(x) > order(prev?.kind === 'goal' ? prev : { half, min: { base: 0 } })).length;
        if (prev?.kind === 'goal' && prev.side === e.side && inSentence && inSentence < 2 && !down) {
          // Dois gols seguidos do mesmo time: na mesma frase.
          const same = e.verb === prev.verb;
          const verb = same ? 'de novo' : prev.verb.startsWith('fez o ') && e.verb.startsWith('fez o ') ? e.verb.slice(4) : e.verb;
          out[out.length - 1] += `, e ${verb} ${at}${same ? scorerOf(e).replace(', de novo com', ', com') : scorerOf(e)}`;
          inSentence++;
        } else if (prev?.kind === 'var' && prev.side === e.side && CAME[e.verb] && !down) {
          e.again = !e.g.og && prev.who && prev.who === e.g.who;
          const soon = minuteOf(e.min) - minuteOf(prev.min) <= 10 && e.half === prev.half;
          push(`${CAME[e.verb]} veio ${soon ? 'pouco depois, ' : ''}aos ${min}${scorerOf(e)}`, e.side, 1);
        } else if (fresh) {
          out[0] += lead === e.side ? `${lead === better ? ':' : ' e'} ${down ? `${down}, ` : ''}${tail}` : `, mas ${e.verb === 'abriu o placar' && against ? `foi ${name(e.side)} que abriu o placar, ${at}${scorerOf(e)}` : `${named(e.side)} ${tail}`}`;
          subj = e.side;
          inSentence = 1;
        } else if (prev?.kind === 'goal' && prev.side !== e.side && inSentence === 1 && (e.verb === 'empatou' || e.verb === 'diminuiu') && !pre && !hasBut) {
          out[out.length - 1] += `, mas ${named(e.side)} ${tail}`;
          subj = e.side;
          inSentence = 2;
        } else if (against) {
          const when = where ? ` ${where},` : '';
          push(e.verb === 'abriu o placar' ? `mesmo assim, foi ${name(e.side)} que abriu o placar${when || ','} ${at}${scorerOf(e)}` : `mesmo assim, ${named(e.side)} ${e.verb}${when} ${at}${scorerOf(e)}`, e.side, 1);
        } else if (prev && prev.side === e.side && (frustrated >= 2 || /^(var|pen)$/.test(prev.kind)) && !pre && !down) {
          push(`até que, aos ${min}, ${who(e.side)}${e.verb}${scorerOf(e)}`, e.side, 1);
        } else push(down ? `${pre}${down}, ${who(e.side)}${tail}` : `${pre}${who(e.side)}${tail}`, e.side, 1);
      } else if (e.kind === 'var') {
        const again = events.find((x) => x.kind === 'var' && order(x) < order(e));
        const text = !again ? `chegou a marcar aos ${min}${e.who ? `, com ${e.who}` : ''}, mas o VAR anulou`
          : `${again.side === e.side ? 'teve outro' : 'também teve um'} gol anulado pelo VAR, aos ${min}${e.who ? `, de ${e.who}` : ''}`;
        if (fresh && lead === e.side) { out[0] += `: ${text}`; subj = e.side; inSentence = 0; } else push(`${pre}${who(e.side)}${text}`, e.side);
      } else if (e.kind === 'red') {
        const text = `ficou com ${e.n > 1 ? 'dois' : 'um'} a menos aos ${min}${e.who ? `, com a expulsão de ${e.who}` : ''}`;
        if (fresh && lead === e.side) { out[0] += `, mas ${text}`; subj = e.side; inSentence = 0; } else if (prev?.kind === 'red' && prev.side === e.side) out[out.length - 1] += `, e com ${e.n > 2 ? 'mais um' : 'dois'} a menos aos ${min}${e.who ? `, com a expulsão de ${e.who}` : ''}`;
        else push(`${pre}${who(e.side)}${text}`, e.side);
      } else if (e.kind === 'pen') {
        const next = ORD[(e.total + e.diff) / 2 + 1]; // o gol que seria do time com o pênalti
        const aim = e.diff < -1 ? 'diminuir' : e.diff === -1 ? 'empatar' : e.diff > 0 ? ((e.total + e.diff) / 2 >= 2 && next ? `fazer o ${next}` : 'ampliar') : e.total ? 'desempatar' : 'abrir o placar';
        const miss = e.keeper ? `${e.keeper} defendeu a cobrança${e.who ? ` de ${e.who}` : ''}` : `${e.who ? `${e.who} ` : ''}desperdiçou`;
        push(`${pre}${who(e.side)}teve um pênalti para ${aim} aos ${min}, mas ${miss}`, e.side);
      } else if (e.kind === 'wood') {
        const n = woods.filter((w) => w.side === e.side).length;
        const times = n > 1 ? ` ${NUM[n] || n} vezes` : '';
        if (fresh && lead === e.side) { out[0] += ` e acertou a trave${times}`; subj = e.side; inSentence = 0; } else if (e.side === subj) push(`${pre}${prev ? 'ainda acertou a trave' : n > 1 ? 'acertou a trave' : 'chegou a acertar a trave'}${times}`, e.side);
        else push(`${pre}${name(e.side)} acertou a trave${times}`, e.side);
      }
      prev = e;
    }
    if (half === 1 && ev.status.half) {
      if (hs !== as) out.push(`${name(hs > as ? 'home' : 'away')} foi para o intervalo na frente`);
      else if (hs) out.push('foi para o intervalo empatado');
      else if (!out.length) out.push('foi para o intervalo sem gols');
    }
    if (out.length) paragraphs.push(out.map((s) => `${cap(s)}.`).join(' '));
  }
  if (!paragraphs.length && !goals && (hs || as)) {
    const lead = hs > as ? 'home' : as > hs ? 'away' : null;
    paragraphs.push(lead ? `${Name(lead)} ${live ? 'vence' : 'venceu'} por ${Math.max(hs, as)} a ${Math.min(hs, as)}.` : `${live ? 'Empate' : 'Terminou empatado'} em ${hs} a ${as}.`);
  }
  if (!paragraphs.length && !hs && !as) {
    const early = live && !ev.status.half && (liveClock(ev)?.base ?? 0) < 15;
    if (live && dom.side) paragraphs.push(`${Name(dom.side)} tem mais o jogo, mas ainda não conseguiu marcar.`);
    else paragraphs.push(!live ? 'Ficou no 0 a 0.' : early ? 'Começo de jogo, ainda sem chances claras.' : 'Ainda sem gols.');
  }

  // Fecho: ao vivo, como está agora; encerrado, o veredito.
  const ctx = { name, Name, other, last, reds, cur };
  const close = live ? nowLine(ev, flow, plays, ctx) : verdict(ev, dom, events, ctx);
  if (close) paragraphs.push(close);
  return paragraphs;
}

// Ao vivo: os últimos minutos, como impressão (quem está em cima e atrás do quê).
function nowLine(ev, flow, plays, { name, Name, other, last, reds, cur }) {
  if (!flow?.list || flow.now == null || ev.status.half) return '';
  const end = flow.now;
  const start = Math.max(end > flow.half ? flow.half : 0, end - 10);
  if (end - start < 5) return '';
  let h = 0;
  let a = 0;
  for (const p of flow.list) if (p.i >= start && p.i < end) { if (p.side === 'home') h += p.w; else a += p.w; }
  if (h + a < 1.2) {
    if (cur.phase === 'quiet') return '';
    const subs = (plays || []).filter((p) => p.type === 'substitution' && flow.slotOf(p) >= start && flow.slotOf(p) < end).length;
    return subs >= 2 ? 'Agora o jogo esfriou, com as substituições: quase nada acontece.' : 'Nos últimos minutos, o jogo esfriou: quase nada acontece.';
  }
  const share = h / (h + a);
  if (share < 0.65 && share > 0.35) return vary(ev.id, ['Nos últimos minutos, o jogo ficou aberto, lá e cá.', 'Nos últimos minutos, os dois times foram para cima: jogo lá e cá.']);
  const side = share >= 0.65 ? 'home' : 'away';
  const [mine, theirs] = side === 'home' ? [ev.home.score ?? 0, ev.away.score ?? 0] : [ev.away.score ?? 0, ev.home.score ?? 0];
  const diff = mine - theirs;
  const late = (liveClock(ev)?.base ?? 0) >= 70;
  let goal = 'querendo mais';
  if (diff < -1) goal = 'tentando diminuir';
  else if (diff === -1) goal = 'atrás do empate';
  else if (diff === 0) goal = last[side] === 'trailed' ? 'atrás da virada' : !mine ? 'atrás do primeiro gol' : late ? 'atrás do gol da vitória' : 'atrás do desempate';
  else if (diff === 1) goal = late || !ORD[mine + 1] ? 'atrás do gol que mata o jogo' : `atrás do ${ORD[mine + 1]} gol`;
  if (reds[other(side)] > reds[side]) return `Com um a mais, ${name(side)} está em cima, ${goal}.`;
  if (cur.better === side) return `${Name(side)} continua em cima, ${goal}.`;
  if (cur.better === other(side)) return `Nos últimos minutos, ${name(side)} passou a pressionar, ${goal}.`;
  return `Agora é ${name(side)} que está em cima, ${goal}.`;
}

// Encerrado: o veredito numa frase (virada no fim, goleada, vitória no sufoco, empate com gosto de derrota).
function verdict(ev, dom, events, { name, Name, other }) {
  const hs = ev.home.score ?? 0;
  const as = ev.away.score ?? 0;
  const win = hs > as ? 'home' : as > hs ? 'away' : null;
  const margin = Math.abs(hs - as);
  const scored = events.filter((e) => e.kind === 'goal');
  const lastGoal = scored.at(-1);
  const late = lastGoal && lastGoal.half === 2 && (lastGoal.min.base ?? 0) >= 88;
  const turn = win && scored.find((e) => e.side === win && e.verb === 'virou');
  const turned = !!turn;
  if (turn && turn.half === 2 && (turn.min.base ?? 0) >= 88) return 'Virada no apagar das luzes.';
  if (win && late && lastGoal.side === win && margin === 1) return 'Decidido no fim.';
  if (!win && late && lastGoal.verb === 'empatou') return lastGoal.down > 0 ? `Mesmo com um a menos, ${name(lastGoal.side)} buscou o empate no fim.` : `${Name(lastGoal.side)} buscou o empate no fim.`;
  if (win && margin >= 3) return 'Goleada sem discussão.';
  if (turned) return dom.side === win ? 'Virada merecida.' : 'Uma virada e tanto.';
  const reason = (side) => {
    if (dom.keeper >= 4) return `parou no goleiro ${doo(ev[other(side)].name)}`;
    if (events.some((e) => e.kind === 'wood' && e.side === side)) return 'parou na trave';
    return 'faltou pontaria';
  };
  if (win && dom.side === other(win) && dom.strong) return `Vitória no sufoco: ${name(other(win))} criou bem mais, mas ${reason(other(win))}.`;
  const scare = win && margin === 1 && events.some((e) => e.side === other(win) && (e.kind === 'pen' || e.kind === 'var') && e.half === 2 && (e.min.base ?? 0) >= 80 && e.diff === -1);
  if (scare) return dom.side === win ? 'Vitória merecida, mas com susto no fim.' : 'Vitória com susto no fim.';
  if (!dom.known) return '';
  if (win && dom.side === win) return margin >= 2 ? 'Vitória tranquila.' : 'Vitória merecida.';
  if (win && dom.side) return `${Name(dom.side)} criou mais, mas ${name(win)} foi mais eficiente.`;
  if (win) return 'Jogo parelho, decidido no detalhe.';
  if (dom.side && dom.strong) return `Empate com gosto de derrota para ${name(dom.side)}, que criou mais, mas ${reason(dom.side)}.`;
  if (dom.side) return `${Name(dom.side)} criou um pouco mais, mas o empate não foi injusto.`;
  if (hs) return 'Empate justo.';
  return dom.busy ? 'Um 0 a 0 movimentado, que podia ter saído para qualquer lado.' : dom.quiet ? 'Um 0 a 0 de poucas emoções.' : 'Um 0 a 0 justo.';
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
