/**
 * Cache hits & misses.
 *
 * Memory under test: int32[256] = 1024 bytes at byte addresses 0..1023.
 * Cache: 64-byte lines (the x86-64 line size), configurable sets and ways,
 * true LRU replacement inside a set.
 */

export type CachePattern = 'sequential' | 'stride4' | 'stride16' | 'random' | 'twopass';

interface CacheHook {
  readonly hits: number;
  readonly misses: number;
  readonly compulsory: number;
  readonly conflict: number;
  readonly accesses: number;
  readonly hitRate: number;
  readonly pattern: string;
  readonly sets: number;
  readonly ways: number;
  readonly done: boolean;
}

declare global {
  interface Window {
    __cache?: CacheHook;
  }
}

const LINE_BYTES = 64;
const INT_BYTES = 4;
const NUM_INTS = 256;
const INTS_PER_LINE = LINE_BYTES / INT_BYTES; // 16
const NUM_BLOCKS = (NUM_INTS * INT_BYTES) / LINE_BYTES; // 16
const ARRAY_BYTES = NUM_INTS * INT_BYTES; // 1024
const RANDOM_SEED = 12345;
const RANDOM_ACCESSES = 256;

/** Deterministic linear congruential generator (Numerical Recipes constants). */
function lcgIndices(count: number, seed: number): number[] {
  const out: number[] = [];
  let state = seed >>> 0;
  for (let i = 0; i < count; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    out.push(state >>> 24); // top 8 bits -> 0..255
  }
  return out;
}

export function buildSequence(pattern: CachePattern): number[] {
  const out: number[] = [];
  switch (pattern) {
    case 'sequential':
      for (let i = 0; i < NUM_INTS; i++) out.push(i);
      return out;
    case 'stride4':
      for (let i = 0; i < NUM_INTS; i += 4) out.push(i);
      return out;
    case 'stride16':
      for (let i = 0; i < NUM_INTS; i += 16) out.push(i);
      return out;
    case 'random':
      return lcgIndices(RANDOM_ACCESSES, RANDOM_SEED);
    case 'twopass':
      for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < NUM_INTS; i++) out.push(i);
      }
      return out;
  }
}

interface PatternInfo {
  label: string;
  /** int indices between consecutive accesses, or null when non-strided */
  stride: number | null;
  blurb: string;
}

const PATTERNS: Record<CachePattern, PatternInfo> = {
  sequential: {
    label: 'sequential',
    stride: 1,
    blurb:
      'i = 0, 1, 2, … 255. One miss per 64-byte line, then 15 hits off that line: every byte the cache paid for gets used.',
  },
  stride4: {
    label: 'stride 4',
    stride: 4,
    blurb:
      'i = 0, 4, 8, … 4 ints = 16 bytes, so 4 accesses land in each 64-byte line: 1 miss then 3 hits per line.',
  },
  stride16: {
    label: 'stride 16',
    stride: 16,
    blurb:
      'i = 0, 16, 32, … 16 ints = exactly 64 bytes, so every single access opens a brand new line. This is the pathological case: no reuse at all.',
  },
  random: {
    label: 'random',
    stride: null,
    blurb:
      'Seeded LCG indices (reproducible across replays). Reuse is accidental, so the hit rate follows cache capacity rather than locality.',
  },
  twopass: {
    label: 'two passes',
    stride: 1,
    blurb:
      'i = 0…255, then 0…255 again. If the array still fits in the cache the second pass is free; if it does not, every line is fetched twice.',
  },
};

interface CacheLine {
  tag: number;
  block: number;
  lastUsed: number;
}

type MissKind = 'compulsory' | 'conflict';

export interface AccessResult {
  index: number;
  byte: number;
  block: number;
  set: number;
  tag: number;
  way: number;
  hit: boolean;
  kind: 'hit' | MissKind;
  evictedBlock: number | null;
  evictedTag: number | null;
}

export class CacheSim {
  readonly sets: number;
  readonly ways: number;
  readonly lines: (CacheLine | null)[][];
  accesses = 0;
  hits = 0;
  misses = 0;
  compulsory = 0;
  conflict = 0;
  private clock = 0;
  private everLoaded = new Set<number>();

  constructor(sets: number, ways: number) {
    this.sets = sets;
    this.ways = ways;
    this.lines = [];
    for (let s = 0; s < sets; s++) {
      this.lines.push(new Array<CacheLine | null>(ways).fill(null));
    }
  }

  get hitRate(): number {
    return this.accesses === 0 ? 0 : this.hits / this.accesses;
  }

  residentBlocks(): Set<number> {
    const blocks = new Set<number>();
    for (const row of this.lines) {
      for (const line of row) {
        if (line) blocks.add(line.block);
      }
    }
    return blocks;
  }

  access(index: number): AccessResult {
    const byte = index * INT_BYTES;
    const block = Math.floor(byte / LINE_BYTES);
    const set = block % this.sets;
    const tag = Math.floor(block / this.sets);
    const row = this.lines[set]!;

    this.accesses++;
    this.clock++;

    for (let w = 0; w < this.ways; w++) {
      const line = row[w];
      if (line && line.tag === tag) {
        line.lastUsed = this.clock;
        this.hits++;
        return {
          index,
          byte,
          block,
          set,
          tag,
          way: w,
          hit: true,
          kind: 'hit',
          evictedBlock: null,
          evictedTag: null,
        };
      }
    }

    this.misses++;
    const kind: MissKind = this.everLoaded.has(block) ? 'conflict' : 'compulsory';
    if (kind === 'compulsory') this.compulsory++;
    else this.conflict++;
    this.everLoaded.add(block);

    let victim = -1;
    for (let w = 0; w < this.ways; w++) {
      if (!row[w]) {
        victim = w;
        break;
      }
    }
    let evictedBlock: number | null = null;
    let evictedTag: number | null = null;
    if (victim === -1) {
      // true LRU: oldest use counter in this set
      let oldest = Infinity;
      for (let w = 0; w < this.ways; w++) {
        const line = row[w]!;
        if (line.lastUsed < oldest) {
          oldest = line.lastUsed;
          victim = w;
        }
      }
      const doomed = row[victim]!;
      evictedBlock = doomed.block;
      evictedTag = doomed.tag;
    }
    row[victim] = { tag, block, lastUsed: this.clock };

    return {
      index,
      byte,
      block,
      set,
      tag,
      way: victim,
      hit: false,
      kind,
      evictedBlock,
      evictedTag,
    };
  }
}

function pct(x: number): string {
  return `${(x * 100).toFixed(2).replace(/\.00$/, '')}%`;
}

export function initCache(root: HTMLElement): void {
  const patternChips = [...root.querySelectorAll<HTMLButtonElement>('.chip[data-pattern]')];
  const setsChips = [...root.querySelectorAll<HTMLButtonElement>('.chip[data-sets]')];
  const waysChips = [...root.querySelectorAll<HTMLButtonElement>('.chip[data-ways]')];
  const playBtn = root.querySelector<HTMLButtonElement>('.cx-play')!;
  const stepBtn = root.querySelector<HTMLButtonElement>('.cx-step')!;
  const resetBtn = root.querySelector<HTMLButtonElement>('.cx-reset')!;
  const speedInput = root.querySelector<HTMLInputElement>('.cx-speed')!;
  const speedVal = root.querySelector<HTMLElement>('.cx-speed-val')!;
  const capacityEl = root.querySelector<HTMLElement>('.cx-capacity')!;
  const blurbEl = root.querySelector<HTMLElement>('.cx-blurb')!;
  const wasteEl = root.querySelector<HTMLElement>('.cx-waste')!;
  const statsEl = root.querySelector<HTMLElement>('.cx-stats')!;
  const explainEl = root.querySelector<HTMLElement>('.cx-explain')!;
  const memEl = root.querySelector<HTMLElement>('.cx-mem')!;
  const cacheEl = root.querySelector<HTMLElement>('.cx-cache')!;
  const cacheLabelEl = root.querySelector<HTMLElement>('.cx-cache-label')!;

  let pattern = (patternChips.find((c) => c.classList.contains('active'))!.dataset.pattern ??
    'sequential') as CachePattern;
  let numSets = Number(setsChips.find((c) => c.classList.contains('active'))!.dataset.sets);
  let numWays = Number(waysChips.find((c) => c.classList.contains('active'))!.dataset.ways);

  let sequence = buildSequence(pattern);
  let sim = new CacheSim(numSets, numWays);
  let cursor = 0;
  let last: AccessResult | null = null;
  let playing = false;
  let timer: number | null = null;

  // --- static memory grid: 16 line groups of 16 int cells -------------------
  const memCells: HTMLElement[] = [];
  const memGroups: HTMLElement[] = [];
  for (let b = 0; b < NUM_BLOCKS; b++) {
    const group = document.createElement('div');
    group.className = 'cx-line';
    const label = document.createElement('span');
    label.className = 'cx-line-label';
    label.textContent = `blk ${b} · ${b * LINE_BYTES}–${b * LINE_BYTES + LINE_BYTES - 1}`;
    const cells = document.createElement('div');
    cells.className = 'cx-line-cells';
    for (let k = 0; k < INTS_PER_LINE; k++) {
      const i = b * INTS_PER_LINE + k;
      const cell = document.createElement('div');
      cell.className = 'cx-cell';
      cell.title = `int[${i}] · byte ${i * INT_BYTES} · block ${b}`;
      cells.appendChild(cell);
      memCells.push(cell);
    }
    group.append(label, cells);
    memEl.appendChild(group);
    memGroups.push(group);
  }

  // --- stat pills ------------------------------------------------------------
  function pill(key: string): HTMLElement {
    const el = document.createElement('span');
    el.className = `meta cx-stat cx-stat-${key}`;
    statsEl.appendChild(el);
    return el;
  }
  const stats = {
    progress: pill('progress'),
    accesses: pill('accesses'),
    hits: pill('hits'),
    misses: pill('misses'),
    compulsory: pill('compulsory'),
    conflict: pill('conflict'),
    hitrate: pill('hitrate'),
  };

  // --- cache grid (rebuilt when geometry changes) ----------------------------
  let wayCells: HTMLElement[][] = [];
  let setLabels: HTMLElement[] = [];

  function buildCacheGrid(): void {
    cacheEl.replaceChildren();
    cacheEl.style.gridTemplateColumns = `auto repeat(${numWays}, minmax(7rem, 1fr))`;
    wayCells = [];
    setLabels = [];

    const corner = document.createElement('div');
    corner.className = 'cx-hdr cx-hdr-corner';
    corner.textContent = 'set';
    cacheEl.appendChild(corner);
    for (let w = 0; w < numWays; w++) {
      const hdr = document.createElement('div');
      hdr.className = 'cx-hdr';
      hdr.textContent = `way ${w}`;
      cacheEl.appendChild(hdr);
    }

    for (let s = 0; s < numSets; s++) {
      const lbl = document.createElement('div');
      lbl.className = 'cx-setlbl';
      lbl.textContent = String(s);
      cacheEl.appendChild(lbl);
      setLabels.push(lbl);
      const row: HTMLElement[] = [];
      for (let w = 0; w < numWays; w++) {
        const cell = document.createElement('div');
        cell.className = 'cx-way';
        const tagEl = document.createElement('span');
        tagEl.className = 'cx-way-tag';
        const blkEl = document.createElement('span');
        blkEl.className = 'cx-way-blk';
        cell.append(tagEl, blkEl);
        cacheEl.appendChild(cell);
        row.push(cell);
      }
      wayCells.push(row);
    }
  }

  function describe(r: AccessResult): string {
    const head = `int[${r.index}] @ byte ${r.byte} → block ${r.block} → set ${r.set}, tag ${r.tag}`;
    if (r.hit) return `${head} — HIT in way ${r.way}`;
    const evicted =
      r.evictedBlock === null
        ? 'evicted nothing (way was empty)'
        : `evicted blk ${r.evictedBlock} (tag ${r.evictedTag}) from way ${r.way}`;
    const kind = r.kind === 'compulsory' ? 'compulsory' : 'conflict/capacity';
    return `${head} — MISS (${kind}), ${evicted}`;
  }

  function renderConfig(): void {
    const info = PATTERNS[pattern];
    const cap = numSets * numWays * LINE_BYTES;
    const fits =
      cap >= ARRAY_BYTES
        ? ` — that is ≥ ${ARRAY_BYTES} B, so the whole int32[256] array fits at once.`
        : ` — only ${cap} B of the ${ARRAY_BYTES} B array can be resident (${Math.round(
            (cap / ARRAY_BYTES) * 100,
          )}%), so lines must be evicted.`;
    capacityEl.textContent =
      `Capacity = ${numSets} sets × ${numWays} way${numWays > 1 ? 's' : ''} × 64 B line = ${cap} B` +
      fits;
    cacheLabelEl.textContent = `${numSets} sets × ${numWays} way${
      numWays > 1 ? 's' : ''
    } × 64 B = ${cap} B, true LRU`;
    blurbEl.textContent = info.blurb;

    if (info.stride === null) {
      wasteEl.textContent =
        'Every miss still pulls a full 64-byte line, whether or not the other 60 bytes are ever read.';
    } else {
      const perLine = Math.min(INTS_PER_LINE, INTS_PER_LINE / info.stride);
      const usedBytes = perLine * INT_BYTES;
      const wasted = LINE_BYTES - usedBytes;
      wasteEl.textContent =
        `Each miss loads a whole 64-byte line. This pattern reads ${perLine} int${
          perLine > 1 ? 's' : ''
        } (${usedBytes} B) per line, so ${wasted} of every 64 bytes fetched are wasted ` +
        `(${pct(wasted / LINE_BYTES)} of the bandwidth). Best possible hit rate: ${pct(
          (perLine - 1) / perLine,
        )}.`;
    }
  }

  function render(): void {
    const resident = sim.residentBlocks();
    for (let b = 0; b < NUM_BLOCKS; b++) {
      memGroups[b]!.classList.toggle('resident', resident.has(b));
      memGroups[b]!.classList.toggle('cur-line', last !== null && last.block === b);
    }
    for (const cell of memCells) cell.classList.remove('cur');
    if (last) memCells[last.index]!.classList.add('cur');

    for (let s = 0; s < numSets; s++) {
      setLabels[s]!.classList.toggle('cur', last !== null && last.set === s);
      for (let w = 0; w < numWays; w++) {
        const cell = wayCells[s]![w]!;
        const line = sim.lines[s]![w];
        const tagEl = cell.children[0] as HTMLElement;
        const blkEl = cell.children[1] as HTMLElement;
        let cls = 'cx-way';
        if (line) {
          cls += ' filled';
          tagEl.textContent = `tag ${line.tag}`;
          blkEl.textContent = `blk ${line.block} · bytes ${line.block * LINE_BYTES}–${
            line.block * LINE_BYTES + LINE_BYTES - 1
          }`;
        } else {
          tagEl.textContent = '—';
          blkEl.textContent = 'empty';
        }
        if (last && last.set === s && last.way === w) cls += last.hit ? ' hit' : ' fill';
        cell.className = cls;
      }
    }

    stats.progress.textContent = `access ${cursor} / ${sequence.length}`;
    stats.accesses.textContent = `accesses ${sim.accesses}`;
    stats.hits.textContent = `hits ${sim.hits}`;
    stats.misses.textContent = `misses ${sim.misses}`;
    stats.compulsory.textContent = `compulsory ${sim.compulsory}`;
    stats.conflict.textContent = `conflict/capacity ${sim.conflict}`;
    stats.hitrate.textContent = `hit rate ${pct(sim.hitRate)}`;

    explainEl.textContent = last
      ? describe(last)
      : `Ready — ${PATTERNS[pattern].label}, ${sequence.length} accesses queued. Press Step or Play.`;

    const done = cursor >= sequence.length;
    stepBtn.disabled = done;
    playBtn.disabled = done;
    playBtn.textContent = playing ? 'Pause' : 'Play';
  }

  function step(): boolean {
    if (cursor >= sequence.length) return false;
    last = sim.access(sequence[cursor]!);
    cursor++;
    render();
    return true;
  }

  function stopPlaying(): void {
    playing = false;
    if (timer !== null) {
      window.clearTimeout(timer);
      timer = null;
    }
  }

  function tick(): void {
    timer = null;
    if (!playing) return;
    if (!step()) {
      stopPlaying();
      render();
      return;
    }
    if (cursor >= sequence.length) {
      stopPlaying();
      render();
      return;
    }
    timer = window.setTimeout(tick, 1000 / Number(speedInput.value));
  }

  function play(): void {
    if (cursor >= sequence.length) return;
    playing = true;
    render();
    tick();
  }

  function reset(): void {
    stopPlaying();
    sequence = buildSequence(pattern);
    sim = new CacheSim(numSets, numWays);
    cursor = 0;
    last = null;
    renderConfig();
    render();
  }

  function rebuild(): void {
    stopPlaying();
    buildCacheGrid();
    reset();
  }

  for (const chip of patternChips) {
    chip.addEventListener('click', () => {
      const next = chip.dataset.pattern as CachePattern;
      if (next === pattern) return;
      pattern = next;
      for (const c of patternChips) c.classList.toggle('active', c === chip);
      reset();
    });
  }
  for (const chip of setsChips) {
    chip.addEventListener('click', () => {
      const next = Number(chip.dataset.sets);
      if (next === numSets) return;
      numSets = next;
      for (const c of setsChips) c.classList.toggle('active', c === chip);
      rebuild();
    });
  }
  for (const chip of waysChips) {
    chip.addEventListener('click', () => {
      const next = Number(chip.dataset.ways);
      if (next === numWays) return;
      numWays = next;
      for (const c of waysChips) c.classList.toggle('active', c === chip);
      rebuild();
    });
  }

  playBtn.addEventListener('click', () => {
    if (playing) {
      stopPlaying();
      render();
    } else {
      play();
    }
  });
  stepBtn.addEventListener('click', () => {
    stopPlaying();
    step();
    render();
  });
  resetBtn.addEventListener('click', reset);
  speedInput.addEventListener('input', () => {
    speedVal.textContent = `${speedInput.value} /s`;
    if (playing && timer !== null) {
      window.clearTimeout(timer);
      timer = window.setTimeout(tick, 1000 / Number(speedInput.value));
    }
  });

  window.__cache = {
    get hits() {
      return sim.hits;
    },
    get misses() {
      return sim.misses;
    },
    get compulsory() {
      return sim.compulsory;
    },
    get conflict() {
      return sim.conflict;
    },
    get accesses() {
      return sim.accesses;
    },
    get hitRate() {
      return sim.hitRate;
    },
    get pattern() {
      return pattern;
    },
    get sets() {
      return numSets;
    },
    get ways() {
      return numWays;
    },
    get done() {
      return cursor >= sequence.length;
    },
  };

  speedVal.textContent = `${speedInput.value} /s`;
  buildCacheGrid();
  reset();
}
