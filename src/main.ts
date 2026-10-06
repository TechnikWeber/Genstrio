import './style.css';
import type { ExportFormat, Request, Response } from './engine/protocol';
import { GENERATOR_IDS, GENERATORS } from './generators/meta';
import { defaults, newItem, sanitize, type FieldDef, type GeneratorId, type ListParam, type Note, type Params, type Value } from './generators/types';
import { getLang, setLang, t, type Lang } from './i18n';
import { Viewer } from './viewer';

const STORAGE_KEY = 'genstrio:v2';
const FORMATS: ExportFormat[] = ['stl', '3mf', 'step'];

const ICONS: Record<GeneratorId, string> = {
  enclosure:
    '<svg viewBox="0 0 24 24"><path d="M3 8l9-4 9 4v9l-9 4-9-4z"/><path d="M3 8l9 4 9-4M12 12v9"/><path d="M15.5 15.2l3-1.3"/></svg>',
  adapter:
    '<svg viewBox="0 0 24 24"><path d="M3 8h5l7-3h6M3 16h5l7 3h6M3 8v8M21 5v14M8 8v8M15 5v14"/></svg>',
  organizer:
    '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18M10 3v9M15 12v9"/></svg>',
};

// --- state ------------------------------------------------------------------

interface Saved {
  generator?: GeneratorId;
  lang?: Lang;
  params?: Partial<Record<GeneratorId, Record<string, unknown>>>;
}

function load(): Saved {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Saved;
  } catch {
    return {};
  }
}

const saved = load();
// English unless the user picked a language themselves.
let langChosen = saved.lang === 'de' || saved.lang === 'en';
setLang(langChosen ? (saved.lang as Lang) : getLang());

let current: GeneratorId = GENERATOR_IDS.includes(saved.generator as GeneratorId) ? (saved.generator as GeneratorId) : 'enclosure';
const params = Object.fromEntries(
  GENERATOR_IDS.map((id) => [id, sanitize(GENERATORS[id], { ...defaults(GENERATORS[id]), ...saved.params?.[id] })]),
) as Record<GeneratorId, Params>;

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ generator: current, lang: langChosen ? getLang() : undefined, params }));
  } catch {
    // Private mode or blocked storage: the app works without persistence.
  }
}

// --- DOM --------------------------------------------------------------------

const $ = <T extends HTMLElement>(sel: string) => document.querySelector(sel) as T;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, props: Record<string, unknown> = {}, children: (Node | string)[] = []) => {
  const node: HTMLElementTagNameMap[K] = Object.assign(document.createElement(tag), props);
  node.append(...children);
  return node;
};

const viewer = new Viewer($('#viewer'));
const form = $<HTMLFormElement>('#params');
const statusEl = $('#status');
const notesEl = $('#notes');
const toolsEl = $('#tools');
const exportEl = $('#export');

// --- worker -----------------------------------------------------------------

const worker = new Worker(new URL('./engine/worker.ts', import.meta.url), { type: 'module' });
const post = (req: Request) => worker.postMessage(req);

let requestId = 0;
let buildId = 0;
let engineReady = false;
let fitPending = true;
let lastNotes: { notes: Note[]; error?: string } = { notes: [] };
let lastStatus: { key: string; vars?: Record<string, string | number>; busy: boolean } = { key: 'app.loading', busy: true };

function setStatus(key: string, busy: boolean, vars?: Record<string, string | number>) {
  lastStatus = { key, vars, busy };
  renderStatus();
}

function renderStatus() {
  const { key, vars, busy } = lastStatus;
  let text = t(key, vars);
  const size = viewer.size();
  if (key === 'app.done' && size) {
    const [x, y, z] = size.map((n) => Math.round(n * 10) / 10);
    text += ' · ' + t('app.size', { x, y, z });
  }
  statusEl.textContent = text;
  statusEl.classList.toggle('busy', busy);
}

function renderNotes() {
  notesEl.replaceChildren(
    ...(lastNotes.error ? [el('li', { className: 'error', textContent: t(lastNotes.error) })] : []),
    ...lastNotes.notes.map((n) => el('li', { className: n.level, textContent: t(n.key, n.vars) })),
  );
}

function rebuild() {
  buildId = ++requestId;
  post({ type: 'build', id: buildId, generator: current, params: params[current] });
  if (engineReady) statusEl.classList.add('busy');
}

let timer = 0;
function scheduleRebuild() {
  save();
  clearTimeout(timer);
  timer = window.setTimeout(rebuild, 120);
}

worker.onmessage = (event: MessageEvent<Response>) => {
  const msg = event.data;
  if (msg.type === 'ready') {
    engineReady = true;
    return;
  }
  if (msg.type === 'file') {
    const url = URL.createObjectURL(new Blob([msg.data], { type: msg.mime }));
    el('a', { href: url, download: msg.name }).click();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
    setExporting(false);
    return;
  }
  if (msg.type === 'error') {
    console.error(msg.message);
    setExporting(false);
    if (msg.id !== buildId) return;
    lastNotes = { notes: [], error: msg.key ?? 'err.generic' };
    renderNotes();
    setStatus(msg.key ?? 'err.generic', false);
    return;
  }
  if (msg.id !== buildId) return;
  viewer.show(msg.parts, msg.type === 'done' ? msg.frame : undefined);
  if (fitPending) viewer.fit();
  if (msg.type === 'stage') {
    setStatus(msg.label, true);
  } else {
    fitPending = false;
    lastNotes = { notes: msg.notes };
    renderNotes();
    setStatus('app.done', false, { ms: msg.ms });
  }
};

// --- export -----------------------------------------------------------------

let exporting = false;
let statusBeforeExport = lastStatus;
function setExporting(on: boolean) {
  exporting = on;
  for (const b of exportEl.querySelectorAll('button')) b.disabled = on;
  if (!on && lastStatus.key === 'app.exporting') {
    lastStatus = statusBeforeExport;
    renderStatus();
  }
}

function startExport(format: ExportFormat) {
  if (exporting) return;
  setExporting(true);
  statusBeforeExport = lastStatus;
  setStatus('app.exporting', true, { format: format.toUpperCase() });
  post({ type: 'export', id: ++requestId, generator: current, params: params[current], format });
}

// --- parameter form ---------------------------------------------------------

/** Re-evaluates which rows are shown; filled while the form is rendered. */
let visibility: (() => void)[] = [];

/** One input row. `values` is the object the field writes to, `key` its i18n path. */
function field(def: FieldDef, values: Params, id: string, key: string): HTMLElement {
  const label = t(`${current}.p.${key}`);
  const row = el('div', { className: `field ${def.type}` });
  const update = (value: Value) => {
    values[def.key] = value;
    applyVisibility();
    scheduleRebuild();
  };
  visibility.push(() => (row.hidden = def.showIf ? !def.showIf(values) : false));

  if (def.type === 'bool') {
    const input = el('input', { type: 'checkbox', id, checked: values[def.key] as boolean });
    input.addEventListener('change', () => update(input.checked));
    row.append(input, el('label', { htmlFor: id, textContent: label }));
  } else if (def.type === 'select') {
    const select = el('select', { id });
    for (const o of def.options) {
      const text = t(`${current}.o.${key}.${o}`);
      const plain = /^\d+$/.test(o) ? `${o} mm` : o;
      select.append(el('option', { value: o, textContent: text.startsWith(current) ? plain : text }));
    }
    select.value = values[def.key] as string;
    select.addEventListener('change', () => update(select.value));
    row.append(el('label', { htmlFor: id, textContent: label }), select);
  } else {
    const range = el('input', { type: 'range', min: String(def.min), max: String(def.sliderMax ?? def.max), step: String(def.step), tabIndex: -1 });
    const number = el('input', { type: 'number', id, min: String(def.min), max: String(def.max), step: String(def.step) });
    range.value = number.value = String(values[def.key]);
    range.setAttribute('aria-hidden', 'true');
    range.addEventListener('input', () => {
      number.value = range.value;
      update(range.valueAsNumber);
    });
    number.addEventListener('input', () => {
      if (!Number.isFinite(number.valueAsNumber)) return;
      const v = Math.min(def.max, Math.max(def.min, number.valueAsNumber));
      range.value = String(v);
      update(v);
    });
    number.addEventListener('blur', () => (number.value = String(values[def.key])));
    row.append(
      el('label', { htmlFor: id, textContent: label }),
      el('span', { className: 'num' }, [number, el('span', { className: 'unit', textContent: def.unit ?? '' })]),
      range,
    );
  }
  return row;
}

/** A list of cards, one per item, with buttons to add and remove items. */
function listField(def: ListParam): HTMLElement {
  const items = params[current][def.key] as Params[];
  const changed = () => {
    renderForm();
    scheduleRebuild();
  };
  const cards = items.map((item, i) => {
    const remove = el('button', { type: 'button', className: 'ghost', textContent: '×', title: t('app.remove') });
    remove.setAttribute('aria-label', t('app.remove'));
    remove.addEventListener('click', () => {
      items.splice(i, 1);
      changed();
    });
    const title = el('span', { textContent: `${t(`${current}.p.${def.key}.item`)} ${i + 1}` });
    return el('div', { className: 'item' }, [
      el('div', { className: 'item-head' }, [title, remove]),
      ...def.item.map((f) => field(f, item, `p-${def.key}-${i}-${f.key}`, `${def.key}.${f.key}`)),
    ]);
  });
  const add = el('button', { type: 'button', className: 'ghost add', textContent: `+ ${t(`${current}.p.${def.key}.add`)}` });
  add.disabled = items.length >= def.max;
  add.addEventListener('click', () => {
    items.push(newItem(def));
    changed();
  });
  return el('div', { className: 'list' }, [...cards, add]);
}

function applyVisibility() {
  for (const check of visibility) check();
}

function renderForm() {
  visibility = [];
  const scroll = form.scrollTop;
  const groups = new Map<string, HTMLElement>();
  for (const def of GENERATORS[current].params) {
    let group = groups.get(def.group);
    if (!group) {
      group = el('fieldset', {}, [el('legend', { textContent: t(`${current}.group.${def.group}`) })]);
      groups.set(def.group, group);
    }
    group.append(def.type === 'list' ? listField(def) : field(def, params[current], `p-${def.key}`, def.key));
  }
  form.replaceChildren(...groups.values());
  applyVisibility();
  form.scrollTop = scroll;
}

// --- chrome -----------------------------------------------------------------

function renderChrome() {
  document.title = `Genstrio – ${t(`${current}.title`)}`;
  $('#tagline').textContent = t('app.tagline');
  $('#desc').textContent = t(`${current}.desc`);
  $('#hint').textContent = t('app.viewerHint');
  $('#export-label').textContent = t('app.export');
  const fit = $<HTMLButtonElement>('#fit');
  fit.title = t('app.fit');
  fit.setAttribute('aria-label', t('app.fit'));
  $('#reset').textContent = t('app.reset');
  $('#lang').textContent = getLang() === 'de' ? 'EN' : 'DE';
  toolsEl.setAttribute('aria-label', t('app.tools'));

  toolsEl.replaceChildren(
    ...GENERATOR_IDS.map((id) => {
      const button = el('button', { type: 'button', className: id === current ? 'active' : '' });
      button.innerHTML = ICONS[id];
      button.append(el('span', { textContent: t(`${id}.title`) }));
      button.setAttribute('aria-pressed', String(id === current));
      button.addEventListener('click', () => select(id));
      return button;
    }),
  );
  renderForm();
  renderNotes();
  renderStatus();
}

function select(id: GeneratorId) {
  if (id === current) return;
  current = id;
  fitPending = true;
  lastNotes = { notes: [] };
  save();
  renderChrome();
  rebuild();
}

exportEl.append(
  ...FORMATS.map((format) => {
    const button = el('button', { type: 'button', textContent: format.toUpperCase() });
    button.addEventListener('click', () => startExport(format));
    return button;
  }),
);

$('#fit').addEventListener('click', () => viewer.fit());
$('#reset').addEventListener('click', () => {
  params[current] = defaults(GENERATORS[current]);
  fitPending = true;
  renderForm();
  scheduleRebuild();
});
$('#lang').addEventListener('click', () => {
  setLang(getLang() === 'de' ? 'en' : 'de');
  langChosen = true;
  save();
  renderChrome();
});

renderChrome();
rebuild();

// When started through ./genstrio, an open event stream tells the local
// server that a tab is still using it. On static hosting the ping just 404s.
fetch('__genstrio/ping')
  .then((res) => {
    if (res.ok && res.headers.get('x-genstrio')) new EventSource('__genstrio/alive');
  })
  .catch(() => {});
