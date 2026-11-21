(() => {
  'use strict';

  const C = window.HollandCatalog;
  const SAVE_KEY = 'holland-game-v2-save';
  const AUTH_KEY = 'holland-game-supabase-auth';
  const PAYOUT_MS = 5 * 60 * 1000;
  const moneyFmt = new Intl.NumberFormat('nl-NL', {minimumFractionDigits:2, maximumFractionDigits:2});
  const intFmt = new Intl.NumberFormat('nl-NL');
  const $ = (selector, root=document) => root.querySelector(selector);
  const $$ = (selector, root=document) => [...root.querySelectorAll(selector)];
  const money = cents => `KM ${moneyFmt.format((Number(cents)||0)/100)}`;
  const cents = amount => Math.round((Number(amount)||0)*100);
  const euro = amount => `KM ${moneyFmt.format(Number(amount)||0)}`;
  const clamp = (v,min,max) => Math.max(min,Math.min(max,v));
  const esc = value => String(value ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
  const now = () => Date.now();

  let hasLocalSave = false;
  const defaultState = () => ({
    version: 2, username: 'Nieuwe Speler', balance: 0, lifetimeEarned: 0, companyEarned: 0,
    companies: {}, holdings: {}, collectibles: {}, listings: [], marketPrices: {}, marketHistory: {},
    marketUpdatedAt: now(), lastPayoutAt: now(), lastSeenAt: now()
  });
  function loadState() {
    try {
      const raw = localStorage.getItem(SAVE_KEY);
      const parsed = JSON.parse(raw || 'null');
      if (!parsed || parsed.version !== 2) return defaultState();
      hasLocalSave = true;
      return {...defaultState(), ...parsed, companies: parsed.companies || {}, holdings: parsed.holdings || {}, collectibles: parsed.collectibles || {}, listings: parsed.listings || [], marketPrices: parsed.marketPrices || {}, marketHistory: parsed.marketHistory || {}};
    } catch { return defaultState(); }
  }
  let state = loadState();
  let activeTab = 'work';
  let currentGame = null;
  let toastTimer = null;
  let workFilter = 'Alles';
  let companyFilter = 'Alles';
  let companySearch = '';
  let marketFilter = 'Alles';
  let selectedMarketAssetId = 'tulip-token';
  let marketRange = '24u';
  let remoteLeaderboard = null;
  let remoteListings = null;
  let backendStatus = 'local';
  let supabaseUrl = '';
  let supabaseAnonKey = '';
  let supabaseSession = null;
  let supabaseUser = null;
  let lastCloudSnapshot = null;
  let lastCloudUpdatedAt = 0;
  let cloudSaveTimer = null;
  let cloudSaveBusy = false;
  let cloudSavePending = false;
  let lastSocialRefresh = 0;

  function save() {
    state.lastSeenAt = now();
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); hasLocalSave = true; } catch (error) { console.warn('Lokaal opslaan mislukt', error); }
    queueCloudSave();
  }

  // Minimal Supabase Auth + REST client (no extra frontend dependency required).
  // Anonymous Auth creates a persistent player ID; Supabase refresh tokens live locally.
  async function supabaseAuthRequest(path, payload) {
    const response = await fetch(`${supabaseUrl}/auth/v1/${path}`, {
      method: 'POST',
      headers: { apikey: supabaseAnonKey, Authorization: `Bearer ${supabaseAnonKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload || {})
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.msg || body.message || body.error_description || `Supabase Auth HTTP ${response.status}`);
    return body;
  }

  async function ensureSupabaseSession() {
    if (!supabaseUrl || !supabaseAnonKey) throw new Error('Supabase URL of anon key ontbreekt.');
    let stored = supabaseSession;
    if (!stored) {
      try { stored = JSON.parse(localStorage.getItem(AUTH_KEY) || 'null'); } catch (_) { stored = null; }
    }
    const expiresAt = Number(stored?.expires_at || 0);
    if (stored?.access_token && expiresAt > Math.floor(Date.now() / 1000) + 90) {
      supabaseSession = stored;
      supabaseUser = stored.user || supabaseUser;
      return stored;
    }
    let fresh;
    if (stored?.refresh_token) {
      fresh = await supabaseAuthRequest('token?grant_type=refresh_token', { refresh_token: stored.refresh_token });
    } else if (!stored) {
      fresh = await supabaseAuthRequest('signup', {}); // Supabase Anonymous Sign-Ins must be enabled.
    } else {
      throw new Error('De opgeslagen Supabase-sessie kan niet worden vernieuwd.');
    }
    fresh.expires_at = Number(fresh.expires_at) || (Math.floor(Date.now() / 1000) + Number(fresh.expires_in || 3600));
    if (!fresh.access_token || !fresh.user?.id) throw new Error('Supabase heeft geen geldige anonieme spelersessie teruggegeven.');
    supabaseSession = fresh;
    supabaseUser = fresh.user;
    try { localStorage.setItem(AUTH_KEY, JSON.stringify(fresh)); }
    catch (error) { console.warn('Supabase-sessie kon niet lokaal worden bewaard:', error); }
    return fresh;
  }

  async function supabaseRequest(path, options = {}) {
    await ensureSupabaseSession();
    const headers = {
      apikey: supabaseAnonKey,
      Authorization: `Bearer ${supabaseSession.access_token}`,
      'Content-Type': 'application/json',
      ...(options.headers || {})
    };
    const response = await fetch(`${supabaseUrl}/rest/v1/${path}`, { ...options, headers });
    if (response.status === 204) return null;
    const text = await response.text();
    let body = null;
    try { body = text ? JSON.parse(text) : null; } catch (_) { body = text; }
    if (!response.ok) throw new Error(body?.message || body?.details || body?.hint || `Supabase REST HTTP ${response.status}`);
    return body;
  }

  // Local-first saves keep the game playable offline. A debounced Supabase upsert
  // mirrors the complete save whenever the player has an authenticated session.
  function queueCloudSave() {
    if (!supabaseUrl || !supabaseSession || !supabaseUser) return;
    clearTimeout(cloudSaveTimer);
    cloudSaveTimer = setTimeout(() => syncCloudSave(), 850);
  }

  async function mergeRemoteSaveIfNewer() {
    if (!supabaseUrl || !supabaseSession || !supabaseUser) return false;
    const rows = await supabaseRequest(`player_saves?select=save_data,updated_at&user_id=eq.${encodeURIComponent(supabaseUser.id)}&limit=1`);
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row?.save_data) return false;
    const cloudTime = Date.parse(row.updated_at || '') || 0;
    if (cloudTime <= lastCloudUpdatedAt) return false;
    const cloud = row.save_data;
    if (!lastCloudSnapshot) {
      state = { ...defaultState(), ...cloud,
        companies: cloud.companies || {}, holdings: cloud.holdings || {},
        collectibles: cloud.collectibles || {}, listings: cloud.listings || [],
        marketPrices: cloud.marketPrices || {}, marketHistory: cloud.marketHistory || {} };
    } else {
      // Keep local actions made since the last sync, while applying cross-device wallet
      // and collectible changes (for example, a friend buying one of our AH listings).
      const deltaBalance = (Number(state.balance)||0) - (Number(lastCloudSnapshot.balance)||0);
      const deltaEarned = (Number(state.lifetimeEarned)||0) - (Number(lastCloudSnapshot.lifetimeEarned)||0);
      const deltaCompanyEarned = (Number(state.companyEarned)||0) - (Number(lastCloudSnapshot.companyEarned)||0);
      const mergedCollectibles = { ...(cloud.collectibles || {}) };
      const ids = new Set([...Object.keys(state.collectibles||{}), ...Object.keys(lastCloudSnapshot.collectibles||{}), ...Object.keys(cloud.collectibles||{})]);
      for (const id of ids) {
        const localDelta = (Number(state.collectibles?.[id])||0) - (Number(lastCloudSnapshot.collectibles?.[id])||0);
        const quantity = (Number(cloud.collectibles?.[id])||0) + localDelta;
        if (quantity > 0) mergedCollectibles[id] = quantity; else delete mergedCollectibles[id];
      }
      state.balance = (Number(cloud.balance)||0) + deltaBalance;
      state.lifetimeEarned = (Number(cloud.lifetimeEarned)||0) + deltaEarned;
      state.companyEarned = (Number(cloud.companyEarned)||0) + deltaCompanyEarned;
      state.collectibles = mergedCollectibles;
    }
    lastCloudSnapshot = JSON.parse(JSON.stringify(cloud));
    lastCloudUpdatedAt = cloudTime;
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); hasLocalSave = true; }
    catch (error) { console.warn('Cloud-save geladen, maar localStorage kon niet worden bijgewerkt:', error); }
    return true;
  }

  async function syncCloudSave() {
    if (!supabaseUrl || !supabaseSession || !supabaseUser) return;
    clearTimeout(cloudSaveTimer);
    if (cloudSaveBusy) {
      cloudSavePending = true;
      while (cloudSaveBusy) await new Promise(resolve => setTimeout(resolve, 25));
      if (cloudSavePending) return syncCloudSave();
      return;
    }
    cloudSaveBusy = true;
    backendStatus = 'connecting';
    updateHeader();
    try {
      do {
        cloudSavePending = false;
        await ensureSupabaseSession();
        await mergeRemoteSaveIfNewer();
        const snapshot = JSON.parse(JSON.stringify(state));
        const savePayload = { user_id: supabaseUser.id, save_data: snapshot, updated_at: new Date().toISOString() };
        const savedRows = await supabaseRequest('player_saves?on_conflict=user_id', { method: 'POST',
          headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(savePayload) });
        lastCloudSnapshot = JSON.parse(JSON.stringify(snapshot));
        lastCloudUpdatedAt = Date.parse(savedRows?.[0]?.updated_at || '') || Date.now();

        // Publish only the leaderboard fields; the full save remains private.
        const profile = {
          user_id: supabaseUser.id, username: snapshot.username,
          company_income: Number(companyIncomePerTick().toFixed(2)),
          balance: Number((snapshot.balance / 100).toFixed(2)),
          companies_count: ownedCompanyCount(),
          lifetime_earned: Number((snapshot.lifetimeEarned / 100).toFixed(2)),
          updated_at: new Date().toISOString()
        };
        try {
          await supabaseRequest('player_profiles?on_conflict=user_id', { method: 'POST',
            headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(profile) });
        } catch (profileError) { console.warn('Leaderboardprofiel kon niet worden bijgewerkt:', profileError.message || profileError); }
        if (Number(state.lastSeenAt) > Number(snapshot.lastSeenAt)) cloudSavePending = true;
      } while (cloudSavePending);
      backendStatus = 'online';
    } catch (error) {
      console.warn('Cloud-save niet gelukt; lokale save blijft bewaard:', error.message || error);
      backendStatus = 'local';
    } finally {
      cloudSaveBusy = false;
      updateHeader();
      if (cloudSavePending) queueCloudSave();
    }
  }
  function notify(message) {
    const node = $('#toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => node.classList.remove('show'), 2700);
  }
  function ownedCompanyCount() { return Object.values(state.companies).reduce((sum,n) => sum + (Number(n)||0), 0); }
  function companyIncomePerTick() {
    return C.companies.reduce((sum,co) => sum + co.income * (Number(state.companies[co.id])||0), 0);
  }
  function settlePayouts() {
    const current = now();
    const elapsed = Math.max(0, current - (Number(state.lastPayoutAt)||current));
    const ticks = Math.floor(elapsed / PAYOUT_MS);
    if (ticks > 0) {
      const income = cents(companyIncomePerTick()) * ticks;
      if (income > 0) {
        state.balance += income;
        state.lifetimeEarned += income;
        state.companyEarned += income;
      }
      state.lastPayoutAt += ticks * PAYOUT_MS;
      save();
      if (income > 0) notify(`Salaris ontvangen: ${money(income)} (${ticks} ronde${ticks===1?'':'s'})`);
      if (activeTab === 'companies' || activeTab === 'leaderboard') renderTab();
    }
  }
  function addMoney(amount, reason) {
    const value = Math.max(0, cents(amount));
    state.balance += value;
    state.lifetimeEarned += value;
    save();
    updateHeader();
    if (reason) notify(`${reason}: +${money(value)}`);
  }
  function spendMoney(amount) {
    const value = Math.max(0, cents(amount));
    if (state.balance < value) return false;
    state.balance -= value;
    save();
    updateHeader();
    return true;
  }
  function updateHeader() {
    $('#balance').textContent = moneyFmt.format(state.balance/100);
    $('#usernameLabel').textContent = state.username;
    $('#avatar').textContent = (state.username.trim()[0] || 'N').toUpperCase();
    $('#incomeStat').textContent = euro(companyIncomePerTick());
    $('#companyStat').textContent = intFmt.format(ownedCompanyCount());
    $('#earnedStat').textContent = moneyFmt.format(state.lifetimeEarned/100) + ' KM';
    const remaining = Math.max(0, PAYOUT_MS - (now() - state.lastPayoutAt));
    const seconds = Math.ceil(remaining/1000);
    $('#payoutTimer').textContent = ownedCompanyCount()>0 ? `${String(Math.floor(seconds/60)).padStart(2,'0')}:${String(seconds%60).padStart(2,'0')}` : 'Geen bedrijf';
    const status = $('#connectionStatus');
    status.classList.toggle('online', backendStatus === 'online');
    const statusText = backendStatus === 'online' ? 'Supabase + lokaal opgeslagen' : backendStatus === 'connecting' ? 'Cloud synchroniseert…' : 'Lokaal opgeslagen';
    status.innerHTML = `<i></i>${statusText}`;
  }
  function setTab(tab) {
    activeTab = tab;
    $$('.tab').forEach(button => button.classList.toggle('active', button.dataset.tab === tab));
    renderTab();
    $('#tabContent').focus({preventScroll:true});
  }

  function renderTab() {
    const main = $('#tabContent');
    if (activeTab === 'work') main.innerHTML = renderWork();
    if (activeTab === 'companies') main.innerHTML = renderCompanies();
    if (activeTab === 'market') main.innerHTML = renderMarket();
    if (activeTab === 'crates') main.innerHTML = renderCrates();
    if (activeTab === 'ah') main.innerHTML = renderAH();
    if (activeTab === 'leaderboard') main.innerHTML = renderLeaderboard();
  }

  function renderWork() {
    const categories = ['Alles','Leger','Beginner','Sport','Nederland','Werk'];
    const games = C.games.filter(game => workFilter === 'Alles' || game.category === workFilter);
    return `
      <section class="work-banner">
        <div class="banner-copy">
          <div class="eyebrow">Work • verdien je eerste Kaasmunten</div>
          <h1>Begin op nul.<br>Verdien je eerste fortuin.</h1>
          <p class="lede">Speel korte minigames, verdien Kaasmunten en koop daarna bedrijven die elke vijf minuten salaris uitbetalen. De fabriek bewaren we voor een latere update.</p>
        </div>
        <div class="panel banner-aside">
          <div class="hint-row"><span class="hint-icon">🎯</span><span><b>Speel zoals jij wilt</b><br>Van simpele klikspelletjes tot tank- en vliegtuigmissies.</span></div>
          <div class="hint-row"><span class="hint-icon">⏱️</span><span><b>Korte rondes</b><br>Elke minigame duurt 45 tot 90 seconden en nooit langer dan vijf minuten.</span></div>
          <div class="hint-row"><span class="hint-icon">🏢</span><span><b>Bouw passief inkomen</b><br>Koop een bedrijf en laat het iedere vijf minuten verdienen.</span></div>
        </div>
      </section>
      <div class="page-heading"><div><div class="eyebrow">Minigames</div><h2>Kies je volgende klus</h2><p class="lede">Moeilijkere uitdagingen betalen meer. Je kunt elke ronde meteen opnieuw spelen.</p></div><div class="pill">10 minigames • 45–90 sec</div></div>
      <div class="tag-row" id="workFilters">${categories.map(cat=>`<button class="filter-chip ${workFilter===cat?'active':''}" data-action="work-filter" data-value="${cat}">${cat==='Leger'?'🪖 ':cat==='Beginner'?'🌱 ':cat==='Sport'?'⚽ ':''}${cat}</button>`).join('')}</div>
      <div class="game-grid" style="margin-top:14px">${games.map(game=>`
        <article class="game-card">
          <div class="game-card-top"><div class="game-icon">${game.icon}</div><span class="pill ${game.tone}">${game.category==='Leger'?'LEGER • ACTIE':game.category.toUpperCase()}</span></div>
          <h3>${game.title}</h3><p>${game.description}</p>
          <div class="game-card-foot"><div><div class="reward-range">${euro(game.base)} – ${euro(game.base+game.rate*100)}</div><div class="small-meta">${game.duration} seconden • ${game.difficulty}</div></div><button class="btn tiny" data-action="open-game" data-id="${game.id}">Spelen →</button></div>
        </article>`).join('')}</div>`;
  }

  function renderCompanies() {
    const categories = ['Alles',...new Set(C.companies.map(co=>co.category))];
    let rows = C.companies.filter(co => (companyFilter==='Alles'||co.category===companyFilter) && (co.name.toLowerCase().includes(companySearch.toLowerCase())||co.category.toLowerCase().includes(companySearch.toLowerCase())));
    return `
      <div class="page-heading"><div><div class="eyebrow">Companies • passief inkomen</div><h1>Koop je eerste bedrijf</h1><p class="lede">Je salaris wordt automatisch iedere vijf minuten uitbetaald. Begin klein en werk toe naar technologie, industrie en wereldconcerns.</p></div><div class="panel soft"><small class="small-meta">Jouw inkomsten per ronde</small><h2 style="color:var(--orange2);margin:4px 0 0">${euro(companyIncomePerTick())}</h2><small class="small-meta">elke 5 minuten</small></div></div>
      <div class="toolbar"><div class="search-wrap"><input class="search-input" id="companySearch" placeholder="Zoek bedrijven of sector..." value="${esc(companySearch)}" /></div><span class="pill">${C.companies.length} bedrijven beschikbaar</span></div>
      <div class="tag-row" style="margin-top:12px">${categories.map(cat=>`<button class="filter-chip ${companyFilter===cat?'active':''}" data-action="company-filter" data-value="${esc(cat)}">${cat}</button>`).join('')}</div>
      <div class="company-grid">${rows.map(co=>{
        const count=Number(state.companies[co.id])||0;
        const price=co.cost*Math.pow(1.16,count);
        const can=state.balance>=cents(price);
        return `<article class="company-card"><div class="company-card-head"><div class="company-icon">${co.icon}</div><div><h3>${co.name}</h3><div class="company-category">${co.category}</div></div></div><p>${co.description}</p><div class="company-metrics"><div><small>Koopprijs</small><strong>${euro(price)}</strong></div><div><small>Salaris / 5 min</small><strong class="positive">+${euro(co.income)}</strong></div></div><div class="company-buy-row"><span class="owned">${count?`In bezit: ${count}`:'Nog niet gekocht'}</span><button class="btn tiny" data-action="buy-company" data-id="${co.id}" ${can?'':'disabled'}>Kopen</button></div></article>`;
      }).join('') || `<div class="empty-state" style="grid-column:1/-1"><div class="empty-icon">🔎</div><b>Geen bedrijven gevonden</b><p>Probeer een andere zoekterm of sector.</p></div>`}</div>`;
  }

  const MARKET_TICK_MS = 30 * 1000;
  const MARKET_HISTORY_INTERVAL_MS = 5 * 60 * 1000;
  const MARKET_HISTORY_LIMIT = 289; // 24 uur met candles van vijf minuten
  const MARKET_MAX_CATCHUP_TICKS = 30 * 24 * 60 * 2; // maximaal 30 offline dagen

  function marketHistoryFor(id) {
    return (Array.isArray(state.marketHistory[id]) ? state.marketHistory[id] : [])
      .map((point, index) => {
        if (typeof point === 'number') {
          return { at: now() - (state.marketHistory[id].length - 1 - index) * MARKET_HISTORY_INTERVAL_MS,
            open: point, high: point, low: point, close: point, price: point, volume: 0 };
        }
        const close = Number(point?.close ?? point?.price) || 0;
        if (!close) return null;
        return {
          at: Number(point.at) || now(),
          open: Number(point.open) || close,
          high: Number(point.high) || close,
          low: Number(point.low) || close,
          close, price: close,
          volume: Math.max(0, Number(point.volume) || 0)
        };
      }).filter(Boolean);
  }

  function marketChange(id) {
    const asset = C.marketAssets.find(item => item.id === id);
    if (!asset) return 0;
    const currentPrice = Number(state.marketPrices[id]) || asset.price;
    const history = marketHistoryFor(id);
    if (!history.length) return 0;
    const cutoff = now() - 24 * 60 * 60 * 1000;
    const baseline = history.find(point => point.at >= cutoff) || history[0];
    return baseline.close ? ((currentPrice - baseline.close) / baseline.close) * 100 : 0;
  }

  function marketSeed(id) {
    // Stable hash: every token has its own persistent cycle and no random numbers.
    let hash = 2166136261;
    for (const char of id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
    return (hash >>> 0) / 4294967295 * Math.PI * 2;
  }

  function marketSma(values, period) {
    if (!values.length) return 0;
    const tail = values.slice(-period);
    return tail.reduce((sum, value) => sum + value, 0) / tail.length;
  }

  // A deterministic, analysable simulation: multi-timeframe cycles, momentum,
  // mean reversion and support/resistance pressure. There is deliberately no
  // Math.random() in the market engine, so the same save and timestamps replay
  // the same market path on every device.
  function marketNextPrice(asset, price, history, tickAt, assetIndex) {
    const seed = marketSeed(asset.id);
    const tick = Math.floor(tickAt / MARKET_TICK_MS);
    const candles = history.slice(-24);
    const closes = candles.map(candle => candle.close).concat(price);
    const shortSma = marketSma(closes, 6);
    const longSma = marketSma(closes, 20);
    const previous = closes.length > 6 ? closes[closes.length - 7] : price;
    const momentum = previous ? clamp((price - previous) / previous, -0.018, 0.018) : 0;

    // Long cycle = broader trend; mid cycle = swing; short cycle = intraday rhythm.
    const macro = Math.sin(tick / 210 + seed);
    const swing = Math.sin(tick / 43 + seed * 1.73);
    const intraday = Math.sin(tick / 8.5 + seed * 2.31);
    const trend = macro * 0.00022 + swing * 0.00011;
    const momentumFollow = clamp(momentum * 0.018, -0.00016, 0.00016);
    const maPressure = longSma ? clamp((shortSma - longSma) / longSma * 0.012, -0.00012, 0.00012) : 0;
    const fairValuePull = clamp((asset.price - price) / asset.price * 0.000035, -0.00012, 0.00012);

    // Recent swing levels create visible support/resistance zones.
    const recent = candles.slice(-12);
    const resistance = recent.length ? Math.max(...recent.map(c => c.high)) : price;
    const support = recent.length ? Math.min(...recent.map(c => c.low)) : price;
    const nearResistance = resistance > 0 && price >= resistance * 0.997;
    const nearSupport = support > 0 && price <= support * 1.003;
    const levelPressure = nearResistance ? -0.00009 : nearSupport ? 0.00009 : 0;

    const volatility = Number(asset.volatility) || 0.05;
    const repeatableWave = intraday * volatility * 0.0017 + swing * volatility * 0.00065;
    const drift = trend + momentumFollow + maPressure + fairValuePull + levelPressure + repeatableWave;
    const next = clamp(price * (1 + drift), asset.price * 0.15, asset.price * 7);
    return Math.round(next * 10000) / 10000;
  }

  function updateMarketPrices() {
    const current = now();
    const elapsedTicks = Math.floor((current - (Number(state.marketUpdatedAt) || current)) / MARKET_TICK_MS);
    if (elapsedTicks <= 0) return false;

    const ticks = Math.min(elapsedTicks, MARKET_MAX_CATCHUP_TICKS);
    const simulationStart = elapsedTicks > MARKET_MAX_CATCHUP_TICKS
      ? current - ticks * MARKET_TICK_MS
      : Number(state.marketUpdatedAt) || current;

    C.marketAssets.forEach((asset, assetIndex) => {
      let price = Number(state.marketPrices[asset.id]) || asset.price;
      let history = marketHistoryFor(asset.id);
      if (!history.length) {
        const initialBarAt = Math.floor(simulationStart / MARKET_HISTORY_INTERVAL_MS) * MARKET_HISTORY_INTERVAL_MS;
        history.push({ at: initialBarAt, open: price, high: price, low: price, close: price, price, volume: 0 });
      }

      for (let step = 1; step <= ticks; step++) {
        const tickAt = simulationStart + step * MARKET_TICK_MS;
        const previousPrice = price;
        price = marketNextPrice(asset, price, history, tickAt, assetIndex);
        const bucketAt = Math.floor(tickAt / MARKET_HISTORY_INTERVAL_MS) * MARKET_HISTORY_INTERVAL_MS;
        // Volume is deterministic too and grows around larger price movement.
        const tick = Math.floor(tickAt / MARKET_TICK_MS);
        const seed = marketSeed(asset.id);
        const volumeWave = 0.7 + Math.abs(Math.sin(tick / 11 + seed)) * 0.65;
        const relativeMove = previousPrice ? Math.abs(price - previousPrice) / previousPrice : 0;
        const volume = Math.round((8 + volumeWave * 35 + relativeMove * 18000) * 100) / 100;
        let candle = history[history.length - 1];

        if (!candle || candle.at !== bucketAt) {
          candle = { at: bucketAt, open: previousPrice, high: Math.max(previousPrice, price),
            low: Math.min(previousPrice, price), close: price, price, volume: 0 };
          history.push(candle);
        }
        candle.high = Math.max(candle.high, price);
        candle.low = Math.min(candle.low, price);
        candle.close = price;
        candle.price = price; // compatibility with older save readers
        candle.volume = Math.round((candle.volume + volume) * 100) / 100;
      }

      state.marketPrices[asset.id] = Math.round(price * 100) / 100;
      state.marketHistory[asset.id] = history.slice(-MARKET_HISTORY_LIMIT);
    });

    state.marketUpdatedAt = current - (current % MARKET_TICK_MS);
    save();
    return true;
  }

  function marketIndicators(asset) {
    const history = marketHistoryFor(asset.id);
    const closes = history.map(candle => candle.close);
    const price = Number(state.marketPrices[asset.id]) || asset.price;
    closes.push(price);
    const sma7 = marketSma(closes, 7);
    const sma20 = marketSma(closes, 20);
    const sma50 = marketSma(closes, 50);
    const changes = closes.slice(-15).slice(1).map((value, index) => value - closes.slice(-15)[index]);
    const gains = changes.reduce((sum, value) => sum + Math.max(0, value), 0);
    const losses = changes.reduce((sum, value) => sum + Math.max(0, -value), 0);
    const rs = losses === 0 ? (gains > 0 ? 100 : 1) : gains / losses;
    const rsi = 100 - (100 / (1 + rs));
    const recent = history.slice(-48);
    const support = recent.length ? Math.min(...recent.map(c => c.low)) : price;
    const resistance = recent.length ? Math.max(...recent.map(c => c.high)) : price;
    const trend = sma20 > sma50 * 1.002 ? 'Stijgende trend' : sma20 < sma50 * 0.998 ? 'Dalende trend' : 'Zijwaarts';
    let signal = 'Afwachten';
    if (rsi < 34 && price >= sma7) signal = 'Mogelijke opleving';
    else if (rsi > 68 && price < sma7) signal = 'Mogelijke afkoeling';
    else if (sma7 > sma20 && sma20 >= sma50) signal = 'Bullish momentum';
    else if (sma7 < sma20 && sma20 <= sma50) signal = 'Bearish momentum';
    return { price, sma7, sma20, sma50, rsi, support, resistance, trend, signal };
  }

  function renderMarketChart() {
    const asset = C.marketAssets.find(item => item.id === selectedMarketAssetId) || C.marketAssets[0];
    if (!asset) return '';
    const all = marketHistoryFor(asset.id);
    const currentPrice = Number(state.marketPrices[asset.id]) || asset.price;
    if (!all.length) all.push({ at: now(), open: currentPrice, high: currentPrice, low: currentPrice, close: currentPrice, price: currentPrice, volume: 0 });
    const count = marketRange === '1u' ? 12 : marketRange === '6u' ? 72 : 289;
    const candles = all.slice(-count);
    const values = candles.map(c => c.close);
    const indicators = marketIndicators(asset);
    const width = 820, height = 290, left = 18, right = 18, top = 17, plotBottom = 207, volumeBottom = 266;
    const plotWidth = width - left - right;
    const lows = candles.map(c => c.low), highs = candles.map(c => c.high);
    const minPrice = Math.min(...lows, currentPrice) * 0.992;
    const maxPrice = Math.max(...highs, currentPrice) * 1.008;
    const span = Math.max(0.0001, maxPrice - minPrice);
    const y = value => top + (maxPrice - value) / span * (plotBottom - top);
    const step = plotWidth / Math.max(1, candles.length);
    const bodyWidth = Math.max(2, Math.min(9, step * 0.62));
    const maxVolume = Math.max(1, ...candles.map(c => c.volume || 0));
    const chartSupport = Math.min(...candles.map(c => c.low));
    const chartResistance = Math.max(...candles.map(c => c.high));
    const ema = (period) => {
      const alpha = 2 / (period + 1);
      let current = values[0] || currentPrice;
      return values.map(value => (current = value * alpha + current * (1 - alpha)));
    };
    const ema20 = ema(20), ema50 = ema(50);
    const line = series => series.map((value, index) => `${left + index * step + step / 2},${y(value)}`).join(' ');
    const candlesSvg = candles.map((candle, index) => {
      const x = left + index * step + step / 2;
      const up = candle.close >= candle.open;
      const color = up ? '#55c99a' : '#e87978';
      const topY = y(Math.max(candle.open, candle.close));
      const bottomY = y(Math.min(candle.open, candle.close));
      const bodyHeight = Math.max(1.5, bottomY - topY);
      const volumeHeight = (candle.volume || 0) / maxVolume * 43;
      return `<g><title>${new Date(candle.at).toLocaleString('nl-NL')} • O ${euro(candle.open)} • H ${euro(candle.high)} • L ${euro(candle.low)} • C ${euro(candle.close)} • volume ${Math.round(candle.volume||0)}</title><line x1="${x}" y1="${y(candle.high)}" x2="${x}" y2="${y(candle.low)}" stroke="${color}" stroke-width="1.2"/><rect x="${x-bodyWidth/2}" y="${topY}" width="${bodyWidth}" height="${bodyHeight}" rx="1" fill="${color}"/><rect x="${x-bodyWidth/2}" y="${volumeBottom-volumeHeight}" width="${bodyWidth}" height="${volumeHeight}" fill="${color}" opacity=".42"/></g>`;
    }).join('');
    const change = marketChange(asset.id);
    return `<section class="panel market-chart-panel">
      <div class="market-chart-head"><div><div class="eyebrow">Koersanalyse • ${asset.origin}</div><h2>${asset.icon} ${asset.name}</h2><div class="chart-current-price">${euro(currentPrice)} <span class="${change>=0?'positive':'negative'}">${change>=0?'+':''}${change.toFixed(2)}% / 24u</span></div></div>
        <div class="market-range-tabs">${['1u','6u','24u'].map(range=>`<button class="filter-chip ${marketRange===range?'active':''}" data-action="market-range" data-value="${range}">${range}</button>`).join('')}</div></div>
      <div class="market-chart-wrap"><svg class="market-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="Candlestick koersgrafiek van ${esc(asset.name)}">
        ${[0,1,2,3].map(i=>{const yy=top+i*(plotBottom-top)/3;return `<line x1="${left}" y1="${yy}" x2="${width-right}" y2="${yy}" stroke="rgba(180,200,216,.12)" stroke-dasharray="3 5"/><text x="${width-right}" y="${yy-4}" text-anchor="end" fill="#8599a9" font-size="9">${euro(maxPrice-i*span/3)}</text>`}).join('')}
        ${candlesSvg}
        ${chartSupport >= minPrice && chartSupport <= maxPrice ? `<line x1="${left}" y1="${y(chartSupport)}" x2="${width-right}" y2="${y(chartSupport)}" stroke="#55c99a" stroke-dasharray="4 4" opacity=".55"/><text x="${left+4}" y="${y(chartSupport)-4}" fill="#55c99a" font-size="9">STEUN</text>` : ''}
        ${chartResistance >= minPrice && chartResistance <= maxPrice ? `<line x1="${left}" y1="${y(chartResistance)}" x2="${width-right}" y2="${y(chartResistance)}" stroke="#e87978" stroke-dasharray="4 4" opacity=".55"/><text x="${left+4}" y="${y(chartResistance)-4}" fill="#e87978" font-size="9">WEERSTAND</text>` : ''}
        <polyline points="${line(ema20)}" fill="none" stroke="#f3bd68" stroke-width="1.6" opacity=".95"/>
        <polyline points="${line(ema50)}" fill="none" stroke="#8db8f3" stroke-width="1.5" opacity=".9"/>
        <line x1="${left}" y1="${volumeBottom+2}" x2="${width-right}" y2="${volumeBottom+2}" stroke="rgba(180,200,216,.16)"/>
        <text x="${left}" y="${height-7}" fill="#8295a5" font-size="9">${candles.length?new Date(candles[0].at).toLocaleString('nl-NL',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):''}</text>
        <text x="${width-right}" y="${height-7}" text-anchor="end" fill="#8295a5" font-size="9">${candles.length?new Date(candles[candles.length-1].at).toLocaleString('nl-NL',{hour:'2-digit',minute:'2-digit'}):''}</text>
      </svg></div>
      <div class="chart-legend"><span><i class="legend-candle"></i> Candles (5 min)</span><span><i class="legend-ema20"></i> EMA 20</span><span><i class="legend-ema50"></i> EMA 50</span><span><i class="legend-volume"></i> Volume</span><span>┄ Steun / weerstand</span></div>
      <div class="market-indicators">
        <div><small>Trend</small><b>${indicators.trend}</b></div>
        <div><small>RSI (14)</small><b class="${indicators.rsi<34?'positive':indicators.rsi>68?'negative':''}">${indicators.rsi.toFixed(1)}</b></div>
        <div><small>Steun (48 candles)</small><b>${euro(indicators.support)}</b></div>
        <div><small>Weerstand (48 candles)</small><b>${euro(indicators.resistance)}</b></div>
        <div class="market-signal"><small>Technisch signaal</small><b>${indicators.signal}</b></div>
      </div>
      <p class="hint market-chart-hint">Lees de grafiek als een trader: candles tonen open/hoog/laag/slot, EMA 20 en EMA 50 tonen kortere en langere trend, RSI helpt oververhitting herkennen en steun/weerstand tonen recente prijszones. De markt gebruikt vaste cycli en trendregels in plaats van willekeurige koerssprongen; dit blijft een spelmodel, geen zekere voorspelling.</p>
    </section>`;
  }

  function renderMarket() {
    updateMarketPrices();
    const holdingsTotal=Object.entries(state.holdings).reduce((sum,[id,qty])=>{
      const asset=C.marketAssets.find(a=>a.id===id);return sum+(asset?(state.marketPrices[id]||asset.price)*qty:0);
    },0);
    const assets=C.marketAssets.filter(asset=>marketFilter==='Alles'||asset.origin===marketFilter);
    const origins=['Alles','Nederland','Friesland','Noord-Brabant','Bollenstreek','Gouda','Amsterdam','Oranje sport'];
    return `
      <div class="page-heading"><div><div class="eyebrow">Holland_Market • fictieve handelsmarkt</div><h1>De Nederlandse markt</h1><p class="lede">Verhandel Nederlandse thema-items alsof het crypto-tokens zijn. Bestudeer trends, candles, RSI, EMA en steun/weerstand om je handelsmoment te kiezen. Koersen blijven offline bewegen.</p></div><div class="panel soft"><small class="small-meta">Portfolio-waarde</small><h2 style="color:var(--orange2);margin:4px 0 0">${euro(holdingsTotal)}</h2><small class="small-meta">${Object.values(state.holdings).reduce((a,b)=>a+b,0)} tokens in bezit</small></div></div>
      <div class="tag-row" style="margin-bottom:13px">${origins.map(o=>`<button class="filter-chip ${marketFilter===o?'active':''}" data-action="market-filter" data-value="${o}">${o}</button>`).join('')}</div>
      <div class="market-grid"><section class="panel"><div class="toolbar" style="justify-content:space-between"><h2>Tokenmarkt</h2><span class="pill">Vaste koerscycli • candles per 5 min • offline</span></div><div style="overflow-x:auto"><table class="market-table"><thead><tr><th>Item</th><th>Prijs</th><th>24u</th><th>In bezit</th><th>Actie</th></tr></thead><tbody>${assets.map(asset=>{
        const price=Number(state.marketPrices[asset.id])||asset.price;const change=marketChange(asset.id);const qty=Number(state.holdings[asset.id])||0;
        return `<tr class="${selectedMarketAssetId===asset.id?'selected-market-row':''}"><td><button class="asset-select" data-action="market-select" data-id="${asset.id}"><span class="asset-emoji">${asset.icon}</span><span><b>${asset.name}</b><small>${asset.origin}</small></span></button></td><td><b>${euro(price)}</b></td><td class="${change>=0?'positive':'negative'}">${change>=0?'+':''}${change.toFixed(1)}%</td><td>${qty}</td><td><div class="toolbar"><button class="btn tiny" data-action="market-buy" data-id="${asset.id}" ${state.balance>=cents(price)?'':'disabled'}>Koop</button><button class="btn tiny secondary" data-action="market-sell" data-id="${asset.id}" ${qty>0?'':'disabled'}>Verkoop</button></div></td></tr>`;
      }).join('')}</tbody></table></div><p class="hint" style="margin:12px 0 0">Selecteer een token om de koersgrafiek te bekijken. Oude koersdata uit je bestaande save wordt automatisch omgezet naar candles.</p></section>
      <aside class="panel"><div class="eyebrow">Mijn portefeuille</div><h2>Jouw tokens</h2>${Object.entries(state.holdings).filter(([,qty])=>qty>0).length?Object.entries(state.holdings).filter(([,qty])=>qty>0).map(([id,qty])=>{const a=C.marketAssets.find(x=>x.id===id);return `<div class="portfolio-row"><span>${a?.icon||'📦'} ${a?.name||id} <small class="small-meta">× ${qty}</small></span><b>${euro((state.marketPrices[id]||a?.price||0)*qty)}</b></div>`}).join(''):`<div class="empty-state"><div class="empty-icon">📉</div><b>Nog geen tokens</b><p>Koop een Nederlands thema-item om je portefeuille te starten.</p></div>`}</aside></div>
      ${renderMarketChart()}`;
  }

  function renderCrates() {
    const inventory=Object.entries(state.collectibles).filter(([,qty])=>qty>0).map(([id,qty])=>({item:C.loot.find(x=>x.id===id),qty})).filter(x=>x.item);
    const total=inventory.reduce((sum,x)=>sum+x.qty,0);
    return `
      <div class="page-heading"><div><div class="eyebrow">Crates • verzamel en flex</div><h1>Open bijzondere crates</h1><p class="lede">Van een simpel winkelwagentje tot de Burj Khalifa. Elke crate heeft zichtbare kansen; zeldzame items hebben hun eigen kleur en kunnen later via Holland_AH worden verhandeld.</p></div><div class="panel soft"><small class="small-meta">Collectie</small><h2 style="color:var(--orange2);margin:4px 0 0">${total} items</h2><small class="small-meta">${inventory.length} unieke items</small></div></div>
      <div class="crate-grid">${C.crates.map(crate=>`<article class="crate-card"><div class="crate-art">${crate.icon}</div><h3>${crate.name}</h3><p>${crate.desc}</p><div class="odds">${Object.entries(crate.odds).map(([r,p])=>`<span class="${r}">${C.rarities[r].label} ${p}%</span>`).join('')}</div><div class="toolbar" style="justify-content:space-between"><b style="color:var(--orange2);font-size:12px">${euro(crate.cost)}</b><button class="btn tiny" data-action="open-crate" data-id="${crate.id}" ${state.balance>=cents(crate.cost)?'':'disabled'}>Open crate</button></div></article>`).join('')}</div>
      <div class="section-label">Jouw collectie</div>
      ${inventory.length?`<div class="inventory-grid">${inventory.map(({item,qty})=>`<div class="inventory-item"><span class="loot-emoji">${item.icon}</span><span style="min-width:0"><b>${item.name}</b><small><span class="rarity ${C.rarities[item.rarity].className}">${item.rarity}</span> × ${qty}</small></span></div>`).join('')}</div>`:`<div class="empty-state"><div class="empty-icon">🎒</div><b>Je collectie is nog leeg</b><p>Speel eerst wat minigames en open je eerste crate.</p></div>`}`;
  }

  const npcListings = [
    {id:'npc-1',seller:'TulpenTycoon',itemId:'mini-windmill',name:'Eigen windmolen',icon:'🌬️',rarity:'rare',price:310},
    {id:'npc-2',seller:'FrieseKapitein',itemId:'skutsje',name:'Fries Skûtsje',icon:'⛵',rarity:'rare',price:420},
    {id:'npc-3',seller:'BredaBoss',itemId:'old-bike',name:'Tweedehands fiets',icon:'🚲',rarity:'common',price:12},
    {id:'npc-4',seller:'SkylineNL',itemId:'burj-khalifa',name:'Burj Khalifa',icon:'🏙️',rarity:'mythic',price:140000}
  ];
  function getListings() { return [...(remoteListings || []), ...npcListings, ...state.listings.filter(x=>x.status==='active')]; }
  function renderAH() {
    const listings=getListings();
    const inventory=Object.entries(state.collectibles).filter(([,qty])=>qty>0).map(([id,qty])=>({item:C.loot.find(x=>x.id===id),qty})).filter(x=>x.item);
    const myListings=[...state.listings.filter(x=>x.status==='active'),...(remoteListings||[]).filter(x=>x.seller_id===supabaseUser?.id||x.seller_username===state.username||x.seller===state.username)];
    return `
      <div class="page-heading"><div><div class="eyebrow">Holland_AH • collectibles & vriendenmarkt</div><h1>Veilinghuis Holland</h1><p class="lede">Zet crate-items te koop, koop bijzondere vondsten en bouw een collectie waar je vrienden jaloers op worden.</p></div><span class="pill">${backendStatus==='online'?'Online backend':'Lokale demo'}</span></div>
      <div class="backend-note"><span>🔌</span><span><strong>${supabaseUser ? 'Vriendenmarkt verbonden.' : 'Lokale demo-markt.'}</strong> ${supabaseUser ? 'Nieuwe aanbiedingen en aankopen worden gedeeld via Supabase.' : 'Configureer Supabase om aanbiedingen met je vrienden te delen. Lokale demo-aanbiedingen blijven beschikbaar.'}</span></div>
      <div class="ah-grid"><section class="panel"><div class="toolbar" style="justify-content:space-between;margin-bottom:12px"><h2>Actieve aanbiedingen</h2><span class="pill">${listings.length} listings</span></div>${listings.map(listing=>`<div class="listing-card"><div class="listing-art">${listing.icon||'📦'}</div><div class="listing-info"><b>${esc(listing.name)}</b><small><span class="rarity ${C.rarities[listing.rarity]?.className||'common'}">${esc(listing.rarity||'common')}</span> • verkoper: ${esc(listing.seller||listing.seller_username||'Speler')}</small></div><div class="listing-price">${euro(listing.price)}<div style="margin-top:6px"><button class="btn tiny" data-action="buy-listing" data-id="${esc(listing.id)}" ${listing.seller===state.username||listing.seller_username===state.username||state.balance<cents(listing.price)||((remoteListings||[]).some(x=>String(x.id)===String(listing.id))&&!supabaseUser)?'disabled':''}>Koop</button></div></div></div>`).join('')}</section>
      <aside class="panel"><div class="eyebrow">Eigen listing</div><h2>Verkoop een item</h2>${inventory.length?`<form id="listingForm" class="profile-form"><div><label class="label" for="listingItem">Item uit collectie</label><select class="select-field" id="listingItem" name="item" required>${inventory.map(({item,qty})=>`<option value="${item.id}">${item.icon} ${item.name} (×${qty})</option>`).join('')}</select></div><div><label class="label" for="listingPrice">Vraagprijs in Kaasmunten</label><input class="field" id="listingPrice" name="price" type="number" min="1" step="0.01" value="${inventory[0].item.value}" required /></div><button class="btn block" type="submit">Item aanbieden</button></form>`:`<div class="empty-state"><div class="empty-icon">📦</div><b>Nog niets om te verkopen</b><p>Open eerst een crate om een verzamelitem te krijgen.</p></div>`}<div class="section-label">Jouw aanbiedingen</div>${myListings.length?myListings.map(l=>`<div class="portfolio-row"><span>${l.icon||'📦'} ${esc(l.name||l.item_name)}</span><span>${euro(l.price)} <button class="btn tiny ghost" data-action="cancel-listing" data-id="${esc(l.id)}">Terug</button></span></div>`).join(''):`<p class="hint">Je hebt nog geen eigen listings geplaatst.</p>`}</aside></div>`;
  }

  const sampleLeaderboard = [
    {username:'TulpenTycoon',balance:128450.75,income:4850,companies:14},
    {username:'BredaBoss',balance:42750.20,income:2175,companies:11},
    {username:'FrieseKapitein',balance:18990.00,income:980,companies:8},
    {username:'PolderPower',balance:6240.50,income:440,companies:5},
    {username:'Oranje boven',balance:850.00,income:125,companies:3}
  ];
  function renderLeaderboard() {
    const mine={username:state.username,balance:(Number(state.balance)||0)/100,income:companyIncomePerTick(),companies:ownedCompanyCount(),me:true};
    const baseRows = remoteLeaderboard ? remoteLeaderboard.filter(x => x.username !== state.username) : sampleLeaderboard.filter(x => x.username !== state.username);
    let rows=[...baseRows,mine];
    rows=rows.sort((a,b)=>Number(b.income)-Number(a.income));
    return `
      <div class="page-heading"><div><div class="eyebrow">Leaderboard • vermogen & bedrijfsinkomen</div><h1>Wie runt het grootste imperium?</h1><p class="lede">Je ziet nu zowel het actuele Kaasmunten-saldo als het inkomen dat bedrijven iedere vijf minuten opleveren. De ranglijst blijft gesorteerd op bedrijfsinkomen.</p></div><span class="pill">${backendStatus==='online'?'Online ranking':'Demo ranking'}</span></div>
      <div class="backend-note"><span>🌐</span><span><strong>${backendStatus==='online'?'Online leaderboard actief.':'Leaderboard in demo-modus.'}</strong> ${backendStatus==='online'?'Je username, Kaasmunten-saldo en bedrijfsinkomen worden gedeeld. Je volledige save blijft privé.':'Vul de Supabase-configuratie in en voer backend/schema.sql uit om spelers met elkaar te vergelijken.'}</span></div>
      <section class="panel"><div class="toolbar" style="justify-content:space-between;margin-bottom:8px"><h2>Top bedrijvenbouwers</h2><span class="pill">Gesorteerd op inkomen / 5 min</span></div><div style="overflow-x:auto"><table class="leaderboard-table"><thead><tr><th>#</th><th>Speler</th><th>Kaasmunten</th><th>Bedrijven</th><th>Inkomen / 5 min</th></tr></thead><tbody>${rows.map((row,index)=>`<tr class="${row.me?'me':''}"><td class="rank">${index===0?'👑':index+1}</td><td><b>${esc(row.username)}</b>${row.me?' <span class="pill">JIJ</span>':''}</td><td class="positive">${euro(row.balance)}</td><td>${intFmt.format(row.companies||0)}</td><td class="positive">${euro(row.income)}</td></tr>`).join('')}</tbody></table></div></section>`;
  }

  function buyCompany(id) {
    const co=C.companies.find(x=>x.id===id); if(!co) return;
    const count=Number(state.companies[id])||0; const price=co.cost*Math.pow(1.16,count);
    if(!spendMoney(price)) { notify('Niet genoeg Kaasmunten. Speel een minigame om te verdienen.'); return; }
    if(ownedCompanyCount()===0) state.lastPayoutAt=now();
    state.companies[id]=count+1; save(); updateHeader(); renderTab();
    notify(`${co.name} gekocht! +${euro(co.income)} per 5 minuten.`);
  }
  function marketBuy(id) {
    const asset=C.marketAssets.find(x=>x.id===id); if(!asset) return;
    const price=Number(state.marketPrices[id])||asset.price;
    if(!spendMoney(price)) return notify('Niet genoeg Kaasmunten voor deze aankoop.');
    state.holdings[id]=(Number(state.holdings[id])||0)+1; save(); renderTab(); notify(`${asset.name} gekocht.`);
  }
  function marketSell(id) {
    const asset=C.marketAssets.find(x=>x.id===id); if(!asset || !(state.holdings[id]>0)) return;
    const price=Number(state.marketPrices[id])||asset.price;
    state.holdings[id]--; if(!state.holdings[id]) delete state.holdings[id];
    addMoney(price, `${asset.name} verkocht`); renderTab();
  }
  function weightedRarity(odds) {
    const entries=Object.entries(odds); const total=entries.reduce((s,[,p])=>s+p,0); let r=Math.random()*total;
    for(const [rarity,p] of entries){r-=p;if(r<=0)return rarity;}
    return entries[entries.length-1][0];
  }
  function openCrate(id) {
    const crate=C.crates.find(x=>x.id===id); if(!crate) return;
    if(!spendMoney(crate.cost)) return notify('Je hebt nog niet genoeg Kaasmunten voor deze crate.');
    const rarity=weightedRarity(crate.odds);
    let pool=C.loot.filter(x=>x.rarity===rarity);
    if(!pool.length) pool=C.loot.filter(x=>['common','uncommon','rare'].includes(x.rarity));
    const item=pool[Math.floor(Math.random()*pool.length)];
    state.collectibles[item.id]=(Number(state.collectibles[item.id])||0)+1; save(); updateHeader();
    showReveal(item,crate);
    if(activeTab==='crates') renderTab();
  }
  function showReveal(item,crate) {
    const rarity=C.rarities[item.rarity];
    $('#modalRoot').innerHTML=`<div class="modal-backdrop" data-action="backdrop-close"><section class="modal" role="dialog" aria-modal="true"><header class="modal-head"><div><div class="eyebrow">${crate.name} geopend</div><h2>Je hebt iets gevonden!</h2></div><button class="close-button" data-action="close-modal">×</button></header><div class="modal-body"><div class="reveal-card"><span class="rarity ${rarity.className}">${rarity.label}</span><div class="loot-big">${item.icon}</div><h3>${item.name}</h3><p>Geschatte verzamelwaarde: ${euro(item.value)}</p><button class="btn" data-action="close-modal">Toevoegen aan collectie</button></div></div></section></div>`;
  }
  async function buyListing(id) {
    const online=(remoteListings||[]).find(x=>String(x.id)===String(id));
    if(online) {
      if(!supabaseUser || !supabaseSession) return notify('Verbind Supabase om online aanbiedingen te kopen.');
      if(online.seller===state.username || online.seller_username===state.username) return notify('Je kunt je eigen listing niet kopen.');
      if(state.balance<cents(online.price)) return notify('Niet genoeg Kaasmunten.');
      try {
        const result=await supabaseRequest('rpc/purchase_ah_listing',{method:'POST',body:JSON.stringify({p_listing_id:id})});
        if(!result?.buyer_save) throw new Error('De server gaf geen bijgewerkte save terug. Voer de nieuwste backend/schema.sql uit.');
        state={...defaultState(),...result.buyer_save,
          companies:result.buyer_save.companies||{},holdings:result.buyer_save.holdings||{},
          collectibles:result.buyer_save.collectibles||{},listings:result.buyer_save.listings||[],
          marketPrices:result.buyer_save.marketPrices||{},marketHistory:result.buyer_save.marketHistory||{}};
        lastCloudSnapshot=JSON.parse(JSON.stringify(state));
        lastCloudUpdatedAt=Date.now();
        remoteListings=remoteListings.filter(x=>String(x.id)!==String(id));
        save(); updateHeader(); renderTab(); notify(`${online.name} gekocht van ${online.seller}!`);
      } catch(error) { notify(`Aankoop mislukt: ${error.message||error}`); }
      return;
    }
    const listing=[...npcListings,...state.listings].find(x=>String(x.id)===String(id)); if(!listing || listing.status==='sold') return;
    if(listing.seller===state.username) return notify('Je kunt je eigen listing niet kopen.');
    if(!spendMoney(listing.price)) return notify('Niet genoeg Kaasmunten.');
    if(listing.id.startsWith('npc-')) state.collectibles[listing.itemId]=(Number(state.collectibles[listing.itemId])||0)+1;
    else { listing.status='sold'; state.collectibles[listing.itemId]=(Number(state.collectibles[listing.itemId])||0)+1; }
    save(); updateHeader(); renderTab(); notify(`${listing.name} gekocht!`);
  }
  async function cancelListing(id) {
    const listing=state.listings.find(x=>String(x.id)===String(id) && x.status==='active');
    if (listing) {
      listing.status='cancelled';
      state.collectibles[listing.itemId]=(Number(state.collectibles[listing.itemId])||0)+1;
      save(); renderTab(); notify('Je item staat weer in je collectie.');
      return;
    }
    const remote=(remoteListings||[]).find(x=>String(x.id)===String(id));
    if(!remote || !supabaseUser) return notify('Deze online aanbieding kan niet vanaf deze sessie worden ingetrokken.');
    try {
      const updated=await supabaseRequest(`ah_listings?id=eq.${encodeURIComponent(id)}&seller_id=eq.${encodeURIComponent(supabaseUser.id)}&status=eq.active`, {
        method:'PATCH', headers:{Prefer:'return=representation'}, body:JSON.stringify({status:'cancelled'})
      });
      if(!Array.isArray(updated)||!updated.length) return notify('Deze aanbieding is al verkocht of ingetrokken.');
      state.collectibles[remote.item_id]=(Number(state.collectibles[remote.item_id])||0)+1;
      remoteListings=remoteListings.filter(x=>String(x.id)!==String(id));
      save(); renderTab(); notify('Je online aanbieding is ingetrokken.');
    } catch(error) { notify(`Intrekken mislukt: ${error.message||error}`); }
  }
  async function createListing(form) {
    const data=new FormData(form); const itemId=data.get('item'); const price=Number(data.get('price'));
    const item=C.loot.find(x=>x.id===itemId);
    if(!item || !Number.isFinite(price)||price<=0||!(state.collectibles[itemId]>0)) return notify('Controleer het item en de vraagprijs.');
    const normalizedPrice=Math.round(price*100)/100;
    if(supabaseUser && supabaseSession) {
      state.collectibles[itemId]--; if(!state.collectibles[itemId]) delete state.collectibles[itemId];
      save();
      try {
        // Remove the item from the cloud save before publishing the listing, so
        // another player can never buy an item that is still in the seller's save.
        await syncCloudSave();
        if(backendStatus!=='online') throw new Error('Je item kon nog niet naar de cloud worden opgeslagen. Probeer opnieuw.');
        const inserted=await supabaseRequest('ah_listings', {method:'POST',
          headers:{Prefer:'return=representation'},
          body:JSON.stringify({seller_id:supabaseUser.id,seller_username:state.username,item_id:item.id,item_name:item.name,rarity:item.rarity,price:normalizedPrice,status:'active'})
        });
        const row=Array.isArray(inserted)?inserted[0]:null;
        if(!row?.id) throw new Error('Supabase gaf geen listing-ID terug.');
        remoteListings=[{...row,id:String(row.id),price:Number(row.price)||normalizedPrice,seller:row.seller_username,name:row.item_name,icon:item.icon},...(remoteListings||[])];
        renderTab(); notify(`${item.name} staat online te koop.`);
      } catch(error) {
        state.collectibles[itemId]=(Number(state.collectibles[itemId])||0)+1;
        save(); notify(`Online aanbieden mislukt: ${error.message||error}`);
      }
      return;
    }
    state.collectibles[itemId]--; if(!state.collectibles[itemId]) delete state.collectibles[itemId];
    state.listings.unshift({id:`listing-${now()}-${Math.random().toString(36).slice(2,7)}`,seller:state.username,itemId,name:item.name,icon:item.icon,rarity:item.rarity,price:normalizedPrice,status:'active'});
    save(); renderTab(); notify(`${item.name} staat lokaal te koop.`);
  }

  function openProfile() {
    $('#modalRoot').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><header class="modal-head"><div><div class="eyebrow">Spelerprofiel</div><h2>Hoe heet jouw imperium?</h2><p>Deze naam verschijnt later op het online leaderboard.</p></div><button class="close-button" data-action="close-modal">×</button></header><div class="modal-body"><form id="profileForm" class="profile-form"><div><label class="label" for="profileName">Username</label><input id="profileName" class="field" name="username" value="${esc(state.username)}" minlength="3" maxlength="18" pattern="[A-Za-z0-9_ ]+" required /></div><p class="hint">3–18 tekens. Gebruik letters, cijfers, spaties of underscores.</p><button class="btn block" type="submit">Opslaan</button></form></div></section></div>`;
  }

  const difficultyMultipliers={Makkelijk:1,Normaal:1.45,Expert:2};
  function openGame(id) {
    const game=C.games.find(x=>x.id===id); if(!game) return;
    currentGame={game,difficulty:game.difficulty};
    renderGameIntro();
  }
  function renderGameIntro() {
    const {game,difficulty}=currentGame;
    $('#modalRoot').innerHTML=`<div class="modal-backdrop"><section class="modal wide" role="dialog" aria-modal="true"><header class="modal-head"><div><div class="eyebrow">Work • ${game.category}</div><h2>${game.icon} ${game.title}</h2><p>${game.duration} seconden • maximaal 5 minuten</p></div><button class="close-button" data-action="close-modal">×</button></header><div class="modal-body"><div class="game-start-layout"><div class="game-start-art">${game.icon}</div><div><h3>Missie-instructies</h3><ul class="instruction-list">${game.instructions.map(x=>`<li>${x}</li>`).join('')}</ul><p class="hint">Besturing: ${game.controls}</p><div class="difficulty-row"><span class="small-meta">Moeilijkheid:</span>${['Makkelijk','Normaal','Expert'].map(level=>`<button class="difficulty-button ${difficulty===level?'active':''}" data-action="difficulty" data-value="${level}">${level}${level==='Expert'?' ×2':level==='Normaal'?' ×1,45':' ×1'}</button>`).join('')}</div><p class="hint">Expert levert meer op, maar is moeilijker. Je kunt ook op beginnersniveau spelen.</p><button class="btn" data-action="start-game">Start minigame →</button></div></div></div></section></div>`;
  }

  function startGame() {
    if(!currentGame) return;
    const {game,difficulty}=currentGame;
    currentGame={...currentGame,score:0,timeLeft:game.duration,started:false,finished:false,correct:0,wrong:0,actions:0,objects:[],keys:{},questionIndex:0};
    $('#modalRoot').innerHTML=`<div class="modal-backdrop"><section class="modal wide" role="dialog" aria-modal="true"><header class="modal-head"><div><div class="eyebrow">${game.category} • ${difficulty}</div><h2>${game.icon} ${game.title}</h2><p>${game.controls}</p></div><button class="close-button" data-action="quit-game">×</button></header><div class="modal-body"><div class="arena-top"><span class="score-display">Score: <b id="gameScore">0</b></span><span class="arena-timer" id="gameTimer">${game.duration}s</span></div><div class="game-progress"><span id="gameProgress"></span></div><div id="gameArea" class="simple-game-area"></div><div class="game-controls" id="gameControls"></div></div></section></div>`;
    currentGame.started=true;
    if(game.id==='air'||game.id==='tank') initCanvasGame(game.id);
    else if(game.id==='radar') initRadarGame();
    else if(game.id==='supply') initSupplyGame();
    else if(game.id==='sort') initSortGame();
    else if(game.id==='quiz') initQuizGame();
    else if(game.id==='penalty') initPenaltyGame();
    else if(game.id==='courier') initCourierGame();
    else if(game.id==='dike') initDikeGame();
    else if(game.id==='logistics') initLogisticsGame();
    startGameClock();
  }
  function updateGameScore(value) {
    if(!currentGame || currentGame.finished) return;
    currentGame.score=clamp(value,0,100);
    $('#gameScore').textContent=Math.round(currentGame.score);
  }
  function addGameScore(value) { updateGameScore(currentGame.score + value); }
  function startGameClock() {
    currentGame.startedAt=now();
    currentGame.clock=setInterval(()=>{
      if(!currentGame||currentGame.finished) return;
      currentGame.timeLeft--;
      const timer=$('#gameTimer'),bar=$('#gameProgress');
      if(timer) timer.textContent=`${currentGame.timeLeft}s`;
      if(bar) bar.style.width=`${(currentGame.timeLeft/currentGame.game.duration)*100}%`;
      if(currentGame.timeLeft<=0) finishGame();
    },1000);
  }
  function stopGameResources() {
    if(!currentGame) return;
    clearInterval(currentGame.clock);
    if(currentGame.frame) cancelAnimationFrame(currentGame.frame);
    if(currentGame.spawnTimer) clearInterval(currentGame.spawnTimer);
    if(currentGame.logicTimer) clearInterval(currentGame.logicTimer);
    window.removeEventListener('keydown', gameKeyDown);
    window.removeEventListener('keyup', gameKeyUp);
  }
  function gameKeyDown(event) {
    if(!currentGame||currentGame.finished) return;
    currentGame.keys[event.key.toLowerCase()]=true;
    if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown',' '].includes(event.key)) event.preventDefault();
    if(event.code==='Space' && currentGame.fire) currentGame.fire();
  }
  function gameKeyUp(event) { if(currentGame) currentGame.keys[event.key.toLowerCase()]=false; }
  function finishGame() {
    if(!currentGame||currentGame.finished) return;
    const game=currentGame.game;
    currentGame.finished=true;
    stopGameResources();
    const score=Math.round(clamp(currentGame.score,0,100));
    const multiplier=difficultyMultipliers[currentGame.difficulty]||1;
    const reward=Math.round((game.base + (score/100)*(game.rate*100))*multiplier*100)/100;
    addMoney(reward, 'Minigame voltooid');
    const name=game.title;
    $('#modalRoot').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true"><div class="modal-body"><div class="game-result"><div class="result-icon">${score>=70?'🏆':'🎯'}</div><div class="eyebrow">${name} afgerond</div><h2>Netjes gewerkt!</h2><div class="result-reward">+${euro(reward)}</div><p>Je score: <b>${score}/100</b> • moeilijkheid: ${currentGame.difficulty}</p><button class="btn" data-action="game-again">Nog een keer spelen</button> <button class="btn secondary" data-action="close-to-work">Terug naar Work</button></div></div></section></div>`;
  }
  function quitGame() {
    if(currentGame) stopGameResources();
    currentGame=null; $('#modalRoot').innerHTML='';
  }

  function initCanvasGame(kind) {
    const gameArea=$('#gameArea'); gameArea.className='';
    gameArea.innerHTML=`<canvas id="gameCanvas" class="game-canvas" width="840" height="430" aria-label="${kind==='air'?'Luchtmacht oefening':'Tank oefenterrein'}"></canvas>`;
    const canvas=$('#gameCanvas'),ctx=canvas.getContext('2d');
    const g=currentGame;
    const state={x:420,y:365,bullets:[],targets:[],lastShot:0,lastSpawn:0,mouse:{x:420,y:100},health:3,world:0,keys:{}};
    g.keys=state.keys;
    const rand=(a,b)=>a+Math.random()*(b-a);
    const drawTarget=(target)=>{
      ctx.save();ctx.translate(target.x,target.y);
      if(kind==='air'){
        ctx.fillStyle='#d6e0e9';ctx.strokeStyle='#425f70';ctx.lineWidth=2;
        ctx.beginPath();ctx.moveTo(-19,0);ctx.lineTo(-5,-5);ctx.lineTo(0,-17);ctx.lineTo(6,-17);ctx.lineTo(5,-5);ctx.lineTo(19,0);ctx.lineTo(5,5);ctx.lineTo(0,15);ctx.lineTo(-5,15);ctx.lineTo(-5,5);ctx.closePath();ctx.fill();ctx.stroke();
      } else {
        ctx.fillStyle='#d76e5e';ctx.beginPath();ctx.arc(0,0,15,0,Math.PI*2);ctx.fill();ctx.strokeStyle='#ffe0a0';ctx.lineWidth=3;ctx.beginPath();ctx.arc(0,0,7,0,Math.PI*2);ctx.stroke();
      }
      ctx.restore();
    };
    function spawnTarget(){state.targets.push({x:rand(70,770),y:rand(45,180),vx:rand(-1.9,1.9),vy:kind==='tank'?rand(.45,1.15):rand(.1,.45),life:0});}
    const aim=(x,y)=>{state.mouse={x,y};};
    function shoot(){const time=now();if(time-state.lastShot<260)return;state.lastShot=time;
      if(kind==='air') state.bullets.push({x:state.x,y:state.y-21,vx:0,vy:-8.5});
      else {const dx=state.mouse.x-state.x,dy=state.mouse.y-state.y,dist=Math.hypot(dx,dy)||1;state.bullets.push({x:state.x,y:state.y,vx:dx/dist*8,vy:dy/dist*8});}
    }
    g.fire=shoot;
    canvas.addEventListener('pointermove',e=>{const r=canvas.getBoundingClientRect();aim((e.clientX-r.left)*canvas.width/r.width,(e.clientY-r.top)*canvas.height/r.height);});
    canvas.addEventListener('pointerdown',e=>{if(kind==='air')shoot();else{const r=canvas.getBoundingClientRect();aim((e.clientX-r.left)*canvas.width/r.width,(e.clientY-r.top)*canvas.height/r.height);shoot();}});
    window.addEventListener('keydown',gameKeyDown);window.addEventListener('keyup',gameKeyUp);
    if(kind==='air') { for(let i=0;i<4;i++)spawnTarget(); }
    else { for(let i=0;i<4;i++)spawnTarget(); }
    const controls=$('#gameControls');
    controls.innerHTML=kind==='air'?`<button class="btn secondary" data-action="game-steer" data-dir="left">◀ Links</button><button class="btn" data-action="game-fire">Vuur 🔥</button><button class="btn secondary" data-action="game-steer" data-dir="right">Rechts ▶</button>`:`<button class="btn secondary" data-action="game-drive" data-dir="up">▲</button><button class="btn secondary" data-action="game-drive" data-dir="left">◀</button><button class="btn secondary" data-action="game-fire">🔥 Vuur</button><button class="btn secondary" data-action="game-drive" data-dir="right">▶</button><button class="btn secondary" data-action="game-drive" data-dir="down">▼</button>`;
    let last=0;
    function draw(t){if(!currentGame||currentGame.finished)return;
      const dt=Math.min(2,(t-last)/16.67||1);last=t;state.world+=dt;
      ctx.clearRect(0,0,840,430);
      if(kind==='air'){
        ctx.fillStyle='#8fc7dc';ctx.fillRect(0,0,840,430);ctx.fillStyle='#559b72';ctx.fillRect(0,292,840,138);
        ctx.fillStyle='rgba(255,255,255,.2)';for(let i=0;i<5;i++){ctx.fillRect((i*190+state.world*1.2)%900-50,70+i*35,75,3);}
        if(state.world-state.lastSpawn>80){spawnTarget();state.lastSpawn=state.world;}
        const k=g.keys;state.x=clamp(state.x+((k.a||k.arrowleft)?-5:0)+((k.d||k.arrowright)?5:0),35,805);
        ctx.fillStyle='#eaf4f8';ctx.beginPath();ctx.moveTo(state.x,state.y-25);ctx.lineTo(state.x-21,state.y+18);ctx.lineTo(state.x,state.y+11);ctx.lineTo(state.x+21,state.y+18);ctx.closePath();ctx.fill();ctx.fillStyle='#e49c3e';ctx.fillRect(state.x-4,state.y+10,8,14);
      } else {
        ctx.fillStyle='#52784c';ctx.fillRect(0,0,840,430);ctx.strokeStyle='rgba(230,245,220,.13)';ctx.lineWidth=1;
        for(let x=0;x<840;x+=42){ctx.beginPath();ctx.moveTo(x,0);ctx.lineTo(x,430);ctx.stroke();}for(let y=0;y<430;y+=42){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(840,y);ctx.stroke();}
        for(let i=0;i<7;i++){ctx.fillStyle='rgba(30,68,42,.22)';ctx.fillRect(35+i*115,45+(i%3)*90,32,24);}
        const k=g.keys;state.x=clamp(state.x+((k.a||k.arrowleft)?-3.6:0)+((k.d||k.arrowright)?3.6:0),30,810);state.y=clamp(state.y+((k.w||k.arrowup)?-3.6:0)+((k.s||k.arrowdown)?3.6:0),30,400);
        const angle=Math.atan2(state.mouse.y-state.y,state.mouse.x-state.x);
        ctx.save();ctx.translate(state.x,state.y);ctx.rotate(angle);ctx.fillStyle='#263e2c';ctx.fillRect(-21,-15,42,30);ctx.fillStyle='#6e9360';ctx.fillRect(-14,-11,28,22);ctx.fillStyle='#c0ce8b';ctx.fillRect(0,-4,26,8);ctx.restore();
      }
      if(state.world-state.lastSpawn>70){spawnTarget();state.lastSpawn=state.world;}
      state.targets.forEach(target=>{target.x+=target.vx*dt;target.y+=target.vy*dt;if(target.x<30||target.x>810)target.vx*=-1;target.life+=dt;drawTarget(target);});
      state.bullets.forEach(b=>{b.x+=b.vx*dt;b.y+=b.vy*dt;ctx.fillStyle='#ffdb73';ctx.beginPath();ctx.arc(b.x,b.y,4,0,Math.PI*2);ctx.fill();});
      state.bullets=state.bullets.filter(b=>b.x>-10&&b.x<850&&b.y>-10&&b.y<440);
      state.targets=state.targets.filter(target=>target.life<360);
      for(let i=state.targets.length-1;i>=0;i--){const target=state.targets[i];const idx=state.bullets.findIndex(b=>Math.hypot(b.x-target.x,b.y-target.y)<19);if(idx>=0){state.targets.splice(i,1);state.bullets.splice(idx,1);g.correct++;addGameScore(kind==='air'?9:10);}}
      if(kind==='tank') {ctx.fillStyle='rgba(0,0,0,.4)';ctx.fillRect(12,12,100,28);ctx.fillStyle='#fff';ctx.font='14px system-ui';ctx.fillText('Oefendoelen: '+g.correct,21,31);}
      g.frame=requestAnimationFrame(draw);
    }
    g.frame=requestAnimationFrame(draw);
  }

  function initRadarGame() {
    const area=$('#gameArea');
    const signals=[
      {name:'Transportvliegtuig',icon:'✈️',code:'transport'},
      {name:'Helikopter',icon:'🚁',code:'heli'},
      {name:'Legervrachtwagen',icon:'🚚',code:'truck'},
      {name:'Patrouilleschip',icon:'🛥️',code:'ship'},
      {name:'Verkenningsdrone',icon:'🛸',code:'drone'},
      {name:'Tankeenheid',icon:'🪖',code:'tank'}
    ];
    function next(){
      const target=signals[Math.floor(Math.random()*signals.length)];
      const options=[target,...signals.filter(x=>x.code!==target.code).sort(()=>Math.random()-.5).slice(0,3)].sort(()=>Math.random()-.5);
      area.innerHTML=`<p class="game-prompt">Radarcontact: zoek de <b style="color:var(--orange2)">${target.name.toUpperCase()}</b></p><div class="answer-grid">${options.map(x=>`<button class="answer-button" data-action="radar-pick" data-code="${x.code}"><span class="color-option">${x.icon}</span>&nbsp; ${x.name}</button>`).join('')}</div>`;
      currentGame.radarTarget=target.code;
    }
    currentGame.pickRadar=code=>{if(code===currentGame.radarTarget){currentGame.correct++;addGameScore(10);notify('Contact correct geïdentificeerd.');}else{currentGame.wrong++;notify('Verkeerd radarsignaal.');}next();};
    next();
  }
  function initSupplyGame() {
    const area=$('#gameArea');
    currentGame.dropPosition=0;currentGame.dropDirection=1;currentGame.dropTarget=44;
    function paint(){
      const marker=$('#supplyMarker'),zone=$('#supplyZone');
      if(marker) marker.style.left=`${currentGame.dropPosition}%`;
      if(zone){zone.style.left=`${currentGame.dropTarget-7}%`;}
    }
    area.innerHTML=`<p class="game-prompt">Laat de bevoorradingskist landen in de groene zone.</p><div style="padding:33px 4px 26px"><div style="height:52px;position:relative;border-radius:10px;background:linear-gradient(90deg,#344d5b,#233b48);border:1px solid var(--line)"><div id="supplyZone" style="position:absolute;top:0;bottom:0;width:14%;border:2px solid #83dca8;background:rgba(97,201,154,.25);border-radius:7px"></div><div id="supplyMarker" style="position:absolute;top:-10px;bottom:-10px;width:5px;border-radius:5px;background:#ffcf76;box-shadow:0 0 12px #ffcf76"></div></div><div style="display:flex;justify-content:space-between;margin-top:8px;color:var(--muted);font-size:9px"><span>Links</span><span>Landing zone</span><span>Rechts</span></div></div><div style="text-align:center"><button class="btn" data-action="supply-drop">🪂 Drop supplies!</button></div>`;
    currentGame.pickDrop=()=>{
      const distance=Math.abs(currentGame.dropPosition-currentGame.dropTarget);
      if(distance<=7){currentGame.correct++;addGameScore(16);notify('Perfect landing!');}
      else if(distance<=15){currentGame.correct++;addGameScore(8);notify('Bevoorrading geland, iets naast het midden.');}
      else{currentGame.wrong++;notify('De kist landde naast de zone.');}
      currentGame.dropPosition=0;currentGame.dropDirection=1;currentGame.dropTarget=18+Math.random()*64;paint();
    };
    paint();
    currentGame.logicTimer=setInterval(()=>{
      currentGame.dropPosition+=currentGame.dropDirection*2.3;
      if(currentGame.dropPosition>=100){currentGame.dropPosition=100;currentGame.dropDirection=-1;}
      if(currentGame.dropPosition<=0){currentGame.dropPosition=0;currentGame.dropDirection=1;}
      paint();
    },55);
  }

  function initSortGame() {
    const area=$('#gameArea');
    const colors=[{name:'rood',emoji:'🌷',color:'#e75d6f'},{name:'geel',emoji:'🌼',color:'#edbf49'},{name:'paars',emoji:'🪻',color:'#b28be7'},{name:'wit',emoji:'🌸',color:'#e7e9ef'}];
    let target=colors[Math.floor(Math.random()*colors.length)];
    function show(){target=colors[Math.floor(Math.random()*colors.length)];const options=[...colors].sort(()=>Math.random()-.5);area.innerHTML=`<p class="game-prompt">Zoek de <b style="color:var(--orange2)">${target.name.toUpperCase()}</b> tulp</p><div class="answer-grid">${options.map(c=>`<button class="answer-button" data-action="sort-pick" data-color="${c.name}"><span class="color-option">${c.emoji}</span>&nbsp; ${c.name}</button>`).join('')}</div>`;}
    show();currentGame.pickSort=(name)=>{if(name===target.name){currentGame.correct++;addGameScore(8);notify('Goed gesorteerd!');}else{currentGame.wrong++;notify('Dat was een andere kleur.');}show();};
  }
  function initQuizGame() {
    const area=$('#gameArea');const questions=[...C.quizQuestions].sort(()=>Math.random()-.5).slice(0,10);currentGame.questions=questions;
    function show(){const idx=currentGame.questionIndex;if(idx>=questions.length){finishGame();return;}const q=questions[idx];const choices=q.a.map((a,i)=>({a,i})).sort(()=>Math.random()-.5);area.innerHTML=`<p class="game-prompt">Vraag ${idx+1} van ${questions.length}</p><h3 style="text-align:center;margin-bottom:16px">${q.q}</h3><div class="answer-grid">${choices.map(c=>`<button class="answer-button" data-action="quiz-pick" data-index="${c.i}">${c.a}</button>`).join('')}</div>`;}
    currentGame.pickQuiz=index=>{if(index===questions[currentGame.questionIndex].correct){currentGame.correct++;addGameScore(10);}else currentGame.wrong++;currentGame.questionIndex++;show();};show();
  }
  function initPenaltyGame() {
    const area=$('#gameArea');currentGame.shots=0;currentGame.pickPenalty=direction=>{if(currentGame.finished)return;const keeper=['left','center','right'][Math.floor(Math.random()*3)];currentGame.shots++;if(direction!==keeper){currentGame.correct++;addGameScore(12.5);notify('GOAL! Lekker geschoten.');}else{currentGame.wrong++;notify('De keeper heeft hem!');}if(currentGame.shots>=8)finishGame();else show();};
    function show(){const keeper=['links','midden','rechts'][Math.floor(Math.random()*3)];area.innerHTML=`<p class="game-prompt">Penalty ${currentGame.shots+1} / 8 • De keeper let op...</p><div style="background:linear-gradient(#4b8e71 0 66%,#357450 66%);padding:20px;border-radius:12px"><div style="margin:auto;width:min(400px,100%);height:105px;border:5px solid #f2f4e9;border-bottom:0;display:flex;align-items:center;justify-content:center;font-size:45px">🧤</div><div style="text-align:center;font-size:34px;margin-top:10px">⚽</div></div><p class="game-prompt" style="margin-top:13px">Kies een hoek om te schieten</p><div class="answer-grid" style="grid-template-columns:repeat(3,1fr)"><button class="answer-button" data-action="penalty-pick" data-dir="left">↖ Links</button><button class="answer-button" data-action="penalty-pick" data-dir="center">↑ Midden</button><button class="answer-button" data-action="penalty-pick" data-dir="right">↗ Rechts</button></div>`;}
    show();
  }
  function initCourierGame() {
    const area=$('#gameArea');currentGame.lane=1;currentGame.courierTick=0;currentGame.pickLane=lane=>{currentGame.lane=lane;};
    const lanes=['links','midden','rechts'];
    function tick(){if(!currentGame||currentGame.finished)return;currentGame.courierTick++;const obstacle=Math.floor(Math.random()*3);const pickup=Math.floor(Math.random()*3);if(obstacle===currentGame.lane){currentGame.wrong++;notify('Botsing! Probeer de volgende bezorging.');}else if(pickup===currentGame.lane){currentGame.correct++;addGameScore(8);}show(obstacle,pickup);}
    function show(obstacle=-1,pickup=-1){area.innerHTML=`<p class="game-prompt">Bezorg pakketjes door drie rijstroken. Kies jouw route!</p><div style="display:grid;grid-template-columns:repeat(3,1fr);gap:8px;background:#253f43;padding:14px;border-radius:12px;min-height:115px">${lanes.map((lane,i)=>`<div style="text-align:center;border-left:2px dashed rgba(255,255,255,.25);border-right:2px dashed rgba(255,255,255,.25);display:grid;place-items:center;gap:5px"><span>${i===obstacle?'🚧':i===pickup?'📦':' '}</span><span style="font-size:22px">${currentGame.lane===i?'🚴':' '}</span><small style="color:#dce7df">${lane}</small></div>`).join('')}</div><div class="answer-grid" style="grid-template-columns:repeat(3,1fr);margin-top:14px">${lanes.map((l,i)=>`<button class="answer-button ${currentGame.lane===i?'correct':''}" data-action="courier-lane" data-lane="${i}">${l}</button>`).join('')}</div><p class="game-prompt" style="margin:12px 0 0">Pakketjes bezorgd: ${currentGame.correct}</p>`;}
    show();currentGame.logicTimer=setInterval(tick,1450);
  }
  function initDikeGame() {
    const area=$('#gameArea');currentGame.leaks=[];currentGame.fixLeak=id=>{const idx=currentGame.leaks.findIndex(x=>x.id===id);if(idx>=0){currentGame.leaks.splice(idx,1);currentGame.correct++;addGameScore(9);show();}};
    function show(){area.innerHTML=`<p class="game-prompt">Klik snel op de lekkages om de dijk droog te houden.</p><div class="answer-grid" style="grid-template-columns:repeat(2,1fr)">${[0,1,2,3].map(id=>{const leak=currentGame.leaks.some(x=>x.id===id);return `<button class="answer-button ${leak?'wrong':''}" style="min-height:84px" data-action="fix-leak" data-id="${id}">${leak?'💦 LEK!':'🧱 Dijkvak '+(id+1)}</button>`}).join('')}</div><p class="game-prompt" style="margin-top:14px">Gedichte lekken: ${currentGame.correct}</p>`;}
    function pop(){const free=[0,1,2,3].filter(id=>!currentGame.leaks.some(x=>x.id===id));if(free.length){currentGame.leaks.push({id:free[Math.floor(Math.random()*free.length)]});show();}}
    show();currentGame.logicTimer=setInterval(pop,950);
  }
  function initLogisticsGame() {
    const area=$('#gameArea');const cargo=[{name:'Bloemen',icon:'🌷',dest:'Bloemenloods',answer:0},{name:'Containers',icon:'📦',dest:'Containerkade',answer:1},{name:'Fietsen',icon:'🚲',dest:'Fietsopslag',answer:2},{name:'Fruit',icon:'🍎',dest:'Koelopslag',answer:3}];
    currentGame.cargo=cargo;currentGame.currentCargo=null;
    function next(){const item=cargo[Math.floor(Math.random()*cargo.length)];currentGame.currentCargo=item;show();}
    function show(){const item=currentGame.currentCargo;if(!item)return;area.innerHTML=`<p class="game-prompt">Waar moet deze lading naartoe?</p><div class="reveal-card" style="margin-bottom:14px"><div class="loot-big">${item.icon}</div><h3>${item.name}</h3></div><div class="answer-grid">${['Bloemenloods','Containerkade','Fietsopslag','Koelopslag'].map((d,i)=>`<button class="answer-button" data-action="logistics-pick" data-index="${i}">${d}</button>`).join('')}</div>`;}
    currentGame.pickLogistics=index=>{if(index===currentGame.currentCargo.answer){currentGame.correct++;addGameScore(10);}else currentGame.wrong++;next();};next();
  }

  document.addEventListener('click', event => {
    const tabButton=event.target.closest('[data-tab]');
    if(tabButton){setTab(tabButton.dataset.tab);return;}
    const actionButton=event.target.closest('[data-action]');
    if(!actionButton) return;
    const action=actionButton.dataset.action;
    const id=actionButton.dataset.id;
    const value=actionButton.dataset.value;
    if(action==='work-filter'){workFilter=value;renderTab();}
    else if(action==='company-filter'){companyFilter=value;renderTab();}
    else if(action==='market-filter'){marketFilter=value;renderTab();}
    else if(action==='market-select'){selectedMarketAssetId=id;renderTab();}
    else if(action==='market-range'){marketRange=value;renderTab();}
    else if(action==='buy-company') buyCompany(id);
    else if(action==='market-buy') marketBuy(id);
    else if(action==='market-sell') marketSell(id);
    else if(action==='open-crate') openCrate(id);
    else if(action==='buy-listing') buyListing(id);
    else if(action==='cancel-listing') cancelListing(id);
    else if(action==='open-game') openGame(id);
    else if(action==='difficulty'&&currentGame){currentGame.difficulty=value;renderGameIntro();}
    else if(action==='start-game') startGame();
    else if(action==='close-modal'){if(currentGame)stopGameResources();currentGame=null;$('#modalRoot').innerHTML='';}
    else if(action==='quit-game') quitGame();
    else if(action==='game-again'){const gameId=currentGame?.game.id;const diff=currentGame?.difficulty;currentGame=null;openGame(gameId);currentGame.difficulty=diff;renderGameIntro();}
    else if(action==='close-to-work'){currentGame=null;$('#modalRoot').innerHTML='';setTab('work');}
    else if(action==='game-fire'){currentGame?.fire?.();}
    else if(action==='game-steer'||action==='game-drive'){
      if(!currentGame?.keys)return;
      const map={left:'a',right:'d',up:'w',down:'s'};const key=map[actionButton.dataset.dir];if(key){currentGame.keys[key]=true;setTimeout(()=>{if(currentGame?.keys)currentGame.keys[key]=false;},230);}
      if(action==='game-steer'&&actionButton.dataset.dir==='left')currentGame.keys.a=true;
      if(action==='game-steer'&&actionButton.dataset.dir==='right')currentGame.keys.d=true;
    }
    else if(action==='radar-pick')currentGame?.pickRadar?.(actionButton.dataset.code);
    else if(action==='supply-drop')currentGame?.pickDrop?.();
    else if(action==='sort-pick')currentGame?.pickSort?.(actionButton.dataset.color);
    else if(action==='quiz-pick')currentGame?.pickQuiz?.(Number(actionButton.dataset.index));
    else if(action==='penalty-pick')currentGame?.pickPenalty?.(actionButton.dataset.dir);
    else if(action==='courier-lane')currentGame?.pickLane?.(Number(actionButton.dataset.lane));
    else if(action==='fix-leak')currentGame?.fixLeak?.(Number(id));
    else if(action==='logistics-pick')currentGame?.pickLogistics?.(Number(actionButton.dataset.index));
    else if(action==='backdrop-close' && event.target===actionButton){if(currentGame)stopGameResources();currentGame=null;$('#modalRoot').innerHTML='';}
  });

  document.addEventListener('submit', event => {
    if(event.target.id==='profileForm'){
      event.preventDefault();const data=new FormData(event.target);const username=String(data.get('username')||'').trim();
      if(username.length<3||username.length>18)return notify('Je username moet 3 tot 18 tekens bevatten.');
      state.username=username;save();updateHeader();$('#modalRoot').innerHTML='';renderTab();notify(`Welkom, ${username}!`);
    }
    if(event.target.id==='listingForm'){event.preventDefault();createListing(event.target);}
  });
  document.addEventListener('input', event => {
    if(event.target.id==='companySearch'){
      companySearch=event.target.value;const cursor=event.target.selectionStart;
      renderTab();const next=$('#companySearch');if(next){next.focus();next.setSelectionRange(cursor,cursor);}
    }
  });
  $('#profileButton').addEventListener('click',openProfile);

  async function connectBackend() {
    const config = window.HOLLAND_CONFIG || {};
    supabaseUrl = String(config.SUPABASE_URL || '').replace(/\/$/, '');
    const anonKey = String(config.SUPABASE_ANON_KEY || '');
    const api = String(config.RENDER_API_URL || '').replace(/\/$/, '');

    // Supabase Auth uses anonymous accounts, so friends can play without a signup form.
    // Supabase stores the auth session in browser storage; the game save is stored both
    // in localStorage and in the private player_saves row belonging to that auth user.
    if (supabaseUrl && anonKey) {
      try {
        supabaseAnonKey = anonKey;
        await ensureSupabaseSession();
        supabaseUser = supabaseSession.user;
        if (!supabaseUser) throw new Error('Geen Supabase-spelersessie ontvangen.');

        const saveRows = await supabaseRequest(`player_saves?select=save_data,updated_at&user_id=eq.${encodeURIComponent(supabaseUser.id)}&limit=1`);
        const cloudRow = Array.isArray(saveRows) ? saveRows[0] : null;

        if (cloudRow?.save_data && cloudRow.save_data.version === 2) {
          const cloudState = cloudRow.save_data;
          lastCloudSnapshot = JSON.parse(JSON.stringify(cloudState));
          lastCloudUpdatedAt = Date.parse(cloudRow.updated_at || '') || 0;
          const cloudTime = Math.max(Number(cloudState.lastSeenAt) || 0, Date.parse(cloudRow.updated_at || '') || 0);
          const localTime = hasLocalSave ? Number(state.lastSeenAt) || 0 : -1;
          if (!hasLocalSave || cloudTime > localTime) {
            state = { ...defaultState(), ...cloudState,
              companies: cloudState.companies || {}, holdings: cloudState.holdings || {},
              collectibles: cloudState.collectibles || {}, listings: cloudState.listings || [],
              marketPrices: cloudState.marketPrices || {}, marketHistory: cloudState.marketHistory || {} };
            try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); hasLocalSave = true; }
            catch (storageError) { console.warn('Cloud-save geladen, maar localStorage is vol:', storageError); }
            updateHeader();
            renderTab();
          }
        }
        if (!lastCloudSnapshot) lastCloudSnapshot = JSON.parse(JSON.stringify(state));
        // Give first-time anonymous players a unique default username so the public
        // leaderboard's unique username constraint does not collide on "Nieuwe Speler".
        if (!state.username || state.username === 'Nieuwe Speler') {
          state.username = `Speler${String(supabaseUser.id).replace(/-/g, '').slice(0, 6)}`;
          try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); hasLocalSave = true; } catch (_) { /* cloud copy will still be saved */ }
        }
        backendStatus = 'online';
        // Always write once after load: creates the cloud record for first-time players
        // and pushes a newer local save when that copy is more recent.
        await syncCloudSave();

        try {
          const profiles = await supabaseRequest('player_profiles?select=username,balance,company_income,companies_count&order=company_income.desc&limit=50');
          remoteLeaderboard = (profiles || []).map(p => ({ username: p.username, balance: Number(p.balance) || 0,
            income: Number(p.company_income) || 0, companies: Number(p.companies_count) || 0 }));
        } catch (leaderboardError) {
          console.warn('Leaderboard niet beschikbaar:', leaderboardError.message || leaderboardError);
        }
        try {
          const listings = await supabaseRequest('ah_listings?select=id,seller_id,seller_username,item_id,item_name,rarity,price,status,created_at&status=eq.active&order=created_at.desc&limit=100');
          remoteListings = (listings || []).map(x => ({ ...x, id: String(x.id), price: Number(x.price) || 0,
            seller: x.seller_username, name: x.item_name,
            icon: C.loot.find(l => l.id === x.item_id)?.icon || '📦' }));
        } catch (listingError) {
          console.warn('Online Holland_AH is nog niet beschikbaar:', listingError.message || listingError);
        }
      } catch (error) {
        console.warn('Supabase niet gekoppeld; lokale saves blijven werken:', error.message || error);
        supabaseUrl = '';
        supabaseAnonKey = '';
        supabaseSession = null;
        supabaseUser = null;
        backendStatus = 'local';
      }
    }

    // Render is optional and currently supplies shared AH listings / a fallback leaderboard.
    if (api) {
      try {
        const health = await fetch(`${api}/api/health`, { cache: 'no-store' });
        if (health.ok) {
          const healthInfo = await health.json();
          if (!remoteLeaderboard && healthInfo.supabaseConfigured) {
            const leader = await fetch(`${api}/api/leaderboard`);
            if (leader.ok) {
              const json = await leader.json();
              remoteLeaderboard = json.players || json.leaderboard || [];
            }
          }
          const ah = await fetch(`${api}/api/ah/listings`);
          if (ah.ok) {
            const json = await ah.json();
            remoteListings = (json.listings || []).map(x => ({ ...x, id: String(x.id),
              seller: x.seller_username || x.seller, name: x.item_name || x.name,
              icon: x.icon || C.loot.find(l => l.id === x.item_id)?.icon || '📦' }));
          }
        }
      } catch (error) {
        console.warn('Render API niet bereikbaar; lokale game blijft werken:', error);
      }
    }

    updateHeader();
    if (activeTab === 'ah' || activeTab === 'leaderboard') renderTab();
  }

  // Keep the market and salary clock moving even while another tab is open.
  setInterval(()=>{
    settlePayouts();
    updateHeader();
    const oldMarketUpdate=state.marketUpdatedAt;
    updateMarketPrices();
    if(activeTab==='market' && state.marketUpdatedAt!==oldMarketUpdate) renderTab();
  },1000);
  setInterval(async()=>{
    if(!supabaseUrl || !supabaseSession || document.visibilityState==='hidden' || cloudSaveBusy) return;
    try {
      const changed=await mergeRemoteSaveIfNewer();
      if(changed){save();updateHeader();if(activeTab==='companies'||activeTab==='ah'||activeTab==='leaderboard')renderTab();}
      if(now()-lastSocialRefresh>60000){
        lastSocialRefresh=now();
        try {
          const profiles=await supabaseRequest('player_profiles?select=username,balance,company_income,companies_count&order=company_income.desc&limit=50');
          remoteLeaderboard=(profiles||[]).map(p=>({username:p.username,balance:Number(p.balance)||0,income:Number(p.company_income)||0,companies:Number(p.companies_count)||0}));
        } catch(error) { console.warn('Leaderboard verversen mislukt:',error.message||error); }
        try {
          const listings=await supabaseRequest('ah_listings?select=id,seller_id,seller_username,item_id,item_name,rarity,price,status,created_at&status=eq.active&order=created_at.desc&limit=100');
          remoteListings=(listings||[]).map(x=>({...x,id:String(x.id),price:Number(x.price)||0,seller:x.seller_username,name:x.item_name,icon:C.loot.find(l=>l.id===x.item_id)?.icon||'📦'}));
        } catch(error) { console.warn('Holland_AH verversen mislukt:',error.message||error); }
        if(activeTab==='ah'||activeTab==='leaderboard')renderTab();
      }
    } catch(error) { console.warn('Cloud-save verversen mislukt:',error.message||error); }
  },30000);

  // Load the cloud copy before processing offline salary rounds, so a stale local
  // save can never overwrite a newer Supabase save just because startup settled a payout.
  updateHeader();
  setTab('work');
  connectBackend().then(() => { settlePayouts(); updateHeader(); });
})();
