// Temporada falsa no formato da API da ESPN, relativa a um instante "agora" (domingo da rodada 30).
// - rodadas 1 a 29 encerradas (com um jogo da rodada 28 remarcado para a quarta seguinte
//   e um da rodada 29 adiado sem data);
// - rodada 30 em andamento: encerrados, ao vivo, intervalo, um mais tarde e um remarcado para quarta;
// - rodadas 31 a 38 por jogar.
export const TEAMS = [
  ['819', 'Flamengo'], ['2029', 'Palmeiras'], ['6154', 'Botafogo'], ['3445', 'Fluminense'], ['2026', 'São Paulo'],
  ['874', 'Corinthians'], ['6086', 'Grêmio'], ['1936', 'Internacional'], ['7632', 'Atlético-MG'], ['2674', 'Cruzeiro'],
  ['3454', 'Vasco da Gama'], ['6273', 'Bahia'], ['9967', 'Fortaleza'], ['2028', 'Santos'], ['18240', 'Bragantino'],
  ['3458', 'Vitória'], ['4936', 'Juventude'], ['9169', 'Mirassol'], ['6085', 'Sport'], ['3456', 'Chapecoense'],
];
const ids = TEAMS.map((t) => t[0]);
const nameOf = (id) => TEAMS.find((t) => t[0] === id)[1];
const H = 3600e3;
const iso = (t) => new Date(t).toISOString().replace(/:\d\d\.\d+Z$/, 'Z');

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const TYPES = {
  pre: { name: 'STATUS_SCHEDULED', state: 'pre', completed: false, shortDetail: '' },
  live: { name: 'STATUS_SECOND_HALF', state: 'in', completed: false, shortDetail: '' },
  ht: { name: 'STATUS_HALFTIME', state: 'in', completed: false, shortDetail: 'HT' },
  post: { name: 'STATUS_FULL_TIME', state: 'post', completed: true, shortDetail: 'FT' },
  adiado: { name: 'STATUS_POSTPONED', state: 'post', completed: false, shortDetail: 'Postponed' },
};

export const goal = (team, min, who, extra = {}) => ({ type: { text: 'Goal' }, clock: { displayValue: min }, team: { id: team }, scoringPlay: true, athletesInvolved: [{ displayName: who, shortName: who }], ...extra });
export const card = (team, min, who, red = false) => ({ type: { text: red ? 'Red Card' : 'Yellow Card' }, clock: { displayValue: min }, team: { id: team }, scoringPlay: false, yellowCard: !red, redCard: red, athletesInvolved: [{ displayName: who, shortName: who }] });

const stats = (seed) => [
  { name: 'possessionPct', displayValue: String(40 + (seed % 21)) },
  { name: 'totalShots', displayValue: String(6 + (seed % 9)) },
  { name: 'shotsOnTarget', displayValue: String(2 + (seed % 5)) },
  { name: 'wonCorners', displayValue: String(seed % 8) },
  { name: 'foulsCommitted', displayValue: String(9 + (seed % 7)) },
];

let seq;
export function ev(t, h, a, st, hs = 0, as = 0, details = [], clock = '') {
  const status = { displayClock: clock, type: TYPES[st] };
  const started = st === 'post' || st === 'live' || st === 'ht';
  const comp = (id, homeAway, score) => ({
    id, homeAway, score: String(score), winner: st === 'post' && (homeAway === 'home' ? hs > as : as > hs),
    statistics: started ? stats(Number(id) + (homeAway === 'home' ? 3 : 0)) : [],
    team: { id, shortDisplayName: nameOf(id), displayName: nameOf(id), abbreviation: nameOf(id).slice(0, 3).toUpperCase(), color: homeAway === 'home' ? 'c8102e' : '0b6b3a', alternateColor: 'ffffff', logo: `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png` },
  });
  return {
    id: String(seq++), date: iso(t), season: { year: 2026 }, status,
    competitions: [{ date: iso(t), status, venue: { fullName: `Estádio do ${nameOf(h)}`, address: { city: 'Brasil' } },
      competitors: [comp(h, 'home', hs), comp(a, 'away', as)], details }],
  };
}

// Tabela de jogos em turno e returno (método do círculo).
function schedule() {
  const rounds = [];
  const rot = ids.slice(1);
  for (let r = 0; r < 19; r++) {
    const arr = [ids[0], ...rot];
    const games = [];
    for (let i = 0; i < 10; i++) {
      const x = arr[i];
      const y = arr[19 - i];
      games.push((r + i) % 2 ? [x, y] : [y, x]);
    }
    rounds.push(games);
    rot.unshift(rot.pop());
  }
  return [...rounds, ...rounds.map((g) => g.map(([x, y]) => [y, x]))];
}

const PLAYERS = ['Pedro', 'Lucas', 'Gabriel', 'Matheus', 'Vitor', 'Rafael', 'Bruno', 'Thiago'];

export function season(now) {
  seq = 700000;
  const rand = rng(2026);
  const goalsFor = (strength) => { const x = rand() + strength; return x < 0.35 ? 0 : x < 0.75 ? 1 : x < 1.0 ? 2 : x < 1.15 ? 3 : 4; };
  const sunday = new Date(now);
  sunday.setHours(0, 0, 0, 0);
  const at = (round, day, hh, mm = 0) => { const d = new Date(sunday); d.setDate(d.getDate() - (30 - round) * 7 + day); d.setHours(hh, mm, 0, 0); return d.getTime(); };
  const slots = [[-1, 16], [-1, 18, 30], [-1, 18, 30], [-1, 21], [0, 11], [0, 16], [0, 16], [0, 18, 30], [0, 18, 30], [0, 20, 30]];
  const strength = (id) => (20 - ids.indexOf(id)) / 60; // os primeiros da lista são mais fortes
  const events = [];
  schedule().forEach((games, r) => {
    const round = r + 1;
    games.forEach(([h, a], i) => {
      const [day, hh, mm] = slots[i];
      let t = at(round, day, hh, mm);
      if (round < 30) {
        const hs = goalsFor(strength(h) + 0.1);
        const as = goalsFor(strength(a));
        const details = [];
        for (let k = 0; k < hs; k++) details.push(goal(h, `${5 + Math.floor(rand() * 85)}'`, PLAYERS[Math.floor(rand() * 8)]));
        for (let k = 0; k < as; k++) details.push(goal(a, `${5 + Math.floor(rand() * 85)}'`, PLAYERS[Math.floor(rand() * 8)]));
        if (round === 28 && i === 9) t = at(30, -4, 19, 30); // remarcado: jogado na quarta antes da rodada 30
        if (round === 29 && i === 8) { events.push(ev(t, h, a, 'adiado')); return; }
        events.push(ev(t, h, a, 'post', hs, as, details));
      } else if (round > 30) {
        if (round === 33 && i === 0) t = at(31, 3, 21, 30); // antecipado: quarta depois da rodada 31
        events.push(ev(t, h, a, 'pre'));
      }
    });
  });

  // Rodada 30 (atual), com histórias conhecidas.
  const c = schedule()[29];
  const t0 = now - 70 * 60e3;
  const yesterday = (hh, mm = 0) => at(30, -1, hh, mm);
  events.push(ev(yesterday(16), c[0][0], c[0][1], 'post', 2, 1, [goal(c[0][0], "12'", 'Pedro'), goal(c[0][1], "40'", 'Vitor Roque'), card(c[0][1], "55'", 'Gómez'), goal(c[0][0], "88'", 'Arrascaeta', { penaltyKick: true })]));
  events.push(ev(yesterday(18, 30), c[1][0], c[1][1], 'post', 0, 0, [card(c[1][1], "77'", 'Lucas', true)]));
  events.push(ev(yesterday(18, 30), c[2][0], c[2][1], 'post', 1, 3, [goal(c[2][0], "5'", 'Savarino'), goal(c[2][1], "33'", 'Reinaldo'), goal(c[2][1], "60'", 'Reinaldo'), goal(c[2][1], "71'", 'Reinaldo')]));
  events.push(ev(yesterday(21), c[3][0], c[3][1], 'post', 1, 0, [goal(c[3][0], "90'+3'", 'Cano')]));
  events.push(ev(t0, c[4][0], c[4][1], 'live', 1, 1, [goal(c[4][0], "22'", 'Calleri'), goal(c[4][1], "58'", 'Gilberto', { ownGoal: true })], "67'"));
  events.push(ev(t0, c[5][0], c[5][1], 'live', 0, 2, [goal(c[5][1], "31'", 'Sasha'), goal(c[5][1], "49'", 'Sasha')], "67'"));
  events.push(ev(t0 + 20 * 60e3, c[6][0], c[6][1], 'live', 1, 0, [goal(c[6][0], "45'+2'", 'Braithwaite')], "45'+2'"));
  events.push(ev(t0 + 25 * 60e3, c[7][0], c[7][1], 'ht', 0, 0, [], "45'"));
  events.push(ev(now + 2 * H, c[8][0], c[8][1], 'pre'));
  events.push(ev(at(30, 3, 19, 30), c[9][0], c[9][1], 'pre')); // remarcado para quarta
  return { leagues: [{ season: { year: 2026 } }], events };
}

// Filtra a temporada como a ESPN faz com ?dates=: ano (2026), mês (202610) ou dia (20261011), em dias locais.
// Intervalos (20261001-20261031) não são aceitos pela ESPN no Brasileirão: devolve null (erro 400).
export function byDates(all, dates) {
  if (!dates) {
    const now = Date.now();
    return { ...all, events: all.events.filter((e) => Math.abs(new Date(e.date) - now) < 4 * 24 * H) };
  }
  if (!/^\d{4}(\d{2}(\d{2})?)?$/.test(dates)) return null;
  const y = Number(dates.slice(0, 4));
  const m = dates.length >= 6 ? Number(dates.slice(4, 6)) - 1 : null;
  const d = dates.length === 8 ? Number(dates.slice(6, 8)) : null;
  const from = new Date(y, m ?? 0, d ?? 1).getTime();
  const to = d != null ? new Date(y, m, d + 1).getTime() : m != null ? new Date(y, m + 1, 1).getTime() : new Date(y + 1, 0, 1).getTime();
  return { ...all, events: all.events.filter((e) => { const t = new Date(e.date).getTime(); return t >= from && t < to; }) };
}

// Classificação oficial coerente com os jogos encerrados.
export function standings(all) {
  const rows = new Map(TEAMS.map(([id, name]) => [id, { id, name, gp: 0, w: 0, d: 0, l: 0, gf: 0, ga: 0, pts: 0 }]));
  for (const e of all.events) {
    if (e.status.type.state !== 'post' || !e.status.type.completed) continue;
    const [h, a] = e.competitions[0].competitors;
    const hs = Number(h.score);
    const as = Number(a.score);
    for (const [me, gf, ga] of [[rows.get(h.team.id), hs, as], [rows.get(a.team.id), as, hs]]) {
      me.gp++; me.gf += gf; me.ga += ga;
      if (gf > ga) { me.w++; me.pts += 3; } else if (gf === ga) { me.d++; me.pts++; } else me.l++;
    }
  }
  const sorted = [...rows.values()].sort((x, y) => y.pts - x.pts || y.w - x.w || (y.gf - y.ga) - (x.gf - x.ga) || y.gf - x.gf);
  const note = (r) => (r <= 4 ? ['#81D6AC', 'Copa Libertadores'] : r <= 6 ? ['#B2E8CA', 'Copa Libertadores Qualifiers'] : r <= 12 ? ['#F6E47C', 'Copa Sudamericana'] : r >= 17 ? ['#FF7F84', 'Relegation'] : null);
  const entries = sorted.map((t, i) => {
    const s = { rank: i + 1, points: t.pts, gamesPlayed: t.gp, wins: t.w, ties: t.d, losses: t.l, pointsFor: t.gf, pointsAgainst: t.ga, pointDifferential: t.gf - t.ga };
    const e = { team: { id: t.id, shortDisplayName: t.name, displayName: t.name, logos: [{ href: `https://a.espncdn.com/i/teamlogos/soccer/500/${t.id}.png`, rel: ['full', 'default'] }] }, stats: Object.entries(s).map(([name, value]) => ({ name, value })) };
    const n = note(i + 1);
    if (n) e.note = { color: n[0], description: n[1] };
    return e;
  });
  return { children: [{ standings: { entries: entries.reverse() } }] };
}

export function summary(eventJson) {
  const comps = eventJson.competitions[0].competitors;
  return {
    boxscore: {
      teams: comps.map((c, i) => ({
        team: { id: c.team.id },
        statistics: [...c.statistics, { name: 'saves', displayValue: String(2 + i) }, { name: 'yellowCards', displayValue: String(1 + i) }, { name: 'offsides', displayValue: String(i + 1) }],
      })),
    },
  };
}
