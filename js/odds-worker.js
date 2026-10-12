// Calcula as chances (e as contas do secador) fora da tela principal, para o app não travar.
import { chances, secador } from './sim.js';

self.onmessage = (e) => {
  const { id, kind, finished, events, overrides, zones, runs } = e.data;
  const rows = new Map(finished.map((r) => [r.id, r]));
  let result = null;
  try {
    if (kind === 'secador') result = secador({ finished: rows, events, targets: e.data.targets, teamIds: e.data.teamIds, zones, runs });
    else {
      const out = chances({ finished: rows, events, overrides, zones, runs });
      if (out) result = { byId: [...out.byId], runs: out.runs, left: out.left };
    }
  } catch { result = null; }
  self.postMessage({ id, result });
};
