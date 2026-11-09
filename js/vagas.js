// Vagas na Libertadores pelo Brasileirão. A tabela tem as do regulamento (G5 desde 2026) e ganha mais uma
// para cada clube que já tem vaga por outro caminho e também termina na zona: finalista da Copa do Brasil (os
// dois finalistas vão à Libertadores desde 2026), campeão da Libertadores ou da Sul-Americana. Finalista
// rebaixado também libera a vaga (clube da Série B não joga a Libertadores). Daqui saem, para as simulações
// do Brasileirão (chances, em sim.js), as chances do que cada copa dá de vaga.
import { PROMOTED, expectedGoals, model } from './sim.js';
import { openPhase } from './knockout.js';
import { tiesOf } from './comps.js';

export const VAGAS_CUPS = ['bra.copa_do_brazil', 'conmebol.libertadores', 'conmebol.sudamericana'];
export const CONT = ['conmebol.libertadores', 'conmebol.sudamericana'];
// Estrangeiros (Libertadores, Sul-Americana) começam abaixo da média brasileira: testado de 2018 a 2025.
export const FOREIGN = { att: 0.85, def: 1.15 };

/**
 * Regras do ano: vagas da tabela (base) e quem leva a vaga da Copa do Brasil (finalists: os dois finalistas,
 * desde 2026; antes, só o campeão, e a tabela tinha o G6).
 */
export const rulesFor = (year) => (year >= 2026 ? { base: 5, finalists: true } : { base: 6, finalists: false });

// Gols esperados de um jogo pelo modelo (em campo neutro: a média de jogar em casa e fora). Null sem força.
export const lambdaOf = (m) => (h, a, neutral) => {
  if (!m?.att.has(h) || !m.att.has(a)) return null;
  const [x1, y1] = expectedGoals(m, h, a);
  if (!neutral) return [x1, y1];
  const [y2, x2] = expectedGoals(m, a, h);
  return [Math.sqrt(x1 * x2), Math.sqrt(y1 * y2)];
};

/**
 * Força para a Libertadores e a Sul-Americana: um ajuste conjunto com o Brasileirão e os jogos continentais,
 * os clubes da Série A partindo da temporada anterior (prior) e os estrangeiros de FOREIGN.
 * games: jogos (Brasileirão e continentais); ours: ids dos clubes da Série A.
 */
export function continentalModel(games, ours, prior) {
  const ids = new Set(games.flatMap((e) => [e.home.id, e.away.id]));
  const start = new Map([...ids].map((id) => [id, ours.has(id) ? prior?.get(id) || (prior ? PROMOTED : { att: 1, def: 1 }) : FOREIGN]));
  return model(new Map([...ids].map((id) => [id, { id }])), games, start);
}

// Final já jogada: o campeão e o vice.
function decided(phases) {
  const last = phases.filter((p) => p.knockout).at(-1);
  if (!last || !/^final/.test(last.slug)) return null;
  const ties = tiesOf(last.events);
  if (ties.length !== 1 || !ties[0].done || !ties[0].winner) return null;
  const t = ties[0];
  return { champion: t.winner, runner: t.winner === t.a.id ? t.b.id : t.a.id };
}

/**
 * O que a copa dá de vaga na Libertadores, com a chance de cada caso: [{ids, p}], ids com os clubes que levam
 * a vaga por ela (os dois finalistas da Copa do Brasil, ou só o campeão; o campeão da Libertadores ou da
 * Sul-Americana, se for da Série A). phases: phasesOf da copa; odds: knockoutOdds dela (ou null).
 * Null quando ainda não dá para saber (mata-mata sem confrontos definidos, ou sem as chances).
 */
export function cupSlots({ slug, phases, odds, ours, finalists }) {
  const cdb = slug === 'bra.copa_do_brazil';
  const d = decided(phases);
  if (d) return [{ ids: cdb ? (finalists ? [d.champion, d.runner] : [d.champion]) : ours.has(d.champion) ? [d.champion] : [], p: 1 }];
  // Sem clube da Série A vivo no mata-mata da Libertadores ou da Sul-Americana, ela não mexe na tabela.
  const open = openPhase(phases);
  if (!cdb && open && !open.ties.some((t) => (t.done ? [t.winner] : [t.a.id, t.b.id]).some((id) => ours.has(id)))) return [{ ids: [], p: 1 }];
  if (!odds) return null;
  if (cdb && finalists) return [...odds.finals].map(([k, p]) => ({ ids: k.split('|'), p }));
  const out = [];
  let none = 0;
  for (const [id, v] of odds.byTeam) {
    if (!v.title) continue;
    if (cdb || ours.has(id)) out.push({ ids: [id], p: v.title });
    else none += v.title;
  }
  if (none) out.push({ ids: [], p: none });
  return out;
}

/**
 * Entrada das vagas para as chances do Brasileirão: {base, finalists, cups: [[{ids, p}], ...]}, ou null se
 * alguma das três copas ainda não dá para saber. cups: {slug: {phases, odds}}; ours: ids da Série A.
 */
export function vagasInput({ year, cups, ours }) {
  const rules = rulesFor(year);
  const list = [];
  for (const slug of VAGAS_CUPS) {
    const c = cups[slug];
    if (!c?.phases?.length) return null;
    const s = cupSlots({ slug, phases: c.phases, odds: c.odds, ours, finalists: rules.finalists });
    if (!s) return null;
    list.push(s);
  }
  return { ...rules, cups: list };
}
