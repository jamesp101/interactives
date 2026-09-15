type Level = 'raid0' | 'raid1' | 'raid5' | 'raid6' | 'raid10';

interface CellDef {
  disk: number;
  kind: 'data' | 'mirror' | 'p' | 'q';
  label: string;
}

interface RaidHook {
  readonly level: Level;
  readonly disks: number;
  readonly failed: number[];
  readonly status: 'healthy' | 'degraded' | 'failed';
}

declare global {
  interface Window {
    __raid?: RaidHook;
  }
}

const LEVEL_INFO: Record<Level, { name: string; min: number; max: number; evenOnly: boolean; blurb: string }> = {
  raid0: {
    name: 'RAID 0',
    min: 2,
    max: 8,
    evenOnly: false,
    blurb:
      'Striping only: each stripe is split across every disk. Full capacity and fast, but zero redundancy — losing any one disk loses the whole array.',
  },
  raid1: {
    name: 'RAID 1',
    min: 2,
    max: 4,
    evenOnly: false,
    blurb:
      'Mirroring: every block is written identically to every disk. The array survives as long as one disk lives, but usable capacity is a single disk.',
  },
  raid5: {
    name: 'RAID 5',
    min: 3,
    max: 8,
    evenOnly: false,
    blurb:
      'Striping with rotating parity: each stripe stores one parity block (p) on a different disk. Any single failed disk can be rebuilt from the others.',
  },
  raid6: {
    name: 'RAID 6',
    min: 4,
    max: 8,
    evenOnly: false,
    blurb:
      'Dual parity: each stripe carries two independent parity blocks (p and q), so the array survives any two simultaneous disk failures.',
  },
  raid10: {
    name: 'RAID 10',
    min: 4,
    max: 8,
    evenOnly: true,
    blurb:
      'Mirrored pairs, striped: data stripes across mirror pairs. It survives one failure per pair — but losing both disks of the same pair loses the array.',
  },
};

const INITIAL_STRIPES = 4;
const MAX_STRIPES = 8;

function stripeCells(level: Level, n: number, s: number): CellDef[] {
  const L = String.fromCharCode(65 + (s % 26));
  const cells: CellDef[] = [];
  switch (level) {
    case 'raid0':
      for (let d = 0; d < n; d++) cells.push({ disk: d, kind: 'data', label: `${L}${d + 1}` });
      break;
    case 'raid1':
      for (let d = 0; d < n; d++)
        cells.push({ disk: d, kind: d === 0 ? 'data' : 'mirror', label: `${L}1` });
      break;
    case 'raid5': {
      const p = n - 1 - (s % n);
      let idx = 1;
      for (let d = 0; d < n; d++) {
        if (d === p) cells.push({ disk: d, kind: 'p', label: `${L}p` });
        else cells.push({ disk: d, kind: 'data', label: `${L}${idx++}` });
      }
      break;
    }
    case 'raid6': {
      const p = n - 1 - (s % n);
      const q = (p + 1) % n;
      let idx = 1;
      for (let d = 0; d < n; d++) {
        if (d === p) cells.push({ disk: d, kind: 'p', label: `${L}p` });
        else if (d === q) cells.push({ disk: d, kind: 'q', label: `${L}q` });
        else cells.push({ disk: d, kind: 'data', label: `${L}${idx++}` });
      }
      break;
    }
    case 'raid10':
      for (let k = 0; k < n >> 1; k++) {
        cells.push({ disk: 2 * k, kind: 'data', label: `${L}${k + 1}` });
        cells.push({ disk: 2 * k + 1, kind: 'mirror', label: `${L}${k + 1}` });
      }
      break;
  }
  return cells;
}

function arrayIntact(level: Level, n: number, failed: Set<number>): boolean {
  switch (level) {
    case 'raid0':
      return failed.size === 0;
    case 'raid1':
      return failed.size < n;
    case 'raid5':
      return failed.size <= 1;
    case 'raid6':
      return failed.size <= 2;
    case 'raid10':
      for (let k = 0; k < n >> 1; k++) {
        if (failed.has(2 * k) && failed.has(2 * k + 1)) return false;
      }
      return true;
  }
}

function cellRecoverable(level: Level, n: number, failed: Set<number>, cell: CellDef): boolean {
  switch (level) {
    case 'raid0':
      return false;
    case 'raid1':
      return failed.size < n;
    case 'raid5':
      return failed.size <= 1;
    case 'raid6':
      return failed.size <= 2;
    case 'raid10':
      return !failed.has(cell.disk ^ 1);
  }
}

export function initRaid(root: HTMLElement): void {
  const chips = [...root.querySelectorAll<HTMLButtonElement>('.raid-chip')];
  const disksInput = root.querySelector<HTMLInputElement>('.raid-disks-input')!;
  const disksVal = root.querySelector<HTMLElement>('.raid-disks-val')!;
  const writeBtn = root.querySelector<HTMLButtonElement>('.raid-write')!;
  const rebuildBtn = root.querySelector<HTMLButtonElement>('.raid-rebuild')!;
  const resetBtn = root.querySelector<HTMLButtonElement>('.raid-reset')!;
  const blurbEl = root.querySelector<HTMLElement>('.raid-blurb')!;
  const statusEl = root.querySelector<HTMLElement>('.raid-status')!;
  const metaEl = root.querySelector<HTMLElement>('.raid-meta')!;
  const capUsableEl = root.querySelector<HTMLElement>('.cap-usable')!;
  const capOverheadEl = root.querySelector<HTMLElement>('.cap-overhead')!;
  const gridEl = root.querySelector<HTMLElement>('.raid-grid')!;

  let level: Level = chips.find((c) => c.classList.contains('active'))!.dataset.level as Level;
  let disks = Number(disksInput.value);
  let stripes = INITIAL_STRIPES;
  let failed = new Set<number>();
  let flashStripe: number | null = null;

  function status(): 'healthy' | 'degraded' | 'failed' {
    if (failed.size === 0) return 'healthy';
    return arrayIntact(level, disks, failed) ? 'degraded' : 'failed';
  }

  function clampDisks(): void {
    const info = LEVEL_INFO[level];
    disksInput.min = String(info.min);
    disksInput.max = String(info.max);
    disksInput.step = info.evenOnly ? '2' : '1';
    let n = Number(disksInput.value);
    if (info.evenOnly && n % 2 === 1) n -= 1;
    n = Math.min(info.max, Math.max(info.min, n));
    disksInput.value = String(n);
    disks = n;
  }

  function render(): void {
    const info = LEVEL_INFO[level];
    const st = status();
    disksVal.textContent = String(disks);
    blurbEl.textContent = info.blurb;

    // status banner
    statusEl.className = `raid-status ${st}`;
    if (st === 'healthy') {
      statusEl.textContent = 'Healthy — all disks online';
    } else if (st === 'degraded') {
      statusEl.textContent = `Degraded — ${failed.size} disk${failed.size > 1 ? 's' : ''} failed, all data still readable. Rebuild to restore redundancy.`;
    } else {
      statusEl.textContent = 'Array failed — data is lost. Reset to start over.';
    }

    // meta line
    let capacity: number;
    let tolerance: string;
    switch (level) {
      case 'raid0':
        capacity = 1;
        tolerance = 'none';
        break;
      case 'raid1':
        capacity = 1 / disks;
        tolerance = `${disks - 1} disk${disks > 2 ? 's' : ''}`;
        break;
      case 'raid5':
        capacity = (disks - 1) / disks;
        tolerance = '1 disk';
        break;
      case 'raid6':
        capacity = (disks - 2) / disks;
        tolerance = '2 disks';
        break;
      case 'raid10':
        capacity = 0.5;
        tolerance = '1 disk per mirror pair';
        break;
    }
    const usablePct = Math.round(capacity * 100);
    capUsableEl.style.width = `${usablePct}%`;
    capUsableEl.textContent = `Usable ${usablePct}%`;
    capOverheadEl.style.width = `${100 - usablePct}%`;
    capOverheadEl.textContent = `Redundancy ${100 - usablePct}%`;
    capOverheadEl.style.display = usablePct === 100 ? 'none' : '';
    metaEl.textContent = `Fault tolerance: ${tolerance} · Minimum disks: ${info.min}`;

    // disk columns
    gridEl.replaceChildren();
    const columns: HTMLElement[] = [];
    for (let d = 0; d < disks; d++) {
      const col = document.createElement('div');
      col.className = failed.has(d) ? 'raid-disk failed' : 'raid-disk';
      const head = document.createElement('button');
      head.className = 'raid-disk-head';
      head.textContent = failed.has(d) ? `Disk ${d + 1} ✗` : `Disk ${d + 1}`;
      head.title = failed.has(d) ? 'Click to bring this disk back' : 'Click to fail this disk';
      head.addEventListener('click', () => {
        if (failed.has(d)) failed.delete(d);
        else failed.add(d);
        flashStripe = null;
        render();
      });
      col.appendChild(head);
      gridEl.appendChild(col);
      columns.push(col);
    }
    for (let s = 0; s < stripes; s++) {
      for (const cell of stripeCells(level, disks, s)) {
        const el = document.createElement('div');
        let cls = `raid-cell kind-${cell.kind}`;
        if (failed.has(cell.disk)) {
          cls += cellRecoverable(level, disks, failed, cell) ? ' rebuild' : ' lost';
        }
        if (s === flashStripe) cls += ' new';
        el.className = cls;
        el.textContent = cell.label;
        columns[cell.disk]!.appendChild(el);
      }
    }

    writeBtn.disabled = st === 'failed' || stripes >= MAX_STRIPES;
    rebuildBtn.disabled = st !== 'degraded';
  }

  for (const chip of chips) {
    chip.addEventListener('click', () => {
      if (chip.dataset.level === level) return;
      level = chip.dataset.level as Level;
      for (const c of chips) c.classList.toggle('active', c === chip);
      clampDisks();
      stripes = INITIAL_STRIPES;
      failed = new Set();
      flashStripe = null;
      render();
    });
  }
  disksInput.addEventListener('input', () => {
    clampDisks();
    stripes = INITIAL_STRIPES;
    failed = new Set();
    flashStripe = null;
    render();
  });
  writeBtn.addEventListener('click', () => {
    if (stripes < MAX_STRIPES) {
      flashStripe = stripes;
      stripes++;
      render();
    }
  });
  rebuildBtn.addEventListener('click', () => {
    failed = new Set();
    flashStripe = null;
    render();
  });
  resetBtn.addEventListener('click', () => {
    stripes = INITIAL_STRIPES;
    failed = new Set();
    flashStripe = null;
    render();
  });

  window.__raid = {
    get level() {
      return level;
    },
    get disks() {
      return disks;
    },
    get failed() {
      return [...failed];
    },
    get status() {
      return status();
    },
  };

  clampDisks();
  render();
}
