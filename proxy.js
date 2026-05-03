// api/proxy.js — Vercel Serverless Function
// Semua request ke website tujuan keluar dari SERVER Vercel,
// bukan dari browser user. Zero DNS leak ke client.

export const config = { runtime: 'edge' };

export default async function handler(req) {
  const { searchParams } = new URL(req.url);
  const target = searchParams.get('url');

  // ── CORS preflight ──────────────────────────────────────────
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      },
    });
  }

  // ── Validasi URL ────────────────────────────────────────────
  if (!target) {
    return new Response(JSON.stringify({ error: 'Missing url param' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let parsedUrl;
  try {
    parsedUrl = new URL(target);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid URL' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  // ── Hanya allow http/https ──────────────────────────────────
  if (!['http:', 'https:'].includes(parsedUrl.protocol)) {
    return new Response(JSON.stringify({ error: 'Protocol not allowed' }), {
      status: 403,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  try {
    // ── Fetch dari server Vercel ────────────────────────────────
    const upstream = await fetch(parsedUrl.toString(), {
      method: req.method === 'POST' ? 'POST' : 'GET',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
        'Accept-Encoding': 'gzip, deflate, br',
        'Cache-Control': 'no-cache',
      },
      redirect: 'follow',
    });

    const contentType = upstream.headers.get('content-type') || 'text/html';
    const body = await upstream.arrayBuffer();

    // ── Inject base tag + rewrite links untuk HTML ──────────────
    if (contentType.includes('text/html')) {
      let html = new TextDecoder('utf-8').decode(body);

      // Inject base href supaya relative URL resolve ke domain asli
      const baseTag = `<base href="${parsedUrl.origin}/">`;
      html = html.replace(/<head[^>]*>/i, match => match + baseTag);

      // Hapus frame-busting scripts umum
      html = html.replace(/if\s*\(\s*(?:top|self|window\.top)\s*[!=]==?\s*(?:self|window|window\.self)\s*\)/gi, 'if(false)');
      html = html.replace(/top\.location(?:\.href)?\s*=\s*/gi, '//');
      html = html.replace(/window\.top\.location(?:\.href)?\s*=\s*/gi, '//');

      return new Response(html, {
        status: upstream.status,
        headers: {
          'Content-Type': 'text/html; charset=utf-8',
          'Access-Control-Allow-Origin': '*',
          'X-Frame-Options': 'SAMEORIGIN',
          'Cache-Control': 'no-store',
        },
      });
    }

    // ── Non-HTML (CSS, JS, images, dll) ────────────────────────
    return new Response(body, {
      status: upstream.status,
      headers: {
        'Content-Type': contentType,
        'Access-Control-Allow-Origin': '*',
        'Cache-Control': 'public, max-age=3600',
      },
    });

  } catch (err) {
    return new Response(JSON.stringify({ error: 'Proxy fetch failed', detail: err.message }), {
      status: 502,
      headers: {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      },
    });
  }
}
