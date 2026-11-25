// Small fetch helper: polite User-Agent, timeout, in-memory cache, robots.txt check.
const UA = 'StudifyBot/0.1 (open-source study notes app; respects robots.txt)';
const cache = new Map();
const CACHE_MS = 30 * 60 * 1000;

export async function fetchText(url, { timeoutMs = 15000, accept = '*/*' } = {}) {
  const hit = cache.get(url);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.body;
  const res = await fetch(url, {
    headers: { 'User-Agent': UA, Accept: accept },
    signal: AbortSignal.timeout(timeoutMs),
    redirect: 'follow',
  });
  if (!res.ok) {
    const err = new Error(`Upstream ${new URL(url).hostname} answered ${res.status}`);
    err.status = res.status === 404 ? 404 : 502;
    throw err;
  }
  const body = await res.text();
  cache.set(url, { at: Date.now(), body });
  if (cache.size > 500) cache.delete(cache.keys().next().value);
  return body;
}

export async function fetchJson(url, opts) {
  return JSON.parse(await fetchText(url, { ...opts, accept: 'application/json' }));
}

// Minimal robots.txt evaluation for "User-agent: *" and our own agent token.
export function isAllowedByRobots(robotsTxt, path, agent = 'studifybot') {
  const groups = [];
  let current = null;
  let lastWasAgent = false;
  for (const raw of robotsTxt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    if (!line) continue;
    const idx = line.indexOf(':');
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (key === 'user-agent') {
      if (!lastWasAgent) { current = { agents: [], rules: [] }; groups.push(current); }
      current.agents.push(value.toLowerCase());
      lastWasAgent = true;
    } else {
      lastWasAgent = false;
      if (current && (key === 'allow' || key === 'disallow')) current.rules.push({ allow: key === 'allow', path: value });
    }
  }
  const mine = groups.filter(g => g.agents.some(a => a !== '*' && agent.includes(a)));
  const chosen = mine.length ? mine : groups.filter(g => g.agents.includes('*'));
  let best = null;
  for (const g of chosen) {
    for (const r of g.rules) {
      if (!r.path) continue; // empty Disallow = allow everything
      if (matchesRobotsPath(r.path, path) && (!best || r.path.length > best.path.length || (r.path.length === best.path.length && r.allow))) best = r;
    }
  }
  return best ? best.allow : true;
}

function matchesRobotsPath(pattern, path) {
  const anchored = pattern.endsWith('$');
  const body = (anchored ? pattern.slice(0, -1) : pattern)
    .split('*').map(s => s.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp('^' + body + (anchored ? '$' : '')).test(path);
}

export async function robotsAllows(url) {
  const u = new URL(url);
  try {
    const txt = await fetchText(`${u.origin}/robots.txt`, { timeoutMs: 8000 });
    return isAllowedByRobots(txt, u.pathname + u.search);
  } catch (e) {
    if (e.status === 404) return true; // no robots.txt means no restrictions
    throw e;
  }
}
