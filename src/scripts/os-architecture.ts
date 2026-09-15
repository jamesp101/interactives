import { OSES, OPERATIONS, ROLE_LABELS, type OsKey, type Layer, type Role } from '../lib/os-arch';

type Mode = 'single' | 'compare';

interface OsArchHook {
  readonly os: string;
  readonly mode: Mode;
  readonly operation: string | null;
  readonly hop: number;
  readonly hops: number;
  readonly selectedLayer: string | null;
}

declare global {
  interface Window {
    __osarch?: OsArchHook;
  }
}

const SPACE_LABELS: Record<string, string> = {
  user: 'back in user space',
  kernel: 'kernel space',
  firmware: 'firmware',
  hardware: 'hardware',
};

export function initOsArchitecture(root: HTMLElement): void {
  const stacksEl = root.querySelector<HTMLElement>('.os-stacks')!;
  const detailEl = root.querySelector<HTMLElement>('.os-detail')!;
  const traceEl = root.querySelector<HTMLElement>('.os-trace')!;
  const traceCtl = root.querySelector<HTMLElement>('.os-trace-controls')!;
  const questionEl = root.querySelector<HTMLElement>('.os-question')!;
  const osChips = [...root.querySelectorAll<HTMLElement>('.chip[data-os]')];
  const modeChips = [...root.querySelectorAll<HTMLElement>('.chip[data-mode]')];
  const opChips = [...root.querySelectorAll<HTMLElement>('.chip[data-op]')];
  const stepBtn = root.querySelector<HTMLButtonElement>('.os-step')!;
  const playBtn = root.querySelector<HTMLButtonElement>('.os-play')!;
  const resetBtn = root.querySelector<HTMLButtonElement>('.os-reset')!;

  let osId: OsKey['id'] = 'linux';
  let mode: Mode = 'single';
  let opId: string | null = null;
  let hop = -1;
  let selected: { os: OsKey['id']; role: Role } | null = null;
  let timer: number | null = null;

  const shownOses = (): OsKey[] => (mode === 'compare' ? OSES : OSES.filter((o) => o.id === osId));
  const operation = () => OPERATIONS.find((o) => o.id === opId) ?? null;

  function hopCount(): number {
    const op = operation();
    if (!op) return 0;
    return Math.max(...shownOses().map((o) => op.paths[o.id].length));
  }

  function activeRoles(os: OsKey['id']): Set<Role> {
    const op = operation();
    if (!op || hop < 0) return new Set();
    const path = op.paths[os];
    const h = path[Math.min(hop, path.length - 1)];
    return h && hop < path.length ? new Set([h.role]) : new Set();
  }

  function renderStacks(): void {
    stacksEl.replaceChildren();
    stacksEl.classList.toggle('compare', mode === 'compare');
    for (const os of shownOses()) {
      const col = document.createElement('div');
      col.className = 'os-col';
      col.style.setProperty('--tint', os.tint);

      const head = document.createElement('div');
      head.className = 'os-col-head';
      head.innerHTML = `<span class="os-col-name">${os.name}</span><span class="os-col-kernel">${os.kernel}</span>`;
      col.appendChild(head);

      const active = activeRoles(os.id);
      let lastSpace: string | null = null;
      for (const layer of os.layers) {
        if (lastSpace !== null && layer.space !== lastSpace) {
          const div = document.createElement('div');
          div.className = `os-boundary to-${layer.space}`;
          div.textContent = SPACE_LABELS[layer.space]!;
          col.appendChild(div);
        }
        lastSpace = layer.space;

        const btn = document.createElement('button');
        btn.className = `os-layer space-${layer.space} role-${layer.role}`;
        if (active.has(layer.role)) btn.classList.add('active');
        if (selected && selected.os === os.id && selected.role === layer.role) btn.classList.add('sel');
        btn.dataset.os = os.id;
        btn.dataset.role = layer.role;
        btn.innerHTML =
          `<span class="os-layer-name">${layer.name}</span>` +
          (mode === 'single' && layer.components.length
            ? `<span class="os-layer-parts">${layer.components.join(' · ')}</span>`
            : '');
        btn.addEventListener('click', () => {
          selected = { os: os.id, role: layer.role };
          render();
        });
        col.appendChild(btn);
      }
      stacksEl.appendChild(col);
    }
  }

  function renderDetail(): void {
    const target = selected ?? { os: shownOses()[0]!.id, role: 'kernel' as Role };
    const os = OSES.find((o) => o.id === target.os)!;
    const layer = os.layers.find((l) => l.role === target.role) as Layer;
    detailEl.style.setProperty('--tint', os.tint);
    detailEl.replaceChildren();

    const head = document.createElement('div');
    head.className = 'os-detail-head';
    head.innerHTML =
      `<span class="meta kind">${os.name}</span>` +
      `<span class="meta">${ROLE_LABELS[layer.role]}</span>` +
      `<span class="meta os-space-${layer.space}">${layer.space} space</span>`;
    detailEl.appendChild(head);

    const title = document.createElement('h3');
    title.className = 'os-detail-title';
    title.textContent = layer.name;
    detailEl.appendChild(title);

    const body = document.createElement('p');
    body.className = 'os-detail-body';
    body.textContent = layer.detail;
    detailEl.appendChild(body);

    if (layer.components.length) {
      const parts = document.createElement('div');
      parts.className = 'os-parts';
      for (const c of layer.components) {
        const code = document.createElement('code');
        code.textContent = c;
        parts.appendChild(code);
      }
      detailEl.appendChild(parts);
    }
  }

  function renderTrace(): void {
    const op = operation();
    traceCtl.classList.toggle('hidden', !op);
    questionEl.textContent = op ? op.question : '';
    traceEl.replaceChildren();
    if (!op) return;

    for (const os of shownOses()) {
      const path = op.paths[os.id];
      const block = document.createElement('div');
      block.className = 'os-trace-block';
      block.style.setProperty('--tint', os.tint);

      const label = document.createElement('div');
      label.className = 'os-trace-os';
      label.textContent = `${os.name} — ${path.length} hops`;
      block.appendChild(label);

      path.forEach((h, i) => {
        const row = document.createElement('div');
        row.className = 'os-hop';
        if (hop >= 0 && i === Math.min(hop, path.length - 1) && hop < path.length) row.classList.add('active');
        if (hop >= 0 && i < hop) row.classList.add('past');
        row.innerHTML =
          `<span class="os-hop-n">${i + 1}</span>` +
          `<span class="os-hop-label">${h.label}</span>` +
          `<span class="os-hop-detail">${h.detail}</span>`;
        block.appendChild(row);
      });
      traceEl.appendChild(block);
    }
  }

  function render(): void {
    for (const c of osChips) c.classList.toggle('active', c.dataset.os === osId);
    for (const c of modeChips) c.classList.toggle('active', c.dataset.mode === mode);
    for (const c of opChips) c.classList.toggle('active', c.dataset.op === (opId ?? 'none'));
    for (const c of osChips) c.toggleAttribute('disabled', mode === 'compare');
    renderStacks();
    renderDetail();
    renderTrace();
    const total = hopCount();
    stepBtn.disabled = !opId || hop >= total - 1;
    playBtn.textContent = timer !== null ? 'Pause' : 'Play';
  }

  function stop(): void {
    if (timer !== null) {
      clearInterval(timer);
      timer = null;
    }
  }

  stepBtn.addEventListener('click', () => {
    stop();
    if (hop < hopCount() - 1) hop++;
    render();
  });
  playBtn.addEventListener('click', () => {
    if (timer !== null) {
      stop();
      render();
      return;
    }
    if (hop >= hopCount() - 1) hop = -1;
    timer = window.setInterval(() => {
      if (hop >= hopCount() - 1) {
        stop();
        render();
        return;
      }
      hop++;
      render();
    }, 1100);
    render();
  });
  resetBtn.addEventListener('click', () => {
    stop();
    hop = -1;
    render();
  });

  for (const chip of osChips) {
    chip.addEventListener('click', () => {
      osId = chip.dataset.os as OsKey['id'];
      selected = null;
      stop();
      hop = -1;
      render();
    });
  }
  for (const chip of modeChips) {
    chip.addEventListener('click', () => {
      mode = chip.dataset.mode as Mode;
      selected = null;
      stop();
      hop = -1;
      render();
    });
  }
  for (const chip of opChips) {
    chip.addEventListener('click', () => {
      const v = chip.dataset.op!;
      opId = v === 'none' ? null : v;
      stop();
      hop = -1;
      render();
    });
  }

  window.__osarch = {
    get os() {
      return osId;
    },
    get mode() {
      return mode;
    },
    get operation() {
      return opId;
    },
    get hop() {
      return hop;
    },
    get hops() {
      return hopCount();
    },
    get selectedLayer() {
      return selected ? `${selected.os}:${selected.role}` : null;
    },
  };

  render();
}
