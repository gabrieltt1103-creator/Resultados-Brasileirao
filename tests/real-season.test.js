// Regressão com a temporada real de 2026 (retrato de 11/10/2026): jogos da ESPN e rodada oficial do Cartola.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildRounds, dropReplaced, pickDefault } from '../js/rounds.js';
import { parseSummaryPlays } from '../js/espn.js';
import { flowNote, liveClock, matchFlow } from '../js/insights.js';
import { computeTable, reconcile } from '../js/table.js';

const snap = JSON.parse(fs.readFileSync(new URL('./data/brasileirao-2026.json', import.meta.url)));
const NOW = new Date('2026-10-12T02:00:00Z').getTime();
const team = (id) => ({ id, name: snap.times[id], logo: '' });
const events = snap.jogos.map(([id, date, home, away, kind, hs, as]) => ({
  id,
  date: new Date(date),
  home: { ...team(home), score: hs },
  away: { ...team(away), score: as },
  status: { kind, label: '' },
  incidents: [],
}));
const official = new Map(snap.jogos.map((g) => [g[0], g[7]]));
const standings = snap.classificacao.map(([id, pts, gp], i) => ({ id, name: snap.times[id], logo: '', pts, gp, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, rank: i + 1 }));

test('descarta o registro antigo dos jogos adiados que ganharam nova data', () => {
  const valid = dropReplaced(events);
  assert.equal(events.length, 383);
  assert.equal(valid.length, 380);
  assert.equal(valid.filter((e) => e.status.kind === 'off').length, 1); // adiado ainda sem data
});

test('todas as 380 partidas caem na rodada oficial', () => {
  const rounds = buildRounds(dropReplaced(events), { standings, fullSeason: true });
  assert.equal(rounds.method, 'espelho');
  assert.equal(rounds.length, 38);
  const wrong = [];
  for (const r of rounds) for (const e of r.events) if (official.get(e.id) !== r.number) wrong.push(`${e.home.name} x ${e.away.name}: ${r.number} em vez de ${official.get(e.id)}`);
  assert.deepEqual(wrong, []);
  assert.equal(rounds[pickDefault(rounds, NOW)].number, 30);
  // Rodada 4: três jogos adiados, jogados em julho e setembro (um deles depois do jogo de volta).
  assert.equal(rounds[3].events.filter((e) => e.moved).length, 3);
});

test('a tabela calculada pelos jogos bate com a classificação oficial', () => {
  const valid = dropReplaced(events);
  const rounds = buildRounds(valid, { standings, fullSeason: true });
  const t = computeTable({ standings, events: valid, round: rounds[pickDefault(rounds, NOW)], complete: true });
  for (const s of standings) {
    const row = t.finished.get(s.id);
    assert.equal(row.pts, s.pts, s.name);
    assert.equal(row.gp, s.gp, s.name);
  }
  const check = reconcile(t.finished, standings);
  assert.equal(check.checked, 20);
  assert.equal(check.adjust.size, 0);
});

// Lance a lance real da ESPN (recortado): Vasco 0 x 0 Remo e Atlético-MG 2 x 1 Santos, rodada 30.
const lances = JSON.parse(fs.readFileSync(new URL('./data/lances-2026-r30.json', import.meta.url)));

test('fluxo da partida pelo lance a lance', () => {
  const plays = parseSummaryPlays(lances['vasco-remo']);
  assert.ok(plays.length > 100);
  assert.ok(plays.some((p) => p.side === 'home') && plays.some((p) => p.side === 'away'));
  const f = matchFlow(plays);
  // 45 + 2 de acréscimo no 1º tempo; o 2º tempo vai até os 90+6'.
  assert.equal(f.half, 47);
  assert.equal(f.slots, 98);
  assert.deepEqual(f.goals, []);
  const vasco = { name: 'Vasco' };
  const remo = { name: 'Remo' };
  assert.equal(flowNote(f, vasco, remo), "O Vasco pressionou mais. O melhor momento do Remo foi entre 73' e 81'.");

  // Gols no lugar certo (88', 90+1', 90+7'), inclusive nos 13 minutos de acréscimo do 2º tempo.
  const g = matchFlow(parseSummaryPlays(lances['atletico-santos']));
  assert.deepEqual(g.goals.map((x) => [g.label(x.i), x.side]), [["88'", 'away'], ["90+1'", 'home'], ["90+7'", 'home']]);
  assert.equal(g.label(g.slots - 1), "90+13'");

  // Ao vivo: nada depois do minuto atual; no intervalo, o 2º tempo fica vazio.
  const live = matchFlow(plays.filter((p) => p.period === 1 || p.base <= 67), liveClock({ status: { kind: 'live', label: "67'" } }));
  assert.equal(live.label(live.now - 1), "67'");
  assert.ok(live.net.slice(live.now).every((v) => v === 0));
  assert.match(flowNote(live, vasco, remo, true), /até agora/);
  const ht = matchFlow(plays.filter((p) => p.period === 1), liveClock({ status: { kind: 'live', label: 'INT', half: true } }));
  assert.equal(ht.now, ht.half);
  // Poucos lances: sem gráfico.
  assert.equal(matchFlow(plays.slice(0, 8)), null);
});
