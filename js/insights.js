// Leitura da rodada: histórias de cada jogo, manchetes e números.
import { formOf, formPoints } from './table.js';
import { ao, doo, kickoff, o, scoreText } from './util.js';

const started = (e) => (e.status.kind === 'post' || e.status.kind === 'live') && e.home.score != null && e.away.score != null;
const ord = (n) => `${n}º`;

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
  const add = (prio, tag, text, ev, tone = 'gol') => items.push({ prio, tag, text, tone, ev: ev?.id || null, t: ev?.date?.getTime?.() || 0 });
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
      add(10, 'Líder', ifNow ? `Se terminar assim, ${leader.name} assume a liderança` : `${leader.name} assumiu a liderança`, leader.result?.ev, 'good');
    } else if (leader.result) {
      const gap = leader.pts - rows[1].pts;
      add(6, 'Líder', `${leader.name} ${table.anyLive ? 'segue' : 'continua'} líder, ${gap} ${gap === 1 ? 'ponto' : 'pontos'} à frente ${doo(rows[1].name)}`, leader.result.ev, 'good');
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
        add(prio, label, text, r.result?.ev, tone);
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
      add(7, 'Virada', live ? `${winner.name} buscou a virada e vence ${o(loser.name)} por ${sc}` : `${winner.name} virou e venceu ${o(loser.name)} por ${sc}`, ev);
    }
    if (s.zebra) {
      const { winner, loser, wr, lr } = s.zebra;
      add(7, 'Zebra', `${winner.name} (${ord(wr)}) ${live ? 'vence' : 'venceu'} ${o(loser.name)} (${ord(lr)})`, ev);
    }
    if (s.late) {
      const { who, min, team, effect } = s.late;
      add(6, 'Gol no fim', `${who || team.name} marcou aos ${min} e ${effect === 'empate' ? `garantiu o empate ${doo(team.name)}` : `deu a vitória ${ao(team.name)}`}`, ev);
    }
    for (const p of s.hattricks || []) add(6, 'Hat-trick', `${p.n === 3 ? 'Hat-trick' : `${p.n} gols`} de ${p.who} (${p.team.name})`, ev);
    if (s.goleada) add(5, 'Goleada', live ? `Goleada em andamento: ${score}` : `Goleada: ${score}`, ev);
    else if (s.maluco) add(4, 'Chuva de gols', `Jogo de ${ev.home.score + ev.away.score} gols: ${score}`, ev);
  }

  // Prévia dos jogos que ainda vão acontecer.
  if (table) {
    const upcoming = round.events.filter((e) => e.status.kind === 'pre');
    const pos = (t) => liveRank(t.id);
    const best = (filter, score) => upcoming.filter(filter).sort((x, y) => score(x) - score(y))[0];
    const big = best((e) => pos(e.home) <= 6 && pos(e.away) <= 6, (e) => pos(e.home) + pos(e.away));
    const prio = table.started ? 3 : 5;
    if (big) add(prio, 'Jogão', `${big.home.name} (${ord(pos(big.home))}) x ${big.away.name} (${ord(pos(big.away))}), ${kickoff(big.date, now)}`, big, 'plain');
    const low = zones?.zStart ? zones.zStart - 2 : 15;
    const fight = best((e) => pos(e.home) >= low && pos(e.away) >= low, (e) => -(pos(e.home) + pos(e.away)));
    if (fight) add(prio, 'Contra a queda', `${fight.home.name} (${ord(pos(fight.home))}) x ${fight.away.name} (${ord(pos(fight.away))}), ${kickoff(fight.date, now)}`, fight, 'plain');
    if (!table.started) {
      const leader = table.rows[0];
      const g = upcoming.find((e) => e.home.id === leader.id || e.away.id === leader.id);
      if (g && g !== big) {
        const opp = g.home.id === leader.id ? g.away : g.home;
        add(4, 'Líder', `Líder com ${leader.pts} pontos, ${o(leader.name)} pega ${o(opp.name)} (${ord(pos(opp))}) ${kickoff(g.date, now)}`, g, 'plain');
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
