// Secador: em cada jogo da rodada, para quem torcer para o seu time se dar bem, e os rivais para secar.
// As contas (quanto cada resultado muda as chances do time) vêm de secador() em sim.js; aqui ficam os
// rivais, as regras de leitura e as frases, iguais nas duas versões do app.
import { dele, doo, o, pelo } from './util.js';

// ---------- rivais ----------

// Clubes por estado. Os da primeira lista são os grandes, rivais entre si de fábrica (os 4 do Rio,
// os 4 de São Paulo, Atlético e Cruzeiro, o Gre-Nal...). Os outros só viram rivais se o torcedor quiser.
const STATES = {
  RJ: [['flamengo', 'fluminense', 'vasco', 'botafogo'], ['volta redonda', 'nova iguacu', 'madureira', 'bangu']],
  SP: [['palmeiras', 'corinthians', 'sao paulo', 'santos'], ['bragantino', 'mirassol', 'ponte preta', 'guarani', 'novorizontino', 'ituano', 'botafogo sp', 'ferroviaria', 'portuguesa', 'sao bernardo', 'santo andre', 'agua santa']],
  MG: [['atletico mg', 'cruzeiro', 'america mg'], ['athletic club', 'tombense', 'ipatinga', 'uberlandia']],
  RS: [['gremio', 'internacional'], ['juventude', 'caxias', 'ypiranga', 'sao jose', 'brasil de pelotas']],
  PR: [['athletico pr', 'coritiba', 'parana'], ['operario pr', 'londrina', 'cascavel', 'maringa']],
  SC: [['avai', 'figueirense', 'chapecoense', 'criciuma', 'joinville'], ['brusque']],
  BA: [['bahia', 'vitoria'], ['jacuipense', 'juazeirense']],
  PE: [['sport', 'nautico', 'santa cruz'], ['retro']],
  CE: [['ceara', 'fortaleza'], ['ferroviario', 'floresta']],
  GO: [['goias', 'vila nova', 'atletico go'], ['aparecidense']],
  PA: [['remo', 'paysandu'], []],
  AL: [['crb', 'csa'], []],
  RN: [['abc', 'america rn'], []],
  MA: [['sampaio correa', 'moto club'], []],
  PB: [['botafogo pb', 'treze', 'campinense'], []],
  MT: [[], ['cuiaba']],
  AM: [[], ['amazonas']],
};
// Nomes que a ESPN escreve de outro jeito.
const ALIAS = {
  'vasco da gama': 'vasco', 'red bull bragantino': 'bragantino', 'rb bragantino': 'bragantino',
  'atletico mineiro': 'atletico mg', 'athletico paranaense': 'athletico pr', 'atletico paranaense': 'athletico pr', 'atletico pr': 'athletico pr',
  'america mineiro': 'america mg', 'atletico goianiense': 'atletico go', 'sport recife': 'sport', operario: 'operario pr',
  'botafogo rj': 'botafogo', 'sao jose rs': 'sao jose',
};
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const PLACE = new Map();
for (const [uf, [big, other]] of Object.entries(STATES)) {
  for (const k of big) PLACE.set(k, { uf, big: true });
  for (const k of other) PLACE.set(k, { uf, big: false });
}
const placeOf = (team) => {
  const k = norm(team?.name);
  return PLACE.get(ALIAS[k] || k) || null;
};

/** Times do campeonato que são do mesmo estado (os grandes primeiro). */
export function sameState(team, teams) {
  const p = placeOf(team);
  if (!p) return [];
  return teams
    .filter((t) => t.id !== team.id && placeOf(t)?.uf === p.uf)
    .sort((a, b) => placeOf(b).big - placeOf(a).big || a.name.localeCompare(b.name, 'pt-BR'));
}

/** Rivais de fábrica: os outros grandes do mesmo estado (só para quem também é grande). */
export function defaultRivals(team, teams) {
  if (!placeOf(team)?.big) return [];
  return sameState(team, teams).filter((t) => placeOf(t).big).map((t) => t.id);
}

/** Rivais do time: os que o torcedor escolheu (saved: {idDoTime: [ids]}) ou os de fábrica. */
export function rivalsOf(team, teams, saved) {
  const ids = new Set(teams.map((t) => t.id));
  const own = saved?.[team.id];
  return new Set((Array.isArray(own) ? own : defaultRivals(team, teams)).filter((id) => ids.has(id) && id !== team.id));
}

// ---------- objetivo ----------

/**
 * O que ainda está em jogo para o time, do mais importante para o menos. Chance pequena também conta:
 * quem está no meio da tabela com 3% de risco de cair ainda olha para baixo.
 * base: {title, g, z} do time (z = risco de cair). Devolve 'title', 'g', 'z' ou null (nada em jogo).
 */
export function objectiveFor(base, zones) {
  if (!base) return null;
  const { title, g, z } = base;
  const hasG = !!zones?.g;
  const hasZ = !!zones?.zStart;
  if (title >= 0.05 && title < 0.995) return 'title';
  if (hasZ && z >= 0.1 && z < 0.995) return 'z';
  if (hasG && g >= 0.03 && g <= 0.97) return 'g';
  if (hasZ && z >= 0.01 && z < 0.995) return 'z';
  if (hasG && g >= 0.01 && g <= 0.99) return 'g';
  if (title >= 0.01 && title < 0.995) return 'title';
  return null;
}

// ---------- cada jogo ----------

// Mesmo formato das chances no resto do app.
export function pct(p) {
  if (p <= 0) return '0%';
  if (p < 0.005) return '<1%';
  if (p >= 1) return '100%';
  if (p > 0.995) return '>99%';
  return `${Math.round(p * 100)}%`;
}

const RESULT = [1, 0, -1]; // posição nas listas de chances: vitória do mandante, empate, vitória do visitante
const PLAIN = ['help', 'draw', 'nodraw'];
const cap = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// No sentido bom: chance de título e de G sobem, risco de cair desce.
const goodOf = (objective, values) => (objective === 'z' ? values.map((p) => 1 - p) : values);
// Lado raro da chance: 3% de risco de cair e 97% de G6 são "pequenos" do mesmo jeito.
const rareOf = (list) => Math.max(...list.map((p) => Math.min(p, 1 - p)));

// Risco pequeno com uma casa decimal ("3,6%"), como nas comparações das linhas.
const fine = (p) => (p >= 0.005 && p < 0.1 ? `${(p * 100).toFixed(1).replace('.', ',')}%` : pct(p));

// Dois números para comparar: inteiros, ou com uma casa decimal quando arredondados ficariam iguais
// (risco de 3,6% contra 4,1%, que viraria "4% contra 4%").
function pctPair(a, b) {
  if (pct(a) !== pct(b) || a >= 0.995 || b >= 0.995) return [pct(a), pct(b)];
  const fine = (p) => `${(p * 100).toFixed(1).replace('.', ',')}%`;
  return [fine(a), fine(b)];
}

/**
 * O resultado do jogo muda as chances do time de verdade? 2 pontos percentuais ou mais entre o melhor e o
 * pior resultado. Com chance pequena vale menos: no título e no G, um quarto dela (se for de 5% ou mais); no risco de cair,
 * que o torcedor acompanha mesmo pequeno, um oitavo (com 3,6% de risco, meio ponto: um jogo entre dois
 * concorrentes diretos já muda isso; um jogo sem ninguém da briga, não). Abaixo de 0,3 ponto é
 * oscilação do sorteio.
 */
function weighs(good, shown, objective) {
  const hi = Math.max(...good);
  const lo = Math.min(...good);
  const diff = hi - lo;
  const rare = rareOf(good);
  // Título ou G quase impossível (menos de 5%) não vale secada por décimos.
  const share = objective === 'z' ? 0.12 : rare >= 0.05 ? 0.25 : Infinity;
  if (!(diff >= 0.02 || (diff >= 0.003 && diff >= share * rare))) return false;
  const [a, b] = pctPair(shown[good.indexOf(hi)], shown[good.indexOf(lo)]);
  return a !== b;
}

// Torcer pelo rival só com ganho de verdade: 3 pontos ou mais (um terço da chance, se ela é pequena).
const worthIt = (diff, rare) => diff >= 0.03 || (diff >= 0.01 && diff >= 0.3 * rare);

/**
 * Quanto o próprio jogo pesa para um time (um rival): o objetivo dele e a chance com vitória, empate e
 * derrota. res: contas desse time ({base, games}) vindas de secador(). Null se o time não joga ou não
 * tem nada em jogo.
 */
export function stakeOf(res, ev, teamId, zones) {
  if (!res || (ev.home.id !== teamId && ev.away.id !== teamId)) return null;
  const objective = objectiveFor(res.base, zones);
  const g = res.games.find((x) => x.id === ev.id);
  if (!objective || !g) return null;
  const [h, d, a] = g[objective];
  const home = ev.home.id === teamId;
  return { objective, win: home ? h : a, draw: d, lose: home ? a : h };
}

// Faixa em que a briga do rival está aberta de verdade (chance com empate, como retrato de agora):
// título a partir de 10%, G entre 15% e 85%, risco de cair entre 8% e 95%.
const OPEN = { title: [0.1, 0.95], g: [0.15, 0.85], z: [0.08, 0.95] };

/**
 * O jogo dói para o rival? Ele está numa briga aberta e perder muda 4 pontos ou mais. Rival tranquilo,
 * sem nada em jogo ou com a briga praticamente decidida não vale a secada.
 */
export function hurts(s) {
  if (!s) return false;
  const [lo, hi] = OPEN[s.objective];
  return s.draw >= lo && s.draw <= hi && Math.abs(s.win - s.lose) >= 0.04;
}

const outcome = (ev) => (ev.home.score == null || ev.away.score == null ? null : Math.sign(ev.home.score - ev.away.score));

/**
 * O que o torcedor quer num jogo.
 * team: time do torcedor; rivals: Set de ids; objective: 'title' | 'g' | 'z' | null;
 * odds: chances do time do torcedor neste jogo, vindas de secador() ({title, g, z}, cada uma
 * [mandante, empate, visitante]) ou null; stakes: Map idDoRival -> stakeOf() deste jogo.
 * kind:
 *   'mine' (jogo do time; contra rival, é clássico), 'help' (seque um time), 'draw' (torça pelo empate),
 *   'nodraw' (o empate é o pior), 'double' (secar o rival ainda ajuda), 'nose' (nariz tapado: vale
 *   torcer pelo rival), 'pride' (a vitória do rival até ajudaria, mas pouco: seque mesmo assim),
 *   'rival' (o jogo dói para o rival), 'derby' (dois rivais, um deles em apuros: empate), 'none'.
 * best/worst: posição do melhor e do pior resultado em values; swing: diferença entre eles;
 * ok: posições que contam como acerto. Devolve null para jogo adiado.
 */
export function verdict(ev, { team, rivals = new Set(), objective = null, odds = null, stakes = new Map() }) {
  if (ev.status.kind === 'off') return null;
  const hr = rivals.has(ev.home.id);
  const ar = rivals.has(ev.away.id);
  const values = objective && odds?.[objective] ? odds[objective] : null;
  const v = { kind: 'none', values, best: null, worst: null, swing: 0, ok: null, cheer: null, dry: null, stake: null, rival: hr || ar, both: hr && ar, state: null };
  const winner = (i) => (i === 0 ? ev.home : i === 2 ? ev.away : null);
  const other = (t) => (t.id === ev.home.id ? ev.away : ev.home);
  const loses = (t) => (t.id === ev.home.id ? [1, 2] : [0, 1]);
  const hot = (t) => (rivals.has(t.id) && hurts(stakes.get(t.id)) ? stakes.get(t.id) : null);
  if (ev.home.id === team.id || ev.away.id === team.id) {
    v.kind = 'mine';
    v.home = ev.home.id === team.id;
    return v;
  }
  const good = values && goodOf(objective, values);
  if (good && weighs(good, values, objective)) {
    const b = good.indexOf(Math.max(...good));
    const w = good.indexOf(Math.min(...good));
    const mid = 3 - b - w;
    v.best = b;
    v.worst = w;
    v.swing = good[b] - good[w];
    // Resultado do meio quase tão bom quanto o melhor: o que importa é o pior não acontecer.
    const loose = good[mid] - good[w] >= 0.6 * v.swing;
    v.ok = loose ? [b, mid] : [b];
    if (b === 1 && !loose) v.kind = 'draw';
    else if (b === 1) {
      v.kind = 'help';
      v.dry = winner(w);
    } else if (w === 1 && loose) v.kind = 'nodraw';
    else {
      v.kind = 'help';
      v.cheer = winner(b);
      v.dry = winner(2 - b);
    }
    if (v.kind === 'help' && v.cheer && rivals.has(v.cheer.id)) {
      // O melhor é o rival vencer. Só vale com ganho de verdade e maior que o dele na briga dele.
      const s = hot(v.cheer);
      if (worthIt(v.swing, rareOf(good)) && !(s && Math.abs(s.win - s.lose) > v.swing)) v.kind = 'nose';
      else if (v.both) {
        v.kind = 'derby';
        v.ok = [1];
      } else {
        v.kind = 'pride';
        v.stake = s;
        v.dry = v.cheer;
        v.cheer = other(v.dry);
        v.ok = loses(v.dry);
      }
    } else if (v.kind === 'help' && rivals.has(v.dry.id)) v.kind = 'double';
  } else if (v.both && (hot(ev.home) || hot(ev.away))) {
    v.kind = 'derby';
    v.ok = [1];
  } else if (v.rival && !v.both && hot(hr ? ev.home : ev.away)) {
    v.kind = 'rival';
    v.dry = hr ? ev.home : ev.away;
    v.cheer = other(v.dry);
    v.stake = hot(v.dry);
    v.ok = loses(v.dry);
  }
  // Ao vivo e encerrado: o resultado de agora é um dos que o torcedor quer?
  const now = outcome(ev);
  if (v.ok && now != null && (ev.status.kind === 'live' || ev.status.kind === 'post')) {
    v.state = v.ok.includes(RESULT.indexOf(now)) ? 'ok' : 'no';
  }
  return v;
}

/**
 * Quais jogos ganham linha, para a rodada não virar um mar de selos: o do time quando há algo em jogo
 * (ou é clássico), os de rival e, dos que só mexem no objetivo, os 3 que mais pesam.
 * Marca v.shown em cada {ev, v} e devolve a mesma lista.
 */
export function pick(verdicts, max = 3) {
  const plain = verdicts.filter((x) => x.v && PLAIN.includes(x.v.kind)).sort((a, b) => b.v.swing - a.v.swing).slice(0, max);
  for (const x of verdicts) {
    if (!x.v) continue;
    const k = x.v.kind;
    x.v.shown = k === 'mine' ? !!(x.v.values || x.v.rival) : k === 'none' ? false : PLAIN.includes(k) ? plain.includes(x) : true;
  }
  return verdicts;
}

// ---------- frases ----------

const GOAL = { title: () => 'Chance de título', g: (zones) => `Chance de ${zones?.gLabel || 'G6'}`, z: () => 'Risco de cair' };
const YOUR = { title: () => 'a sua chance de título', g: (zones) => `a sua chance de ${zones?.gLabel || 'G6'}`, z: () => 'a sua fuga da queda' };

// Quem está quase rebaixado (risco de 90% ou mais) pensa na chance de escapar, não no risco de cair.
const escaping = (objective, values) => objective === 'z' && values.every((p) => p >= 0.9);

// "Chance de G6: 87% com vitória do Grêmio, 84% com a do Cruzeiro."
function numbers(ev, v, objective, zones) {
  const res = (i, after) => {
    if (i === 1) return 'empate';
    const t = i === 0 ? ev.home : ev.away;
    return after ? `a ${doo(t.name)}` : `vitória ${doo(t.name)}`;
  };
  const both = v.best !== 1 && v.worst !== 1;
  const esc = escaping(objective, v.values);
  const val = (i) => (esc ? 1 - v.values[i] : v.values[i]);
  // Risco (ou chance de escapar) pequeno sempre com uma casa, para todas as linhas da rodada baterem.
  const [best, worst] = objective === 'z' && val(v.best) < 0.1 && val(v.worst) < 0.1 ? [fine(val(v.best)), fine(val(v.worst))] : pctPair(val(v.best), val(v.worst));
  return `${esc ? 'Chance de escapar' : GOAL[objective](zones)}: ${best} com ${res(v.best)}, ${worst} com ${res(v.worst, both)}.`;
}

// O que o rival perde: "Se o Flamengo perder, a chance de título dele cai para 47%."
function rivalLoss(t, s, zones) {
  if (s.objective === 'z') return `Se ${o(t.name)} perder, o risco de cair ${dele(t.name)} sobe para ${pct(s.lose)}.`;
  return `Se ${o(t.name)} perder, a chance de ${s.objective === 'title' ? 'título' : zones?.gLabel || 'G6'} ${dele(t.name)} cai para ${pct(s.lose)}.`;
}

// O que o rival ganharia: "ajudaria o Coritiba a fugir da queda".
function rivalGain(t, s, zones) {
  if (s.objective === 'z') return `ajudaria ${o(t.name)} a fugir da queda`;
  return `deixaria ${o(t.name)} mais perto do ${s.objective === 'title' ? 'título' : zones?.gLabel || 'G6'}`;
}

// "a chance de título dele", "o risco de cair dele": a chance de um time, para as frases do jogo encerrado.
function chanceOf(objective, zones, owner = '') {
  const of = owner ? ` ${owner}` : '';
  if (objective === 'z') return `o risco de cair${of}`;
  return `a chance de ${objective === 'title' ? 'título' : zones?.gLabel || 'G6'}${of}`;
}

/**
 * Selo e frase de um jogo. Devolve {chip, text, state} (state: frase curta de ao vivo ou encerrado).
 * Jogo encerrado não pede torcida: diz o que o resultado fez (a conta, ou onde ficou a chance).
 * objective: objetivo do time do torcedor; zones: zonas da tabela (para o nome do G).
 */
export function verdictText(ev, v, { objective, zones } = {}) {
  if (!v) return null;
  const live = ev.status.kind === 'live';
  const done = ev.status.kind === 'post';
  const state = v.state === 'ok' ? (live ? 'Tá dando certo' : 'Deu certo') : v.state === 'no' ? (live ? 'Por enquanto, não' : 'Não deu') : '';
  const nums = v.best != null ? numbers(ev, v, objective, zones) : '';
  const cheer = v.cheer?.name;
  const dry = v.dry?.name;
  const now = outcome(ev);
  // Resultado de um time no jogo encerrado: 1 vitória, 0 empate, -1 derrota.
  const resultOf = (t) => (now == null ? null : t.id === ev.home.id ? now : -now);
  switch (v.kind) {
    case 'mine': {
      const chip = v.rival ? 'Clássico' : 'Seu jogo';
      if (!v.values) return { chip, text: v.rival ? 'Vale mais que três pontos.' : '', state: '' };
      const esc = escaping(objective, v.values);
      const [h, d, a] = v.values.map((p) => (esc ? 1 - p : p));
      if (done && now != null) {
        const r = v.home ? now : -now;
        const p = [h, d, a][RESULT.indexOf(now)];
        return { chip, text: `Com ${r > 0 ? 'a vitória' : r < 0 ? 'a derrota' : 'o empate'}, ${esc ? 'a chance de escapar' : chanceOf(objective, zones)} ficou em ${objective === 'z' ? fine(p) : pct(p)}.`, state: '' };
      }
      const [win, lose] = v.home ? [h, a] : [a, h];
      const f = objective === 'z' ? fine : pct;
      return { chip, text: `${esc ? 'Chance de escapar' : GOAL[objective](zones)}: ${f(win)} se vencer, ${f(d)} se empatar, ${f(lose)} se perder.`, state: '' };
    }
    case 'help': {
      if (done) return { chip: `Seque ${o(dry)}`, text: nums, state };
      // Sem um vencedor para torcer: o empate é o melhor, mas a vitória do outro quase não faz diferença.
      const other = v.dry.id === ev.home.id ? ev.away : ev.home;
      return { chip: `Seque ${o(dry)}`, text: `${cheer ? `Torça ${pelo(cheer)}.` : `Empate ou vitória ${doo(other.name)} servem.`} ${nums}`, state };
    }
    case 'double':
      return { chip: 'Seca em dobro', text: done ? nums : `Secar ${o(dry)}, seu rival, ainda ajuda o seu time. ${nums}`, state };
    case 'nose':
      if (done) return { chip: 'Nariz tapado', text: `${nums}${v.state === 'ok' ? ` Dessa vez, foi bom ${o(cheer)} vencer.` : ''}`, state };
      return { chip: 'Nariz tapado', text: `Dessa vez, torça ${pelo(cheer)}, seu rival. ${nums}${v.both ? ` Pelo menos ${o(dry)} perde.` : ''} Ninguém precisa saber.`, state };
    case 'pride':
      if (done) {
        return {
          chip: `Seque ${o(dry)}`,
          text: v.state === 'ok' ? `${cap(o(dry))} não venceu: secada cumprida.` : `${cap(o(dry))} venceu. Pelo menos ajudou um pouquinho ${YOUR[objective](zones)}.`,
          state,
        };
      }
      return {
        chip: `Seque ${o(dry)}`,
        text: v.stake
          ? `A vitória ${doo(dry)} até ajudaria ${YOUR[objective](zones)}, mas também ${rivalGain(v.dry, v.stake, zones)}. Seque mesmo.`
          : `A vitória ${doo(dry)} até ajudaria um pouquinho ${YOUR[objective](zones)}, mas tem coisa que não se faz.`,
        state,
      };
    case 'draw':
      // O empate é o melhor quando a vitória de qualquer um dos dois atrapalha: os dois brigam com o seu time.
      if (done) return { chip: 'Torça pelo empate', text: nums, state };
      return { chip: 'Torça pelo empate', text: `Os dois brigam com você. ${nums}${v.both ? ' E os dois rivais perdem pontos.' : v.rival ? ' E o rival ainda perde pontos.' : ''}`, state };
    case 'nodraw':
      return { chip: 'Tem que ter vencedor', text: done ? nums : `Tanto faz quem vença: o empate é o pior para você. ${nums}`, state };
    case 'derby': {
      if (!done) return { chip: 'Clássico dos rivais', text: 'Torça pelo empate: os dois perdem pontos.', state };
      const winner = now > 0 ? ev.home : now < 0 ? ev.away : null;
      return { chip: 'Clássico dos rivais', text: winner ? `${cap(o(winner.name))} venceu; o melhor era o empate.` : 'Empate: os dois rivais perderam pontos.', state };
    }
    case 'rival': {
      if (!done) return { chip: `Seque ${o(dry)}`, text: `Torça ${pelo(cheer)}. ${rivalLoss(v.dry, v.stake, zones)}`, state };
      const r = resultOf(v.dry);
      const p = r > 0 ? v.stake.win : r < 0 ? v.stake.lose : v.stake.draw;
      return { chip: `Seque ${o(dry)}`, text: `${cap(o(dry))} ${r > 0 ? 'venceu' : r < 0 ? 'perdeu' : 'empatou'}: ${chanceOf(v.stake.objective, zones, dele(dry))} ficou em ${pct(p)}.`, state };
    }
    default:
      return { chip: '', text: '', state: '' };
  }
}

/**
 * Cartão do secador: objetivo do time e o resumo da rodada, com o jogo que mais pesa.
 * base: chances do time ({title, g, z}) ou null enquanto calcula; verdicts: [{ev, v}] da rodada, já
 * passados por pick(); rivals: quantos rivais o torcedor tem.
 */
export function secadorSummary({ team, objective, base, verdicts, zones, ready = true, rivals = 0 }) {
  let head;
  let sub = '';
  if (!base) {
    head = team.name;
    sub = ready ? 'Calculando as chances…' : 'As contas aparecem quando a temporada carregar inteira.';
  } else if (objective === 'title') {
    const p = base.title;
    head = p >= 0.9 ? `${team.name} com a mão na taça` : p < 0.15 ? `${team.name} ainda sonha com o título` : `${team.name} na briga pelo título`;
    sub = `${pct(p)} de chance de título hoje`;
  } else if (objective === 'g') {
    const p = base.g;
    const g = zones?.gLabel || 'G6';
    head = p >= 0.9 ? `${team.name} perto de garantir o ${g}` : p < 0.15 ? `${team.name} correndo atrás do ${g}` : `${team.name} na briga pelo ${g}`;
    sub = `${pct(p)} de chance de ${g} hoje`;
  } else if (objective === 'z') {
    const p = base.z;
    head = p >= 0.9 ? `${team.name} precisa de um milagre` : p < 0.1 ? `${team.name} ainda de olho na queda` : `${team.name} contra o rebaixamento`;
    // Com risco pequeno, uma casa decimal, como nas linhas dos jogos ("3,6% com empate").
    sub = p >= 0.9 ? `${fine(1 - p)} de chance de escapar hoje` : `${fine(p)} de risco de cair hoje`;
  } else head = `Nada em jogo para ${o(team.name)} na tabela`;
  const shown = verdicts.filter((x) => x.v?.shown && x.v.kind !== 'mine');
  const obj = shown.filter((x) => [...PLAIN, 'double', 'nose'].includes(x.v.kind)).sort((a, b) => b.v.swing - a.v.swing);
  const riv = shown.filter((x) => ['rival', 'derby', 'pride'].includes(x.v.kind));
  const started = shown.filter((x) => x.v.state);
  const your = objective ? YOUR[objective](zones) : '';
  let text;
  if (started.length) {
    const ok = started.filter((x) => x.v.state === 'ok').length;
    const n = started.length;
    const live = started.some((x) => x.ev.status.kind === 'live');
    const pending = shown.length - n;
    if (!ok) text = live ? 'Nenhuma secada está dando certo por enquanto.' : n === 1 ? 'A secada não deu certo.' : `Nenhuma das ${n} secadas deu certo.`;
    else if (n === 1) text = live ? 'A secada está dando certo.' : 'A secada deu certo.';
    else text = `${ok} de ${n} secadas ${live ? (ok === 1 ? 'está dando certo' : 'estão dando certo') : ok === 1 ? 'deu certo' : 'deram certo'}.`;
    if (pending) text += ` ${pending === 1 ? 'Falta 1 jogo' : `Faltam ${pending} jogos`}.`;
  } else if (obj.length) {
    const top = obj[0];
    const game = `${top.ev.home.name} x ${top.ev.away.name}${top.v.kind === 'nose' ? ', de nariz tapado' : ''}`;
    text = obj.length === 1 ? `Um jogo mexe com ${your}: ${game}.` : `${obj.length} jogos mexem com ${your}. O que mais pesa: ${game}.`;
    if (top.v.kind !== 'nose' && obj.some((x) => x.v.kind === 'nose')) text += ' Um deles é de nariz tapado.';
    if (riv.length) text += ' E tem rival para secar.';
  } else if (riv.length) {
    text = objective ? `Nenhum jogo mexe com ${your}, mas tem rival para secar.` : 'Tem rival em apuros para secar.';
  } else if (objective) text = `Nenhum jogo mexe com ${your}. Dá para ver a rodada de boa.`;
  else text = rivals ? 'Nenhum rival em apuros. Dá para ver a rodada de boa.' : 'Dá para ver a rodada de boa.';
  if (!base) text = '';
  return { head, sub, text };
}
