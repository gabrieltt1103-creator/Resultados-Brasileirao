// Rodadas no fim do Brasileirão de 2026 (ESPN, 10/11): rodada no meio da semana, jogo quase todo dia de 18 a
// 29/11 e jogos remarcados no meio, sem intervalo entre as rodadas. Conferidas com as rodadas oficiais (Cartola FC).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildRounds, dropReplaced, pickDefault } from '../js/rounds.js';

const snap = JSON.parse(fs.readFileSync(new URL('./data/brasileirao-2026-novembro.json', import.meta.url)));
const team = (id) => ({ id, name: snap.times[id], logo: '' });
const events = snap.jogos.map(([id, date, home, away, kind, hs, as]) => ({
  id, date: new Date(date), home: { ...team(home), score: hs }, away: { ...team(away), score: as }, status: { kind, label: '' }, incidents: [],
}));
const official = new Map(snap.jogos.map((g) => [g[0], g[7]]));
const standings = snap.classificacao.map(([id, pts, gp], i) => ({ id, name: snap.times[id], logo: '', pts, gp, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, rank: i + 1 }));

test('fim do campeonato com jogo todo dia: as 38 rodadas completas, sem jogos avulsos', () => {
  const rounds = buildRounds(dropReplaced(events), { standings, fullSeason: true });
  assert.equal(rounds.method, 'espelho');
  assert.equal(rounds.length, 38);
  assert.ok(rounds.every((r) => !r.loose && r.events.length === 10 && new Set(r.events.flatMap((e) => [e.home.id, e.away.id])).size === 20));
  const wrong = [];
  for (const r of rounds) for (const e of r.events) if (official.get(e.id) !== r.number) wrong.push(`${e.home.name} x ${e.away.name}: ${r.number} em vez de ${official.get(e.id)}`);
  assert.deepEqual(wrong, []);
  // Jogo remarcado para o meio das últimas rodadas fica na rodada dele, marcado como remarcado.
  const r21 = rounds.find((r) => r.number === 21);
  assert.ok(r21.events.find((e) => e.home.name === 'Chapecoense' && e.away.name === 'Vasco').moved);
  // Ao abrir em 10/11, a próxima rodada é a 35.
  assert.equal(rounds[pickDefault(rounds, Date.parse('2026-11-10T12:00:00Z'))].number, 35);
});
