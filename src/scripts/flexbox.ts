interface FlexItem {
  grow: number;
  alignSelf: string;
}

const MAX_ITEMS = 8;

export function initFlexbox(root: HTMLElement): void {
  const stage = root.querySelector<HTMLElement>('.pg-stage')!;
  const codeEl = root.querySelector<HTMLElement>('.pg-code')!;
  const gapInput = root.querySelector<HTMLInputElement>('.pg-gap')!;
  const gapVal = root.querySelector<HTMLElement>('.pg-gap-val')!;
  const addBtn = root.querySelector<HTMLButtonElement>('.pg-add')!;
  const removeBtn = root.querySelector<HTMLButtonElement>('.pg-remove')!;
  const itemPanel = root.querySelector<HTMLElement>('.pg-item-panel')!;
  const itemTitle = root.querySelector<HTMLElement>('.pg-item-title')!;
  const groups = [...root.querySelectorAll<HTMLElement>('.chip-row[data-prop]')];

  const container: Record<string, string> = {
    'flex-direction': 'row',
    'justify-content': 'flex-start',
    'align-items': 'stretch',
    'flex-wrap': 'nowrap',
  };
  let gap = 8;
  let items: FlexItem[] = Array.from({ length: 4 }, () => ({ grow: 0, alignSelf: 'auto' }));
  let selected: number | null = null;

  function render(): void {
    // chip active states
    for (const group of groups) {
      const prop = group.dataset.prop!;
      let current: string;
      if (group.dataset.scope === 'item') {
        if (selected === null) continue;
        current =
          prop === 'flex-grow' ? String(items[selected]!.grow) : items[selected]!.alignSelf;
      } else {
        current = container[prop]!;
      }
      for (const chip of group.querySelectorAll('.chip')) {
        chip.classList.toggle('active', (chip as HTMLElement).dataset.value === current);
      }
    }

    // stage
    stage.style.flexDirection = container['flex-direction']!;
    stage.style.justifyContent = container['justify-content']!;
    stage.style.alignItems = container['align-items']!;
    stage.style.flexWrap = container['flex-wrap']!;
    stage.style.gap = `${gap}px`;
    gapVal.textContent = `${gap}px`;

    stage.replaceChildren();
    items.forEach((item, i) => {
      const el = document.createElement('button');
      el.className = i === selected ? 'pg-item sel' : 'pg-item';
      el.textContent = String(i + 1);
      el.style.minWidth = `${56 + (i % 3) * 24}px`;
      el.style.minHeight = `${44 + (i % 3) * 22}px`;
      el.style.flexGrow = String(item.grow);
      el.style.alignSelf = item.alignSelf;
      el.addEventListener('click', () => {
        selected = selected === i ? null : i;
        render();
      });
      stage.appendChild(el);
    });

    // item panel
    itemPanel.classList.toggle('hidden', selected === null);
    if (selected !== null) itemTitle.textContent = `Item ${selected + 1}`;

    // generated CSS
    const lines = ['.container {', '  display: flex;'];
    for (const [k, v] of Object.entries(container)) lines.push(`  ${k}: ${v};`);
    lines.push(`  gap: ${gap}px;`, '}');
    if (selected !== null) {
      const it = items[selected]!;
      lines.push(
        '',
        `.item-${selected + 1} {`,
        `  flex-grow: ${it.grow};`,
        `  align-self: ${it.alignSelf};`,
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
        if (prop === 'flex-grow') items[selected]!.grow = Number(value);
        else items[selected]!.alignSelf = value;
      } else {
        container[prop] = value;
      }
      render();
    });
  }
  gapInput.addEventListener('input', () => {
    gap = Number(gapInput.value);
    render();
  });
  addBtn.addEventListener('click', () => {
    if (items.length < MAX_ITEMS) {
      items.push({ grow: 0, alignSelf: 'auto' });
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
