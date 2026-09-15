import type { StepGen } from './steps';

export function* linearSearch(input: number[], target: number): StepGen {
  for (let i = 0; i < input.length; i++) {
    yield { type: 'probe', i };
    if (input[i] === target) {
      yield { type: 'found', i };
      return;
    }
  }
  yield { type: 'notFound' };
}

export function* binarySearch(input: number[], target: number): StepGen {
  let lo = 0;
  let hi = input.length - 1;
  while (lo <= hi) {
    yield { type: 'range', lo, hi };
    const mid = (lo + hi) >> 1;
    yield { type: 'probe', i: mid };
    if (input[mid] === target) {
      yield { type: 'found', i: mid };
      return;
    }
    if (input[mid]! < target) lo = mid + 1;
    else hi = mid - 1;
  }
  yield { type: 'notFound' };
}
