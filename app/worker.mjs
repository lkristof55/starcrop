// Cloudflare Workers entry (wrangler.jsonc). The same handlers as netlify/functions/*, nothing rewritten:
//   fetch():     /api/* (run_worker_first) is routed by each function's config.path to its default export, with a
//                Netlify-style context; any other path goes to the static site (env.ASSETS: site/dist, 404.html).
//   scheduled(): runs every function that exports config.schedule (the survey job, lib/job.mjs).
// env.DB (D1) is registered with lib/store.mjs before any handler runs. Vars and secrets reach the handlers through
// process.env (nodejs_compat populates it), exactly as on Netlify. CF_FREE_PLAN=1 (wrangler.jsonc vars) selects the
// free-plan budgets in lib/plan.mjs.
import { useD1 } from './lib/store.mjs';
import * as fields from './netlify/functions/fields.mjs';
import * as health from './netlify/functions/health.mjs';
import * as recent from './netlify/functions/recent.mjs';
import * as report from './netlify/functions/report.mjs';
import * as survey from './netlify/functions/survey.mjs';

export const FUNCTIONS = { fields, health, recent, report, survey };

// ICU loads its collation and number-format data on first use (localeCompare in the analysis and the field index,
// toLocaleString in report evidence): ~5-9 ms of CPU, once per isolate. Done here, at module scope, it is billed to
// the Worker's startup (1 s limit) instead of the first request's 10 ms.
'a'.localeCompare('b');
(1234).toLocaleString('en-US');

/** '/api/thing/:id' or '/api/*' -> (pathname) => params | null (the subset of URLPattern that Netlify paths use). */
export function compile(pattern) {
  const names = [];
  const src = pattern.split('/').map((seg) => {
    if (seg === '*') { names.push('0'); return '(.*)'; }
    if (seg.startsWith(':')) { names.push(seg.slice(1)); return '([^/]+)'; }
    return seg.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }).join('/');
  const re = new RegExp(`^${src}$`);
  return (pathname) => {
    const m = re.exec(pathname);
    if (!m) return null;
    try { return Object.fromEntries(names.map((n, i) => [n, decodeURIComponent(m[i + 1])])); } catch { return null; }
  };
}

export const routes = Object.entries(FUNCTIONS).flatMap(([name, mod]) => (mod.config?.path ? [].concat(mod.config.path) : [])
  .map((path) => ({ name, path, handler: mod.default, match: compile(path) })));
export const scheduledFunctions = Object.entries(FUNCTIONS).filter(([, mod]) => mod.config?.schedule).map(([name, mod]) => ({ name, schedule: mod.config.schedule, handler: mod.default }));

/** The Netlify Functions v2 context the handlers may read: params, ip, geo, waitUntil, site, requestId. */
export function netlifyContext(request, ctx, params = {}) {
  const cf = request.cf || {};
  return {
    params,
    ip: request.headers.get('cf-connecting-ip') || '',
    geo: {
      city: cf.city, country: cf.country ? { code: cf.country } : undefined, subdivision: cf.regionCode ? { code: cf.regionCode } : undefined,
      timezone: cf.timezone, latitude: cf.latitude != null ? Number(cf.latitude) : undefined, longitude: cf.longitude != null ? Number(cf.longitude) : undefined,
    },
    waitUntil: (p) => ctx.waitUntil(p),
    site: { url: new URL(request.url).origin },
    requestId: request.headers.get('cf-ray') || '',
    cookies: { get: () => undefined, set() {}, delete() {} },
  };
}

export default {
  async fetch(request, env, ctx) {
    if (env.DB) useD1(env.DB);
    const { pathname } = new URL(request.url);
    for (const r of routes) {
      const params = r.match(pathname);
      if (!params) continue;
      try {
        const res = await r.handler(request, netlifyContext(request, ctx, params));
        return res instanceof Response ? res : Response.json(res ?? null);
      } catch (e) {
        console.error(`[${r.name}] ${e?.stack || e}`);
        return Response.json({ error: 'function crashed' }, { status: 500 });
      }
    }
    return env.ASSETS.fetch(request);
  },

  async scheduled(controller, env, ctx) {
    if (env.DB) useD1(env.DB);
    const request = new Request('https://worker.invalid/.netlify/functions/scheduled', { method: 'POST', body: JSON.stringify({ next_run: null }) });
    // the functions whose schedule is this cron (all of them for a manual /__scheduled run without ?cron=)
    const due = scheduledFunctions.filter((f) => f.schedule === controller?.cron);
    for (const f of due.length ? due : scheduledFunctions) {
      try { await f.handler(request, netlifyContext(request, ctx)); } catch (e) { console.error(`[${f.name}] ${e?.stack || e}`); throw e; }
    }
  },
};
