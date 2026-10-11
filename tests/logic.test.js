import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseEvent, parseStandings, parseSummaryStats } from '../js/espn.js';
import { buildRounds, pickDefault } from '../js/rounds.js';
import { computeTable, distances, formOf, scenarios, zonesFor } from '../js/table.js';
import { headlines, matchStory, roundStats, trends } from '../js/insights.js';
import { grade } from '../js/bolao.js';
import { parseMinute } from '../js/util.js';
import * as fx from './fixtures.js';

// Domingo, 11/10/2026, 21h no horário local do teste.
const NOW = new Date(2026, 9, 11, 21, 0).getTime();
const raw = fx.scoreboard(NOW);
const events = raw.events.map(parseEvent);
const standings = parseStandings(fx.standings());
const rounds = buildRounds(events, standings);
const focusIdx = pickDefault(rounds, NOW);
const focus = rounds[focusIdx];
const table = computeTable(standings, focus, events);
const zones = zonesFor(standings);
const byName = (name) => focus.events.find((e) => e.home.name === name || e.away.name === name);
const team = (name) => standings.find((t) => t.name === name);

test('lê minutos com acréscimo', () => {
  assert.deepEqual(parseMinute("90'+3'"), { base: 90, extra: 3, label: "90+3'", sort: 90.03 });
  assert.equal(parseMinute("12'").label, "12'");
  assert.equal(parseMinute('').base, null);
});

test('normaliza jogos, status e gol contra', () => {
  const live = events.find((e) => e.status.kind === 'live' && e.home.name === 'São Paulo');
  assert.equal(live.status.label, "67'");
  // O gol contra veio marcado no time do jogador (Bragantino); o placar 1 x 1 exige trocar de lado.
  const og = live.incidents.find((i) => i.og);
  assert.equal(og.team, live.away.id);
  assert.ok(live.goalsComplete);
  assert.equal(events.find((e) => e.status.label === 'INT').status.kind, 'live');
  assert.equal(events.filter((e) => e.status.kind === 'off').length, 1);
  assert.equal(live.home.stats.totalShots > 0, true);
});

test('agrupa as rodadas e descobre o número de cada uma', () => {
  assert.deepEqual(rounds.map((r) => r.number), [26, 27, 28, 29, 30, 31]);
  assert.equal(rounds.every((r) => r.events.length === 10), true);
  assert.equal(focus.number, 30);
});

test('tabela ao vivo não conta duas vezes os jogos já encerrados', () => {
  // Jogos encerrados ontem já estão na tabela oficial; os ao vivo, não.
  const fla = table.byId.get(team('Flamengo').id);
  assert.equal(fla.pts, team('Flamengo').pts);
  assert.equal(fla.gp, team('Flamengo').gp);
  const saoPaulo = table.byId.get(team('São Paulo').id);
  assert.equal(saoPaulo.gp, team('São Paulo').gp + 1); // jogando agora
  assert.equal(saoPaulo.pts, team('São Paulo').pts + 1); // empatando
  assert.equal(table.anyLive, true);
  // Antes da rodada, o Flamengo (que venceu) tinha 3 pontos a menos.
  assert.equal(table.preById.get(fla.id).pts, fla.pts - 3);
  // Bragantino vence o Corinthians fora; a rodada mexe na tabela.
  assert.equal(table.byId.get(team('Bragantino').id).result.res, 'V');
  assert.ok(table.rows.some((r) => r.delta > 0) && table.rows.some((r) => r.delta < 0));
  assert.equal(table.rows.reduce((s, r) => s + r.delta, 0), 0);
});

test('cenários e distâncias', () => {
  const ev = focus.events.find((e) => e.status.kind === 'pre');
  const sc = scenarios(standings, focus, events, ev);
  assert.ok(sc.home.home.pos <= sc.draw.home.pos && sc.draw.home.pos <= sc.away.home.pos);
  const d = distances(table, zones, team('Flamengo').id);
  assert.equal(d[0].label, 'Vantagem na liderança');
  assert.equal(zones.gLabel, 'G6');
  assert.equal(zones.zLabel, 'Z4');
});

test('histórias dos jogos: virada, hat-trick, zebra e gol no fim', () => {
  const rank = (id) => table.preById.get(id)?.pos;
  const virada = matchStory(byName('Botafogo'), rank);
  assert.ok(virada.virada);
  assert.equal(virada.hattricks[0].who, 'Reinaldo');
  assert.ok(virada.zebra);
  const late = matchStory(byName('Fluminense'), rank);
  assert.equal(late.late.min, "90+3'");
  const pen = matchStory(byName('Flamengo'), rank);
  assert.equal(pen.late.effect, 'vitória');
});

test('manchetes priorizam tabela e lances', () => {
  const items = headlines({ round: focus, table, zones, focus: true, now: new Date(NOW) });
  const tags = items.map((i) => i.tag);
  assert.ok(tags.includes('Virada'));
  assert.ok(tags.includes('Zebra'));
  assert.ok(items.length <= 6);
  assert.ok(items.every((i) => i.text && i.tone));
  const article = items.find((i) => /Chapecoense/.test(i.text));
  if (article) assert.match(article.text, /a Chapecoense|da Chapecoense|à Chapecoense|Chapecoense \(/);
});

test('números da rodada', () => {
  const st = roundStats(focus);
  assert.equal(st.games, 8); // 4 encerrados + 4 ao vivo
  assert.equal(st.goals, 3 + 0 + 4 + 1 + 2 + 2 + 1 + 0);
  assert.equal(st.buckets.reduce((a, b) => a + b, 0), st.timed);
  assert.equal(st.scorers[0].who, 'Reinaldo');
  assert.equal(st.reds, 1);
  const tr = trends(events, standings);
  assert.equal(tr.hot.length, 3);
  assert.equal(formOf(events, team('Flamengo').id).length, 5);
});

test('estatísticas do resumo do jogo', () => {
  const live = raw.events.find((e) => e.status.type.state === 'in');
  const st = parseSummaryStats(fx.summary(live));
  assert.equal(Object.keys(st).length, 2);
  assert.ok(Object.values(st)[0].saves >= 2);
});

test('pontuação do bolão', () => {
  assert.equal(grade({ h: 2, a: 1 }, 2, 1).pts, 3);
  assert.equal(grade({ h: 1, a: 0 }, 3, 1).pts, 1);
  assert.equal(grade({ h: 1, a: 1 }, 0, 0).pts, 1);
  assert.equal(grade({ h: 0, a: 1 }, 2, 0).pts, 0);
});
