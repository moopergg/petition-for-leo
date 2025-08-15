// /api/supporters.js
export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  const url = process.env.KV_REST_API_URL;
  const token = process.env.KV_REST_API_TOKEN;

  if (!url || !token) {
    res.status(500).send(JSON.stringify({ error: 'kv_not_configured' }));
    return;
  }

  // Minimal Upstash-style REST helper
  const kv = {
    async cmd(path, method = 'GET') {
      const r = await fetch(`${url}/${path}`, {
        method,
        headers: { Authorization: `Bearer ${token}` }
      });
      const data = await r.json().catch(() => ({}));
      return data.result;
    }
  };

  try {
    if (req.method === 'GET') {
      const raw = await kv.cmd('lrange/supporters:list/0/-1');
      const list = Array.isArray(raw) ? raw : [];
      // Stored as JSON strings; parse safely and return names only for this UI
      const names = list.map((s) => {
        try { return JSON.parse(s).name; } catch { return String(s); }
      });
      res.status(200).send(JSON.stringify({ supporters: names }));
      return;
    }

    if (req.method === 'POST') {
      // Basic IP rate limit: 5 per 30s per IP
      const ip = (req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').toString().split(',')[0].trim();
      const rlKey = `rate:${ip || 'unknown'}`;
      const count = await kv.cmd(`incr/${encodeURIComponent(rlKey)}`);
      if (count === 1) await kv.cmd(`expire/${encodeURIComponent(rlKey)}/30`);
      if (count > 5) {
        res.status(429).send(JSON.stringify({ error: 'rate_limited' }));
        return;
      }

      // Read body
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body || '{}');

      const rawName = (data.username || '').toString().trim();
      const name = rawName.replace(/\s+/g, ' ');
      if (!name) {
        res.status(400).send(JSON.stringify({ error: 'username_required' }));
        return;
      }
      if (name.length > 50) {
        res.status(400).send(JSON.stringify({ error: 'username_too_long' }));
        return;
      }

      // Dedupe globally by normalized name
      const norm = name.toLowerCase();
      const added = await kv.cmd(`sadd/supporters:set/${encodeURIComponent(norm)}`);
      if (added === 1) {
        const entry = JSON.stringify({ name, ts: Date.now() });
        await kv.cmd(`lpush/supporters:list/${encodeURIComponent(entry)}`);
        await kv.cmd('ltrim/supporters:list/0/999'); // keep last 1000
      }

      // Return the updated name-only list for your UI
      const raw = await kv.cmd('lrange/supporters:list/0/-1');
      const names = (Array.isArray(raw) ? raw : []).map((s) => {
        try { return JSON.parse(s).name; } catch { return String(s); }
      });

      res.status(200).send(JSON.stringify({ ok: true, supporters: names }));
      return;
    }

    res.setHeader('Allow', 'GET, POST');
    res.status(405).send(JSON.stringify({ error: 'method_not_allowed' }));
  } catch (e) {
    res.status(500).send(JSON.stringify({ error: 'server_error' }));
  }
}
