// /api/supporters.js
import { put, list } from '@vercel/blob';

const PATH = 'petition/supporters.json';

async function getBlobUrl() {
  const { blobs } = await list({ prefix: PATH, limit: 1 });
  return blobs && blobs.length ? blobs[0].url : null;
}

async function readSupporters() {
  const url = await getBlobUrl();
  if (!url) return [];
  const r = await fetch(url);
  if (!r.ok) return [];
  const data = await r.json().catch(() => ({}));
  if (Array.isArray(data)) return data.filter(v => typeof v === 'string');
  if (Array.isArray(data.supporters)) return data.supporters.filter(v => typeof v === 'string');
  return [];
}

async function writeSupporters(names) {
  const clean = Array.from(new Set(names.map(s => String(s)))); // dedupe exact matches
  const body = JSON.stringify({ supporters: clean, updatedAt: new Date().toISOString() });
  await put(PATH, body, {
    access: 'public',
    addRandomSuffix: false,
    contentType: 'application/json'
  });
  return clean;
}

export default async function handler(req, res) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Cache-Control', 'no-store');

  try {
    if (req.method === 'GET') {
      const supporters = await readSupporters();
      return res.status(200).send(JSON.stringify({ supporters }));
    }

    if (req.method === 'POST') {
      let body = '';
      for await (const chunk of req) body += chunk;
      const data = JSON.parse(body || '{}');

      const raw = (data.username || '').toString().trim();
      const name = raw.replace(/\s+/g, ' ');
      if (!name) return res.status(400).send(JSON.stringify({ error: 'username_required' }));
      if (name.length > 50) return res.status(400).send(JSON.stringify({ error: 'username_too_long' }));

      // Load current list
      const current = await readSupporters();

      // Case-insensitive dedupe
      const exists = new Set(current.map(s => s.toLowerCase()));
      if (!exists.has(name.toLowerCase())) current.push(name);

      const supporters = await writeSupporters(current);
      return res.status(200).send(JSON.stringify({ ok: true, supporters }));
    }

    res.setHeader('Allow', 'GET, POST');
    return res.status(405).send(JSON.stringify({ error: 'method_not_allowed' }));
  } catch (e) {
    return res.status(500).send(JSON.stringify({ error: 'server_error' }));
  }
}
