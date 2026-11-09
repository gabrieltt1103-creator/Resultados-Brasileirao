// Competições do app de todos os campeonatos: a lista, os nomes das fases e os confrontos de mata-mata.

/**
 * Competições dos clubes da Série A que a ESPN cobre. kind: 'liga' (o Brasileirão, com tudo o que o app
 * já fazia), 'copa' (mata-mata), 'continental' (grupos e mata-mata), 'estadual' ou 'unico' (um jogo ou dois).
 * full: clubes do Rio e de São Paulo têm todos os recursos (estaduais completos só no Paulista e no Carioca).
 */
export const COMPS = [
  { slug: 'bra.1', key: 'brasileirao', name: 'Brasileirão', kind: 'liga' },
  { slug: 'bra.copa_do_brazil', key: 'copa-do-brasil', name: 'Copa do Brasil', kind: 'copa', finalSingle: true },
  { slug: 'conmebol.libertadores', key: 'libertadores', name: 'Libertadores', kind: 'continental', finalSingle: true },
  { slug: 'conmebol.sudamericana', key: 'sul-americana', name: 'Sul-Americana', kind: 'continental', finalSingle: true },
  { slug: 'bra.camp.paulista', key: 'paulista', name: 'Paulista', kind: 'estadual', full: true },
  { slug: 'bra.camp.carioca', key: 'carioca', name: 'Carioca', kind: 'estadual', full: true },
  { slug: 'bra.camp.mineiro', key: 'mineiro', name: 'Mineiro', kind: 'estadual' },
  { slug: 'bra.camp.gaucho', key: 'gaucho', name: 'Gaúcho', kind: 'estadual' },
  { slug: 'bra.supercopa_do_brazil', key: 'supercopa', name: 'Supercopa do Brasil', kind: 'unico' },
  { slug: 'conmebol.recopa', key: 'recopa', name: 'Recopa', kind: 'unico' },
  { slug: 'fifa.intercontinental_cup', key: 'intercontinental', name: 'Intercontinental', kind: 'unico' },
];
export const CUPS = COMPS.filter((c) => c.slug !== 'bra.1');
export const compOf = (slug) => COMPS.find((c) => c.slug === slug) || null;
export const compByKey = (key) => COMPS.find((c) => c.key === key) || null;

// Nomes das fases pelo identificador da ESPN.
const PHASES = {
  'first-round': '1ª fase', 'second-round': '2ª fase', 'third-round': '3ª fase', 'fourth-round': '4ª fase', 'fifth-round': '5ª fase',
  'first-stage': '1ª fase', 'second-stage': '2ª fase', 'third-stage': '3ª fase',
  'group-stage': 'Fase de grupos', 'league-phase': 'Fase de liga', 'regular-season': 'Primeira fase',
  'knockout-round-playoffs': 'Playoffs', 'round-of-16': 'Oitavas de final', quarterfinals: 'Quartas de final',
  semifinals: 'Semifinal', final: 'Final', finals: 'Final',
  'taca-guanabara': 'Taça Guanabara', 'relegation-stage': 'Rebaixamento', 'gaucho---relegation': 'Rebaixamento',
  'temporada-regular': 'Primeira fase', 'carioca-championship---semifinals': 'Semifinal', 'carioca-championship---final': 'Final',
};
const WORDS = {
  'taca-guanabara': 'Taça Guanabara', 'taca-rio': 'Taça Rio', 'trofeu-inconfidencia': 'Troféu Inconfidência', playoffs: 'Mata-mata',
  farroupilha: 'Farroupilha', quarterfinals: 'quartas', semifinals: 'semifinal', finals: 'final', final: 'final',
  'carioca-championship': 'Final do Carioca', 'temporada-regular': 'Primeira fase',
};

/** "taca-rio---semifinals" -> "Taça Rio · semifinal"; jogo único (Supercopa, Recopa) -> "Final". */
export function phaseLabel(slug, comp = null) {
  if (PHASES[slug]) return PHASES[slug];
  if (comp?.kind === 'unico' || /^\d{4}-/.test(slug || '')) return 'Final';
  const parts = String(slug || '').split('---').map((p) => WORDS[p] || p.replace(/-/g, ' '));
  const text = parts.join(' · ');
  return text ? text[0].toUpperCase() + text.slice(1) : 'Jogos';
}

// Mata-mata: fase de confrontos (ida e volta ou jogo único). Grupos e pontos corridos não.
const KNOCKOUT = /round-of-16|quarterfinals|semifinals|final|playoffs|first-round|second-round|third-round|fourth-round|fifth-round|first-stage|second-stage|third-stage/;
export const isKnockout = (slug, comp = null) => comp?.kind === 'unico' || (KNOCKOUT.test(slug || '') && !/regular|league|group|relegation|taca-guanabara$/.test(slug || '') && !(comp?.kind === 'estadual' && /^(first|second)-round$/.test(slug || '')));

/** Fases em ordem de data: [{slug, label, events, first, last, knockout}]. */
export function phasesOf(events, comp = null) {
  const by = new Map();
  for (const e of events) {
    const k = e.phase || '';
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(e);
  }
  return [...by.entries()].map(([slug, list]) => {
    list.sort((a, b) => a.date - b.date);
    return { slug, label: phaseLabel(slug, comp), events: list, first: list[0].date, last: list[list.length - 1].date, knockout: isKnockout(slug, comp) };
  }).sort((a, b) => a.first - b.first);
}

/**
 * Fase a mostrar ao abrir: a do jogo ao vivo; senão a do jogo encerrado nas últimas 36 horas; senão a do
 * próximo jogo; senão a última.
 */
export function pickPhase(phases, now = Date.now()) {
  if (!phases.length) return -1;
  const has = (f) => phases.findIndex((p) => p.events.some(f));
  const live = has((e) => e.status.kind === 'live');
  if (live >= 0) return live;
  let recent = -1;
  let recentT = -Infinity;
  phases.forEach((p, i) => p.events.forEach((e) => {
    if (e.status.kind === 'post' && now - e.date < 36 * 36e5 && +e.date > recentT) { recent = i; recentT = +e.date; }
  }));
  if (recent >= 0) return recent;
  let next = -1;
  let nextT = Infinity;
  phases.forEach((p, i) => p.events.forEach((e) => {
    if (e.status.kind === 'pre' && +e.date > now && +e.date < nextT) { next = i; nextT = +e.date; }
  }));
  return next >= 0 ? next : phases.length - 1;
}

const pairKey = (e) => [e.home.id, e.away.id].sort().join('|');

/**
 * Confrontos de uma fase de mata-mata: os jogos de ida e volta juntos. [{key, legs, a, b, agg, pens, winner,
 * done, tbd}]: a e b são os times (a = mandante da ida), agg = gols de cada um somados, pens = pênaltis do
 * último jogo, winner = id de quem passou (pela ESPN ou pelo placar), done = confronto decidido.
 */
export function tiesOf(events) {
  const by = new Map();
  for (const e of [...events].sort((x, y) => x.date - y.date)) {
    const k = pairKey(e);
    if (!by.has(k)) by.set(k, []);
    by.get(k).push(e);
  }
  return [...by.entries()].map(([key, legs]) => {
    const first = legs[0];
    const a = first.home;
    const b = first.away;
    const agg = { [a.id]: 0, [b.id]: 0 };
    let played = 0;
    for (const e of legs) {
      if (e.status.kind !== 'post' && e.status.kind !== 'live') continue;
      played++;
      agg[e.home.id] += e.home.score ?? 0;
      agg[e.away.id] += e.away.score ?? 0;
    }
    const last = legs[legs.length - 1];
    const pens = last.home.pens != null && last.away.pens != null ? { [last.home.id]: last.home.pens, [last.away.id]: last.away.pens } : null;
    const lastDone = last.status.kind === 'post';
    const allDone = legs.every((e) => e.status.kind === 'post');
    let winner = last.series?.done ? last.series.winner : null;
    if (!winner && allDone && (legs.length > 1 || !last.leg)) {
      if (agg[a.id] !== agg[b.id]) winner = agg[a.id] > agg[b.id] ? a.id : b.id;
      else if (pens) winner = pens[a.id] > pens[b.id] ? a.id : b.id;
    }
    // Ida jogada e volta ainda por vir: o confronto segue aberto.
    const expected = legs.some((e) => e.leg === 2) || legs.length > 1 ? legs.length : (first.leg === 1 ? 2 : 1);
    return {
      key, legs, a, b, agg, pens, played, winner,
      done: !!winner && lastDone,
      legsTotal: expected,
      tbd: !!(a.tbd || b.tbd),
    };
  });
}

/**
 * Formato dos estaduais, ano a ano (lido nos jogos e na tabela da ESPN; cada ano precisa ser conferido).
 * first: a primeira fase (identificador da ESPN, times, grupos, quantos caem ou o quadrangular do rebaixamento);
 * bracket: as fases do mata-mata, com o cruzamento da primeira (posição na fase, "A1" = 1º do grupo A) e das
 * seguintes ('adjacent': chave fixa; 'reseed': melhor campanha contra a pior). O mais bem colocado joga em casa
 * (no jogo único) ou decide em casa (ida e volta); a final do Carioca de 2026 foi em campo neutro.
 */
const PAULISTA_GRUPOS = {
  first: { slug: 'temporada-regular', teams: 16, groups: 4, relegate: 2 },
  bracket: [
    { slug: 'quarterfinals', legs: 1, pairs: [['A1', 'A2'], ['B1', 'B2'], ['C1', 'C2'], ['D1', 'D2']] },
    { slug: 'semifinals', legs: 1, pairing: 'reseed' },
    { slug: 'finals', legs: 2 },
  ],
};
const CARIOCA_TABELA = {
  first: { slug: 'taca-guanabara', teams: 12, relegate: 1 },
  bracket: [
    { slug: 'carioca-championship---semifinals', legs: 2, pairs: [[1, 4], [2, 3]] },
    { slug: 'carioca-championship---final', legs: 2 },
  ],
};
export const FORMATS = {
  'bra.camp.paulista': {
    2020: PAULISTA_GRUPOS, 2021: PAULISTA_GRUPOS, 2022: PAULISTA_GRUPOS, 2023: PAULISTA_GRUPOS, 2024: PAULISTA_GRUPOS, 2025: PAULISTA_GRUPOS,
    2026: {
      first: { slug: 'league-phase', teams: 16, relegate: 2 },
      bracket: [
        { slug: 'quarterfinals', legs: 1, pairs: [[1, 8], [4, 5], [2, 7], [3, 6]] },
        { slug: 'semifinals', legs: 1, pairing: 'adjacent' },
        { slug: 'finals', legs: 2 },
      ],
    },
  },
  'bra.camp.carioca': {
    2022: CARIOCA_TABELA, 2023: CARIOCA_TABELA, 2024: CARIOCA_TABELA, 2025: CARIOCA_TABELA,
    2026: {
      first: { slug: 'taca-guanabara', teams: 12, groups: 2, relegationStage: { slug: 'relegation-stage', seeds: ['A5', 'A6', 'B5', 'B6'], relegate: 1 } },
      bracket: [
        { slug: 'taca-guanabara---quarterfinals', legs: 1, pairs: [['A1', 'A4'], ['A2', 'A3'], ['B1', 'B4'], ['B2', 'B3']] },
        { slug: 'taca-guanabara---semifinals', legs: 2, pairing: 'adjacent' },
        { slug: 'taca-guanabara---final', legs: 1, neutral: true },
      ],
    },
  },
};

/**
 * Formatos a tentar num ano: o do próprio ano e, se ainda não foi conferido, os anteriores (do mais novo para
 * o mais velho). Quem usa confere se os jogos batem com o formato (formatFits) antes de calcular.
 */
export function formatsFor(slug, year) {
  const all = FORMATS[slug];
  if (!all) return [];
  if (all[year]) return [{ year, format: all[year] }];
  return Object.keys(all).map(Number).filter((y) => y < year).sort((a, b) => b - a).map((y) => ({ year: y, format: all[y] }));
}

// Ponto de partida da força de quem não é da Série A, por estadual (testado de 2017 a 2026).
export const SMALL = { 'bra.camp.paulista': { att: 0.7, def: 1.35 }, 'bra.camp.carioca': { att: 0.6, def: 1.5 } };

/**
 * Sem o registro antigo de jogo remarcado: a ESPN às vezes mantém, "a jogar" e com a data antiga, o mesmo
 * jogo (mesma fase, mesmo mandante e visitante) que depois foi jogado em outra data.
 */
export function dropStale(events, now = Date.now()) {
  const played = new Set(events.filter((e) => e.status.kind === 'post' || e.status.kind === 'live').map((e) => `${e.phase}|${e.home.id}|${e.away.id}`));
  return events.filter((e) => !(e.status.kind === 'pre' && now - e.date > 6 * 36e5 && played.has(`${e.phase}|${e.home.id}|${e.away.id}`)));
}

/** Times de um jogo que são clubes da Série A (ids). */
export const involves = (e, ids) => ids.has(e.home.id) || ids.has(e.away.id);
