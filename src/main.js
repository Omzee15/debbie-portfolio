import gsap from 'gsap';
import { Depot } from './depot.js';

// The seven containers. `id` matches a <section data-panel> in index.html.
const ITEMS = [
  { id: 'hello', label: ['PORT', 'FOLIO'], number: '01', color: 0xe0261c, name: 'Portfolio' },
  { id: 'services', label: ['WHAT', 'I DO'], number: '02', color: 0xe0261c, name: 'What I do' },
  { id: 'work', label: ['THE', 'WORK'], number: '03', color: 0xea5a14, name: 'The work' },
  { id: 'about', label: ['ABOUT', 'ME'], number: '04', color: 0x2344d6, name: 'About me' },
  { id: 'process', label: ['PRO', 'CESS'], number: '05', color: 0xf0a90c, name: 'Process' },
  { id: 'toolkit', label: ['TOOL', 'KIT'], number: '06', color: 0xa2a5a9, name: 'Toolkit' },
  { id: 'contact', label: ['SAY', 'HELLO'], number: '07', color: 0x2344d6, name: 'Say hello' },
];
const IDS = new Set(ITEMS.map((i) => i.id));

const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (sel) => document.querySelector(sel);
const panel = $('#panel');
const pill = $('#pill');
const pillText = $('#pill-text');
const bigword = $('#bigword');

let depot = null;
let openId = null;
let returnFocus = null;

// ─── The giant word: always exactly as wide as the viewport ───

function fitBigWord() {
  const narrow = innerWidth / innerHeight < 1.05;
  bigword.style.flexDirection = narrow ? 'column' : 'row';
  bigword.style.alignItems = 'center';
  bigword.style.top = narrow ? '33%' : '60%';
  bigword.style.fontSize = '100px';
  const spans = [...bigword.children];
  const width = narrow
    ? Math.max(...spans.map((s) => s.getBoundingClientRect().width))
    : spans.reduce((sum, s) => sum + s.getBoundingClientRect().width, 0);
  bigword.style.fontSize = `${(100 * innerWidth * (narrow ? 0.96 : 0.985)) / width}px`;
}

// ─── Contents overlay ───

function placePanel() {
  if (!depot) {
    panel.classList.add('sheet');
    return;
  }
  const r = depot.stageRect();
  panel.classList.toggle('sheet', r.width < 620 || r.height < 270);
  Object.assign(panel.style, {
    left: `${r.left}px`,
    top: `${r.top}px`,
    width: `${r.width}px`,
    height: `${r.height}px`,
  });
}

function reveal(item) {
  openId = item.id;
  document.body.classList.add('is-open');
  placePanel();
  panel.querySelectorAll('section').forEach((s) => (s.hidden = s.dataset.panel !== item.id));
  panel.hidden = false;
  panel.scrollTop = 0;
  const section = panel.querySelector(`[data-panel="${item.id}"]`);
  section.scrollTop = 0;

  gsap.killTweensOf(panel);
  gsap.set(panel, { opacity: 0 });
  gsap.to(panel, { opacity: 1, duration: reducedMotion ? 0.01 : 0.45, ease: 'power2.out' });
  if (!reducedMotion) {
    gsap.from(section.querySelectorAll('.eyebrow, h2, .lede, .col-body > *, .rows > li, .steps > li, .chips > li'), {
      y: 14, opacity: 0, duration: 0.5, stagger: 0.035, ease: 'power3.out', delay: 0.08, clearProps: 'all',
    });
  }
  setPill('Put it back ✕');
  panel.focus({ preventScroll: true });
  if (location.hash !== `#${item.id}`) history.replaceState(null, '', `#${item.id}`);
}

function conceal() {
  openId = null;
  document.body.classList.remove('is-open');
  gsap.killTweensOf(panel);
  gsap.to(panel, {
    opacity: 0,
    duration: 0.18,
    onComplete: () => { panel.hidden = true; },
  });
  setPill('Pick a container ↓');
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);
}

function setPill(text) {
  pillText.textContent = text;
}

// ─── Requests from any control ───

function request(id, trigger) {
  if (trigger) returnFocus = trigger;
  if (!depot) { // no WebGL: skip straight to the contents
    if (id) reveal(ITEMS.find((i) => i.id === id));
    else conceal();
    return;
  }
  depot.go(id);
}

document.addEventListener('click', (e) => {
  const opener = e.target.closest('[data-open]');
  const closer = e.target.closest('[data-close]');
  if (opener) request(opener.dataset.open, opener);
  else if (closer) request(null);
});

pill.addEventListener('click', () => {
  if (openId) request(null);
});

addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || !openId) return;
  request(null);
  returnFocus?.focus({ preventScroll: true });
});

document.querySelectorAll('.pile-list button').forEach((b) => {
  b.addEventListener('focus', () => depot?.hoverId(b.dataset.open));
  b.addEventListener('blur', () => depot?.hoverId(null));
});

addEventListener('hashchange', () => {
  const id = location.hash.slice(1);
  if (IDS.has(id)) request(id);
  else if (!location.hash) request(null);
});

let resizeQueued = false;
addEventListener('resize', () => {
  if (resizeQueued) return;
  resizeQueued = true;
  requestAnimationFrame(() => {
    resizeQueued = false;
    fitBigWord();
    depot?.layout();
    if (!panel.hidden) placePanel();
  });
});

// ─── Boot ───

async function boot() {
  // Container labels are drawn to canvas, so the fonts must be in before they're built.
  await Promise.allSettled([
    document.fonts.load('900 expanded 100px "Archivo Variable"'),
    document.fonts.load('800 expanded 40px "Archivo Variable"'),
    document.fonts.load('italic 400 40px "Instrument Serif"'),
  ]);
  fitBigWord();

  try {
    depot = new Depot($('#depot'), ITEMS, {
      reducedMotion,
      onReveal: reveal,
      onConceal: conceal,
      onHover: (item) => setPill(item ? `Pick up: ${item.name} ↓` : 'Pick a container ↓'),
      onFetch: (item) => setPill(`Fetching: ${item.name}…`),
    });
    depot.intro();
    if (import.meta.env.DEV) window.__depot = depot; // handy in the console while tweaking the scene
  } catch (err) {
    console.warn('WebGL unavailable, showing the plain menu instead.', err);
    document.documentElement.classList.add('no-webgl');
  }

  const fromHash = location.hash.slice(1);
  if (IDS.has(fromHash)) request(fromHash);
}

boot();
