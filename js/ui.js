// Montagem do HTML de cada parte da tela. Funções puras: recebem dados, devolvem texto.
import { crestUrl } from './espn.js';
import { bucketLabels, storyTags } from './insights.js';
import { distances, formPoints } from './table.js';
import { canPick, grade } from './bolao.js';
import { decimal, dm, esc, fmtTime, kickoff, o, plural, shortDay, weekdayShort } from './util.js';

const ord = (n) => (n ? `${n}º` : '');

export function crest(url, name, size = 26, cls = 'crest') {
  const style = `width:${size}px;height:${size}px`;
  if (!url) return `<span class="crest-fallback" style="${style}">${esc((name || '?').slice(0, 3).toUpperCase())}</span>`;
  return `<img class="${cls}" style="${style}" src="${esc(crestUrl(url, size > 40 ? 128 : 64))}" data-fallback="${esc(url)}" alt="" loading="lazy" decoding="async">`;
}

const star = '<svg class="star" viewBox="0 0 24 24" width="14" height="14" aria-label="Meu time"><path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" fill="currentColor"/></svg>';

export function moveChip(delta) {
  if (!delta) return '';
  return delta > 0
    ? `<span class="move up" title="Subiu ${delta}">▲${delta}</span>`
    : `<span class="move down" title="Caiu ${-delta}">▼${-delta}</span>`;
}

export function formDots(form) {
  if (!form?.length) return '<span class="form muted">–</span>';
  const word = { V: 'Vitória', E: 'Empate', D: 'Derrota' };
  return `<span class="form">${form.map((g) => `<i class="f f-${g.res}" title="${esc(`${word[g.res]}: ${g.gf} x ${g.ga} ${g.home ? 'contra' : 'fora contra'} ${g.opp.name}`)}">${g.res}</i>`).join('')}</span>`;
}

// "Pedro 23', 67' · Arrascaeta 51' (pên.)"
function scorers(goals) {
  const byPlayer = new Map();
  for (const g of goals) {
    const key = `${g.who}|${g.og ? 'og' : ''}`;
    if (!byPlayer.has(key)) byPlayer.set(key, { who: g.who || 'Gol', og: g.og, mins: [] });
    byPlayer.get(key).mins.push(`${g.min.label}${g.pen ? ' (pên.)' : ''}`);
  }
  return [...byPlayer.values()].map((p) => `${p.who}${p.og ? ' (contra)' : ''} ${p.mins.join(', ')}`.trim()).join(' · ');
}

export function pickChip(ev, pick) {
  if (!pick) return canPick(ev) ? '<span class="pick-cta">Palpitar</span>' : '';
  const guess = `${pick.h} x ${pick.a}`;
  if (ev.status.kind === 'pre') return `<span class="pick">Palpite ${guess}</span>`;
  const g = grade(pick, ev.home.score, ev.away.score);
  if (!g) return `<span class="pick">Palpite ${guess}</span>`;
  const live = ev.status.kind === 'live';
  return `<span class="pick pick-${g.kind}">Palpite ${guess} · ${live ? 'valendo ' : ''}+${g.pts}</span>`;
}

/** Cartão de um jogo. ctx: {rank(id), delta(id), favorite, flash, pick, story} */
export function matchCard(ev, ctx) {
  const s = ev.status;
  let status;
  if (s.kind === 'live') status = `${esc(s.label)}<span class="pulse" aria-hidden="true"></span>`;
  else if (s.kind === 'off') status = `<small>${esc(s.label)}</small>`;
  else status = esc(s.label);

  const decided = s.kind === 'post' && ev.home.score != null && ev.away.score != null;
  const flash = ctx.flash;
  const row = (t, key) => {
    const other = key === 'home' ? ev.away : ev.home;
    const result = decided ? (t.score > other.score ? 'won' : t.score < other.score ? 'lost' : 'draw') : '';
    const scored = flash && flash.sides.has(key);
    const score = s.kind === 'pre' || s.kind === 'off' || t.score == null ? '–' : t.score;
    const goals = ev.incidents.filter((i) => i.kind === 'goal' && i.team === t.id);
    const reds = ev.incidents.filter((i) => i.kind === 'red' && i.team === t.id).length;
    return `
      <div class="team ${result}">
        ${crest(t.logo, t.name)}
        <div class="team-info">
          <div class="team-name"><span class="nm">${esc(t.name)}</span>${t.id === ctx.favorite ? star : ''}<span class="rank">${ord(ctx.rank(t.id))}</span>${moveChip(ctx.delta(t.id))}${'<i class="red-card" title="Cartão vermelho"></i>'.repeat(Math.min(reds, 4))}${scored ? '<b class="gol-tag">GOL</b>' : ''}</div>
          ${goals.length ? `<p class="scorers">${esc(scorers(goals))}</p>` : ''}
        </div>
        <span class="score${scored ? ' flash' : ''}${scored && flash.fresh ? ' pop' : ''}">${score}</span>
      </div>`;
  };

  const tags = storyTags(ctx.story || {});
  const left = tags.length
    ? `<span class="tags">${tags.map((t) => `<b class="tag tone-gol">${esc(t)}</b>`).join('')}</span>`
    : `<span class="venue">${esc(ev.venue)}</span>`;
  const label = s.kind === 'live' ? s.note : s.kind === 'post' ? 'Encerrado' : s.kind === 'pre' ? `Começa às ${s.label}` : s.label;
  const fav = ev.home.id === ctx.favorite || ev.away.id === ctx.favorite;
  return `
    <article class="match is-${s.kind}${fav ? ' is-fav' : ''}" data-match="${esc(ev.id)}" tabindex="0" role="button"
      aria-label="${esc(`${ev.home.name} ${ev.home.score ?? ''} x ${ev.away.score ?? ''} ${ev.away.name}, ${label}. Toque para ver detalhes.`)}">
      <div class="status">${status}</div>
      <div class="teams">${row(ev.home, 'home')}${row(ev.away, 'away')}</div>
      <div class="match-foot">${left}${pickChip(ev, ctx.pick)}</div>
    </article>`;
}

export function newsCard(items, title) {
  if (!items.length) return '';
  return `
    <section class="news" aria-label="${esc(title)}">
      <h2 class="section-title">${esc(title)}</h2>
      <ul>${items.map((n) => `
        <li${n.ev ? ` data-match="${esc(n.ev)}" role="button" tabindex="0"` : ''}>
          <b class="tag tone-${n.tone}">${esc(n.tag)}</b><span>${esc(n.text)}</span>
        </li>`).join('')}
      </ul>
    </section>`;
}

/** Cartão "Meu time" no topo dos jogos. */
export function favoriteCard({ team, row, roundGame, nextGame, zones, rankOf, now }) {
  if (!team) return '';
  const pos = row ? `${ord(row.pos)} · ${row.pts} pts` : '';
  let line = '';
  let score = '';
  const r = row?.result;
  if (r) {
    const sc = `${r.gf} a ${r.ga}`;
    const verb = r.live
      ? { V: `Vence ${o(r.opp.name)} por ${sc}`, E: `Empata com ${o(r.opp.name)}, ${sc}`, D: `Perde para ${o(r.opp.name)} por ${r.ga} a ${r.gf}` }
      : { V: `Venceu ${o(r.opp.name)} por ${sc}`, E: `Empatou com ${o(r.opp.name)}, ${sc}`, D: `Perdeu para ${o(r.opp.name)} por ${r.ga} a ${r.gf}` };
    const where = row.delta > 0 ? `${r.live ? 'sobe' : 'subiu'} para ${ord(row.pos)}` : row.delta < 0 ? `${r.live ? 'cai' : 'caiu'} para ${ord(row.pos)}` : `${r.live ? 'fica' : 'segue'} em ${ord(row.pos)}`;
    line = r.live ? `${verb[r.res]}. Se terminar assim, ${where}.` : `${verb[r.res]} e ${where}.`;
    if (zones?.zStart && row.pos >= zones.zStart) line += ` Está no ${zones.zLabel}.`;
    else if (zones?.g && row.pos <= zones.g && row.prePos > zones.g) line += ` Entra no ${zones.gLabel}.`;
    const ev = r.ev;
    const word = { V: 'vitória', E: 'empate', D: 'derrota' }[r.res];
    score = `<span class="fav-score">${r.gf} x ${r.ga}${ev.status.kind === 'live' ? `<small class="live-text">${esc(ev.status.label)}</small>` : `<small>${word}</small>`}</span>`;
  } else {
    const g = roundGame || nextGame;
    if (g) {
      const opp = g.home.id === team.id ? g.away : g.home;
      line = `${roundGame ? 'Joga' : 'Próximo jogo:'} ${kickoff(g.date, now)} contra ${o(opp.name)}${rankOf(opp.id) ? ` (${ord(rankOf(opp.id))})` : ''}.`;
      if (g.status.kind === 'off') line = `Jogo contra ${o(opp.name)} ${g.status.label.toLowerCase()}.`;
      score = `<span class="fav-score">${g.status.kind === 'pre' ? fmtTime.format(g.date) : ''}<small>${g.status.kind === 'pre' ? esc(weekdayShort(g.date)) : ''}</small></span>`;
    }
  }
  return `
    <button class="fav-card" type="button" data-team="${esc(team.id)}">
      ${crest(team.logo, team.name, 40)}
      <span class="fav-body">
        <span class="fav-label">${star} Meu time</span>
        <span class="fav-name">${esc(team.name)} <span>${pos}${row ? moveChip(row.delta) : ''}</span></span>
        ${line ? `<span class="fav-line">${esc(line)}</span>` : ''}
      </span>
      ${score}
    </button>`;
}

export const favoriteHint = () => `
  <div class="fav-hint">
    <button type="button" data-action="picker">${star} Escolha seu time para acompanhar de perto</button>
    <button type="button" class="hint-close" data-action="hide-hint" aria-label="Dispensar">×</button>
  </div>`;

/** Tabela de classificação. */
export function standingsTable({ table, zones, formById, favorite }) {
  const legend = new Map();
  const body = table.rows.map((t) => {
    const zone = zones.byPos[t.pos];
    if (zone && !legend.has(zone.name)) legend.set(zone.name, zone.color);
    const r = t.result;
    const live = r?.live ? '<span class="pulse" title="Jogando agora"></span>' : '';
    const res = r ? `<span class="res res-${r.res}" title="${esc(`${r.gf} x ${r.ga} contra ${r.opp.name}${r.live ? ', em andamento' : ''}`)}">${r.res}</span>` : '';
    const gd = t.gd > 0 ? `+${t.gd}` : t.gd;
    const pct = t.gp ? Math.round((t.pts / (t.gp * 3)) * 100) : 0;
    return `<tr data-team="${esc(t.id)}"${t.id === favorite ? ' class="is-fav"' : ''}>
      <td class="pos"${zone ? ` style="--zone:${esc(zone.color)}"` : ''}><span class="pos-n">${t.pos}</span>${moveChip(t.delta)}</td>
      <td class="club"><span class="club-cell">${crest(t.logo, t.name, 20, 'mini')}<span class="club-name">${esc(t.name)}</span>${t.id === favorite ? star : ''}${res}${live}</span></td>
      <td class="pts">${t.pts}</td><td>${t.gp}</td><td>${t.w}</td><td>${t.d}</td><td>${t.l}</td><td>${gd}</td><td>${t.gf}</td><td>${t.ga}</td><td>${pct}</td>
      <td class="form-col">${formDots(formById.get(t.id))}</td>
    </tr>`;
  }).join('');
  const head = `<thead><tr>
    <th class="pos">#</th><th class="club">Clube</th><th title="Pontos">P</th><th title="Jogos">J</th><th title="Vitórias">V</th>
    <th title="Empates">E</th><th title="Derrotas">D</th><th title="Saldo de gols">SG</th><th title="Gols pró">GP</th>
    <th title="Gols contra">GC</th><th title="Aproveitamento">%</th><th class="form-col">Últimos 5</th></tr></thead>`;
  return {
    html: `<table class="standings">${head}<tbody>${body}</tbody></table>`,
    legend: [...legend].map(([name, color]) => `<li style="--zone:${esc(color)}"><i></i>${esc(name)}</li>`).join(''),
  };
}

/** Aba Números. */
export function statsView({ roundLabel, st, trends, bolao, bolaoRound, selectedBar }) {
  const parts = [];
  if (st.games) {
    const tiles = [
      ['Gols', st.goals, st.live ? `em ${plural(st.games, 'jogo', 'jogos')}, ${st.live} ao vivo` : `em ${plural(st.games, 'jogo', 'jogos')}`],
      ['Média por jogo', decimal(st.avg), st.avg >= 2.5 ? 'rodada movimentada' : st.avg < 2 ? 'rodada travada' : 'dentro da média'],
      ['Empates', st.draws, st.zeroes ? `${plural(st.zeroes, 'foi', 'foram')} 0 x 0` : 'nenhum 0 x 0'],
      ['Vermelhos', st.reds, plural(st.yellows, 'amarelo', 'amarelos')],
    ];
    const total = st.homeW + st.draws + st.awayW;
    const seg = (cls, n) => (n ? `<span class="seg ${cls}" style="flex:${n}"></span>` : '');
    const max = Math.max(...st.buckets);
    const sel = selectedBar ?? st.buckets.indexOf(max);
    const bars = st.buckets.map((n, i) => `
      <button type="button" class="bar${i === sel ? ' is-sel' : ''}" data-action="bar" data-i="${i}"
        aria-label="${esc(`${bucketLabels[i]} minutos: ${plural(n, 'gol', 'gols')}`)}" aria-pressed="${i === sel}">
        ${i === sel ? `<span class="bar-val">${n}</span>` : ''}<span class="bar-fill" style="height:${max ? (n / max) * 100 : 0}%"></span>
      </button>`).join('');
    parts.push(`
      <section class="block">
        <h2 class="section-title">${esc(roundLabel)} em números</h2>
        <div class="tiles">${tiles.map(([l, v, sub]) => `<div class="tile"><span class="tile-label">${esc(l)}</span><span class="tile-value">${esc(v)}</span><span class="tile-sub">${esc(sub)}</span></div>`).join('')}</div>
        <figure class="chart">
          <figcaption>Quem venceu mais${st.live ? ' <small>placar atual dos jogos em andamento</small>' : ''}</figcaption>
          <div class="stack" role="img" aria-label="${esc(`Mandantes ${st.homeW}, empates ${st.draws}, visitantes ${st.awayW}`)}">${seg('home', st.homeW)}${seg('draw', st.draws)}${seg('away', st.awayW)}</div>
          <ul class="chart-legend">
            <li><i class="sw home"></i>Mandante <b>${st.homeW}</b></li>
            <li><i class="sw draw"></i>Empate <b>${st.draws}</b></li>
            <li><i class="sw away"></i>Visitante <b>${st.awayW}</b></li>
          </ul>
          <p class="chart-note">${total ? esc(homeAwayNote(st)) : ''}</p>
        </figure>
        ${st.timed ? `
        <figure class="chart">
          <figcaption>Quando saem os gols <small>toque numa barra</small></figcaption>
          <div class="bars">${bars}</div>
          <div class="bars-axis">${bucketLabels.map((l) => `<span>${l}</span>`).join('')}</div>
          <p class="chart-note">${esc(`Entre ${bucketLabels[sel].replace('–', ' e ')} minutos: ${plural(st.buckets[sel], 'gol', 'gols')}`)}${st.timed < st.goals ? ` <small>(${st.timed} de ${st.goals} gols com minuto registrado)</small>` : ''}</p>
        </figure>` : ''}
        ${st.scorers.length ? `
        <div class="sub-block">
          <h3 class="sub-title">Artilheiros da rodada</h3>
          <ol class="rank-list">${st.scorers.map((p) => `
            <li data-match="${esc(p.ev.id)}" role="button" tabindex="0">${crest(p.team.logo, p.team.name, 22, 'mini')}<span class="rl-name">${esc(p.who)} <small>${esc(p.team.name)}</small></span><b>${p.n}</b></li>`).join('')}
          </ol>
        </div>` : ''}
        ${st.biggest || st.mostGoals ? `
        <div class="sub-block facts">
          ${st.biggest ? fact('Maior goleada', st.biggest.ev) : ''}
          ${st.mostGoals && st.mostGoals.ev !== st.biggest?.ev ? fact('Jogo com mais gols', st.mostGoals.ev) : ''}
        </div>` : ''}
      </section>`);
  } else {
    parts.push(`<section class="block"><h2 class="section-title">${esc(roundLabel)} em números</h2><p class="empty">Os números aparecem quando a bola rolar.</p></section>`);
  }

  if (trends && (trends.hot.length || trends.attack)) {
    const list = (rows) => rows.map((x) => `
      <li data-team="${esc(x.team.id)}" role="button" tabindex="0">${crest(x.team.logo, x.team.name, 22, 'mini')}<span class="rl-name">${esc(x.team.name)} <small>${x.pts} de ${x.form.length * 3} pts</small></span>${formDots(x.form)}</li>`).join('');
    parts.push(`
      <section class="block">
        <h2 class="section-title">Momento dos times <small>últimos 5 jogos</small></h2>
        <div class="split">
          <div><h3 class="sub-title up-text">Em alta</h3><ol class="rank-list">${list(trends.hot)}</ol></div>
          <div><h3 class="sub-title down-text">Em baixa</h3><ol class="rank-list">${list(trends.cold)}</ol></div>
        </div>
        <div class="tiles two">
          ${trends.attack ? `<div class="tile" data-team="${esc(trends.attack.id)}" role="button" tabindex="0"><span class="tile-label">Melhor ataque</span><span class="tile-value">${trends.attack.gf}</span><span class="tile-sub">gols do ${esc(trends.attack.name)}</span></div>` : ''}
          ${trends.defense ? `<div class="tile" data-team="${esc(trends.defense.id)}" role="button" tabindex="0"><span class="tile-label">Melhor defesa</span><span class="tile-value">${trends.defense.ga}</span><span class="tile-sub">gols sofridos pelo ${esc(trends.defense.name)}</span></div>` : ''}
        </div>
      </section>`);
  }

  parts.push(`
    <section class="block">
      <h2 class="section-title">Seu bolão</h2>
      <div class="tiles">
        <div class="tile"><span class="tile-label">Pontos</span><span class="tile-value">${bolao.pts}</span><span class="tile-sub">em ${plural(bolao.graded, 'jogo encerrado', 'jogos encerrados')}</span></div>
        <div class="tile"><span class="tile-label">Nesta rodada</span><span class="tile-value">${bolaoRound.pts}</span><span class="tile-sub">${bolaoRound.open ? `${plural(bolaoRound.open, 'palpite aberto', 'palpites abertos')}` : 'sem palpites abertos'}</span></div>
        <div class="tile"><span class="tile-label">Na mosca</span><span class="tile-value">${bolao.exact}</span><span class="tile-sub">placares exatos</span></div>
        <div class="tile"><span class="tile-label">Acertos</span><span class="tile-value">${bolao.right}</span><span class="tile-sub">vencedor ou empate</span></div>
      </div>
      <p class="chart-note">Toque num jogo que ainda não começou para palpitar. Placar exato vale 3 pontos e acertar o vencedor ou o empate vale 1. Os palpites ficam salvos só neste celular.</p>
    </section>`);
  return parts.join('');
}

function homeAwayNote(st) {
  if (st.homeW > st.awayW + st.draws) return 'Os mandantes estão dominando a rodada.';
  if (st.awayW > st.homeW) return 'Rodada boa para quem joga fora de casa.';
  if (st.draws >= st.homeW && st.draws >= st.awayW) return 'Muitos empates nesta rodada.';
  return 'Vantagem para os mandantes, como de costume.';
}

function fact(label, ev) {
  return `<button type="button" class="fact" data-match="${esc(ev.id)}"><span class="tile-label">${esc(label)}</span>
    <span class="fact-score">${esc(ev.home.name)} <b>${ev.home.score} x ${ev.away.score}</b> ${esc(ev.away.name)}</span></button>`;
}

// ---------- telas de detalhe ----------

const STAT_DEFS = [
  ['possessionPct', 'Posse de bola', (v) => `${Math.round(v)}%`],
  ['totalShots', 'Finalizações'],
  ['shotsOnTarget', 'Chutes no gol'],
  ['wonCorners', 'Escanteios'],
  ['saves', 'Defesas do goleiro'],
  ['accuratePasses', 'Passes certos'],
  ['foulsCommitted', 'Faltas'],
  ['offsides', 'Impedimentos'],
  ['yellowCards', 'Cartões amarelos'],
  ['redCards', 'Cartões vermelhos'],
];

function statBars(home, away) {
  const rows = STAT_DEFS.filter(([k]) => Number.isFinite(home?.[k]) && Number.isFinite(away?.[k]) && home[k] + away[k] > 0);
  if (!rows.length) return '';
  return `<div class="sbars">${rows.map(([k, label, fmt = (v) => decimal(v)]) => {
    const h = home[k];
    const a = away[k];
    const lead = h > a ? 'h' : a > h ? 'a' : '';
    return `<div class="sbar">
      <div class="sbar-top"><b class="${lead === 'h' ? 'lead' : ''}">${fmt(h)}</b><span>${esc(label)}</span><b class="${lead === 'a' ? 'lead' : ''}">${fmt(a)}</b></div>
      <div class="sbar-track"><i class="h" style="flex:${h}"></i><i class="a" style="flex:${a}"></i></div>
    </div>`;
  }).join('')}</div>`;
}

const ICON = {
  goal: '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><circle cx="12" cy="12" r="9.5" fill="var(--surface)" stroke="currentColor" stroke-width="1.6"/><path d="M12 7.2l3.6 2.6-1.4 4.2H9.8L8.4 9.8z" fill="currentColor"/></svg>',
  yellow: '<i class="card-ico yellow"></i>',
  red: '<i class="card-ico red"></i>',
};

function timeline(ev) {
  if (!ev.incidents.length) return '';
  let shownBreak = false;
  const items = [];
  for (const i of ev.incidents) {
    if (!shownBreak && i.min.base > 45) { items.push('<li class="tl-break">Intervalo</li>'); shownBreak = true; }
    const side = i.team === ev.home.id ? 'home' : 'away';
    const name = esc(i.who || (i.kind === 'goal' ? 'Gol' : i.kind === 'red' ? 'Cartão vermelho' : 'Cartão amarelo'));
    const extra = i.kind === 'goal' ? `${i.pen ? ' <small>(pênalti)</small>' : ''}${i.og ? ' <small>(contra)</small>' : ''}` : '';
    items.push(`<li class="tl tl-${side} tl-${i.kind}"><span class="tl-min">${esc(i.min.label)}</span><span class="tl-ico">${ICON[i.kind]}</span><span class="tl-txt">${name}${extra}</span></li>`);
  }
  return `<ol class="timeline">${items.join('')}</ol>`;
}

function stepper(ev, side, value, enabled) {
  const label = side === 'h' ? ev.home.name : ev.away.name;
  return `<span class="stepper" role="group" aria-label="${esc(`Gols do ${label}`)}">
    <button type="button" data-action="pick" data-id="${esc(ev.id)}" data-side="${side}" data-delta="-1" aria-label="Menos um" ${enabled ? '' : 'disabled'}>−</button>
    <output>${value ?? '–'}</output>
    <button type="button" data-action="pick" data-id="${esc(ev.id)}" data-side="${side}" data-delta="1" aria-label="Mais um" ${enabled ? '' : 'disabled'}>+</button>
  </span>`;
}

function bolaoBlock(ev, pick) {
  if (canPick(ev)) {
    return `<section class="sheet-block">
      <h3 class="sub-title">Seu palpite</h3>
      <div class="pick-grid">
        <span class="pick-team">${esc(ev.home.name)}</span><span></span><span class="pick-team">${esc(ev.away.name)}</span>
        ${stepper(ev, 'h', pick?.h, true)}<span class="pick-x">x</span>${stepper(ev, 'a', pick?.a, true)}
      </div>
      <p class="chart-note">${pick ? `Palpite salvo: ${pick.h} x ${pick.a}. ` : 'Toque em + ou − para palpitar. '}Vale até o início do jogo.${pick ? ' <button type="button" class="link" data-action="unpick" data-id="' + esc(ev.id) + '">Apagar palpite</button>' : ''}</p>
    </section>`;
  }
  if (!pick) return '';
  const g = grade(pick, ev.home.score, ev.away.score);
  const live = ev.status.kind === 'live';
  const verdict = !g ? '' : live ? `Se terminar assim: ${g.label.toLowerCase()}, +${g.pts}` : `${g.label}! +${g.pts} ${g.pts === 1 ? 'ponto' : 'pontos'}`;
  return `<section class="sheet-block">
    <h3 class="sub-title">Seu palpite</h3>
    <p class="pick-result pick-${g?.kind || 'open'}"><b>${pick.h} x ${pick.a}</b> ${esc(verdict)}</p>
  </section>`;
}

function scenarioBlock(ev, sc) {
  if (!sc) return '';
  const rows = [
    ['home', `Se ${o(ev.home.name)} vencer`],
    ['draw', 'Se empatar'],
    ['away', `Se ${o(ev.away.name)} vencer`],
  ];
  return `<section class="sheet-block">
    <h3 class="sub-title">O que está em jogo <small>com os outros placares atuais</small></h3>
    <table class="scen">
      <thead><tr><th></th><th>${esc(ev.home.name)}</th><th>${esc(ev.away.name)}</th></tr></thead>
      <tbody>${rows.map(([k, label]) => `<tr><th>${esc(label)}</th><td>${ord(sc[k].home?.pos)}</td><td>${ord(sc[k].away?.pos)}</td></tr>`).join('')}</tbody>
    </table>
  </section>`;
}

/** Detalhe de um jogo. ctx: {table, scen, stats, pick, formById, favorite, story, now} */
export function matchSheet(ev, ctx) {
  const s = ev.status;
  const pre = s.kind === 'pre' || s.kind === 'off';
  const head = (t) => {
    const row = ctx.table?.byId.get(t.id);
    return `<button type="button" class="sh-team" data-team="${esc(t.id)}">
      ${crest(t.logo, t.name, 52)}
      <span class="sh-name">${esc(t.name)}${t.id === ctx.favorite ? star : ''}</span>
      <span class="sh-rank">${row ? `${ord(row.pos)} · ${row.pts} pts` : ''}</span>
    </button>`;
  };
  const statusText = s.kind === 'live' ? `<span class="live-text">${esc(s.label)} · ${esc(s.note)}</span>` : s.kind === 'post' ? 'Encerrado' : s.kind === 'pre' ? kickoff(ev.date, ctx.now) : esc(s.label);
  const tags = storyTags(ctx.story || {});
  const stats = ctx.stats ? statBars(ctx.stats[ev.home.id], ctx.stats[ev.away.id]) : '';
  const formRow = (t) => `<div class="sh-form"><span>${esc(t.name)}</span>${formDots(ctx.formById.get(t.id))}</div>`;
  return `
    <div class="sheet-head">
      ${head(ev.home)}
      <div class="sh-score">
        <span class="sh-digits">${pre ? 'x' : `${ev.home.score} <i>–</i> ${ev.away.score}`}</span>
        <span class="sh-status">${statusText}</span>
      </div>
      ${head(ev.away)}
    </div>
    <p class="sh-meta">${esc([`${weekdayShort(ev.date)} ${dm(ev.date)} · ${fmtTime.format(ev.date)}`, ev.venue].filter(Boolean).join(' · '))}</p>
    ${tags.length ? `<p class="tags center">${tags.map((t) => `<b class="tag tone-gol">${esc(t)}</b>`).join('')}</p>` : ''}
    ${bolaoBlock(ev, ctx.pick)}
    ${ev.incidents.length ? `<section class="sheet-block"><h3 class="sub-title">Lance a lance</h3>${timeline(ev)}</section>` : ''}
    ${stats ? `<section class="sheet-block"><h3 class="sub-title">Estatísticas</h3>${stats}</section>` : (!pre && ctx.statsLoading ? '<p class="chart-note center">Carregando estatísticas…</p>' : '')}
    ${scenarioBlock(ev, ctx.scen)}
    <section class="sheet-block">
      <h3 class="sub-title">Últimos 5 jogos</h3>
      ${formRow(ev.home)}${formRow(ev.away)}
    </section>`;
}

/** Detalhe de um time. */
export function teamSheet({ team, row, table, zones, form, upcoming, favorite }) {
  const isFav = team.id === favorite;
  const zone = row ? zones.byPos[row.pos] : null;
  const pct = row?.gp ? Math.round((row.pts / (row.gp * 3)) * 100) : 0;
  const dist = row ? distances(table, zones, team.id) : [];
  const games = [...form].reverse();
  return `
    <div class="team-head">
      ${crest(team.logo, team.name, 64)}
      <div>
        <h2 class="team-title">${esc(team.name)}</h2>
        <p class="team-pos">${row ? `${ord(row.pos)} lugar · ${row.pts} pontos` : ''}${row ? moveChip(row.delta) : ''}</p>
        ${zone ? `<p class="zone-chip" style="--zone:${esc(zone.color)}"><i></i>${esc(zone.name)}</p>` : ''}
      </div>
    </div>
    <button type="button" class="follow${isFav ? ' on' : ''}" data-action="follow" data-id="${esc(team.id)}">${star} ${isFav ? 'Seguindo · toque para deixar de seguir' : 'Seguir este time'}</button>
    ${row ? `
    <div class="mini-tiles">
      ${[['J', row.gp], ['V', row.w], ['E', row.d], ['D', row.l], ['SG', row.gd > 0 ? `+${row.gd}` : row.gd], ['%', pct]].map(([l, v]) => `<div><span>${l}</span><b>${v}</b></div>`).join('')}
    </div>` : ''}
    ${dist.length ? `<section class="sheet-block"><h3 class="sub-title">Distâncias${table.anyLive ? ' <small>com os placares atuais</small>' : ''}</h3>
      <dl class="dist">${dist.map((d) => `<div><dt>${esc(d.label)}</dt><dd>${esc(d.value)}</dd></div>`).join('')}</dl></section>` : ''}
    ${upcoming ? `<section class="sheet-block"><h3 class="sub-title">${upcoming.status.kind === 'live' ? 'Jogando agora' : 'Próximo jogo'}</h3>
      <button type="button" class="game-row" data-match="${esc(upcoming.id)}">
        <span class="gr-date">${upcoming.status.kind === 'live' ? `<span class="live-text">${esc(upcoming.status.label)}</span>` : esc(`${shortDay(upcoming.date)} ${fmtTime.format(upcoming.date)}`)}</span>
        ${gameOpp(upcoming, team.id)}
        <span class="gr-score">${upcoming.status.kind === 'live' ? `${upcoming.home.score} x ${upcoming.away.score}` : ''}</span>
      </button></section>` : ''}
    ${games.length ? `<section class="sheet-block"><h3 class="sub-title">Últimos jogos <small>${formPoints(form)} de ${form.length * 3} pontos</small></h3>
      ${games.map((g) => `<button type="button" class="game-row" data-match="${esc(g.ev.id)}">
        <span class="gr-date">${esc(dm(g.ev.date))}</span>${gameOpp(g.ev, team.id)}
        <span class="gr-score">${g.gf} x ${g.ga}</span><i class="f f-${g.res}">${g.res}</i>
      </button>`).join('')}
    </section>` : ''}`;
}

function gameOpp(ev, teamId) {
  const home = ev.home.id === teamId;
  const opp = home ? ev.away : ev.home;
  return `<span class="gr-opp"><small>${home ? 'em casa' : 'fora'}</small>${crest(opp.logo, opp.name, 20, 'mini')}${esc(opp.name)}</span>`;
}

export function teamPicker(standings, favorite) {
  const teams = [...standings].sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return `
    <h2 class="team-title">Qual é o seu time?</h2>
    <p class="chart-note">Ele ganha destaque nos jogos e na tabela, e você vê a situação dele no topo.</p>
    <div class="picker">${teams.map((t) => `
      <button type="button" class="${t.id === favorite ? 'on' : ''}" data-action="set-fav" data-id="${esc(t.id)}">${crest(t.logo, t.name, 36)}<span>${esc(t.name)}</span></button>`).join('')}
    </div>`;
}

/** Texto para compartilhar os placares da rodada. */
export function shareText(round, roundLabel, season, table) {
  const lines = [`Brasileirão ${season || ''} · ${roundLabel}`.replace('  ', ' ')];
  for (const ev of round.events) {
    const s = ev.status;
    if (s.kind === 'pre') lines.push(`${ev.home.name} x ${ev.away.name} (${weekdayShort(ev.date)} ${fmtTime.format(ev.date)})`);
    else if (s.kind === 'off') lines.push(`${ev.home.name} x ${ev.away.name} (${s.label.toLowerCase()})`);
    else lines.push(`${ev.home.name} ${ev.home.score} x ${ev.away.score} ${ev.away.name}${s.kind === 'live' ? ` (${s.label})` : ''}`);
  }
  if (table) lines.push('', `Líder: ${table.rows[0].name}, ${table.rows[0].pts} pts${table.anyLive ? ' (com os placares atuais)' : ''}`);
  return lines.join('\n');
}

