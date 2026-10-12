// Regressão com a temporada real de 2026 (retrato de 11/10/2026): jogos da ESPN e rodada oficial do Cartola.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildRounds, dropReplaced, pickDefault } from '../js/rounds.js';
import { parseHeadToHead, parseSummaryPlays } from '../js/espn.js';
import { flowNote, h2hSummary, liveClock, matchFlow } from '../js/insights.js';
import { computeTable, reconcile, zonesFor } from '../js/table.js';
import { secador } from '../js/sim.js';
import { objectiveFor, rivalsOf, verdict } from '../js/secador.js';

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

// Últimos confrontos reais (ESPN, outubro de 2026), recortados.
const confrontos = JSON.parse(fs.readFileSync(new URL('./data/confrontos-2026.json', import.meta.url)));

test('últimos confrontos entre os dois times', () => {
  const gre = { id: '6273', name: 'Grêmio' };
  const cor = { id: '874', name: 'Corinthians' };
  const games = parseHeadToHead(confrontos['gremio-corinthians'], '401841334');
  assert.equal(games.length, 5);
  assert.deepEqual(games.map((g) => g.competition), ['Série A 2026', 'Série A 2025', 'Série A 2025', 'Série A 2024', 'Copa do Brasil 2024']);
  // Copa do Brasil 2024: 0 x 0 e o Corinthians passou nos pênaltis; no retrospecto conta como empate.
  assert.equal(games[4].pens, 'away');
  const sum = h2hSummary(games, gre, cor);
  assert.deepEqual([sum.wins[gre.id], sum.draws, sum.wins[cor.id]], [0, 2, 3]);
  assert.equal(sum.note, 'O Corinthians não perde para o Grêmio há 5 jogos. Nos últimos 5 confrontos: 3 vitórias do Corinthians e 2 empates.');
  // Confronto com jogos da Série B e da Libertadores; o próprio jogo, quando já aconteceu, sai da lista.
  const chape = parseHeadToHead(confrontos['chapecoense-athletico'], '401841265');
  assert.ok(chape.some((g) => g.competition === 'Série B 2025'));
  const fla = parseHeadToHead(confrontos['flamengo-palmeiras'], '401841322');
  assert.ok(fla.some((g) => g.competition === 'Libertadores 2025'));
  assert.equal(h2hSummary(fla, { id: '819', name: 'Flamengo' }, { id: '2029', name: 'Palmeiras' }).total, 'Nos últimos 5 confrontos: 3 vitórias do Flamengo, 1 vitória do Palmeiras e 1 empate.');
  assert.equal(parseHeadToHead(confrontos['flamengo-palmeiras'], fla[0].id).length, 4);
  assert.equal(h2hSummary([], gre, cor), null);
});

test('secador com a temporada real: rodada 31 para três torcedores', () => {
  const valid = dropReplaced(events);
  const rounds = buildRounds(valid, { standings, fullSeason: true });
  const table = computeTable({ standings, events: valid, round: rounds[pickDefault(rounds, NOW)], complete: true });
  const zones = zonesFor(standings);
  const r31 = rounds.find((r) => r.number === 31);
  const fan = (name) => {
    const t = table.rows.find((x) => x.name === name);
    const res = secador({ finished: table.finished, events: valid, targets: r31.events.map((e) => e.id), teamId: t.id, zones, runs: 2000 });
    const objective = objectiveFor(res.base, zones);
    const rivals = rivalsOf(t, table.rows, {});
    const odds = new Map(res.games.map((g) => [g.id, g]));
    const at = (home) => {
      const ev = r31.events.find((e) => e.home.name === home);
      return verdict(ev, { team: t, rivals, objective, odds: odds.get(ev.id) });
    };
    return { res, objective, at };
  };
  // Athletico-PR (4º): briga pelo G6 e o melhor é o Coritiba, rival, vencer o Atlético-MG.
  const cap = fan('Athletico-PR');
  assert.equal(cap.objective, 'g');
  assert.equal(cap.res.games.length, 10);
  assert.equal(cap.at('Atlético-MG').kind, 'nose');
  assert.equal(cap.at('Athletico-PR').kind, 'mine');
  // Flamengo (líder): Athletico-PR x Palmeiras é o jogo que mais mexe no título.
  const fla = fan('Flamengo');
  assert.equal(fla.objective, 'title');
  const v = fla.at('Athletico-PR');
  assert.equal(v.kind, 'help');
  assert.equal(v.cheer.name, 'Athletico-PR');
  assert.ok(v.values[0] - v.values[2] > 0.15);
  assert.equal(fla.at('São Paulo').kind, 'rival'); // São Paulo x Vasco: só pela rivalidade
  // Vasco (14º): risco pequeno de cair ainda conta; torce pelo Cruzeiro contra o Grêmio (18º).
  const vas = fan('Vasco');
  assert.equal(vas.objective, 'z');
  assert.ok(vas.res.base.z > 0.01 && vas.res.base.z < 0.1);
  assert.equal(vas.at('Grêmio').cheer.name, 'Cruzeiro');
  // Mesmos sorteios para os três resultados: jogo que não envolve ninguém perto não muda nada.
  const flat = fla.res.games.find((g) => r31.events.find((e) => e.id === g.id).home.name === 'Remo');
  assert.equal(new Set(flat.title).size, 1);
});
