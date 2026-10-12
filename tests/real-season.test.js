// Regressão com a temporada real de 2026 (retrato de 11/10/2026): jogos da ESPN e rodada oficial do Cartola.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildRounds, dropReplaced, pickDefault } from '../js/rounds.js';
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
