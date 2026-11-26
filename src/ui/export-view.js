/**
 * Контроллер вкладки «Экспорт PNG и MP4».
 * Формирует перемешанную последовательность всех активных мест (1 место = 1 кадр при 25 fps).
 * Основной режим: альфа-канал 1152×1920 (только номер места и «ряд N» в плашке 765×500 @ 200, 900).
 */

import { shuffleArray } from '../core/wasm-bridge.js';
import { renderAlphaPreviewBackdrop, renderSeatFrame } from '../export/frame-renderer.js';
import { encodeFramesToMp4, isWebCodecsSupported } from '../export/mp4-muxer.js';
import { buildZip } from '../export/zip-writer.js';

export function createExportView({ state }) {
  const previewCanvas = document.getElementById('export-preview-canvas');
  const previewCtx = previewCanvas.getContext('2d', { alpha: true });
  const previewDimsEl = document.getElementById('export-preview-dims');
  const scrubberInput = document.getElementById('export-scrubber');
  const scrubberLabel = document.getElementById('export-scrubber-label');

  const statSeats = document.getElementById('export-stat-seats');
  const statFrames = document.getElementById('export-stat-frames');
  const statDuration = document.getElementById('export-stat-duration');

  const modeSelect = document.getElementById('export-ending-mode');
  const resolutionSelect = document.getElementById('export-resolution');

  // Контролы альфа-оверлея
  const alphaLayoutControls = document.getElementById('alpha-layout-controls');
  const alphaCoordsGrid = document.getElementById('alpha-coords-grid');
  const alphaBoxXInput = document.getElementById('alpha-box-x');
  const alphaBoxYInput = document.getElementById('alpha-box-y');
  const alphaBoxWInput = document.getElementById('alpha-box-w');
  const alphaBoxHInput = document.getElementById('alpha-box-h');
  const alphaRowCaseSelect = document.getElementById('alpha-row-case');
  const alphaTextThemeSelect = document.getElementById('alpha-text-theme');
  const alphaPreviewBgSelect = document.getElementById('alpha-preview-bg');
  const alphaShowGuideChk = document.getElementById('alpha-show-guide');
  const exportAlphaNote = document.getElementById('export-alpha-note');

  // Контролы классического 16:9 режима
  const classicLayoutControls = document.getElementById('classic-layout-controls');
  const titleInput = document.getElementById('export-title-input');
  const chkShowSector = document.getElementById('export-show-sector');
  const chkShowCounter = document.getElementById('export-show-counter');

  const btnReshuffle = document.getElementById('btn-reshuffle-export');
  const btnExportMp4 = document.getElementById('btn-export-mp4');
  const btnExportPng = document.getElementById('btn-export-png');
  const btnCancelExport = document.getElementById('btn-cancel-export');

  const progressWrap = document.getElementById('export-progress-wrap');
  const progressBar = document.getElementById('export-progress-bar');
  const progressText = document.getElementById('export-progress-text');
  const exportNotice = document.getElementById('export-notice');

  let shuffledSeats = [];
  let abortController = null;
  let isExporting = false;

  // Загружаем макет видео 1152×1920 для предпросмотра наложения
  const guideImage = new Image();
  guideImage.onload = () => {
    refreshMetaAndPreview();
  };
  guideImage.src = './src/assets/positioning_guideline.png';

  // Перерисовываем превью после загрузки веб-шрифтов Manrope / Outfit
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => {
      refreshMetaAndPreview();
    });
  }

  function rebuildSequence() {
    const active = state.seats.filter((s) => s.active);
    shuffledSeats = shuffleArray(active);
    refreshMetaAndPreview();
  }

  function getResolutionConfig() {
    switch (resolutionSelect.value) {
      case '765x500-alpha':
        return { width: 765, height: 500, isAlphaMode: true, isPlaqueOnly: true };
      case '1920x1080':
        return { width: 1920, height: 1080, isAlphaMode: false, isPlaqueOnly: false };
      case '1280x720':
        return { width: 1280, height: 720, isAlphaMode: false, isPlaqueOnly: false };
      case '1152x1920-alpha':
      default:
        return { width: 1152, height: 1920, isAlphaMode: true, isPlaqueOnly: false };
    }
  }

  function clampNumber(inputEl, fallback, minVal, maxVal) {
    const n = Number(inputEl.value);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(maxVal, Math.max(minVal, Math.round(n)));
  }

  function getRenderOptions() {
    const res = getResolutionConfig();
    return {
      isAlphaMode: res.isAlphaMode,
      isPlaqueOnly: res.isPlaqueOnly,
      boxX: clampNumber(alphaBoxXInput, 200, 0, 1152),
      boxY: clampNumber(alphaBoxYInput, 900, 0, 1920),
      boxW: clampNumber(alphaBoxWInput, 765, 100, 1152),
      boxH: clampNumber(alphaBoxHInput, 500, 100, 1920),
      rowWord: alphaRowCaseSelect.value === 'title' ? 'Ряд' : 'ряд',
      textTheme: alphaTextThemeSelect.value === 'light' ? 'light' : 'dark',
      previewBg: alphaPreviewBgSelect.value,
      showGuide: alphaShowGuideChk.checked,
      showSector: chkShowSector.checked,
      showFrameCounter: chkShowCounter.checked,
      titleText: titleInput.value.trim() || 'Розыгрыш мест',
    };
  }

  function syncModeVisibility() {
    const res = getResolutionConfig();
    alphaLayoutControls.hidden = !res.isAlphaMode;
    alphaCoordsGrid.hidden = !res.isAlphaMode || res.isPlaqueOnly;
    classicLayoutControls.hidden = res.isAlphaMode;
    exportAlphaNote.hidden = !res.isAlphaMode;

    if (res.isAlphaMode) {
      btnExportPng.className = 'btn-accent';
      btnExportMp4.className = 'btn-primary';
      btnExportPng.textContent = 'Скачать PNG-секвенцию (альфа, .zip)';
    } else {
      btnExportMp4.className = 'btn-accent';
      btnExportPng.className = 'btn-primary';
      btnExportPng.textContent = 'Скачать PNG-секвенцию (.zip)';
    }
  }

  function syncPreviewCanvasSize(res) {
    const targetW = res.isAlphaMode ? res.width : 960;
    const targetH = res.isAlphaMode ? res.height : 540;
    if (previewCanvas.width !== targetW || previewCanvas.height !== targetH) {
      previewCanvas.width = targetW;
      previewCanvas.height = targetH;
    }

    previewCanvas.classList.remove('is-portrait', 'is-plaque', 'is-landscape');
    if (res.isAlphaMode && !res.isPlaqueOnly) {
      previewCanvas.classList.add('is-portrait');
    } else if (res.isPlaqueOnly) {
      previewCanvas.classList.add('is-plaque');
    } else {
      previewCanvas.classList.add('is-landscape');
    }

    previewDimsEl.textContent = `${res.width} × ${res.height} · 25 к/с${res.isAlphaMode ? ' · RGBA Альфа' : ''}`;
  }

  function buildFrameSpecs() {
    const specs = shuffledSeats.map((seat) => ({ seat, isWinner: false }));
    if (modeSelect.value === 'with-winner' && shuffledSeats.length > 0) {
      const winnerSeat = shuffledSeats[shuffledSeats.length - 1];
      // 75 кадров = ровно 3 секунды удержания финального победителя при 25 к/с
      for (let k = 0; k < 75; k++) {
        specs.push({ seat: winnerSeat, isWinner: true });
      }
    }
    return specs;
  }

  function refreshMetaAndPreview() {
    const res = getResolutionConfig();
    const opts = getRenderOptions();
    syncModeVisibility();
    syncPreviewCanvasSize(res);

    const specs = buildFrameSpecs();
    const totalFrames = specs.length;
    const durationSec = (totalFrames / 25).toFixed(2);

    statSeats.textContent = String(shuffledSeats.length);
    statFrames.textContent = String(totalFrames);
    statDuration.textContent = `${durationSec} сек`;

    if (totalFrames === 0) {
      scrubberInput.min = '0';
      scrubberInput.max = '0';
      scrubberInput.value = '0';
      scrubberLabel.textContent = 'Нет активных мест в пуле';

      if (res.isAlphaMode) {
        renderAlphaPreviewBackdrop(previewCtx, previewCanvas.width, previewCanvas.height, {
          ...opts,
          guideImage,
        });
      } else {
        previewCtx.fillStyle = '#0E1117';
        previewCtx.fillRect(0, 0, previewCanvas.width, previewCanvas.height);
      }

      btnExportMp4.disabled = true;
      btnExportPng.disabled = true;
      return;
    }

    btnExportMp4.disabled = isExporting;
    btnExportPng.disabled = isExporting;

    scrubberInput.min = '0';
    scrubberInput.max = String(totalFrames - 1);
    const curIdx = Math.min(Number(scrubberInput.value) || 0, totalFrames - 1);
    scrubberInput.value = String(curIdx);

    const curSpec = specs[curIdx];
    const timeSec = (curIdx / 25).toFixed(2);
    scrubberLabel.textContent = `Кадр ${curIdx + 1} из ${totalFrames} (${timeSec} сек) — ${curSpec.seat.label}`;

    if (res.isAlphaMode) {
      renderAlphaPreviewBackdrop(previewCtx, previewCanvas.width, previewCanvas.height, {
        ...opts,
        guideImage,
      });
      renderSeatFrame(
        previewCtx,
        previewCanvas.width,
        previewCanvas.height,
        curSpec,
        curIdx,
        totalFrames,
        {
          ...opts,
          clearCanvas: false,
        }
      );
    } else {
      renderSeatFrame(
        previewCtx,
        previewCanvas.width,
        previewCanvas.height,
        curSpec,
        curIdx,
        totalFrames,
        opts
      );
    }
  }

  function setNotice(msg, type = 'info') {
    if (!msg) {
      exportNotice.hidden = true;
      return;
    }
    exportNotice.textContent = msg;
    exportNotice.dataset.type = type;
    exportNotice.hidden = false;
  }

  function setBusy(busy) {
    isExporting = busy;
    btnExportMp4.disabled = busy || shuffledSeats.length === 0;
    btnExportPng.disabled = busy || shuffledSeats.length === 0;
    btnReshuffle.disabled = busy;
    progressWrap.hidden = !busy;
    btnCancelExport.hidden = !busy;
  }

  function updateProgress(done, total, labelPrefix) {
    const pct = total > 0 ? Math.round((done / total) * 100) : 0;
    progressBar.style.width = `${pct}%`;
    progressText.textContent = `${labelPrefix}: ${done} / ${total} кадров (${pct}%)`;
  }

  function downloadBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  async function ensureFontsReady() {
    if (document.fonts && document.fonts.ready) {
      await document.fonts.ready;
    }
  }

  async function handleExportMp4() {
    const specs = buildFrameSpecs();
    if (specs.length === 0) return;

    if (!isWebCodecsSupported()) {
      setNotice(
        'В текущем браузере отсутствует API WebCodecs (VideoEncoder). Используйте экспорт PNG-секвенции (.zip) или откройте приложение в Chrome / Edge.',
        'error'
      );
      return;
    }

    abortController = new AbortController();
    setBusy(true);
    setNotice('');
    updateProgress(0, specs.length, 'Кодирование MP4 (25 к/с)');

    await ensureFontsReady();
    const { width, height, isAlphaMode } = getResolutionConfig();
    const opts = getRenderOptions();
    const mp4Opts = isAlphaMode
      ? { ...opts, clearCanvas: true, opaqueBg: opts.textTheme === 'light' ? '#0E1117' : '#FFFFFF' }
      : opts;

    try {
      const mp4Bytes = await encodeFramesToMp4({
        frames: specs,
        width,
        height,
        fps: 25,
        signal: abortController.signal,
        renderFrameFn: (ctx, w, h, spec, idx, total) => {
          renderSeatFrame(ctx, w, h, spec, idx, total, mp4Opts);
        },
        onProgress: (done, total) => {
          updateProgress(done, total, 'Кодирование MP4 (25 к/с)');
        },
      });

      const blob = new Blob([mp4Bytes], { type: 'video/mp4' });
      const suffix = modeSelect.value === 'no-winner' ? 'no_winner' : 'with_winner';
      downloadBlob(blob, `seats_${width}x${height}_${shuffledSeats.length}_25fps_${suffix}.mp4`);
      setNotice(
        `Видео MP4 успешно сформировано (${specs.length} кадров, ${(specs.length / 25).toFixed(2)} сек при 25 к/с, ${(blob.size / (1024 * 1024)).toFixed(2)} МБ).`,
        'success'
      );
    } catch (err) {
      if (err?.name === 'AbortError') {
        setNotice('Экспорт MP4 отменён пользователем.', 'info');
      } else {
        setNotice(`Ошибка кодирования MP4: ${err.message || err}`, 'error');
      }
    } finally {
      setBusy(false);
      abortController = null;
    }
  }

  async function handleExportPngZip() {
    const specs = buildFrameSpecs();
    if (specs.length === 0) return;

    abortController = new AbortController();
    setBusy(true);
    setNotice('');
    updateProgress(0, specs.length, 'Рендер PNG-секвенции');

    await ensureFontsReady();
    const { width, height, isAlphaMode } = getResolutionConfig();
    const opts = getRenderOptions();
    const pngOpts = { ...opts, clearCanvas: true, opaqueBg: null };

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d', { alpha: isAlphaMode });

    const entries = [];
    const manifestLines = ['frame,time_sec,row,seat,seat_label,sector,is_winner'];

    try {
      for (let i = 0; i < specs.length; i++) {
        if (abortController.signal.aborted) {
          throw new DOMException('Экспорт отменён', 'AbortError');
        }

        const spec = specs[i];
        renderSeatFrame(ctx, width, height, spec, i, specs.length, pngOpts);

        const pngBlob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
        const pngBytes = new Uint8Array(await pngBlob.arrayBuffer());
        const fileName = `frames/frame_${String(i + 1).padStart(4, '0')}.png`;
        entries.push({ name: fileName, data: pngBytes });

        const rowVal = spec.seat.row !== null ? spec.seat.row : '';
        const seatVal = spec.seat.seat !== null ? spec.seat.seat : '';
        manifestLines.push(
          `${i + 1},${(i / 25).toFixed(2)},${rowVal},${seatVal},"${spec.seat.label.replace(/"/g, '""')}","${spec.seat.sectorName.replace(/"/g, '""')}",${spec.isWinner ? 1 : 0}`
        );

        if (i % 4 === 0 || i === specs.length - 1) {
          updateProgress(i + 1, specs.length, 'Рендер PNG-секвенции');
          await new Promise((r) => setTimeout(r, 0));
        }
      }

      const enc = new TextEncoder();
      entries.push({
        name: 'seats_order.csv',
        data: enc.encode('\uFEFF' + manifestLines.join('\n')),
      });

      progressText.textContent = 'Упаковка ZIP-архива...';
      await new Promise((r) => setTimeout(r, 0));

      const zipBytes = buildZip(entries);
      const zipBlob = new Blob([zipBytes], { type: 'application/zip' });
      const alphaTag = isAlphaMode ? 'alpha_' : '';
      downloadBlob(zipBlob, `seats_${alphaTag}${width}x${height}_${specs.length}frames_25fps.zip`);
      setNotice(
        `PNG-секвенция ${isAlphaMode ? 'на альфа-канале ' : ''}(${specs.length} кадров ${width}×${height}, 25 к/с + seats_order.csv) упакована в ZIP (${(zipBlob.size / (1024 * 1024)).toFixed(2)} МБ).`,
        'success'
      );
    } catch (err) {
      if (err?.name === 'AbortError') {
        setNotice('Экспорт PNG-секвенции отменён.', 'info');
      } else {
        setNotice(`Ошибка создания PNG-секвенции: ${err.message || err}`, 'error');
      }
    } finally {
      setBusy(false);
      abortController = null;
    }
  }

  scrubberInput.addEventListener('input', refreshMetaAndPreview);
  modeSelect.addEventListener('change', refreshMetaAndPreview);
  resolutionSelect.addEventListener('change', refreshMetaAndPreview);
  alphaBoxXInput.addEventListener('input', refreshMetaAndPreview);
  alphaBoxYInput.addEventListener('input', refreshMetaAndPreview);
  alphaBoxWInput.addEventListener('input', refreshMetaAndPreview);
  alphaBoxHInput.addEventListener('input', refreshMetaAndPreview);
  alphaRowCaseSelect.addEventListener('change', refreshMetaAndPreview);
  alphaTextThemeSelect.addEventListener('change', refreshMetaAndPreview);
  alphaPreviewBgSelect.addEventListener('change', refreshMetaAndPreview);
  alphaShowGuideChk.addEventListener('change', refreshMetaAndPreview);

  titleInput.addEventListener('input', refreshMetaAndPreview);
  chkShowSector.addEventListener('change', refreshMetaAndPreview);
  chkShowCounter.addEventListener('change', refreshMetaAndPreview);

  btnReshuffle.addEventListener('click', rebuildSequence);
  btnExportMp4.addEventListener('click', handleExportMp4);
  btnExportPng.addEventListener('click', handleExportPngZip);
  btnCancelExport.addEventListener('click', () => {
    if (abortController) abortController.abort();
  });

  function refresh() {
    const active = state.seats.filter((s) => s.active);
    const prevIds = shuffledSeats.map((s) => s.id).sort().join('|');
    const nextIds = active.map((s) => s.id).sort().join('|');
    if (prevIds !== nextIds) {
      shuffledSeats = shuffleArray(active);
    }
    refreshMetaAndPreview();
  }

  rebuildSequence();
  return { refresh };
}
