type Deps = unknown[] | undefined;

interface CellState {
  kind: 'useState';
  value: unknown;
}
interface CellEffect {
  kind: 'useEffect';
  deps: Deps;
  cleanup: (() => void) | null;
  pending: (() => (() => void) | void) | null;
  ran: boolean;
}
interface CellRef {
  kind: 'useRef';
  current: unknown;
}
interface CellMemo {
  kind: 'useMemo';
  value: unknown;
  deps: Deps;
}
type Cell = CellState | CellEffect | CellRef | CellMemo;

type DepsMode = 'empty' | 'count' | 'none';

const MAX_LOG = 80;

interface HooksHook {
  readonly renders: number;
  readonly slots: string[];
  readonly title: string;
  readonly refValue: number;
  readonly mounted: boolean;
}

declare global {
  interface Window {
    __hooks?: HooksHook;
  }
}

export function initHooks(root: HTMLElement): void {
  const titleEl = root.querySelector<HTMLElement>('.hx-title')!;
  const countEl = root.querySelector<HTMLElement>('.hx-count')!;
  const doubledEl = root.querySelector<HTMLElement>('.hx-doubled')!;
  const rendersEl = root.querySelector<HTMLElement>('.hx-renders')!;
  const windowEl = root.querySelector<HTMLElement>('.hx-window')!;
  const incBtn = root.querySelector<HTMLButtonElement>('.hx-inc')!;
  const darkBtn = root.querySelector<HTMLButtonElement>('.hx-dark')!;
  const refBtn = root.querySelector<HTMLButtonElement>('.hx-ref')!;
  const mountBtn = root.querySelector<HTMLButtonElement>('.hx-mount')!;
  const slotsEl = root.querySelector<HTMLElement>('.hx-slots tbody')!;
  const logEl = root.querySelector<HTMLElement>('.hx-log')!;
  const srcEl = root.querySelector<HTMLElement>('.hx-src')!;
  const modeChips = [...root.querySelectorAll<HTMLElement>('.chip[data-mode]')];

  let cells: Cell[] = [];
  let cursor = 0;
  let renderCount = 0;
  let mounted = false;
  let depsMode: DepsMode = 'count';
  let docTitle = '—';

  interface UI {
    count: number;
    dark: boolean;
    doubled: number;
    renders: number;
    setCount: (v: number) => void;
    setDark: (v: boolean) => void;
    refCell: CellRef;
  }
  let current: UI | null = null;

  function log(cls: string, msg: string): void {
    const line = document.createElement('div');
    line.className = `hx-line ${cls}`;
    line.textContent = msg;
    logEl.appendChild(line);
    while (logEl.childElementCount > MAX_LOG) logEl.firstElementChild!.remove();
    logEl.scrollTop = logEl.scrollHeight;
  }

  function fmtDeps(deps: Deps): string {
    return deps === undefined ? '(no deps)' : `[${deps.map((d) => JSON.stringify(d)).join(', ')}]`;
  }

  function depsEqual(a: Deps, b: Deps): boolean {
    if (a === undefined || b === undefined) return false;
    return a.length === b.length && a.every((v, i) => Object.is(v, b[i]));
  }

  // --- mini hook runtime (same slot-array + cursor mechanism React uses) ---
  function useState<T>(initial: T): [T, (v: T) => void] {
    const i = cursor++;
    if (cells[i] === undefined) cells[i] = { kind: 'useState', value: initial };
    const cell = cells[i] as CellState;
    log('hook', `slot ${i} useState → ${JSON.stringify(cell.value)}`);
    return [
      cell.value as T,
      (v: T) => {
        if (!mounted) return;
        cell.value = v;
        log('set', `setState(slot ${i}, ${JSON.stringify(v)}) → re-render`);
        render();
      },
    ];
  }

  function useEffect(fn: () => (() => void) | void, deps: Deps): void {
    const i = cursor++;
    if (cells[i] === undefined)
      cells[i] = { kind: 'useEffect', deps: undefined, cleanup: null, pending: null, ran: false };
    const cell = cells[i] as CellEffect;
    const shouldRun = !cell.ran || deps === undefined || !depsEqual(deps, cell.deps);
    if (shouldRun) {
      cell.pending = fn;
      log('hook', `slot ${i} useEffect ${fmtDeps(deps)} → scheduled`);
    } else {
      log('skip', `slot ${i} useEffect ${fmtDeps(deps)} unchanged → skipped`);
    }
    cell.deps = deps;
  }

  function useRef<T>(initial: T): CellRef {
    const i = cursor++;
    if (cells[i] === undefined) cells[i] = { kind: 'useRef', current: initial };
    const cell = cells[i] as CellRef;
    log('hook', `slot ${i} useRef → { current: ${JSON.stringify(cell.current)} }`);
    return cell;
  }

  function useMemo<T>(factory: () => T, deps: Deps): T {
    const i = cursor++;
    if (cells[i] === undefined || !depsEqual(deps, (cells[i] as CellMemo).deps)) {
      const value = factory();
      cells[i] = { kind: 'useMemo', value, deps };
      log('memo', `slot ${i} useMemo ${fmtDeps(deps)} → recomputed: ${JSON.stringify(value)}`);
    } else {
      log('skip', `slot ${i} useMemo ${fmtDeps(deps)} unchanged → cached`);
    }
    return (cells[i] as CellMemo).value as T;
  }

  // --- the demo component ---
  function Counter(): UI {
    const [count, setCount] = useState(0);
    const [dark, setDark] = useState(false);
    const deps: Deps = depsMode === 'empty' ? [] : depsMode === 'count' ? [count] : undefined;
    useEffect(() => {
      docTitle = `Count: ${count}`;
      titleEl.textContent = docTitle;
      return () => log('cleanup', `cleanup: title effect (count was ${count})`);
    }, deps);
    const refCell = useRef(0);
    refCell.current = (refCell.current as number) + 1;
    const doubled = useMemo(() => count * 2, [count]);
    return { count, dark, doubled, renders: refCell.current as number, setCount, setDark, refCell };
  }

  function flushEffects(): void {
    cells.forEach((cell, i) => {
      if (cell.kind !== 'useEffect' || !cell.pending) return;
      if (cell.cleanup) cell.cleanup();
      const ret = cell.pending();
      cell.cleanup = typeof ret === 'function' ? ret : null;
      cell.pending = null;
      cell.ran = true;
      log('effect', `slot ${i} effect ran → document.title = "${docTitle}"`);
    });
  }

  function updateSlots(): void {
    slotsEl.replaceChildren();
    cells.forEach((cell, i) => {
      const tr = document.createElement('tr');
      let detail: string;
      switch (cell.kind) {
        case 'useState':
          detail = JSON.stringify(cell.value);
          break;
        case 'useEffect':
          detail = `deps ${fmtDeps(cell.deps)}${cell.cleanup ? ' · has cleanup' : ''}`;
          break;
        case 'useRef':
          detail = `{ current: ${JSON.stringify(cell.current)} }`;
          break;
        case 'useMemo':
          detail = `${JSON.stringify(cell.value)} · deps ${fmtDeps(cell.deps)}`;
          break;
      }
      tr.innerHTML = `<td>${i}</td><td>${cell.kind}</td><td>${detail}</td>`;
      slotsEl.appendChild(tr);
    });
  }

  function updateSource(): void {
    const deps = depsMode === 'empty' ? ', []' : depsMode === 'count' ? ', [count]' : '';
    srcEl.textContent = `function Counter() {
  const [count, setCount] = useState(0);      // slot 0
  const [dark, setDark] = useState(false);    // slot 1

  useEffect(() => {                           // slot 2
    document.title = \`Count: \${count}\`;
    return () => { /* cleanup */ };
  }${deps});

  const renders = useRef(0);                  // slot 3
  renders.current++;

  const doubled = useMemo(() => count * 2, [count]); // slot 4

  return <div>...</div>;
}`;
  }

  function commit(ui: UI): void {
    countEl.textContent = String(ui.count);
    doubledEl.textContent = String(ui.doubled);
    rendersEl.textContent = String(ui.renders);
    windowEl.classList.toggle('dark', ui.dark);
    darkBtn.textContent = ui.dark ? 'setDark(false)' : 'setDark(true)';
  }

  function render(): void {
    renderCount++;
    log('render', `── render #${renderCount} ──`);
    cursor = 0;
    current = Counter();
    commit(current);
    flushEffects();
    updateSlots();
  }

  function setMounted(next: boolean): void {
    mounted = next;
    root.classList.toggle('hx-unmounted', !mounted);
    incBtn.disabled = !mounted;
    darkBtn.disabled = !mounted;
    refBtn.disabled = !mounted;
    mountBtn.textContent = mounted ? 'Unmount component' : 'Mount component';
  }

  incBtn.addEventListener('click', () => current && current.setCount(current.count + 1));
  darkBtn.addEventListener('click', () => current && current.setDark(!current.dark));
  refBtn.addEventListener('click', () => {
    if (!current) return;
    current.refCell.current = (current.refCell.current as number) + 1;
    log('ref', `ref.current = ${current.refCell.current} — mutated, NO re-render (UI is stale)`);
    updateSlots();
  });
  mountBtn.addEventListener('click', () => {
    if (mounted) {
      cells.forEach((cell, i) => {
        if (cell.kind === 'useEffect' && cell.cleanup) {
          cell.cleanup();
          log('effect', `slot ${i} cleanup ran (unmount)`);
        }
      });
      cells = [];
      current = null;
      renderCount = 0;
      docTitle = '—';
      titleEl.textContent = docTitle;
      setMounted(false);
      log('render', '── component unmounted, slots discarded ──');
      updateSlots();
    } else {
      setMounted(true);
      log('render', '── component mounted ──');
      render();
    }
  });
  for (const chip of modeChips) {
    chip.addEventListener('click', () => {
      depsMode = chip.dataset.mode as DepsMode;
      for (const c of modeChips) c.classList.toggle('active', c === chip);
      updateSource();
      if (mounted) {
        log('set', `useEffect deps changed to ${chip.textContent} → re-render`);
        render();
      }
    });
  }

  window.__hooks = {
    get renders() {
      return renderCount;
    },
    get slots() {
      return cells.map((c) => c.kind);
    },
    get title() {
      return docTitle;
    },
    get refValue() {
      const cell = cells.find((c) => c.kind === 'useRef');
      return cell ? (cell.current as number) : -1;
    },
    get mounted() {
      return mounted;
    },
  };

  updateSource();
  setMounted(true);
  log('render', '── component mounted ──');
  render();
}
