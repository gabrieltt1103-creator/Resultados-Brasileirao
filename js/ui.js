// Montagem do HTML de cada parte da tela. Funções puras: recebem dados, devolvem texto.
import { bucketLabels, flowNote, h2hSummary, storyTags } from './insights.js';
import { distances, formPoints } from './table.js';
import { decimal, dm, doo, esc, fmtTime, kickoff, o, plural, shortDay, weekdayShort } from './util.js';

const ord = (n) => (n ? `${n}º` : '');

const initials = (name) => (name || '?').replace(/[^\p{L}\p{N} ]/gu, '').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 3).toUpperCase() || '?';

// Logos da ESPN vêm em 500 px (30 a 70 KB); o redimensionador da própria ESPN entrega 64 ou 128 px (2 a 8 KB).
function smallLogo(url, size) {
  const m = /^https?:\/\/a\.espncdn\.com(\/i\/teamlogos\/[^?]+)$/.exec(url || '');
  return m ? `https://a.espncdn.com/combiner/i?img=${m[1]}&w=${size}&h=${size}` : url;
}

// Escudo do time. Se a imagem pequena falhar, o app tenta a original e depois mostra as iniciais (ver app.js).
export function crest(url, name, size = 26, cls = 'crest') {
  const style = `width:${size}px;height:${size}px;font-size:${Math.max(8, Math.round(size * 0.34))}px`;
  if (!url) return `<span class="crest-fallback" style="${style}" aria-hidden="true">${esc(initials(name))}</span>`;
  const small = smallLogo(url, size > 32 ? 128 : 64);
  const fallback = small !== url ? ` data-original="${esc(url)}"` : '';
  return `<img class="${cls}" style="${style}" src="${esc(small)}"${fallback} data-name="${esc(initials(name))}" alt="" loading="lazy" decoding="async">`;
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
export function scorers(goals) {
  const byPlayer = new Map();
  for (const g of goals) {
    const key = `${g.who}|${g.og ? 'og' : ''}`;
    if (!byPlayer.has(key)) byPlayer.set(key, { who: g.who || 'Gol', og: g.og, mins: [] });
    byPlayer.get(key).mins.push(`${g.min.label}${g.pen ? ' (pên.)' : ''}`);
  }
  return [...byPlayer.values()].map((p) => `${p.who}${p.og ? ' (contra)' : ''} ${p.mins.join(', ')}`.trim()).join(' · ');
}

/** Cartão de um jogo. ctx: {rank(id), delta(id), favorite, flash, story, note} */
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
      <div class="match-foot">${left}${ctx.note ? `<span class="foot-note">${esc(ctx.note)}</span>` : ev.moved ? `<span class="foot-note">${ev.status.kind === 'post' ? 'Jogo remarcado' : 'Remarcado'}</span>` : ''}</div>
    </article>`;
}

/** Linha de contagem da rodada: "10 jogos · 1 ao vivo · 7 encerrados · 2 a seguir · 17 gols". */
export function roundSummary({ total, counts, goals, loading }) {
  const parts = [`<b>${total}</b> jogos`];
  if (counts.live) parts.push(`<b class="live-count">${counts.live}</b> <span class="live-count">ao vivo</span>`);
  if (counts.post) parts.push(`<b>${counts.post}</b> ${counts.post === 1 ? 'encerrado' : 'encerrados'}`);
  if (counts.pre) parts.push(`<b>${counts.pre}</b> a seguir`);
  if (counts.off) parts.push(`<b>${counts.off}</b> ${counts.off === 1 ? 'adiado' : 'adiados'}`);
  if (counts.live || counts.post) parts.push(`<b>${goals}</b> ${goals === 1 ? 'gol' : 'gols'}`);
  if (loading) parts.push('<span class="muted">buscando o resto da temporada…</span>');
  return parts.join(' · ');
}

/** Jogos de hoje que são de outras rodadas. cards: HTML de cada jogo. */
export function otherGames(cards) {
  return `
    <section class="day">
      <h2 class="day-label">Hoje, de outras rodadas</h2>
      ${cards.join('')}
    </section>`;
}

/** Jogos da rodada por dia. days: [{label, moved, cards}] */
export function daySections(days) {
  return days.map((d) => `
    <section class="day">
      <h2 class="day-label">${esc(d.label)}${d.moved ? ' <small>jogo remarcado</small>' : ''}</h2>
      ${d.cards.join('')}
    </section>`).join('');
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

/** Linha de conferência abaixo da tabela: bate com a classificação oficial? */
export function tableCheck({ mode, check, adjust, teams, at }) {
  if (mode === 'espn') return '<p class="table-check">Classificação oficial da ESPN somada aos jogos da rodada (a temporada não carregou inteira para o app calcular sozinho).</p>';
  if (!check) return '';
  const fixes = [...(adjust || [])].filter(([id]) => teams.has(id));
  const time = at ? ` às ${fmtTime.format(at)}` : '';
  if (fixes.length) {
    const list = fixes.map(([id, pts]) => `${teams.get(id).name} ${pts > 0 ? '+' : '−'}${Math.abs(pts)}`).join(', ');
    return `<p class="table-check warn">Pontos ajustados pela classificação oficial da ESPN (punição ou correção): ${esc(list)}.</p>`;
  }
  if (!check.checked) return '';
  return `<p class="table-check ok"><b aria-hidden="true">✓</b> Confere com a classificação oficial da ESPN${esc(time)}${check.ahead ? ', que ainda não incluiu os últimos resultados' : ''}.</p>`;
}

/** Aba Números. */
// Compara com a média de gols do campeonato até aqui (sem ela, usa faixas fixas).
function avgNote(avg, season) {
  if (season == null) return avg >= 2.8 ? 'rodada movimentada' : avg < 2 ? 'rodada travada' : 'dentro do normal';
  const ref = `média do campeonato: ${decimal(season)}`;
  if (avg - season >= 0.3) return `acima da ${ref}`;
  if (season - avg >= 0.3) return `abaixo da ${ref}`;
  return `na ${ref}`;
}

export function statsView({ roundLabel, st, trends, selectedBar, seasonAvg = null }) {
  const parts = [];
  if (st.games) {
    const tiles = [
      ['Gols', st.goals, st.live ? `em ${plural(st.games, 'jogo', 'jogos')}, ${st.live} ao vivo` : `em ${plural(st.games, 'jogo', 'jogos')}`],
      ['Média por jogo', decimal(st.avg), avgNote(st.avg, seasonAvg)],
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

/**
 * Fluxo da partida: pressão de cada time minuto a minuto (mandante para cima, visitante para baixo),
 * com os gols e o intervalo; num jogo ao vivo, o que ainda não aconteceu fica apagado.
 */
export function flowChart(flow, ev, note = '') {
  const W = flow.slots * 4;
  const max = Math.max(1.6, ...flow.net.map(Math.abs));
  const bars = flow.net.map((v, i) => {
    const h = (Math.abs(v) / max) * 46;
    if (h < 0.6) return '';
    return `<rect class="${v > 0 ? 'h' : 'a'}" x="${i * 4 + 0.5}" y="${(v > 0 ? 50 - h : 50).toFixed(1)}" width="3" height="${h.toFixed(1)}" rx="0.8"/>`;
  }).join('');
  const at = (i) => `${((i / flow.slots) * 100).toFixed(2)}%`;
  const now = flow.now != null
    ? `<rect class="future" x="${flow.now * 4}" y="0" width="${W - flow.now * 4}" height="100"/><rect class="now" x="${flow.now * 4 - 0.75}" y="0" width="1.5" height="100"/>`
    : '';
  return `<div class="flow" role="img" aria-label="${esc(`Fluxo da partida. ${note}`)}">
    <div class="flow-teams" aria-hidden="true">${crest(ev.home.logo, ev.home.name, 18, 'mini')}${crest(ev.away.logo, ev.away.name, 18, 'mini')}</div>
    <div class="flow-plot">
      <svg viewBox="0 0 ${W} 100" preserveAspectRatio="none" aria-hidden="true"><rect class="mid" x="0" y="49.6" width="${W}" height="0.8"/>${bars}<rect class="ht" x="${flow.half * 4 - 0.75}" y="0" width="1.5" height="100"/>${now}</svg>
      ${flow.goals.map((g) => `<i class="flow-goal ${g.side === 'home' ? 'h' : 'a'}" style="left:${at(g.i + 0.5)}"></i>`).join('')}
    </div>
    <div class="flow-axis" aria-hidden="true"><span>0'</span><span style="left:${at(flow.half)}">intervalo</span><span>${esc(flow.label(flow.slots - 1))}</span></div>
  </div>`;
}

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

function stepper(ev, side, value) {
  const label = side === 'h' ? ev.home.name : ev.away.name;
  return `<span class="stepper" role="group" aria-label="${esc(`Gols ${label}`)}">
    <button type="button" data-action="sim-step" data-id="${esc(ev.id)}" data-side="${side}" data-delta="-1" aria-label="${esc(`Menos um gol para ${label}`)}">−</button>
    <output>${value ?? '–'}</output>
    <button type="button" data-action="sim-step" data-id="${esc(ev.id)}" data-side="${side}" data-delta="1" aria-label="${esc(`Mais um gol para ${label}`)}">+</button>
  </span>`;
}

function oddsBlock(ev, mp) {
  if (!mp) return '';
  const { home, draw, away } = mp.odds;
  const seg = (cls, p) => (p >= 0.005 ? `<span class="seg ${cls}" style="flex:${p.toFixed(3)}"></span>` : '');
  const s = mp.picks[mp.suggest];
  return `<section class="sheet-block">
    <h3 class="sub-title">Chances pelo modelo do app${ev.status.kind === 'live' ? ' <small>a partir do placar atual</small>' : ''}</h3>
    <div class="stack" role="img" aria-label="${esc(`${ev.home.name} ${pctShort(home)}, empate ${pctShort(draw)}, ${ev.away.name} ${pctShort(away)}`)}">${seg('home', home)}${seg('draw', draw)}${seg('away', away)}</div>
    <ul class="chart-legend">
      <li><i class="sw home"></i>${esc(ev.home.name)} <b>${pctShort(home)}</b></li>
      <li><i class="sw draw"></i>Empate <b>${pctShort(draw)}</b></li>
      <li><i class="sw away"></i>${esc(ev.away.name)} <b>${pctShort(away)}</b></li>
    </ul>
    ${s ? `<p class="chart-note">Placar sugerido: <b>${esc(ev.home.name)} ${s.h} x ${s.a} ${esc(ev.away.name)}</b></p>` : ''}
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

// Data curta de jogo antigo: "18/04/26".
const dmy = (d) => `${dm(d)}/${String(d.getFullYear()).slice(2)}`;

/** Últimos confrontos entre os dois times, de qualquer competição. */
function h2hBlock(ev, games) {
  const sum = h2hSummary(games, ev.home, ev.away);
  if (!sum) return '';
  const name = (t) => (t.id === ev.home.id ? ev.home.name : t.id === ev.away.id ? ev.away.name : t.name);
  const rows = games.map((g) => {
    const hw = g.home.score > g.away.score;
    const aw = g.away.score > g.home.score;
    return `<div class="h2h-row"><span class="h2h-when">${esc(dmy(g.date))}<small>${esc(g.competition)}</small></span>
      <span class="h2h-game"><span class="h${hw ? ' w' : ''}">${esc(name(g.home))}</span><b>${g.home.score} x ${g.away.score}</b><span class="a${aw ? ' w' : ''}">${esc(name(g.away))}</span>
      ${g.pens ? `<small>${esc(name(g[g.pens]))} venceu nos pênaltis</small>` : ''}</span></div>`;
  }).join('');
  return `<section class="sheet-block"><h3 class="sub-title">Últimos confrontos</h3>${rows}<p class="chart-note">${esc(sum.note)}</p></section>`;
}

function flowBlock(ev, flow) {
  const note = flowNote(flow, ev.home, ev.away, ev.status.kind === 'live');
  return `<section class="sheet-block">
    <h3 class="sub-title">Fluxo da partida <small>chutes, escanteios e faltas perto da área</small></h3>
    ${flowChart(flow, ev, note)}
    ${note ? `<p class="chart-note">${esc(note)}</p>` : ''}
  </section>`;
}

/** Detalhe de um jogo. ctx: {table, scen, stats, formById, favorite, story, roundLabel, picks, now} */
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
    <p class="sh-meta">${esc([ctx.roundLabel, `${weekdayShort(ev.date)} ${dm(ev.date)} · ${fmtTime.format(ev.date)}`, ev.venue].filter(Boolean).join(' · '))}${ev.moved ? ' · <b>jogo remarcado</b>' : ''}</p>
    ${tags.length ? `<p class="tags center">${tags.map((t) => `<b class="tag tone-gol">${esc(t)}</b>`).join('')}</p>` : ''}
    ${ev.incidents.length ? `<section class="sheet-block"><h3 class="sub-title">Lance a lance</h3>${timeline(ev)}</section>` : ''}
    ${ctx.flow ? flowBlock(ev, ctx.flow) : ''}
    ${stats ? `<section class="sheet-block"><h3 class="sub-title">Estatísticas</h3>${stats}</section>` : (!pre && ctx.statsLoading ? '<p class="chart-note center">Carregando estatísticas…</p>' : '')}
    ${oddsBlock(ev, ctx.picks)}
    ${scenarioBlock(ev, ctx.scen)}
    ${s.kind !== 'post' ? `<button type="button" class="wide-btn" data-action="simulate" data-id="${esc(ev.id)}">Simular este jogo e ver a tabela</button>` : ''}
    <section class="sheet-block">
      <h3 class="sub-title">Últimos 5 jogos</h3>
      ${formRow(ev.home)}${formRow(ev.away)}
    </section>
    ${ctx.h2h?.length ? h2hBlock(ev, ctx.h2h) : ''}`;
}

/** Detalhe de um time. */
export function teamSheet({ team, row, table, zones, form, upcoming = [], favorite, odds, rankOf = () => null, roundOf = () => null }) {
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
    ${odds ? `<section class="sheet-block"><h3 class="sub-title">Chances até o fim <small>simulação do restante do campeonato</small></h3>
      <div class="odds">${oddsTiles(odds, zones)}</div></section>` : ''}
    ${dist.length ? `<section class="sheet-block"><h3 class="sub-title">Distâncias${table.anyLive ? ' <small>com os placares atuais</small>' : ''}</h3>
      <dl class="dist">${dist.map((d) => `<div><dt>${esc(d.label)}</dt><dd>${esc(d.value)}</dd></div>`).join('')}</dl></section>` : ''}
    ${upcoming.length ? `<section class="sheet-block"><h3 class="sub-title">Próximos jogos${nextSummary(upcoming, team.id, rankOf)}</h3>
      ${upcoming.map((e) => nextRow(e, team.id, rankOf, roundOf(e))).join('')}
    </section>` : ''}
    ${games.length ? `<section class="sheet-block"><h3 class="sub-title">Últimos jogos <small>${formPoints(form)} de ${form.length * 3} pontos</small></h3>
      ${games.map((g) => `<button type="button" class="game-row" data-match="${esc(g.ev.id)}">
        <span class="gr-date">${esc(dm(g.ev.date))}</span>${gameOpp(g.ev, team.id)}
        <span class="gr-score">${g.gf} x ${g.ga}</span><i class="f f-${g.res}">${g.res}</i>
      </button>`).join('')}
    </section>` : ''}`;
}

// "média dos adversários: 9º · 3 em casa"
function nextSummary(games, teamId, rankOf) {
  const ranks = games.map((e) => rankOf(e.home.id === teamId ? e.away.id : e.home.id)).filter(Boolean);
  const home = games.filter((e) => e.home.id === teamId).length;
  const parts = [];
  if (ranks.length) parts.push(`adversários em média ${Math.round(ranks.reduce((a, b) => a + b, 0) / ranks.length)}º`);
  parts.push(`${home} em casa`);
  return ` <small>${esc(parts.join(' · '))}</small>`;
}

function nextRow(e, teamId, rankOf, round) {
  const opp = e.home.id === teamId ? e.away : e.home;
  const rank = rankOf(opp.id);
  let when;
  if (e.status.kind === 'live') when = `<span class="live-text">${esc(e.status.label)}</span><small>ao vivo</small>`;
  else if (e.status.kind === 'off') when = `${esc(e.status.label)}<small>sem nova data</small>`;
  else when = `${esc(shortDay(e.date))}<small>${esc(fmtTime.format(e.date))}${round?.number ? ` · R${round.number}` : ''}</small>`;
  return `<button type="button" class="game-row next-row" data-match="${esc(e.id)}">
    <span class="gr-date">${when}</span>
    ${gameOpp(e, teamId)}
    <span class="gr-score">${e.status.kind === 'live' ? `${e.home.score} x ${e.away.score}` : rank ? `<span class="gr-rank">${rank}º</span>` : ''}</span>
  </button>`;
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


// ---------- simulador ----------

export function pct(p) {
  if (p == null) return '–';
  if (p <= 0) return '0%';
  if (p < 0.005) return '<1%';
  if (p >= 1) return '100%';
  if (p > 0.995) return '>99%';
  return `${Math.round(p * 100)}%`;
}

function oddsTiles(o, zones) {
  const tiles = [['Título', o.title]];
  if (zones.g) tiles.push([zones.gLabel, o.g]);
  if (zones.zStart) tiles.push([`Cair (${zones.zLabel})`, o.z]);
  tiles.push(['Pontos no fim', null, Math.round(o.pts)]);
  return tiles.map(([l, p, v]) => `<div><span>${esc(l)}</span><b>${v ?? pct(p)}</b></div>`).join('');
}

// Nome curto para os botões: a sigla da ESPN ou o próprio nome, se já for curto.
const short = (t) => (t.name.length <= 9 ? t.name : t.abbr || t.name);

const pctShort = (p) => (p < 0.01 ? '<1%' : `${Math.round(p * 100)}%`);

function simCard(ev, sim, mp) {
  const s = ev.status;
  const final = s.kind === 'post';
  let status;
  if (final) status = 'FIM';
  else if (s.kind === 'live') status = `${esc(s.label)}<span class="pulse" aria-hidden="true"></span>`;
  else if (s.kind === 'off') status = `<small>${esc(s.label)}</small>`;
  else status = `${esc(weekdayShort(ev.date))}<small>${esc(fmtTime.format(ev.date))}</small>`;
  const value = (side) => (sim ? sim[side] : s.kind === 'live' ? (side === 'h' ? ev.home.score : ev.away.score) : null);
  const row = (t, side) => `
    <div class="sim-row">
      ${crest(t.logo, t.name, 24)}<span class="nm">${esc(t.name)}</span>
      ${final ? `<b class="score">${side === 'h' ? ev.home.score : ev.away.score}</b>` : stepper(ev, side, value(side))}
    </div>`;
  const outcome = sim ? Math.sign(sim.h - sim.a) : null;
  // Cada botão mostra a chance do resultado e aplica o placar mais provável dele.
  const btn = (k, label, aria, fallback) => {
    const pick = mp?.picks[k] || fallback;
    const p = mp ? (k === 1 ? mp.odds.home : k === 0 ? mp.odds.draw : mp.odds.away) : null;
    return `<button type="button" data-action="sim-set" data-id="${esc(ev.id)}" data-h="${pick.h}" data-a="${pick.a}" aria-pressed="${outcome === k}"
      aria-label="${esc(`${aria}${p != null ? `, chance de ${pctShort(p)}` : ''}`)}"><span>${esc(label)}</span>${p != null ? `<small>${pctShort(p)}</small>` : ''}</button>`;
  };
  const quick = final ? '' : `
    <div class="sim-quick" role="group" aria-label="Resultado rápido">
      ${btn(1, short(ev.home), `Vitória ${doo(ev.home.name)}`, { h: 1, a: 0 })}
      ${btn(0, 'Empate', 'Empate', { h: 1, a: 1 })}
      ${btn(-1, short(ev.away), `Vitória ${doo(ev.away.name)}`, { h: 0, a: 1 })}
      ${sim ? `<button type="button" class="undo" data-action="sim-reset" data-id="${esc(ev.id)}" aria-label="Desfazer a simulação deste jogo" title="Desfazer"><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M6 6l12 12M18 6L6 18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg></button>` : ''}
    </div>`;
  return `
    <article class="sim-card is-${s.kind}${sim ? ' is-sim' : ''}" id="sim-${esc(ev.id)}">
      <div class="status">${status}${sim ? '<b class="sim-flag">simulado</b>' : ''}</div>
      <div class="sim-body">${row(ev.home, 'h')}${row(ev.away, 'a')}${quick}</div>
    </article>`;
}

export function miniTable(sim, real, zones, favorite) {
  return `<table class="mini-table">
    <thead><tr><th>#</th><th></th><th class="club">Clube</th><th>P</th><th>J</th><th>SG</th></tr></thead>
    <tbody>${sim.rows.map((t) => {
      const before = real.byId.get(t.id);
      const delta = before ? before.pos - t.pos : 0;
      const dp = before ? t.pts - before.pts : 0;
      const zone = zones.byPos[t.pos];
      const cls = [delta || dp ? 'changed' : '', t.id === favorite ? 'is-fav' : ''].filter(Boolean).join(' ');
      return `<tr data-team="${esc(t.id)}"${cls ? ` class="${cls}"` : ''}>
        <td class="pos"${zone ? ` style="--zone:${esc(zone.color)}"` : ''}>${t.pos}</td>
        <td class="mv">${moveChip(delta)}</td>
        <td class="club"><span class="club-cell">${crest(t.logo, t.name, 18, 'mini')}<span class="club-name">${esc(t.name)}</span></span></td>
        <td class="pts">${t.pts}${dp ? `<small class="${dp > 0 ? 'up-text' : 'down-text'}">${dp > 0 ? '+' : '−'}${Math.abs(dp)}</small>` : ''}</td><td>${t.gp}</td><td>${t.gd > 0 ? `+${t.gd}` : t.gd}</td>
      </tr>`;
    }).join('')}</tbody></table>`;
}

function oddsTable(sim, odds, base, zones, favorite) {
  const cols = [['title', 'Título']];
  if (zones.g) cols.push(['g', zones.gLabel]);
  if (zones.zStart) cols.push(['z', zones.zLabel]);
  const cell = (key, o, b) => {
    const p = o[key];
    const diff = b ? Math.round((p - b[key]) * 100) : 0;
    return `<td class="odd odd-${key}" style="--f:${p.toFixed(3)}"><span>${pct(p)}</span>${diff ? `<small class="${diff > 0 ? 'up-text' : 'down-text'}">${diff > 0 ? '+' : ''}${diff}</small>` : ''}</td>`;
  };
  return `<div class="table-wrap"><table class="odds-table">
    <thead><tr><th class="club">Clube</th>${cols.map(([, l]) => `<th>${esc(l)}</th>`).join('')}<th title="Pontos esperados no fim">Pts</th></tr></thead>
    <tbody>${sim.rows.map((t) => {
      const o = odds.byId.get(t.id);
      if (!o) return '';
      const b = base?.byId.get(t.id);
      return `<tr data-team="${esc(t.id)}"${t.id === favorite ? ' class="is-fav"' : ''}>
        <td class="club"><span class="club-cell"><span class="pos-n">${t.pos}</span>${crest(t.logo, t.name, 18, 'mini')}<span class="club-name">${esc(t.name)}</span></span></td>
        ${cols.map(([k]) => cell(k, o, b)).join('')}
        <td class="pts">${Math.round(o.pts)}</td>
      </tr>`;
    }).join('')}</tbody></table></div>`;
}

// Jogos encerrados não se simulam: uma linha cada, recolhidos.
function doneList(events, open) {
  if (!events.length) return '';
  return `<details class="sim-done" data-keep="sim-done"${open ? ' open' : ''}>
    <summary>${plural(events.length, 'jogo encerrado', 'jogos encerrados')} <small>entram com o resultado real</small></summary>
    <ul>${events.map((e) => `<li data-match="${esc(e.id)}" role="button" tabindex="0">
      <span class="sd-team">${esc(e.home.name)}</span><b>${e.home.score} x ${e.away.score}</b><span class="sd-team">${esc(e.away.name)}</span></li>`).join('')}
    </ul>
  </details>`;
}

const HOW = `<details class="how" data-keep="how-odds"%OPEN%>
  <summary>Como calculamos</summary>
  <p>Cada time tem uma força de ataque e uma de defesa, medidas pelos gols marcados e sofridos. A fase recente pesa mais: os últimos 5 jogos contam 40%, os últimos 10 contam 35% e o campeonato inteiro, 25%. Quem joga em casa ganha a vantagem que os mandantes têm tido neste Brasileirão.</p>
  <p>Com essas forças, o app sorteia o placar de cada jogo que falta, refaz o campeonato 3.000 vezes e conta em quantas cada time termina campeão, no %G% ou no %Z%.</p>
</details>`;

/**
 * Aba Simular.
 * real: tabela atual (sem simulações); sim: tabela com as simulações; odds/oddsBase: chances com e sem simulações.
 * open: blocos recolhíveis que o usuário deixou abertos.
 */
export function simView({ round, roundLabel, sims, real, sim, zones, impact, odds, oddsBase, oddsNote, favorite, finished, picksOf = () => null, open = {} }) {
  const count = round.events.filter((e) => sims[e.id]).length;
  const total = Object.keys(sims).length;
  const head = `
    <section class="block sim-head">
      <h2 class="section-title">Simulador · ${esc(roundLabel)}</h2>
      <p class="chart-note">Escolha os placares dos jogos que faltam e veja como a tabela e as chances mudam. Os botões mostram a chance de cada resultado. Fica salvo neste celular.</p>
      <div class="sim-actions">
        ${finished ? '' : '<button type="button" class="chip-btn" data-action="sim-suggest">Sugerir placares</button>'}
        <button type="button" class="chip-btn" data-action="sim-clear"${total ? '' : ' disabled'}>Limpar${total ? ` (${total})` : ''}</button>
      </div>
      ${total > count ? `<p class="chart-note">${plural(total - count, 'jogo simulado', 'jogos simulados')} em outras rodadas também ${total - count === 1 ? 'entra' : 'entram'} na conta.</p>` : ''}
    </section>`;
  const games = finished
    ? `<p class="empty">Esta rodada já terminou. Use as setas no topo para ir a uma rodada que ainda vai acontecer.</p>`
    : `<div class="sim-list">${round.events.filter((e) => e.status.kind !== 'post').map((e) => simCard(e, sims[e.id], picksOf(e))).join('')}</div>
      ${doneList(round.events.filter((e) => e.status.kind === 'post'), open['sim-done'])}`;
  const impactHtml = sim && real ? `
    <section class="block">
      <h2 class="section-title">${total ? 'Com esses placares' : 'Tabela agora'}</h2>
      ${impact.length ? `<ul class="impact">${impact.map((n) => `<li><b class="tag tone-${n.tone}">${esc(n.tag)}</b><span>${esc(n.text)}</span></li>`).join('')}</ul>` : ''}
      <div class="table-wrap">${miniTable(sim, real, zones, favorite)}</div>
    </section>` : '';
  const how = HOW.replace('%OPEN%', open['how-odds'] ? ' open' : '').replace('%G%', esc(zones.gLabel || 'G6')).replace('%Z%', esc(zones.zLabel || 'Z4'));
  const oddsHtml = `
    <section class="block">
      <h2 class="section-title">Chances até o fim</h2>
      ${odds ? oddsTable(sim || real, odds, total ? oddsBase : null, zones, favorite) : ''}
      <p class="chart-note">${esc(oddsNote)}</p>
      ${odds ? how : ''}
    </section>`;
  return head + games + impactHtml + oddsHtml;
}

// ---------- status dos dados ----------
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const hhmm = (t) => (t ? fmtTime.format(new Date(t)) : '');

export function diagSheet(d) {
  const row = (ok, label, text) => `<li class="diag-${ok === null ? 'wait' : ok ? 'ok' : 'bad'}"><b>${ok === null ? '…' : ok ? '✓' : '!'}</b><span><strong>${esc(label)}</strong><small>${esc(text)}</small></span></li>`;
  const s = d.season;
  const months = (list) => list.map((m) => MONTHS[m - 1]).join(', ');
  let seasonText = 'ainda não carregou';
  if (s?.error) seasonText = `falhou às ${hhmm(s.t)}: ${s.error}`;
  else if (s && (s.count || !s.full)) {
    const what = s.full ? 'temporada inteira' : `só os meses que ainda mudam (${months(s.months)})`;
    seasonText = `${what}: ${s.count} jogos às ${hhmm(s.t)}${s.failed.length ? `; meses que falharam: ${months(s.failed)}` : ''}`;
  } else if (s) seasonText = `nenhum jogo veio na busca${s.fallback != null ? `; usando a rodada atual (${s.fallback} jogos)` : ''}`;
  const st = d.standings;
  const r = d.refresh;
  const refreshText = !r ? 'aguardando'
    : r.ok ? `ok às ${hhmm(r.t)}${r.errors?.length ? ` (${r.errors.length} de ${r.days} dias falharam: ${r.errors[0]})` : ''}`
      : `falhou às ${hhmm(r.t)}: ${r.error}`;
  const c = d.check;
  const fixes = [...(d.adjust || [])];
  const checkText = d.mode !== 'jogos' ? 'só com a tabela calculada pelos jogos'
    : !c ? 'aguardando a classificação oficial'
      : fixes.length ? `pontos ajustados em ${fixes.length} ${fixes.length === 1 ? 'time' : 'times'} (${fixes.map(([id, p]) => `${d.names.get(id) || id} ${p > 0 ? '+' : ''}${p}`).join(', ')})`
        : `${c.checked} times conferidos, pontos iguais${c.ahead ? `; ${c.ahead} com jogo que a ESPN ainda não contou` : ''}`;
  const items = [
    row(s ? !s.error && (s.count > 0 || !s.full) && !s.failed.length : null, 'Jogos da temporada', seasonText),
    row(st ? st.ok : null, 'Classificação oficial da ESPN', !st ? 'ainda não carregou' : st.ok ? `${st.count} times às ${hhmm(st.t)}` : `falhou às ${hhmm(st.t)}: ${st.error}`),
    row(d.mode ? true : d.season ? false : null, 'Tabela do app', d.mode === 'jogos' ? 'calculada a partir de todos os jogos (ao vivo e exata)' : d.mode === 'espn' ? 'classificação da ESPN corrigida com os jogos da rodada (faltam jogos da temporada para calcular sozinho)' : 'indisponível'),
    row(d.mode === 'jogos' && c ? !fixes.length : null, 'Conferência com a classificação oficial', checkText),
    row(d.rounds ? d.roundsMethod === 'espelho' : null, 'Rodadas', !d.rounds ? 'ainda não montadas'
      : d.roundsMethod === 'espelho' ? `${d.rounds} montadas pelo espelho turno/returno, com os jogos remarcados na rodada certa; atual: ${d.focus}`
        : `${d.rounds} montadas pelas datas (${d.roundsWhy}); jogos remarcados podem ficar fora da rodada; atual: ${d.focus}`),
    row(d.mode === 'jogos' ? d.odds || null : false, 'Chances até o fim', d.mode !== 'jogos' ? 'precisa de todos os jogos da temporada' : d.odds ? 'calculadas' : 'calculando'),
    row(d.summary ? d.summary.ok : null, 'Estatísticas do jogo', !d.summary ? 'abra um jogo encerrado ou ao vivo para testar' : d.summary.ok ? `ok às ${hhmm(d.summary.t)}` : `falhou: ${d.summary.error}`),
    row(r ? r.ok && !r.errors?.length : null, 'Placar ao vivo (dia a dia)', refreshText),
  ];
  if (d.cache) items.push(row(true, 'Dados salvos no celular', `${d.cache.count} jogos salvos às ${hhmm(d.cache.t)}`));
  return `
    <h2 class="team-title">Status dos dados</h2>
    <p class="chart-note">Se alguma parte do app não aparecer, tire um print desta tela: ela mostra o que carregou e o que falhou.</p>
    <ul class="diag">${items.join('')}</ul>
    ${d.errors.length ? `<section class="sheet-block"><h3 class="sub-title">Erros na tela</h3><ul class="diag-errors">${d.errors.map((e) => `<li><b>${esc(e.part)}</b> ${esc(e.error)}</li>`).join('')}</ul></section>` : ''}
    <p class="chart-note diag-ua">${esc(d.ua)}${d.modal ? '' : ' · janela de detalhes em modo compatível'}</p>`;
}
