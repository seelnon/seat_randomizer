/**
 * Контроллер вкладки «Пул и импорт XLS / XLSX».
 * Позволяет загружать .xls / .xlsx / .csv, обрезать пул под нужное количество мест,
 * фильтровать по секторам и просматривать/редактировать список мест.
 */

import { generateDefaultSeats, SECTORS } from '../core/seats-data.js';
import { shuffleArray } from '../core/wasm-bridge.js';
import { buildSampleXlsx, parseSpreadsheetFile } from '../parsers/spreadsheet.js';

export function createPoolView({ state, onStateChange, onGoToExport }) {
  const dropZone = document.getElementById('drop-zone');
  const fileInput = document.getElementById('file-import-input');
  const btnPickFile = document.getElementById('btn-pick-file');
  const btnDownloadSample = document.getElementById('btn-download-sample');
  const btnGoExport = document.getElementById('btn-go-export');
  const importModeSelect = document.getElementById('import-mode');
  const importFeedback = document.getElementById('import-feedback');

  const sectorFiltersEl = document.getElementById('sector-filters');
  const trimCountInput = document.getElementById('trim-count-input');
  const btnTrimRandom = document.getElementById('btn-trim-random');
  const btnResetDefault = document.getElementById('btn-reset-default');
  const btnActivateAll = document.getElementById('btn-activate-all');

  const searchInput = document.getElementById('pool-search-input');
  const poolCountBadge = document.getElementById('pool-count-summary');
  const poolTableBody = document.getElementById('pool-table-body');

  let searchQuery = '';

  if (btnGoExport && onGoToExport) {
    btnGoExport.addEventListener('click', () => onGoToExport());
  }

  function showFeedback(message, type = 'info') {
    importFeedback.textContent = message;
    importFeedback.dataset.type = type;
    importFeedback.hidden = false;
  }

  function summarizeNumericRanges(seats) {
    const rows = seats.map((s) => s.row).filter((n) => n !== null && Number.isFinite(n));
    const nums = seats.map((s) => s.seat).filter((n) => n !== null && Number.isFinite(n));
    const parts = [];
    if (rows.length > 0) {
      const minR = Math.min(...rows);
      const maxR = Math.max(...rows);
      parts.push(minR === maxR ? `ряд: ${minR}` : `ряды: ${minR}–${maxR}`);
    }
    if (nums.length > 0) {
      const minS = Math.min(...nums);
      const maxS = Math.max(...nums);
      parts.push(minS === maxS ? `место: ${minS}` : `места: ${minS}–${maxS}`);
    }
    return parts.length > 0 ? ` (${parts.join(', ')})` : '';
  }

  async function handleFile(file) {
    if (!file) return;
    showFeedback(`Читаем файл «${file.name}»...`, 'info');
    try {
      const result = await parseSpreadsheetFile(file);
      if (result.seats.length === 0) {
        showFeedback(result.warnings[0] || 'В файле не найдено подходящих строк с местами.', 'error');
        return;
      }

      const mode = importModeSelect.value;
      const rangeInfo = summarizeNumericRanges(result.seats);
      const skippedNote = result.skippedRows > 0 ? ` · пропущено строк без цифр: ${result.skippedRows}` : '';

      if (mode === 'replace') {
        state.seats = result.seats;
        state.history = [];
        showFeedback(
          `Загружено мест из «${file.name}»: ${result.seats.length} шт.${rangeInfo}${skippedNote}. Пул обновлён.`,
          'success'
        );
      } else if (mode === 'intersect') {
        const keySet = new Set(result.seats.map((s) => s.rowSeatKey || s.id));
        let kept = 0;
        for (const seat of state.seats) {
          seat.active = keySet.has(seat.rowSeatKey || seat.id);
          seat.drawn = false;
          if (seat.active) kept++;
        }
        state.history = [];
        showFeedback(
          `Пул сокращён по файлу «${file.name}»: оставлено ${kept} совпавших мест${rangeInfo}${skippedNote}.`,
          'success'
        );
      } else if (mode === 'exclude') {
        const excludeSet = new Set(result.seats.map((s) => s.rowSeatKey || s.id));
        let excluded = 0;
        for (const seat of state.seats) {
          if (excludeSet.has(seat.rowSeatKey || seat.id)) {
            seat.active = false;
            excluded++;
          }
        }
        showFeedback(
          `Исключено мест по файлу «${file.name}»: ${excluded} шт.${skippedNote}.`,
          'success'
        );
      }

      refresh();
      if (onStateChange) onStateChange();
    } catch (err) {
      showFeedback(`Ошибка чтения файла: ${err.message || err}`, 'error');
    }
  }

  btnPickFile.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    if (fileInput.files?.[0]) {
      handleFile(fileInput.files[0]);
      fileInput.value = '';
    }
  });

  dropZone.addEventListener('dragover', (e) => {
    e.preventDefault();
    dropZone.classList.add('is-dragover');
  });
  dropZone.addEventListener('dragleave', () => {
    dropZone.classList.remove('is-dragover');
  });
  dropZone.addEventListener('drop', (e) => {
    e.preventDefault();
    dropZone.classList.remove('is-dragover');
    const file = e.dataTransfer?.files?.[0];
    if (file) handleFile(file);
  });

  btnDownloadSample.addEventListener('click', () => {
    const bytes = buildSampleXlsx(state.seats.length > 0 ? state.seats : generateDefaultSeats());
    const blob = new Blob([bytes], {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'пример_мест_для_розыгрыша.xlsx';
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });

  btnTrimRandom.addEventListener('click', () => {
    const target = Math.max(1, parseInt(trimCountInput.value, 10) || 0);
    const activeIndices = [];
    state.seats.forEach((s, i) => {
      if (s.active) activeIndices.push(i);
    });
    if (target >= activeIndices.length) {
      showFeedback(`Активных мест (${activeIndices.length}) уже не больше ${target}.`, 'info');
      return;
    }
    const shuffled = shuffleArray(activeIndices);
    const keepSet = new Set(shuffled.slice(0, target));
    state.seats.forEach((s, idx) => {
      s.active = keepSet.has(idx);
      s.drawn = false;
    });
    state.history = [];
    showFeedback(`Пул случайно сокращён до ${target} активных мест.`, 'success');
    refresh();
    if (onStateChange) onStateChange();
  });

  btnActivateAll.addEventListener('click', () => {
    for (const s of state.seats) {
      s.active = true;
      s.drawn = false;
    }
    state.history = [];
    showFeedback(`Все ${state.seats.length} мест в списке снова активны.`, 'info');
    refresh();
    if (onStateChange) onStateChange();
  });

  btnResetDefault.addEventListener('click', () => {
    state.seats = generateDefaultSeats();
    state.history = [];
    showFeedback('Восстановлена базовая схема зала: 430 мест (23 ряда).', 'info');
    refresh();
    if (onStateChange) onStateChange();
  });

  searchInput.addEventListener('input', () => {
    searchQuery = searchInput.value.trim().toLowerCase();
    renderTable();
  });

  function renderSectorFilters() {
    sectorFiltersEl.innerHTML = '';
    const counts = new Map();
    for (const s of state.seats) {
      const key = s.sectorName;
      if (!counts.has(key)) counts.set(key, { name: key, color: s.sectorColor, total: 0, active: 0 });
      const rec = counts.get(key);
      rec.total++;
      if (s.active) rec.active++;
    }

    for (const rec of counts.values()) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'sector-toggle-btn';
      if (rec.active > 0) btn.classList.add('is-on');
      btn.innerHTML = `
        <span class="sector-dot" style="background:${rec.color}"></span>
        <span>${escapeHtml(rec.name)}</span>
        <span class="sector-num">${rec.active}/${rec.total}</span>
      `;
      btn.addEventListener('click', () => {
        const turnOn = rec.active === 0;
        for (const s of state.seats) {
          if (s.sectorName === rec.name) s.active = turnOn;
        }
        refresh();
        if (onStateChange) onStateChange();
      });
      sectorFiltersEl.appendChild(btn);
    }
  }

  function renderTable() {
    const activeCount = state.seats.filter((s) => s.active).length;
    poolCountBadge.textContent = `Активно в пуле: ${activeCount} из ${state.seats.length} · Длительность MP4 (25 к/с): ${(activeCount / 25).toFixed(2)} сек`;
    trimCountInput.max = String(Math.max(1, state.seats.length));

    const filtered = searchQuery
      ? state.seats.filter(
          (s) =>
            s.label.toLowerCase().includes(searchQuery) ||
            s.sectorName.toLowerCase().includes(searchQuery) ||
            s.extra.toLowerCase().includes(searchQuery)
        )
      : state.seats;

    const maxRender = 250;
    const slice = filtered.slice(0, maxRender);
    const frag = document.createDocumentFragment();

    slice.forEach((seat, i) => {
      const tr = document.createElement('tr');
      if (!seat.active) tr.className = 'is-row-inactive';

      tr.innerHTML = `
        <td class="col-num">${i + 1}</td>
        <td>
          <span class="table-sector-cell">
            <span class="sector-dot" style="background:${seat.sectorColor || SECTORS.custom.color}"></span>
            <span>${escapeHtml(seat.sectorName)}</span>
          </span>
        </td>
        <td class="col-num">${seat.row !== null ? seat.row : '—'}</td>
        <td class="col-num">${seat.seat !== null ? seat.seat : escapeHtml(seat.label)}</td>
        <td class="col-muted">${escapeHtml(seat.extra || (seat.drawn ? 'Выпало ранее' : 'В очереди'))}</td>
        <td class="col-action">
          <button type="button" class="btn-inline-toggle" data-id="${escapeHtml(seat.id)}">
            ${seat.active ? 'Включено' : 'Исключено'}
          </button>
        </td>
      `;

      tr.querySelector('.btn-inline-toggle').addEventListener('click', () => {
        seat.active = !seat.active;
        renderSectorFilters();
        renderTable();
        if (onStateChange) onStateChange();
      });

      frag.appendChild(tr);
    });

    poolTableBody.innerHTML = '';
    poolTableBody.appendChild(frag);

    if (filtered.length > maxRender) {
      const noteTr = document.createElement('tr');
      noteTr.innerHTML = `<td colspan="6" class="table-more-note">Показаны первые ${maxRender} из ${filtered.length} строк. Используйте поиск выше для фильтрации.</td>`;
      poolTableBody.appendChild(noteTr);
    } else if (filtered.length === 0) {
      const emptyTr = document.createElement('tr');
      emptyTr.innerHTML = `<td colspan="6" class="table-more-note">Места по вашему запросу не найдены.</td>`;
      poolTableBody.appendChild(emptyTr);
    }
  }

  function refresh() {
    renderSectorFilters();
    renderTable();
  }

  refresh();
  return { refresh };
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
