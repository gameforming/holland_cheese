import http from 'node:http';

const PORT = Number(process.env.PORT || 10000);
const SUPABASE_URL = String(process.env.SUPABASE_URL || '').replace(/\/$/, '');
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || '';
const allowedOrigin = process.env.CORS_ORIGIN || '*';

function send(res, status, data) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'access-control-allow-origin': allowedOrigin,
    'access-control-allow-methods': 'GET, OPTIONS',
    'access-control-allow-headers': 'content-type, authorization'
  });
  res.end(JSON.stringify(data));
}

async function supabaseGet(path) {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) throw new Error('Supabase environment variables are missing.');
  const response = await fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: {
      apikey: SUPABASE_SERVICE_ROLE_KEY,
      Authorization: `Bearer ${SUPABASE_SERVICE_ROLE_KEY}`
    }
  });
  if (!response.ok) throw new Error(`Supabase returned ${response.status}.`);
  return response.json();
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
  if (req.method === 'GET' && url.pathname === '/api/health') {
    return send(res, 200, { ok: true, service: 'holland-game-api', supabaseConfigured: Boolean(SUPABASE_URL && SUPABASE_SERVICE_ROLE_KEY) });
  }
  try {
    if (req.method === 'GET' && url.pathname === '/api/leaderboard') {
      const players = await supabaseGet('player_profiles?select=username,company_income,companies_count&order=company_income.desc&limit=50');
      return send(res, 200, { players: players.map(p => ({ username: p.username, income: Number(p.company_income) || 0, companies: Number(p.companies_count) || 0 })) });
    }
    if (req.method === 'GET' && url.pathname === '/api/ah/listings') {
      const listings = await supabaseGet('ah_listings?select=id,seller_username,item_id,item_name,rarity,price,status,created_at&status=eq.active&order=created_at.desc&limit=100');
      return send(res, 200, { listings });
    }
    return send(res, 404, { error: 'Not found' });
  } catch (error) {
    console.error(error);
    return send(res, 503, { error: 'Backend data is not available yet.' });
  }
});

server.listen(PORT, () => console.log(`Holland_Game API listening on ${PORT}`));
