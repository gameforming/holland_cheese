// Tiny dependency-free DOM smoke test for the first page render and local save restore.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const read = relative => fs.readFileSync(path.join(root, relative), 'utf8');
const catalogContext = { window: {} };
vm.runInNewContext(read('js/catalog.js'), catalogContext);

const elements = new Map();
function element(id) {
  if (!elements.has(id)) elements.set(id, {
    id, innerHTML: '', textContent: '', dataset: {}, style: {},
    classList: { toggle() {}, add() {}, remove() {} },
    focus() {}, addEventListener() {}, setAttribute() {}
  });
  return elements.get(id);
}
let clickHandler = null;
const documentMock = {
  visibilityState: 'visible',
  querySelector(selector) {
    if (selector === '#profileButton') return element('profileButton');
    if (selector.startsWith('#')) return element(selector.slice(1));
    return null;
  },
  querySelectorAll(selector) {
    if (selector === '.tab') return ['work','companies','market','crates','ah','leaderboard']
      .map(tab => ({ dataset: { tab }, classList: { toggle() {} } }));
    return [];
  },
  addEventListener(type, handler) { if (type === 'click') clickHandler = handler; }
};
const savedState = {
  version: 2, username: 'SavedTest', balance: 12345, lifetimeEarned: 12345, companyEarned: 0,
  companies: {}, holdings: {}, collectibles: {}, listings: [], marketPrices: {}, marketHistory: {},
  marketUpdatedAt: Date.now(), lastPayoutAt: Date.now(), lastSeenAt: Date.now()
};
const store = new Map([['holland-game-v2-save', JSON.stringify(savedState)]]);
const context = {
  window: { HollandCatalog: catalogContext.window.HollandCatalog, HOLLAND_CONFIG: {} },
  document: documentMock,
  localStorage: { getItem: key => store.get(key) || null, setItem: (key,value) => store.set(key,value) },
  setInterval: () => 1, clearInterval() {}, setTimeout: () => 1, clearTimeout() {},
  console, Intl, Date, Math, JSON, Set, Number, String, Object, Array, RegExp, Promise, Map,
  FormData: function FormData() {}
};
vm.runInNewContext(read('js/app.js'), context);

await new Promise(resolve => setTimeout(resolve, 0));
if (!element('tabContent').innerHTML.includes('10 minigames')) throw new Error('Work tab did not render.');
if (element('balance').textContent !== '123,45') throw new Error(`Existing save was not loaded: ${element('balance').textContent}`);
if (element('usernameLabel').textContent !== 'SavedTest') throw new Error('Existing username was not restored.');
clickHandler?.({ target: { closest: selector => selector === '[data-tab]' ? { dataset: { tab: 'leaderboard' } } : null } });
const leaderboard = element('tabContent').innerHTML;
if (!leaderboard.includes('<th>Kaasmunten</th>')) throw new Error('Leaderboard does not show the Kaasmunten column.');
if (!leaderboard.includes('KM 123,45')) throw new Error('Leaderboard does not show the saved current Kaasmunten balance.');
clickHandler?.({ target: { closest: selector => selector === '[data-tab]' ? { dataset: { tab: 'market' } } : null } });
const market = element('tabContent').innerHTML;
if (!market.includes('market-chart') || !market.includes('Candles (5 min)')) throw new Error('Market candlestick chart did not render.');
if (!market.includes('EMA 20') || !market.includes('RSI (14)') || !market.includes('STEUN')) throw new Error('Market technical indicators did not render.');
console.log('Runtime smoke test passed: local save, Kaasmunten leaderboard, and market candlestick charts rendered.');
