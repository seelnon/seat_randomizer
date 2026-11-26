/**
 * Отрисовщик кадров для превью, PNG-секвенций (включая альфа-канал) и MP4-видео (25 к/с).
 * Каждый кадр строго отображает одно конкретное место, чтобы зритель мог нажать «Пауза».
 */

import { formatSeatParts } from '../core/seats-data.js';

const ALPHA_FONT_STACK = '"Manrope", "Outfit", "Segoe UI", Arial, sans-serif';

/**
 * Отрисовка подложки ТОЛЬКО для предпросмотра альфа-кадра (в экспортируемые PNG не попадает).
 */
export function renderAlphaPreviewBackdrop(ctx, width, height, options = {}) {
  const {
    previewBg = 'reference',
    showGuide = true,
    guideImage = null,
    isPlaqueOnly = false,
    boxX = 200,
    boxY = 900,
    boxW = 765,
    boxH = 500,
    textTheme = 'dark',
  } = options;

  ctx.clearRect(0, 0, width, height);

  if (previewBg === 'reference' && !isPlaqueOnly && guideImage && guideImage.complete && guideImage.naturalWidth > 0) {
    ctx.drawImage(guideImage, 0, 0, width, height);
  } else if (previewBg === 'reference' && isPlaqueOnly) {
    // Для режима «только плашка» в макете рисуем чистую светлую или тёмную карточку
    ctx.fillStyle = textTheme === 'light' ? '#12161F' : '#F8FAFC';
    ctx.fillRect(0, 0, width, height);
  } else {
    // Шахматка прозрачности
    const tile = Math.max(16, Math.round(Math.min(width, height) / 32));
    for (let y = 0; y < height; y += tile) {
      for (let x = 0; x < width; x += tile) {
        const even = ((x / tile) + (y / tile)) % 2 === 0;
        ctx.fillStyle = even ? '#1B2230' : '#252E40';
        ctx.fillRect(x, y, tile, tile);
      }
    }
    if (previewBg === 'reference' && !isPlaqueOnly) {
      // Если картинка макета ещё грузится — рисуем схематичную белую плашку по координатам
      ctx.fillStyle = textTheme === 'light' ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.94)';
      ctx.fillRect(boxX, boxY, boxW, boxH);
    }
  }

  if (showGuide) {
    const gx = isPlaqueOnly ? 0 : boxX;
    const gy = isPlaqueOnly ? 0 : boxY;
    const gw = isPlaqueOnly ? width : boxW;
    const gh = isPlaqueOnly ? height : boxH;

    ctx.save();
    if (previewBg === 'reference' && !isPlaqueOnly && guideImage && guideImage.complete && guideImage.naturalWidth > 0) {
      // Перекрываем зелёную заливку белой плашкой в зоне текста, чтобы сразу видеть контраст цифр как на фото
      ctx.fillStyle = textTheme === 'light' ? 'rgba(15, 23, 42, 0.92)' : 'rgba(255, 255, 255, 0.96)';
      ctx.fillRect(gx, gy, gw, gh);
    }
    ctx.strokeStyle = '#16A34A';
    ctx.lineWidth = Math.max(2, Math.round(width / 380));
    ctx.setLineDash([14, 10]);
    ctx.strokeRect(gx + 1, gy + 1, gw - 2, gh - 2);
    ctx.restore();
  }
}

/**
 * Альфа-оверлей: строго только крупный номер места и подпись «ряд N» внутри заданной области (765×500 @ 200,900).
 * По умолчанию фон полностью прозрачный (RGBA alpha).
 */
export function renderAlphaSeatFrame(ctx, width, height, frameSpec, options = {}) {
  const {
    isPlaqueOnly = false,
    boxX = 200,
    boxY = 900,
    boxW = 765,
    boxH = 500,
    rowWord = 'ряд',
    textTheme = 'dark',
    clearCanvas = true,
    opaqueBg = null,
  } = options;

  if (clearCanvas) {
    ctx.clearRect(0, 0, width, height);
  }
  if (opaqueBg) {
    ctx.fillStyle = opaqueBg;
    ctx.fillRect(0, 0, width, height);
  }

  const seat = frameSpec?.seat;
  if (!seat) return;

  const rx = isPlaqueOnly ? 0 : (boxX * width) / 1152;
  const ry = isPlaqueOnly ? 0 : (boxY * height) / 1920;
  const rw = isPlaqueOnly ? width : (boxW * width) / 1152;
  const rh = isPlaqueOnly ? height : (boxH * height) / 1920;

  const u = Math.min(rw / 765, rh / 500);
  const padX = Math.round(36 * u);
  const maxTextW = Math.max(40, rw - padX * 2);
  const centerX = rx + rw / 2;

  const seatColor = textTheme === 'light' ? '#FFFFFF' : '#000000';
  const rowColor = textTheme === 'light' ? '#CBD5E1' : '#3C424B';

  ctx.save();
  ctx.beginPath();
  ctx.rect(rx, ry, rw, rh);
  ctx.clip();

  ctx.textBaseline = 'middle';

  if (seat.seat !== null && seat.row !== null) {
    const seatText = String(seat.seat);
    let seatSize = Math.round(226 * u);

    ctx.font = `700 ${seatSize}px ${ALPHA_FONT_STACK}`;
    let seatW = ctx.measureText(seatText).width;
    if (seatW > maxTextW) {
      seatSize = Math.max(36, Math.floor(seatSize * (maxTextW / seatW)));
      ctx.font = `700 ${seatSize}px ${ALPHA_FONT_STACK}`;
    }

    const seatCenterY = ry + rh * 0.39;
    ctx.fillStyle = seatColor;
    ctx.textAlign = 'center';
    ctx.fillText(seatText, centerX, seatCenterY);

    // Подпись «ряд N» (слово «ряд» — обычное начертание, цифра — жирное)
    const prefix = `${rowWord} `;
    const rowNumText = String(seat.row);
    let rowSize = Math.round(88 * u);

    const measureRowLine = (sz) => {
      ctx.font = `400 ${sz}px ${ALPHA_FONT_STACK}`;
      const pW = ctx.measureText(prefix).width;
      ctx.font = `700 ${sz}px ${ALPHA_FONT_STACK}`;
      const nW = ctx.measureText(rowNumText).width;
      return { pW, nW, total: pW + nW };
    };

    let rowMetrics = measureRowLine(rowSize);
    if (rowMetrics.total > maxTextW) {
      rowSize = Math.max(24, Math.floor(rowSize * (maxTextW / rowMetrics.total)));
      rowMetrics = measureRowLine(rowSize);
    }

    const rowCenterY = ry + rh * 0.72;
    const startX = centerX - rowMetrics.total / 2;

    ctx.fillStyle = rowColor;
    ctx.textAlign = 'left';
    ctx.font = `400 ${rowSize}px ${ALPHA_FONT_STACK}`;
    ctx.fillText(prefix, startX, rowCenterY);

    ctx.font = `700 ${rowSize}px ${ALPHA_FONT_STACK}`;
    ctx.fillText(rowNumText, startX + rowMetrics.pW, rowCenterY);
  } else if (seat.seat !== null) {
    // Если в файле только номер места без ряда
    const seatText = String(seat.seat);
    let seatSize = Math.round(240 * u);
    ctx.font = `700 ${seatSize}px ${ALPHA_FONT_STACK}`;
    const seatW = ctx.measureText(seatText).width;
    if (seatW > maxTextW) {
      seatSize = Math.max(36, Math.floor(seatSize * (maxTextW / seatW)));
      ctx.font = `700 ${seatSize}px ${ALPHA_FONT_STACK}`;
    }
    ctx.fillStyle = seatColor;
    ctx.textAlign = 'center';
    ctx.fillText(seatText, centerX, ry + rh * 0.5);
  } else {
    // Произвольный текст (если импортирован нестандартный список)
    const label = String(seat.label || '').trim() || '—';
    let fontSize = Math.round((label.length > 14 ? 76 : 112) * u);
    ctx.font = `700 ${fontSize}px ${ALPHA_FONT_STACK}`;
    const w = ctx.measureText(label).width;
    if (w > maxTextW) {
      fontSize = Math.max(28, Math.floor(fontSize * (maxTextW / w)));
      ctx.font = `700 ${fontSize}px ${ALPHA_FONT_STACK}`;
    }
    ctx.fillStyle = seatColor;
    ctx.textAlign = 'center';
    ctx.fillText(label, centerX, ry + rh * 0.5, maxTextW);
  }

  ctx.restore();
}

/**
 * Классический полноэкранный рендер (16:9 тёмный фон с сектором и рамкой).
 */
export function renderClassicSeatFrame(ctx, width, height, frameSpec, frameIndex, totalFrames, options = {}) {
  const {
    showFrameCounter = false,
    showSector = true,
    titleText = 'Розыгрыш мест',
  } = options;

  const seat = frameSpec.seat;
  const isWinner = Boolean(frameSpec.isWinner);
  const parts = formatSeatParts(seat);
  const scale = height / 1080;

  ctx.fillStyle = '#0E1117';
  ctx.fillRect(0, 0, width, height);

  const glow = ctx.createRadialGradient(
    width * 0.5,
    height * 0.48,
    height * 0.05,
    width * 0.5,
    height * 0.5,
    width * 0.58
  );
  if (isWinner) {
    glow.addColorStop(0, 'rgba(245, 158, 11, 0.22)');
    glow.addColorStop(1, 'rgba(14, 17, 23, 0)');
  } else {
    glow.addColorStop(0, 'rgba(30, 41, 59, 0.45)');
    glow.addColorStop(1, 'rgba(14, 17, 23, 0)');
  }
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, width, height);

  const pad = Math.round(48 * scale);
  ctx.strokeStyle = isWinner ? '#F59E0B' : '#262E3D';
  ctx.lineWidth = Math.max(2, Math.round((isWinner ? 4 : 2) * scale));
  ctx.strokeRect(pad, pad, width - pad * 2, height - pad * 2);

  const barWidth = Math.round(280 * scale);
  const barHeight = Math.round(8 * scale);
  ctx.fillStyle = parts.color;
  ctx.fillRect((width - barWidth) / 2, pad + Math.round(52 * scale), barWidth, barHeight);

  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  ctx.fillStyle = isWinner ? '#FBBF24' : '#94A3B8';
  ctx.font = `600 ${Math.round(32 * scale)}px "Outfit", "Manrope", "Segoe UI", sans-serif`;
  ctx.fillText(
    isWinner ? 'Победитель розыгрыша' : titleText,
    width / 2,
    pad + Math.round(108 * scale)
  );

  if (seat.row !== null && seat.seat !== null) {
    ctx.fillStyle = '#CBD5E1';
    ctx.font = `700 ${Math.round(92 * scale)}px "Outfit", "Manrope", "Segoe UI", sans-serif`;
    ctx.fillText(`Ряд ${seat.row}`, width / 2, height * 0.41);

    ctx.fillStyle = '#262E3D';
    ctx.fillRect(width / 2 - Math.round(180 * scale), height * 0.505, Math.round(360 * scale), Math.max(2, Math.round(2 * scale)));

    ctx.fillStyle = isWinner ? '#FBBF24' : '#F8FAFC';
    ctx.font = `800 ${Math.round(188 * scale)}px "JetBrains Mono", "Outfit", monospace`;
    ctx.fillText(`Место ${seat.seat}`, width / 2, height * 0.64);
  } else {
    ctx.fillStyle = isWinner ? '#FBBF24' : '#F8FAFC';
    const fontSize = parts.singleLine.length > 18 ? 84 : 124;
    ctx.font = `800 ${Math.round(fontSize * scale)}px "Outfit", "Manrope", "Segoe UI", sans-serif`;
    ctx.fillText(parts.singleLine, width / 2, height * 0.52, width - pad * 4);
  }

  if (showSector && parts.sectorText) {
    ctx.fillStyle = '#94A3B8';
    ctx.font = `500 ${Math.round(34 * scale)}px "Manrope", "Segoe UI", sans-serif`;
    ctx.fillText(parts.sectorText, width / 2, height - pad - Math.round(74 * scale));
  }

  if (showFrameCounter) {
    ctx.textAlign = 'right';
    ctx.fillStyle = '#64748B';
    ctx.font = `500 ${Math.round(24 * scale)}px "JetBrains Mono", monospace`;
    const numStr = String(frameIndex + 1).padStart(4, '0');
    const totStr = String(totalFrames).padStart(4, '0');
    ctx.fillText(`${numStr} / ${totStr}`, width - pad - Math.round(28 * scale), height - pad - Math.round(34 * scale));
  }
}

export function renderSeatFrame(ctx, width, height, frameSpec, frameIndex, totalFrames, options = {}) {
  if (options.isAlphaMode) {
    renderAlphaSeatFrame(ctx, width, height, frameSpec, options);
  } else {
    renderClassicSeatFrame(ctx, width, height, frameSpec, frameIndex, totalFrames, options);
  }
}
