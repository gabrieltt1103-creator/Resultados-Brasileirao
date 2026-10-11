// Calcula as chances fora da tela principal, para o simulador não travar.
import { chances } from './sim.js';

self.onmessage = (e) => {
  const { id, finished, events, overrides, zones, runs } = e.data;
  let result = null;
  try {
    const out = chances({ finished: new Map(finished.map((r) => [r.id, r])), events, overrides, zones, runs });
    if (out) result = { byId: [...out.byId], runs: out.runs, left: out.left };
  } catch { result = null; }
  self.postMessage({ id, result });
};
