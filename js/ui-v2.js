// Aparência v2 ("Arquibancada"): a mesma informação da versão atual, com leitura mais leve.
// A cor dos clubes fica num fio embaixo de cada time, cada bloco termina com uma frase que diz o que
// o número mostra e o que só se consulta de vez em quando fica recolhido. O que não muda (detalhe do
// time, escolha do time, status dos dados, texto para compartilhar) vem direto de ui.js.
export * from './ui.js';
import { crest, flowChart, formDots, miniTable, pct, readingList, scorers, secadorLine } from './ui.js';
import { bucketLabels, goalTimeNote, h2hSummary, homeAwayNote, storyTags, tableLine } from './insights.js';
import { decimal, dm, doo, esc, fmtTime, kickoff, o, plural, weekdayShort } from './util.js';

const ord = (n) => (n ? `${n}º` : '');
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
const pelo = (name) => o(name).replace(/^o /, 'pelo ').replace(/^a /, 'pela ');
const STAR = '<svg class="star" viewBox="0 0 24 24" width="13" height="13" aria-label="Meu time"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="currentColor"/></svg>';
const CHEVRON = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const CLOSE = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round"/></svg>';

// Cor da camisa de cada clube da Série A (id da ESPN); a ESPN às vezes traz cores trocadas.
// Clubes de camisa preta usam a cor do texto, que funciona no tema claro e no escuro.
const KIT = {
  819: '#C8102E', 2029: '#00613C', 3445: '#7A1131', 3458: '#C8102E', 9967: '#0B4EA2', 2022: '#0A3D9B', 7632: 'ink', 2674: 'ink',
  2026: '#D6001C', 3456: '#00553A', 6079: '#E30613', 3457: '#D21F26', 6086: 'ink', 3454: 'ink', 9169: '#F2C200', 874: 'ink',
  1936: '#D7141A', 6273: '#0D80BF', 4936: '#152A5C', 9318: '#00843D',
};
const luminance = (hex) => {
  const n = parseInt(hex.slice(1), 16);
  const [r, g, b] = [n >> 16, (n >> 8) & 255, n & 255].map((v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
function kit(t) {
  const c = KIT[t.id];
  if (c) return c === 'ink' ? 'var(--ink)' : c;
  for (const x of [t.color, t.color2]) {
    if (!x) continue;
    const l = luminance(x);
    if (l < 0.02) return 'var(--ink)';
    if (l < 0.8) return x;
  }
  return 'var(--muted)';
}

const move = (d) => (d ? `<span class="v2-mv ${d > 0 ? 'up' : 'dn'}">${d > 0 ? '▲' : '▼'}${Math.abs(d)}</span>` : '');
const label = (text, side = '') => `<h2 class="v2-label"><span>${text}</span>${side ? `<small>${side}</small>` : ''}</h2>`;
const dots = (form) => `<span class="v2-dots" aria-label="${esc(form.map((g) => g.res).join(' '))}">${form.map((g) => `<i class="${g.res}"></i>`).join('')}</span>`;
const formPts = (form) => form.reduce((s, g) => s + (g.res === 'V' ? 3 : g.res === 'E' ? 1 : 0), 0);

// ---------- Jogos ----------

/** Manchetes como frases curtas puxadas por um número: "90+7'", "4–1", "Z4". */
export function newsCard(items, title) {
  if (!items.length) return '';
  const name = title === 'Resumo da rodada' ? 'O que marcou a rodada' : title;
  return `<section class="v2-sec" aria-label="${esc(name)}">${label(esc(name))}
    <ul class="v2-facts">${items.slice(0, 4).map((n) => {
      const big = n.big || n.tag;
      return `<li class="${n.tone === 'bad' ? 'bad' : ''}${big.length > 6 ? ' long' : ''}"${n.ev ? ` data-match="${esc(n.ev)}" role="button" tabindex="0"` : ''}><b>${esc(big)}</b><span>${esc(n.text)}</span></li>`;
    }).join('')}</ul></section>`;
}

const dayCounts = (events) => {
  const n = (k) => events.filter((e) => e.status.kind === k).length;
  const parts = [];
  if (n('live')) parts.push(`${n('live')} ao vivo`);
  if (n('pre')) parts.push(`${n('pre')} a seguir`);
  if (n('off')) parts.push(n('off') === 1 ? '1 adiado' : `${n('off')} adiados`);
  if (!parts.length) parts.push(n('post') === 1 ? 'encerrado' : 'encerrados');
  return parts.join(' · ');
};

export function daySections(days) {
  return days.map((d) => `<section class="v2-sec">${label(`${esc(d.label)}${d.moved ? ' · jogo remarcado' : ''}`, esc(dayCounts(d.events)))}
    <div class="v2-list">${d.cards.join('')}</div></section>`).join('');
}

export function otherGames(cards) {
  return `<section class="v2-sec">${label('Hoje, de outras rodadas')}<div class="v2-list">${cards.join('')}</div></section>`;
}

// "Se vencer, sobe para 9º", pela tabela com os outros placares do momento.
function ifWins(row, now) {
  if (!row?.pos) return '';
  if (!now || row.pos === now) return `Se vencer, fica em ${row.pos}º`;
  return `Se vencer, ${row.pos < now ? 'sobe' : 'cai'} para ${row.pos}º`;
}

/** Jogo da rodada. ctx: {rank(id), delta(id), favorite, flash, story, note, scenarios(ev), secador} */
export function matchCard(ev, ctx) {
  const s = ev.status;
  const post = s.kind === 'post' && ev.home.score != null && ev.away.score != null;
  const live = s.kind === 'live';
  const flash = ctx.flash;
  const lost = (side) => post && (side === 'home' ? ev.home.score < ev.away.score : ev.away.score < ev.home.score);
  const side = (t, key) => {
    const reds = ev.incidents.filter((i) => i.kind === 'red' && i.team === t.id).length;
    const rank = ctx.rank(t.id);
    return `<div class="v2-side${key === 'away' ? ' r' : ''}${lost(key) ? ' lost' : ''}" style="--kit:${kit(t)}">
      ${crest(t.logo, t.name, 26)}
      <span class="v2-nb">
        <span class="v2-tn"><span class="nm">${esc(t.name)}</span>${t.id === ctx.favorite ? STAR : ''}${'<i class="red-card" title="Cartão vermelho"></i>'.repeat(Math.min(reds, 3))}${flash?.sides.has(key) ? '<b class="v2-gol">Gol</b>' : ''}</span>
        <span class="v2-ps">${rank ? `${rank}º na tabela` : '&nbsp;'}${move(ctx.delta(t.id))}</span>
      </span>
    </div>`;
  };
  const center = s.kind === 'pre' || s.kind === 'off' || ev.home.score == null
    ? `<span class="v2-sc pre">${esc(s.label)}</span>`
    : `<span class="v2-sc${flash ? ' flash' : ''}${flash?.fresh ? ' pop' : ''}">${ev.home.score}–${ev.away.score}</span>`;
  let stakes = '';
  if (live && ctx.scenarios) {
    const sc = ctx.scenarios(ev);
    if (sc) stakes = `<div class="v2-meta"><span>${ifWins(sc.home.home, ctx.rank(ev.home.id))}</span><span></span><span>${ifWins(sc.away.away, ctx.rank(ev.away.id))}</span></div>`;
  }
  const goals = (t) => ev.incidents.filter((i) => i.kind === 'goal' && i.team === t.id);
  const hg = goals(ev.home);
  const ag = goals(ev.away);
  const who = hg.length || ag.length ? `<div class="v2-meta"><span>${esc(scorers(hg))}</span><span></span><span>${esc(scorers(ag))}</span></div>` : '';
  const tags = storyTags(ctx.story || {});
  const foot = ctx.note || (ev.moved ? (post ? 'Jogo remarcado' : 'Remarcado') : '');
  const status = live ? s.note : post ? 'Encerrado' : s.kind === 'pre' ? `Começa às ${s.label}` : s.label;
  const fav = ev.home.id === ctx.favorite || ev.away.id === ctx.favorite;
  return `<article class="v2-game is-${s.kind}${fav ? ' is-fav' : ''}${ctx.secador ? ` sec-${esc(ctx.secador.kind)}` : ''}" data-match="${esc(ev.id)}" tabindex="0" role="button"
    aria-label="${esc(`${ev.home.name} ${ev.home.score ?? ''} x ${ev.away.score ?? ''} ${ev.away.name}, ${status}. Toque para ver detalhes.`)}">
    ${live ? `<div class="v2-livehdr"><i></i>${esc(s.half ? 'Intervalo' : `Ao vivo · ${s.label}`)}</div>` : ''}
    <div class="v2-row">${side(ev.home, 'home')}${center}${side(ev.away, 'away')}</div>
    ${stakes}${who}
    ${tags.length || foot || ctx.secador?.quiet ? `<div class="v2-foot">${tags.map((t) => `<b class="v2-chip">${esc(t)}</b>`).join('')}${foot ? `<span>${esc(foot)}</span>` : ''}${ctx.secador?.quiet ? `<span class="sec-quiet">${esc(ctx.secador.quiet)}</span>` : ''}</div>` : ''}
    ${secadorLine(ctx.secador)}
  </article>`;
}

// ---------- Tabela ----------

const ZONE = (name) => (/Pré/.test(name) ? 'pre' : /Libertadores/.test(name) ? 'lib' : /Sul/.test(name) ? 'sul' : /Rebaix/.test(name) ? 'rel' : '');

/** Classificação numa lista só: a zona aparece no quadradinho da posição. */
export function standingsTable({ table, zones, formById, favorite }) {
  const legend = new Map();
  const body = table.rows.map((t) => {
    const zone = zones.byPos[t.pos];
    const z = zone ? ZONE(zone.name) : '';
    if (zone && z && !legend.has(zone.name)) legend.set(zone.name, z);
    const r = t.result;
    const gd = t.gd > 0 ? `+${t.gd}` : t.gd;
    const live = r?.live ? `<span class="v2-live-dot" title="${esc(`${r.gf} x ${r.ga} contra ${r.opp.name}, em andamento`)}"></span>` : '';
    return `<tr data-team="${esc(t.id)}"${t.id === favorite ? ' class="is-fav"' : ''}>
      <td class="p"><span class="v2-pos ${z}"${zone ? ` title="${esc(zone.name)}"` : ''}>${t.pos}</span></td>
      <td class="c">${crest(t.logo, t.name, 20, 'mini')}</td>
      <td class="n"><span class="nm">${esc(t.name)}</span>${t.id === favorite ? STAR : ''}${move(t.delta)}${live}</td>
      <td class="pts">${t.pts}</td><td class="num">${t.gp}</td><td class="num">${gd}</td>
      <td class="fm">${dots(formById.get(t.id) || [])}</td>
    </tr>`;
  }).join('');
  return {
    html: `<table class="v2-table"><thead><tr><th class="p">#</th><th class="c"></th><th class="n">Clube</th><th class="pts" title="Pontos">P</th><th class="j" title="Jogos">J</th><th class="sg" title="Saldo de gols">SG</th><th class="fm">Últ. 5</th></tr></thead><tbody>${body}</tbody></table>`,
    legend: [...legend].map(([name, z]) => `<li><i class="v2-z ${z}"></i>${esc(name)}</li>`).join(''),
  };
}

// ---------- Números ----------

export function statsView({ roundLabel, st, trends, seasonAvg = null, open = false }) {
  const parts = [label(`${esc(roundLabel)} em números`)];
  if (st.games) {
    const zero = st.zeroes ? (st.zeroes === 1 ? 'um terminou 0&nbsp;x&nbsp;0' : `${st.zeroes} terminaram 0&nbsp;x&nbsp;0`) : 'nenhum 0&nbsp;x&nbsp;0';
    parts.push(`<section class="v2-block"><div class="v2-big3">
      <div><b>${st.goals}</b><span>${st.goals === 1 ? 'gol' : 'gols'}</span><small>em ${plural(st.games, 'jogo', 'jogos')}${st.live ? `, ${st.live} ao vivo` : ''}</small></div>
      <div><b>${decimal(st.avg)}</b><span>por jogo</span><small>${seasonAvg != null ? `no campeonato: ${decimal(seasonAvg)}` : 'média de gols'}</small></div>
      <div><b>${st.draws}</b><span>${st.draws === 1 ? 'empate' : 'empates'}</span><small>${zero}</small></div>
    </div><p class="v2-cap muted">${cap(plural(st.reds, 'cartão vermelho', 'cartões vermelhos'))} e ${plural(st.yellows, 'amarelo', 'amarelos')}.</p></section>`);

    parts.push(`<section class="v2-block"><h3>Quem venceu mais${st.live ? ' <small>com o placar atual</small>' : ''}</h3>
      <div class="v2-stack" role="img" aria-label="${esc(`Mandantes ${st.homeW}, empates ${st.draws}, visitantes ${st.awayW}`)}">${[['home', st.homeW], ['draw', st.draws], ['away', st.awayW]].map(([k, n]) => (n ? `<i class="${k}" style="flex:${n}"></i>` : '')).join('')}</div>
      <ul class="v2-lg"><li><i class="home"></i>Mandantes <b>${st.homeW}</b></li><li><i class="draw"></i>Empates <b>${st.draws}</b></li><li><i class="away"></i>Visitantes <b>${st.awayW}</b></li></ul>
      <p class="v2-cap">${esc(homeAwayNote(st, open))}</p></section>`);

    if (st.timed) {
      const max = Math.max(...st.buckets);
      const note = goalTimeNote(st);
      parts.push(`<section class="v2-block"><h3>Quando saem os gols <small>minuto do gol</small></h3>
        <div class="v2-cols" role="img" aria-label="${esc(st.buckets.map((n, i) => `${bucketLabels[i]}: ${n}`).join(', '))}">${st.buckets.map((n) => `<div><b>${n}</b><i class="${n === max ? 'hi' : ''}" style="height:${max ? Math.max(3, (n / max) * 84) : 3}px"></i></div>`).join('')}</div>
        <div class="v2-axis">${bucketLabels.map((l) => `<span>${l}</span>`).join('')}</div>
        ${note ? `<p class="v2-cap">${esc(note)}${st.timed < st.goals ? ` <span class="muted">(${plural(st.goals - st.timed, 'gol', 'gols')} sem minuto registrado)</span>` : ''}</p>` : ''}</section>`);
    }

    if (st.scorers.length) {
      const multi = st.scorers.filter((p) => p.n >= 2);
      const shown = multi.length ? multi : st.scorers.slice(0, 3);
      const rest = (st.scorerCount || st.scorers.length) - shown.length;
      const big = st.biggest?.ev;
      parts.push(`<section class="v2-block"><h3>Artilheiros da rodada</h3>
        ${shown.map((p) => `<div class="v2-scr" data-match="${esc(p.ev.id)}" role="button" tabindex="0">${crest(p.team.logo, p.team.name, 22, 'mini')}<span class="tn">${esc(p.who)}<small>${esc(p.team.name)}</small></span><b>${p.n}</b></div>`).join('')}
        <p class="v2-cap muted">${rest > 0 ? `E mais ${plural(rest, 'jogador', 'jogadores')} com um gol.` : ''}${big ? ` Maior goleada: <b class="ink" data-match="${esc(big.id)}" role="button" tabindex="0">${esc(big.home.name)} ${big.home.score} x ${big.away.score} ${esc(big.away.name)}</b>.` : ''}</p></section>`);
    }
  } else {
    parts.push('<section class="v2-block"><p class="v2-cap muted">Os números da rodada aparecem quando a bola rolar.</p></section>');
  }

  if (trends && (trends.hot.length || trends.attack)) {
    const list = (rows) => rows.map((x) => `<div class="v2-mom" data-team="${esc(x.team.id)}" role="button" tabindex="0">${crest(x.team.logo, x.team.name, 20, 'mini')}<span class="tn">${esc(x.team.name)}<small>${x.pts} de ${x.form.length * 3} pontos</small>${dots(x.form)}</span></div>`).join('');
    if (trends.hot.length) {
      parts.push(`<section class="v2-block"><h3>Momento dos times <small>últimos 5 jogos</small></h3>
        <div class="v2-split"><div><h4 class="up">Em alta</h4>${list(trends.hot)}</div><div><h4 class="dn">Em baixa</h4>${list(trends.cold)}</div></div></section>`);
    }
    const tile = (t, title, n, text) => `<div data-team="${esc(t.id)}" role="button" tabindex="0"><small>${title}</small><b>${n}</b><span>${crest(t.logo, t.name, 18, 'mini')}${esc(text)}</span></div>`;
    if (trends.attack && trends.defense) {
      parts.push(`<div class="v2-two">${tile(trends.attack, 'Melhor ataque', trends.attack.gf, `gols ${doo(trends.attack.name)}`)}${tile(trends.defense, 'Melhor defesa', trends.defense.ga, `sofridos ${pelo(trends.defense.name)}`)}</div>`);
    }
  }
  return parts.join('');
}

// ---------- Simular ----------

const pctShort = (p) => (p < 0.01 ? '<1%' : `${Math.round(p * 100)}%`);

function stepper(ev, side, value) {
  const name = side === 'h' ? ev.home.name : ev.away.name;
  return `<span class="v2-step" role="group" aria-label="${esc(`Gols ${name}`)}">
    <button type="button" data-action="sim-step" data-id="${esc(ev.id)}" data-side="${side}" data-delta="-1" aria-label="${esc(`Menos um gol para ${name}`)}">−</button>
    <output class="${value == null ? 'none' : ''}">${value ?? '–'}</output>
    <button type="button" data-action="sim-step" data-id="${esc(ev.id)}" data-side="${side}" data-delta="1" aria-label="${esc(`Mais um gol para ${name}`)}">+</button>
  </span>`;
}

function simCard(ev, sim, mp, note = '') {
  const s = ev.status;
  const live = s.kind === 'live';
  const when = live ? `● Ao vivo · ${s.half ? 'intervalo' : s.label} · ${ev.home.score}–${ev.away.score} agora`
    : s.kind === 'off' ? `${s.label}${note ? ` · ${note}` : ''} · ainda sem data` : cap(kickoff(ev.date));
  const value = (k) => (sim ? sim[k] : live ? (k === 'h' ? ev.home.score : ev.away.score) : null);
  const outcome = sim ? Math.sign(sim.h - sim.a) : null;
  const pick = (k, name, fallback) => {
    const p = mp?.picks[k] || fallback;
    const chance = mp ? (k === 1 ? mp.odds.home : k === 0 ? mp.odds.draw : mp.odds.away) : null;
    return `<button type="button" data-action="sim-set" data-id="${esc(ev.id)}" data-h="${p.h}" data-a="${p.a}" aria-pressed="${outcome === k}"
      aria-label="${esc(`${k === 0 ? 'Empate' : `Vitória ${doo(name)}`}${chance != null ? `, chance de ${pctShort(chance)}` : ''}`)}"><span>${esc(name)}</span>${chance != null ? `<small>${pctShort(chance)}</small>` : ''}</button>`;
  };
  const row = (t, k) => `<div class="v2-simrow">${crest(t.logo, t.name, 26)}<span class="tn">${esc(t.name)}</span>${stepper(ev, k, value(k))}</div>`;
  return `<article class="v2-simgame${sim ? ' is-sim' : ''}" id="sim-${esc(ev.id)}">
    <div class="v2-simst${live ? ' live' : ''}"><span>${esc(when)}</span>${sim ? `<button type="button" class="v2-simtag" data-action="sim-reset" data-id="${esc(ev.id)}" aria-label="Desfazer a simulação deste jogo">Simulado ${CLOSE}</button>` : ''}</div>
    ${row(ev.home, 'h')}${row(ev.away, 'a')}
    <div class="v2-pick" role="group" aria-label="Resultado rápido">${pick(1, ev.home.name, { h: 1, a: 0 })}${pick(0, 'Empate', { h: 1, a: 1 })}${pick(-1, ev.away.name, { h: 0, a: 1 })}</div>
  </article>`;
}

function doneList(events, open) {
  if (!events.length) return '';
  return `<details class="v2-done" data-keep="sim-done"${open ? ' open' : ''}>
    <summary><span>${plural(events.length, 'jogo encerrado', 'jogos encerrados')} <small>entram com o resultado real</small></span>${CHEVRON}</summary>
    <ul>${events.map((e) => `<li data-match="${esc(e.id)}" role="button" tabindex="0"><span>${esc(e.home.name)}</span><b>${e.home.score} x ${e.away.score}</b><span>${esc(e.away.name)}</span></li>`).join('')}</ul>
  </details>`;
}

// Só os times que mudam de posição ou de pontos com os placares escolhidos.
function changes({ real, sim, impact, zones, favorite, total, open }) {
  if (!real || !sim) return '';
  if (!total) return `<section class="v2-block"><h3>O que muda na tabela</h3><p class="v2-cap muted">Escolha um placar acima para ver quem sobe e quem cai.</p></section>`;
  const moved = sim.rows.filter((r) => { const b = real.byId.get(r.id); return b && (b.pos !== r.pos || b.pts !== r.pts); });
  const shown = moved.slice(0, 8);
  const notes = impact.filter((i) => i.prio >= 8 && i.tag !== 'Meu time').slice(0, 3);
  return `<section class="v2-block"><h3>O que muda com esses placares</h3>
    ${notes.map((n) => `<p class="v2-impact ${n.tone === 'bad' ? 'bad' : n.tone === 'good' ? 'good' : ''}">${esc(n.text)}</p>`).join('')}
    ${shown.map((r) => {
      const b = real.byId.get(r.id);
      const d = b.pos - r.pos;
      return `<div class="v2-chg" data-team="${esc(r.id)}" role="button" tabindex="0">${crest(r.logo, r.name, 22, 'mini')}<span class="tn">${esc(r.name)}${r.id === favorite ? STAR : ''}</span>
        <span class="ch">${d ? `<s>${b.pos}º</s> → ${r.pos}º ${move(d)}` : `${r.pos}º`}</span><span class="pt">${r.pts} pts</span></div>`;
    }).join('') || '<p class="v2-cap muted">Ninguém muda de posição com esses placares.</p>'}
    ${moved.length > shown.length ? `<p class="v2-cap muted">E mais ${plural(moved.length - shown.length, 'time', 'times')}.</p>` : ''}
    <details class="v2-more" data-keep="sim-table"${open ? ' open' : ''}><summary><span>Ver a tabela completa com esses placares</span>${CHEVRON}</summary>
      <div class="table-wrap">${miniTable(sim, real, zones, favorite)}</div></details>
  </section>`;
}

const HOW = (zones, open) => `<details class="v2-more" data-keep="how-odds"${open ? ' open' : ''}>
  <summary><span>Como calculamos</span>${CHEVRON}</summary>
  <div class="v2-how"><p>Cada time tem uma força de ataque e uma de defesa, medidas pelos gols marcados e sofridos. A fase recente pesa mais: os últimos 5 jogos contam 40%, os últimos 10 contam 35% e o campeonato inteiro, 25%. Quem joga em casa ganha a vantagem que os mandantes têm tido neste Brasileirão.</p>
  <p>Com essas forças, o app sorteia o placar de cada jogo que falta, refaz o campeonato 3.000 vezes e conta em quantas cada time termina campeão, no ${esc(zones.gLabel || 'G6')} ou no ${esc(zones.zLabel || 'Z4')}.</p></div>
</details>`;

// Chances separadas por objetivo, só com quem está na disputa.
function chances({ odds, oddsBase, oddsNote, zones, sim, real, total, favorite, open }) {
  if (!odds) return `<section class="v2-block"><h3>Chances até o fim</h3><p class="v2-cap muted">${esc(oddsNote)}</p></section>`;
  const teams = (sim || real)?.rows || [];
  const base = total ? oddsBase : null;
  const bar = (t, key, good, red) => {
    const o = odds.byId.get(t.id);
    const b = base?.byId.get(t.id);
    const raw = b ? Math.round((o[key] - b[key]) * 100) : 0;
    const d = Math.abs(raw) >= 2 ? raw : 0; // variação de 1 ponto é oscilação do sorteio
    return `<div class="v2-orow${red ? ' z' : ''}" data-team="${esc(t.id)}" role="button" tabindex="0">${crest(t.logo, t.name, 20, 'mini')}
      <span class="tn">${esc(t.name)}${t.id === favorite ? STAR : ''}</span><span class="v2-bar"><i style="width:${Math.max(1, o[key] * 100).toFixed(1)}%"></i></span>
      <span class="v">${pct(o[key])}</span><span class="d ${d ? ((d > 0) === good ? 'good' : 'bad') : ''}">${d ? `${d > 0 ? '+' : ''}${d}` : ''}</span></div>`;
  };
  const by = (key) => teams.filter((t) => odds.byId.has(t.id)).sort((x, y) => odds.byId.get(y.id)[key] - odds.byId.get(x.id)[key]);
  const names = (list) => list.map((t) => t.name).join(', ').replace(/, ([^,]*)$/, ' e $1');
  const title = by('title').filter((t) => odds.byId.get(t.id).title >= 0.005).slice(0, 4);
  const sure = by('g').filter((t) => odds.byId.get(t.id).g >= 0.995);
  const g = by('g').filter((t) => { const p = odds.byId.get(t.id).g; return p >= 0.005 && p < 0.995; }).slice(0, 7);
  const z = by('z').filter((t) => odds.byId.get(t.id).z >= 0.005).slice(0, 8);
  const sec = (name, rows, extra = '') => (rows.length || extra ? `<h4>${name}</h4>${extra}${rows.join('')}` : '');
  return `<section class="v2-block v2-odds"><h3>Chances até o fim${total ? ' <small>com os seus placares</small>' : ''}</h3>
    ${sec('Título', title.map((t) => bar(t, 'title', true)))}
    ${zones.g ? sec(`Vaga no ${esc(zones.gLabel)}`, g.map((t) => bar(t, 'g', true)), sure.length ? `<p class="v2-cap muted tight">${esc(names(sure))} ${sure.length === 1 ? 'fica' : 'ficam'} no ${esc(zones.gLabel)} em praticamente todas as simulações.</p>` : '') : ''}
    ${zones.zStart ? sec('Risco de cair', z.map((t) => bar(t, 'z', false, true))) : ''}
    <p class="v2-cap muted">${esc(oddsNote)}${total ? ' Os números pequenos mostram quanto os seus placares mudaram cada chance.' : ''}</p>
    ${HOW(zones, open['how-odds'])}
  </section>`;
}

/** Aba Simular (mesmos dados da versão atual). */
export function simView({ round, roundLabel, sims, real, sim, zones, impact, odds, oddsBase, oddsNote, favorite, finished, postponed = [], picksOf = () => null, open = {} }) {
  const total = Object.keys(sims).length;
  const count = round.events.filter((e) => sims[e.id]).length;
  const head = `<section class="v2-simhead">${label(`Simulador · ${esc(roundLabel)}`)}
    <p class="v2-intro">Escolha os placares dos jogos que faltam e veja o que muda. Cada botão aplica o placar mais provável daquele resultado. Fica salvo neste celular.</p>
    <div class="v2-acts">
      ${finished ? '' : '<button type="button" class="v2-btn dark" data-action="sim-suggest">Sugerir placares</button>'}
      <button type="button" class="v2-btn" data-action="sim-clear"${total ? '' : ' disabled'}>Limpar${total ? ` (${total})` : ''}</button>
    </div>
    ${total > count ? `<p class="v2-cap muted">${plural(total - count, 'jogo simulado', 'jogos simulados')} em outras rodadas também ${total - count === 1 ? 'entra' : 'entram'} na conta.</p>` : ''}</section>`;
  const pending = round.events.filter((e) => e.status.kind !== 'post');
  const games = finished
    ? '<p class="empty">Esta rodada já terminou. Use as setas no topo para ir a uma rodada que ainda vai acontecer.</p>'
    : `<div class="v2-list">${pending.map((e) => simCard(e, sims[e.id], picksOf(e))).join('')}</div>${doneList(round.events.filter((e) => e.status.kind === 'post'), open['sim-done'])}`;
  // Adiado de outra rodada, ainda sem data: entra aqui para a simulação do campeonato ficar completa.
  const later = postponed.length
    ? `<section class="v2-sec">${label(postponed.length === 1 ? 'Jogo adiado, de outra rodada' : 'Jogos adiados, de outras rodadas')}<div class="v2-list">${postponed.map(({ ev, label: from }) => simCard(ev, sims[ev.id], picksOf(ev), from)).join('')}</div></section>`
    : '';
  return head + games + later
    + changes({ real, sim, impact, zones, favorite, total, open: open['sim-table'] })
    + chances({ odds, oddsBase, oddsNote, zones, sim, real, total, favorite, open });
}

// ---------- Detalhe do jogo ----------

const STAT_DEFS = [
  ['possessionPct', 'Posse de bola', (v) => `${Math.round(v)}%`],
  ['totalShots', 'Finalizações'],
  ['shotsOnTarget', 'Chutes no gol'],
  ['wonCorners', 'Escanteios'],
  ['saves', 'Defesas do goleiro'],
  ['foulsCommitted', 'Faltas'],
  ['offsides', 'Impedimentos'],
  ['yellowCards', 'Cartões amarelos'],
  ['redCards', 'Cartões vermelhos'],
];

// Linha do jogo: gols do mandante em cima, do visitante embaixo, de 0 aos 90 e os acréscimos.
function track(ev) {
  const marks = ev.incidents.filter((i) => i.kind === 'goal' || i.kind === 'red');
  const minute = (m) => (m.base == null ? null : m.base >= 90 ? m.base + m.extra : Math.min(m.base, 90));
  let now = null;
  if (ev.status.kind === 'live') now = ev.status.half ? 45 : parseInt(ev.status.label, 10) || null;
  const end = Math.max(90, ...marks.map((i) => minute(i.min) || 0), now || 0) + 1;
  const x = (m) => `${((m / end) * 100).toFixed(2)}%`;
  return `<div class="v2-track" aria-hidden="true">
    <i class="line"></i>${end > 91 ? `<i class="stop" style="left:${x(90)}"></i>` : ''}<i class="ht" style="left:${x(45)}"></i>
    ${now != null ? `<i class="now" style="left:${x(now)}"></i>` : ''}
    ${marks.map((i) => {
      const m = minute(i.min);
      if (m == null) return '';
      const home = i.team === ev.home.id;
      return `<i class="mk ${i.kind} ${home ? 'h' : 'a'}" style="left:${x(m)}"></i>`;
    }).join('')}
  </div>
  <div class="v2-ticks"><span style="left:0">0'</span><span style="left:${x(45)}">45'</span><span style="left:${x(90)}">90'</span></div>`;
}

function lances(ev) {
  const items = ev.incidents.filter((i) => i.kind === 'goal' || i.kind === 'red');
  const rows = items.map((i) => {
    const home = i.team === ev.home.id;
    const extra = i.kind === 'red' ? ' <small>(vermelho)</small>' : `${i.pen ? ' <small>(pênalti)</small>' : ''}${i.og ? ' <small>(contra)</small>' : ''}`;
    const ico = i.kind === 'red' ? '<i class="card-ico red"></i>' : `<i class="v2-ball ${home ? 'h' : 'a'}"></i>`;
    const who = esc(i.who || (i.kind === 'goal' ? 'Gol' : 'Cartão vermelho'));
    return `<div class="v2-tl"><span class="l">${home ? `${who}${extra}${ico}` : ''}</span><span class="m">${esc(i.min.label)}</span><span class="r">${home ? '' : `${ico}${who}${extra}`}</span></div>`;
  });
  const y = (t) => ev.incidents.filter((i) => i.kind === 'yellow' && i.team === t.id).length;
  const yh = y(ev.home);
  const ya = y(ev.away);
  const cards = yh + ya ? `<p class="v2-cap muted">Cartões amarelos: ${yh} para ${o(ev.home.name)}, ${ya} para ${o(ev.away.name)}.</p>` : '';
  return rows.join('') + cards;
}

function oddsBlock(ev, mp) {
  if (!mp) return '';
  const { home, draw, away } = mp.odds;
  const seg = (cls, p) => (p >= 0.005 ? `<i class="${cls}" style="flex:${p.toFixed(3)}"></i>` : '');
  const s = mp.picks[mp.suggest];
  return `<section class="v2-block"><h3>Chances pelo modelo do app${ev.status.kind === 'live' ? ' <small>a partir do placar atual</small>' : ''}</h3>
    <div class="v2-stack" role="img" aria-label="${esc(`${ev.home.name} ${pctShort(home)}, empate ${pctShort(draw)}, ${ev.away.name} ${pctShort(away)}`)}">${seg('home', home)}${seg('draw', draw)}${seg('away', away)}</div>
    <ul class="v2-lg"><li><i class="home"></i>${esc(ev.home.name)} <b>${pctShort(home)}</b></li><li><i class="draw"></i>Empate <b>${pctShort(draw)}</b></li><li><i class="away"></i>${esc(ev.away.name)} <b>${pctShort(away)}</b></li></ul>
    ${s ? `<p class="v2-cap">Placar sugerido: <b>${esc(ev.home.name)} ${s.h} x ${s.a} ${esc(ev.away.name)}</b></p>` : ''}
  </section>`;
}

function stakesBlock(ev, sc) {
  if (!sc) return '';
  const rows = [['home', `Se ${o(ev.home.name)} vencer`], ['draw', 'Se empatar'], ['away', `Se ${o(ev.away.name)} vencer`]];
  return `<section class="v2-block"><h3>O que está em jogo <small>com os outros placares atuais</small></h3>
    <div class="v2-scen"><span></span><b>${esc(ev.home.name)}</b><b>${esc(ev.away.name)}</b>
    ${rows.map(([k, text]) => `<span>${esc(text)}</span><b>${ord(sc[k].home?.pos)}</b><b>${ord(sc[k].away?.pos)}</b>`).join('')}</div>
  </section>`;
}

function statBars(ev, stats) {
  const h = stats?.[ev.home.id];
  const a = stats?.[ev.away.id];
  const rows = STAT_DEFS.filter(([k]) => Number.isFinite(h?.[k]) && Number.isFinite(a?.[k]) && h[k] + a[k] > 0);
  if (!rows.length) return '';
  return `${rows.map(([k, name, fmt = (v) => decimal(v)]) => `<div class="v2-sbar">
    <div class="top"><b class="${h[k] < a[k] ? 'lo' : ''}">${fmt(h[k])}</b><span>${esc(name)}</span><b class="${a[k] < h[k] ? 'lo' : ''}">${fmt(a[k])}</b></div>
    <div class="trk"><i class="h" style="flex:${h[k]}"></i><i class="a" style="flex:${a[k]}"></i></div></div>`).join('')}`;
}

// Últimos confrontos: o placar geral em três números e a lista, com quem perdeu em cinza.
function h2hBlock(ev, games) {
  const sum = h2hSummary(games, ev.home, ev.away);
  if (!sum) return '';
  const name = (t) => (t.id === ev.home.id ? ev.home.name : t.id === ev.away.id ? ev.away.name : t.name);
  const tile = (n, text) => `<div><b>${n}</b><small>${esc(text)}</small></div>`;
  const rows = games.map((g) => {
    const hl = g.home.score < g.away.score;
    const al = g.away.score < g.home.score;
    return `<div class="v2-h2h"><span class="when">${esc(`${dm(g.date)}/${String(g.date.getFullYear()).slice(2)}`)}<small>${esc(g.competition)}</small></span>
      <span class="game"><span class="h${hl ? ' lost' : ''}">${esc(name(g.home))}</span><b>${g.home.score}–${g.away.score}</b><span class="a${al ? ' lost' : ''}">${esc(name(g.away))}</span>
      ${g.pens ? `<small>${esc(name(g[g.pens]))} venceu nos pênaltis</small>` : ''}</span></div>`;
  }).join('');
  return `<section class="v2-block"><h3>Últimos confrontos <small>${sum.n === 1 ? 'o último jogo' : `os últimos ${sum.n} jogos`}, em qualquer competição</small></h3>
    <div class="v2-tally">${tile(sum.wins[ev.home.id], `${sum.wins[ev.home.id] === 1 ? 'vitória' : 'vitórias'} ${doo(ev.home.name)}`)}${tile(sum.draws, sum.draws === 1 ? 'empate' : 'empates')}${tile(sum.wins[ev.away.id], `${sum.wins[ev.away.id] === 1 ? 'vitória' : 'vitórias'} ${doo(ev.away.name)}`)}</div>
    ${rows}${sum.streak ? `<p class="v2-cap">${esc(sum.streak)}</p>` : ''}</section>`;
}

/** Detalhe de um jogo. ctx: {table, scen, stats, statsLoading, formById, favorite, story, roundLabel, picks, zones, inFocus, now, flow, reading} */
export function matchSheet(ev, ctx) {
  const s = ev.status;
  const pre = s.kind === 'pre' || s.kind === 'off';
  const post = s.kind === 'post' && ev.home.score != null;
  const lost = (key) => post && (key === 'home' ? ev.home.score < ev.away.score : ev.away.score < ev.home.score);
  const head = (t, key) => {
    const row = ctx.table?.byId.get(t.id);
    return `<button type="button" class="v2-mt${lost(key) ? ' lost' : ''}" data-team="${esc(t.id)}">
      ${crest(t.logo, t.name, 56)}<b>${esc(t.name)}${t.id === ctx.favorite ? STAR : ''}</b><small>${row ? `${row.pos}º · ${row.pts} pts` : ''}</small></button>`;
  };
  const statusText = s.kind === 'live' ? `<span class="live-text">${esc(s.half ? 'Intervalo' : `${s.label} · ao vivo`)}</span>` : post ? 'Encerrado' : s.kind === 'pre' ? esc(kickoff(ev.date, ctx.now)) : esc(s.label);
  const tags = storyTags(ctx.story || {});
  // Com o lance a lance da ESPN, a linha do jogo vira o fluxo da partida (pressão minuto a minuto);
  // embaixo, a leitura do jogo (gols, lances que mudaram o jogo, quem manda e o momento).
  const reading = ctx.reading || [];
  const showHow = !pre && (ev.incidents.length || post || ctx.flow || reading.length);
  const stats = ctx.stats ? statBars(ev, ctx.stats) : '';
  const lines = ctx.inFocus && ctx.table && !pre ? [tableLine(ev.home.id, ctx.table, ctx.zones), tableLine(ev.away.id, ctx.table, ctx.zones)].filter(Boolean) : [];
  const form = (t) => {
    const f = ctx.formById.get(t.id) || [];
    return `<div class="v2-frm" data-team="${esc(t.id)}" role="button" tabindex="0">${crest(t.logo, t.name, 22, 'mini')}<span>${esc(t.name)}<small>${f.length ? `${formPts(f)} de ${f.length * 3} pontos` : ''}</small></span>${f.length ? dots(f) : formDots(f)}</div>`;
  };
  return `
    <div class="v2-mh">${head(ev.home, 'home')}
      <div class="v2-msc"><b>${pre ? 'x' : `${ev.home.score}–${ev.away.score}`}</b><small>${statusText}</small></div>
      ${head(ev.away, 'away')}</div>
    <p class="v2-mmeta">${esc([ctx.roundLabel, `${weekdayShort(ev.date)} ${dm(ev.date)} · ${fmtTime.format(ev.date)}`, ev.venue].filter(Boolean).join(' · '))}${ev.moved ? ' · <b>jogo remarcado</b>' : ''}</p>
    ${tags.length ? `<p class="v2-mtags">${tags.map((t) => `<b class="v2-chip">${esc(t)}</b>`).join('')}</p>` : ''}
    ${showHow ? `<section class="v2-block"><h3>${s.kind === 'live' ? 'Como está' : 'Como foi'}${ctx.flow ? ' <small>pressão de cada time, minuto a minuto</small>' : ''}</h3>${ctx.flow ? flowChart(ctx.flow, ev, reading.map((l) => l.text).join(' ')) : track(ev)}
      ${readingList(reading)}
      ${lances(ev)}</section>` : ''}
    ${oddsBlock(ev, ctx.picks)}
    ${stakesBlock(ev, ctx.scen)}
    ${s.kind !== 'post' ? `<button type="button" class="v2-btn dark wide" data-action="simulate" data-id="${esc(ev.id)}">Simular este jogo e ver a tabela</button>` : ''}
    ${stats ? `<section class="v2-block"><h3>Estatísticas</h3>${stats}</section>` : (!pre && ctx.statsLoading ? '<p class="v2-cap muted center">Carregando estatísticas…</p>' : '')}
    ${lines.length ? `<section class="v2-block"><h3>Na tabela${s.kind === 'live' ? ' <small>se terminar assim</small>' : ''}</h3>${lines.map((l) => `<p class="v2-cap">${esc(l)}</p>`).join('')}</section>` : ''}
    <section class="v2-block"><h3>Últimos 5 jogos</h3>${form(ev.home)}${form(ev.away)}</section>
    ${ctx.h2h?.length ? h2hBlock(ev, ctx.h2h) : ''}`;
}
