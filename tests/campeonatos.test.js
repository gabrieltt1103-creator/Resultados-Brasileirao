// App de todos os campeonatos (pasta campeonatos/): competições, fases, confrontos e chances de mata-mata.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseEvent } from '../campeonatos/js/espn.js';
import { compOf, phaseLabel, phasesOf, pickPhase, tiesOf } from '../campeonatos/js/comps.js';
import { knockoutOdds, openPhase } from '../campeonatos/js/knockout.js';

// Quartas, semifinais e final da Libertadores e da Copa do Brasil 2026 (ESPN, 23/10/2026 à noite).
const copas = JSON.parse(fs.readFileSync(new URL('./data/copas-2026.json', import.meta.url)));
const lib = copas.libertadores.map(parseEvent);
const cdb = copas.copaDoBrasil.map(parseEvent);
const NOW = Date.parse('2026-10-23T12:00:00Z');

test('fases, ida e volta, agregado e pênaltis pelos dados da ESPN', () => {
  const comp = compOf('conmebol.libertadores');
  const phases = phasesOf(lib, comp);
  assert.deepEqual(phases.map((p) => p.label), ['Quartas de final', 'Semifinal', 'Final']);
  assert.ok(phases.every((p) => p.knockout));
  // Semifinal encerrada na véspera: é a fase que abre.
  assert.equal(phases[pickPhase(phases, NOW)].label, 'Semifinal');
  const [flu, est] = tiesOf(phases[1].events);
  assert.deepEqual([flu.a.name, flu.b.name, flu.agg[flu.a.id], flu.agg[flu.b.id]], ['Fluminense', 'Palmeiras', 2, 2]);
  assert.equal(flu.winner, '2029'); // Palmeiras, nos pênaltis
  assert.deepEqual([flu.pens['2029'], flu.pens['3445']], [5, 3]);
  assert.ok(flu.done && est.done);
  // A disputa de pênaltis não entra como gol do jogo.
  const volta = flu.legs[1];
  assert.equal(volta.incidents.filter((i) => i.kind === 'goal').length, 1);
  assert.ok(volta.goalsComplete);
  // Copa do Brasil: semifinal por jogar (ida e volta) e final única com os times indefinidos.
  const cb = phasesOf(cdb, compOf('bra.copa_do_brazil'));
  const semis = tiesOf(cb.find((p) => p.slug === 'semifinals').events);
  assert.deepEqual(semis.map((t) => `${t.a.name} x ${t.b.name}`), ['Palmeiras x Vasco', 'Grêmio x Atlético-MG']);
  assert.ok(semis.every((t) => t.legsTotal === 2 && !t.done && !t.winner));
  assert.ok(tiesOf(cb.at(-1).events)[0].tbd);
  // Nomes de fase dos estaduais e de jogo único.
  assert.equal(phaseLabel('taca-rio---semifinals'), 'Taça Rio · semifinal');
  assert.equal(phaseLabel('2026-supercopa-rei', compOf('bra.supercopa_do_brazil')), 'Final');
});

test('chances no mata-mata: confronto aberto, final única e confrontos já decididos', () => {
  // Forças iguais e sem mando: cada confronto perto de 50%, e as chances de título somam 100%.
  const flat = () => [1.3, 1.3];
  const cbComp = compOf('bra.copa_do_brazil');
  const cb = knockoutOdds({ phases: phasesOf(cdb, cbComp), comp: cbComp, lambda: flat, runs: 20000, seed: 3 });
  assert.equal(cb.phase.label, 'Semifinal');
  assert.equal(cb.final, false);
  for (const t of cb.ties) assert.ok(Math.abs(t.p[t.a.id] - 0.5) < 0.02);
  const sum = [...cb.byTeam.values()].reduce((s, v) => s + v.title, 0);
  assert.ok(Math.abs(sum - 1) < 1e-9);
  for (const v of cb.byTeam.values()) assert.ok(Math.abs(v.final - 0.5) < 0.02 && Math.abs(v.title - 0.25) < 0.02);
  // Libertadores: semifinais decididas, sobra a final única (Palmeiras x Estudiantes).
  const libComp = compOf('conmebol.libertadores');
  const phases = phasesOf(lib, libComp);
  assert.equal(phases[openPhase(phases).idx].label, 'Final');
  // Time mais forte (Palmeiras) com mais chance; em campo neutro, a ordem dos times não muda nada.
  const strong = (h, a, neutral) => {
    const k = (id) => (id === '2029' ? 1.7 : 1.1);
    return neutral ? [k(h), k(a)] : [k(h) * 1.15, k(a) * 0.87];
  };
  const lb = knockoutOdds({ phases, comp: libComp, lambda: strong, runs: 20000, seed: 3 });
  assert.ok(lb.final);
  assert.ok(lb.byTeam.get('2029').title > 0.6 && lb.byTeam.get('2029').title < 0.8);
  assert.equal(lb.byTeam.get('2029').final, 1);
  // Sem força conhecida para algum time, nada de chances.
  assert.equal(knockoutOdds({ phases, comp: libComp, lambda: (h) => (h === '2029' ? [1, 1] : null), runs: 100 }), null);
});

test('o app novo guarda tudo com prefixo próprio e não mexe nos dados do app do Brasileirão', async () => {
  const data = new Map([['meu-time', '"819"'], ['temporada:v1', '{"velho":true}']]);
  globalThis.localStorage = {
    getItem: (k) => (data.has(k) ? data.get(k) : null),
    setItem: (k, v) => data.set(k, String(v)),
  };
  const util = await import(`../campeonatos/js/util.js?prefixo=${Date.now()}`);
  // O time escolhido vem do app do Brasileirão; o cache da temporada, não.
  assert.equal(util.store('meu-time', null), '819');
  assert.equal(util.store('temporada:v1', null), null);
  util.save('meu-time', '2029');
  assert.equal(data.get('meu-time'), '"819"');
  assert.equal(data.get('camp:meu-time'), '"2029"');
  delete globalThis.localStorage;
});
