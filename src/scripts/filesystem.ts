import { FHS, type FhsNode } from '../lib/fhs';

type Filter = 'all' | 'static' | 'variable' | 'shareable' | 'unshareable';

interface Row {
  node: FhsNode;
  depth: number;
  open: boolean;
  hit: boolean;
}

interface FsHook {
  readonly selected: string;
  readonly rows: string[];
  readonly filter: Filter;
  readonly matches: number;
}

declare global {
  interface Window {
    __fs?: FsHook;
  }
}

export function initFilesystem(root: HTMLElement): void {
  const treeEl = root.querySelector<HTMLElement>('.fs-tree')!;
  const crumbEl = root.querySelector<HTMLElement>('.fs-crumb')!;
  const summaryEl = root.querySelector<HTMLElement>('.fs-summary-text')!;
  const detailEl = root.querySelector<HTMLElement>('.fs-detail-text')!;
  const chipsEl = root.querySelector<HTMLElement>('.fs-chips')!;
  const specEl = root.querySelector<HTMLElement>('.fs-spec')!;
  const examplesEl = root.querySelector<HTMLElement>('.fs-examples')!;
  const countEl = root.querySelector<HTMLElement>('.fs-count')!;
  const searchEl = root.querySelector<HTMLInputElement>('.fs-search')!;
  const expandBtn = root.querySelector<HTMLButtonElement>('.fs-expand')!;
  const collapseBtn = root.querySelector<HTMLButtonElement>('.fs-collapse')!;
  const filterChips = [...root.querySelectorAll<HTMLElement>('.chip[data-filter]')];

  const byPath = new Map<string, FhsNode>();
  const parentOf = new Map<string, string>();
  (function index(node: FhsNode, parent: string | null): void {
    byPath.set(node.path, node);
    if (parent !== null) parentOf.set(node.path, parent);
    node.children?.forEach((c) => index(c, node.path));
  })(FHS, null);

  const expanded = new Set<string>(['/']);
  let selected = '/';
  let filter: Filter = 'all';
  let query = '';
  let rows: Row[] = [];

  function filtering(): boolean {
    return filter !== 'all' || query !== '';
  }

  function nodeMatches(n: FhsNode): boolean {
    if ((filter === 'static' || filter === 'variable') && n.persistence !== filter) return false;
    if ((filter === 'shareable' || filter === 'unshareable') && n.sharing !== filter) return false;
    if (query) {
      const hay = `${n.path} ${n.summary} ${n.detail} ${n.examples.join(' ')}`.toLowerCase();
      if (!hay.includes(query)) return false;
    }
    return true;
  }

  function visiblePaths(): Set<string> {
    const show = new Set<string>();
    const walk = (n: FhsNode, ancestors: string[]): void => {
      if (nodeMatches(n)) {
        show.add(n.path);
        for (const a of ancestors) show.add(a);
      }
      n.children?.forEach((c) => walk(c, [...ancestors, n.path]));
    };
    walk(FHS, []);
    return show;
  }

  function buildRows(): Row[] {
    const show = filtering() ? visiblePaths() : null;
    const out: Row[] = [];
    const walk = (n: FhsNode, depth: number): void => {
      if (show && !show.has(n.path)) return;
      const open = show ? true : expanded.has(n.path);
      out.push({ node: n, depth, open, hit: show ? nodeMatches(n) : false });
      if (open) n.children?.forEach((c) => walk(c, depth + 1));
    };
    walk(FHS, 0);
    return out;
  }

  function renderDetail(): void {
    const node = byPath.get(selected)!;
    crumbEl.replaceChildren();
    const rootBtn = document.createElement('button');
    rootBtn.className = 'fs-crumb-seg';
    rootBtn.textContent = '/';
    rootBtn.addEventListener('click', () => select('/'));
    crumbEl.appendChild(rootBtn);

    let acc = '';
    const segments = selected === '/' ? [] : selected.slice(1).split('/');
    segments.forEach((seg, i) => {
      acc = `${acc}/${seg}`;
      const btn = document.createElement('button');
      btn.className = 'fs-crumb-seg';
      btn.textContent = seg;
      const target = acc;
      btn.addEventListener('click', () => select(target));
      if (i > 0) crumbEl.appendChild(document.createTextNode('/'));
      crumbEl.appendChild(btn);
    });

    summaryEl.textContent = node.summary;
    detailEl.textContent = node.detail;

    chipsEl.replaceChildren();
    for (const value of [node.persistence, node.sharing]) {
      const chip = document.createElement('span');
      chip.className = `meta fs-class ${value}`;
      chip.textContent = value;
      chipsEl.appendChild(chip);
    }

    specEl.textContent = node.specNote ?? '';
    specEl.classList.toggle('hidden', !node.specNote);

    examplesEl.replaceChildren();
    if (node.examples.length === 0) {
      examplesEl.classList.add('hidden');
    } else {
      examplesEl.classList.remove('hidden');
      const label = document.createElement('span');
      label.className = 'fs-examples-label';
      label.textContent = 'typical contents';
      examplesEl.appendChild(label);
      for (const ex of node.examples) {
        const chip = document.createElement('code');
        chip.textContent = ex;
        examplesEl.appendChild(chip);
      }
    }
  }

  function render(): void {
    rows = buildRows();
    treeEl.replaceChildren();
    for (const row of rows) {
      const { node, depth, open, hit } = row;
      const el = document.createElement('div');
      el.className = 'fs-row';
      if (node.path === selected) el.classList.add('sel');
      if (hit) el.classList.add('hit');
      el.setAttribute('role', 'treeitem');
      el.setAttribute('aria-level', String(depth + 1));
      el.setAttribute('aria-selected', String(node.path === selected));
      el.tabIndex = node.path === selected ? 0 : -1;
      el.dataset.path = node.path;
      el.style.setProperty('--depth', String(depth));

      const twisty = document.createElement('span');
      twisty.className = 'fs-twisty';
      if (node.children?.length) {
        el.setAttribute('aria-expanded', String(open));
        twisty.textContent = open ? '▾' : '▸';
      } else {
        twisty.textContent = '';
      }
      el.appendChild(twisty);

      const name = document.createElement('span');
      name.className = 'fs-name';
      name.textContent = depth === 0 ? '/' : node.path.slice(node.path.lastIndexOf('/') + 1);
      el.appendChild(name);

      const sum = document.createElement('span');
      sum.className = 'fs-row-summary';
      sum.textContent = node.summary;
      el.appendChild(sum);

      el.addEventListener('click', () => {
        if (node.children?.length && !filtering()) toggle(node.path);
        select(node.path);
      });
      treeEl.appendChild(el);
    }

    if (rows.length === 0) {
      const empty = document.createElement('p');
      empty.className = 'fs-empty';
      empty.textContent = 'No directories match.';
      treeEl.appendChild(empty);
    }

    const matched = filtering() ? rows.filter((r) => r.hit).length : byPath.size;
    countEl.textContent = filtering()
      ? `${matched} of ${byPath.size} directories match`
      : `${byPath.size} directories`;

    for (const chip of filterChips) chip.classList.toggle('active', chip.dataset.filter === filter);
    renderDetail();
  }

  function select(path: string): void {
    selected = path;
    render();
  }

  function toggle(path: string): void {
    if (expanded.has(path)) expanded.delete(path);
    else expanded.add(path);
  }

  function focusRow(path: string): void {
    const el = treeEl.querySelector<HTMLElement>(`.fs-row[data-path="${path}"]`);
    el?.focus();
  }

  treeEl.addEventListener('keydown', (e) => {
    const target = (e.target as HTMLElement).closest<HTMLElement>('.fs-row');
    if (!target) return;
    const path = target.dataset.path!;
    const i = rows.findIndex((r) => r.node.path === path);
    if (i === -1) return;
    const row = rows[i]!;
    const hasChildren = Boolean(row.node.children?.length);
    let next: string | null = null;

    switch (e.key) {
      case 'ArrowDown':
        next = rows[i + 1]?.node.path ?? null;
        break;
      case 'ArrowUp':
        next = rows[i - 1]?.node.path ?? null;
        break;
      case 'ArrowRight':
        if (hasChildren && !row.open) {
          toggle(path);
          select(path);
          focusRow(path);
          e.preventDefault();
          return;
        }
        next = hasChildren ? (rows[i + 1]?.node.path ?? null) : null;
        break;
      case 'ArrowLeft':
        if (hasChildren && row.open && !filtering()) {
          toggle(path);
          select(path);
          focusRow(path);
          e.preventDefault();
          return;
        }
        next = parentOf.get(path) ?? null;
        break;
      case 'Home':
        next = rows[0]?.node.path ?? null;
        break;
      case 'End':
        next = rows[rows.length - 1]?.node.path ?? null;
        break;
      case 'Enter':
      case ' ':
        if (hasChildren && !filtering()) toggle(path);
        select(path);
        focusRow(path);
        e.preventDefault();
        return;
      default:
        return;
    }

    if (next) {
      e.preventDefault();
      select(next);
      focusRow(next);
    }
  });

  searchEl.addEventListener('input', () => {
    query = searchEl.value.trim().toLowerCase();
    render();
  });
  for (const chip of filterChips) {
    chip.addEventListener('click', () => {
      filter = chip.dataset.filter as Filter;
      render();
    });
  }
  expandBtn.addEventListener('click', () => {
    for (const [path, node] of byPath) if (node.children?.length) expanded.add(path);
    render();
  });
  collapseBtn.addEventListener('click', () => {
    expanded.clear();
    expanded.add('/');
    render();
  });

  window.__fs = {
    get selected() {
      return selected;
    },
    get rows() {
      return rows.map((r) => r.node.path);
    },
    get filter() {
      return filter;
    },
    get matches() {
      return rows.filter((r) => r.hit).length;
    },
  };

  expanded.add('/usr');
  expanded.add('/var');
  render();
}
