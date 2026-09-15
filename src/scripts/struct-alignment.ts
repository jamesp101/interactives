type TypeName = 'char' | 'bool' | 'short' | 'int' | 'float' | 'long' | 'double' | 'void*';

interface TypeInfo {
  size: number;
  align: number;
}

/** x86-64 System V ABI (LP64): sizes and alignments in bytes. */
const TYPES: Record<TypeName, TypeInfo> = {
  char: { size: 1, align: 1 },
  bool: { size: 1, align: 1 },
  short: { size: 2, align: 2 },
  int: { size: 4, align: 4 },
  float: { size: 4, align: 4 },
  long: { size: 8, align: 8 },
  double: { size: 8, align: 8 },
  'void*': { size: 8, align: 8 },
};

interface Field {
  name: string;
  type: TypeName;
}

interface Placed {
  name: string;
  type: TypeName;
  offset: number;
  size: number;
  align: number;
  padBefore: number;
}

type Cell =
  | { kind: 'data'; offset: number; field: Placed }
  | { kind: 'pad'; offset: number }
  | { kind: 'tail'; offset: number };

interface Layout {
  placed: Placed[];
  cells: Cell[];
  size: number;
  align: number;
  internalPadding: number;
  tailPadding: number;
  padding: number;
}

interface StructHook {
  readonly size: number;
  readonly align: number;
  readonly padding: number;
  readonly packed: boolean;
  readonly fields: { name: string; type: string; offset: number; size: number }[];
  readonly optimalSize: number;
}

declare global {
  interface Window {
    __struct?: StructHook;
  }
}

const MAX_FIELDS = 16;
const PALETTE = ['--sa-c0', '--sa-c1', '--sa-c2', '--sa-c3', '--sa-c4', '--sa-c5'];
const BYTES_PER_ROW = 8;

const DEFAULT_FIELDS: Field[] = [
  { name: 'a', type: 'char' },
  { name: 'b', type: 'double' },
  { name: 'c', type: 'char' },
  { name: 'd', type: 'int' },
];

function alignUp(value: number, align: number): number {
  return Math.ceil(value / align) * align;
}

function colorVar(name: string): string {
  const index = name.charCodeAt(0) - 97;
  const slot = PALETTE[((index % PALETTE.length) + PALETTE.length) % PALETTE.length];
  return `var(${slot})`;
}

function nextName(fields: Field[]): string {
  const used = new Set(fields.map((f) => f.name));
  for (let i = 0; i < 26; i++) {
    const candidate = String.fromCharCode(97 + i);
    if (!used.has(candidate)) return candidate;
  }
  return 'z';
}

/**
 * Lay members out in declaration order:
 *   offset = alignUp(offset, alignof(T)); place; offset += sizeof(T)
 * sizeof(struct) = alignUp(offset, alignof(struct)); the remainder is tail padding.
 * Packed mode forces every alignment to 1, so no padding is ever inserted.
 */
function computeLayout(fields: Field[], packed: boolean): Layout {
  const placed: Placed[] = [];
  const cells: Cell[] = [];
  let offset = 0;
  let structAlign = 1;
  let internalPadding = 0;

  for (const field of fields) {
    const info = TYPES[field.type];
    const align = packed ? 1 : info.align;
    if (align > structAlign) structAlign = align;

    const padBefore = alignUp(offset, align) - offset;
    for (let k = 0; k < padBefore; k++) cells.push({ kind: 'pad', offset: offset + k });
    internalPadding += padBefore;
    offset += padBefore;

    const member: Placed = {
      name: field.name,
      type: field.type,
      offset,
      size: info.size,
      align,
      padBefore,
    };
    placed.push(member);
    for (let k = 0; k < info.size; k++) cells.push({ kind: 'data', offset: offset + k, field: member });
    offset += info.size;
  }

  const size = alignUp(offset, structAlign);
  const tailPadding = size - offset;
  for (let k = 0; k < tailPadding; k++) cells.push({ kind: 'tail', offset: offset + k });

  return {
    placed,
    cells,
    size,
    align: structAlign,
    internalPadding,
    tailPadding,
    padding: internalPadding + tailPadding,
  };
}

/** Stable sort by descending alignment — equal alignments keep declaration order. */
function optimalOrder(fields: Field[], packed: boolean): Field[] {
  return fields
    .map((field, index) => ({ field, index }))
    .sort((x, y) => {
      const ax = packed ? 1 : TYPES[x.field.type].align;
      const ay = packed ? 1 : TYPES[y.field.type].align;
      return ay - ax || x.index - y.index;
    })
    .map((entry) => entry.field);
}

function q<T extends HTMLElement>(root: HTMLElement, selector: string): T {
  const el = root.querySelector<T>(selector);
  if (!el) throw new Error(`struct-alignment: missing element ${selector}`);
  return el;
}

function pct(part: number, whole: number): string {
  if (whole <= 0) return '0.0';
  return ((part / whole) * 100).toFixed(1);
}

function cellTitle(cell: Cell): string {
  if (cell.kind === 'data') {
    return `offset ${cell.offset}: field ${cell.field.name} (${cell.field.type}) byte ${cell.offset - cell.field.offset} of ${cell.field.size}`;
  }
  if (cell.kind === 'tail') return `offset ${cell.offset}: tail padding`;
  return `offset ${cell.offset}: padding`;
}

function renderCode(fields: Placed[], layout: Layout, packed: boolean): string {
  const lines: string[] = ['// x86-64 System V ABI'];
  if (packed) lines.push('#pragma pack(1)');
  lines.push('struct S {');

  if (fields.length === 0) {
    lines.push('    // no members — GNU C gives an empty struct sizeof 0 (C++ gives 1)');
  }

  for (const member of fields) {
    if (member.padBefore > 0) {
      lines.push(`    // ${member.padBefore} byte${member.padBefore === 1 ? '' : 's'} padding`);
    }
    const decl = `    ${member.type.padEnd(7)}${member.name};`;
    lines.push(`${decl.padEnd(26)}// offset ${member.offset}`);
  }

  if (layout.tailPadding > 0) {
    lines.push(`    // ${layout.tailPadding} byte${layout.tailPadding === 1 ? '' : 's'} tail padding`);
  }

  lines.push('};');
  if (packed) lines.push('#pragma pack()');
  lines.push(
    `// sizeof(struct S) == ${layout.size}, _Alignof(struct S) == ${layout.align}, ` +
      `${layout.padding} padding byte${layout.padding === 1 ? '' : 's'}`,
  );
  return lines.join('\n');
}

export function initStructAlignment(root: HTMLElement): void {
  const typeRow = q<HTMLElement>(root, '.sa-types');
  const modeRow = q<HTMLElement>(root, '.sa-modes');
  const tbody = q<HTMLElement>(root, '.sa-fields');
  const empty = q<HTMLElement>(root, '.sa-empty');
  const stats = q<HTMLElement>(root, '.sa-stats');
  const grid = q<HTMLElement>(root, '.sa-grid');
  const hint = q<HTMLElement>(root, '.sa-hint');
  const optLine = q<HTMLElement>(root, '.sa-opt-line');
  const optNote = q<HTMLElement>(root, '.sa-opt-note');
  const applyBtn = q<HTMLButtonElement>(root, '.sa-apply');
  const code = q<HTMLElement>(root, '.sa-code');
  const resetBtn = q<HTMLButtonElement>(root, '.sa-reset');
  const clearBtn = q<HTMLButtonElement>(root, '.sa-clear');
  const typeChips = Array.from(typeRow.querySelectorAll<HTMLButtonElement>('.chip'));
  const modeChips = Array.from(modeRow.querySelectorAll<HTMLButtonElement>('.chip'));

  let fields: Field[] = DEFAULT_FIELDS.map((f) => ({ ...f }));
  let packed = false;
  let layout = computeLayout(fields, packed);
  let optimal = computeLayout(optimalOrder(fields, packed), packed);

  function renderFieldRows(): void {
    tbody.textContent = '';
    for (let i = 0; i < layout.placed.length; i++) {
      const member = layout.placed[i];
      const tr = document.createElement('tr');
      tr.className = 'sa-field-row';

      const nameCell = document.createElement('td');
      const swatch = document.createElement('span');
      swatch.className = 'sa-swatch';
      swatch.style.setProperty('--sa-c', colorVar(member.name));
      nameCell.appendChild(swatch);
      nameCell.appendChild(document.createTextNode(member.name));
      tr.appendChild(nameCell);

      for (const text of [member.type, String(member.offset), String(member.size), String(member.align)]) {
        const td = document.createElement('td');
        td.textContent = text;
        tr.appendChild(td);
      }

      const padCell = document.createElement('td');
      padCell.textContent = member.padBefore > 0 ? `+${member.padBefore}` : '—';
      if (member.padBefore > 0) padCell.className = 'sa-pad-cell';
      tr.appendChild(padCell);

      const actions = document.createElement('td');
      const wrap = document.createElement('div');
      wrap.className = 'sa-actions';

      const up = document.createElement('button');
      up.type = 'button';
      up.className = 'sa-btn';
      up.textContent = '↑';
      up.setAttribute('aria-label', `Move field ${member.name} up`);
      up.disabled = i === 0;
      up.addEventListener('click', () => swap(i, i - 1));

      const down = document.createElement('button');
      down.type = 'button';
      down.className = 'sa-btn';
      down.textContent = '↓';
      down.setAttribute('aria-label', `Move field ${member.name} down`);
      down.disabled = i === layout.placed.length - 1;
      down.addEventListener('click', () => swap(i, i + 1));

      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'sa-btn sa-btn-del';
      remove.textContent = '✕';
      remove.setAttribute('aria-label', `Remove field ${member.name}`);
      remove.addEventListener('click', () => {
        fields.splice(i, 1);
        render();
      });

      wrap.append(up, down, remove);
      actions.appendChild(wrap);
      tr.appendChild(actions);
      tbody.appendChild(tr);
    }

    empty.hidden = fields.length > 0;
  }

  function swap(a: number, b: number): void {
    if (a < 0 || b < 0 || a >= fields.length || b >= fields.length) return;
    const tmp = fields[a];
    fields[a] = fields[b];
    fields[b] = tmp;
    render();
  }

  function renderStats(): void {
    stats.textContent = '';
    const pills: string[] = [
      `sizeof ${layout.size} B`,
      `alignof ${layout.align} B`,
      `padding ${layout.padding} B`,
      `wasted ${pct(layout.padding, layout.size)}%`,
    ];
    for (const text of pills) {
      const span = document.createElement('span');
      span.className = 'meta';
      span.textContent = text;
      stats.appendChild(span);
    }
  }

  function renderGrid(): void {
    grid.textContent = '';
    if (layout.cells.length === 0) {
      const note = document.createElement('p');
      note.className = 'sa-grid-empty';
      note.textContent = 'No members yet — add a field above to lay out some bytes.';
      grid.appendChild(note);
      return;
    }

    for (let start = 0; start < layout.cells.length; start += BYTES_PER_ROW) {
      const row = document.createElement('div');
      row.className = 'sa-row';

      const label = document.createElement('span');
      label.className = 'sa-off';
      label.textContent = String(start);
      row.appendChild(label);

      const cellsWrap = document.createElement('div');
      cellsWrap.className = 'sa-cells';
      for (const cell of layout.cells.slice(start, start + BYTES_PER_ROW)) {
        const el = document.createElement('div');
        el.className = `sa-byte ${cell.kind}`;
        el.dataset.offset = String(cell.offset);
        el.title = cellTitle(cell);
        if (cell.kind === 'data') {
          el.style.setProperty('--sa-c', colorVar(cell.field.name));
          el.textContent = cell.field.name;
        } else {
          el.textContent = cell.kind === 'tail' ? '·' : '×';
        }
        cellsWrap.appendChild(el);
      }
      row.appendChild(cellsWrap);
      grid.appendChild(row);
    }
  }

  function renderHint(): void {
    if (layout.size === 0) {
      hint.textContent = 'Each cell is one byte. Row labels are byte offsets from the start of the struct.';
      return;
    }
    if (layout.padding === 0) {
      hint.textContent = packed
        ? `Packed: every alignment is forced to 1, so all ${layout.size} bytes hold member data — but unaligned loads cost extra cycles (and fault on some ISAs).`
        : `No padding: all ${layout.size} bytes hold member data because every member already lands on a multiple of its alignment.`;
      return;
    }
    hint.textContent =
      `${layout.padding} of ${layout.size} bytes (${pct(layout.padding, layout.size)}%) are padding: ` +
      `${layout.internalPadding} internal (inserted before a member to reach a multiple of its alignment) and ` +
      `${layout.tailPadding} tail (so sizeof stays a multiple of alignof ${layout.align}, keeping arrays of this struct aligned).`;
  }

  function renderOptimal(): void {
    const order = optimal.placed.map((m) => `${m.type} ${m.name}`).join(', ');
    const saved = layout.size - optimal.size;

    if (fields.length === 0) {
      optLine.textContent = 'struct S {};';
      optNote.textContent = 'Nothing to reorder yet.';
      applyBtn.hidden = true;
      return;
    }

    optLine.textContent = `${order} → sizeof ${optimal.size} B, ${optimal.padding} padding B`;

    if (saved > 0) {
      optNote.textContent = `Sorting members by descending alignment saves ${saved} byte${saved === 1 ? '' : 's'} per instance (${pct(saved, layout.size)}% smaller).`;
      optNote.className = 'sa-opt-note sa-saves';
      applyBtn.hidden = false;
    } else {
      optNote.textContent = packed
        ? 'Already optimal: packed layouts have no padding, so member order cannot change sizeof.'
        : 'Already optimal: reordering by alignment cannot make this struct any smaller.';
      optNote.className = 'sa-opt-note';
      applyBtn.hidden = true;
    }
  }

  function render(): void {
    layout = computeLayout(fields, packed);
    optimal = computeLayout(optimalOrder(fields, packed), packed);

    renderFieldRows();
    renderStats();
    renderGrid();
    renderHint();
    renderOptimal();
    code.textContent = renderCode(layout.placed, layout, packed);

    const full = fields.length >= MAX_FIELDS;
    for (const chip of typeChips) {
      chip.disabled = full;
      chip.title = full ? `Limited to ${MAX_FIELDS} members` : '';
    }
    clearBtn.disabled = fields.length === 0;
  }

  for (const chip of typeChips) {
    chip.addEventListener('click', () => {
      const type = chip.dataset.type as TypeName | undefined;
      if (!type || !(type in TYPES) || fields.length >= MAX_FIELDS) return;
      fields.push({ name: nextName(fields), type });
      render();
    });
  }

  for (const chip of modeChips) {
    chip.addEventListener('click', () => {
      packed = chip.dataset.mode === 'packed';
      for (const other of modeChips) other.classList.toggle('active', other === chip);
      render();
    });
  }

  applyBtn.addEventListener('click', () => {
    fields = optimalOrder(fields, packed);
    render();
  });

  resetBtn.addEventListener('click', () => {
    fields = DEFAULT_FIELDS.map((f) => ({ ...f }));
    render();
  });

  clearBtn.addEventListener('click', () => {
    fields = [];
    render();
  });

  window.__struct = {
    get size() {
      return layout.size;
    },
    get align() {
      return layout.align;
    },
    get padding() {
      return layout.padding;
    },
    get packed() {
      return packed;
    },
    get fields() {
      return layout.placed.map((m) => ({ name: m.name, type: m.type as string, offset: m.offset, size: m.size }));
    },
    get optimalSize() {
      return optimal.size;
    },
  };

  render();
}
