import type { Step, StepGen } from './steps';

export function* bubbleSort(input: number[]): StepGen {
  const a = [...input];
  const n = a.length;
  for (let pass = 0; pass < n - 1; pass++) {
    let swapped = false;
    for (let j = 0; j < n - 1 - pass; j++) {
      yield { type: 'compare', i: j, j: j + 1 };
      if (a[j]! > a[j + 1]!) {
        [a[j], a[j + 1]] = [a[j + 1]!, a[j]!];
        yield { type: 'swap', i: j, j: j + 1 };
        swapped = true;
      }
    }
    yield { type: 'markSorted', indices: [n - 1 - pass] };
    if (!swapped) {
      const rest: number[] = [];
      for (let k = 0; k < n - 1 - pass; k++) rest.push(k);
      if (rest.length) yield { type: 'markSorted', indices: rest };
      return;
    }
  }
  if (n > 0) yield { type: 'markSorted', indices: [0] };
}

export function* selectionSort(input: number[]): StepGen {
  const a = [...input];
  const n = a.length;
  for (let i = 0; i < n - 1; i++) {
    let min = i;
    for (let j = i + 1; j < n; j++) {
      yield { type: 'compare', i: min, j };
      if (a[j]! < a[min]!) min = j;
    }
    if (min !== i) {
      [a[i], a[min]] = [a[min]!, a[i]!];
      yield { type: 'swap', i, j: min };
    }
    yield { type: 'markSorted', indices: [i] };
  }
  if (n > 0) yield { type: 'markSorted', indices: [n - 1] };
}

export function* insertionSort(input: number[]): StepGen {
  const a = [...input];
  const n = a.length;
  for (let i = 1; i < n; i++) {
    const key = a[i]!;
    let j = i - 1;
    while (j >= 0) {
      yield { type: 'compare', i: j, j: j + 1 };
      if (a[j]! <= key) break;
      a[j + 1] = a[j]!;
      yield { type: 'overwrite', i: j + 1, value: a[j + 1]! };
      j--;
    }
    a[j + 1] = key;
    yield { type: 'overwrite', i: j + 1, value: key };
  }
  const all: number[] = [];
  for (let k = 0; k < n; k++) all.push(k);
  yield { type: 'markSorted', indices: all };
}

export function* mergeSort(input: number[]): StepGen {
  const a = [...input];

  function* merge(lo: number, mid: number, hi: number): StepGen {
    const left = a.slice(lo, mid + 1);
    const right = a.slice(mid + 1, hi + 1);
    let i = 0;
    let j = 0;
    let k = lo;
    while (i < left.length && j < right.length) {
      yield { type: 'compare', i: lo + i, j: mid + 1 + j };
      const value = left[i]! <= right[j]! ? left[i++]! : right[j++]!;
      a[k] = value;
      yield { type: 'overwrite', i: k, value };
      k++;
    }
    while (i < left.length) {
      a[k] = left[i]!;
      yield { type: 'overwrite', i: k, value: left[i]! };
      i++;
      k++;
    }
    while (j < right.length) {
      a[k] = right[j]!;
      yield { type: 'overwrite', i: k, value: right[j]! };
      j++;
      k++;
    }
  }

  function* sort(lo: number, hi: number): StepGen {
    if (lo >= hi) return;
    const mid = (lo + hi) >> 1;
    yield* sort(lo, mid);
    yield* sort(mid + 1, hi);
    yield* merge(lo, mid, hi);
  }

  yield* sort(0, a.length - 1);
  const all: number[] = [];
  for (let k = 0; k < a.length; k++) all.push(k);
  yield { type: 'markSorted', indices: all };
}

export function* quickSort(input: number[]): StepGen {
  const a = [...input];

  function* partition(lo: number, hi: number): Generator<Step, number, void> {
    const pivot = a[hi]!;
    yield { type: 'pivot', i: hi };
    let i = lo - 1;
    for (let j = lo; j < hi; j++) {
      yield { type: 'compare', i: j, j: hi };
      if (a[j]! < pivot) {
        i++;
        if (i !== j) {
          [a[i], a[j]] = [a[j]!, a[i]!];
          yield { type: 'swap', i, j };
        }
      }
    }
    if (i + 1 !== hi) {
      [a[i + 1], a[hi]] = [a[hi]!, a[i + 1]!];
      yield { type: 'swap', i: i + 1, j: hi };
    }
    return i + 1;
  }

  function* sort(lo: number, hi: number): StepGen {
    if (lo > hi) return;
    if (lo === hi) {
      yield { type: 'markSorted', indices: [lo] };
      return;
    }
    const p = yield* partition(lo, hi);
    yield { type: 'markSorted', indices: [p] };
    yield* sort(lo, p - 1);
    yield* sort(p + 1, hi);
  }

  yield* sort(0, a.length - 1);
}
