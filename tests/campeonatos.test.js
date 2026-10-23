// App de todos os campeonatos (pasta campeonatos/): competições, fases, confrontos e chances de mata-mata.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseEvent } from '../campeonatos/js/espn.js';
import { FORMATS, compOf, dropStale, formatsFor, phaseLabel, phasesOf, pickPhase, tiesOf } from '../campeonatos/js/comps.js';
import { knockoutOdds, openPhase } from '../campeonatos/js/knockout.js';
import { formatFits, stateOdds } from '../campeonatos/js/estadual.js';

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

// Paulista e Carioca 2026 completos (ESPN), com os grupos do Carioca.
const est = JSON.parse(fs.readFileSync(new URL('./data/estaduais-2026.json', import.meta.url)));
const paulista = est.paulista.map(parseEvent);
const carioca = est.carioca.map(parseEvent);
const gruposCarioca = new Map(Object.entries(est.gruposCarioca));
// "Como estava" numa data: jogos depois dela voltam a ser "a jogar"; as fases seguintes ainda não existem.
const asOf = (events, slug, iso) => events.filter((e) => e.phase === slug).map((e) => (e.date <= new Date(iso) ? e
  : { ...e, status: { kind: 'pre', label: '' }, home: { ...e.home, score: null, pens: null }, away: { ...e.away, score: null, pens: null } }));
const sum = (res, key) => [...res.byTeam.values()].reduce((s, v) => s + v[key], 0);
const named = (events) => new Map(events.flatMap((e) => [[e.home.id, e.home.name], [e.away.id, e.away.name]]));

test('estaduais: formato do ano, classificação, rebaixamento e título', () => {
  const pf = FORMATS['bra.camp.paulista'][2026];
  const cf = FORMATS['bra.camp.carioca'][2026];
  assert.ok(formatFits(pf, paulista, null));
  assert.ok(formatFits(cf, carioca, gruposCarioca));
  assert.ok(!formatFits(cf, carioca, null)); // sem os grupos, o formato do Carioca não fecha
  assert.ok(!formatFits(FORMATS['bra.camp.paulista'][2025], paulista, null)); // 2026 mudou: fase de liga
  // Ano ainda não conferido: tenta o formato mais novo primeiro.
  assert.equal(formatsFor('bra.camp.paulista', 2027)[0].year, 2026);
  const flat = () => [1.3, 1.1];
  // Primeira fase encerrada: os classificados e os rebaixados são os de verdade.
  const names = named(paulista);
  const done = stateOdds({ events: paulista, format: pf, lambda: flat, runs: 300 });
  const quartas = new Set(paulista.filter((e) => e.phase === 'quarterfinals').flatMap((e) => [e.home.id, e.away.id]));
  for (const [id, v] of done.byTeam) assert.equal(v.qualify, quartas.has(id) ? 1 : 0, names.get(id));
  assert.deepEqual([...done.byTeam].filter(([, v]) => v.relegate === 1).map(([id]) => names.get(id)).sort(), ['Ponte Preta', 'Velo Clube']);
  // Campeão: o Palmeiras, já com a final jogada.
  assert.equal(done.byTeam.get('2029').title, 1);
  // No meio da primeira fase: 8 vagas, 2 rebaixados e 1 campeão no total.
  const mid = stateOdds({ events: asOf(paulista, 'league-phase', '2026-01-30T23:59:00-03:00'), format: pf, lambda: flat, runs: 2000 });
  assert.ok(mid.firstLeft > 0);
  assert.ok(Math.abs(sum(mid, 'qualify') - 8) < 1e-9 && Math.abs(sum(mid, 'relegate') - 2) < 1e-9 && Math.abs(sum(mid, 'title') - 1) < 1e-9);
  // Carioca: 4 de cada grupo no mata-mata; o rebaixamento sai do quadrangular dos 5º e 6º colocados.
  const cmid = stateOdds({ events: asOf(carioca, 'taca-guanabara', '2026-01-28T23:59:00-03:00'), format: cf, groups: gruposCarioca, lambda: flat, runs: 2000 });
  assert.ok(Math.abs(sum(cmid, 'qualify') - 8) < 1e-9 && Math.abs(sum(cmid, 'relegate') - 1) < 1e-9);
  const cdone = stateOdds({ events: carioca, format: cf, groups: gruposCarioca, lambda: flat, runs: 300 });
  const cn = named(carioca);
  assert.deepEqual([...cdone.byTeam].filter(([, v]) => v.relegate === 1).map(([id]) => cn.get(id)), ['Maricá']);
  assert.equal(cdone.byTeam.get('819').title, 1); // Flamengo, campeão nos pênaltis
  // Antes das semifinais, chance de chegar a cada fase: só os 4 que seguem vivos.
  const semis = carioca.filter((e) => !/taca-guanabara---(semifinals|final)|taca-rio---final/.test(e.phase) || e.date < new Date('2026-02-21'));
  const ko = stateOdds({ events: semis, format: cf, groups: gruposCarioca, lambda: flat, runs: 2000 });
  assert.deepEqual([...ko.reach[1]].filter(([, p]) => p > 0).length, 4);
});

test('registro antigo de jogo remarcado sai da lista', () => {
  const now = Date.parse('2026-03-20T12:00:00Z');
  const base = paulista.find((e) => e.phase === 'league-phase');
  const stale = { ...base, id: 'velho', date: new Date(+base.date - 3 * 864e5), status: { kind: 'pre', label: '' } };
  assert.deepEqual(dropStale([base, stale], now).map((e) => e.id), [base.id]);
  // Jogo a jogar sem outro registro jogado continua.
  assert.equal(dropStale([stale], now).length, 1);
});
