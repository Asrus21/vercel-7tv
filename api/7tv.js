// GET /api/7tv?user_id=148903664  ou  /api/7tv?login=asrus12
const TTL = 300;

export default async function handler(req, res) {
  try {
    const { user_id, login } = req.query || {};

    // CORS para overlay/widget
    res.setHeader("Access-Control-Allow-Origin", "*");
    res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
    res.setHeader("Access-Control-Allow-Headers", "Content-Type");
    if (req.method === "OPTIONS") return res.status(204).end();

    if (!user_id && !login) {
      return res.status(400).json({ ok: false, error: "Use ?user_id=... ou ?login=..." });
    }

    // 1) resolve id se vier apenas login
    const id = user_id || await resolveIdByLogin(login);
    if (!id) return res.status(404).json({ ok: false, error: "user_id não encontrado" });

    // 2) tenta localizar o usuário no 7TV por várias rotas (id e login)
    const u = await find7TVUser({ id, login });
    if (!u) return res.status(404).json({ ok: false, error: "Usuário 7TV não encontrado" });

    const style = u.style || u.user?.style || null;

    // 3) normaliza paint
    let paint = style?.paint || null;
    if (!paint && style?.paint_id) {
      const p = await j(`https://7tv.io/v3/paints/${encodeURIComponent(style.paint_id)}`);
      paint = normalizePaint(p);
    } else if (paint) {
      paint = normalizePaint(paint);
    }

    // 4) normaliza badges
    let badges = [];
    if (Array.isArray(style?.badges) && style.badges.length) {
      badges = style.badges.map(normalizeBadge).filter(Boolean);
    } else if (style?.badge_id) {
      const b = await j(`https://7tv.io/v3/badges/${encodeURIComponent(style.badge_id)}`);
      const nb = normalizeBadge(b);
      if (nb) badges = [nb];
    }

    // cache CDN
    res.setHeader("Cache-Control", `public, s-maxage=${TTL}, stale-while-revalidate=${TTL}`);

    return res.status(200).json({
      ok: true,
      user_id: String(id),
      login: u.username || u.user?.username || login || undefined,
      display_name: u.display_name || u.user?.display_name || undefined,
      paint,
      badges
    });
  } catch (e) {
    return res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}

// ===== helpers =====

async function find7TVUser({ id, login }) {
  const tries = [
    `https://7tv.io/v3/users/twitch/${encodeURIComponent(id)}`,
    `https://7tv.io/v3/users/twitch?id=${encodeURIComponent(id)}`,
    login ? `https://7tv.io/v3/users?platform=TWITCH&query=${encodeURIComponent(login.toLowerCase())}` : null
  ].filter(Boolean);

  for (const url of tries) {
    const r = await fetch(url, { headers: { "User-Agent": "vercel-7tv-overlay/1.0" } });
    if (!r.ok) continue;
    const json = await r.json();
    const u = Array.isArray(json) ? json[0] : json; // /users pode retornar lista
    if (u && (u.style || u.user || u.username || u.display_name)) return u;
  }
  return null;
}

async function resolveIdByLogin(login) {
  if (!login) return null;
  const r = await fetch(`https://api.ivr.fi/v2/twitch/user?login=${encodeURIComponent(login.toLowerCase())}`);
  if (!r.ok) return null;
  const json = await r.json();
  const obj = Array.isArray(json) ? json[0] : json;
  return obj?.id || obj?._id || null;
}

async function j(url) {
  const r = await fetch(url, { headers: { "User-Agent": "vercel-7tv-overlay/1.0" } });
  if (!r.ok) return null;
  return r.json();
}

function normalizePaint(p) {
  if (!p) return null;
  const fn = p.function || p.fn || "linear-gradient";
  const angle = typeof p.angle === "number" ? p.angle : 90;
  const colors = p.colors || p.color || [];
  if (!Array.isArray(colors) || !colors.length) return null;
  return { function: fn, angle, colors };
}

function normalizeBadge(b) {
  if (!b) return null;
  const name = b.name || b.data?.name || "7TV Badge";
  const urls = Array.isArray(b.urls)
    ? b.urls
    : Array.isArray(b.data?.urls)
    ? b.data.urls
    : Array.isArray(b.images)
    ? b.images.map(x => [x.size || "1x", x.url || x[1]])
    : null;
  if (!urls || !urls.length) return null;
  const pairs = urls.map(u => Array.isArray(u) ? u : [u.size || "1x", u.url || u[1]]).filter(x => x[1]);
  if (!pairs.length) return null;
  return { name, urls: pairs };
}
