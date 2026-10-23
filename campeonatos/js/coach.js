// Técnico de cada time. A ESPN não traz o técnico dos times brasileiros, então ele vem da Wikipédia em
// português (o quadro do clube, que os torcedores atualizam rápido) e do Wikidata (que tem a data de início
// de cada técnico e pega trocas recentes que a Wikipédia ainda não mostra).

// Página de cada clube da Série A na Wikipédia, pelo código do time na ESPN.
export const WIKI_TITLES = {
  7632: 'Clube Atlético Mineiro',
  3458: 'Club Athletico Paranaense',
  9967: 'Esporte Clube Bahia',
  6086: 'Botafogo de Futebol e Regatas',
  9318: 'Associação Chapecoense de Futebol',
  874: 'Sport Club Corinthians Paulista',
  3456: 'Coritiba Foot Ball Club',
  2022: 'Cruzeiro Esporte Clube',
  819: 'Clube de Regatas do Flamengo',
  3445: 'Fluminense Football Club',
  6273: 'Grêmio Foot-Ball Porto Alegrense',
  1936: 'Sport Club Internacional',
  9169: 'Mirassol Futebol Clube',
  2029: 'Sociedade Esportiva Palmeiras',
  6079: 'Red Bull Bragantino',
  4936: 'Clube do Remo',
  2674: 'Santos Futebol Clube',
  2026: 'São Paulo Futebol Clube',
  3454: 'Club de Regatas Vasco da Gama',
  3457: 'Esporte Clube Vitória',
};

const DAY = 864e5;
const NEWER_DAYS = 60;    // troca no Wikidata posterior à última edição da página da Wikipédia, e recente
const RECENT_DAYS = 10;   // sem resposta da Wikipédia, só uma troca bem recente no Wikidata
const OLD_DAYS = 400;     // página sem técnico no quadro: início no Wikidata mais antigo que isso pode estar velho

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const decode = (s) => s
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
  .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
  .replace(/&([a-z]+);/gi, (m, k) => ENTITIES[k.toLowerCase()] ?? m);

/** Técnico no quadro do clube (HTML da primeira seção da página da Wikipédia): "Fernando Diniz" ou null. */
export function parseInfoboxCoach(html) {
  const m = /infobox-label">\s*(?:Treinador|Técnico)[^<]*<\/th>\s*<td[^>]*>([\s\S]*?)<\/td>/i.exec(String(html || ''));
  if (!m) return null;
  const text = decode(m[1]
    .replace(/<sup[\s\S]*?<\/sup>/gi, '')   // referências [2]
    .replace(/<br\s*\/?>/gi, ' ')
    .replace(/<[^>]+>/g, ''))
    .replace(/\[\d+\]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text && text.length <= 60 ? text : null;
}

/**
 * Escolhe o técnico entre as duas fontes. wiki: {name, edited} da Wikipédia (name null se o quadro não tem
 * técnico; wiki null se a Wikipédia não respondeu); wikidata: {name, since} do técnico atual no Wikidata.
 * Vale o Wikidata quando a troca é recente e posterior à última edição da página; senão, a Wikipédia.
 * Devolve {name, src, since}, null (sem técnico conhecido) ou undefined (sem resposta: tentar depois).
 */
export function pickCoach({ wiki = null, wikidata = null, now = Date.now() } = {}) {
  const since = wikidata?.since ? Date.parse(wikidata.since) : NaN;
  const age = Number.isFinite(since) ? (now - since) / DAY : Infinity;
  const fromData = () => ({ name: wikidata.name, src: 'Wikidata', since: wikidata.since });
  if (!wiki) return wikidata?.name && age <= RECENT_DAYS ? fromData() : undefined;
  const edited = Date.parse(wiki.edited || '');
  // Sem a data da última edição, o Wikidata só vence com uma troca bem recente.
  if (wikidata?.name && (Number.isFinite(edited) ? age <= NEWER_DAYS && since > edited : age <= RECENT_DAYS)) return fromData();
  if (wiki.name) return { name: wiki.name, src: 'Wikipédia', since: wikidata?.name === wiki.name ? wikidata.since : null };
  if (wikidata?.name && age <= OLD_DAYS) return fromData();
  return null;
}

/**
 * O técnico vale para o jogo? Para jogos que ainda vão acontecer, ao vivo ou encerrados há menos de um dia
 * (de um jogo antigo, o técnico de hoje pode não ser o daquele dia), e nunca para jogo antes da contratação.
 */
export function coachFits(coach, ev, now = Date.now()) {
  if (!coach?.name || !ev) return false;
  const date = ev.date instanceof Date ? ev.date.getTime() : Number(ev.date);
  if (coach.since && Date.parse(coach.since) > date + DAY / 2) return false;
  if (ev.status?.kind === 'post') return now - date < 30 * 36e5;
  return true;
}

const WIKI_API = 'https://pt.wikipedia.org/w/api.php';
const SPARQL = 'https://query.wikidata.org/sparql';

async function wikiJson(params) {
  const res = await fetch(`${WIKI_API}?${new URLSearchParams({ ...params, format: 'json', formatversion: '2', origin: '*' })}`);
  if (!res.ok) throw new Error(`Wikipédia ${res.status}`);
  const json = await res.json();
  if (json?.error) throw new Error(`Wikipédia ${json.error.code}`);
  return json;
}

// Técnico no quadro do clube (a primeira seção da página, já montada, inclusive quando o quadro é uma predefinição).
async function wikiCoach(title) {
  const json = await wikiJson({ action: 'parse', page: title, prop: 'text', section: '0', redirects: '1', disablelimitreport: '1', disableeditsection: '1' });
  return parseInfoboxCoach(json?.parse?.text);
}

// Última edição de cada página: {título: data}.
async function wikiEdits(titles) {
  const json = await wikiJson({ action: 'query', prop: 'revisions', rvprop: 'timestamp', titles: titles.join('|'), redirects: '1' });
  const back = new Map((json?.query?.redirects || []).map((r) => [r.to, r.from]));
  const out = {};
  for (const p of json?.query?.pages || []) out[back.get(p.title) || p.title] = p.revisions?.[0]?.timestamp || null;
  return out;
}

async function wikidataCoaches(titles) {
  const values = titles.map((t) => `"${t.replace(/"/g, '\\"')}"@pt`).join(' ');
  const query = `SELECT ?title ?coachLabel ?start WHERE {
    VALUES ?title { ${values} }
    ?article schema:about ?club; schema:isPartOf <https://pt.wikipedia.org/>; schema:name ?title.
    ?club p:P286 ?st. ?st ps:P286 ?coach; pq:P580 ?start.
    FILTER NOT EXISTS { ?st pq:P582 ?end }
    SERVICE wikibase:label { bd:serviceParam wikibase:language "pt,en". }
  }`;
  const res = await fetch(`${SPARQL}?${new URLSearchParams({ query, format: 'json' })}`, { headers: { Accept: 'application/sparql-results+json' } });
  if (!res.ok) throw new Error(`Wikidata ${res.status}`);
  const json = await res.json();
  const out = {};
  for (const b of json?.results?.bindings || []) {
    const title = b.title?.value;
    const since = b.start?.value || null;
    // Com mais de um técnico "atual", vale o que começou por último.
    if (title && b.coachLabel?.value && (!out[title] || Date.parse(since) > Date.parse(out[title].since))) out[title] = { name: b.coachLabel.value, since };
  }
  return out;
}

/**
 * Técnicos dos times (códigos da ESPN): {id: {name, src, since} | null}. Time sem página conhecida, ou sem
 * resposta das fontes, fica de fora (para tentar de novo depois).
 */
export async function fetchCoaches(ids, now = Date.now()) {
  const known = ids.filter((id) => WIKI_TITLES[id]);
  if (!known.length) return {};
  const titles = known.map((id) => WIKI_TITLES[id]);
  const [names, edits, data] = await Promise.all([
    Promise.all(titles.map((t) => wikiCoach(t).catch(() => undefined))),
    wikiEdits(titles).catch(() => ({})),
    wikidataCoaches(titles).catch(() => ({})),
  ]);
  const out = {};
  known.forEach((id, i) => {
    const wiki = names[i] === undefined ? null : { name: names[i], edited: edits[titles[i]] || null };
    const pick = pickCoach({ wiki, wikidata: data[titles[i]] || null, now });
    if (pick !== undefined) out[id] = pick;
  });
  return out;
}
