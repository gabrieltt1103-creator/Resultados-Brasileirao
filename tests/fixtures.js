// Respostas falsas no formato da API da ESPN, relativas a um instante "agora".
// Monta 4 rodadas encerradas, a rodada atual (encerrados, ao vivo, intervalo, a seguir, adiado) e a próxima.
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

let seq = 700000;
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

const pairs = (shift) => Array.from({ length: 10 }, (_, i) => [ids[(i + shift) % 20], ids[(19 - i + shift) % 20]]);

export function scoreboard(now) {
  seq = 700000;
  const day = (d, hh, mm = 0) => { const x = new Date(now); x.setDate(x.getDate() + d); x.setHours(hh, mm, 0, 0); return x.getTime(); };
  const events = [];
  // quatro rodadas encerradas (26 a 29)
  [-16, -12, -9, -5].forEach((d, r) => pairs(3 + r * 4).forEach(([h, a], i) => events.push(ev(day(d, 16 + (i % 3) * 2), h, a, 'post', (i + r) % 3, (i + 2 * r) % 2))));
  // rodada atual (30)
  const c = pairs(0);
  const t0 = now - 70 * 60e3;
  events.push(ev(day(-1, 16), c[0][0], c[0][1], 'post', 2, 1, [goal(c[0][0], "12'", 'Pedro'), goal(c[0][1], "40'", 'Vitor Roque'), card(c[0][1], "55'", 'Gómez'), goal(c[0][0], "88'", 'Arrascaeta', { penaltyKick: true })]));
  events.push(ev(day(-1, 18, 30), c[1][0], c[1][1], 'post', 0, 0, [card(c[1][1], "77'", 'Lucas', true)]));
  events.push(ev(day(-1, 18, 30), c[2][0], c[2][1], 'post', 1, 3, [goal(c[2][0], "5'", 'Savarino'), goal(c[2][1], "33'", 'Reinaldo'), goal(c[2][1], "60'", 'Reinaldo'), goal(c[2][1], "71'", 'Reinaldo')]));
  events.push(ev(day(-1, 21), c[3][0], c[3][1], 'post', 1, 0, [goal(c[3][0], "90'+3'", 'Cano')]));
  events.push(ev(t0, c[4][0], c[4][1], 'live', 1, 1, [goal(c[4][0], "22'", 'Calleri'), goal(c[4][1], "58'", 'Gilberto', { ownGoal: true })], "67'"));
  events.push(ev(t0, c[5][0], c[5][1], 'live', 0, 2, [goal(c[5][1], "31'", 'Sasha'), goal(c[5][1], "49'", 'Sasha')], "67'"));
  events.push(ev(t0 + 20 * 60e3, c[6][0], c[6][1], 'live', 1, 0, [goal(c[6][0], "45'+2'", 'Braithwaite')], "45'+2'"));
  events.push(ev(t0 + 25 * 60e3, c[7][0], c[7][1], 'ht', 0, 0, [], "45'"));
  events.push(ev(now + 2 * H, c[8][0], c[8][1], 'pre'));
  events.push(ev(day(-1, 11), c[9][0], c[9][1], 'adiado'));
  // próxima rodada (31)
  pairs(7).forEach(([h, a], i) => events.push(ev(day(3, 19 + (i % 2) * 2, 30) + Math.floor(i / 5) * 24 * H, h, a, 'pre')));
  return { leagues: [{ season: { year: 2026 } }], events };
}

export function standings() {
  const played = new Set([0, 1, 2, 3, 16, 17, 18, 19]); // jogaram ontem pela rodada 30
  const note = (r) => (r <= 4 ? ['#81D6AC', 'Copa Libertadores'] : r <= 6 ? ['#B2E8CA', 'Copa Libertadores Qualifiers'] : r <= 12 ? ['#F6E47C', 'Copa Sudamericana'] : r >= 17 ? ['#FF7F84', 'Relegation'] : null);
  const entries = TEAMS.map(([id, name], i) => {
    const r = i + 1;
    const gp = 29 + (played.has(i) ? 1 : 0);
    const pts = 62 - (Math.floor(i / 2) * 5 + (i % 2) * 2); // diferenças de 2 e 3 pontos
    const d = 6 + (pts % 3);
    const w = (pts - d) / 3;
    const l = gp - w - d;
    const gf = 55 - i * 2;
    const ga = 20 + i;
    const s = { rank: r, points: pts, gamesPlayed: gp, wins: w, ties: d, losses: l, pointsFor: gf, pointsAgainst: ga, pointDifferential: gf - ga };
    const e = { team: { id, shortDisplayName: name, displayName: name, logos: [{ href: `https://a.espncdn.com/i/teamlogos/soccer/500/${id}.png` }] }, stats: Object.entries(s).map(([n, value]) => ({ name: n, value })) };
    const n = note(r);
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
