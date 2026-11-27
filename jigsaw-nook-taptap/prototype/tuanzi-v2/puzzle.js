// 「团子去旅行 2.0」明信片「记忆显影」轻量化 3×3 拼图体验模块

export function mountPostcardPuzzle(container, { imageSrc, onSnap, onComplete }) {
  const cols = 3;
  const rows = 3;
  const total = cols * rows;

  // 生成可玩且不直接完成的小洗牌序列
  const order = Array.from({ length: total }, (_, i) => i);
  for (let i = total - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [order[i], order[j]] = [order[j], order[i]];
  }
  if (order.every((v, i) => v === i)) {
    [order[0], order[4]] = [order[4], order[0]];
  }

  let selected = -1;
  let solved = false;

  const board = document.createElement('div');
  board.className = 'pz-grid';
  container.innerHTML = '';
  container.appendChild(board);

  function render() {
    board.innerHTML = '';
    const placed = order.filter((v, i) => v === i).length;
    order.forEach((pieceIdx, slotIdx) => {
      const cell = document.createElement('button');
      cell.type = 'button';
      cell.className = 'pz-tile';
      if (pieceIdx === slotIdx) cell.classList.add('locked');
      if (selected === slotIdx) cell.classList.add('selected');

      const pc = pieceIdx % cols;
      const pr = Math.floor(pieceIdx / cols);
      cell.style.backgroundImage = `url("${imageSrc}")`;
      cell.style.backgroundSize = `${cols * 100}% ${rows * 100}%`;
      cell.style.backgroundPosition = `${(pc / (cols - 1)) * 100}% ${(pr / (rows - 1)) * 100}%`;

      cell.addEventListener('click', () => {
        if (solved) return;
        if (selected === -1) {
          selected = slotIdx;
          render();
          return;
        }
        if (selected === slotIdx) {
          selected = -1;
          render();
          return;
        }
        [order[selected], order[slotIdx]] = [order[slotIdx], order[selected]];
        selected = -1;
        onSnap?.();
        render();
        if (order.every((v, i) => v === i)) {
          solved = true;
          board.classList.add('solved');
          setTimeout(() => onComplete?.(), 360);
        }
      });

      board.appendChild(cell);
    });
    container.dataset.progress = `${placed}/${total}`;
  }

  render();

  return {
    autoSolve() {
      if (solved) return;
      for (let i = 0; i < total; i++) order[i] = i;
      solved = true;
      selected = -1;
      render();
      board.classList.add('solved');
      setTimeout(() => onComplete?.(), 360);
    },
  };
}
