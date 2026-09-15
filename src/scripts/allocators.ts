/**
 * Memory allocators over one 512-byte arena.
 *
 * Four strategies share the same arena:
 *   bump     - a single offset pointer, no individual free
 *   freelist - 8-byte headers, first/best fit, splitting and coalescing
 *   pool     - 16 fixed 32-byte slots
 *   stack    - LIFO bump pointer with mark / release
 *
 * `ArenaModel` is pure state + rules (no DOM) so it can be exercised directly;
 * `initAllocators` is the DOM layer that renders it.
 */

export type Strategy = 'bump' | 'freelist' | 'pool' | 'stack';
export type Fit = 'first' | 'best';

const ARENA = 512;
const HEADER = 8;
const SPLIT_SLACK = 16;
const SLOT = 32;
const SLOT_COUNT = ARENA / SLOT;
const PALETTE = 6;
const LOG_MAX = 12;

/** One contiguous region of the arena. `total` includes the block's header. */
export interface ViewBlock {
  addr: number;
  total: number;
  used: boolean;
  /** payload bytes the caller asked for (0 when free) */
  req: number;
  /** allocation id, used to pick a palette colour (-1 when free) */
  id: number;
  /** bytes of `total` spent on the block header */
  header: number;
}

export interface Stats {
  used: number;
  free: number;
  largest: number;
  frag: number;
  waste: number;
  count: number;
  headers: number;
}

type MsgKind = 'info' | 'ok' | 'err';

interface LinearAlloc {
  id: number;
  addr: number;
  size: number;
}

interface Slot {
  id: number;
  req: number;
}

interface HookBlock {
  addr: number;
  size: number;
  state: string;
}

interface AllocHook {
  readonly strategy: string;
  readonly used: number;
  readonly free: number;
  readonly largestFree: number;
  readonly fragmentation: number;
  readonly internalWaste: number;
  readonly blocks: HookBlock[];
  readonly message: string;
}

declare global {
  interface Window {
    __alloc?: AllocHook;
  }
}

export function hex(addr: number): string {
  return '0x' + addr.toString(16).toUpperCase().padStart(3, '0');
}

export class ArenaModel {
  strategy: Strategy = 'bump';
  fit: Fit = 'first';
  message = 'the arena is empty — pick a size and press Alloc.';
  kind: MsgKind = 'info';
  /** address of the block touched by the last successful operation (-1 for none) */
  flash = -1;
  log: string[] = [];
  /** stack allocator rewind points, innermost last */
  marks: number[] = [];

  private linear: LinearAlloc[] = [];
  private fl: ViewBlock[] = [];
  private slots: (Slot | null)[] = [];
  private nextId = 0;

  constructor() {
    this.reset();
    this.log = [];
    this.message = 'the arena is empty — pick a size and press Alloc.';
  }

  reset(): void {
    this.linear = [];
    this.marks = [];
    this.fl = [{ addr: 0, total: ARENA, used: false, req: 0, id: -1, header: HEADER }];
    this.slots = new Array<Slot | null>(SLOT_COUNT).fill(null);
    this.nextId = 0;
    this.flash = -1;
    this.say('info', 'arena reset — all 512 bytes are free again, in O(1).');
    this.write('reset()  -> 512 B free');
  }

  setStrategy(s: Strategy): void {
    this.strategy = s;
    this.reset();
    this.log = [`strategy = ${s}`];
    this.say('info', STRATEGY_INTRO[s]);
  }

  // ---------------------------------------------------------------- allocate

  alloc(n: number, quiet = false): boolean {
    this.flash = -1;
    if (this.strategy === 'pool') return this.allocPool(n, quiet);
    if (this.strategy === 'freelist') return this.allocFreeList(n, quiet);
    return this.allocLinear(n, quiet);
  }

  private allocLinear(n: number, quiet: boolean): boolean {
    const offset = this.offset();
    if (offset + n > ARENA) {
      return this.oom(n, ARENA - offset, quiet);
    }
    this.linear.push({ id: this.nextId++, addr: offset, size: n });
    this.flash = offset;
    const name = this.strategy === 'bump' ? 'bump' : 'stack';
    if (!quiet) {
      this.say(
        'ok',
        `${name}: ${n} B at ${hex(offset)} — the offset moved to ${hex(offset + n)}. One add, O(1), no header, no metadata.`,
      );
      this.write(`alloc(${n}) -> ${hex(offset)}   offset ${hex(offset + n)}`);
    }
    return true;
  }

  private allocFreeList(n: number, quiet: boolean): boolean {
    const need = n + HEADER;
    let chosen = -1;
    for (let i = 0; i < this.fl.length; i++) {
      const b = this.fl[i]!;
      if (b.used || b.total < need) continue;
      if (this.fit === 'first') {
        chosen = i;
        break;
      }
      if (chosen < 0 || b.total < this.fl[chosen]!.total) chosen = i;
    }
    if (chosen < 0) {
      return this.oom(n, this.stats().largest, quiet);
    }
    const b = this.fl[chosen]!;
    b.used = true;
    b.req = n;
    b.id = this.nextId++;
    this.flash = b.addr;
    const slack = b.total - need;
    if (slack > SPLIT_SLACK) {
      const rest: ViewBlock = {
        addr: b.addr + need,
        total: slack,
        used: false,
        req: 0,
        id: -1,
        header: HEADER,
      };
      b.total = need;
      this.fl.splice(chosen + 1, 0, rest);
      if (!quiet) {
        this.say(
          'ok',
          `${this.fit} fit: gap at ${hex(b.addr)} split — ${HEADER} B header + ${n} B payload = ${need} B, leaving a ${rest.total - HEADER} B gap at ${hex(rest.addr)}.`,
        );
        this.write(`alloc(${n}) -> ${hex(b.addr + HEADER)}  ${need} B block, split`);
      }
    } else if (!quiet) {
      this.say(
        'ok',
        `${this.fit} fit: gap at ${hex(b.addr)} handed over whole — splitting would leave only ${slack} B (not more than ${SPLIT_SLACK}), so ${b.total - HEADER - n} B become internal waste.`,
      );
      this.write(`alloc(${n}) -> ${hex(b.addr + HEADER)}  ${b.total} B block, no split`);
    }
    return true;
  }

  private allocPool(n: number, quiet: boolean): boolean {
    if (n > SLOT) {
      if (!quiet) {
        this.say('err', `pool slots are ${SLOT} bytes — ${n} does not fit`);
        this.write(`alloc(${n}) -> refused, slot size is ${SLOT} B`);
      }
      return false;
    }
    const i = this.slots.indexOf(null);
    if (i < 0) {
      if (!quiet) {
        this.say('err', `out of memory: all ${SLOT_COUNT} pool slots are in use`);
        this.write(`alloc(${n}) -> refused, no free slot`);
      }
      return false;
    }
    this.slots[i] = { id: this.nextId++, req: n };
    this.flash = i * SLOT;
    if (!quiet) {
      this.say(
        'ok',
        `slot ${i} at ${hex(i * SLOT)} now holds ${n} B — the slot is ${SLOT} B, so ${SLOT - n} B are internal waste. Taking the slot is O(1).`,
      );
      this.write(`alloc(${n}) -> ${hex(i * SLOT)}   slot ${i}, ${SLOT - n} B wasted`);
    }
    return true;
  }

  private oom(n: number, largest: number, quiet: boolean): boolean {
    if (!quiet) {
      this.say('err', `out of memory: ${n} bytes requested, largest free gap is ${largest}`);
      this.write(`alloc(${n}) -> refused, largest gap ${largest} B`);
    }
    return false;
  }

  // -------------------------------------------------------------------- free

  free(addr: number, quiet = false): boolean {
    this.flash = -1;
    if (this.strategy === 'bump') {
      if (!quiet) {
        this.say('err', 'bump allocator cannot free individual blocks — reset the arena');
        this.write(`free(${hex(addr)}) -> refused, bump has no free`);
      }
      return false;
    }
    const block = this.blocks().find((b) => b.addr === addr);
    if (!block) return false;
    if (!block.used) {
      if (!quiet) {
        this.say('err', `${hex(addr)} is already free — click an allocated block to free it.`);
      }
      return false;
    }
    if (this.strategy === 'pool') return this.freePool(addr, quiet);
    if (this.strategy === 'stack') return this.freeStack(addr, quiet);
    return this.freeFreeList(addr, quiet);
  }

  private freeFreeList(addr: number, quiet: boolean): boolean {
    const i = this.fl.findIndex((b) => b.addr === addr);
    const b = this.fl[i]!;
    const freed = b.req;
    b.used = false;
    b.req = 0;
    b.id = -1;
    let merged = 0;
    const nx = this.fl[i + 1];
    if (nx && !nx.used) {
      b.total += nx.total;
      this.fl.splice(i + 1, 1);
      merged++;
    }
    let gapAddr = b.addr;
    const pv = i > 0 ? this.fl[i - 1]! : undefined;
    if (pv && !pv.used) {
      pv.total += b.total;
      this.fl.splice(i, 1);
      gapAddr = pv.addr;
      merged++;
    }
    const gap = this.fl.find((x) => x.addr === gapAddr)!;
    this.flash = gapAddr;
    if (!quiet) {
      this.say(
        'ok',
        merged > 0
          ? `freed ${freed} B at ${hex(addr)} and coalesced with ${merged} adjacent free ${merged === 1 ? 'neighbour' : 'neighbours'} — one ${gap.total - HEADER} B gap at ${hex(gapAddr)} now.`
          : `freed ${freed} B at ${hex(addr)} — no coalescing, both neighbours are still in use, so this stays a ${gap.total - HEADER} B hole.`,
      );
      this.write(`free(${hex(addr)}) -> ${gap.total - HEADER} B gap, ${merged} merge(s)`);
    }
    return true;
  }

  private freeStack(addr: number, quiet: boolean): boolean {
    const last = this.linear[this.linear.length - 1];
    if (!last || last.addr !== addr) {
      if (!quiet) {
        this.say('err', 'stack allocator frees in LIFO order — free the most recent block first');
        this.write(`free(${hex(addr)}) -> refused, not the top of the stack`);
      }
      return false;
    }
    this.linear.pop();
    this.marks = this.marks.filter((m) => m <= last.addr);
    this.flash = last.addr;
    if (!quiet) {
      this.say('ok', `popped ${last.size} B — the stack offset rewound to ${hex(last.addr)}, O(1).`);
      this.write(`free(${hex(addr)}) -> popped, offset ${hex(last.addr)}`);
    }
    return true;
  }

  private freePool(addr: number, quiet: boolean): boolean {
    const i = Math.floor(addr / SLOT);
    const s = this.slots[i];
    if (!s) return false;
    this.slots[i] = null;
    this.flash = addr;
    if (!quiet) {
      this.say(
        'ok',
        `slot ${i} at ${hex(addr)} returned to the free list — O(1), and it can serve any request of ${SLOT} B or less.`,
      );
      this.write(`free(${hex(addr)}) -> slot ${i} free`);
    }
    return true;
  }

  // ------------------------------------------------------------- stack marks

  mark(): boolean {
    this.flash = -1;
    if (this.strategy !== 'stack') return false;
    const offset = this.offset();
    this.marks.push(offset);
    this.say(
      'ok',
      `mark recorded at ${hex(offset)} — everything allocated after this point can be dropped at once.`,
    );
    this.write(`mark()   -> ${hex(offset)}`);
    return true;
  }

  release(): boolean {
    this.flash = -1;
    if (this.strategy !== 'stack') return false;
    const m = this.marks.pop();
    if (m === undefined) {
      this.say('err', 'no mark set — press mark first to record a rewind point');
      this.write('release() -> refused, no mark');
      return false;
    }
    const dropped = this.linear.filter((a) => a.addr >= m).length;
    this.linear = this.linear.filter((a) => a.addr < m);
    this.flash = m;
    this.say(
      'ok',
      `released to mark ${hex(m)} — ${dropped} allocation${dropped === 1 ? '' : 's'} dropped by writing one number back into the offset.`,
    );
    this.write(`release() -> ${hex(m)}, dropped ${dropped}`);
    return true;
  }

  // -------------------------------------------------------------------- demo

  /** Fill the arena with equal-sized blocks, then free the 2nd and the 4th. */
  demo(): void {
    this.reset();
    const n = this.strategy === 'pool' ? 16 : 64;
    let guard = 0;
    while (guard++ <= SLOT_COUNT && this.alloc(n, true));
    const filled = this.stats().count;
    for (const nth of [3, 1]) {
      const used = this.blocks().filter((b) => b.used);
      const b = used[nth];
      if (b) this.free(b.addr, true);
    }
    const s = this.stats();
    this.flash = -1;
    this.write(`-- fragment demo: alloc(${n}) x${filled}, then free the 4th and the 2nd --`);
    switch (this.strategy) {
      case 'bump':
        this.say(
          'info',
          `bump: ${filled} allocations of ${n} B filled all ${s.used} bytes. Both free calls were refused — a bump allocator only reclaims by resetting the whole arena.`,
        );
        break;
      case 'freelist':
        this.say(
          'info',
          `free list: ${s.free} B are free but the largest gap is only ${s.largest} B, because the two holes are separated by a live block — ${s.frag.toFixed(0)}% external fragmentation. Ask for 128 B now and it fails, even though ${s.free} B are free.`,
        );
        break;
      case 'pool':
        this.say(
          'info',
          `pool: ${filled} slots of ${SLOT} B were filled with ${n} B objects, then 2 slots were freed — the ${s.count} live objects still waste ${s.waste} B inside their slots. The two holes are not adjacent, yet every request of ${SLOT} B or less still succeeds: a pool has no external fragmentation.`,
        );
        break;
      case 'stack':
        this.say(
          'info',
          `stack: ${filled} allocations fill the arena, and freeing the 4th and the 2nd was refused — LIFO order allows only the top block. Pop from the end, or rewind with mark / release.`,
        );
        break;
    }
  }

  // -------------------------------------------------------------------- view

  offset(): number {
    let n = 0;
    for (const a of this.linear) n += a.size;
    return n;
  }

  blocks(): ViewBlock[] {
    if (this.strategy === 'freelist') return this.fl;
    if (this.strategy === 'pool') {
      return this.slots.map((s, i) => ({
        addr: i * SLOT,
        total: SLOT,
        used: s !== null,
        req: s ? s.req : 0,
        id: s ? s.id : -1,
        header: 0,
      }));
    }
    const out: ViewBlock[] = this.linear.map((a) => ({
      addr: a.addr,
      total: a.size,
      used: true,
      req: a.size,
      id: a.id,
      header: 0,
    }));
    const offset = this.offset();
    if (offset < ARENA) {
      out.push({ addr: offset, total: ARENA - offset, used: false, req: 0, id: -1, header: 0 });
    }
    return out;
  }

  stats(): Stats {
    let used = 0;
    let free = 0;
    let waste = 0;
    let count = 0;
    let headers = 0;
    let largest = 0;
    let run = 0;
    for (const b of this.blocks()) {
      headers += b.header;
      if (b.used) {
        used += b.total;
        waste += b.total - b.header - b.req;
        count++;
        if (run > largest) largest = run;
        run = 0;
      } else {
        const usable = b.total - b.header;
        free += usable;
        run += usable;
      }
    }
    if (run > largest) largest = run;
    return {
      used,
      free,
      largest,
      frag: free > 0 ? (1 - largest / free) * 100 : 0,
      waste,
      count,
      headers,
    };
  }

  /** Address of the block the next alloc of `n` bytes would land in, or -1. */
  target(n: number): number {
    if (this.strategy === 'pool') {
      if (n > SLOT) return -1;
      const i = this.slots.indexOf(null);
      return i < 0 ? -1 : i * SLOT;
    }
    if (this.strategy === 'freelist') {
      const need = n + HEADER;
      let chosen: ViewBlock | null = null;
      for (const b of this.fl) {
        if (b.used || b.total < need) continue;
        if (this.fit === 'first') return b.addr;
        if (!chosen || b.total < chosen.total) chosen = b;
      }
      return chosen ? chosen.addr : -1;
    }
    const offset = this.offset();
    return offset + n > ARENA ? -1 : offset;
  }

  hookBlocks(): HookBlock[] {
    return this.blocks().map((b) => ({
      addr: b.addr,
      size: b.total,
      state: b.used ? 'used' : 'free',
    }));
  }

  private say(kind: MsgKind, message: string): void {
    this.kind = kind;
    this.message = message;
  }

  private write(line: string): void {
    this.log.push(line);
    if (this.log.length > LOG_MAX) this.log.shift();
  }
}

const STRATEGY_INTRO: Record<Strategy, string> = {
  bump: 'bump / arena: one offset pointer. Alloc adds, free does nothing, reset drops everything at once.',
  freelist:
    'free list: every block carries an 8 B header, so a 64 B request costs 72 B. Gaps split and coalesce.',
  pool: 'pool / slab: 16 fixed 32 B slots. Any request of 32 B or less takes a whole slot; the rest of the slot is wasted.',
  stack: 'stack: allocate like a bump pointer, but free only the most recent block — or rewind to a mark.',
};

const BLURB: Record<Strategy, string> = {
  bump: 'A bump allocator is a single offset into the arena. alloc(n) checks offset + n against 512, returns the old offset and advances it — no header, no search, no metadata. There is no way to free one block, because nothing records where blocks begin or how big they are. Only reset reclaims, and it reclaims everything by writing 0 into the offset.',
  freelist:
    'A free list threads every block, used or free, with an 8-byte header, so a 64-byte request occupies 72 bytes. alloc scans the list for a gap that fits — first fit takes the first one, best fit takes the tightest one. If the gap is more than 16 bytes larger than the request it is split; otherwise it is handed over whole and the remainder becomes internal waste. free flips the header and coalesces with adjacent free neighbours.',
  pool: 'A pool (slab) allocator pre-divides the arena into 16 fixed 32-byte slots. alloc takes the first free slot in O(1) and refuses outright anything larger than a slot. Because every slot is interchangeable, a pool cannot fragment externally — but an object smaller than 32 bytes leaves the rest of its slot unusable, which is internal waste.',
  stack: 'A stack allocator bumps like an arena but adds a discipline: frees must unwind in reverse. Only the most recent block can be popped; anything else is refused, because releasing memory in the middle would leave the offset stranded past a hole. mark records the current offset and release rewinds to it, dropping every allocation made since in one assignment.',
};

const HINT: Record<Strategy, (s: Stats, offset: number) => string> = {
  bump: (s, offset) =>
    `Offset is at ${hex(offset)}: ${s.used} B used, ${s.free} B free in one contiguous run, so external fragmentation is 0%. Reset returns all ${ARENA} B and drops ${s.count} allocation${s.count === 1 ? '' : 's'} in a single instruction.`,
  freelist: (s) =>
    `Headers cost ${s.headers} B across ${s.count} live block${s.count === 1 ? '' : 's'} plus the free gaps. Free bytes exclude each free block's own header, because a future allocation reuses it. External fragmentation is 1 - ${s.largest}/${s.free || 1} = ${s.frag.toFixed(0)}%: the share of free memory that no single request can reach.`,
  pool: (s) =>
    `Internal waste is ${s.waste} B — the bytes left over inside 32 B slots after each object. The fragmentation figure above measures contiguous free runs, but a pool never needs contiguity: any free slot serves any request of 32 B or less, so that number costs it nothing. Its real cost is the waste.`,
  stack: (s, offset) =>
    `Offset is at ${hex(offset)} with ${s.count} live block${s.count === 1 ? '' : 's'}, and only the top one can be freed. A mark remembers an offset so a whole group of allocations can be released at once — the classic per-frame or per-scope scratch arena.`,
};

export function initAllocators(root: HTMLElement): void {
  const stratChips = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-strategy]'));
  const fitChips = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-fit]'));
  const sizeChips = Array.from(root.querySelectorAll<HTMLButtonElement>('[data-size]'));
  const fitRow = root.querySelector<HTMLElement>('.al-fitrow');
  const allocBtn = root.querySelector<HTMLButtonElement>('.al-alloc');
  const markBtn = root.querySelector<HTMLButtonElement>('.al-mark');
  const releaseBtn = root.querySelector<HTMLButtonElement>('.al-release');
  const demoBtn = root.querySelector<HTMLButtonElement>('.al-demo');
  const resetBtn = root.querySelector<HTMLButtonElement>('.al-reset');
  const barWrap = root.querySelector<HTMLElement>('.al-barwrap');
  const bar = root.querySelector<HTMLElement>('.al-bar');
  const msgEl = root.querySelector<HTMLElement>('.al-msg');
  const statsEl = root.querySelector<HTMLElement>('.al-stats');
  const blurbEl = root.querySelector<HTMLElement>('.al-blurb');
  const hintEl = root.querySelector<HTMLElement>('.al-hint');
  const logEl = root.querySelector<HTMLElement>('.al-log');
  if (
    !fitRow ||
    !allocBtn ||
    !markBtn ||
    !releaseBtn ||
    !demoBtn ||
    !resetBtn ||
    !barWrap ||
    !bar ||
    !msgEl ||
    !statsEl ||
    !blurbEl ||
    !hintEl ||
    !logEl
  ) {
    return;
  }

  const model = new ArenaModel();
  let size = 64;

  const pill = (text: string): HTMLElement => {
    const el = document.createElement('span');
    el.className = 'meta';
    el.textContent = text;
    return el;
  };

  const blockTitle = (block: ViewBlock): string => {
    const parts = [`${hex(block.addr)} to ${hex(block.addr + block.total)} · ${block.total} B block`];
    if (block.header > 0) parts.push(`${block.header} B header`);
    if (block.used) {
      parts.push(`${block.req} B requested`);
      const waste = block.total - block.header - block.req;
      if (waste > 0) parts.push(`${waste} B internal waste`);
      parts.push('click to free');
    } else {
      parts.push(`${block.total - block.header} B usable`);
    }
    return parts.join(' · ');
  };

  const render: () => void = () => {
    const blocks = model.blocks();
    const s = model.stats();
    const tgt = model.target(size);

    bar.textContent = '';
    for (const b of blocks) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'al-block ' + (b.used ? `used al-c${b.id % PALETTE}` : 'free');
      if (b.addr === tgt) btn.classList.add('al-target');
      if (b.addr === model.flash) btn.classList.add('al-new');
      btn.style.width = `${(b.total / ARENA) * 100}%`;
      btn.title = blockTitle(b);
      btn.setAttribute(
        'aria-label',
        `${b.used ? 'allocated' : 'free'} block at ${hex(b.addr)}, ${b.total} bytes`,
      );
      if (b.header > 0) {
        const hdr = document.createElement('span');
        hdr.className = 'al-hdr';
        hdr.style.width = `${(b.header / b.total) * 100}%`;
        btn.appendChild(hdr);
      }
      const waste = b.used ? b.total - b.header - b.req : 0;
      if (waste > 0) {
        const w = document.createElement('span');
        w.className = 'al-waste';
        w.style.width = `${(waste / b.total) * 100}%`;
        btn.appendChild(w);
      }
      const lbl = document.createElement('span');
      lbl.className = 'al-lbl';
      const top = document.createElement('b');
      top.textContent = b.used ? `${b.req} B` : `${b.total - b.header} B`;
      const addr = document.createElement('i');
      addr.textContent = hex(b.addr);
      lbl.append(top, addr);
      btn.appendChild(lbl);
      btn.addEventListener('click', () => {
        model.free(b.addr);
        render();
      });
      bar.appendChild(btn);
    }

    for (const old of Array.from(barWrap.querySelectorAll('.al-mark-pin'))) old.remove();
    if (model.strategy === 'stack') {
      for (const m of model.marks) {
        const pin = document.createElement('span');
        pin.className = 'al-mark-pin';
        pin.style.left = `${(m / ARENA) * 100}%`;
        const cap = document.createElement('i');
        cap.textContent = `mark ${hex(m)}`;
        pin.appendChild(cap);
        barWrap.appendChild(pin);
      }
    }

    statsEl.textContent = '';
    statsEl.append(
      pill(`used ${s.used} B`),
      pill(`free ${s.free} B`),
      pill(`largest gap ${s.largest} B`),
      pill(`external frag ${s.frag.toFixed(0)}%`),
      pill(`internal waste ${s.waste} B`),
      pill(`allocations ${s.count}`),
    );
    if (model.strategy === 'freelist') statsEl.append(pill(`headers ${s.headers} B`));

    msgEl.className = `al-msg ${model.kind}`;
    msgEl.textContent = model.message;
    blurbEl.textContent = BLURB[model.strategy];
    hintEl.textContent =
      HINT[model.strategy](s, model.offset()) +
      (tgt >= 0
        ? ` The dashed outline marks where the next ${size} B allocation would land.`
        : ` Nothing in the arena can hold ${size} B right now.`);
    logEl.textContent = model.log.join('\n');

    fitRow.classList.toggle('al-off', model.strategy !== 'freelist');
    markBtn.classList.toggle('al-off', model.strategy !== 'stack');
    releaseBtn.classList.toggle('al-off', model.strategy !== 'stack');
    releaseBtn.disabled = model.marks.length === 0;
  };

  for (const chip of stratChips) {
    chip.addEventListener('click', () => {
      const s = chip.dataset.strategy as Strategy;
      if (s === model.strategy) return;
      model.setStrategy(s);
      for (const c of stratChips) c.classList.toggle('active', c === chip);
      render();
    });
  }
  for (const chip of fitChips) {
    chip.addEventListener('click', () => {
      model.fit = chip.dataset.fit as Fit;
      for (const c of fitChips) c.classList.toggle('active', c === chip);
      render();
    });
  }
  for (const chip of sizeChips) {
    chip.addEventListener('click', () => {
      size = Number(chip.dataset.size);
      for (const c of sizeChips) c.classList.toggle('active', c === chip);
      render();
    });
  }
  allocBtn.addEventListener('click', () => {
    model.alloc(size);
    render();
  });
  markBtn.addEventListener('click', () => {
    model.mark();
    render();
  });
  releaseBtn.addEventListener('click', () => {
    model.release();
    render();
  });
  demoBtn.addEventListener('click', () => {
    model.demo();
    render();
  });
  resetBtn.addEventListener('click', () => {
    model.reset();
    render();
  });

  window.__alloc = {
    get strategy() {
      return model.strategy;
    },
    get used() {
      return model.stats().used;
    },
    get free() {
      return model.stats().free;
    },
    get largestFree() {
      return model.stats().largest;
    },
    get fragmentation() {
      return model.stats().frag;
    },
    get internalWaste() {
      return model.stats().waste;
    },
    get blocks() {
      return model.hookBlocks();
    },
    get message() {
      return model.message;
    },
  };

  render();
}
