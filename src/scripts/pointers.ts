/*
 * Pointers — stepped C program over a simplified byte-addressed memory window.
 *
 * Model: x86-64 System V / LP64. `int` is 4 bytes, every pointer is 8 bytes,
 * objects are naturally aligned (so the frame contains real padding gaps), and
 * pointer arithmetic is scaled by the pointee type. Addresses are illustrative
 * (they ascend in declaration order; a real x86-64 frame grows downward) but
 * sizes, alignment padding, little-endian byte order and scaling are exact.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/* ---------- memory window ---------- */

type SlotKind = 'int' | 'ptr' | 'ptrptr' | 'pad';

interface SlotDef {
  name: string;
  addr: number;
  size: number;
  kind: SlotKind;
  ctype: string;
  region: 'frame' | 'heap';
}

const X = 0x1000;
const P = 0x1008;
const A0 = 0x1010;
const A1 = 0x1014;
const A2 = 0x1018;
const Q = 0x1020;
const PP = 0x1028;

const SLOTS: SlotDef[] = [
  { name: 'x', addr: X, size: 4, kind: 'int', ctype: 'int', region: 'frame' },
  { name: 'padding', addr: 0x1004, size: 4, kind: 'pad', ctype: '—', region: 'frame' },
  { name: 'p', addr: P, size: 8, kind: 'ptr', ctype: 'int *', region: 'frame' },
  { name: 'arr[0]', addr: A0, size: 4, kind: 'int', ctype: 'int', region: 'frame' },
  { name: 'arr[1]', addr: A1, size: 4, kind: 'int', ctype: 'int', region: 'frame' },
  { name: 'arr[2]', addr: A2, size: 4, kind: 'int', ctype: 'int', region: 'frame' },
  { name: 'padding', addr: 0x101c, size: 4, kind: 'pad', ctype: '—', region: 'frame' },
  { name: 'q', addr: Q, size: 8, kind: 'ptr', ctype: 'int *', region: 'frame' },
  { name: 'pp', addr: PP, size: 8, kind: 'ptrptr', ctype: 'int **', region: 'frame' },
];

/** address -> object, so a dereference can find what (if anything) lives there */
const SLOT_BY_ADDR = new Map<number, SlotDef>(SLOTS.map((s) => [s.addr, s]));

/** C-style hex address, used everywhere an address is shown */
function hex(addr: number): string {
  return '0x' + addr.toString(16);
}

/** byte i of a `size`-byte little-endian object holding `value` */
function byteAt(value: number, size: number, i: number): number {
  const u = value < 0 ? value + 2 ** (8 * size) : value;
  return Math.floor(u / 2 ** (8 * i)) % 256;
}

/* ---------- machine ---------- */

interface Machine {
  /** address -> stored value (an int, or an address for pointer objects) */
  val: Map<number, number>;
  /** addresses whose object has been initialised */
  live: Set<number>;
}

function store(m: Machine, addr: number, value: number): void {
  m.val.set(addr, value);
  m.live.add(addr);
}

/** read an object; storage never written reads as 0 here rather than garbage */
function load(m: Machine, addr: number): number {
  return m.val.get(addr) ?? 0;
}

/* ---------- program ---------- */

interface StepResult {
  written: number[];
  error: string | null;
  note: string;
}

interface Step {
  code: string;
  comment: string;
  run: (m: Machine) => StepResult;
}

const PROGRAM: Step[] = [
  {
    code: 'int x = 42;',
    comment: '',
    run: (m) => {
      store(m, X, 42);
      return {
        written: [X],
        error: null,
        note:
          `x is a 4-byte int living in the frame at ${hex(X)}, and 42 is copied into those four bytes. ` +
          `The bytes read 2a 00 00 00 because x86-64 is little-endian: the least significant byte comes first. ` +
          `No pointer exists yet — the name "x" is just a compile-time label for ${hex(X)}.`,
      };
    },
  },
  {
    code: 'int *p = &x;',
    comment: "p holds x's address",
    run: (m) => {
      store(m, P, X);
      return {
        written: [P],
        error: null,
        note:
          `&x evaluates to the address of x's slot, ${hex(X)}. p is its own 8-byte object at ${hex(P)} whose ` +
          `value is that address — the blue arrow *is* p's value, drawn instead of printed. p does not contain ` +
          `42; it contains a way to reach 42.`,
      };
    },
  },
  {
    code: '*p = 99;',
    comment: 'writes through p — x changes',
    run: (m) => {
      const target = load(m, P);
      store(m, target, 99);
      return {
        written: [target],
        error: null,
        note:
          `*p means "the int stored at the address inside p". On the left of an assignment it names x's ` +
          `storage, so 99 lands in ${hex(target)} and x becomes 99. p itself is untouched — the arrow does not ` +
          `move, only the slot it points at changes.`,
      };
    },
  },
  {
    code: 'int arr[3] = {10, 20, 30};',
    comment: '',
    run: (m) => {
      store(m, A0, 10);
      store(m, A1, 20);
      store(m, A2, 30);
      return {
        written: [A0, A1, A2],
        error: null,
        note:
          `An array is not a pointer: it is three ints laid out back to back at ${hex(A0)}, ${hex(A1)} and ` +
          `${hex(A2)}. Element n sits at arr + n * sizeof(int) = arr + 4n, which is the whole reason indexing ` +
          `costs one multiply-add and nothing else. sizeof(arr) is 12 here, not 8.`,
      };
    },
  },
  {
    code: 'int *q = arr;',
    comment: 'array decays to pointer to first element',
    run: (m) => {
      store(m, Q, A0);
      return {
        written: [Q],
        error: null,
        note:
          `Used in an expression the array name decays to a pointer to its first element: q = &arr[0] = ` +
          `${hex(A0)}. The 12 bytes of arr are not copied; q is just an 8-byte address. The same decay is why ` +
          `a parameter written "int a[]" is really "int *a" and loses the length.`,
      };
    },
  },
  {
    code: 'q++;',
    comment: '+= 4 bytes, not 1 — sizeof(int)',
    run: (m) => {
      const before = load(m, Q);
      const after = before + 4;
      store(m, Q, after);
      return {
        written: [Q],
        error: null,
        note:
          `Pointer arithmetic is SCALED by the pointee type. q++ adds one *element*, not one byte: ` +
          `${hex(before)} + 1 × sizeof(int) = ${hex(before)} + 4 = ${hex(after)}. The compiler emits the × 4 ` +
          `for you, so q now points at arr[1]. On a char * the same q++ would advance by 1; on a double * by 8.`,
      };
    },
  },
  {
    code: '*q = 77;',
    comment: 'writes arr[1]',
    run: (m) => {
      const target = load(m, Q);
      store(m, target, 77);
      return {
        written: [target],
        error: null,
        note:
          `Dereferencing the advanced pointer writes ${hex(target)}, which is arr[1] — arr is now ` +
          `{10, 77, 30}. *q, q[0] and arr[1] all name the same object here: indexing is defined as *(q + n) ` +
          `with exactly the same × 4 scaling.`,
      };
    },
  },
  {
    code: 'int **pp = &p;',
    comment: 'pointer to pointer',
    run: (m) => {
      store(m, PP, P);
      return {
        written: [PP],
        error: null,
        note:
          `&p is the address of the pointer object itself, ${hex(P)} — not the address of x. The type int ** ` +
          `reads "pointer to pointer to int": *pp is an int * and **pp is an int. This is how a function ` +
          `changes a caller's pointer, which is why realloc-style APIs take a T **.`,
      };
    },
  },
  {
    code: '**pp = 5;',
    comment: 'two hops: pp -> p -> x',
    run: (m) => {
      const hop1 = load(m, PP);
      const hop2 = load(m, hop1);
      store(m, hop2, 5);
      return {
        written: [hop2],
        error: null,
        note:
          `Two loads, then a store: pp (${hex(PP)}) gives ${hex(hop1)}, reading p there gives ${hex(hop2)}, ` +
          `and the 5 goes into that final slot — x. Two arrows are in play at once (pp → p and p → x) and the ` +
          `assignment follows both of them.`,
      };
    },
  },
  {
    code: 'p = NULL;',
    comment: 'p no longer points anywhere',
    run: (m) => {
      store(m, P, 0);
      return {
        written: [P],
        error: null,
        note:
          `p's bytes are overwritten with address 0x0. NULL is a perfectly valid pointer *value* meaning ` +
          `"points at no object", and it compares unequal to every real address — but it is not an address ` +
          `you may read or write. The arrow becomes a red stub. x still holds 5; nothing about x changed.`,
      };
    },
  },
  {
    code: '*p = 1;',
    comment: 'ERROR: null dereference',
    run: () => ({
      written: [],
      error: 'null pointer dereference at 0x0 (SIGSEGV)',
      note:
        'dereferencing NULL is undefined behaviour — on Linux this traps as a segmentation fault (SIGSEGV), ' +
        'because the kernel deliberately leaves the first page unmapped so that exactly this bug fails loudly ' +
        'instead of quietly corrupting data. Nothing is written: memory below is unchanged from the previous ' +
        'step.',
    }),
  },
];

const INTRO_NOTE =
  'Nothing has executed yet. Every slot holds indeterminate bytes (shown as ??) — reading an uninitialised ' +
  'variable is itself undefined behaviour, so nothing has a value until its declaration runs. Step forward ' +
  'to execute one line at a time.';

interface State {
  machine: Machine;
  /** addresses written by the step that produced this state */
  written: number[];
  error: string | null;
  note: string;
}

/**
 * Every state is snapshotted up front, so "step back" restores an exact prior
 * machine rather than trying to invert a store.
 */
function buildStates(): State[] {
  const m: Machine = { val: new Map<number, number>(), live: new Set<number>() };
  const states: State[] = [
    {
      machine: { val: new Map(m.val), live: new Set(m.live) },
      written: [],
      error: null,
      note: INTRO_NOTE,
    },
  ];
  for (const step of PROGRAM) {
    const r = step.run(m);
    states.push({
      machine: { val: new Map(m.val), live: new Set(m.live) },
      written: r.written,
      error: r.error,
      note: r.note,
    });
  }
  return states;
}

/* ---------- arrows ---------- */

type Tone = 'accent' | 'pivot' | 'hot';

const TONES: Tone[] = ['accent', 'pivot', 'hot'];

interface ArrowSpec {
  from: HTMLElement;
  /** null renders a stub that goes nowhere (NULL or wild pointer) */
  to: HTMLElement | null;
  tone: Tone;
  broken: boolean;
  title: string;
}

function svgEl<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS(SVG_NS, name);
}

function withTitle(el: SVGElement, text: string): void {
  const t = svgEl('title');
  t.textContent = text;
  el.appendChild(t);
}

/**
 * Lays out the overlay from live geometry: every endpoint comes from
 * getBoundingClientRect() relative to the container, so calling this again
 * re-fits the arrows after a resize or any reflow.
 */
function drawArrows(
  container: HTMLElement,
  svg: SVGSVGElement,
  specs: ArrowSpec[],
  uid: string,
): void {
  while (svg.firstChild) svg.removeChild(svg.firstChild);

  const cr = container.getBoundingClientRect();
  const w = Math.max(1, Math.round(cr.width));
  const h = Math.max(1, Math.round(cr.height));
  svg.setAttribute('width', String(w));
  svg.setAttribute('height', String(h));
  svg.setAttribute('viewBox', `0 0 ${w} ${h}`);

  const defs = svgEl('defs');
  for (const tone of TONES) {
    const marker = svgEl('marker');
    marker.setAttribute('id', `ptr-head-${tone}-${uid}`);
    marker.setAttribute('markerWidth', '7');
    marker.setAttribute('markerHeight', '7');
    marker.setAttribute('refX', '6');
    marker.setAttribute('refY', '3.5');
    marker.setAttribute('orient', 'auto');
    marker.setAttribute('markerUnits', 'userSpaceOnUse');
    const tip = svgEl('path');
    tip.setAttribute('d', 'M0 0 L7 3.5 L0 7 Z');
    tip.setAttribute('class', `ptr-head ${tone}`);
    marker.appendChild(tip);
    defs.appendChild(marker);
  }
  svg.appendChild(defs);

  specs.forEach((spec, i) => {
    const sr = spec.from.getBoundingClientRect();
    const sx = sr.left - cr.left;
    const sy = sr.top - cr.top + sr.height / 2;

    const dot = svgEl('circle');
    dot.setAttribute('cx', String(sx - 2));
    dot.setAttribute('cy', String(sy));
    dot.setAttribute('r', '3');
    dot.setAttribute('class', `ptr-dot ${spec.tone}`);
    svg.appendChild(dot);

    if (!spec.to) {
      const stub = svgEl('path');
      stub.setAttribute('d', `M ${sx - 4} ${sy} L ${sx - 28} ${sy}`);
      stub.setAttribute('class', 'ptr-arrow hot stub');
      withTitle(stub, spec.title);
      svg.appendChild(stub);
      const cross = svgEl('text');
      cross.setAttribute('x', String(sx - 39));
      cross.setAttribute('y', String(sy));
      cross.setAttribute('class', 'ptr-x');
      cross.textContent = '✗';
      withTitle(cross, spec.title);
      svg.appendChild(cross);
      return;
    }

    const tr = spec.to.getBoundingClientRect();
    const tx = tr.left - cr.left;
    const ty = tr.top - cr.top + tr.height / 2;
    // Fan the curves out into the left gutter so concurrent arrows stay legible.
    const depth = Math.max(14, Math.min(sx - 6, 20 + i * 16));

    const path = svgEl('path');
    path.setAttribute(
      'd',
      `M ${sx - 4} ${sy} C ${sx - depth} ${sy}, ${tx - depth} ${ty}, ${tx - 6} ${ty}`,
    );
    path.setAttribute('class', `ptr-arrow ${spec.tone}${spec.broken ? ' broken' : ''}`);
    path.setAttribute('marker-end', `url(#ptr-head-${spec.tone}-${uid})`);
    withTitle(path, spec.title);
    svg.appendChild(path);

    if (spec.broken) {
      const mid = path.getPointAtLength(path.getTotalLength() / 2);
      const gap = svgEl('circle');
      gap.setAttribute('cx', String(mid.x));
      gap.setAttribute('cy', String(mid.y));
      gap.setAttribute('r', '9');
      gap.setAttribute('class', 'ptr-gap');
      svg.appendChild(gap);
      const cross = svgEl('text');
      cross.setAttribute('x', String(mid.x));
      cross.setAttribute('y', String(mid.y));
      cross.setAttribute('class', 'ptr-x');
      cross.textContent = '✗';
      withTitle(cross, spec.title);
      svg.appendChild(cross);
    }
  });
}

/* ---------- dangling pointer demo ---------- */

const D_H = 0x1100;
const D_BLOCK = 0x2000;

type DanglePhase = 0 | 1 | 2 | 3 | 4;

const DANGLE_ROWS: SlotDef[] = [
  { name: 'h', addr: D_H, size: 8, kind: 'ptr', ctype: 'int *', region: 'frame' },
  { name: 'heap block', addr: D_BLOCK, size: 4, kind: 'int', ctype: 'int', region: 'heap' },
];

const DANGLE_LINES: string[] = [
  'int *h;                      // indeterminate — points nowhere useful',
  'void *b = malloc(4);         // → 0x2000, contents indeterminate',
  'h = b; *h = 7;               // h now points at the live heap block',
  'free(b);                     // block returns to the allocator — h is now DANGLING',
  'printf("%d\\n", *h);           // use-after-free: undefined behaviour',
];

const DANGLE_NOTES: string[] = [
  'Nothing allocated yet. h is an uninitialised pointer: its bytes are whatever the stack happened to hold.',
  'malloc(4) reserved four bytes at 0x2000 and returned that address. The block is live but its contents are indeterminate — malloc does not zero memory, calloc does.',
  'h holds 0x2000 and the write lands in the heap block: one live object, one pointer to it, no problem.',
  "free() ends the object's lifetime. The bytes are still sitting there — the allocator only marked them reusable — but h still holds 0x2000, so h is now DANGLING. The arrow is severed: the address still looks valid, the object is gone.",
  'Use-after-free: undefined behaviour. It often "works" and prints 7, which is the cruel part — right up until the allocator hands those bytes to someone else, or returns the page to the kernel and the read segfaults. The bug lives in the free/dereference pair, not where it happens to crash.',
];

/* ---------- verification hook ---------- */

interface PointersHook {
  readonly line: number;
  readonly error: string | null;
  readonly vars: Record<string, { addr: number; value: number | string }>;
  readonly arrows: { from: number; to: number }[];
  readonly danglePhase: number;
  readonly dangleError: string | null;
}

declare global {
  interface Window {
    __pointers?: PointersHook;
  }
}

let uidSeq = 0;

export function initPointers(root: HTMLElement): void {
  const uid = `p${++uidSeq}`;

  const progEl = root.querySelector<HTMLElement>('.ptr-prog')!;
  const memEl = root.querySelector<HTMLElement>('.ptr-mem')!;
  const svg = root.querySelector<SVGSVGElement>('.ptr-svg')!;
  const noteEl = root.querySelector<HTMLElement>('.ptr-note')!;
  const noteLabel = root.querySelector<HTMLElement>('.ptr-note-label')!;
  const progressEl = root.querySelector<HTMLElement>('.ptr-progress')!;
  const statusEl = root.querySelector<HTMLElement>('.ptr-status')!;
  const backBtn = root.querySelector<HTMLButtonElement>('.ptr-back')!;
  const fwdBtn = root.querySelector<HTMLButtonElement>('.ptr-fwd')!;
  const playBtn = root.querySelector<HTMLButtonElement>('.ptr-play')!;
  const resetBtn = root.querySelector<HTMLButtonElement>('.ptr-reset')!;
  const speedChips = [...root.querySelectorAll<HTMLElement>('.chip[data-speed]')];

  const dMemEl = root.querySelector<HTMLElement>('.ptr-dmem')!;
  const dSvg = root.querySelector<SVGSVGElement>('.ptr-dsvg')!;
  const dOutEl = root.querySelector<HTMLElement>('.ptr-dout')!;
  const dNoteEl = root.querySelector<HTMLElement>('.ptr-dnote')!;
  const dResetBtn = root.querySelector<HTMLButtonElement>('.ptr-dreset')!;
  const dActionBtns = [...root.querySelectorAll<HTMLButtonElement>('button[data-phase]')];

  const states = buildStates();
  let idx = 0;
  let timer: number | null = null;
  let speed = 900;
  let dPhase: DanglePhase = 0;

  /* --- program listing --- */

  const lineEls: HTMLElement[] = PROGRAM.map((step, i) => {
    const li = document.createElement('li');
    li.className = 'ptr-line';
    li.dataset.i = String(i);
    const code = document.createElement('code');
    code.textContent = step.code;
    li.appendChild(code);
    if (step.comment) {
      const cmt = document.createElement('span');
      cmt.className = 'ptr-cmt';
      cmt.textContent = `// ${step.comment}`;
      li.appendChild(cmt);
    }
    progEl.appendChild(li);
    return li;
  });

  /* --- memory rows --- */

  interface SlotEls {
    row: HTMLElement;
    value: HTMLElement;
    bytes: HTMLElement;
    /** arrow endpoint: the address cell */
    anchor: HTMLElement;
  }

  function buildRow(host: HTMLElement, def: SlotDef): SlotEls {
    const row = document.createElement('div');
    row.className = `ptr-slot kind-${def.kind} region-${def.region}`;
    row.dataset.addr = String(def.addr);

    const addr = document.createElement('span');
    addr.className = 'ptr-addr';
    addr.textContent = hex(def.addr);

    const ident = document.createElement('span');
    ident.className = 'ptr-ident';
    const nm = document.createElement('span');
    nm.className = 'ptr-name';
    nm.textContent = def.name;
    const ty = document.createElement('span');
    ty.className = 'ptr-type';
    ty.textContent = `${def.ctype} · ${def.size} B`;
    ident.append(nm, ty);

    const bytes = document.createElement('span');
    bytes.className = 'ptr-bytes';

    const value = document.createElement('span');
    value.className = 'ptr-val';

    row.append(addr, ident, bytes, value);
    host.appendChild(row);
    return { row, value, bytes, anchor: addr };
  }

  const slotEls = new Map<number, SlotEls>();
  for (const def of SLOTS) slotEls.set(def.addr, buildRow(memEl, def));

  const dSlotEls = new Map<number, SlotEls>();
  for (const def of DANGLE_ROWS) dSlotEls.set(def.addr, buildRow(dMemEl, def));

  function paintBytes(host: HTMLElement, size: number, value: number | null): void {
    host.textContent = '';
    for (let i = 0; i < size; i++) {
      const cell = document.createElement('i');
      cell.className = 'ptr-byte';
      if (value === null) {
        cell.classList.add('unknown');
        cell.textContent = '??';
      } else {
        const b = byteAt(value, size, i);
        cell.textContent = b.toString(16).padStart(2, '0');
        if (b === 0) cell.classList.add('zero');
      }
      host.appendChild(cell);
    }
  }

  /* --- pointer topology of a state --- */

  interface PointerView {
    arrows: { from: number; to: number; tone: Tone }[];
    invalid: { from: number; reason: string }[];
  }

  function pointerView(st: State): PointerView {
    const view: PointerView = { arrows: [], invalid: [] };
    for (const def of SLOTS) {
      if (def.kind !== 'ptr' && def.kind !== 'ptrptr') continue;
      if (!st.machine.live.has(def.addr)) continue;
      const target = load(st.machine, def.addr);
      if (target === 0) {
        view.invalid.push({
          from: def.addr,
          reason: `${def.name} is NULL (0x0) — dereferencing it is undefined behaviour`,
        });
        continue;
      }
      if (!SLOT_BY_ADDR.has(target)) {
        view.invalid.push({
          from: def.addr,
          reason: `${def.name} holds ${hex(target)}, which is not the address of any object`,
        });
        continue;
      }
      view.arrows.push({
        from: def.addr,
        to: target,
        tone: def.kind === 'ptrptr' ? 'pivot' : 'accent',
      });
    }
    return view;
  }

  function paintMainArrows(view: PointerView): void {
    const specs: ArrowSpec[] = [];
    for (const a of view.arrows) {
      const from = slotEls.get(a.from);
      const to = slotEls.get(a.to);
      if (!from || !to) continue;
      const fromName = SLOT_BY_ADDR.get(a.from)!.name;
      const toName = SLOT_BY_ADDR.get(a.to)!.name;
      specs.push({
        from: from.anchor,
        to: to.anchor,
        tone: a.tone,
        broken: false,
        title: `${fromName} (${hex(a.from)}) → ${toName} (${hex(a.to)})`,
      });
    }
    for (const bad of view.invalid) {
      const from = slotEls.get(bad.from);
      if (!from) continue;
      specs.push({ from: from.anchor, to: null, tone: 'hot', broken: false, title: bad.reason });
    }
    drawArrows(memEl, svg, specs, uid);
  }

  function render(): void {
    const st = states[idx]!;
    const view = pointerView(st);
    const invalidFrom = new Set(view.invalid.map((v) => v.from));

    lineEls.forEach((li, i) => {
      li.classList.toggle('done', i < idx - 1);
      li.classList.toggle('cur', i === idx - 1);
      li.classList.toggle('next', i === idx);
      li.classList.toggle('err', i === idx - 1 && st.error !== null);
    });

    for (const def of SLOTS) {
      const els = slotEls.get(def.addr)!;
      const live = st.machine.live.has(def.addr);
      els.row.classList.toggle('live', live && def.kind !== 'pad');
      els.row.classList.toggle('written', st.written.includes(def.addr));
      els.row.classList.toggle('nullish', invalidFrom.has(def.addr));

      if (def.kind === 'pad') {
        els.value.textContent = 'alignment gap';
        els.value.className = 'ptr-val pad';
        paintBytes(els.bytes, def.size, null);
      } else if (!live) {
        els.value.textContent = '??';
        els.value.className = 'ptr-val unknown';
        paintBytes(els.bytes, def.size, null);
      } else {
        const v = load(st.machine, def.addr);
        if (def.kind === 'int') {
          els.value.textContent = String(v);
          els.value.className = 'ptr-val int';
        } else {
          els.value.textContent = v === 0 ? 'NULL' : hex(v);
          els.value.className = `ptr-val ptr${v === 0 ? ' nullv' : ''}`;
        }
        paintBytes(els.bytes, def.size, v);
      }
    }
    paintMainArrows(view);

    noteEl.textContent = st.note;
    noteEl.classList.toggle('err', st.error !== null);
    noteLabel.textContent =
      idx === 0
        ? 'before the first line'
        : st.error !== null
          ? 'faulting line'
          : 'what just happened';

    progressEl.textContent = `line ${idx} / ${PROGRAM.length}`;
    statusEl.classList.toggle('err', st.error !== null);
    if (st.error) statusEl.textContent = `SIGSEGV · ${st.error}`;
    else if (idx === PROGRAM.length) statusEl.textContent = 'program finished';
    else statusEl.textContent = `next: ${PROGRAM[idx]!.code}`;

    backBtn.disabled = idx === 0;
    fwdBtn.disabled = idx === PROGRAM.length;
  }

  /* --- playback --- */

  function stopPlay(): void {
    if (timer !== null) {
      window.clearInterval(timer);
      timer = null;
    }
    playBtn.textContent = 'Play';
  }

  function startPlay(): void {
    if (idx === PROGRAM.length) idx = 0;
    playBtn.textContent = 'Pause';
    timer = window.setInterval(() => {
      if (idx >= PROGRAM.length) {
        stopPlay();
        return;
      }
      idx++;
      render();
      if (idx === PROGRAM.length) stopPlay();
    }, speed);
    render();
  }

  fwdBtn.addEventListener('click', () => {
    stopPlay();
    if (idx < PROGRAM.length) {
      idx++;
      render();
    }
  });
  backBtn.addEventListener('click', () => {
    stopPlay();
    if (idx > 0) {
      idx--;
      render();
    }
  });
  resetBtn.addEventListener('click', () => {
    stopPlay();
    idx = 0;
    render();
  });
  playBtn.addEventListener('click', () => {
    if (timer !== null) stopPlay();
    else startPlay();
  });

  for (const chip of speedChips) {
    chip.addEventListener('click', () => {
      const ms = Number(chip.dataset.speed);
      if (!Number.isFinite(ms) || ms <= 0) return;
      speed = ms;
      for (const c of speedChips) c.classList.toggle('active', c === chip);
      if (timer !== null) {
        stopPlay();
        startPlay();
      }
    });
  }

  for (const li of lineEls) {
    li.addEventListener('click', () => {
      stopPlay();
      idx = Number(li.dataset.i) + 1;
      render();
    });
  }

  /* --- dangling demo --- */

  function renderDangle(): void {
    const hEls = dSlotEls.get(D_H)!;
    const bEls = dSlotEls.get(D_BLOCK)!;
    const hLive = dPhase >= 2;
    const freed = dPhase >= 3;

    hEls.row.className =
      'ptr-slot kind-ptr region-frame' +
      (hLive ? ' live' : '') +
      (freed ? ' nullish' : '') +
      (dPhase === 2 ? ' written' : '');
    if (hLive) {
      hEls.value.textContent = hex(D_BLOCK);
      hEls.value.className = `ptr-val ptr${freed ? ' nullv' : ''}`;
      paintBytes(hEls.bytes, 8, D_BLOCK);
    } else {
      hEls.value.textContent = '??';
      hEls.value.className = 'ptr-val unknown';
      paintBytes(hEls.bytes, 8, null);
    }

    bEls.row.className =
      'ptr-slot kind-int region-heap' +
      (dPhase === 0 ? ' absent' : '') +
      (dPhase >= 1 && !freed ? ' live' : '') +
      (freed ? ' freed' : '') +
      (dPhase === 2 ? ' written' : '');
    if (dPhase === 0) {
      bEls.value.textContent = 'not allocated';
      bEls.value.className = 'ptr-val pad';
      paintBytes(bEls.bytes, 4, null);
    } else if (dPhase === 1) {
      bEls.value.textContent = '??';
      bEls.value.className = 'ptr-val unknown';
      paintBytes(bEls.bytes, 4, null);
    } else {
      bEls.value.textContent = freed ? '7 (stale)' : '7';
      bEls.value.className = `ptr-val int${freed ? ' stale' : ''}`;
      paintBytes(bEls.bytes, 4, 7);
    }

    dOutEl.textContent = DANGLE_LINES.slice(0, dPhase + 1)
      .map((l, i) => (i === dPhase ? `▸ ${l}` : `  ${l}`))
      .join('\n');
    dOutEl.classList.toggle('err', dPhase === 4);
    dNoteEl.textContent = DANGLE_NOTES[dPhase]!;
    dNoteEl.classList.toggle('err', freed);

    for (const btn of dActionBtns) {
      const want = Number(btn.dataset.phase);
      btn.disabled = want !== dPhase + 1;
      btn.classList.toggle('done', want <= dPhase);
    }

    const specs: ArrowSpec[] = hLive
      ? [
          {
            from: hEls.anchor,
            to: bEls.anchor,
            tone: freed ? 'hot' : 'accent',
            broken: freed,
            title: freed
              ? 'DANGLING: h still holds 0x2000 but the object there was freed — dereferencing it is use-after-free'
              : 'h (0x1100) → heap block (0x2000)',
          },
        ]
      : [];
    drawArrows(dMemEl, dSvg, specs, `${uid}d`);
  }

  for (const btn of dActionBtns) {
    btn.addEventListener('click', () => {
      const want = Number(btn.dataset.phase);
      if (want !== dPhase + 1) return;
      dPhase = want as DanglePhase;
      renderDangle();
    });
  }
  dResetBtn.addEventListener('click', () => {
    dPhase = 0;
    renderDangle();
  });

  /* --- keep the overlays glued to the boxes --- */

  let raf = 0;
  window.addEventListener('resize', () => {
    if (raf) window.cancelAnimationFrame(raf);
    raf = window.requestAnimationFrame(() => {
      raf = 0;
      paintMainArrows(pointerView(states[idx]!));
      renderDangle();
    });
  });

  /* --- verification hook --- */

  window.__pointers = {
    get line(): number {
      return idx;
    },
    get error(): string | null {
      return states[idx]!.error;
    },
    get vars(): Record<string, { addr: number; value: number | string }> {
      const st = states[idx]!;
      const out: Record<string, { addr: number; value: number | string }> = {};
      for (const def of SLOTS) {
        if (def.kind === 'pad') continue;
        out[def.name] = {
          addr: def.addr,
          value: st.machine.live.has(def.addr) ? load(st.machine, def.addr) : 'uninitialized',
        };
      }
      return out;
    },
    get arrows(): { from: number; to: number }[] {
      return pointerView(states[idx]!).arrows.map((a) => ({ from: a.from, to: a.to }));
    },
    get danglePhase(): number {
      return dPhase;
    },
    get dangleError(): string | null {
      return dPhase === 4 ? 'use-after-free: reading *h after free(b) is undefined behaviour' : null;
    },
  };

  render();
  renderDangle();
}
