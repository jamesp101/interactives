/**
 * Data-Oriented Design — AoS vs SoA cache-line traffic.
 *
 * Entity model (fixed, no padding):
 *   struct Particle { float x, y, z; float vx, vy, vz; uint32 id; uint32 flags; }
 *   8 fields x 4 bytes = 32 bytes.
 *
 * AoS: one contiguous run of count * 32 bytes; field f of particle i is at i*32 + f*4.
 * SoA: 8 contiguous arrays end to end; field f of particle i is at f*(count*4) + i*4.
 *
 * Cache line = 64 bytes. A task defines the set of bytes it reads/writes; the hardware
 * must load every distinct 64-byte line containing at least one of those bytes.
 */

type TaskId = 'sum x' | 'update positions' | 'read ids';
type LayoutId = 'aos' | 'soa';
type ByteState = 't' | 'w' | 'c';

const LINE_BYTES = 64;
const FIELD_BYTES = 4;
const FIELD_COUNT = 8;
const STRUCT_BYTES = FIELD_COUNT * FIELD_BYTES; // 32

const FIELD_NAMES: readonly string[] = ['x', 'y', 'z', 'vx', 'vy', 'vz', 'id', 'flags'];
const TASK_ORDER: readonly TaskId[] = ['sum x', 'update positions', 'read ids'];
const COUNTS: readonly number[] = [8, 16, 32];

interface TaskDef {
  /** field indices the loop touches, ascending */
  readonly fields: readonly number[];
  /** field indices that are written back as well as read */
  readonly written: readonly number[];
  readonly note: string;
}

const TASKS: Record<TaskId, TaskDef> = {
  'sum x': {
    fields: [0],
    written: [],
    note: 'reads field x of every particle',
  },
  'update positions': {
    fields: [0, 1, 2, 3, 4, 5],
    written: [0, 1, 2],
    note: 'reads vx, vy, vz and read-modify-writes x, y, z of every particle',
  },
  'read ids': {
    fields: [6],
    written: [],
    note: 'reads field id of every particle',
  },
};

interface LayoutStats {
  readonly lines: number;
  readonly usefulBytes: number;
  readonly loadedBytes: number;
  readonly totalBytes: number;
  readonly totalLines: number;
  /** 1 per byte the task actually reads or writes */
  readonly touched: Uint8Array;
  /** 1 per 64-byte line that must be brought into cache */
  readonly lineLoaded: Uint8Array;
}

interface DodHookStats {
  lines: number;
  usefulBytes: number;
  loadedBytes: number;
}

interface DodHook {
  readonly task: string;
  readonly count: number;
  readonly aos: DodHookStats;
  readonly soa: DodHookStats;
}

declare global {
  interface Window {
    __dod?: DodHook;
  }
}

function offsetOf(layout: LayoutId, particle: number, field: number, count: number): number {
  return layout === 'aos'
    ? particle * STRUCT_BYTES + field * FIELD_BYTES
    : field * (count * FIELD_BYTES) + particle * FIELD_BYTES;
}

/** Which field does this byte belong to, and to which particle? */
function decode(
  layout: LayoutId,
  offset: number,
  count: number,
): { field: number; particle: number; byteInField: number } {
  if (layout === 'aos') {
    return {
      particle: Math.floor(offset / STRUCT_BYTES),
      field: Math.floor((offset % STRUCT_BYTES) / FIELD_BYTES),
      byteInField: offset % FIELD_BYTES,
    };
  }
  const arrayBytes = count * FIELD_BYTES;
  return {
    field: Math.floor(offset / arrayBytes),
    particle: Math.floor((offset % arrayBytes) / FIELD_BYTES),
    byteInField: offset % FIELD_BYTES,
  };
}

function compute(layout: LayoutId, task: TaskId, count: number): LayoutStats {
  const totalBytes = count * STRUCT_BYTES;
  const totalLines = Math.ceil(totalBytes / LINE_BYTES);
  const touched = new Uint8Array(totalBytes);
  const lineLoaded = new Uint8Array(totalLines);
  const fields = TASKS[task].fields;

  let usefulBytes = 0;
  for (let i = 0; i < count; i++) {
    for (const f of fields) {
      const base = offsetOf(layout, i, f, count);
      for (let b = 0; b < FIELD_BYTES; b++) {
        const off = base + b;
        if (!touched[off]) {
          touched[off] = 1;
          usefulBytes++;
        }
        lineLoaded[Math.floor(off / LINE_BYTES)] = 1;
      }
    }
  }

  let lines = 0;
  for (let l = 0; l < totalLines; l++) if (lineLoaded[l]) lines++;

  return {
    lines,
    usefulBytes,
    loadedBytes: lines * LINE_BYTES,
    totalBytes,
    totalLines,
    touched,
    lineLoaded,
  };
}

function utilization(s: LayoutStats): number {
  return s.loadedBytes === 0 ? 0 : (s.usefulBytes / s.loadedBytes) * 100;
}

function fmtPct(v: number): string {
  const rounded = Math.round(v * 10) / 10;
  return `${Number.isInteger(rounded) ? rounded.toFixed(0) : rounded.toFixed(1)}%`;
}

function fmtRatio(v: number): string {
  return `${(Math.round(v * 10) / 10).toFixed(1)}\u00d7`;
}

function hex(offset: number): string {
  return `0x${offset.toString(16).padStart(3, '0')}`;
}

function pick<T extends Element>(scope: ParentNode, selector: string): T {
  const el = scope.querySelector<T>(selector);
  if (!el) throw new Error(`data-oriented-design: missing element ${selector}`);
  return el;
}

interface Panel {
  readonly layout: LayoutId;
  readonly util: HTMLElement;
  readonly sub: HTMLElement;
  readonly stats: HTMLElement;
  readonly barUseful: HTMLElement;
  readonly barWasted: HTMLElement;
  readonly lines: HTMLElement;
}

function readPanel(root: HTMLElement, layout: LayoutId): Panel {
  const section = pick<HTMLElement>(root, `.dod-panel[data-layout="${layout}"]`);
  return {
    layout,
    util: pick<HTMLElement>(section, '.dod-panel-util'),
    sub: pick<HTMLElement>(section, '.dod-panel-sub'),
    stats: pick<HTMLElement>(section, '.dod-stats'),
    barUseful: pick<HTMLElement>(section, '.dod-bar-useful'),
    barWasted: pick<HTMLElement>(section, '.dod-bar-wasted'),
    lines: pick<HTMLElement>(section, '.dod-lines'),
  };
}

function mapHtml(layout: LayoutId, count: number, s: LayoutStats): string {
  const arrayBytes = count * FIELD_BYTES;
  const out: string[] = [];
  for (let line = 0; line < s.totalLines; line++) {
    const loaded = s.lineLoaded[line] === 1;
    out.push(`<div class="dod-line${loaded ? ' is-loaded' : ''}">`);
    out.push(`<span class="dod-line-tag">L${line} ${hex(line * LINE_BYTES)}</span>`);
    out.push('<span class="dod-line-bytes">');
    for (let b = 0; b < LINE_BYTES; b++) {
      const off = line * LINE_BYTES + b;
      if (off >= s.totalBytes) break;
      const state: ByteState = s.touched[off] === 1 ? 't' : loaded ? 'w' : 'c';
      const { field } = decode(layout, off, count);
      // field boundary every 4 bytes; entity boundary = struct start (AoS) or array start (SoA)
      const entityStart = layout === 'aos' ? off % STRUCT_BYTES === 0 : off % arrayBytes === 0;
      const boundary = entityStart ? 'e' : off % FIELD_BYTES === 0 ? 'f' : '';
      out.push(
        `<span class="dod-byte" data-f="${field}" data-s="${state}" data-b="${boundary}" data-o="${off}"></span>`,
      );
    }
    out.push('</span>');
    out.push(
      `<span class="dod-line-hit">${loaded ? `loaded (+${LINE_BYTES} B)` : 'never loaded'}</span>`,
    );
    out.push('</div>');
  }
  return out.join('');
}

function statsHtml(s: LayoutStats): string {
  const wasted = s.loadedBytes - s.usefulBytes;
  return [
    `<span>lines loaded <b>${s.lines} / ${s.totalLines}</b></span>`,
    `<span>useful bytes <b>${s.usefulBytes} B</b></span>`,
    `<span>loaded bytes <b>${s.loadedBytes} B</b></span>`,
    `<span>wasted <b>${wasted} B</b></span>`,
    `<span>utilization <b>${fmtPct(utilization(s))}</b></span>`,
  ].join('');
}

/** column the trailing `//` comments in the generated C snippet line up at */
const CODE_COMMENT_COL = 44;

/** pad `code` so its trailing comment starts at CODE_COMMENT_COL, always keeping a 2-space gap */
function codeLine(code: string, comment: string): string {
  return code.padEnd(Math.max(CODE_COMMENT_COL, code.length + 2)) + comment;
}

function declarationsCode(count: number): string {
  return [
    codeLine('struct Particle {', '// 8 fields x 4 B = 32 B, no padding'),
    '  float    x, y, z;',
    '  float    vx, vy, vz;',
    '  uint32_t id;',
    '  uint32_t flags;',
    '};',
    '',
    `// AoS: one contiguous run of ${count} x 32 B = ${count * STRUCT_BYTES} B`,
    codeLine(`Particle aos[${count}];`, '// &aos[i].f  ==  base + i*32 + f*4'),
    '',
    `// SoA: 8 contiguous arrays, ${count * FIELD_BYTES} B each, laid end to end`,
    'struct Particles {',
    `  float    x[${count}], y[${count}], z[${count}];`,
    `  float    vx[${count}], vy[${count}], vz[${count}];`,
    `  uint32_t id[${count}], flags[${count}];`,
    codeLine('} soa;', `// &soa.f[i]  ==  base + f*(${count}*4) + i*4`),
  ].join('\n');
}

function loopCode(task: TaskId, count: number): string {
  switch (task) {
    case 'sum x':
      return [
        `// task: sum x  —  ${TASKS['sum x'].note}`,
        'float sum = 0;',
        codeLine(`for (int i = 0; i < ${count}; i++) sum += aos[i].x;`, '// AoS: 4 B per 32 B stride'),
        codeLine(`for (int i = 0; i < ${count}; i++) sum += soa.x[i];`, '// SoA: dense 4 B stride'),
      ].join('\n');
    case 'read ids':
      return [
        `// task: read ids  —  ${TASKS['read ids'].note}`,
        codeLine(
          `for (int i = 0; i < ${count}; i++) out[i] = aos[i].id;`,
          '// AoS: 4 B per 32 B stride',
        ),
        codeLine(
          `for (int i = 0; i < ${count}; i++) out[i] = soa.id[i];`,
          '// SoA: dense 4 B stride',
        ),
      ].join('\n');
    case 'update positions':
      return [
        `// task: update positions  —  ${TASKS['update positions'].note}`,
        codeLine(`for (int i = 0; i < ${count}; i++) {`, '// AoS: 24 of every 32 B are used'),
        '  aos[i].x += aos[i].vx;',
        '  aos[i].y += aos[i].vy;',
        '  aos[i].z += aos[i].vz;',
        '}',
        codeLine(`for (int i = 0; i < ${count}; i++) {`, '// SoA: 6 dense array walks'),
        '  soa.x[i] += soa.vx[i];',
        '  soa.y[i] += soa.vy[i];',
        '  soa.z[i] += soa.vz[i];',
        '}',
      ].join('\n');
  }
}

function tableHtml(count: number, current: TaskId): string {
  return TASK_ORDER.map((t) => {
    const aos = compute('aos', t, count);
    const soa = compute('soa', t, count);
    const ratio = soa.loadedBytes === 0 ? 1 : aos.loadedBytes / soa.loadedBytes;
    const fields = TASKS[t].fields.length;
    return [
      `<tr${t === current ? ' class="dod-row-active"' : ''}>`,
      `<td>${t}</td>`,
      `<td>${fields} / ${FIELD_COUNT}</td>`,
      `<td>${aos.lines}</td>`,
      `<td>${fmtPct(utilization(aos))}</td>`,
      `<td>${soa.lines}</td>`,
      `<td>${fmtPct(utilization(soa))}</td>`,
      `<td>${fmtRatio(ratio)}</td>`,
      '</tr>',
    ].join('');
  }).join('');
}

function verdictHtml(aos: LayoutStats, soa: LayoutStats): string {
  const ratio = soa.loadedBytes === 0 ? 1 : aos.loadedBytes / soa.loadedBytes;
  const head = `SoA loads ${soa.lines} line${soa.lines === 1 ? '' : 's'} vs AoS ${aos.lines}`;
  if (aos.loadedBytes === soa.loadedBytes) {
    return `${head} — <b>identical memory traffic</b> for this task: both layouts pull ${aos.loadedBytes} B to use ${aos.usefulBytes} B.`;
  }
  const better = ratio > 1;
  const factor = fmtRatio(better ? ratio : 1 / ratio);
  const winner = better ? 'SoA' : 'AoS';
  return (
    `${head} — <b>${factor} less memory traffic</b> for ${winner}: ` +
    `${soa.loadedBytes} B vs ${aos.loadedBytes} B loaded, for the same ${aos.usefulBytes} B of useful data.`
  );
}

function lessonHtml(count: number): string {
  const sxA = compute('aos', 'sum x', count);
  const sxS = compute('soa', 'sum x', count);
  const upA = compute('aos', 'update positions', count);
  const upS = compute('soa', 'update positions', count);
  const sxRatio = sxA.loadedBytes / sxS.loadedBytes;
  const upRatio = upA.loadedBytes / upS.loadedBytes;
  const perLine = LINE_BYTES / STRUCT_BYTES;

  return (
    `The layout never wins on its own — the win is exactly the fraction of each struct the loop ignores. ` +
    `A 64 B line holds ${perLine} whole particles, so with ${count} particles AoS occupies ` +
    `${sxA.totalBytes} B in ${sxA.totalLines} lines. <b>update positions</b> touches ` +
    `${TASKS['update positions'].fields.length} of ${FIELD_COUNT} fields, so AoS already uses ` +
    `${upA.usefulBytes} of the ${upA.loadedBytes} B it loads (${fmtPct(utilization(upA))}); SoA removes only the ` +
    `remaining ${upA.loadedBytes - upA.usefulBytes} B, worth ${fmtRatio(upRatio)}. ` +
    `<b>sum x</b> is the extreme case: it touches 1 of ${FIELD_COUNT} fields, yet the 32 B stride still hits ` +
    `every one of the ${sxA.totalLines} lines, so AoS loads ${sxA.loadedBytes} B to use ${sxA.usefulBytes} B ` +
    `(${fmtPct(utilization(sxA))}) while SoA loads ${sxS.loadedBytes} B at ${fmtPct(utilization(sxS))} — ` +
    `${fmtRatio(sxRatio)}. Split the hot fields out when your loops are narrow; keep the struct together when ` +
    `they read nearly all of it.`
  );
}

function taskNote(task: TaskId, count: number, aos: LayoutStats): string {
  const def = TASKS[task];
  const names = def.fields.map((f) => FIELD_NAMES[f] ?? '?');
  const written = def.written.map((f) => FIELD_NAMES[f] ?? '?');
  const rw = written.length > 0 ? ` (${written.join(', ')} are read-modify-written)` : '';
  return (
    `Touches ${names.length} of ${FIELD_COUNT} fields — ${names.join(', ')}${rw}. ` +
    `Useful work is the same in both layouts: ${count} particles \u00d7 ${names.length} fields \u00d7 ${FIELD_BYTES} B = ` +
    `${aos.usefulBytes} B. Only the traffic to get it differs.`
  );
}

function readoutFor(layout: LayoutId, offset: number, count: number, s: LayoutStats): string {
  const { field, particle, byteInField } = decode(layout, offset, count);
  const name = FIELD_NAMES[field] ?? '?';
  const line = Math.floor(offset / LINE_BYTES);
  const loaded = s.lineLoaded[line] === 1;
  const touched = s.touched[offset] === 1;
  const state = touched
    ? 'touched by the task — useful byte'
    : loaded
      ? 'wasted — inside a loaded line but never used'
      : 'never loaded — this line stays out of cache';
  const where =
    layout === 'aos'
      ? `aos[${particle}].${name}, byte ${byteInField} of 4`
      : `soa.${name}[${particle}], byte ${byteInField} of 4`;
  return `${layout === 'aos' ? 'AoS' : 'SoA'} · ${hex(offset)} (${offset}) · ${where} · line L${line} · ${state}`;
}

export function initDod(root: HTMLElement): void {
  const taskChips = Array.from(root.querySelectorAll<HTMLButtonElement>('.dod-task-chips .chip'));
  const countChips = Array.from(root.querySelectorAll<HTMLButtonElement>('.dod-count-chips .chip'));
  const noteEl = pick<HTMLElement>(root, '.dod-task-note');
  const verdictEl = pick<HTMLElement>(root, '.dod-verdict');
  const readoutEl = pick<HTMLElement>(root, '.dod-readout');
  const codeEl = pick<HTMLElement>(root, '.dod-code');
  const tbodyEl = pick<HTMLElement>(root, '.dod-tbody');
  const lessonEl = pick<HTMLElement>(root, '.dod-lesson');
  const panels: readonly Panel[] = [readPanel(root, 'aos'), readPanel(root, 'soa')];

  const READOUT_IDLE = 'Hover any byte to see which particle and field it belongs to.';

  let task: TaskId = 'sum x';
  let count = 16;
  let stats: Record<LayoutId, LayoutStats> = {
    aos: compute('aos', task, count),
    soa: compute('soa', task, count),
  };

  function render(): void {
    stats = { aos: compute('aos', task, count), soa: compute('soa', task, count) };

    for (const chip of taskChips) {
      const active = chip.dataset['task'] === task;
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-pressed', String(active));
    }
    for (const chip of countChips) {
      const active = Number(chip.dataset['count']) === count;
      chip.classList.toggle('active', active);
      chip.setAttribute('aria-pressed', String(active));
    }

    noteEl.textContent = taskNote(task, count, stats.aos);
    verdictEl.innerHTML = verdictHtml(stats.aos, stats.soa);
    codeEl.textContent = `${declarationsCode(count)}\n\n${loopCode(task, count)}`;
    tbodyEl.innerHTML = tableHtml(count, task);
    lessonEl.innerHTML = lessonHtml(count);
    readoutEl.textContent = READOUT_IDLE;

    for (const panel of panels) {
      const s = stats[panel.layout];
      const util = utilization(s);
      panel.util.textContent = `${fmtPct(util)} utilization`;
      panel.sub.textContent =
        panel.layout === 'aos'
          ? `Particle aos[${count}] — ${count} \u00d7 32 B contiguous; &aos[i].f = i*32 + f*4`
          : `8 arrays of ${count} — ${count * FIELD_BYTES} B each; &soa.f[i] = f*(${count}*4) + i*4`;
      panel.stats.innerHTML = statsHtml(s);
      panel.barUseful.style.width = `${util}%`;
      panel.barWasted.style.width = `${100 - util}%`;
      panel.barUseful.title = `${s.usefulBytes} B useful`;
      panel.barWasted.title = `${s.loadedBytes - s.usefulBytes} B wasted`;
      panel.lines.innerHTML = mapHtml(panel.layout, count, s);
    }
  }

  for (const chip of taskChips) {
    chip.addEventListener('click', () => {
      const next = chip.dataset['task'];
      if (!next || !TASK_ORDER.includes(next as TaskId)) return;
      task = next as TaskId;
      render();
    });
  }

  for (const chip of countChips) {
    chip.addEventListener('click', () => {
      const next = Number(chip.dataset['count']);
      if (!COUNTS.includes(next)) return;
      count = next;
      render();
    });
  }

  for (const panel of panels) {
    panel.lines.addEventListener('mouseover', (event: MouseEvent) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.classList.contains('dod-byte')) return;
      const offset = Number(target.dataset['o']);
      if (!Number.isFinite(offset)) return;
      readoutEl.textContent = readoutFor(panel.layout, offset, count, stats[panel.layout]);
    });
    panel.lines.addEventListener('mouseleave', () => {
      readoutEl.textContent = READOUT_IDLE;
    });
  }

  render();

  const hook: DodHook = {
    get task() {
      return task;
    },
    get count() {
      return count;
    },
    get aos() {
      return {
        lines: stats.aos.lines,
        usefulBytes: stats.aos.usefulBytes,
        loadedBytes: stats.aos.loadedBytes,
      };
    },
    get soa() {
      return {
        lines: stats.soa.lines,
        usefulBytes: stats.soa.usefulBytes,
        loadedBytes: stats.soa.loadedBytes,
      };
    },
  };
  window.__dod = hook;
}
