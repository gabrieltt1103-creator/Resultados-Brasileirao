// Estratégia de leitura da temporada: o que já passou não muda, então depois da primeira leitura
// completa basta recarregar os meses em que ainda pode haver novidade.
import { HOUR } from './util.js';

/**
 * Meses a recarregar: do mês da última leitura (ou de um jogo ainda por terminar, se for mais
 * antigo) até dezembro. Um dia de folga cobre a diferença de fuso entre o Brasil e a ESPN.
 */
export function deltaMonths(events, since, now = new Date()) {
  let from = new Date(Math.min(since, now.getTime()) - 24 * HOUR);
  for (const e of events) if ((e.status.kind === 'pre' || e.status.kind === 'live') && e.date < from) from = e.date;
  const start = from.getFullYear() < now.getFullYear() ? 1 : from.getMonth() + 1;
  return Array.from({ length: 13 - start }, (_, i) => start + i);
}

/**
 * Jogos que a ESPN deixou de listar nos meses recarregados (descartados ou trocados por outro registro).
 * Só conta o que está a mais de um dia do início do período, para não confundir a virada do mês.
 * months: meses recarregados, ou null quando a temporada inteira veio.
 */
export function vanished(events, freshIds, months, year) {
  const from = months ? new Date(year, months[0] - 1, 2).getTime() : -Infinity;
  return events.filter((e) => e.date.getTime() >= from && e.date.getFullYear() === year && !freshIds.has(e.id)).map((e) => e.id);
}
