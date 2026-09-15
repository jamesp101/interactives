import type { Step } from '../lib/steps';
import { algorithms } from '../lib/registry';

interface VizHook {
  readonly array: number[];
  readonly done: boolean;
  readonly lastResult: number | null;
}

declare global {
  interface Window {
    __viz?: VizHook;
  }
}

const COLORS = {
  bar: '#5b8dee',
  compare: '#f2b134',
  hot: '#e4572e', // swap / probe
  pivot: '#9b5de5',
  sorted: '#3ddc84',
  text: '#c9d1d9',
};

const SEARCH_SIZE = 25;

export function initVisualizer(root: HTMLElement): void {
  const slug = root.dataset.slug ?? '';
  const category = root.dataset.category as 'sorting' | 'searching';
  const algo = algorithms.find((a) => a.slug === slug);
  if (!algo) throw new Error(`unknown algorithm: ${slug}`);

  const canvas = root.querySelector<HTMLCanvasElement>('canvas')!;
  const ctx = canvas.getContext('2d')!;
  const playBtn = root.querySelector<HTMLButtonElement>('.ctl-play')!;
  const stepBtn = root.querySelector<HTMLButtonElement>('.ctl-step')!;
  const resetBtn = root.querySelector<HTMLButtonElement>('.ctl-reset')!;
  const newBtn = root.querySelector<HTMLButtonElement>('.ctl-new')!;
  const speedInput = root.querySelector<HTMLInputElement>('.ctl-speed')!;
  const sizeInput = root.querySelector<HTMLInputElement>('.ctl-size'); // sorting only
  const targetInput = root.querySelector<HTMLInputElement>('.ctl-target'); // searching only

  // --- state ---
  let initial: number[] = [];
  let values: number[] = [];
  let steps: Step[] | null = null;
  let cursor = 0;
  let playing = false;
  let lastResult: number | null = null;

  // visual flags
  let sorted = new Set<number>();
  let comparePair: [number, number] | null = null;
  let hotIndices: number[] = [];
  let pivotIndex: number | null = null;
  let activeRange: [number, number] | null = null;
  let notFoundFlash = false;

  function clearFlags(): void {
    sorted = new Set();
    comparePair = null;
    hotIndices = [];
    pivotIndex = null;
    activeRange = null;
    notFoundFlash = false;
  }

  function targetValue(): number {
    return targetInput ? Number.parseInt(targetInput.value, 10) : 0;
  }

  function targetValid(): boolean {
    return !targetInput || Number.isFinite(targetValue());
  }

  function updateButtons(): void {
    const ok = targetValid();
    playBtn.disabled = !ok;
    stepBtn.disabled = !ok;
    playBtn.textContent = playing ? 'Pause' : 'Play';
  }

  function newArray(): void {
    const n = category === 'searching' ? SEARCH_SIZE : Number(sizeInput?.value ?? 40);
    initial = Array.from({ length: n }, () => 5 + Math.floor(Math.random() * 96));
    if (slug === 'binary-search') initial.sort((x, y) => x - y);
    if (targetInput) {
      targetInput.value = String(initial[Math.floor(Math.random() * n)]);
    }
    resetPlayback();
  }

  function resetPlayback(): void {
    values = [...initial];
    steps = null;
    cursor = 0;
    playing = false;
    lastResult = null;
    clearFlags();
    updateButtons();
    draw();
  }

  function materialize(): Step[] {
    if (!steps) steps = [...algo!.run(initial, targetValue())];
    return steps;
  }

  function applyStep(step: Step): void {
    comparePair = null;
    hotIndices = [];
    notFoundFlash = false;
    switch (step.type) {
      case 'compare':
        comparePair = [step.i, step.j];
        break;
      case 'swap': {
        [values[step.i], values[step.j]] = [values[step.j]!, values[step.i]!];
        hotIndices = [step.i, step.j];
        break;
      }
      case 'overwrite':
        values[step.i] = step.value;
        hotIndices = [step.i];
        break;
      case 'pivot':
        pivotIndex = step.i;
        break;
      case 'markSorted':
        for (const i of step.indices) sorted.add(i);
        if (pivotIndex !== null && step.indices.includes(pivotIndex)) pivotIndex = null;
        break;
      case 'range':
        activeRange = [step.lo, step.hi];
        break;
      case 'probe':
        hotIndices = [step.i];
        break;
      case 'found':
        sorted.add(step.i);
        lastResult = step.i;
        break;
      case 'notFound':
        notFoundFlash = true;
        lastResult = -1;
        break;
    }
  }

  function advance(): boolean {
    const all = materialize();
    if (cursor >= all.length) return false;
    applyStep(all[cursor]!);
    cursor++;
    return cursor < all.length;
  }

  function done(): boolean {
    return steps !== null && cursor >= steps.length;
  }

  // --- rendering ---
  function draw(): void {
    const dpr = window.devicePixelRatio || 1;
    const w = root.clientWidth;
    const h = category === 'searching' ? 260 : 320;
    if (canvas.width !== w * dpr || canvas.height !== h * dpr) {
      canvas.width = w * dpr;
      canvas.height = h * dpr;
      canvas.style.height = `${h}px`;
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const n = values.length;
    if (n === 0) return;
    const labelSpace = category === 'searching' ? 22 : 0;
    const barArea = h - labelSpace;
    const slot = w / n;
    const barW = Math.max(1, slot - 1);

    for (let i = 0; i < n; i++) {
      let color = COLORS.bar;
      if (sorted.has(i)) color = COLORS.sorted;
      if (pivotIndex === i) color = COLORS.pivot;
      if (comparePair && (comparePair[0] === i || comparePair[1] === i)) color = COLORS.compare;
      if (hotIndices.includes(i)) color = COLORS.hot;
      if (notFoundFlash) color = COLORS.hot;

      const dimmed = activeRange !== null && (i < activeRange[0] || i > activeRange[1]);
      ctx.globalAlpha = dimmed ? 0.3 : 1;
      ctx.fillStyle = color;
      const barH = (values[i]! / 100) * (barArea - 8);
      ctx.fillRect(i * slot, barArea - barH, barW, barH);

      if (category === 'searching') {
        ctx.fillStyle = COLORS.text;
        ctx.font = '11px system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText(String(values[i]), i * slot + barW / 2, h - 6);
      }
    }
    ctx.globalAlpha = 1;
  }

  // --- playback loop ---
  let acc = 0;
  let lastTime = 0;
  function frame(t: number): void {
    if (playing) {
      if (lastTime === 0) lastTime = t;
      const rate = Math.pow(200, Number(speedInput.value) / 100); // 1..200 steps/s
      acc += ((t - lastTime) / 1000) * rate;
      lastTime = t;
      let moved = false;
      while (acc >= 1) {
        acc -= 1;
        moved = true;
        if (!advance()) {
          playing = false;
          acc = 0;
          updateButtons();
          break;
        }
      }
      if (moved) draw();
    } else {
      lastTime = 0;
      acc = 0;
    }
    requestAnimationFrame(frame);
  }

  // --- controls ---
  playBtn.addEventListener('click', () => {
    if (done()) resetPlayback();
    playing = !playing;
    updateButtons();
  });
  stepBtn.addEventListener('click', () => {
    playing = false;
    advance();
    updateButtons();
    draw();
  });
  resetBtn.addEventListener('click', resetPlayback);
  newBtn.addEventListener('click', newArray);
  sizeInput?.addEventListener('input', newArray);
  targetInput?.addEventListener('input', () => {
    values = [...initial];
    steps = null;
    cursor = 0;
    playing = false;
    lastResult = null;
    clearFlags();
    updateButtons();
    draw();
  });
  window.addEventListener('resize', draw);

  window.__viz = {
    get array() {
      return [...values];
    },
    get done() {
      return done();
    },
    get lastResult() {
      return lastResult;
    },
  };

  newArray();
  requestAnimationFrame(frame);
}
