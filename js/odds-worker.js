// Calcula as chances (e as contas do secador) fora da tela principal, para o app não travar.
import { chances, secador } from './sim.js';

self.onmessage = (e) => {
  const { id, kind, finished, events, overrides, zones, runs } = e.data;
  const rows = new Map(finished.map((r) => [r.id, r]));
  const prior = Array.isArray(e.data.prior) ? new Map(e.data.prior) : null;
  let result = null;
  try {
    if (kind === 'secador') result = secador({ finished: rows, events, targets: e.data.targets, teamIds: e.data.teamIds, zones, runs, prior });
    else {
      const out = chances({ finished: rows, events, overrides, zones, runs, prior });
      if (out) result = { byId: [...out.byId], runs: out.runs, left: out.left };
    }
  } catch { result = null; }
  self.postMessage({ id, result });
};
