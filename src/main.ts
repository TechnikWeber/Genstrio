import './style.css';
import type { ExportFormat, Request, Response } from './engine/protocol';
import { GENERATOR_IDS, GENERATORS } from './generators/meta';
import { defaults, fromTemplate, newItem, sanitize, type FieldDef, type GeneratorId, type ListParam, type Note, type Params, type Value } from './generators/types';
import { getLang, setLang, t, type Lang } from './i18n';
import { formatLength, fromUnit, getUnit, parseLength, setUnit, unitStep, UNITS, type Unit } from './units';
import { drawPicture, readPicture } from './picture';
import { Viewer } from './viewer';

declare const __APP_VERSION__: string;
declare const __APP_COMMIT__: string;

const STORAGE_KEY = 'genstrio:v2';
const FORMATS: ExportFormat[] = ['stl', '3mf', 'step'];

const ICONS: Record<GeneratorId, string> = {
  enclosure:
    '<svg viewBox="0 0 24 24"><path d="M3 8l9-4 9 4v9l-9 4-9-4z"/><path d="M3 8l9 4 9-4M12 12v9"/><path d="M15.5 15.2l3-1.3"/></svg>',
  adapter:
    '<svg viewBox="0 0 24 24"><path d="M3 8h5l7-3h6M3 16h5l7 3h6M3 8v8M21 5v14M8 8v8M15 5v14"/></svg>',
  organizer:
    '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18M10 3v9M15 12v9"/></svg>',
  gridfinity:
    '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="8" height="8" rx="2"/><rect x="13" y="3" width="8" height="8" rx="2"/><rect x="3" y="13" width="8" height="8" rx="2"/><rect x="13" y="13" width="8" height="8" rx="2"/></svg>',
  hook:
    '<svg viewBox="0 0 24 24"><path d="M7 3v18M7 6h.01M7 18h.01"/><path d="M7 12h6a4 4 0 0 0 4-4V6"/></svg>',
  text:
    '<svg viewBox="0 0 24 24"><rect x="2.5" y="5" width="19" height="14" rx="2.5"/><path d="M8 9.5h8M12 9.5v6"/></svg>',
  gear:
    '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2.5v3M12 18.5v3M2.5 12h3M18.5 12h3M5.3 5.3l2.1 2.1M16.6 16.6l2.1 2.1M5.3 18.7l2.1-2.1M16.6 7.4l2.1-2.1"/><circle cx="12" cy="12" r="6.5"/></svg>',
  qr:
    '<svg viewBox="0 0 24 24"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M14 14h3v3h-3zM21 14v.01M14 21v.01M21 21h-3v-3M21 17.5v.01"/></svg>',
  relief:
    '<svg viewBox="0 0 24 24"><rect x="2.5" y="4" width="19" height="16" rx="2.5"/><path d="M12 7.5l1.4 3 3.2.4-2.4 2.2.7 3.2L12 14.7l-2.9 1.6.7-3.2-2.4-2.2 3.2-.4z"/></svg>',
  cutter:
    '<svg viewBox="0 0 24 24"><path d="M12 20.5s-8-4.6-8-10.4A4.3 4.3 0 0 1 12 8a4.3 4.3 0 0 1 8 2.1c0 5.8-8 10.4-8 10.4z"/><path d="M12 16.5s-4.5-2.7-4.5-6"/></svg>',
  lithophane:
    '<svg viewBox="0 0 24 24"><rect x="3" y="4" width="18" height="16" rx="2"/><circle cx="8.5" cy="9.5" r="1.8"/><path d="M3.5 17.5l5-5 3.5 3.5 3-3 5.5 5"/></svg>',
};

// --- state ------------------------------------------------------------------

interface Saved {
  generator?: GeneratorId;
  lang?: Lang;
  unit?: Unit;
  /** Whether the notes over the preview are unfolded; unset until the user toggles them. */
  notesOpen?: boolean;
  params?: Partial<Record<GeneratorId, Record<string, unknown>>>;
  /** Which parameter groups are unfolded, by `generator.group`. */
  open?: Record<string, boolean>;
  /** Templates the user saved, by generator and name. */
  templates?: Partial<Record<GeneratorId, Record<string, Record<string, unknown>>>>;
}

function load(): Saved {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '{}') as Saved;
  } catch {
    return {};
  }
}

const saved = load();
const openGroups: Record<string, boolean> = saved.open ?? {};
const userTemplates = saved.templates ?? {};

// A shared link carries the generator and its parameters in the URL fragment.
let sharedLink = false;
try {
  const shared = JSON.parse(decodeURIComponent(escape(atob(location.hash.slice(1).replace(/-/g, '+').replace(/_/g, '/'))))) as { g: GeneratorId; p: Record<string, unknown> };
  if (GENERATOR_IDS.includes(shared.g)) {
    sharedLink = true;
    saved.generator = shared.g;
    saved.params = { ...saved.params, [shared.g]: shared.p };
  }
  history.replaceState(null, '', location.pathname + location.search);
} catch {
  // No fragment, or not one of ours.
}

function shareLink(): string {
  const json = JSON.stringify({ g: current, p: params[current] });
  const code = btoa(unescape(encodeURIComponent(json))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#${code}`;
}
// English unless the user picked a language themselves.
let langChosen = saved.lang === 'de' || saved.lang === 'en';
setLang(langChosen ? (saved.lang as Lang) : getLang());

if (UNITS.includes(saved.unit as Unit)) setUnit(saved.unit as Unit);
let notesOpen = saved.notesOpen;

let current: GeneratorId = GENERATOR_IDS.includes(saved.generator as GeneratorId) ? (saved.generator as GeneratorId) : 'enclosure';
const params = Object.fromEntries(
  GENERATOR_IDS.map((id) => [id, sanitize(GENERATORS[id], { ...defaults(GENERATORS[id]), ...saved.params?.[id] })]),
) as Record<GeneratorId, Params>;

function save() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ generator: current, lang: langChosen ? getLang() : undefined, unit: getUnit(), notesOpen, params, open: openGroups, templates: userTemplates }));
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
const notesBox = $<HTMLDetailsElement>('#notes-box');
const unitEl = $<HTMLSelectElement>('#unit');
const langEl = $<HTMLSelectElement>('#lang');
const settingsEl = $<HTMLDialogElement>('#settings');
const homeEl = $('#home');
const appEl = $('#app');
const toolsEl = $('#tools');
const exportEl = $('#export');
const templateEl = $<HTMLSelectElement>('#template');
const onlyEl = $<HTMLSelectElement>('#only');
const assembledEl = $<HTMLButtonElement>('#assembled');
const shareEl = $<HTMLButtonElement>('#share');

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
  const items = [
    ...(lastNotes.error ? [el('li', { className: 'error', textContent: t(lastNotes.error) })] : []),
    ...lastNotes.notes.map((n) => el('li', { className: n.level, textContent: t(n.key, n.vars) })),
  ];
  notesEl.replaceChildren(...items);
  notesBox.hidden = !items.length;
  // Folded until asked for, so the notes do not cover the preview.
  notesBox.open = notesOpen ?? false;
  notesBox.className = lastNotes.error ? 'error' : lastNotes.notes.some((n) => n.level === 'warn') ? 'warn' : '';
  $('#notes-label').textContent = t('app.notes', { n: items.length });
}
$('#notes-label').addEventListener('click', () => {
  notesOpen = !notesBox.open;
  save();
});

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
    renderParts(msg.parts.map((part) => part.name), msg.parts.some((part) => part.assembled));
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
  post({ type: 'export', id: ++requestId, generator: current, params: params[current], format, only: onlyEl.value || undefined });
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
  } else if (def.type === 'image') {
    const input = el('input', { type: 'file', accept: '.svg,.png,.jpg,.jpeg,.webp,.gif,.bmp,image/*', hidden: true });
    const pick = el('button', { type: 'button', id, className: 'ghost', textContent: t('app.imagePick') });
    const thumb = el('canvas', { className: 'thumb' });
    const show = () => (thumb.hidden = !drawPicture(thumb, values[def.key] as string, def.mode));
    const take = async (file?: File) => {
      if (!file) return;
      try {
        update(await readPicture(file, def.mode, def.maxSize));
        show();
      } catch {
        lastNotes = { notes: [], error: 'err.badImage' };
        renderNotes();
      }
    };
    pick.addEventListener('click', () => input.click());
    input.addEventListener('change', () => {
      void take(input.files?.[0]);
      input.value = '';
    });
    // A file may also be dropped onto the row.
    row.addEventListener('dragover', (event) => event.preventDefault());
    row.addEventListener('drop', (event) => {
      event.preventDefault();
      void take(event.dataTransfer?.files[0]);
    });
    show();
    row.append(el('label', { htmlFor: id, textContent: label }), el('div', { className: 'picture' }, [thumb, pick, el('small', { textContent: t(`app.imageHint.${def.mode}`) })]), input);
  } else if (def.type === 'text') {
    const input = def.lines
      ? el('textarea', { id, value: values[def.key] as string, maxLength: def.maxLength ?? 80, rows: 3, spellcheck: false })
      : el('input', { type: 'text', id, value: values[def.key] as string, maxLength: def.maxLength ?? 80, spellcheck: false });
    input.addEventListener('input', () => {
      const ok = new RegExp(def.pattern).test(input.value);
      input.classList.toggle('invalid', !ok);
      if (ok) update(input.value);
    });
    row.append(el('label', { htmlFor: id, textContent: label }), input);
  } else {
    const range = el('input', { type: 'range', min: String(def.min), max: String(def.sliderMax ?? def.max), step: String(def.step), tabIndex: -1 });
    // Lengths are kept in mm and shown in the chosen unit; inches may be typed as fractions.
    const length = def.unit === 'mm';
    const inches = length && getUnit() === 'in';
    const shown = (v: number) => (length ? formatLength(v) : String(v));
    const read = () => (inches ? parseLength(number.value) : length ? fromUnit(number.valueAsNumber) : number.valueAsNumber);
    const number = el('input', { type: inches ? 'text' : 'number', id, step: String(length ? unitStep(def.step) : def.step) });
    if (!inches) Object.assign(number, { min: shown(def.min), max: shown(def.max) });
    range.value = String(values[def.key]);
    number.value = shown(values[def.key] as number);
    range.setAttribute('aria-hidden', 'true');
    range.addEventListener('input', () => {
      number.value = shown(range.valueAsNumber);
      update(range.valueAsNumber);
    });
    const typed = () => {
      const raw = read();
      number.classList.toggle('invalid', inches && !Number.isFinite(raw));
      if (!Number.isFinite(raw)) return;
      const v = Math.min(def.max, Math.max(def.min, raw));
      range.value = String(v);
      update(v);
    };
    number.addEventListener('input', typed);
    // A text field has no arrows of its own.
    if (inches) {
      number.addEventListener('keydown', (event) => {
        if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;
        event.preventDefault();
        const mm = Math.min(def.max, Math.max(def.min, (values[def.key] as number) + (event.key === 'ArrowUp' ? 1 : -1) * unitStep(def.step) * 25.4));
        number.value = shown(mm);
        typed();
      });
    }
    number.addEventListener('blur', () => {
      number.value = shown(values[def.key] as number);
      number.classList.remove('invalid');
    });
    const dice = el('button', { type: 'button', className: 'ghost dice', textContent: t('app.reroll') });
    dice.addEventListener('click', () => {
      let v = values[def.key] as number;
      while (v === values[def.key]) v = def.min + Math.floor(Math.random() * (def.max - def.min + 1));
      number.value = String(v);
      update(v);
    });
    row.append(
      el('label', { htmlFor: id, textContent: label }),
      el('span', { className: 'num' }, [number, el('span', { className: 'unit', textContent: length ? getUnit() : (def.unit ?? '') })]),
      def.dice ? dice : range,
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
  // A group whose rows are all hidden disappears as a whole.
  for (const group of form.querySelectorAll<HTMLElement>('details')) {
    group.hidden = ![...group.querySelectorAll<HTMLElement>(':scope > .field, :scope > .list')].some((row) => !row.hidden);
  }
}

function renderForm() {
  visibility = [];
  const scroll = form.scrollTop;
  const groups = new Map<string, HTMLElement>();
  for (const def of GENERATORS[current].params) {
    let group = groups.get(def.group);
    if (!group) {
      // Folded by default except for the first two, so a long form stays easy to scan.
      const key = `${current}.${def.group}`;
      const details = el('details', { open: openGroups[key] ?? groups.size < 2 }, [el('summary', { textContent: t(`${current}.group.${def.group}`) })]);
      details.addEventListener('toggle', () => {
        openGroups[key] = details.open;
        save();
      });
      groups.set(def.group, (group = details));
    }
    group.append(def.type === 'list' ? listField(def) : field(def, params[current], `p-${def.key}`, def.key));
  }
  form.replaceChildren(...groups.values());
  applyVisibility();
  form.scrollTop = scroll;
}

const USER = 'user:';

function renderTemplates(selected = '') {
  const builtIn = Object.keys(GENERATORS[current].templates ?? {});
  const mine = Object.keys(userTemplates[current] ?? {});
  const group = (label: string, options: HTMLOptionElement[]) => {
    const node = el('optgroup', { label });
    node.append(...options);
    return node;
  };
  templateEl.replaceChildren(
    el('option', { value: '', textContent: t('app.template') }),
    ...(mine.length ? [group(t('app.templatesMine'), mine.map((name) => el('option', { value: USER + name, textContent: name })))] : []),
    group(t('app.templatesBuiltIn'), builtIn.map((name) => el('option', { value: name, textContent: t(`${current}.template.${name}`) }))),
  );
  templateEl.value = selected;
  templateEl.setAttribute('aria-label', t('app.template'));
  $<HTMLButtonElement>('#tpl-delete').disabled = !selected.startsWith(USER);
}

/** Switch to a generator with the given values, e.g. from a project file. */
function open(generator: GeneratorId, values: Record<string, unknown>) {
  current = generator;
  params[current] = sanitize(GENERATORS[current], values);
  fitPending = true;
  lastNotes = { notes: [] };
  save();
  show(false);
}

/** Offer the parts of the finished model for separate export and, if they fit together, the assembled view. */
let partNames = '';
function renderParts(names: string[], canAssemble: boolean) {
  assembledEl.hidden = !canAssemble;
  if (names.join() === partNames) return;
  partNames = names.join();
  const label = (name: string) => {
    const text = t(`part.${name}`);
    return text.startsWith('part.') ? name : text;
  };
  onlyEl.replaceChildren(el('option', { value: '', textContent: t('app.allParts') }), ...names.map((name) => el('option', { value: name, textContent: label(name) })));
  onlyEl.hidden = names.length < 2;
}

// --- chrome -----------------------------------------------------------------

function renderChrome() {
  // Titles may carry soft hyphens for the narrow buttons.
  const title = t(`${current}.title`).replace(/\u00ad/g, '');
  document.title = atHome ? 'Genstrio' : `Genstrio – ${title}`;
  $('#title').textContent = title;
  $('#home-tagline').textContent = t('app.tagline');
  $('#home-question').textContent = t('app.homeQuestion');
  $('#settings-title').textContent = t('app.settings');
  $('#lang-label').textContent = t('app.language');
  $('#unit-label').textContent = t('app.unit');
  $('#settings-close').textContent = t('app.close');
  for (const button of document.querySelectorAll<HTMLButtonElement>('.settings-open')) {
    button.title = t('app.settings');
    button.setAttribute('aria-label', t('app.settings'));
  }
  const homeButton = $<HTMLButtonElement>('#home-button');
  homeButton.title = t('app.home');
  homeButton.setAttribute('aria-label', t('app.home'));
  $('#desc').textContent = t(`${current}.desc`);
  $('#hint').textContent = t('app.viewerHint');
  $('#export-label').textContent = t('app.export');
  const fit = $<HTMLButtonElement>('#fit');
  fit.title = t('app.fit');
  fit.setAttribute('aria-label', t('app.fit'));
  $('#reset').textContent = t('app.reset');
  shareEl.textContent = t('app.share');
  $('#project-label').textContent = t('app.project');
  $('#tpl-save').textContent = t('app.templateSave');
  $('#tpl-delete').textContent = t('app.templateDelete');
  $('#file-save').textContent = t('app.fileSave');
  $('#file-open').textContent = t('app.fileOpen');
  $<HTMLInputElement>('#tpl-name').placeholder = t('app.templateName');
  for (const link of document.querySelectorAll('.version')) link.textContent = `Genstrio ${__APP_VERSION__}${__APP_COMMIT__ ? ` (${__APP_COMMIT__})` : ''}`;
  assembledEl.textContent = t('app.assembled');
  onlyEl.setAttribute('aria-label', t('app.parts'));
  // A mesh has no CAD geometry to write as STEP.
  for (const button of exportEl.querySelectorAll('button')) {
    const off = button.dataset.format === 'step' && GENERATORS[current].meshOnly === true;
    button.hidden = off;
  }
  partNames = '';
  renderTemplates();
  langEl.value = getLang();
  toolsEl.setAttribute('aria-label', t('app.tools'));

  // The start page: one card per generator.
  toolsEl.replaceChildren(
    ...GENERATOR_IDS.map((id) => {
      const button = el('button', { type: 'button' });
      button.innerHTML = ICONS[id];
      button.append(el('strong', { textContent: t(`${id}.title`).replace(/\u00ad/g, '') }), el('span', { textContent: t(`${id}.desc`) }));
      button.addEventListener('click', () => select(id));
      return button;
    }),
  );
  renderForm();
  renderNotes();
  renderStatus();
}

// --- start page and generator -------------------------------------------------

/** Whether the start page is showing rather than a generator. */
let atHome = true;

function show(home: boolean) {
  atHome = home;
  homeEl.hidden = !home;
  appEl.hidden = home;
  renderChrome();
  if (!home) rebuild();
}

/** Open a generator from the start page; the browser's back button leads back there. */
function select(id: GeneratorId) {
  current = id;
  fitPending = true;
  lastNotes = { notes: [] };
  save();
  if (history.state?.view !== 'app') history.pushState({ view: 'app' }, '');
  show(false);
}

$('#home-button').addEventListener('click', () => {
  // Step back if the start page is where we came from, so "forward" returns to the generator.
  if (history.state?.view === 'app' && cameFromHome) history.back();
  else show(true);
});
window.addEventListener('popstate', (event) => show((event.state as { view?: string } | null)?.view !== 'app'));
for (const button of document.querySelectorAll('.settings-open')) button.addEventListener('click', () => settingsEl.showModal());
// A click on the backdrop closes the settings, like the button does.
settingsEl.addEventListener('click', (event) => {
  if (event.target === settingsEl) settingsEl.close();
});

exportEl.append(
  ...FORMATS.map((format) => {
    const button = el('button', { type: 'button', textContent: format.toUpperCase() });
    button.dataset.format = format;
    button.addEventListener('click', () => startExport(format));
    return button;
  }),
);

$('#fit').addEventListener('click', () => viewer.fit());
assembledEl.addEventListener('click', () => {
  const on = assembledEl.getAttribute('aria-pressed') !== 'true';
  assembledEl.setAttribute('aria-pressed', String(on));
  viewer.setAssembled(on);
  viewer.fit();
  renderStatus();
});
templateEl.addEventListener('change', () => {
  const name = templateEl.value;
  $<HTMLButtonElement>('#tpl-delete').disabled = !name.startsWith(USER);
  if (!name) return;
  const mine = userTemplates[current]?.[name.slice(USER.length)];
  params[current] = name.startsWith(USER) && mine ? sanitize(GENERATORS[current], structuredClone(mine)) : fromTemplate(GENERATORS[current], name);
  fitPending = true;
  renderForm();
  scheduleRebuild();
});
$('#tpl-save').addEventListener('click', () => {
  const input = $<HTMLInputElement>('#tpl-name');
  const name = input.value.trim();
  if (!name) return input.focus();
  (userTemplates[current] ??= {})[name] = structuredClone(params[current]);
  input.value = '';
  save();
  renderTemplates(USER + name);
});
$('#tpl-delete').addEventListener('click', () => {
  delete userTemplates[current]?.[templateEl.value.slice(USER.length)];
  save();
  renderTemplates();
});
$('#file-save').addEventListener('click', () => {
  const project = { app: 'genstrio', version: __APP_VERSION__, generator: current, params: params[current] };
  const url = URL.createObjectURL(new Blob([JSON.stringify(project, null, 2)], { type: 'application/json' }));
  el('a', { href: url, download: `genstrio-${current}.json` }).click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
});
const fileInput = $<HTMLInputElement>('#file-input');
$('#file-open').addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', async () => {
  const file = fileInput.files?.[0];
  fileInput.value = '';
  if (!file) return;
  try {
    const project = JSON.parse(await file.text()) as { app?: string; generator?: GeneratorId; params?: Record<string, unknown> };
    if (project.app !== 'genstrio' || !project.generator || !GENERATOR_IDS.includes(project.generator) || !project.params) throw new Error('not a Genstrio project');
    open(project.generator, project.params);
  } catch {
    lastNotes = { notes: [], error: 'err.badFile' };
    renderNotes();
  }
});
shareEl.addEventListener('click', async () => {
  const link = shareLink();
  try {
    await navigator.clipboard.writeText(link);
    shareEl.textContent = t('app.shared');
  } catch {
    // No clipboard access: put the link in the address bar instead.
    location.hash = link.split('#')[1];
    shareEl.textContent = t('app.sharedUrl');
  }
  setTimeout(() => (shareEl.textContent = t('app.share')), 2500);
});
$('#reset').addEventListener('click', () => {
  params[current] = defaults(GENERATORS[current]);
  renderTemplates();
  fitPending = true;
  renderForm();
  scheduleRebuild();
});
unitEl.append(...UNITS.map((unit) => el('option', { value: unit, textContent: unit === 'in' ? 'inch' : unit })));
unitEl.value = getUnit();
unitEl.addEventListener('change', () => {
  setUnit(unitEl.value as Unit);
  save();
  renderForm();
  renderNotes();
  renderStatus();
});
langEl.addEventListener('change', () => {
  setLang(langEl.value as Lang);
  langChosen = true;
  save();
  renderChrome();
});

// A shared link opens its generator directly; otherwise the start page comes first.
const cameFromHome = !sharedLink;
history.replaceState({ view: sharedLink ? 'app' : 'home' }, '');
show(!sharedLink);

// When started through ./genstrio, an open event stream tells the local
// server that a tab is still using it. On static hosting the ping just 404s.
fetch('__genstrio/ping')
  .then((res) => {
    if (res.ok && res.headers.get('x-genstrio')) new EventSource('__genstrio/alive');
  })
  .catch(() => {});
