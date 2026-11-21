// Dependency-free project smoke checks: node tests-validate.js
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const context = { window: {} };
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
vm.runInNewContext(read('js/catalog.js'), context);
const C = context.window.HollandCatalog;
const app = read('js/app.js');
const assert = (condition, message) => { if (!condition) throw new Error(message); };

assert(C.games.length >= 10, 'Expected at least 10 minigames.');
assert(C.games.every(game => game.duration > 0 && game.duration <= 300), 'Every minigame must last at most five minutes.');
assert(C.games.some(game => game.id === 'air') && C.games.some(game => game.id === 'tank'), 'Missing aircraft or tank minigame.');
assert(C.games.some(game => game.category === 'Beginner'), 'Expected beginner minigames.');
assert(C.companies.length >= 100, 'Expected at least 100 companies.');
assert(new Set(C.companies.map(company => company.id)).size === C.companies.length, 'Company IDs must be unique.');
assert(C.companies.every((company, index, all) => index === 0 || company.cost >= all[index - 1].cost), 'Companies should be sorted by their starting price.');
assert(C.companies.some(company => /hondenuitlaatservice/i.test(company.name)), 'Missing additional low-cost business choice.');
assert(C.companies.some(company => /quantumcomputerlab/i.test(company.name)), 'Missing advanced high-tier business choice.');
const lemonade = C.companies.find(company => company.id === 'lemonade');
assert(lemonade && lemonade.cost === 50 && lemonade.income === 0.5, 'Lemonade stand economy values changed.');
assert(C.companies.some(company => /loodgieter/i.test(company.name)), 'Missing plumbing company.');
assert(C.companies.some(company => /AI/i.test(company.name)), 'Missing AI company.');
assert(C.crates.length >= 5, 'Expected at least five crate tiers.');
assert(C.rarities.mythic && C.loot.some(item => item.id === 'burj-khalifa'), 'Missing mythic rarity/Burj Khalifa item.');
assert(C.loot.some(item => item.id === 'shopping-cart'), 'Missing common shopping cart item.');
assert(C.marketAssets.some(item => item.origin === 'Friesland'), 'Missing Frisian market asset.');
assert(C.marketAssets.some(item => item.origin === 'Noord-Brabant'), 'Missing Brabant market asset.');
assert(C.marketAssets.every(item => item.volatility > 0), 'Market assets need different volatility settings.');
assert(app.includes('MARKET_TICK_MS') && app.includes('MARKET_HISTORY_INTERVAL_MS'), 'Missing local simulated market clock/history.');
assert(app.includes('MARKET_MAX_CATCHUP_TICKS'), 'Missing offline market catch-up.');
assert(app.includes('Nieuwe koersen elke 30 sec • ook offline'), 'Market UI should explain offline price movement.');
assert(!C.marketAssets.some(item => /kaas/i.test(item.name)), 'Cheese must stay currency, not a market item.');

const html = read('index.html');
const sql = read('backend/schema.sql');
assert(html.includes('assets/cheese-coin.svg'), 'Missing cheese-coin SVG favicon/brand image.');
assert(!html.includes('favicon.ico'), 'The page should not request a missing favicon.ico.');
assert(html.includes('data-tab="work"') && html.includes('data-tab="companies"') && html.includes('data-tab="market"'), 'Missing core navigation tabs.');
assert(html.includes('data-tab="crates"') && html.includes('data-tab="ah"') && html.includes('data-tab="leaderboard"'), 'Missing collection/auction/leaderboard tabs.');
assert(app.includes("localStorage.setItem(SAVE_KEY"), 'Missing localStorage persistence.');
assert(app.includes('ensureSupabaseSession') && app.includes('player_saves?on_conflict=user_id'), 'Missing Supabase cloud-save integration.');
assert(!app.includes('window.supabase?.createClient'), 'Supabase should not depend on an unloaded SDK global.');
assert(app.includes("rpc/purchase_ah_listing"), 'Missing online auction purchase integration.');
assert(sql.includes('create or replace function public.purchase_ah_listing'), 'Missing atomic Holland_AH purchase function.');
assert(sql.includes('enable row level security'), 'Supabase tables must use row-level security.');

console.log(`Validated ${C.games.length} minigames, ${C.companies.length} companies, ${C.marketAssets.length} market assets, ${C.crates.length} crates, local/cloud save hooks, and online auction schema.`);
