/**
 * Контроллер вкладки «Сцена розыгрыша».
 * Запуск и остановка рандомайзера по клику или клавише (Пробел / Enter / Стрелка вправо / PageDown).
 */

import { formatSeatParts, SECTORS } from '../core/seats-data.js';
import { randomSeed32 } from '../core/wasm-bridge.js';

export function createStageView({ state, confetti, onStateChange }) {
  const stageCard = document.getElementById('stage-card');
  const stageSectorBar = document.getElementById('stage-sector-bar');
  const stageSectorLabel = document.getElementById('stage-sector-label');
  const stageRowText = document.getElementById('stage-row-text');
  const stageSeatText = document.getElementById('stage-seat-text');
  const stageHint = document.getElementById('stage-hint');
  const btnToggleSpin = document.getElementById('btn-toggle-spin');
  const chkExcludeDrawn = document.getElementById('chk-exclude-drawn');
  const chkAutoStop = document.getElementById('chk-auto-stop');
  const btnResetDrawn = document.getElementById('btn-reset-drawn');
  const winnersListEl = document.getElementById('winners-list');
  const winnersEmptyEl = document.getElementById('winners-empty');
  const hallMapEl = document.getElementById('hall-map');
  const stagePoolStats = document.getElementById('stage-pool-stats');

  let isRolling = false;
  let rollTimer = null;
  let autoStopTimer = null;
  let lastShownSeat = null;

  function getAvailablePool() {
    return state.seats.filter((s) => s.active && (!state.excludeDrawn || !s.drawn));
  }

  function renderStageDisplay(seatObj, mode) {
    const parts = formatSeatParts(seatObj);
    stageSectorBar.style.backgroundColor = parts.color;
    stageSectorLabel.textContent = parts.sectorText;
    stageRowText.textContent = parts.rowText;
    stageSeatText.textContent = parts.seatText;

    stageCard.classList.remove('is-spinning', 'is-winner');
    if (mode === 'spinning') {
      stageCard.classList.add('is-spinning');
      stageHint.textContent = 'Идёт перебор... Нажмите ещё раз или Пробел для остановки';
      btnToggleSpin.textContent = 'Остановить выбор';
      btnToggleSpin.classList.add('btn-stop');
    } else if (mode === 'winner') {
      stageCard.classList.add('is-winner');
      stageHint.textContent = 'Место выбрано! Нажмите для следующего розыгрыша';
      btnToggleSpin.textContent = 'Запустить следующий';
      btnToggleSpin.classList.remove('btn-stop');
    } else {
      stageHint.textContent = 'Нажмите на экран или клавишу Пробел / Вправо / Enter';
      btnToggleSpin.textContent = 'Запустить розыгрыш';
      btnToggleSpin.classList.remove('btn-stop');
    }
  }

  function renderWinners() {
    winnersListEl.innerHTML = '';
    if (state.history.length === 0) {
      winnersEmptyEl.hidden = false;
      return;
    }
    winnersEmptyEl.hidden = true;

    state.history.slice(0, 14).forEach((entry, idx) => {
      const li = document.createElement('li');
      li.className = 'winner-item';
      const parts = formatSeatParts(entry.seat);
      const orderNum = state.history.length - idx;
      li.innerHTML = `
        <span class="winner-index">#${orderNum}</span>
        <span class="winner-swatch" style="background:${parts.color}"></span>
        <span class="winner-label">${escapeHtml(parts.singleLine)}</span>
        <span class="winner-sector">${escapeHtml(parts.sectorText)}</span>
      `;
      winnersListEl.appendChild(li);
    });
  }

  function renderHallMap() {
    const activeCount = state.seats.filter((s) => s.active).length;
    const availCount = getAvailablePool().length;
    stagePoolStats.textContent = `В пуле: ${availCount} из ${activeCount} активных · Всего в базе: ${state.seats.length}`;

    // Группируем по рядам, если есть числовые ряды
    const numericSeats = state.seats.filter((s) => s.row !== null && s.seat !== null);
    if (numericSeats.length === 0) {
      hallMapEl.innerHTML = `<div class="hall-empty-note">Загружен произвольный список (${state.seats.length} записей). Для просмотра карты перейдите во вкладку «Пул и импорт».</div>`;
      return;
    }

    const byGroup = new Map();
    for (const s of numericSeats) {
      const hasCustomSector = s.sectorRaw && !/^(Жёлтый|Оранжевый|Бордовый|Серый|Белый)\s+сектор$/i.test(s.sectorRaw);
      const groupKey = hasCustomSector ? `${s.sectorRaw} · Р${s.row}` : `Р${s.row}`;
      if (!byGroup.has(groupKey)) {
        byGroup.set(groupKey, { label: groupKey, row: s.row, sector: s.sectorRaw || '', seats: [] });
      }
      byGroup.get(groupKey).seats.push(s);
    }

    const groups = Array.from(byGroup.values()).sort((a, b) => {
      if (a.sector !== b.sector) return a.sector.localeCompare(b.sector, 'ru');
      return a.row - b.row;
    });

    const frag = document.createDocumentFragment();
    for (const grp of groups) {
      const rowSeats = grp.seats.slice().sort((a, b) => a.seat - b.seat);
      const rowEl = document.createElement('div');
      rowEl.className = 'hall-row';

      const lbl = document.createElement('span');
      lbl.className = 'hall-row-label';
      lbl.textContent = grp.label;
      lbl.title = grp.sector ? `${grp.sector}, Ряд ${grp.row}` : `Ряд ${grp.row}`;
      if (grp.label.length > 5) lbl.style.width = 'auto';
      rowEl.appendChild(lbl);

      const cellsWrap = document.createElement('div');
      cellsWrap.className = 'hall-row-cells';

      for (const seat of rowSeats) {
        const dot = document.createElement('span');
        dot.className = 'hall-seat';
        if (!seat.active) dot.classList.add('is-inactive');
        else if (seat.drawn) dot.classList.add('is-drawn');
        if (lastShownSeat && lastShownSeat.id === seat.id && !isRolling) {
          dot.classList.add('is-current');
        }
        dot.style.setProperty('--seat-color', seat.sectorColor || SECTORS.custom.color);
        dot.title = `${seat.label} (${seat.sectorName})${seat.extra ? ' — ' + seat.extra : ''}`;
        cellsWrap.appendChild(dot);
      }

      rowEl.appendChild(cellsWrap);
      frag.appendChild(rowEl);
    }

    hallMapEl.innerHTML = '';
    hallMapEl.appendChild(frag);
  }

  function pickRandomFromPool(pool) {
    if (pool.length === 0) return null;
    const idx = randomSeed32() % pool.length;
    return pool[idx];
  }

  function startSpin() {
    if (isRolling) return;
    const pool = getAvailablePool();
    if (pool.length === 0) {
      stageSectorLabel.textContent = 'Пул мест пуст';
      stageRowText.textContent = '—';
      stageSeatText.textContent = 'Нет мест';
      stageHint.textContent = 'Сбросьте историю выпавших мест или импортируйте новый список.';
      return;
    }

    isRolling = true;
    const first = pickRandomFromPool(pool);
    lastShownSeat = first;
    renderStageDisplay(first, 'spinning');

    rollTimer = setInterval(() => {
      const currentPool = getAvailablePool();
      if (currentPool.length === 0) {
        stopSpin();
        return;
      }
      const next = pickRandomFromPool(currentPool);
      lastShownSeat = next;
      renderStageDisplay(next, 'spinning');
    }, 40);

    if (state.autoStop) {
      autoStopTimer = setTimeout(() => {
        stopSpin();
      }, 3000);
    }
  }

  function stopSpin() {
    if (!isRolling) return;
    clearInterval(rollTimer);
    clearTimeout(autoStopTimer);
    rollTimer = null;
    autoStopTimer = null;
    isRolling = false;

    const pool = getAvailablePool();
    const winner = pickRandomFromPool(pool);
    if (!winner) return;

    lastShownSeat = winner;
    winner.drawn = true;
    state.history.unshift({ seat: winner, timestamp: Date.now() });

    renderStageDisplay(winner, 'winner');
    renderWinners();
    renderHallMap();

    const rect = stageCard.getBoundingClientRect();
    confetti.burst(rect.left + rect.width / 2, rect.top + rect.height / 2, winner.sectorColor);

    if (onStateChange) onStateChange();
  }

  function toggleSpin() {
    if (isRolling) {
      stopSpin();
    } else {
      startSpin();
    }
  }

  // События управления
  stageCard.addEventListener('click', () => {
    toggleSpin();
  });

  btnToggleSpin.addEventListener('click', (e) => {
    e.stopPropagation();
    toggleSpin();
  });

  chkExcludeDrawn.addEventListener('change', () => {
    state.excludeDrawn = chkExcludeDrawn.checked;
    renderHallMap();
    if (onStateChange) onStateChange();
  });

  chkAutoStop.addEventListener('change', () => {
    state.autoStop = chkAutoStop.checked;
  });

  btnResetDrawn.addEventListener('click', () => {
    if (isRolling) {
      clearInterval(rollTimer);
      clearTimeout(autoStopTimer);
      isRolling = false;
    }
    for (const s of state.seats) s.drawn = false;
    state.history = [];
    lastShownSeat = null;
    renderStageDisplay(null, 'idle');
    renderWinners();
    renderHallMap();
    if (onStateChange) onStateChange();
  });

  function handleKeyDown(e) {
    if (state.activeTab !== 'stage') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (e.code === 'Space' || e.code === 'Enter' || e.code === 'ArrowRight' || e.code === 'PageDown') {
      e.preventDefault();
      toggleSpin();
    }
  }

  window.addEventListener('keydown', handleKeyDown);

  function refresh() {
    chkExcludeDrawn.checked = state.excludeDrawn;
    chkAutoStop.checked = state.autoStop;
    if (!isRolling) {
      renderStageDisplay(lastShownSeat, lastShownSeat ? 'winner' : 'idle');
    }
    renderWinners();
    renderHallMap();
  }

  refresh();
  return { refresh, stopSpinIfRunning: () => isRolling && stopSpin() };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
