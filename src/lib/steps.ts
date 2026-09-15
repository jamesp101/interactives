export type Step =
  | { type: 'compare'; i: number; j: number }
  | { type: 'swap'; i: number; j: number }
  | { type: 'overwrite'; i: number; value: number }
  | { type: 'pivot'; i: number }
  | { type: 'markSorted'; indices: number[] }
  | { type: 'range'; lo: number; hi: number }
  | { type: 'probe'; i: number }
  | { type: 'found'; i: number }
  | { type: 'notFound' };

export type StepGen = Generator<Step, void, void>;
