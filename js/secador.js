// Secador: em cada jogo da rodada, para quem torcer para o seu time se dar bem, e os rivais para secar.
// As contas (quanto cada resultado muda as chances do time) vêm de secador() em sim.js; aqui ficam os
// rivais, as regras de leitura e as frases, iguais nas duas versões do app.
import { doo, o, pelo } from './util.js';

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

/**
 * O resultado do jogo muda as chances do time de verdade? Diferença de 1,5 ponto percentual ou mais;
 * quando a chance é pequena (risco de 3% de cair), basta mudar um quarto dela. E os números
 * mostrados precisam ser diferentes.
 */
function weighs(good, shown) {
  const hi = Math.max(...good);
  const lo = Math.min(...good);
  const diff = hi - lo;
  const rare = Math.max(...good.map((p) => Math.min(p, 1 - p)));
  if (!(diff >= 0.015 || (diff >= 0.005 && diff >= 0.25 * rare))) return false;
  return pct(shown[good.indexOf(hi)]) !== pct(shown[good.indexOf(lo)]);
}

const outcome = (ev) => (ev.home.score == null || ev.away.score == null ? null : Math.sign(ev.home.score - ev.away.score));

/**
 * O que o torcedor quer num jogo.
 * team: time do torcedor; rivals: Set de ids; objective: 'title' | 'g' | 'z' | null;
 * odds: chances do jogo vindas de secador() ({title, g, z}, cada uma [mandante, empate, visitante]) ou null.
 * kind: 'mine' (jogo do time), 'help' (seque um time), 'draw' (torça pelo empate), 'nodraw' (o empate é o
 * pior), 'double' (secar o rival ainda ajuda), 'nose' (nariz tapado: o melhor é o rival vencer),
 * 'rival' (só pela rivalidade), 'derby' (dois rivais: empate), 'none' (tanto faz).
 * best/worst: posição do melhor e do pior resultado em values; ok: posições que contam como acerto.
 * Devolve null para jogo adiado.
 */
export function verdict(ev, { team, rivals = new Set(), objective = null, odds = null }) {
  if (ev.status.kind === 'off') return null;
  const hr = rivals.has(ev.home.id);
  const ar = rivals.has(ev.away.id);
  const values = objective && odds?.[objective] ? odds[objective] : null;
  const v = { kind: 'none', values, best: null, worst: null, ok: null, cheer: null, dry: null, small: false, rival: hr || ar, both: hr && ar, state: null };
  const winner = (i) => (i === 0 ? ev.home : i === 2 ? ev.away : null);
  if (ev.home.id === team.id || ev.away.id === team.id) {
    v.kind = 'mine';
    v.home = ev.home.id === team.id;
    return v;
  }
  const good = values && (objective === 'z' ? values.map((p) => 1 - p) : values);
  if (good && weighs(good, values)) {
    const b = good.indexOf(Math.max(...good));
    const w = good.indexOf(Math.min(...good));
    const mid = 3 - b - w;
    v.best = b;
    v.worst = w;
    // Resultado do meio quase tão bom quanto o melhor: o que importa é o pior não acontecer.
    const loose = good[mid] - good[w] >= 0.6 * (good[b] - good[w]);
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
      v.kind = 'nose';
      v.small = good[b] - good[w] < 0.03;
    } else if (v.kind === 'help' && rivals.has(v.dry.id)) v.kind = 'double';
  } else if (v.both) {
    v.kind = 'derby';
    v.ok = [1];
  } else if (v.rival) {
    v.kind = 'rival';
    v.dry = hr ? ev.home : ev.away;
    v.cheer = hr ? ev.away : ev.home;
    v.ok = hr ? [1, 2] : [0, 1];
  }
  // Ao vivo e encerrado: o resultado de agora é um dos que o torcedor quer?
  const now = outcome(ev);
  if (v.ok && now != null && (ev.status.kind === 'live' || ev.status.kind === 'post')) {
    v.state = v.ok.includes(RESULT.indexOf(now)) ? 'ok' : 'no';
  }
  return v;
}

// ---------- frases ----------

const GOAL = { title: () => 'Chance de título', g: (zones) => `Chance de ${zones?.gLabel || 'G6'}`, z: () => 'Risco de cair' };

// "Chance de G6: 87% com vitória do Grêmio, 84% com a do Cruzeiro."
function numbers(ev, v, objective, zones) {
  const res = (i, after) => {
    if (i === 1) return 'empate';
    const t = i === 0 ? ev.home : ev.away;
    return after ? `a ${doo(t.name)}` : `vitória ${doo(t.name)}`;
  };
  const both = v.best !== 1 && v.worst !== 1;
  return `${GOAL[objective](zones)}: ${pct(v.values[v.best])} com ${res(v.best)}, ${pct(v.values[v.worst])} com ${res(v.worst, both)}.`;
}

/**
 * Selo e frase de um jogo. Devolve {chip, text, state} (state: frase curta de ao vivo ou encerrado).
 * Jogo encerrado fica só com a conta e se deu certo, sem pedir torcida.
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
  switch (v.kind) {
    case 'mine': {
      if (!v.values) return { chip: 'Seu jogo', text: v.rival ? 'Clássico contra o rival.' : '', state: '' };
      const [h, d, a] = v.values;
      const [win, lose] = v.home ? [h, a] : [a, h];
      return { chip: 'Seu jogo', text: `${GOAL[objective](zones)}: ${pct(win)} se vencer, ${pct(d)} se empatar, ${pct(lose)} se perder.`, state: '' };
    }
    case 'help':
      return { chip: `Seque ${o(dry)}`, text: done || !cheer ? nums : `Torça ${pelo(cheer)}. ${nums}`, state };
    case 'double':
      return { chip: 'Seca em dobro', text: done ? nums : `Secar ${o(dry)}, seu rival, ainda ajuda o seu time. ${nums}`, state };
    case 'nose':
      if (done) return { chip: 'Nariz tapado', text: `${nums}${v.state === 'ok' ? ` Dessa vez, foi bom ${o(cheer)} vencer.` : ''}`, state };
      return v.small
        ? { chip: 'Nariz tapado', text: `Uma vitória ${doo(cheer)}, seu rival, ajuda um pouco. ${nums} Se quiser secar mesmo assim, ninguém vai te julgar.`, state }
        : { chip: 'Nariz tapado', text: `Dessa vez, torça ${pelo(cheer)}, seu rival. ${nums}${v.both ? ` Pelo menos ${o(dry)} perde.` : ''} Ninguém precisa saber.`, state };
    case 'draw':
      return { chip: 'Torça pelo empate', text: `${nums}${done ? '' : v.both ? ' E os dois rivais perdem pontos.' : v.rival ? ' E o rival ainda perde pontos.' : ''}`, state };
    case 'nodraw':
      return { chip: 'Tem que ter vencedor', text: done ? nums : `Tanto faz quem vença: o empate é o pior para você. ${nums}`, state };
    case 'derby':
      return { chip: 'Clássico dos rivais', text: done ? 'O melhor era o empate: os dois perdendo pontos.' : 'Torça pelo empate: os dois perdem pontos.', state };
    case 'rival':
      return { chip: `Seque ${o(dry)}`, text: done ? 'Só pela rivalidade.' : `Torça ${pelo(cheer)}, só pela rivalidade.`, state };
    default:
      return { chip: '', text: 'Tanto faz pra você', state: '' };
  }
}

/**
 * Cartão do secador: objetivo do time e o resumo da rodada.
 * base: chances do time ({title, g, z}) ou null enquanto calcula; verdicts: [{ev, v}] da rodada.
 */
export function secadorSummary({ team, objective, base, verdicts, zones, ready = true }) {
  let head;
  let sub = '';
  if (!base) {
    head = team.name;
    sub = ready ? 'Calculando as chances…' : 'As contas aparecem quando a temporada carregar inteira.';
  } else if (objective === 'title') {
    head = `${team.name} na briga pelo título`;
    sub = `${pct(base.title)} de chance hoje`;
  } else if (objective === 'g') {
    head = `${team.name} na briga pelo ${zones?.gLabel || 'G6'}`;
    sub = `${pct(base.g)} de chance hoje`;
  } else if (objective === 'z') {
    head = `${team.name} contra o rebaixamento`;
    sub = `${pct(base.z)} de risco de cair hoje`;
  } else {
    head = `Nada em jogo para ${o(team.name)} na tabela`;
    sub = 'Sobra a rivalidade';
  }
  const list = verdicts.filter((x) => x.v && x.v.kind !== 'mine' && x.v.kind !== 'none');
  const count = (kinds) => list.filter((x) => kinds.includes(x.v.kind)).length;
  const matter = count(['help', 'draw', 'double', 'nose', 'nodraw']);
  const nose = count(['nose']);
  const rival = count(['rival', 'derby']);
  const started = list.filter((x) => x.v.state);
  let text;
  if (started.length) {
    const ok = started.filter((x) => x.v.state === 'ok').length;
    const live = started.some((x) => x.ev.status.kind === 'live');
    const verb = live ? (ok === 1 ? 'está dando certo' : 'estão dando certo') : ok === 1 ? 'deu certo' : 'deram certo';
    const pending = list.length - started.length;
    text = `${ok} de ${started.length} ${started.length === 1 ? 'secada' : 'secadas'} ${verb}.${pending ? ` ${pending === 1 ? 'Falta 1 jogo' : `Faltam ${pending} jogos`}.` : ''}`;
  } else if (matter) {
    text = `${matter === 1 ? '1 jogo importa' : `${matter} jogos importam`} pra você nesta rodada.`;
    if (nose) text += nose === 1 ? (matter === 1 ? ' E é de nariz tapado.' : ' Um deles é de nariz tapado.') : ` ${nose} são de nariz tapado.`;
    if (rival) text += ' E tem rival para secar.';
  } else if (rival) {
    text = base && objective ? 'Nenhum outro jogo mexe com as chances do seu time, mas tem rival para secar.' : 'Tem rival para secar nesta rodada.';
  } else {
    text = base && objective ? 'Nenhum outro jogo mexe com as chances do seu time nesta rodada.' : 'Nenhum rival joga nesta rodada.';
  }
  if (!base && !rival) text = '';
  return { head, sub, text };
}
