// Disputa de pênaltis e lance a lance incompleto: Vasco 2 x 1 Palmeiras (Copa do Brasil 2026, semifinal),
// em que a ESPN publicou só os lances principais e a disputa cobrança a cobrança.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseEvent, parseShootout, parseSummaryPlays, parseSummaryStats } from '../campeonatos/js/espn.js';
import { matchFlow, matchReading, shootoutStory } from '../campeonatos/js/insights.js';

const data = JSON.parse(fs.readFileSync(new URL('./data/vasco-palmeiras-penaltis.json', import.meta.url)));
const ev = parseEvent(data.evento);

test('lance a lance só com os principais: sem gráfico de pressão e sem "ninguém chegou ao ataque"', () => {
  const plays = parseSummaryPlays(data.resumo);
  // As cobranças da disputa (período 5) não são lances do jogo.
  assert.ok(plays.every((p) => p.period <= 2));
  assert.equal(plays.filter((p) => /^penalty---/.test(p.type)).length, 0);
  // Gols, cartões e trocas não bastam para desenhar a pressão (a estatística tem 25 finalizações).
  assert.equal(matchFlow(plays), null);
  const reading = matchReading(ev, { plays, stats: parseSummaryStats(data.resumo), flow: null }).join(' ');
  assert.ok(!/ninguém chegou ao ataque|truncado|ficou parado/.test(reading));
  assert.match(reading, /O Vasco abriu o placar aos 16', com Facundo Colidio/);
});

test('a prorrogação fica fora do gráfico de pressão', () => {
  const shot = (period, base, side, type = 'shot-on-target') => ({ type, side, period, base, extra: 0, x: null, t: null });
  const plays = [shot(1, 10, 'home'), shot(1, 20, 'away'), shot(1, 30, 'home'), shot(2, 50, 'away'), shot(2, 60, 'home'), shot(2, 70, 'home'), shot(2, 80, 'away', 'corner-awarded')];
  const base = matchFlow(plays);
  const extra = matchFlow([...plays, shot(3, 100, 'home', 'goal'), shot(4, 115, 'away')]);
  assert.equal(extra.slots, base.slots);
  assert.deepEqual(extra.home, base.home);
  assert.equal(extra.goals.length, 0);
});

test('disputa de pênaltis cobrança a cobrança, na ordem, e contada na leitura do jogo', () => {
  const kicks = parseShootout(data.resumo);
  assert.equal(kicks.length, 12);
  // O Palmeiras (visitante) bateu primeiro; as cobranças se alternam.
  assert.deepEqual(kicks.slice(0, 4).map((k) => `${k.side}:${k.who}:${k.scored ? 'gol' : 'fora'}`), ['away:Vitor Roque:gol', 'home:Alan Lescano:fora', 'away:Gustavo Gómez:gol', 'home:Thiago Mendes:gol']);
  assert.deepEqual(kicks.filter((k) => !k.scored).map((k) => k.who), ['Alan Lescano', 'Agustín Giay', 'Andrés Gómez']);
  assert.deepEqual([kicks.filter((k) => k.side === 'home' && k.scored).length, kicks.filter((k) => k.side === 'away' && k.scored).length], [ev.home.pens, ev.away.pens]);
  const story = shootoutStory(ev, kicks);
  assert.equal(story, 'Nos pênaltis, o Palmeiras venceu por 5 a 4. Alan Lescano perdeu a primeira cobrança do Vasco e Agustín Giay desperdiçou a cobrança que daria a vaga ao Palmeiras, mas José Luis Rodríguez marcou e levou a disputa para as alternadas. Nelas, Marlon Freitas converteu e Andrés Gómez perdeu.');
  // Na leitura, o último parágrafo; numa final, o que estava em jogo era o título.
  assert.equal(matchReading(ev, { plays: parseSummaryPlays(data.resumo), shootout: kicks }).at(-1), story);
  assert.match(shootoutStory(ev, kicks, { prize: 'o título' }), /que daria o título ao Palmeiras/);
});

test('outras disputas: decidida antes das alternadas, cobrança defendida e disputa em andamento', () => {
  const game = { home: { name: 'Flamengo' }, away: { name: 'Corinthians' } };
  const k = (side, who, scored, extra = {}) => ({ side, who, scored, ...extra });
  // 4 a 2: o Corinthians perde duas (uma defendida por Rossi) e Pedro converte a que decide.
  const decided = [k('home', 'Arrascaeta', true), k('away', 'Yuri Alberto', false, { saved: true, keeper: 'Rossi' }), k('home', 'Pedro', true), k('away', 'Garro', true),
    k('home', 'Jorginho', true), k('away', 'Memphis', false), k('home', 'Léo Pereira', true)];
  assert.equal(shootoutStory(game, decided), 'Nos pênaltis, o Flamengo venceu por 4 a 1. Yuri Alberto parou em Rossi na primeira cobrança do Corinthians, Memphis perdeu a terceira cobrança do Corinthians e Léo Pereira converteu a última.');
  // As dez primeiras entram; nas alternadas, decide na segunda rodada.
  const sudden = [];
  for (let i = 0; i < 5; i++) sudden.push(k('home', `F${i + 1}`, true), k('away', `C${i + 1}`, true));
  sudden.push(k('home', 'F6', true), k('away', 'C6', true), k('home', 'F7', false), k('away', 'C7', true));
  assert.equal(shootoutStory(game, sudden), 'Nos pênaltis, o Corinthians venceu por 7 a 6. As dez primeiras cobranças entraram. Nas alternadas, que foram até a 2ª rodada, F7 perdeu e C7 converteu.');
  // Ainda batendo: só o placar até aqui.
  assert.equal(shootoutStory(game, decided.slice(0, 3)), 'Disputa de pênaltis em andamento: Flamengo 2, Corinthians 0.');
});
