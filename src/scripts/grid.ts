interface GridItem {
  colSpan: number;
  rowSpan: number;
}

const MAX_ITEMS = 12;

export function initGrid(root: HTMLElement): void {
  const stage = root.querySelector<HTMLElement>('.pg-stage')!;
  const codeEl = root.querySelector<HTMLElement>('.pg-code')!;
  const colsInput = root.querySelector<HTMLInputElement>('.pg-cols')!;
  const colsVal = root.querySelector<HTMLElement>('.pg-cols-val')!;
  const gapInput = root.querySelector<HTMLInputElement>('.pg-gap')!;
  const gapVal = root.querySelector<HTMLElement>('.pg-gap-val')!;
  const addBtn = root.querySelector<HTMLButtonElement>('.pg-add')!;
  const removeBtn = root.querySelector<HTMLButtonElement>('.pg-remove')!;
  const itemPanel = root.querySelector<HTMLElement>('.pg-item-panel')!;
  const itemTitle = root.querySelector<HTMLElement>('.pg-item-title')!;
  const groups = [...root.querySelectorAll<HTMLElement>('.chip-row[data-prop]')];

  const container: Record<string, string> = {
    'justify-items': 'stretch',
    'align-items': 'stretch',
  };
  let cols = 3;
  let gap = 8;
  let items: GridItem[] = Array.from({ length: 6 }, () => ({ colSpan: 1, rowSpan: 1 }));
  let selected: number | null = null;

  function render(): void {
    for (const group of groups) {
      const prop = group.dataset.prop!;
      let current: string;
      if (group.dataset.scope === 'item') {
        if (selected === null) continue;
        current =
          prop === 'column-span'
            ? String(items[selected]!.colSpan)
            : String(items[selected]!.rowSpan);
      } else {
        current = container[prop]!;
      }
      for (const chip of group.querySelectorAll('.chip')) {
        chip.classList.toggle('active', (chip as HTMLElement).dataset.value === current);
      }
    }

    stage.style.gridTemplateColumns = `repeat(${cols}, 1fr)`;
    stage.style.gridAutoRows = '70px';
    stage.style.justifyItems = container['justify-items']!;
    stage.style.alignItems = container['align-items']!;
    stage.style.gap = `${gap}px`;
    colsVal.textContent = String(cols);
    gapVal.textContent = `${gap}px`;

    stage.replaceChildren();
    items.forEach((item, i) => {
      const el = document.createElement('button');
      el.className = i === selected ? 'pg-item sel' : 'pg-item';
      el.textContent = String(i + 1);
      const colSpan = Math.min(item.colSpan, cols);
      el.style.gridColumn = `span ${colSpan}`;
      el.style.gridRow = `span ${item.rowSpan}`;
      el.addEventListener('click', () => {
        selected = selected === i ? null : i;
        render();
      });
      stage.appendChild(el);
    });

    itemPanel.classList.toggle('hidden', selected === null);
    if (selected !== null) itemTitle.textContent = `Item ${selected + 1}`;

    const lines = [
      '.container {',
      '  display: grid;',
      `  grid-template-columns: repeat(${cols}, 1fr);`,
      '  grid-auto-rows: 70px;',
      `  justify-items: ${container['justify-items']};`,
      `  align-items: ${container['align-items']};`,
      `  gap: ${gap}px;`,
      '}',
    ];
    if (selected !== null) {
      const it = items[selected]!;
      lines.push(
        '',
        `.item-${selected + 1} {`,
        `  grid-column: span ${Math.min(it.colSpan, cols)};`,
        `  grid-row: span ${it.rowSpan};`,
        '}',
      );
    }
    codeEl.textContent = lines.join('\n');

    addBtn.disabled = items.length >= MAX_ITEMS;
    removeBtn.disabled = items.length <= 1;
  }

  for (const group of groups) {
    group.addEventListener('click', (e) => {
      const chip = (e.target as HTMLElement).closest<HTMLElement>('.chip');
      if (!chip) return;
      const prop = group.dataset.prop!;
      const value = chip.dataset.value!;
      if (group.dataset.scope === 'item') {
        if (selected === null) return;
        if (prop === 'column-span') items[selected]!.colSpan = Number(value);
        else items[selected]!.rowSpan = Number(value);
      } else {
        container[prop] = value;
      }
      render();
    });
  }
  colsInput.addEventListener('input', () => {
    cols = Number(colsInput.value);
    render();
  });
  gapInput.addEventListener('input', () => {
    gap = Number(gapInput.value);
    render();
  });
  addBtn.addEventListener('click', () => {
    if (items.length < MAX_ITEMS) {
      items.push({ colSpan: 1, rowSpan: 1 });
      render();
    }
  });
  removeBtn.addEventListener('click', () => {
    if (items.length > 1) {
      items.pop();
      if (selected !== null && selected >= items.length) selected = null;
      render();
    }
  });

  render();
}
