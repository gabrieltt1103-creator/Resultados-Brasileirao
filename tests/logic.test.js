import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvent, parseStandings, parseSummaryStats } from '../js/espn.js';
import { buildRounds, pickDefault } from '../js/rounds.js';
import { computeTable, distances, formOf, scenarios, zonesFor } from '../js/table.js';
import { headlines, impactLines, matchStory, roundStats, trends } from '../js/insights.js';
import { chances, model, randomScore, rng } from '../js/sim.js';
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

test('sorteio de placares usa o modelo', () => {
  const m = model(table.finished, events);
  const ev = focus.events.find((e) => e.status.kind === 'pre');
  const s = randomScore(m, ev, rng(1));
  assert.ok(Number.isInteger(s.h) && Number.isInteger(s.a));
});

test('estatísticas do resumo do jogo', () => {
  const live = raw.events.find((e) => e.status.type.state === 'in');
  const st = parseSummaryStats(fx.summary(live));
  assert.equal(Object.keys(st).length, 2);
  assert.ok(Object.values(st)[0].saves >= 2);
});
