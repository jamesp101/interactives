import type { StepGen } from './steps';
import { bubbleSort, selectionSort, insertionSort, mergeSort, quickSort } from './sorting';
import { linearSearch, binarySearch } from './searching';

export interface AlgoMeta {
  slug: string;
  title: string;
  category: 'sorting' | 'searching';
  description: string;
  complexity: { best: string; average: string; worst: string; space: string };
  run: (arr: number[], target: number) => StepGen;
}

export const algorithms: AlgoMeta[] = [
  {
    slug: 'bubble-sort',
    title: 'Bubble Sort',
    category: 'sorting',
    description:
      'Repeatedly steps through the list, comparing adjacent elements and swapping them when out of order. Each pass bubbles the largest remaining value to the end.',
    complexity: { best: 'O(n)', average: 'O(n²)', worst: 'O(n²)', space: 'O(1)' },
    run: bubbleSort,
  },
  {
    slug: 'selection-sort',
    title: 'Selection Sort',
    category: 'sorting',
    description:
      'Scans the unsorted region for its minimum and swaps it into place. Simple and swap-frugal, but always quadratic in comparisons.',
    complexity: { best: 'O(n²)', average: 'O(n²)', worst: 'O(n²)', space: 'O(1)' },
    run: selectionSort,
  },
  {
    slug: 'insertion-sort',
    title: 'Insertion Sort',
    category: 'sorting',
    description:
      'Grows a sorted prefix by inserting each new element into its correct position, shifting larger values right. Excellent on nearly-sorted data.',
    complexity: { best: 'O(n)', average: 'O(n²)', worst: 'O(n²)', space: 'O(1)' },
    run: insertionSort,
  },
  {
    slug: 'merge-sort',
    title: 'Merge Sort',
    category: 'sorting',
    description:
      'Recursively splits the array in half, sorts each half, and merges the sorted halves. Guaranteed n log n at the cost of auxiliary memory.',
    complexity: { best: 'O(n log n)', average: 'O(n log n)', worst: 'O(n log n)', space: 'O(n)' },
    run: mergeSort,
  },
  {
    slug: 'quick-sort',
    title: 'Quick Sort',
    category: 'sorting',
    description:
      'Partitions the array around a pivot so smaller values land left and larger right, then recurses on each side. Fast in practice; worst case on adversarial input.',
    complexity: { best: 'O(n log n)', average: 'O(n log n)', worst: 'O(n²)', space: 'O(log n)' },
    run: quickSort,
  },
  {
    slug: 'linear-search',
    title: 'Linear Search',
    category: 'searching',
    description:
      'Checks every element from left to right until the target is found or the array ends. Works on unsorted data.',
    complexity: { best: 'O(1)', average: 'O(n)', worst: 'O(n)', space: 'O(1)' },
    run: linearSearch,
  },
  {
    slug: 'binary-search',
    title: 'Binary Search',
    category: 'searching',
    description:
      'On a sorted array, repeatedly halves the active window by probing its midpoint. Finds any element in logarithmic time.',
    complexity: { best: 'O(1)', average: 'O(log n)', worst: 'O(log n)', space: 'O(1)' },
    run: binarySearch,
  },
];
