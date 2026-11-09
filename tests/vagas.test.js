// Vagas na Libertadores pelo Brasileirão: as regras de 2026 (G5, os dois finalistas da Copa do Brasil, os
// campeões continentais e o finalista rebaixado) e as de antes (G6 e só o campeão da Copa do Brasil).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseEvent } from '../js/espn.js';
import { computeTable, zonesFor } from '../js/table.js';
import { buildRounds, dropReplaced, pickDefault } from '../js/rounds.js';
import { compOf, phasesOf } from '../js/comps.js';
import { knockoutOdds } from '../js/knockout.js';
import { chances, libertadoresCut, rng } from '../js/sim.js';
import { cupSlots, rulesFor, vagasInput } from '../js/vagas.js';
import { vagasRange } from '../js/ui.js';

// Tabela final t1…t20 (Z4 do 17º ao 20º); cada copa com um único caso, de chance 1.
const table = Array.from({ length: 20 }, (_, i) => `t${i + 1}`);
const cut = (rules, ...cups) => libertadoresCut(table.map((_, i) => i), table.map((id) => ({ id })), { ...rules, cups: cups.map((ids) => [{ ids, p: 1 }]) }, 17, rng(1));

test('até onde vai a vaga pela tabela, com as regras de 2026', () => {
  const r = rulesFor(2026);
  assert.deepEqual(r, { base: 5, finalists: true });
  // Finalistas da Copa do Brasil fora da zona, campeões continentais estrangeiros: só o G5.
  assert.equal(cut(r, ['t12', 't14'], [], []), 5);
  // Finalista que também está no G5 libera a vaga da tabela.
  assert.equal(cut(r, ['t2', 't12'], [], []), 6);
  // O mesmo clube também campeão da Libertadores: mais uma.
  assert.equal(cut(r, ['t2', 't12'], ['t2'], []), 7);
  // Finalista rebaixado não joga a Libertadores: a vaga dele desce para a tabela.
  assert.equal(cut(r, ['t2', 't18'], ['t2'], []), 8);
  // Campeão da Sul-Americana dentro da zona: o G9.
  assert.equal(cut(r, ['t2', 't18'], ['t2'], ['t7']), 9);
  // Campeão da Sul-Americana fora da zona leva a vaga dele, mas não mexe na tabela.
  assert.equal(cut(r, ['t2', 't18'], ['t2'], ['t10']), 8);
  // Finalista que não é da Série A fica com a vaga.
  assert.equal(cut(r, ['t2', 'serie-b'], [], []), 6);
});

test('regras de antes de 2026: G6 e o campeão da Copa do Brasil (como em 2019 e 2024)', () => {
  const r = rulesFor(2025);
  assert.deepEqual(r, { base: 6, finalists: false });
  // 2019: Flamengo campeão brasileiro e da Libertadores, Athletico (5º) campeão da Copa do Brasil: G8.
  assert.equal(cut(r, ['t5'], ['t1'], []), 8);
  // 2024: Botafogo campeão brasileiro e da Libertadores, Flamengo (3º) campeão da Copa do Brasil: G8.
  assert.equal(cut(r, ['t3'], ['t1'], []), 8);
  assert.equal(cut(r, ['t10'], [], []), 6);
});

// Copa do Brasil (semifinais por jogar) e Libertadores (final por jogar) de 2026, pela ESPN em 23/10.
const copas = JSON.parse(fs.readFileSync(new URL('./data/copas-2026.json', import.meta.url)));
const flat = () => [1.3, 1.3];
const ours = new Set(['2029', '3454', '6273', '7632', '819', '3445']);

test('o que cada copa dá de vaga, com a chance de cada caso', () => {
  const cbComp = compOf('bra.copa_do_brazil');
  const cbPhases = phasesOf(copas.copaDoBrasil.map(parseEvent), cbComp);
  const cbOdds = knockoutOdds({ phases: cbPhases, comp: cbComp, lambda: flat, runs: 4000, seed: 3 });
  const cb = cupSlots({ slug: 'bra.copa_do_brazil', phases: cbPhases, odds: cbOdds, ours, finalists: true });
  // Os dois finalistas levam vaga: um de cada semifinal (Palmeiras ou Vasco, Grêmio ou Atlético-MG).
  assert.equal(cb.length, 4);
  assert.ok(Math.abs(cb.reduce((s, x) => s + x.p, 0) - 1) < 1e-9);
  for (const x of cb) assert.ok(x.ids.length === 2 && x.ids.some((id) => ['2029', '3454'].includes(id)) && x.ids.some((id) => ['6273', '7632'].includes(id)));
  // Antes de 2026, só o campeão.
  assert.ok(cupSlots({ slug: 'bra.copa_do_brazil', phases: cbPhases, odds: cbOdds, ours, finalists: false }).every((x) => x.ids.length === 1));

  // Libertadores: Palmeiras x Estudiantes. Campeão estrangeiro não dá vaga a mais.
  const libComp = compOf('conmebol.libertadores');
  const libEvents = copas.libertadores.map(parseEvent);
  const libPhases = phasesOf(libEvents, libComp);
  const lib = cupSlots({ slug: 'conmebol.libertadores', phases: libPhases, odds: knockoutOdds({ phases: libPhases, comp: libComp, lambda: flat, runs: 4000, seed: 3 }), ours, finalists: true });
  assert.deepEqual(lib.map((x) => x.ids).sort(), [[], ['2029']]);
  assert.ok(Math.abs(lib.find((x) => x.ids.length).p - 0.5) < 0.03);
  // Final jogada: o campeão, com chance 1.
  const played = (h, a) => libEvents.map((e) => (e.phase === 'final' ? { ...e, status: { kind: 'post', label: 'FT' }, home: { ...e.home, score: h }, away: { ...e.away, score: a } } : e));
  assert.deepEqual(cupSlots({ slug: 'conmebol.libertadores', phases: phasesOf(played(1, 0), libComp), odds: null, ours, finalists: true }), [{ ids: ['2029'], p: 1 }]);
  assert.deepEqual(cupSlots({ slug: 'conmebol.libertadores', phases: phasesOf(played(0, 2), libComp), odds: null, ours, finalists: true }), [{ ids: [], p: 1 }]);
  // Sem as chances (força desconhecida), não dá para saber; sem uma das copas, nada de cenários.
  assert.equal(cupSlots({ slug: 'conmebol.libertadores', phases: libPhases, odds: null, ours, finalists: true }), null);
  assert.equal(vagasInput({ year: 2026, cups: { 'bra.copa_do_brazil': { phases: cbPhases, odds: cbOdds } }, ours }), null);
});

// Brasileirão de 2026 na rodada 31 (o mesmo retrato de real-season.test.js).
const snap = JSON.parse(fs.readFileSync(new URL('./data/brasileirao-2026.json', import.meta.url)));
const team = (id) => ({ id, name: snap.times[id], logo: '' });
const events = dropReplaced(snap.jogos.map(([id, date, home, away, kind, hs, as]) => ({
  id, date: new Date(date), home: { ...team(home), score: hs }, away: { ...team(away), score: as }, status: { kind, label: '' }, incidents: [],
})));
const standings = snap.classificacao.map(([id, pts, gp], i) => ({ id, name: snap.times[id], logo: '', pts, gp, w: 0, d: 0, l: 0, gf: 0, ga: 0, gd: 0, rank: i + 1 }));

test('chances do Brasileirão com as vagas das copas: cenários de G5 a G9', () => {
  const rounds = buildRounds(events, { standings, fullSeason: true });
  const t = computeTable({ standings, events, round: rounds[pickDefault(rounds, Date.parse('2026-10-12T02:00:00Z'))], complete: true });
  const zones = zonesFor(standings);
  const [first, second] = standings;
  // Finalistas da Copa do Brasil: os dois primeiros (sempre no G5); campeões continentais estrangeiros: G7.
  const fixed = { ...rulesFor(2026), cups: [[{ ids: [first.id, second.id], p: 1 }], [{ ids: [], p: 1 }], [{ ids: [], p: 1 }]] };
  const a = chances({ finished: t.finished, events, zones, runs: 600, seed: 3, vagas: fixed });
  assert.ok(a.vagas.dist[7] > 0.99);
  // Com as copas sorteadas: a chance de cada cenário soma 1, e cada time tem a chance de terminar até cada posição.
  const mixed = { ...rulesFor(2026), cups: [[{ ids: [first.id, '6273'], p: 1 }], [{ ids: [first.id], p: 0.5 }, { ids: [], p: 0.5 }], [{ ids: [], p: 1 }]] };
  const b = chances({ finished: t.finished, events, zones, runs: 600, seed: 3, vagas: mixed });
  assert.ok(Math.abs(Object.values(b.vagas.dist).reduce((s, p) => s + p, 0) - 1) < 1e-9);
  assert.ok(Object.keys(b.vagas.dist).every((k) => k >= 6 && k <= 9));
  for (const o of b.byId.values()) {
    assert.ok(o.cum.every((p, i) => i === 0 || p >= o.cum[i - 1] - 1e-12));
    assert.ok(Math.abs(o.cum[19] - 1) < 1e-9 && Math.abs(o.cum[0] - o.title) < 1e-12);
  }
  // As copas têm o seu sorteio: os campeonatos sorteados (e as outras chances) são os mesmos sem elas.
  const c = chances({ finished: t.finished, events, zones, runs: 600, seed: 3 });
  assert.equal(c.vagas, null);
  for (const [id, o] of c.byId) assert.equal(o.title, b.byId.get(id).title);
});

test('na tela: das posições já garantidas até a última que ainda pode ter vaga', () => {
  const vr = vagasRange({ base: 5, dist: { 6: 0.1, 7: 0.5, 9: 0.4 } });
  assert.deepEqual([vr.from, vr.to], [6, 9]);
  assert.ok(Math.abs(vr.atLeast(7) - 0.9) < 1e-9 && Math.abs(vr.atLeast(8) - 0.4) < 1e-9);
  const only = vagasRange({ base: 5, dist: { 5: 1 } });
  assert.deepEqual([only.from, only.to], [5, 5]);
  assert.equal(vagasRange(null), null);
});
