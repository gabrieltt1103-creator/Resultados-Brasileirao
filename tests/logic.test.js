import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvent, parseStandings, parseSummaryStats } from '../js/espn.js';
import { buildRounds, pickDefault } from '../js/rounds.js';
import { computeTable, distances, finishedTable, formOf, reconcile, scenarios, zonesFor } from '../js/table.js';
import { goalTimeNote, headlines, homeAwayNote, howItWent, impactLines, lastGoal, matchStory, roundStats, scoreChange, statsReading, tableLine, trends } from '../js/insights.js';
import { deltaMonths, vanished } from '../js/season.js';
import { objectiveFor, pick, rivalsOf, sameState, secadorSummary, verdict, verdictText } from '../js/secador.js';
import { statsView, tableCheck } from '../js/ui.js';
import { chances, matchPicks, model, randomScore, rng, suggestScore } from '../js/sim.js';
import { parseMinute } from '../js/util.js';
import * as fx from './fixtures.js';

// Domingo, 11/10/2026, 21h no horário local do teste.
const NOW = new Date(2026, 9, 11, 21, 0).getTime();
const raw = fx.season(NOW);
const events = raw.events.map(parseEvent);
const standings = parseStandings(fx.standings(raw));
const rounds = buildRounds(events, { standings, fullSeason: true });
const focusIdx = pickDefault(rounds, NOW);
const focus = rounds[focusIdx];
const ctx = { standings, events, round: focus, complete: true };
const table = computeTable(ctx);
const zones = zonesFor(standings);
const inFocus = (name) => focus.events.find((e) => e.home.name === name || e.away.name === name);
const team = (name) => standings.find((t) => t.name === name);

test('lê minutos com acréscimo', () => {
  assert.deepEqual(parseMinute("90'+3'"), { base: 90, extra: 3, label: "90+3'", sort: 90.03 });
  assert.equal(parseMinute("12'").label, "12'");
  assert.equal(parseMinute('').base, null);
});

test('normaliza jogos, status e gol contra', () => {
  const live = focus.events.find((e) => e.status.kind === 'live' && e.incidents.some((i) => i.og));
  assert.equal(live.status.label, "67'");
  // O gol contra veio marcado no time do jogador; o placar 1 x 1 exige trocar de lado.
  assert.equal(live.incidents.find((i) => i.og).team, live.away.id);
  assert.ok(live.goalsComplete);
  assert.ok(live.home.stats.totalShots > 0);
  assert.ok(live.home.logo.startsWith('https://a.espncdn.com/i/teamlogos/'));
});

test('monta as 38 rodadas completas, com jogos remarcados na rodada certa', () => {
  assert.equal(rounds.length, 38);
  assert.deepEqual(rounds.map((r) => r.number), Array.from({ length: 38 }, (_, i) => i + 1));
  assert.ok(rounds.every((r) => r.events.length === 10 && r.teams.size === 20));
  assert.equal(focus.number, 30);
  // Rodada 30: o jogo remarcado para quarta continua nela.
  const moved = focus.events.filter((e) => e.moved);
  assert.equal(moved.length, 1);
  assert.equal(moved[0].status.kind, 'pre');
  assert.ok(moved[0].date > NOW);
  // Rodada 28: jogo jogado dias depois; rodada 33: jogo antecipado.
  assert.equal(rounds[27].events.filter((e) => e.moved).length, 1);
  assert.equal(rounds[32].events.filter((e) => e.moved).length, 1);
  assert.equal(rounds[28].events.filter((e) => e.status.kind === 'off').length, 1);
});

test('sem a temporada completa, numera pela classificação oficial', () => {
  const recent = events.filter((e) => e.date > NOW - 20 * 24 * 3600e3);
  const partial = buildRounds(recent, { standings, fullSeason: false });
  const current = partial[pickDefault(partial, NOW)];
  assert.equal(current.number, 30);
  assert.equal(current.events.length, 10);
});

test('tabela calculada pelos jogos bate com a oficial e soma os jogos ao vivo', () => {
  assert.equal(table.mode, 'jogos');
  for (const t of standings) {
    const fin = table.finished.get(t.id);
    assert.equal(fin.pts, t.pts, t.name);
    assert.equal(fin.gp, t.gp, t.name);
  }
  const live = focus.events.find((e) => e.status.kind === 'live' && e.home.score === e.away.score);
  const row = table.byId.get(live.home.id);
  assert.equal(row.gp, team(live.home.name).gp + 1);
  assert.equal(row.pts, team(live.home.name).pts + 1);
  assert.equal(table.anyLive, true);
  assert.equal(table.rows.reduce((s, r) => s + r.delta, 0), 0);
});

test('modo de reserva: classificação da ESPN + jogos da rodada', () => {
  const t = computeTable({ ...ctx, complete: false });
  assert.equal(t.mode, 'espn');
  for (const r of t.rows) assert.equal(r.pts, table.byId.get(r.id).pts, r.name);
});

test('cenários e distâncias', () => {
  const ev = focus.events.find((e) => e.status.kind === 'pre' && !e.moved);
  const sc = scenarios(ctx, ev);
  assert.ok(sc.home.home.pos <= sc.draw.home.pos && sc.draw.home.pos <= sc.away.home.pos);
  const d = distances(table, zones, table.rows[0].id);
  assert.equal(d[0].label, 'Vantagem na liderança');
  assert.equal(zones.gLabel, 'G6');
  assert.equal(zones.zLabel, 'Z4');
});

test('histórias dos jogos e manchetes', () => {
  const rank = (id) => table.preById.get(id)?.pos;
  const hat = matchStory(inFocus('Mirassol') || focus.events[2], rank);
  const comeback = matchStory(focus.events.find((e) => e.incidents.some((i) => i.who === 'Reinaldo')), rank);
  assert.ok(comeback.virada);
  assert.equal(comeback.hattricks[0].who, 'Reinaldo');
  assert.ok(hat);
  const late = matchStory(focus.events.find((e) => e.incidents.some((i) => i.who === 'Cano')), rank);
  assert.equal(late.late.min, "90+3'");
  const items = headlines({ round: focus, table, zones, focus: true, now: new Date(NOW) });
  assert.ok(items.some((i) => i.tag === 'Virada'));
  assert.ok(items.length <= 6 && items.every((i) => i.text && i.tone));
});

test('números da rodada e momento dos times', () => {
  const st = roundStats(focus);
  assert.equal(st.games, 8); // 4 encerrados + 4 ao vivo
  assert.equal(st.goals, 3 + 0 + 4 + 1 + 2 + 2 + 1 + 0);
  assert.equal(st.buckets.reduce((a, b) => a + b, 0), st.timed);
  assert.equal(st.scorers[0].who, 'Reinaldo');
  const tr = trends(events, table.rows);
  assert.equal(tr.hot.length, 3);
  assert.equal(formOf(events, table.rows[0].id).length, 5);
});

test('simulação muda a tabela e o impacto aparece', () => {
  const lastPlace = table.rows[table.rows.length - 1];
  const games = rounds.slice(focusIdx).flatMap((r) => r.events).filter((e) => e.status.kind !== 'post' && (e.home.id === lastPlace.id || e.away.id === lastPlace.id)).slice(0, 4);
  const sims = Object.fromEntries(games.map((e) => [e.id, e.home.id === lastPlace.id ? { h: 3, a: 0 } : { h: 0, a: 3 }]));
  const sim = computeTable({ ...ctx, overrides: sims });
  assert.equal(sim.byId.get(lastPlace.id).pts >= lastPlace.pts + 10, true);
  assert.equal(sim.anySim, true);
  const lines = impactLines({ before: table, after: sim, zones, favorite: lastPlace.id });
  assert.ok(lines.some((l) => l.tag === 'Meu time'));
});

test('chances até o fim: somam certo e reagem à simulação', () => {
  const base = chances({ finished: table.finished, events, zones, runs: 600, seed: 3 });
  assert.ok(base);
  const sum = (k) => [...base.byId.values()].reduce((s, o) => s + o[k], 0);
  assert.ok(Math.abs(sum('title') - 1) < 1e-9);
  assert.ok(Math.abs(sum('z') - 4) < 1e-9);
  assert.ok(Math.abs(sum('g') - 6) < 1e-9);
  // Mesma semente, mesmo resultado (os números não pulam a cada atualização).
  const again = chances({ finished: table.finished, events, zones, runs: 600, seed: 3 });
  assert.deepEqual([...again.byId.values()], [...base.byId.values()]);
  // O lanterna vencendo tudo o que falta melhora as chances de escapar.
  const last = table.rows[table.rows.length - 1].id;
  const sims = {};
  for (const e of events) if (e.status.kind === 'pre' && (e.home.id === last || e.away.id === last)) sims[e.id] = e.home.id === last ? { h: 2, a: 0 } : { h: 0, a: 2 };
  const sim = chances({ finished: table.finished, events, overrides: sims, zones, runs: 600, seed: 3 });
  assert.ok(sim.byId.get(last).z < base.byId.get(last).z);
  // Sem a temporada completa não há como saber o que falta.
  const partial = computeTable({ ...ctx, complete: false });
  assert.equal(chances({ finished: partial.finished, events: events.slice(-60), zones, runs: 10 }), null);
});

test('sugestão de placar e chances de cada jogo', () => {
  const m = model(table.finished, events);
  const ev = focus.events.find((e) => e.status.kind === 'pre');
  const mp = matchPicks(m, ev);
  assert.ok(Math.abs(mp.odds.home + mp.odds.draw + mp.odds.away - 1) < 1e-9);
  const s = suggestScore(m, ev);
  assert.equal(Math.sign(s.h - s.a), mp.suggest);
  assert.deepEqual([s.h, s.a], [mp.picks[mp.suggest].h, mp.picks[mp.suggest].a]);
  // Jogo ao vivo: parte do placar atual.
  const live = focus.events.find((e) => e.status.kind === 'live' && e.away.score > e.home.score);
  const lp = matchPicks(m, live);
  assert.ok(lp.odds.away > lp.odds.home);
  assert.ok(Object.values(lp.picks).every((p) => p.h >= live.home.score && p.a >= live.away.score));
  const r = randomScore(m, ev, rng(1));
  assert.ok(Number.isInteger(r.h) && Number.isInteger(r.a));
});

test('jogos recentes pesam mais que a temporada', () => {
  // Mesmo time e mesma temporada, mas gols concentrados nos últimos jogos: o ataque fica mais forte.
  const t = table.rows[10];
  const mine = events.filter((e) => e.status.kind === 'post' && (e.home.id === t.id || e.away.id === t.id)).sort((x, y) => x.date - y.date);
  const boosted = events.map((e) => {
    if (!mine.slice(-5).includes(e)) return e;
    const home = e.home.id === t.id;
    return { ...e, home: { ...e.home, score: e.home.score + (home ? 3 : 0) }, away: { ...e.away, score: e.away.score + (home ? 0 : 3) } };
  });
  const early = events.map((e) => {
    if (!mine.slice(0, 5).includes(e)) return e;
    const home = e.home.id === t.id;
    return { ...e, home: { ...e.home, score: e.home.score + (home ? 3 : 0) }, away: { ...e.away, score: e.away.score + (home ? 0 : 3) } };
  });
  const rows = (evs) => computeTable({ ...ctx, events: evs }).finished;
  assert.ok(model(rows(boosted), boosted).att.get(t.id) > model(rows(early), early).att.get(t.id));
});

test('estatísticas do resumo do jogo', () => {
  const live = raw.events.find((e) => e.status.type.state === 'in');
  const st = parseSummaryStats(fx.summary(live));
  assert.equal(Object.keys(st).length, 2);
  assert.ok(Object.values(st)[0].saves >= 2);
});

test('confere com a classificação oficial e aplica punição como ajuste', () => {
  const fin = finishedTable({ standings, events, complete: true }).rows;
  const ok = reconcile(fin, standings);
  assert.equal(ok.checked, standings.length);
  assert.equal(ok.adjust.size, 0);
  // Time punido com perda de 3 pontos na classificação oficial.
  const punished = standings[5];
  const official = standings.map((t) => (t === punished ? { ...t, pts: t.pts - 3 } : t));
  const check = reconcile(fin, official);
  assert.deepEqual([...check.adjust], [[punished.id, -3]]);
  const t = computeTable({ ...ctx, standings: official, adjust: check.adjust });
  assert.equal(t.finished.get(punished.id).pts, punished.pts - 3);
  // Depois de um jogo que a ESPN ainda não contou, o ajuste continua valendo.
  const lagging = official.map((x) => (x.id === punished.id ? { ...x, gp: x.gp - 1, pts: x.pts - 3 } : x));
  const later = reconcile(fin, lagging, check.adjust);
  assert.equal(later.adjust.get(punished.id), -3);
  assert.equal(later.ahead, 1);
  assert.match(tableCheck({ mode: 'jogos', check, adjust: check.adjust, teams: t.byId, at: NOW }), /ajustados.*−3/);
  assert.match(tableCheck({ mode: 'jogos', check: ok, adjust: ok.adjust, teams: t.byId, at: NOW }), /Confere com a classificação oficial/);
});

test('recarrega só os meses que ainda podem mudar', () => {
  const now = new Date(2026, 9, 12, 14);
  const list = [{ date: new Date(2026, 9, 18), status: { kind: 'pre' } }, { date: new Date(2026, 6, 1), status: { kind: 'post' } }];
  assert.deepEqual(deltaMonths(list, new Date(2026, 9, 12, 2).getTime(), now), [10, 11, 12]);
  // Leitura anterior no dia 1º: o dia de folga inclui setembro.
  assert.deepEqual(deltaMonths(list, new Date(2026, 9, 1, 5).getTime(), now), [9, 10, 11, 12]);
  // Jogo antigo ainda sem resultado puxa o mês dele.
  const stuck = [...list, { date: new Date(2026, 7, 20), status: { kind: 'pre' } }];
  assert.deepEqual(deltaMonths(stuck, new Date(2026, 9, 12, 2).getTime(), now), [8, 9, 10, 11, 12]);
  // Some da lista o que a ESPN tirou dos meses recarregados, com folga no primeiro dia.
  const evs = [
    { id: 'a', date: new Date(2026, 9, 5) },
    { id: 'b', date: new Date(2026, 9, 1, 0, 30) },
    { id: 'c', date: new Date(2026, 8, 20) },
    { id: 'd', date: new Date(2026, 10, 2) },
  ];
  assert.deepEqual(vanished(evs, new Set(['d']), [10, 11, 12], 2026), ['a']);
  assert.deepEqual(vanished(evs, new Set(['d']), null, 2026), ['a', 'b', 'c']);
});

test('gol, gol anulado e autor do gol', () => {
  const live = focus.events.find((e) => e.status.kind === 'live' && e.home.score > 0);
  const before = { h: live.home.score - 1, a: live.away.score, kind: 'live' };
  assert.deepEqual([...scoreChange(before, live).sides], ['home']);
  assert.deepEqual(scoreChange({ h: live.home.score + 1, a: live.away.score, kind: 'live' }, live), { annulled: true });
  assert.equal(scoreChange({ ...before, kind: 'pre' }, live), null);
  // Gol no último lance: o jogo já aparece encerrado.
  assert.ok(scoreChange(before, { ...live, status: { kind: 'post' } }).sides.has('home'));
  // Lance do gol ainda não chegou: sem autor (não repete o do gol anterior).
  assert.ok(lastGoal(live, live.home));
  assert.equal(lastGoal(live, { ...live.home, score: live.home.score + 1 }), null);
});

test('média de gols da rodada comparada com a do campeonato', () => {
  const st = roundStats(focus);
  assert.match(statsView({ roundLabel: 'Rodada 30', st, trends: null, seasonAvg: st.avg + 0.6 }), /abaixo da média do campeonato/);
  assert.match(statsView({ roundLabel: 'Rodada 30', st, trends: null, seasonAvg: st.avg }), /na média do campeonato/);
});

test('frases da v2: destaque das manchetes, gráficos, estatísticas, como foi e tabela', () => {
  const items = headlines({ round: focus, table, zones, focus: true, now: new Date(NOW) });
  assert.ok(items.every((i) => typeof i.big === 'string'));
  const late = items.find((i) => i.tag === 'Gol no fim');
  assert.match(late.big, /^\d+(\+\d+)?'$/);
  assert.ok(late.text.includes(`aos ${late.big}`));
  assert.equal(homeAwayNote({ homeW: 5, draws: 3, awayW: 0 }, true), 'Nenhum visitante venceu nesta rodada até agora.');
  assert.equal(homeAwayNote({ homeW: 2, draws: 4, awayW: 2 }), 'Rodada de muitos empates.');
  assert.equal(goalTimeNote({ buckets: [0, 3, 4, 3, 3, 4], timed: 17 }), '8 dos 17 gols saíram nos 15 minutos finais de cada tempo, contando os acréscimos.');
  assert.equal(goalTimeNote({ buckets: [1, 4, 1, 1, 0, 1], timed: 8 }), 'O período com mais gols foi entre 16 e 30 minutos: 4 gols.');

  // Atlético-MG 2 x 1 Santos, rodada 30 de 2026: números reais da ESPN.
  const t = (id, name) => ({ id, name, score: 0 });
  const g = (team, base, extra, who) => ({ kind: 'goal', team, who, min: { base, extra, label: extra ? `${base}+${extra}'` : `${base}'`, sort: base + extra / 100 } });
  const ev = { id: 'x', status: { kind: 'post' }, home: { ...t('cam', 'Atlético-MG'), score: 2 }, away: { ...t('san', 'Santos'), score: 1 }, goalsComplete: true,
    incidents: [g('san', 88, 0, 'G. Barbosa'), g('cam', 90, 1, 'Vitor Hugo'), g('cam', 90, 7, 'Thiago Borbas')] };
  const stats = { cam: { totalShots: 21, possessionPct: 50.2, wonCorners: 12 }, san: { totalShots: 10, possessionPct: 49.8, wonCorners: 3 } };
  assert.equal(statsReading(ev, stats), 'O Atlético-MG finalizou mais que o dobro (21 a 10) e teve 12 escanteios contra 3.');
  assert.equal(statsReading(ev, { cam: { totalShots: 12, possessionPct: 64 }, san: { totalShots: 11, possessionPct: 36 } }), 'O Atlético-MG teve 64% de posse de bola.');
  assert.equal(howItWent(ev), 'Os três gols saíram depois dos 88 minutos. O Santos abriu o placar e o Atlético-MG virou nos acréscimos.');
  const single = { ...ev, home: { ...ev.home, score: 1 }, away: { ...ev.away, score: 0 }, incidents: [g('cam', 65, 0, 'J. Carrascal')] };
  assert.equal(howItWent(single), "J. Carrascal marcou o único gol, aos 65'.");

  const leader = table.rows[0];
  assert.match(tableLine(leader.id, table, zones), /^O .+ (segue|fica) em 1º, \d+ pontos? à frente d[oa] /);
  const last = table.rows[table.rows.length - 1];
  assert.match(tableLine(last.id, table, zones), /20º, a \d+ pontos? de sair do Z4\.$/);
});

// ---------- secador ----------
const clubs = ['Flamengo', 'Fluminense', 'Vasco', 'Botafogo', 'Palmeiras', 'Corinthians', 'São Paulo', 'Santos', 'Red Bull Bragantino', 'Mirassol',
  'Athletico Paranaense', 'Coritiba', 'Atlético-MG', 'Cruzeiro', 'Grêmio', 'Internacional', 'Bahia', 'Vitória', 'Remo', 'Chapecoense'];
const league = clubs.map((name, i) => ({ id: String(i + 1), name }));
const club = (name) => league.find((t) => t.name === name);
const names = (ids) => [...ids].map((id) => league.find((t) => t.id === id).name).sort((a, b) => a.localeCompare(b, 'pt-BR'));

test('secador: rivais de fábrica são os grandes do mesmo estado', () => {
  assert.deepEqual(names(rivalsOf(club('Vasco'), league, {})), ['Botafogo', 'Flamengo', 'Fluminense']);
  assert.deepEqual(names(rivalsOf(club('São Paulo'), league, {})), ['Corinthians', 'Palmeiras', 'Santos']);
  assert.deepEqual(names(rivalsOf(club('Athletico Paranaense'), league, {})), ['Coritiba']);
  assert.deepEqual(names(rivalsOf(club('Atlético-MG'), league, {})), ['Cruzeiro']);
  assert.deepEqual(names(rivalsOf(club('Grêmio'), league, {})), ['Internacional']);
  assert.deepEqual(names(rivalsOf(club('Bahia'), league, {})), ['Vitória']);
  assert.deepEqual(names(rivalsOf(club('Red Bull Bragantino'), league, {})), []);
  assert.deepEqual(names(rivalsOf(club('Remo'), league, {})), []);
  // Do mesmo estado sem ser grande: aparece na página do time para ligar, mas vem desligado.
  assert.deepEqual(sameState(club('Palmeiras'), league).map((t) => t.name), ['Corinthians', 'Santos', 'São Paulo', 'Mirassol', 'Red Bull Bragantino']);
  assert.deepEqual(sameState(club('Remo'), league), []);
  // A escolha do torcedor vale mais que a de fábrica; time fora do campeonato é ignorado.
  assert.deepEqual(names(rivalsOf(club('Vasco'), league, { 3: ['1', '99'] })), ['Flamengo']);
  assert.deepEqual(names(rivalsOf(club('Vasco'), league, { 3: [] })), []);
});

test('secador: objetivo do time, inclusive risco pequeno de cair', () => {
  const zz = { g: 6, zStart: 17 };
  assert.equal(objectiveFor({ title: 0.57, g: 1, z: 0 }, zz), 'title');
  assert.equal(objectiveFor({ title: 0, g: 0.87, z: 0 }, zz), 'g');
  assert.equal(objectiveFor({ title: 0, g: 0.01, z: 0.54 }, zz), 'z');
  assert.equal(objectiveFor({ title: 0, g: 0.008, z: 0.035 }, zz), 'z'); // 14º colocado: ainda olha para baixo
  assert.equal(objectiveFor({ title: 0.02, g: 0.999, z: 0 }, zz), 'title');
  assert.equal(objectiveFor({ title: 0, g: 0.003, z: 0.004 }, zz), null);
  assert.equal(objectiveFor({ title: 0, g: 0, z: 0.999 }, zz), null);
  assert.equal(objectiveFor(null, zz), null);
});

test('secador: para quem torcer em cada jogo', () => {
  const zz = { g: 6, gLabel: 'G6', zStart: 17 };
  const game = (h, a, kind = 'pre', hs = null, as = null) => ({ id: `${h}-${a}`, home: { ...club(h), score: hs }, away: { ...club(a), score: as }, status: { kind, label: '' } });
  // stakes: {nomeDoRival: {objective, win, draw, lose}} do próprio jogo do rival.
  const read = (fan, ev, g, objective = 'g', stakes = {}) => {
    const team = club(fan);
    const st = new Map(Object.entries(stakes).map(([name, x]) => [club(name).id, x]));
    const v = verdict(ev, { team, rivals: rivalsOf(team, league, {}), objective, odds: g ? { [objective]: g } : null, stakes: st });
    return { v, ...verdictText(ev, v, { objective, zones: zz }) };
  };
  const cap = 'Athletico Paranaense';

  // Seque quem briga com você: torça pelo outro.
  let r = read(cap, game('Grêmio', 'Cruzeiro'), [0.889, 0.883, 0.864]);
  assert.equal(r.v.kind, 'help');
  assert.equal(r.chip, 'Seque o Cruzeiro');
  assert.equal(r.text, 'Torça pelo Grêmio. Chance de G6: 89% com vitória do Grêmio, 86% com a do Cruzeiro.');
  // Menos de 2 pontos: não ganha linha.
  assert.equal(read(cap, game('Grêmio', 'Cruzeiro'), [0.889, 0.883, 0.874]).v.kind, 'none');

  // O melhor é o rival vencer, com ganho de verdade: nariz tapado.
  r = read(cap, game('Atlético-MG', 'Coritiba'), [0.868, 0.892, 0.903]);
  assert.equal(r.v.kind, 'nose');
  assert.equal(r.text, 'Dessa vez, torça pelo Coritiba, seu rival. Chance de G6: 90% com vitória do Coritiba, 87% com a do Atlético-MG. Ninguém precisa saber.');
  // Ganho pequeno: seque mesmo assim.
  r = read(cap, game('Atlético-MG', 'Coritiba'), [0.86, 0.87, 0.882]);
  assert.equal(r.v.kind, 'pride');
  assert.equal(r.chip, 'Seque o Coritiba');
  assert.equal(r.text, 'A vitória do Coritiba até ajudaria um pouquinho a sua chance de G6, mas tem coisa que não se faz.');
  assert.equal(read(cap, game('Atlético-MG', 'Coritiba', 'live', 1, 0), [0.86, 0.87, 0.882]).state, 'Tá dando certo');
  // Ganho bom, mas a vitória ajudaria mais o rival na briga dele: seque mesmo.
  r = read(cap, game('Atlético-MG', 'Coritiba'), [0.868, 0.892, 0.903], 'g', { Coritiba: { objective: 'z', win: 0.2, draw: 0.32, lose: 0.4 } });
  assert.equal(r.v.kind, 'pride');
  assert.equal(r.text, 'A vitória do Coritiba até ajudaria a sua chance de G6, mas também ajudaria o Coritiba a fugir da queda. Seque mesmo.');

  // Empate como melhor resultado; com uma das vitórias quase igual, vira "seque o outro".
  r = read(cap, game('Fluminense', 'Santos'), [0.58, 0.63, 0.57]);
  assert.equal(r.v.kind, 'draw');
  assert.equal(r.chip, 'Torça pelo empate');
  assert.equal(r.text, 'Chance de G6: 63% com empate, 57% com vitória do Santos.');
  r = read(cap, game('Fluminense', 'Santos'), [0.62, 0.63, 0.57]);
  assert.equal(r.v.kind, 'help');
  assert.equal(r.chip, 'Seque o Santos');

  // Secar o rival também ajuda; empate é o pior.
  assert.equal(read('Atlético-MG', game('Grêmio', 'Cruzeiro'), [0.64, 0.62, 0.59]).chip, 'Seca em dobro');
  assert.equal(read(cap, game('Bahia', 'Vitória'), [0.70, 0.60, 0.69]).v.kind, 'nodraw');

  // Só pela rivalidade: quando o jogo dói para o rival, numa briga aberta.
  const flat = [0.877, 0.877, 0.877];
  r = read(cap, game('Coritiba', 'Remo'), flat, 'g', { Coritiba: { objective: 'z', win: 0.12, draw: 0.25, lose: 0.33 } });
  assert.equal(r.v.kind, 'rival');
  assert.equal(r.text, 'Torça pelo Remo. Se o Coritiba perder, o risco de cair dele sobe para 33%.');
  r = read(cap, game('Coritiba', 'Remo', 'live', 0, 0), flat, 'g', { Coritiba: { objective: 'z', win: 0.12, draw: 0.25, lose: 0.33 } });
  assert.equal(r.state, 'Tá dando certo');
  // Rival tranquilo (93% de G6), com briga quase perdida (8%) ou sem nada em jogo: sem linha.
  assert.equal(read(cap, game('Coritiba', 'Remo'), flat, 'g', { Coritiba: { objective: 'g', win: 0.97, draw: 0.91, lose: 0.85 } }).v.kind, 'none');
  assert.equal(read(cap, game('Coritiba', 'Remo'), flat, 'g', { Coritiba: { objective: 'g', win: 0.19, draw: 0.08, lose: 0.04 } }).v.kind, 'none');
  assert.equal(read(cap, game('Coritiba', 'Remo'), flat).v.kind, 'none');
  // Rival na briga pelo título: "a chance de título dele cai".
  r = read('Vasco', game('Bahia', 'Flamengo'), null, null, { Flamengo: { objective: 'title', win: 0.69, draw: 0.54, lose: 0.47 } });
  assert.equal(r.text, 'Torça pelo Bahia. Se o Flamengo perder, a chance de título dele cai para 47%.');
  // Dois rivais, um deles em apuros: empate.
  r = read('Vasco', game('Flamengo', 'Fluminense', 'post', 2, 1), null, null, { Flamengo: { objective: 'title', win: 0.69, draw: 0.54, lose: 0.47 } });
  assert.equal(r.v.kind, 'derby');
  assert.equal(r.state, 'Não deu');
  assert.equal(read('Vasco', game('Flamengo', 'Fluminense'), null, null).v.kind, 'none');

  // Risco de cair pequeno: um quarto do risco já importa; menos que isso, não.
  r = read('Vasco', game('Grêmio', 'Cruzeiro'), [0.044, 0.035, 0.031], 'z');
  assert.equal(r.text, 'Torça pelo Cruzeiro. Risco de cair: 3% com vitória do Cruzeiro, 4% com a do Grêmio.');
  assert.equal(read('Vasco', game('Corinthians', 'Vitória'), [0.042, 0.036, 0.032], 'z').v.kind, 'none');

  // O próprio jogo: a chance em cada resultado; contra o rival, é clássico.
  assert.equal(read(cap, game('Athletico Paranaense', 'Palmeiras'), [0.942, 0.868, 0.821]).text, 'Chance de G6: 94% se vencer, 87% se empatar, 82% se perder.');
  assert.equal(read(cap, game('Chapecoense', 'Athletico Paranaense'), [0.80, 0.85, 0.95]).text, 'Chance de G6: 95% se vencer, 85% se empatar, 80% se perder.');
  assert.equal(read(cap, game('Coritiba', 'Athletico Paranaense'), [0.80, 0.85, 0.95]).chip, 'Clássico');
  // Jogo encerrado: a conta e se deu certo, sem pedir torcida. Adiado: nada.
  r = read(cap, game('Grêmio', 'Cruzeiro', 'post', 0, 2), [0.889, 0.883, 0.864]);
  assert.equal(r.text, 'Chance de G6: 89% com vitória do Grêmio, 86% com a do Cruzeiro.');
  assert.equal(r.state, 'Não deu');
  assert.equal(verdict(game('Grêmio', 'Cruzeiro', 'off'), { team: club(cap) }), null);
});

test('secador: no máximo 3 jogos que só mexem no objetivo, e o cartão aponta o que mais pesa', () => {
  const zz = { g: 6, gLabel: 'G6', zStart: 17 };
  const team = club('Athletico Paranaense');
  const rivals = rivalsOf(team, league, {});
  const game = (h, a, kind = 'pre', hs = null, as = null) => ({ id: `${h}-${a}`, home: { ...club(h), score: hs }, away: { ...club(a), score: as }, status: { kind, label: '' } });
  const list = (games) => pick(games.map(([ev, g]) => ({ ev, v: verdict(ev, { team, rivals, objective: 'g', odds: { g } }) })));
  const base = { title: 0, g: 0.8775, z: 0 };
  const round = list([
    [game('Grêmio', 'Cruzeiro'), [0.889, 0.883, 0.864]], [game('Atlético-MG', 'Coritiba'), [0.868, 0.892, 0.903]],
    [game('Bahia', 'Flamengo'), [0.854, 0.878, 0.894]], [game('Fluminense', 'Santos'), [0.85, 0.86, 0.88]],
    [game('Mirassol', 'Internacional'), [0.88, 0.87, 0.85]], [game('Remo', 'Vitória'), [0.88, 0.877, 0.877]],
    [game('Athletico Paranaense', 'Palmeiras'), [0.942, 0.868, 0.821]],
  ]);
  const shown = round.filter((x) => x.v.shown).map((x) => x.ev.home.name);
  // Nariz tapado sempre aparece; dos outros, os 3 maiores (Grêmio x Cruzeiro, de 2,5 pontos, fica de fora).
  assert.deepEqual(shown, ['Atlético-MG', 'Bahia', 'Fluminense', 'Mirassol', 'Athletico Paranaense']);
  let sum = secadorSummary({ team, objective: 'g', base, zones: zz, verdicts: round, rivals: 1 });
  assert.deepEqual(sum, { head: 'Athletico Paranaense na briga pelo G6', sub: '88% de chance de G6 hoje', text: '4 jogos mexem com a sua chance de G6. O que mais pesa: Bahia x Flamengo. Um deles é de nariz tapado.' });
  sum = secadorSummary({ team, objective: 'g', base, zones: zz, verdicts: list([[game('Atlético-MG', 'Coritiba'), [0.868, 0.892, 0.903]]]) });
  assert.equal(sum.text, 'Um jogo mexe com a sua chance de G6: Atlético-MG x Coritiba, de nariz tapado.');
  sum = secadorSummary({ team, objective: 'g', base, zones: zz, verdicts: list([
    [game('Grêmio', 'Cruzeiro', 'live', 1, 0), [0.889, 0.883, 0.864]], [game('Atlético-MG', 'Coritiba', 'post', 2, 0), [0.868, 0.892, 0.903]],
    [game('Bahia', 'Flamengo'), [0.854, 0.878, 0.889]],
  ]) });
  assert.equal(sum.text, '1 de 2 secadas está dando certo. Falta 1 jogo.');
  const one = (kind, hs, as) => secadorSummary({ team, objective: 'g', base, zones: zz, verdicts: list([[game('Grêmio', 'Cruzeiro', kind, hs, as), [0.889, 0.883, 0.864]]]) }).text;
  assert.equal(one('post', 0, 1), 'A secada não deu certo.');
  assert.equal(one('post', 2, 1), 'A secada deu certo.');
  assert.equal(one('live', 0, 1), 'Nenhuma secada está dando certo por enquanto.');
  assert.equal(one('live', 0, 0), 'A secada está dando certo.'); // o empate também serve: o que importa é o Cruzeiro não vencer
  assert.equal(secadorSummary({ team, objective: 'g', base, zones: zz, verdicts: list([[game('Remo', 'Vitória'), [0.88, 0.877, 0.877]]]) }).text,
    'Nenhum jogo mexe com a sua chance de G6. Dá para ver a rodada de boa.');
  // Situação do time no título do cartão.
  const head = (objective, b, name = 'Remo') => secadorSummary({ team: club(name), objective, base: { title: 0, g: 0, z: 0, ...b }, zones: zz, verdicts: [] }).head;
  assert.equal(head('z', { z: 0.97 }), 'Remo precisa de um milagre');
  assert.equal(head('z', { z: 0.04 }, 'Vasco'), 'Vasco ainda de olho na queda');
  assert.equal(head('title', { title: 0.93 }, 'Flamengo'), 'Flamengo com a mão na taça');
  assert.equal(head(null, {}, 'Red Bull Bragantino'), 'Nada em jogo para o Red Bull Bragantino na tabela');
  assert.equal(secadorSummary({ team: club('Red Bull Bragantino'), objective: null, base: { title: 0, g: 0, z: 0.003 }, zones: zz, verdicts: [] }).text, 'Dá para ver a rodada de boa.');
  assert.equal(secadorSummary({ team, objective: null, base: null, zones: zz, verdicts: [], ready: false }).sub, 'As contas aparecem quando a temporada carregar inteira.');
});
