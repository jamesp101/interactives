/**
 * Stack & heap visualization.
 *
 * Model: one x86-64 System V address space, high addresses at the top.
 *  - the stack occupies a deliberately tiny 1024 B budget below STACK_HI and grows down;
 *    a frame's size is the sum of its named locals (a real frame also stores the saved
 *    frame pointer and the return address, and keeps rsp 16-byte aligned).
 *  - the heap is a 1024 B region starting at HEAP_BASE and grows up. malloc(n) is first
 *    fit over the free gaps; free(p) removes a block, which coalesces its gap with the
 *    neighbouring gaps because gaps are derived from the sorted live-block list.
 *  - a block that no live stack local points at is LEAKED.
 */

const STACK_HI = 0x7ffd0400;
const STACK_BUDGET = 1024;
const STACK_LIMIT = STACK_HI - STACK_BUDGET;

const HEAP_BASE = 0x00602000;
const HEAP_SIZE = 1024;
const HEAP_END = HEAP_BASE + HEAP_SIZE;

const SVG_NS = 'http://www.w3.org/2000/svg';
const MAX_LOG = 18;
const MAX_FRAMES_SHOWN = 10;

type FrameKind = 'normal' | 'rec';

interface LocalDef {
  name: string;
  type: string;
  size: number;
  ptr?: boolean;
}

interface Local {
  name: string;
  type: string;
  size: number;
  ptr: boolean;
  addr: number;
  blockId: number | null;
}

interface Frame {
  id: number;
  fn: string;
  kind: FrameKind;
  depth: number | null;
  size: number;
  low: number;
  locals: Local[];
}

interface Block {
  id: number;
  addr: number;
  size: number;
}

interface Gap {
  addr: number;
  size: number;
}

interface LogLine {
  depth: number;
  text: string;
  kind: 'call' | 'ret' | 'heap' | 'warn' | 'err';
}

interface StackHeapHook {
  readonly frames: { fn: string; size: number }[];
  readonly stackBytes: number;
  readonly heapUsed: number;
  readonly leaked: number;
  readonly overflow: boolean;
  readonly blocks: { addr: number; size: number; state: string }[];
}

declare global {
  interface Window {
    __stackheap?: StackHeapHook;
  }
}

const MAIN_LOCALS: LocalDef[] = [
  { name: 'argc', type: 'int', size: 4 },
  { name: 'argv', type: 'char **', size: 8 },
];

const PROCESS_LOCALS: LocalDef[] = [
  { name: 'i', type: 'int', size: 4 },
  { name: 'buf', type: 'char *', size: 8, ptr: true },
  { name: 'acc', type: 'double', size: 8 },
];

const FIB_LOCALS: LocalDef[] = [
  { name: 'n', type: 'int', size: 4 },
  { name: 'pad', type: '(padding)', size: 4 },
  { name: 'lo', type: 'long', size: 8 },
  { name: 'hi', type: 'long', size: 8 },
  { name: 'ret', type: 'long', size: 8 },
];

let instances = 0;

function need<T extends Element>(root: HTMLElement, sel: string): T {
  const el = root.querySelector<T>(sel);
  if (!el) throw new Error(`stack-heap: missing element ${sel}`);
  return el;
}

function hex(addr: number): string {
  return `0x${addr.toString(16).padStart(8, '0')}`;
}

function defSize(defs: LocalDef[]): number {
  let total = 0;
  for (const d of defs) total += d.size;
  return total;
}

function span(cls: string, text: string): HTMLSpanElement {
  const el = document.createElement('span');
  el.className = cls;
  el.textContent = text;
  return el;
}

export function initStackHeap(root: HTMLElement): void {
  const instance = ++instances;

  const btnMain = need<HTMLButtonElement>(root, '.sh-call-main');
  const btnProcess = need<HTMLButtonElement>(root, '.sh-call-process');
  const btnM64 = need<HTMLButtonElement>(root, '.sh-malloc-64');
  const btnM256 = need<HTMLButtonElement>(root, '.sh-malloc-256');
  const btnFree = need<HTMLButtonElement>(root, '.sh-free');
  const btnReturn = need<HTMLButtonElement>(root, '.sh-return');
  const btnRecurse = need<HTMLButtonElement>(root, '.sh-recurse');
  const btnReset = need<HTMLButtonElement>(root, '.sh-reset');
  const depthChips = [...root.querySelectorAll<HTMLButtonElement>('.chip[data-depth]')];

  const statsEl = need<HTMLElement>(root, '.sh-stats');
  const errorEl = need<HTMLElement>(root, '.sh-error');
  const diagram = need<HTMLElement>(root, '.sh-diagram');
  const framesEl = need<HTMLElement>(root, '.sh-frames');
  const stackFreeEl = need<HTMLElement>(root, '.sh-stack-free');
  const heapEl = need<HTMLElement>(root, '.sh-heap');
  const logEl = need<HTMLElement>(root, '.sh-log');
  const svg = need<SVGSVGElement>(root, '.sh-arrows');

  let frames: Frame[] = [];
  let blocks: Block[] = [];
  let log: LogLine[] = [];
  let overflow = false;
  let overflowNeed = 0;
  let depth = 5;
  let nextFrameId = 1;
  let nextBlockId = 1;

  /* ---------------------------------------------------------------- model */

  function stackBytes(): number {
    let total = 0;
    for (const f of frames) total += f.size;
    return total;
  }

  function heapUsed(): number {
    let total = 0;
    for (const b of blocks) total += b.size;
    return total;
  }

  function isOwned(id: number): boolean {
    for (const f of frames) {
      for (const l of f.locals) if (l.blockId === id) return true;
    }
    return false;
  }

  function ownerText(id: number): string | null {
    for (let i = 0; i < frames.length; i++) {
      const f = frames[i]!;
      for (const l of f.locals) {
        if (l.blockId === id) return `${f.fn} #${i + 1} ${l.name}`;
      }
    }
    return null;
  }

  function leakedBytes(): number {
    let total = 0;
    for (const b of blocks) if (!isOwned(b.id)) total += b.size;
    return total;
  }

  /** Free gaps, ascending. Adjacent freed blocks merge here — that is the coalescing. */
  function freeGaps(): Gap[] {
    const gaps: Gap[] = [];
    let cursor = HEAP_BASE;
    for (const b of blocks) {
      if (b.addr > cursor) gaps.push({ addr: cursor, size: b.addr - cursor });
      cursor = b.addr + b.size;
    }
    if (cursor < HEAP_END) gaps.push({ addr: cursor, size: HEAP_END - cursor });
    return gaps;
  }

  function topFrame(): Frame | null {
    return frames.length > 0 ? frames[frames.length - 1]! : null;
  }

  function topPointer(): Local | null {
    const top = topFrame();
    if (!top) return null;
    for (const l of top.locals) if (l.ptr && l.name === 'buf') return l;
    return null;
  }

  function blockById(id: number): Block | null {
    return blocks.find((b) => b.id === id) ?? null;
  }

  function addLog(kind: LogLine['kind'], text: string, atDepth = frames.length): void {
    log.push({ depth: Math.max(0, atDepth), text, kind });
    if (log.length > MAX_LOG) log = log.slice(log.length - MAX_LOG);
  }

  function push(fn: string, kind: FrameKind, defs: LocalDef[], recDepth: number | null): boolean {
    const size = defSize(defs);
    const used = stackBytes();
    if (used + size > STACK_BUDGET) {
      overflow = true;
      overflowNeed = size;
      addLog(
        'err',
        `✗ stack overflow: ${fn} needs ${size} B, only ${STACK_BUDGET - used} B left above the guard page`,
      );
      return false;
    }
    const high = STACK_HI - used;
    const locals: Local[] = [];
    let cursor = high;
    for (const d of defs) {
      cursor -= d.size;
      locals.push({
        name: d.name,
        type: d.type,
        size: d.size,
        ptr: d.ptr === true,
        addr: cursor,
        blockId: null,
      });
    }
    frames.push({ id: nextFrameId++, fn, kind, depth: recDepth, size, low: high - size, locals });
    return true;
  }

  function callMain(): void {
    if (push('main()', 'normal', MAIN_LOCALS, null)) {
      addLog('call', `main() {  // frame ${defSize(MAIN_LOCALS)} B`, frames.length - 1);
    }
    render();
  }

  function callProcess(): void {
    if (push('process()', 'normal', PROCESS_LOCALS, null)) {
      addLog('call', `process() {  // frame ${defSize(PROCESS_LOCALS)} B`, frames.length - 1);
    }
    render();
  }

  function recurse(): void {
    let existing = 0;
    for (let i = frames.length - 1; i >= 0; i--) {
      if (frames[i]!.kind !== 'rec') break;
      existing++;
    }
    let pushed = 0;
    for (let i = 0; i < depth; i++) {
      if (!push('fib()', 'rec', FIB_LOCALS, existing + i + 1)) break;
      pushed++;
    }
    if (pushed > 0) {
      addLog(
        'call',
        `fib() × ${pushed} — recursed to depth ${existing + pushed}, ${pushed * defSize(FIB_LOCALS)} B of frames`,
        frames.length - pushed,
      );
    }
    render();
  }

  function malloc(n: number): void {
    const gaps = freeGaps();
    const gap = gaps.find((g) => g.size >= n);
    if (!gap) {
      let largest = 0;
      for (const g of gaps) largest = Math.max(largest, g.size);
      addLog('warn', `buf = malloc(${n});  // NULL — largest free gap is ${largest} B`);
      render();
      return;
    }
    const block: Block = { id: nextBlockId++, addr: gap.addr, size: n };
    blocks.push(block);
    blocks.sort((a, b) => a.addr - b.addr);

    const ptr = topPointer();
    if (ptr) {
      const previous = ptr.blockId;
      ptr.blockId = block.id;
      addLog('heap', `buf = malloc(${n});  // ${hex(block.addr)}, first fit`);
      if (previous !== null && !isOwned(previous)) {
        const old = blockById(previous);
        if (old) addLog('warn', `⚠ leak ${old.size} B at ${hex(old.addr)} — buf was overwritten`);
      }
    } else {
      addLog(
        'warn',
        `malloc(${n});  // ${hex(block.addr)} — return value discarded, unreachable already`,
      );
    }
    render();
  }

  function freeBuf(): void {
    const ptr = topPointer();
    if (!ptr || ptr.blockId === null) {
      render();
      return;
    }
    const id = ptr.blockId;
    const block = blockById(id);
    if (!block) {
      ptr.blockId = null;
      render();
      return;
    }
    blocks = blocks.filter((b) => b.id !== id);
    for (const f of frames) {
      for (const l of f.locals) if (l.blockId === id) l.blockId = null;
    }
    const end = block.addr + block.size;
    const merged = freeGaps().find((g) => g.addr <= block.addr && g.addr + g.size >= end);
    const note = merged && merged.size > block.size ? `, coalesced into a ${merged.size} B gap` : '';
    addLog('heap', `free(buf);  // ${block.size} B at ${hex(block.addr)} returned${note}`);
    render();
  }

  function doReturn(): void {
    const frame = frames.pop();
    overflow = false;
    if (!frame) {
      render();
      return;
    }
    const orphaned: Block[] = [];
    for (const l of frame.locals) {
      if (l.blockId === null || isOwned(l.blockId)) continue;
      const b = blockById(l.blockId);
      if (b && !orphaned.includes(b)) orphaned.push(b);
    }
    addLog('ret', `}  // return from ${frame.fn} — ${frame.size} B of stack reclaimed`, frames.length);
    for (const b of orphaned) {
      addLog('warn', `⚠ leak ${b.size} B at ${hex(b.addr)} — last pointer died with the frame`, frames.length);
    }
    render();
  }

  function reset(): void {
    frames = [];
    blocks = [];
    log = [];
    overflow = false;
    overflowNeed = 0;
    nextFrameId = 1;
    nextBlockId = 1;
    render();
  }

  /* -------------------------------------------------------------- rendering */

  function renderStats(): void {
    statsEl.textContent = '';
    const used = stackBytes();
    const heap = heapUsed();
    const leak = leakedBytes();
    const pills: [string, boolean][] = [
      [`stack depth ${frames.length}`, false],
      [`stack ${used} / ${STACK_BUDGET} B`, used === STACK_BUDGET],
      [`rsp ${hex(STACK_HI - used)}`, false],
      [`heap used ${heap} B`, false],
      [`heap free ${HEAP_SIZE - heap} B`, false],
      [`leaked ${leak} B`, leak > 0],
    ];
    for (const [text, hot] of pills) {
      statsEl.appendChild(span(hot ? 'meta sh-pill-hot' : 'meta', text));
    }
  }

  function blockAddr(id: number): number {
    const b = blockById(id);
    return b ? b.addr : 0;
  }

  function renderFrame(frame: Frame, withLocals: boolean, isTop: boolean): HTMLElement {
    const el = document.createElement('div');
    el.className = `sh-frame${frame.kind === 'rec' ? ' rec' : ''}${isTop ? ' top' : ''}`;

    const head = document.createElement('div');
    head.className = 'sh-frame-head';
    head.appendChild(span('sh-fn', frame.fn));
    if (frame.depth !== null) head.appendChild(span('sh-badge', `depth ${frame.depth}`));
    if (isTop) head.appendChild(span('sh-badge sh-badge-rsp', 'rsp →'));
    head.appendChild(span('sh-fmeta', `${hex(frame.low)} · ${frame.size} B`));
    el.appendChild(head);

    if (withLocals) {
      const list = document.createElement('div');
      list.className = 'sh-locals';
      for (const l of frame.locals) {
        const row = document.createElement('div');
        row.className = `sh-local${l.ptr ? ' ptr' : ''}`;
        if (l.ptr && l.blockId !== null) row.dataset.block = String(l.blockId);
        const gap = l.type.endsWith('*') ? '' : ' ';
        row.appendChild(span('sh-lname', `${l.type}${gap}${l.name}`));
        row.appendChild(span('sh-laddr', hex(l.addr)));
        row.appendChild(span('sh-lsize', `${l.size} B`));
        if (l.ptr) {
          row.appendChild(
            span('sh-lval', l.blockId === null ? '= NULL' : `→ ${hex(blockAddr(l.blockId))}`),
          );
        }
        list.appendChild(row);
      }
      el.appendChild(list);
    } else {
      const names = frame.locals.map((l) => l.name).join(', ');
      el.appendChild(span('sh-locals-compact', `${frame.locals.length} locals — ${names}`));
    }
    return el;
  }

  function renderFrames(): void {
    framesEl.textContent = '';
    if (frames.length === 0) {
      framesEl.appendChild(span('sh-empty', 'no frames — nothing has been called yet'));
      return;
    }

    const topIndex = frames.length - 1;
    const collapse = frames.length > MAX_FRAMES_SHOWN;
    const headCount = collapse ? 4 : frames.length;
    const tailCount = collapse ? 4 : 0;

    const emit = (i: number): void => {
      const f = frames[i]!;
      const isTop = i === topIndex;
      framesEl.appendChild(renderFrame(f, f.kind === 'normal' || isTop, isTop));
    };

    for (let i = 0; i < headCount; i++) emit(i);
    if (collapse) {
      const hidden = frames.slice(headCount, frames.length - tailCount);
      let bytes = 0;
      for (const f of hidden) bytes += f.size;
      framesEl.appendChild(
        span('sh-elide', `⋯ ${hidden.length} frames elided · ${bytes} B of stack ⋯`),
      );
      for (let i = frames.length - tailCount; i < frames.length; i++) emit(i);
    }
  }

  function renderStackFree(): void {
    const free = STACK_BUDGET - stackBytes();
    stackFreeEl.textContent = '';
    stackFreeEl.classList.toggle('exhausted', free === 0);
    stackFreeEl.appendChild(
      span(
        'sh-free-text',
        free === 0
          ? 'stack exhausted — 0 B left above the guard page'
          : `${free} B unused — rsp can bump down to ${hex(STACK_LIMIT)}`,
      ),
    );
  }

  interface Seg {
    addr: number;
    size: number;
    state: 'allocated' | 'leaked' | 'free';
    id: number | null;
  }

  function segments(): Seg[] {
    const segs: Seg[] = [];
    for (const b of blocks) {
      segs.push({
        addr: b.addr,
        size: b.size,
        state: isOwned(b.id) ? 'allocated' : 'leaked',
        id: b.id,
      });
    }
    for (const g of freeGaps()) segs.push({ addr: g.addr, size: g.size, state: 'free', id: null });
    return segs;
  }

  function renderHeap(): void {
    heapEl.textContent = '';
    const segs = segments().sort((a, b) => b.addr - a.addr);
    for (const s of segs) {
      const el = document.createElement('div');
      el.className = `sh-blk ${s.state}`;
      el.style.setProperty('--w', String(s.size));
      if (s.id !== null) el.dataset.block = String(s.id);
      el.appendChild(span('sh-baddr', hex(s.addr)));
      el.appendChild(span('sh-bsize', `${s.size} B`));
      if (s.state === 'free') {
        el.appendChild(span('sh-bstate', 'free gap'));
      } else if (s.state === 'leaked') {
        el.appendChild(span('sh-bstate', 'leaked — no pointer left'));
      } else {
        el.appendChild(span('sh-bstate', `allocated — ${ownerText(s.id ?? -1) ?? ''}`));
      }
      heapEl.appendChild(el);
    }
  }

  function renderError(): void {
    if (!overflow) {
      errorEl.hidden = true;
      errorEl.textContent = '';
      return;
    }
    errorEl.hidden = false;
    errorEl.textContent =
      `STACK OVERFLOW — the next frame needs ${overflowNeed} B but only ` +
      `${STACK_BUDGET - stackBytes()} B remain above the guard page at ${hex(STACK_LIMIT)}. ` +
      'A real process would touch the guard page and take SIGSEGV, so the frame was not pushed ' +
      'and the stack did not grow. Return from a frame or reset.';
  }

  function renderLog(): void {
    if (log.length === 0) {
      logEl.textContent = '// press a control — the call and allocation trace appears here';
      return;
    }
    logEl.textContent = log.map((l) => `${'  '.repeat(Math.min(l.depth, 8))}${l.text}`).join('\n');
  }

  function renderButtons(): void {
    const hasMain = frames.some((f) => f.fn === 'main()');
    const ptr = topPointer();
    btnMain.disabled = overflow || hasMain;
    btnProcess.disabled = overflow;
    btnRecurse.disabled = overflow;
    btnM64.disabled = overflow || frames.length === 0;
    btnM256.disabled = overflow || frames.length === 0;
    btnFree.disabled = overflow || ptr === null || ptr.blockId === null;
    btnReturn.disabled = frames.length === 0;
  }

  function drawArrows(): void {
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const box = diagram.getBoundingClientRect();
    const width = diagram.clientWidth;
    const originX = box.left + diagram.clientLeft;
    const originY = box.top + diagram.clientTop;
    if (width === 0 || diagram.clientHeight === 0) return;

    const markerId = `sh-arrowhead-${instance}`;
    const defs = document.createElementNS(SVG_NS, 'defs');
    const marker = document.createElementNS(SVG_NS, 'marker');
    marker.setAttribute('id', markerId);
    marker.setAttribute('markerWidth', '7');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('refX', '6');
    marker.setAttribute('refY', '3.5');
    marker.setAttribute('orient', 'auto');
    const head = document.createElementNS(SVG_NS, 'path');
    head.setAttribute('d', 'M0 0 L7 3.5 L0 7 z');
    marker.appendChild(head);
    defs.appendChild(marker);
    svg.appendChild(defs);

    let lane = 0;
    for (const src of root.querySelectorAll<HTMLElement>('.sh-local[data-block]')) {
      const id = src.dataset.block;
      if (id === undefined) continue;
      const target = diagram.querySelector<HTMLElement>(`.sh-blk[data-block="${id}"]`);
      if (!target) continue;
      const a = src.getBoundingClientRect();
      const b = target.getBoundingClientRect();
      const x1 = a.right - originX + 2;
      const y1 = a.top - originY + a.height / 2;
      const x2 = b.right - originX + 3;
      const y2 = b.top - originY + b.height / 2;
      const gx = Math.max(x1 + 4, width - 5 - lane * 7);
      const path = document.createElementNS(SVG_NS, 'path');
      path.setAttribute('d', `M${x1} ${y1} H${gx} V${y2} H${x2}`);
      path.setAttribute('class', 'sh-ptr-line');
      path.setAttribute('marker-end', `url(#${markerId})`);
      svg.appendChild(path);
      lane++;
    }
  }

  function render(): void {
    renderStats();
    renderError();
    renderFrames();
    renderStackFree();
    renderHeap();
    renderLog();
    renderButtons();
    drawArrows();
  }

  /* ---------------------------------------------------------------- wiring */

  btnMain.addEventListener('click', callMain);
  btnProcess.addEventListener('click', callProcess);
  btnM64.addEventListener('click', () => malloc(64));
  btnM256.addEventListener('click', () => malloc(256));
  btnFree.addEventListener('click', freeBuf);
  btnReturn.addEventListener('click', doReturn);
  btnRecurse.addEventListener('click', recurse);
  btnReset.addEventListener('click', reset);

  for (const chip of depthChips) {
    chip.addEventListener('click', () => {
      const value = Number(chip.dataset.depth);
      if (!Number.isFinite(value) || value === depth) return;
      depth = value;
      for (const c of depthChips) c.classList.toggle('active', c === chip);
      btnRecurse.textContent = `recurse fib(${depth})`;
    });
  }
  btnRecurse.textContent = `recurse fib(${depth})`;

  // The overlay is absolutely positioned at 100% of the diagram, so redrawing from a
  // post-layout resize callback cannot feed back into layout.
  if (typeof ResizeObserver !== 'undefined') {
    new ResizeObserver(() => drawArrows()).observe(diagram);
  } else {
    window.addEventListener('resize', drawArrows);
  }

  window.__stackheap = {
    get frames() {
      return frames.map((f) => ({ fn: f.fn, size: f.size }));
    },
    get stackBytes() {
      return stackBytes();
    },
    get heapUsed() {
      return heapUsed();
    },
    get leaked() {
      return leakedBytes();
    },
    get overflow() {
      return overflow;
    },
    get blocks() {
      return segments()
        .sort((a, b) => a.addr - b.addr)
        .map((s) => ({ addr: s.addr, size: s.size, state: s.state as string }));
    },
  };

  render();
}
