/**
 * Контейнерный мультиплексор ISO BMFF (.mp4) и кодировщик H.264 через WebCodecs VideoEncoder.
 * Написан полностью с нуля, без внешних зависимостей.
 * Фиксированная частота кадров: 25 кадров/сек (1 место = 1 кадр).
 */

function writeU16BE(buf, off, val) {
  buf[off] = (val >>> 8) & 0xff;
  buf[off + 1] = val & 0xff;
}

function writeU32BE(buf, off, val) {
  buf[off] = (val >>> 24) & 0xff;
  buf[off + 1] = (val >>> 16) & 0xff;
  buf[off + 2] = (val >>> 8) & 0xff;
  buf[off + 3] = val & 0xff;
}

function asciiBytes(str) {
  const arr = new Uint8Array(str.length);
  for (let i = 0; i < str.length; i++) arr[i] = str.charCodeAt(i) & 0xff;
  return arr;
}

function concatBytes(parts) {
  let total = 0;
  for (const p of parts) total += p.length;
  const out = new Uint8Array(total);
  let off = 0;
  for (const p of parts) {
    out.set(p, off);
    off += p.length;
  }
  return out;
}

function makeBox(type, ...payloads) {
  const body = payloads.length === 1 ? payloads[0] : concatBytes(payloads);
  const out = new Uint8Array(8 + body.length);
  writeU32BE(out, 0, out.length);
  out.set(asciiBytes(type), 4);
  out.set(body, 8);
  return out;
}

function makeFullBox(type, version, flags, ...payloads) {
  const header = new Uint8Array(4);
  header[0] = version & 0xff;
  header[1] = (flags >>> 16) & 0xff;
  header[2] = (flags >>> 8) & 0xff;
  header[3] = flags & 0xff;
  return makeBox(type, header, ...payloads);
}

// Разбор Annex-B NAL-единиц (если энкодер вернул Annex-B вместо AVCC)
function parseAnnexBNals(data) {
  const nals = [];
  let i = 0;
  const len = data.length;

  function findStartCode(from) {
    for (let k = from; k + 2 < len; k++) {
      if (data[k] === 0 && data[k + 1] === 0) {
        if (data[k + 2] === 1) return { pos: k, size: 3 };
        if (k + 3 < len && data[k + 2] === 0 && data[k + 3] === 1) return { pos: k, size: 4 };
      }
    }
    return null;
  }

  let cur = findStartCode(0);
  while (cur) {
    const nalStart = cur.pos + cur.size;
    const next = findStartCode(nalStart);
    const nalEnd = next ? next.pos : len;
    if (nalEnd > nalStart) {
      nals.push(data.subarray(nalStart, nalEnd));
    }
    cur = next;
  }
  return nals;
}

function buildAvcCFromSpsPps(sps, pps) {
  const out = new Uint8Array(11 + sps.length + pps.length);
  out[0] = 1; // configurationVersion
  out[1] = sps[1] ?? 0x42; // AVCProfileIndication
  out[2] = sps[2] ?? 0x00; // profile_compatibility
  out[3] = sps[3] ?? 0x1f; // AVCLevelIndication
  out[4] = 0xff; // lengthSizeMinusOne = 3 (4 байта длины)
  out[5] = 0xe1; // numOfSequenceParameterSets = 1
  writeU16BE(out, 6, sps.length);
  out.set(sps, 8);
  const pOff = 8 + sps.length;
  out[pOff] = 1; // numOfPictureParameterSets = 1
  writeU16BE(out, pOff + 1, pps.length);
  out.set(pps, pOff + 3);
  return out;
}

export class Mp4Muxer {
  constructor({ width, height, fps = 25 }) {
    this.width = width;
    this.height = height;
    this.fps = fps;
    this.timescale = 90000;
    this.sampleDelta = Math.round(this.timescale / fps); // 3600 для 25 к/с
    this.samples = [];
    this.avcC = null;
  }

  setAvcDescription(desc) {
    if (desc && desc.byteLength > 0) {
      this.avcC = new Uint8Array(desc);
    }
  }

  addSample(rawBytes, isKey) {
    let data = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);

    // Если нет avcC или поток пришёл в Annex-B — преобразуем в AVCC
    const looksLikeAnnexB =
      data.length >= 4 &&
      data[0] === 0 &&
      data[1] === 0 &&
      (data[2] === 1 || (data[2] === 0 && data[3] === 1));

    if (looksLikeAnnexB) {
      const nals = parseAnnexBNals(data);
      let sps = null;
      let pps = null;
      const avccParts = [];
      for (const nal of nals) {
        const nalType = nal[0] & 0x1f;
        if (nalType === 7 && !sps) sps = nal;
        if (nalType === 8 && !pps) pps = nal;
        const lenBuf = new Uint8Array(4);
        writeU32BE(lenBuf, 0, nal.length);
        avccParts.push(lenBuf, nal);
      }
      if (!this.avcC && sps && pps) {
        this.avcC = buildAvcCFromSpsPps(sps, pps);
      }
      data = concatBytes(avccParts);
    }

    this.samples.push({ data, isKey });
  }

  build() {
    if (this.samples.length === 0) {
      throw new Error('Нет закодированных кадров для сборки MP4');
    }
    if (!this.avcC) {
      // Резервный минимальный avcC, если энкодер не передал description
      this.avcC = new Uint8Array([1, 0x42, 0xc0, 0x28, 0xff, 0xe1, 0, 0, 1, 0, 0]);
    }

    const sampleCount = this.samples.length;
    const totalTrackDuration = sampleCount * this.sampleDelta;
    const movieTimescale = 1000;
    const movieDuration = Math.round((sampleCount * movieTimescale) / this.fps);

    // 1. ftyp
    const ftypBody = concatBytes([
      asciiBytes('isom'),
      new Uint8Array([0, 0, 2, 0]),
      asciiBytes('isomiso2avc1mp41'),
    ]);
    const ftyp = makeBox('ftyp', ftypBody);

    // 2. mvhd (version 0, 96 bytes payload)
    const mvhdBody = new Uint8Array(96);
    writeU32BE(mvhdBody, 8, movieTimescale);
    writeU32BE(mvhdBody, 12, movieDuration);
    writeU32BE(mvhdBody, 16, 0x00010000); // rate 1.0
    writeU16BE(mvhdBody, 20, 0x0100); // volume 1.0
    // identity matrix
    writeU32BE(mvhdBody, 32, 0x00010000);
    writeU32BE(mvhdBody, 48, 0x00010000);
    writeU32BE(mvhdBody, 64, 0x40000000);
    writeU32BE(mvhdBody, 92, 2); // next_track_ID
    const mvhd = makeFullBox('mvhd', 0, 0, mvhdBody);

    // 3. tkhd (version 0, flags = 3: enabled + in movie, 80 bytes payload)
    const tkhdBody = new Uint8Array(80);
    writeU32BE(tkhdBody, 8, 1); // track_ID
    writeU32BE(tkhdBody, 16, movieDuration);
    writeU32BE(tkhdBody, 36, 0x00010000);
    writeU32BE(tkhdBody, 52, 0x00010000);
    writeU32BE(tkhdBody, 68, 0x40000000);
    writeU32BE(tkhdBody, 72, this.width << 16);
    writeU32BE(tkhdBody, 76, this.height << 16);
    const tkhd = makeFullBox('tkhd', 0, 3, tkhdBody);

    // 4. mdhd (20 bytes payload)
    const mdhdBody = new Uint8Array(20);
    writeU32BE(mdhdBody, 8, this.timescale);
    writeU32BE(mdhdBody, 12, totalTrackDuration);
    writeU16BE(mdhdBody, 16, 0x55c4); // und
    const mdhd = makeFullBox('mdhd', 0, 0, mdhdBody);

    // 5. hdlr
    const hdlrBody = concatBytes([
      new Uint8Array(4),
      asciiBytes('vide'),
      new Uint8Array(12),
      asciiBytes('VideoHandler\0'),
    ]);
    const hdlr = makeFullBox('hdlr', 0, 0, hdlrBody);

    // 6. vmhd (flags = 1)
    const vmhd = makeFullBox('vmhd', 0, 1, new Uint8Array(8));

    // 7. dinf -> dref -> url
    const urlBox = makeFullBox('url ', 0, 1);
    const drefCount = new Uint8Array(4);
    writeU32BE(drefCount, 0, 1);
    const dref = makeFullBox('dref', 0, 0, drefCount, urlBox);
    const dinf = makeBox('dinf', dref);

    // 8. stsd -> avc1 -> avcC
    const avcCBox = makeBox('avcC', this.avcC);
    const avc1Header = new Uint8Array(78);
    writeU16BE(avc1Header, 6, 1); // data_reference_index
    writeU16BE(avc1Header, 24, this.width);
    writeU16BE(avc1Header, 26, this.height);
    writeU32BE(avc1Header, 28, 0x00480000); // 72 dpi
    writeU32BE(avc1Header, 32, 0x00480000); // 72 dpi
    writeU16BE(avc1Header, 40, 1); // frame_count
    writeU16BE(avc1Header, 74, 24); // depth
    writeU16BE(avc1Header, 76, 0xffff); // pre_defined = -1
    const avc1Box = makeBox('avc1', avc1Header, avcCBox);

    const stsdCount = new Uint8Array(4);
    writeU32BE(stsdCount, 0, 1);
    const stsd = makeFullBox('stsd', 0, 0, stsdCount, avc1Box);

    // 9. stts (все кадры имеют одинаковую длительность sampleDelta)
    const sttsBody = new Uint8Array(12);
    writeU32BE(sttsBody, 0, 1);
    writeU32BE(sttsBody, 4, sampleCount);
    writeU32BE(sttsBody, 8, this.sampleDelta);
    const stts = makeFullBox('stts', 0, 0, sttsBody);

    // 10. stss (индексы ключевых кадров, 1-based)
    const keyIndices = [];
    for (let i = 0; i < sampleCount; i++) {
      if (this.samples[i].isKey) keyIndices.push(i + 1);
    }
    let stss = new Uint8Array(0);
    if (keyIndices.length > 0 && keyIndices.length < sampleCount) {
      const stssBody = new Uint8Array(4 + keyIndices.length * 4);
      writeU32BE(stssBody, 0, keyIndices.length);
      for (let i = 0; i < keyIndices.length; i++) {
        writeU32BE(stssBody, 4 + i * 4, keyIndices[i]);
      }
      stss = makeFullBox('stss', 0, 0, stssBody);
    }

    // 11. stsc (по 1 кадру на чанк — идеально для точной паузы на каждом кадре)
    const stscBody = new Uint8Array(16);
    writeU32BE(stscBody, 0, 1);
    writeU32BE(stscBody, 4, 1);
    writeU32BE(stscBody, 8, 1);
    writeU32BE(stscBody, 12, 1);
    const stsc = makeFullBox('stsc', 0, 0, stscBody);

    // 12. stsz (размер каждого кадра)
    const stszBody = new Uint8Array(8 + sampleCount * 4);
    writeU32BE(stszBody, 0, 0);
    writeU32BE(stszBody, 4, sampleCount);
    for (let i = 0; i < sampleCount; i++) {
      writeU32BE(stszBody, 8 + i * 4, this.samples[i].data.length);
    }
    const stsz = makeFullBox('stsz', 0, 0, stszBody);

    // 13. stco (заглушка, заполним точными смещениями после расчёта размера moov)
    const stcoBody = new Uint8Array(4 + sampleCount * 4);
    writeU32BE(stcoBody, 0, sampleCount);
    const stcoPlaceholder = makeFullBox('stco', 0, 0, stcoBody);

    const stblStub = makeBox('stbl', stsd, stts, stss, stsc, stsz, stcoPlaceholder);
    const minfStub = makeBox('minf', vmhd, dinf, stblStub);
    const mdiaStub = makeBox('mdia', mdhd, hdlr, minfStub);
    const trakStub = makeBox('trak', tkhd, mdiaStub);
    const moovStub = makeBox('moov', mvhd, trakStub);

    // Смещение начала полезных данных внутри mdat: ftyp + moov + 8 байт заголовка mdat
    let curOffset = ftyp.length + moovStub.length + 8;
    for (let i = 0; i < sampleCount; i++) {
      writeU32BE(stcoBody, 4 + i * 4, curOffset);
      curOffset += this.samples[i].data.length;
    }

    const stco = makeFullBox('stco', 0, 0, stcoBody);
    const stbl = makeBox('stbl', stsd, stts, stss, stsc, stsz, stco);
    const minf = makeBox('minf', vmhd, dinf, stbl);
    const mdia = makeBox('mdia', mdhd, hdlr, minf);
    const trak = makeBox('trak', tkhd, mdia);
    const moov = makeBox('moov', mvhd, trak);

    // 14. mdat
    let mdatPayloadSize = 0;
    for (const s of this.samples) mdatPayloadSize += s.data.length;
    const mdatHeader = new Uint8Array(8);
    writeU32BE(mdatHeader, 0, 8 + mdatPayloadSize);
    mdatHeader.set(asciiBytes('mdat'), 4);

    const totalFileSize = ftyp.length + moov.length + 8 + mdatPayloadSize;
    const file = new Uint8Array(totalFileSize);
    let p = 0;
    file.set(ftyp, p); p += ftyp.length;
    file.set(moov, p); p += moov.length;
    file.set(mdatHeader, p); p += 8;
    for (const s of this.samples) {
      file.set(s.data, p);
      p += s.data.length;
    }

    return file;
  }
}

export function isWebCodecsSupported() {
  return typeof VideoEncoder !== 'undefined' && typeof VideoFrame !== 'undefined';
}

/**
 * Кодирует последовательность мест в MP4 (H.264, ровно 25 к/с, 1 место = 1 кадр).
 */
export async function encodeFramesToMp4({
  frames,
  width,
  height,
  fps = 25,
  renderFrameFn,
  onProgress,
  signal,
}) {
  if (!isWebCodecsSupported()) {
    throw new Error('Браузер не поддерживает WebCodecs VideoEncoder. Используйте экспорт PNG-секвенции (.zip) или откройте в Chrome/Edge.');
  }

  const codecsToTry = [
    'avc1.640028', // High Profile L4.0 (отлично для 1080p)
    'avc1.4d002a', // Main Profile L4.2
    'avc1.42001f', // Baseline L3.1
  ];

  let selectedCodec = null;
  for (const codec of codecsToTry) {
    try {
      const support = await VideoEncoder.isConfigSupported({
        codec,
        width,
        height,
        bitrate: width >= 1920 ? 6_000_000 : 3_500_000,
        framerate: fps,
        avc: { format: 'avc' },
      });
      if (support.supported) {
        selectedCodec = codec;
        break;
      }
    } catch {
      // пробуем следующий профиль
    }
  }

  if (!selectedCodec) {
    throw new Error('Аппаратный или программный кодек H.264 недоступен в этом браузере. Используйте экспорт PNG-секвенции (.zip).');
  }

  const muxer = new Mp4Muxer({ width, height, fps });
  let encoderError = null;

  const encoder = new VideoEncoder({
    output: (chunk, metadata) => {
      if (metadata?.decoderConfig?.description) {
        muxer.setAvcDescription(metadata.decoderConfig.description);
      }
      const data = new Uint8Array(chunk.byteLength);
      chunk.copyTo(data);
      muxer.addSample(data, chunk.type === 'key');
    },
    error: (err) => {
      encoderError = err;
    },
  });

  encoder.configure({
    codec: selectedCodec,
    width,
    height,
    bitrate: width >= 1920 ? 6_000_000 : 3_500_000,
    framerate: fps,
    avc: { format: 'avc' },
  });

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { alpha: false });

  const frameDurationUs = Math.round(1_000_000 / fps); // 40 000 мкс для 25 к/с

  try {
    for (let i = 0; i < frames.length; i++) {
      if (signal?.aborted) {
        throw new DOMException('Экспорт отменён', 'AbortError');
      }
      if (encoderError) throw encoderError;

      renderFrameFn(ctx, width, height, frames[i], i, frames.length);

      const frame = new VideoFrame(canvas, {
        timestamp: i * frameDurationUs,
        duration: frameDurationUs,
      });

      // Ключевой кадр каждые 10 кадров (0.4 сек) для мгновенной чёткой паузы и перемотки
      const isKey = i % 10 === 0;
      encoder.encode(frame, { keyFrame: isKey });
      frame.close();

      if (encoder.encodeQueueSize > 8) {
        await encoder.flush();
      }

      if (onProgress && (i % 5 === 0 || i === frames.length - 1)) {
        onProgress(i + 1, frames.length);
      }

      // Даём браузеру дышать каждые 15 кадров, чтобы UI оставался отзывчивым
      if (i % 15 === 0) {
        await new Promise((r) => setTimeout(r, 0));
      }
    }

    await encoder.flush();
    if (encoderError) throw encoderError;
  } finally {
    if (encoder.state !== 'closed') {
      encoder.close();
    }
  }

  return muxer.build();
}
