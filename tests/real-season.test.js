// Regressão com a temporada real de 2026 (retrato de 11/10/2026): jogos da ESPN e rodada oficial do Cartola.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildRounds, dropReplaced, pickDefault } from '../js/rounds.js';
import { parseEvent, parseHeadToHead, parseSummaryLineups, parseSummaryPlays, parseSummaryStats } from '../js/espn.js';
import { flowChart, lineupsHtml, withSubs } from '../js/ui.js';
import { h2hSummary, liveClock, matchFlow, matchReading } from '../js/insights.js';
import { computeTable, reconcile, zonesFor } from '../js/table.js';
import { secador } from '../js/sim.js';
import { objectiveFor, pick, rivalsOf, stakeOf, verdict } from '../js/secador.js';

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
  // Leitura do jogo sem as estatísticas: domínio e tempos pelo lance a lance.
  const ev = { status: { kind: 'post' }, home: { id: 'v', name: 'Vasco', score: 0 }, away: { id: 'r', name: 'Remo', score: 0 }, incidents: [], goalsComplete: true };
  assert.deepEqual(matchReading(ev, { plays, flow: f }), [
    'O Vasco foi melhor no primeiro tempo, mas não conseguiu marcar.',
    'No segundo tempo, o Remo equilibrou, e o placar não mudou.',
    'O Vasco criou um pouco mais, mas o empate não foi injusto.',
  ]);

  // Gols no lugar certo (88', 90+1', 90+7'), inclusive nos 13 minutos de acréscimo do 2º tempo.
  const g = matchFlow(parseSummaryPlays(lances['atletico-santos']));
  assert.deepEqual(g.goals.map((x) => [g.label(x.i), x.side]), [["88'", 'away'], ["90+1'", 'home'], ["90+7'", 'home']]);
  assert.equal(g.label(g.slots - 1), "90+13'");

  // Ao vivo: nada depois do minuto atual; no intervalo, o 2º tempo fica vazio.
  const live = matchFlow(plays.filter((p) => p.period === 1 || p.base <= 67), liveClock({ status: { kind: 'live', label: "67'" } }));
  assert.equal(live.label(live.now - 1), "67'");
  assert.ok(live.net.slice(live.now).every((v) => v === 0));
  assert.deepEqual(matchReading({ ...ev, status: { kind: 'live', label: "67'" } }, { flow: live }).slice(1), [
    'O Vasco segue melhor no segundo tempo, mas ainda não conseguiu marcar.',
    'Nos últimos minutos, os dois times foram para cima: jogo lá e cá.',
  ]);
  const ht = matchFlow(plays.filter((p) => p.period === 1), liveClock({ status: { kind: 'live', label: 'INT', half: true } }));
  assert.equal(ht.now, ht.half);
  assert.deepEqual(matchReading({ ...ev, status: { kind: 'live', label: 'INT', half: true } }, { flow: ht }), ['O Vasco foi melhor no primeiro tempo, mas não conseguiu marcar.']);
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

test('secador com a temporada real: rodada 31 para quatro torcedores', () => {
  const valid = dropReplaced(events);
  const rounds = buildRounds(valid, { standings, fullSeason: true });
  const table = computeTable({ standings, events: valid, round: rounds[pickDefault(rounds, NOW)], complete: true });
  const zones = zonesFor(standings);
  const r31 = rounds.find((r) => r.number === 31);
  const fan = (name) => {
    const t = table.rows.find((x) => x.name === name);
    const rivals = rivalsOf(t, table.rows, {});
    const res = secador({ finished: table.finished, events: valid, targets: r31.events.map((e) => e.id), teamIds: [t.id, ...rivals], zones, runs: 2000 });
    const mine = res.teams[t.id];
    const objective = objectiveFor(mine.base, zones);
    const odds = new Map(mine.games.map((g) => [g.id, g]));
    const list = pick(r31.events.map((ev) => {
      const stakes = new Map([...rivals].map((id) => [id, stakeOf(res.teams[id], ev, id, zones)]).filter(([, x]) => x));
      return { ev, v: verdict(ev, { team: t, rivals, objective, odds: odds.get(ev.id), stakes }) };
    }));
    const at = (home) => list.find((x) => x.ev.home.name === home).v;
    return { res: mine, objective, at, list };
  };
  // Athletico-PR (4º): briga pelo G6 e o melhor é o Coritiba, rival, vencer o Atlético-MG.
  const cap = fan('Athletico-PR');
  assert.equal(cap.objective, 'g');
  assert.equal(cap.res.games.length, 10);
  assert.equal(cap.at('Atlético-MG').kind, 'nose');
  assert.equal(cap.at('Athletico-PR').kind, 'mine');
  // Flamengo (líder): Athletico-PR x Palmeiras é o jogo que mais mexe no título; dos rivais, só seca
  // quem está numa briga aberta (o Botafogo contra a queda), não o Fluminense tranquilo no G6.
  const fla = fan('Flamengo');
  assert.equal(fla.objective, 'title');
  const v = fla.at('Athletico-PR');
  assert.equal(v.kind, 'help');
  assert.equal(v.cheer.name, 'Athletico-PR');
  assert.ok(v.values[0] - v.values[2] > 0.15);
  assert.equal(fla.at('Botafogo').kind, 'rival');
  assert.equal(fla.at('Fluminense').kind, 'none');
  assert.equal(fla.at('São Paulo').kind, 'none'); // Vasco, com 4% de risco de cair, não vale a secada
  // Fluminense (3º): seca o Flamengo, que briga pelo título (mesmo que a vitória dele ajudasse um pouco no G6).
  const flu = fan('Fluminense').at('Bahia');
  assert.ok(['pride', 'rival'].includes(flu.kind));
  assert.equal(flu.dry.name, 'Flamengo');
  // Vasco (14º): risco pequeno de cair ainda conta; torce pelo Cruzeiro contra o Grêmio (18º).
  const vas = fan('Vasco');
  assert.equal(vas.objective, 'z');
  assert.ok(vas.res.base.z > 0.01 && vas.res.base.z < 0.1);
  assert.equal(vas.at('Grêmio').cheer.name, 'Cruzeiro');
  // Ninguém fica com a rodada inteira marcada.
  for (const f of [cap, fla, vas]) assert.ok(f.list.filter((x) => x.v?.shown).length <= 5);
  // Mesmos sorteios para os três resultados: jogo que não envolve ninguém perto não muda nada.
  const flat = fla.res.games.find((g) => r31.events.find((e) => e.id === g.id).home.name === 'Remo');
  assert.equal(new Set(flat.title).size, 1);
});

// Coritiba x Botafogo ao vivo (12/10/2026, fim do 1º tempo): placar, resumo e lance a lance reais da ESPN.
const aoVivo = JSON.parse(fs.readFileSync(new URL('./data/coritiba-botafogo-ao-vivo.json', import.meta.url)));

test('leitura de um jogo ao vivo com os dados reais da ESPN', () => {
  const ev = parseEvent(aoVivo.evento);
  const plays = parseSummaryPlays(aoVivo.resumo);
  const flow = matchFlow(plays, liveClock(ev));
  assert.deepEqual(matchReading(ev, { plays, stats: parseSummaryStats(aoVivo.resumo), flow }), [
    "O Botafogo é melhor até aqui, finalizando o dobro do Coritiba. Mesmo assim, foi o Coritiba que abriu o placar, aos 22', num gol contra de Fernando Marçal. " +
      "O Botafogo chegou a marcar aos 26', com Danilo Santos, mas o VAR anulou. O empate veio pouco depois, aos 34', com o próprio Danilo Santos.",
    // Nos acréscimos do 1º tempo (45+2'), os últimos minutos ainda são do 1º tempo.
    'O Botafogo continua em cima, atrás da virada.',
  ]);
  // Placar ainda sem os autores dos gols: a história vem do lance a lance.
  const bare = { ...ev, incidents: [], goalsComplete: false };
  assert.equal(matchReading(bare, { plays })[0],
    "O Coritiba abriu o placar aos 22', num gol contra de Marçal. O Botafogo chegou a marcar aos 26', com Danilo Santos, mas o VAR anulou. O empate veio pouco depois, aos 34', com o próprio Danilo Santos.");
  assert.deepEqual(matchReading(bare), ['Empate em 1 a 1.']);
});

// Chapecoense 0 x 3 Athletico-PR ao vivo (12/10/2026, 58'): placar, resumo e lance a lance reais da ESPN.
const goleadaAoVivo = JSON.parse(fs.readFileSync(new URL('./data/chapecoense-athletico-ao-vivo.json', import.meta.url)));

test('leitura ao vivo: 3 a 0 com pressão parecida não é "jogo equilibrado"', () => {
  const ev = parseEvent(goleadaAoVivo.evento);
  const plays = parseSummaryPlays(goleadaAoVivo.resumo);
  const flow = matchFlow(plays, liveClock(ev));
  const lines = matchReading(ev, { plays, stats: parseSummaryStats(goleadaAoVivo.resumo), flow });
  assert.ok(lines.every((l) => !/equilibrad|parelho|disputado/.test(l)));
  assert.deepEqual(lines, [
    "O Athletico-PR foi letal no primeiro tempo: abriu o placar logo aos 6', com Leozinho. A Chapecoense acertou a trave. " +
      "O Athletico-PR ampliou aos 29', com Luiz Gustavo, e fez o terceiro dois minutos depois, com Kevin Viveros, após escanteio cobrado por Gilberto.",
    'No segundo tempo, a Chapecoense voltou melhor e acertou a trave.',
    // A Chapecoense finalizou o dobro; o Athletico-PR acertou 5 dos 6 chutes.
    'O Athletico-PR finaliza bem menos, mas acertou quase tudo o que chutou. A Chapecoense continua em cima, tentando diminuir.',
  ]);
});

// Fluminense 1 x 2 Santos ao vivo (18/10/2026, 83'): placar, resumo e lance a lance reais da ESPN.
const pausaAoVivo = JSON.parse(fs.readFileSync(new URL('./data/fluminense-santos-ao-vivo.json', import.meta.url)));

test('buraco no gráfico: trecho sem ataque vira faixa, e a leitura conta o que parou o jogo', () => {
  const ev = parseEvent(pausaAoVivo.evento);
  const plays = parseSummaryPlays(pausaAoVivo.resumo);
  const flow = matchFlow(plays, liveClock(ev));
  // Do 62' ao 74', nenhum lance de ataque: atendimento a Neymar e duas trocas do Santos.
  assert.deepEqual(flow.pauses.map((p) => [flow.label(p.raw.from), flow.label(p.raw.to), p.closed, p.subs, p.injured]),
    [["62'", "74'", true, 2, ['Neymar']]]);
  const chart = flowChart(flow, ev);
  assert.match(chart, /class="flow-pause"[^>]*title="62&#39;–74&#39;: sem lances de ataque \(atendimento a Neymar, 2 substituições\)"><i>parado<\/i>/);
  assert.deepEqual(matchReading(ev, { plays, stats: parseSummaryStats(pausaAoVivo.resumo), flow }), [
    "Primeiro tempo bem disputado. O Fluminense abriu o placar logo aos 4', com Rodrigo Castillo, após escanteio cobrado por Igor Rabello.",
    "No segundo tempo, o Santos domina: empatou aos 49', com Gabriel Barbosa, e virou aos 54', de cabeça, com Philippe Coutinho. " +
      "Entre os 62' e os 74', o jogo ficou parado, com o atendimento a Neymar e duas substituições.",
    'Nos últimos minutos, os dois times foram para cima: jogo lá e cá.',
  ]);
  // Ainda sem lance depois do buraco (ao vivo, aos 72'): a faixa vai até agora, e a leitura espera o trecho acabar.
  const at72 = { ...ev, status: { ...ev.status, label: "72'" } };
  const before = plays.filter((p) => p.period === 1 || p.base <= 72);
  const open = matchFlow(before, liveClock(at72));
  assert.deepEqual(open.pauses.map((p) => [open.label(p.raw.from), p.raw.to, p.closed]), [["62'", null, false]]);
  assert.match(flowChart(open, at72), /title="62&#39;–agora: sem lances de ataque/);
  assert.doesNotMatch(matchReading(at72, { plays: before, flow: open }).join(' '), /parado|ninguém chegou/);
});

test('vermelho sem jogador é da comissão técnica: o time segue com onze', () => {
  const raw = structuredClone(goleadaAoVivo.evento);
  const home = raw.competitions[0].competitors.find((c) => c.homeAway === 'home').team.id;
  raw.competitions[0].details.push({ type: { text: 'Red Card' }, clock: { value: 3000, displayValue: "50'" }, team: { id: home }, redCard: true, yellowCard: false, scoringPlay: false });
  const ev = parseEvent(raw);
  assert.ok(ev.incidents.find((i) => i.kind === 'red').staff);
  const plays = parseSummaryPlays(goleadaAoVivo.resumo);
  const text = matchReading(ev, { plays, flow: matchFlow(plays, liveClock(ev)) }).join(' ');
  assert.match(text, /A comissão técnica da Chapecoense levou um vermelho aos 50', sem tirar jogador de campo\./);
  assert.doesNotMatch(text, /um a menos|um a mais/);
  // Se o lance a lance mostra um jogador expulso no mesmo minuto, é jogador.
  const shown = [...plays, { type: 'red-card', side: 'home', period: 2, base: 50, extra: 0, who: 'Marcinho' }];
  assert.match(matchReading(ev, { plays: shown, flow: matchFlow(shown, liveClock(ev)) }).join(' '), /ficou com um a menos aos 50', com a expulsão de Marcinho/);
  // Machucado depois das cinco substituições também deixa o time com um a menos.
  const json = {
    header: { competitions: [{ competitors: [{ homeAway: 'home', team: { displayName: 'Botafogo' } }, { homeAway: 'away', team: { displayName: 'Vasco da Gama' } }] }] },
    commentary: [
      { time: { displayValue: "39'" }, text: 'Luis Osorio (Botafogo) is shown the red card.', play: { type: { type: 'red-card' }, team: { displayName: 'Botafogo' }, period: { number: 1 } } },
      { time: { displayValue: "90'+1'" }, text: 'Arthur Chaves went off injured after Botafogo had used all subs.', play: { type: { type: 'retired' }, team: { displayName: 'Botafogo' }, period: { number: 2 } } },
    ],
  };
  assert.deepEqual(parseSummaryPlays(json).map((p) => `${p.type}:${p.side}:${p.who}`), ['red-card:home:Luis Osorio', 'retired:home:Arthur Chaves']);
});

// Bragantino x Cruzeiro (12/10/2026, 2º tempo): escalações reais da ESPN, recortadas.
const escalacoes = JSON.parse(fs.readFileSync(new URL('./data/bragantino-cruzeiro-escalacoes.json', import.meta.url)));

test('escalações: titulares por linha da formação, trocas, reservas e técnico', () => {
  const l = parseSummaryLineups(escalacoes);
  const names = (t) => t.lines.map((line) => line.map((p) => p.name));
  // 4-2-3-1: goleiro, defesa da direita para a esquerda, volantes, meias e o centroavante.
  assert.equal(l.home.formation, '4-2-3-1');
  assert.deepEqual(names(l.home), [
    ['Tiago Volpi'], ['Ryan Augusto', 'Gustavo Marques', 'Guzmán Rodríguez', 'Juninho Capixaba'], ['Ramires', 'Fabinho'],
    ['Lucas Barbosa', 'Wallace Yan', 'Fernando'], ['Eduardo Sasha'],
  ]);
  assert.equal(l.home.bench.length, 12);
  const kaio = l.away.lines.flat().find((p) => p.name === 'Kaio Jorge');
  assert.deepEqual([kaio.goals, kaio.og], [0, 1]);
  const william = l.away.lines.flat().find((p) => p.name === 'William');
  assert.ok(william.yellow);
  assert.deepEqual([william.out.other, william.out.ht], ['Fabrício Bruno', true]);
  // Trocas em ordem, as do intervalo primeiro.
  assert.deepEqual(l.subs.slice(0, 3).map((x) => `${x.ht ? 'int' : x.min.label} ${x.in}/${x.out}`), ['int Matías Viña/Gabriel Rojas', 'int Fabrício Bruno/William', "58' Eduardo Santos/Gustavo Marques"]);
  // Antes do anúncio, a ESPN manda as listas vazias: sem escalação.
  assert.equal(parseSummaryLineups({ rosters: [{ homeAway: 'home', roster: [] }, { homeAway: 'away', roster: [] }] }), null);

  const ev = { id: '401841260', date: new Date('2026-10-13T00:00Z'), status: { kind: 'live', label: "80'" }, incidents: [],
    home: { id: '6079', name: 'Bragantino' }, away: { id: '2022', name: 'Cruzeiro' } };
  const html = lineupsHtml(ev, l, { home: null, away: { name: 'Artur Jorge', src: 'Wikipédia' } });
  // Listas verticais lado a lado: número, nome (o curto quando é longo) e, à direita, gol, cartão e troca.
  const rows = (html.match(/<li[^>]*>.*?<\/li>/g) || []).map((li) => li.replace(/<[^>]+>/g, '').replace(/&#39;/g, "'"));
  assert.equal(rows.length, 11 + 11 + 12 + 12);
  assert.deepEqual(rows.slice(0, 3), ['18Tiago Volpi', '52Ryan Augusto', "16G. Marques58'"]); // sem nome curto da ESPN: "G. Marques"
  assert.ok(rows.includes('12WilliamInt.'));
  assert.match(html, /<span class="nm" title="William">William<\/span><span class="ev"><i class="card-ico yellow"[^>]*><\/i><span class="lu-swap" title="Saiu para a entrada de Fabrício Bruno">/);
  assert.match(html, /title="Kaio Jorge">Kaio Jorge<\/span><span class="ev"><span class="lu-ic og" title="Gol contra">/);
  // Reservas: primeiro quem entrou, na ordem das trocas; os outros apagados, pelo número.
  assert.deepEqual(rows.slice(22, 25), ["3E. Santos58'", "35M. Fernandes65'", "6Gabriel66'"]);
  assert.match(html, /<li class="idle"><span class="n">1<\/span><span class="nm" title="Cleiton">Cleiton/);
  assert.match(html, /<p class="lu-k">Técnicos<\/p><div class="lu-cols"><p class="lu-coach"><\/p><p class="lu-coach">Artur Jorge<\/p><\/div>/);
  assert.match(html, /Técnicos: Wikipédia\./);
  // Lance a lance: as trocas entram junto com os gols e cartões, as do intervalo depois do 1º tempo.
  const list = withSubs({ ...ev, incidents: [{ kind: 'goal', team: '2022', who: 'Zé Lucas', min: { base: 43, extra: 0, label: "43'", sort: 43 } },
    { kind: 'yellow', team: '6079', who: 'Ryan Augusto', min: { base: 47, extra: 0, label: "47'", sort: 47 } }] }, l);
  assert.deepEqual(list.slice(0, 4).map((i) => `${i.kind}:${i.who}`), ['goal:Zé Lucas', 'sub:Matías Viña', 'sub:Fabrício Bruno', 'yellow:Ryan Augusto']);
  // Sem escalação: antes do jogo, avisa quando sai e mostra os técnicos.
  const pre = lineupsHtml({ ...ev, status: { kind: 'pre' } }, null, { home: { name: 'Vagner Mancini', src: 'Wikipédia' }, away: { name: 'Artur Jorge', src: 'Wikipédia' } });
  assert.match(pre, /As escalações saem cerca de uma hora antes do jogo/);
  assert.match(pre, /<p class="lu-coach">Vagner Mancini<\/p><p class="lu-coach">Artur Jorge<\/p>/);
  assert.equal(lineupsHtml({ ...ev, status: { kind: 'post' } }, null, null), '');
});

test('leitura ao vivo: jeito do gol, passe que conta a jogada e quem ainda não finalizou', () => {
  // Botafogo 1 x 0 Chapecoense aos 22' (17/10/2026): só 4 lances de ataque, e o gráfico já aparece.
  const ev = { id: 'x', date: new Date('2026-10-17T21:00Z'), status: { kind: 'live', label: "22'" }, goalsComplete: true,
    home: { id: '6086', name: 'Botafogo', score: 1 }, away: { id: '9318', name: 'Chapecoense', score: 0 },
    incidents: [{ kind: 'goal', team: '6086', who: 'T. Soares', full: 'Tiquinho Soares', min: { base: 7, extra: 0, label: "7'", sort: 7 } }] };
  const c = (min, type, team, text) => ({ time: { displayValue: min }, text, play: { type: { type }, team: { displayName: team }, period: { number: 1 } } });
  const json = {
    header: { competitions: [{ competitors: [{ homeAway: 'home', team: { displayName: 'Botafogo' } }, { homeAway: 'away', team: { displayName: 'Chapecoense' } }] }] },
    commentary: [
      c("3'", 'offside', 'Botafogo', 'Offside, Botafogo. Vitinho is caught offside.'),
      c("5'", 'shot-blocked', 'Botafogo', 'Attempt blocked. Matheus Martins (Botafogo) right footed shot from outside the box is blocked.'),
      c("7'", 'goal---header', 'Botafogo', 'Goal! Botafogo 1, Chapecoense 0. Tiquinho Soares (Botafogo) header from the centre of the box to the bottom right corner. Assisted by Matheus Martins with a cross.'),
      c("21'", 'shot-on-target', 'Botafogo', 'Attempt saved. Matheus Martins (Botafogo) right footed shot from outside the box is saved.'),
    ],
  };
  const plays = parseSummaryPlays(json);
  const goal = plays.find((p) => p.type === 'goal---header');
  assert.deepEqual([goal.full, goal.how, goal.assist], ['Tiquinho Soares', 'header', { name: 'Matheus Martins', with: 'cross' }]);
  const flow = matchFlow(plays, liveClock(ev));
  assert.ok(flow, 'ao vivo, o gráfico aparece com poucos lances');
  assert.equal(matchFlow(plays), null); // encerrado, com 4 lances, não
  const stats = { 6086: { totalShots: 3, possessionPct: 63.5 }, 9318: { totalShots: 0, possessionPct: 36.5 } };
  const lines = matchReading(ev, { plays, stats, flow });
  assert.equal(lines[0], "O Botafogo é melhor até aqui: abriu o placar aos 7', de cabeça, com Tiquinho Soares, após cruzamento de Matheus Martins.");
  assert.match(lines.at(-1), /A Chapecoense, com pouca bola, ainda não finalizou\.$/);
});
