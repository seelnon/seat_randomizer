/**
 * Парсер файлов .xlsx, .xls (BIFF8 OLE2, XML Spreadsheet 2003, HTML-таблицы)
 * и .csv / .txt — полностью с нуля без внешних библиотек.
 */

import { createSeat } from '../core/seats-data.js';
import { buildZip } from '../export/zip-writer.js';

// ============================================================================
// 1. Декомпрессия deflate-raw (нативный DecompressionStream + резервный JS Inflate)
// ============================================================================

async function inflateRaw(compressed) {
  if (typeof DecompressionStream !== 'undefined') {
    try {
      const ds = new DecompressionStream('deflate-raw');
      const writer = ds.writable.getWriter();
      writer.write(compressed);
      writer.close();
      const buf = await new Response(ds.readable).arrayBuffer();
      return new Uint8Array(buf);
    } catch {
      // Переходим на встроенный JS Inflate
    }
  }
  return inflateRawJs(compressed);
}

function inflateRawJs(src) {
  let pos = 0;
  let bitBuf = 0;
  let bitCnt = 0;
  const out = [];

  function readBits(n) {
    while (bitCnt < n) {
      if (pos >= src.length) throw new Error('Неожиданный конец deflate-потока');
      bitBuf |= src[pos++] << bitCnt;
      bitCnt += 8;
    }
    const val = bitBuf & ((1 << n) - 1);
    bitBuf >>>= n;
    bitCnt -= n;
    return val;
  }

  function buildHuff(lengths) {
    const maxLen = Math.max(0, ...lengths);
    const blCount = new Int32Array(maxLen + 1);
    for (const l of lengths) if (l > 0) blCount[l]++;
    const nextCode = new Int32Array(maxLen + 1);
    let code = 0;
    for (let bits = 1; bits <= maxLen; bits++) {
      code = (code + blCount[bits - 1]) << 1;
      nextCode[bits] = code;
    }
    const map = new Map();
    for (let n = 0; n < lengths.length; n++) {
      const len = lengths[n];
      if (len !== 0) {
        const c = nextCode[len]++;
        map.set((len << 16) | c, n);
      }
    }
    return { map, maxLen };
  }

  function decodeSym(huff) {
    let code = 0;
    for (let len = 1; len <= huff.maxLen; len++) {
      code = (code << 1) | readBits(1);
      const sym = huff.map.get((len << 16) | code);
      if (sym !== undefined) return sym;
    }
    throw new Error('Ошибка декодирования Хаффмана');
  }

  const LEN_BASE = [3, 4, 5, 6, 7, 8, 9, 10, 11, 13, 15, 17, 19, 23, 27, 31, 35, 43, 51, 59, 67, 83, 99, 115, 131, 163, 195, 227, 258];
  const LEN_EXTRA = [0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4, 5, 5, 5, 5, 0];
  const DIST_BASE = [1, 2, 3, 4, 5, 7, 9, 13, 17, 25, 33, 49, 65, 97, 129, 193, 257, 385, 513, 769, 1025, 1537, 2049, 3073, 4097, 6145, 8193, 12289, 16385, 24577];
  const DIST_EXTRA = [0, 0, 0, 0, 1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8, 8, 9, 9, 10, 10, 11, 11, 12, 12, 13, 13];
  const CL_ORDER = [16, 17, 18, 0, 8, 7, 9, 6, 10, 5, 11, 4, 12, 3, 13, 2, 14, 1, 15];

  const FIXED_LIT = (() => {
    const lens = new Array(288);
    for (let i = 0; i <= 143; i++) lens[i] = 8;
    for (let i = 144; i <= 255; i++) lens[i] = 9;
    for (let i = 256; i <= 279; i++) lens[i] = 7;
    for (let i = 280; i <= 287; i++) lens[i] = 8;
    return buildHuff(lens);
  })();
  const FIXED_DIST = buildHuff(new Array(32).fill(5));

  let bfinal = 0;
  do {
    bfinal = readBits(1);
    const btype = readBits(2);

    if (btype === 0) {
      bitBuf = 0;
      bitCnt = 0;
      const len = src[pos] | (src[pos + 1] << 8);
      pos += 4;
      for (let i = 0; i < len; i++) out.push(src[pos++]);
    } else if (btype === 1 || btype === 2) {
      let litHuff = FIXED_LIT;
      let distHuff = FIXED_DIST;

      if (btype === 2) {
        const hlit = readBits(5) + 257;
        const hdist = readBits(5) + 1;
        const hclen = readBits(4) + 4;
        const clLens = new Array(19).fill(0);
        for (let i = 0; i < hclen; i++) clLens[CL_ORDER[i]] = readBits(3);
        const clHuff = buildHuff(clLens);

        const allLens = [];
        while (allLens.length < hlit + hdist) {
          const sym = decodeSym(clHuff);
          if (sym < 16) {
            allLens.push(sym);
          } else if (sym === 16) {
            const rep = 3 + readBits(2);
            const prev = allLens[allLens.length - 1] || 0;
            for (let r = 0; r < rep; r++) allLens.push(prev);
          } else if (sym === 17) {
            const rep = 3 + readBits(3);
            for (let r = 0; r < rep; r++) allLens.push(0);
          } else {
            const rep = 11 + readBits(7);
            for (let r = 0; r < rep; r++) allLens.push(0);
          }
        }
        litHuff = buildHuff(allLens.slice(0, hlit));
        distHuff = buildHuff(allLens.slice(hlit));
      }

      while (true) {
        const sym = decodeSym(litHuff);
        if (sym < 256) {
          out.push(sym);
        } else if (sym === 256) {
          break;
        } else {
          const lIdx = sym - 257;
          const length = LEN_BASE[lIdx] + readBits(LEN_EXTRA[lIdx]);
          const dIdx = decodeSym(distHuff);
          const dist = DIST_BASE[dIdx] + readBits(DIST_EXTRA[dIdx]);
          for (let k = 0; k < length; k++) {
            out.push(out[out.length - dist]);
          }
        }
      }
    } else {
      throw new Error('Некорректный блок deflate');
    }
  } while (!bfinal);

  return new Uint8Array(out);
}

// ============================================================================
// 2. ZIP-читатель и парсер .XLSX
// ============================================================================

async function unzipEntries(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  // Поиск End of Central Directory (0x06054b50) с конца файла
  let eocdOffset = -1;
  const minPos = Math.max(0, bytes.length - 65557);
  for (let i = bytes.length - 22; i >= minPos; i--) {
    if (view.getUint32(i, true) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) {
    throw new Error('Файл не является корректным ZIP/XLSX-архивом');
  }

  const totalEntries = view.getUint16(eocdOffset + 10, true);
  const cdOffset = view.getUint32(eocdOffset + 16, true);

  const entries = new Map();
  let ptr = cdOffset;
  const dec = new TextDecoder('utf-8');

  for (let i = 0; i < totalEntries; i++) {
    if (view.getUint32(ptr, true) !== 0x02014b50) break;
    const method = view.getUint16(ptr + 10, true);
    const compSize = view.getUint32(ptr + 20, true);
    const nameLen = view.getUint16(ptr + 28, true);
    const extraLen = view.getUint16(ptr + 30, true);
    const commentLen = view.getUint16(ptr + 32, true);
    const localHeaderOffset = view.getUint32(ptr + 42, true);
    const name = dec.decode(bytes.subarray(ptr + 46, ptr + 46 + nameLen));
    ptr += 46 + nameLen + extraLen + commentLen;

    if (name.endsWith('/')) continue;

    const lNameLen = view.getUint16(localHeaderOffset + 26, true);
    const lExtraLen = view.getUint16(localHeaderOffset + 28, true);
    const dataStart = localHeaderOffset + 30 + lNameLen + lExtraLen;
    const slice = bytes.subarray(dataStart, dataStart + compSize);

    entries.set(name, { method, slice });
  }

  async function getEntryText(name) {
    const entry = entries.get(name);
    if (!entry) return null;
    const raw = entry.method === 0 ? entry.slice : await inflateRaw(entry.slice);
    return dec.decode(raw);
  }

  return { entries, getEntryText };
}

function colRefToIndex(ref) {
  const letters = ref.replace(/[0-9]/g, '');
  let idx = 0;
  for (let i = 0; i < letters.length; i++) {
    idx = idx * 26 + (letters.charCodeAt(i) - 64);
  }
  return idx - 1;
}

async function parseXlsx(buffer) {
  const zip = await unzipEntries(buffer);
  const parser = new DOMParser();

  // 1. Общие строки (sharedStrings)
  const sharedStrings = [];
  const ssXml = await zip.getEntryText('xl/sharedStrings.xml');
  if (ssXml) {
    const doc = parser.parseFromString(ssXml, 'application/xml');
    const siNodes = doc.getElementsByTagName('si');
    for (let i = 0; i < siNodes.length; i++) {
      const tNodes = siNodes[i].getElementsByTagName('t');
      let text = '';
      for (let j = 0; j < tNodes.length; j++) {
        // Пропускаем фонетические подсказки rPh, если они есть
        if (tNodes[j].parentNode && tNodes[j].parentNode.nodeName === 'rPh') continue;
        text += tNodes[j].textContent || '';
      }
      sharedStrings.push(text);
    }
  }

  // 2. Поиск пути к первому листу
  let sheetPath = 'xl/worksheets/sheet1.xml';
  const wbXml = await zip.getEntryText('xl/workbook.xml');
  const relsXml = await zip.getEntryText('xl/_rels/workbook.xml.rels');
  if (wbXml && relsXml) {
    const wbDoc = parser.parseFromString(wbXml, 'application/xml');
    const relsDoc = parser.parseFromString(relsXml, 'application/xml');
    const firstSheet = wbDoc.getElementsByTagName('sheet')[0];
    if (firstSheet) {
      const rId =
        firstSheet.getAttribute('r:id') ||
        firstSheet.getAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'id');
      if (rId) {
        const rels = relsDoc.getElementsByTagName('Relationship');
        for (let i = 0; i < rels.length; i++) {
          if (rels[i].getAttribute('Id') === rId) {
            const target = rels[i].getAttribute('Target') || '';
            sheetPath = target.startsWith('/') ? target.slice(1) : target.startsWith('xl/') ? target : `xl/${target}`;
            break;
          }
        }
      }
    }
  }

  if (!zip.entries.has(sheetPath)) {
    for (const key of zip.entries.keys()) {
      if (/^xl\/worksheets\/sheet\d+\.xml$/i.test(key)) {
        sheetPath = key;
        break;
      }
    }
  }

  const sheetXml = await zip.getEntryText(sheetPath);
  if (!sheetXml) {
    throw new Error('В файле XLSX не найден лист с данными');
  }

  const sheetDoc = parser.parseFromString(sheetXml, 'application/xml');
  const rowNodes = sheetDoc.getElementsByTagName('row');
  const grid = [];

  for (let r = 0; r < rowNodes.length; r++) {
    const rowEl = rowNodes[r];
    const cNodes = rowEl.getElementsByTagName('c');
    const rowArr = [];
    for (let c = 0; c < cNodes.length; c++) {
      const cell = cNodes[c];
      const ref = cell.getAttribute('r') || '';
      const colIdx = ref ? colRefToIndex(ref) : c;
      const type = cell.getAttribute('t') || 'n';

      let val = '';
      if (type === 'inlineStr') {
        const tNodes = cell.getElementsByTagName('t');
        for (let k = 0; k < tNodes.length; k++) val += tNodes[k].textContent || '';
      } else {
        const vNode = cell.getElementsByTagName('v')[0];
        if (vNode) {
          const raw = vNode.textContent || '';
          if (type === 's') {
            val = sharedStrings[Number(raw)] ?? '';
          } else if (type === 'b') {
            val = raw === '1' ? 'Да' : 'Нет';
          } else {
            val = raw;
          }
        }
      }
      rowArr[colIdx] = String(val).trim();
    }
    if (rowArr.some((x) => x !== undefined && x !== '')) {
      grid.push(rowArr.map((x) => x ?? ''));
    }
  }

  return grid;
}

// ============================================================================
// 3. Парсер .XLS (OLE2/CFBF BIFF8 + HTML/XML Spreadsheet 2003)
// ============================================================================

function decodeRkNumber(rk) {
  const isInt = (rk & 2) !== 0;
  const div100 = (rk & 1) !== 0;
  let val;
  if (isInt) {
    val = rk >> 2;
  } else {
    const buf = new ArrayBuffer(8);
    const dv = new DataView(buf);
    dv.setUint32(4, rk & 0xfffffffc, true);
    dv.setUint32(0, 0, true);
    val = dv.getFloat64(0, true);
  }
  return div100 ? val / 100 : val;
}

function readOle2WorkbookStream(buffer) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);

  const sectorShift = view.getUint16(30, true);
  const sectorSize = 1 << sectorShift;
  const miniSectorShift = view.getUint16(32, true);
  const miniSectorSize = 1 << miniSectorShift;
  const firstDirSector = view.getUint32(48, true);
  const miniCutoff = view.getUint32(56, true);
  const firstMiniFatSector = view.getUint32(60, true);
  const difatCount = view.getUint32(72, true);
  const firstDifatSector = view.getUint32(68, true);

  function sectorOffset(sec) {
    return (sec + 1) * sectorSize;
  }

  // Собираем сектора FAT из заголовка (до 109) + DIFAT цепочки
  const fatSectors = [];
  for (let i = 0; i < 109; i++) {
    const s = view.getUint32(76 + i * 4, true);
    if (s < 0xfffffffa) fatSectors.push(s);
  }
  let difatSec = firstDifatSector;
  for (let d = 0; d < difatCount && difatSec < 0xfffffffa; d++) {
    const off = sectorOffset(difatSec);
    const perSec = sectorSize / 4 - 1;
    for (let i = 0; i < perSec; i++) {
      const s = view.getUint32(off + i * 4, true);
      if (s < 0xfffffffa) fatSectors.push(s);
    }
    difatSec = view.getUint32(off + perSec * 4, true);
  }

  const fat = [];
  for (const fs of fatSectors) {
    const off = sectorOffset(fs);
    for (let i = 0; i < sectorSize / 4; i++) {
      fat.push(view.getUint32(off + i * 4, true));
    }
  }

  function readChain(startSec, maxLen = Infinity) {
    const chunks = [];
    let sec = startSec;
    let total = 0;
    const seen = new Set();
    while (sec < 0xfffffffa && total < maxLen && !seen.has(sec)) {
      seen.add(sec);
      const off = sectorOffset(sec);
      const take = Math.min(sectorSize, maxLen - total);
      chunks.push(bytes.subarray(off, off + take));
      total += take;
      sec = fat[sec] ?? 0xfffffffe;
    }
    const out = new Uint8Array(total);
    let p = 0;
    for (const c of chunks) {
      out.set(c, p);
      p += c.length;
    }
    return out;
  }

  const dirData = readChain(firstDirSector);
  const dirView = new DataView(dirData.buffer);
  const utf16 = new TextDecoder('utf-16le');

  let rootStart = 0;
  let rootSize = 0;
  let wbEntry = null;

  for (let off = 0; off + 128 <= dirData.length; off += 128) {
    const nameLen = dirView.getUint16(off + 64, true);
    if (nameLen < 2 || nameLen > 64) continue;
    const name = utf16.decode(dirData.subarray(off, off + nameLen - 2));
    const type = dirData[off + 66];
    const startSec = dirView.getUint32(off + 116, true);
    const size = dirView.getUint32(off + 120, true);

    if (type === 5) {
      rootStart = startSec;
      rootSize = size;
    } else if (type === 2 && (name.toLowerCase() === 'workbook' || name.toLowerCase() === 'book')) {
      wbEntry = { startSec, size };
    }
  }

  if (!wbEntry) {
    throw new Error('В файле XLS не найден поток Workbook');
  }

  if (wbEntry.size >= miniCutoff) {
    return readChain(wbEntry.startSec, wbEntry.size);
  }

  // Поток внутри MiniFAT
  const miniStream = readChain(rootStart, rootSize);
  const miniFatData = readChain(firstMiniFatSector);
  const miniFatView = new DataView(miniFatData.buffer);
  const out = new Uint8Array(wbEntry.size);
  let sec = wbEntry.startSec;
  let pos = 0;
  while (sec < 0xfffffffa && pos < wbEntry.size) {
    const mOff = sec * miniSectorSize;
    const take = Math.min(miniSectorSize, wbEntry.size - pos);
    out.set(miniStream.subarray(mOff, mOff + take), pos);
    pos += take;
    sec = miniFatView.getUint32(sec * 4, true);
  }
  return out;
}

function parseBiffWorkbook(stream) {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  let codepage = 1251;
  let pos = 0;

  // Разбираем последовательность записей BIFF
  const records = [];
  while (pos + 4 <= stream.length) {
    const id = view.getUint16(pos, true);
    const len = view.getUint16(pos + 2, true);
    pos += 4;
    if (pos + len > stream.length) break;
    records.push({ id, data: stream.subarray(pos, pos + len) });
    pos += len;
  }

  function decodeCodepage(bytes) {
    const encName = codepage === 1251 ? 'windows-1251' : codepage === 65001 ? 'utf-8' : 'windows-1251';
    try {
      return new TextDecoder(encName).decode(bytes);
    } catch {
      return new TextDecoder('utf-8').decode(bytes);
    }
  }

  // Читаем SST (Shared String Table) с поддержкой CONTINUE (0x003C)
  const sst = [];
  for (let i = 0; i < records.length; i++) {
    const rec = records[i];
    if (rec.id === 0x0042 && rec.data.length >= 2) {
      codepage = new DataView(rec.data.buffer, rec.data.byteOffset, 2).getUint16(0, true);
    } else if (rec.id === 0x00fc) {
      // Собираем SST + прилегающие CONTINUE чанки
      const chunks = [rec.data];
      let j = i + 1;
      while (j < records.length && records[j].id === 0x003c) {
        chunks.push(records[j].data);
        j++;
      }

      let chunkIdx = 0;
      let chunkPos = 8; // пропускаем cstTotal (4) + cstUnique (4)
      const dv0 = new DataView(chunks[0].buffer, chunks[0].byteOffset, chunks[0].byteLength);
      const uniqueCount = dv0.getUint32(4, true);

      function ensureBytes(n) {
        if (chunkPos + n <= chunks[chunkIdx].length) return true;
        return false;
      }

      function readU8() {
        while (chunkPos >= chunks[chunkIdx].length) {
          chunkIdx++;
          chunkPos = 0;
        }
        return chunks[chunkIdx][chunkPos++];
      }

      function readU16() {
        const b0 = readU8();
        const b1 = readU8();
        return b0 | (b1 << 8);
      }

      function readU32() {
        const l = readU16();
        const h = readU16();
        return (l | (h << 16)) >>> 0;
      }

      function readBytes(count) {
        const buf = new Uint8Array(count);
        let written = 0;
        while (written < count) {
          if (chunkPos >= chunks[chunkIdx].length) {
            chunkIdx++;
            chunkPos = 0;
          }
          const avail = Math.min(count - written, chunks[chunkIdx].length - chunkPos);
          buf.set(chunks[chunkIdx].subarray(chunkPos, chunkPos + avail), written);
          chunkPos += avail;
          written += avail;
        }
        return buf;
      }

      function readSstString() {
        const charCount = readU16();
        let flags = readU8();
        let highByte = (flags & 1) !== 0;
        const hasExt = (flags & 4) !== 0;
        const hasRich = (flags & 8) !== 0;
        const rtRuns = hasRich ? readU16() : 0;
        const extLen = hasExt ? readU32() : 0;

        let str = '';
        let rem = charCount;
        while (rem > 0) {
          if (chunkPos >= chunks[chunkIdx].length) {
            chunkIdx++;
            chunkPos = 0;
            // На границе CONTINUE первый байт — новый флаг сжатия строки
            const contFlag = chunks[chunkIdx][chunkPos++];
            highByte = (contFlag & 1) !== 0;
          }
          const bytesLeft = chunks[chunkIdx].length - chunkPos;
          const charsAvail = highByte ? Math.floor(bytesLeft / 2) : bytesLeft;
          const takeChars = Math.min(rem, charsAvail);
          if (takeChars === 0) {
            chunkIdx++;
            chunkPos = 0;
            continue;
          }
          const byteCount = highByte ? takeChars * 2 : takeChars;
          const slice = chunks[chunkIdx].subarray(chunkPos, chunkPos + byteCount);
          chunkPos += byteCount;
          if (highByte) {
            str += new TextDecoder('utf-16le').decode(slice);
          } else {
            // Однобайтовый BIFF8 = ISO-8859-1 (Latin-1)
            let part = '';
            for (let k = 0; k < slice.length; k++) part += String.fromCharCode(slice[k]);
            str += part;
          }
          rem -= takeChars;
        }

        if (rtRuns > 0) readBytes(rtRuns * 4);
        if (extLen > 0) readBytes(extLen);
        return str;
      }

      for (let s = 0; s < uniqueCount && chunkIdx < chunks.length; s++) {
        try {
          if (!ensureBytes(0) && chunkIdx + 1 >= chunks.length) break;
          sst.push(readSstString());
        } catch {
          break;
        }
      }
      i = j - 1;
    }
  }

  // Читаем первый лист (первый BOF substream типа worksheet)
  const cells = new Map();
  let inSheet = false;
  let bofDepth = 0;
  let lastFormulaPos = null;

  for (const rec of records) {
    if (rec.id === 0x0809) {
      // BOF
      bofDepth++;
      if (bofDepth === 1 && rec.data.length >= 4) {
        const dt = new DataView(rec.data.buffer, rec.data.byteOffset, 4).getUint16(2, true);
        if (dt === 0x0010) {
          inSheet = true;
        }
      }
      continue;
    }
    if (rec.id === 0x000a) {
      // EOF
      if (inSheet && bofDepth === 1) break;
      bofDepth = Math.max(0, bofDepth - 1);
      continue;
    }
    if (!inSheet || bofDepth !== 1) continue;

    const dv = new DataView(rec.data.buffer, rec.data.byteOffset, rec.data.byteLength);

    if (rec.id === 0x00fd && rec.data.length >= 10) {
      // LABELSST
      const r = dv.getUint16(0, true);
      const c = dv.getUint16(2, true);
      const idx = dv.getUint32(6, true);
      cells.set(`${r}:${c}`, sst[idx] ?? '');
    } else if (rec.id === 0x0204 && rec.data.length >= 8) {
      // LABEL (BIFF5/8)
      const r = dv.getUint16(0, true);
      const c = dv.getUint16(2, true);
      const len = dv.getUint16(6, true);
      const val = decodeCodepage(rec.data.subarray(8, 8 + len));
      cells.set(`${r}:${c}`, val);
    } else if (rec.id === 0x0203 && rec.data.length >= 14) {
      // NUMBER
      const r = dv.getUint16(0, true);
      const c = dv.getUint16(2, true);
      const val = dv.getFloat64(6, true);
      cells.set(`${r}:${c}`, String(val));
    } else if (rec.id === 0x027e && rec.data.length >= 10) {
      // RK
      const r = dv.getUint16(0, true);
      const c = dv.getUint16(2, true);
      const val = decodeRkNumber(dv.getInt32(6, true));
      cells.set(`${r}:${c}`, String(val));
    } else if (rec.id === 0x00bd && rec.data.length >= 6) {
      // MULRK
      const r = dv.getUint16(0, true);
      const cFirst = dv.getUint16(2, true);
      const count = (rec.data.length - 6) / 6;
      for (let k = 0; k < count; k++) {
        const rk = dv.getInt32(4 + k * 6 + 2, true);
        cells.set(`${r}:${cFirst + k}`, String(decodeRkNumber(rk)));
      }
    } else if (rec.id === 0x0006 && rec.data.length >= 14) {
      // FORMULA
      const r = dv.getUint16(0, true);
      const c = dv.getUint16(2, true);
      const fByte6 = rec.data[12];
      const fByte7 = rec.data[13];
      if (fByte6 === 0xff && fByte7 === 0xff) {
        // Результат — строка (следующая запись STRING) или bool/err
        lastFormulaPos = `${r}:${c}`;
      } else {
        const num = dv.getFloat64(6, true);
        cells.set(`${r}:${c}`, String(num));
        lastFormulaPos = null;
      }
    } else if (rec.id === 0x0207 && lastFormulaPos && rec.data.length >= 3) {
      // STRING (результат FORMULA)
      const len = dv.getUint16(0, true);
      const flags = rec.data[2];
      const isUtf16 = (flags & 1) !== 0;
      const slice = rec.data.subarray(3, 3 + (isUtf16 ? len * 2 : len));
      const str = isUtf16
        ? new TextDecoder('utf-16le').decode(slice)
        : decodeCodepage(slice);
      cells.set(lastFormulaPos, str);
      lastFormulaPos = null;
    }
  }

  let maxRow = 0;
  let maxCol = 0;
  for (const key of cells.keys()) {
    const [r, c] = key.split(':').map(Number);
    if (r > maxRow) maxRow = r;
    if (c > maxCol) maxCol = c;
  }

  const grid = [];
  for (let r = 0; r <= maxRow; r++) {
    const row = [];
    let hasVal = false;
    for (let c = 0; c <= maxCol; c++) {
      const v = String(cells.get(`${r}:${c}`) ?? '').trim();
      if (v) hasVal = true;
      row.push(v);
    }
    if (hasVal) grid.push(row);
  }
  return grid;
}

function parseTextLikeTable(text) {
  const trimmed = text.trim();
  const parser = new DOMParser();

  // XML Spreadsheet 2003
  if (trimmed.startsWith('<?xml') && trimmed.includes('<Workbook')) {
    const doc = parser.parseFromString(trimmed, 'application/xml');
    const rows = doc.getElementsByTagName('Row');
    const grid = [];
    for (let r = 0; r < rows.length; r++) {
      const cells = rows[r].getElementsByTagName('Cell');
      const row = [];
      let colIdx = 0;
      for (let c = 0; c < cells.length; c++) {
        const idxAttr = cells[c].getAttribute('ss:Index') || cells[c].getAttribute('Index');
        if (idxAttr) colIdx = Number(idxAttr) - 1;
        const dataEl = cells[c].getElementsByTagName('Data')[0];
        row[colIdx] = (dataEl?.textContent || '').trim();
        colIdx++;
      }
      if (row.some(Boolean)) grid.push(row.map((x) => x ?? ''));
    }
    return grid;
  }

  // HTML-таблица, сохранённая как .xls (частый формат выгрузок 1С/CRM)
  if (/<table[\s>]/i.test(trimmed)) {
    const doc = parser.parseFromString(trimmed, 'text/html');
    const trs = doc.querySelectorAll('tr');
    const grid = [];
    trs.forEach((tr) => {
      const row = [];
      tr.querySelectorAll('th, td').forEach((td) => {
        row.push((td.textContent || '').trim());
      });
      if (row.some(Boolean)) grid.push(row);
    });
    return grid;
  }

  // CSV / TSV / TXT
  const lines = trimmed.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length === 0) return [];
  const sample = lines[0];
  const sep = sample.includes(';') ? ';' : sample.includes('\t') ? '\t' : ',';

  return lines.map((line) => {
    const row = [];
    let cur = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (ch === '"') {
        if (inQuotes && line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === sep && !inQuotes) {
        row.push(cur.trim());
        cur = '';
      } else {
        cur += ch;
      }
    }
    row.push(cur.trim());
    return row;
  });
}

function smartDecodeBytes(bytes) {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1251').decode(bytes);
  }
}

// ============================================================================
// 4. Универсальный вход для файлов и умное извлечение занятых мест
// ============================================================================

export async function parseSpreadsheetFile(file) {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  const name = (file.name || '').toLowerCase();

  let grid = [];
  // Сигнатура ZIP (PK\x03\x04)
  if (bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b && bytes[2] === 0x03 && bytes[3] === 0x04) {
    grid = await parseXlsx(buffer);
  } else if (
    bytes.length >= 8 &&
    bytes[0] === 0xd0 &&
    bytes[1] === 0xcf &&
    bytes[2] === 0x11 &&
    bytes[3] === 0xe0
  ) {
    // OLE2 BIFF8 (.xls)
    const wbStream = readOle2WorkbookStream(buffer);
    grid = parseBiffWorkbook(wbStream);
  } else if (name.endsWith('.xlsx')) {
    grid = await parseXlsx(buffer);
  } else {
    const text = smartDecodeBytes(bytes);
    grid = parseTextLikeTable(text);
  }

  return extractSeatsFromGrid(grid);
}

/**
 * Извлекает числовое значение из ячейки Место/Ряд.
 * Игнорирует слова «место», «ряд», «или ...», «*» и оставляет цифры.
 * Например: "Место 1 или 1" -> 1, "Ряд 1 или 1*" -> 1, "12" -> 12.
 * Если цифр нет (пусто или только текст) — возвращает null.
 */
function extractNumericSeatOrRow(cellText) {
  const s = String(cellText ?? '').trim();
  if (!s) return null;
  // Убираем слова «место», «ряд», сокращения «м.», «р.» и берём первое целое число
  const cleaned = s.replace(/(?:место|ряд|seat|row|м\.|р\.)/gi, ' ').trim();
  const match = cleaned.match(/\d+/);
  if (!match) return null;
  const num = parseInt(match[0], 10);
  return Number.isFinite(num) && num > 0 ? num : null;
}

function normalizeSectorLabel(rawSector) {
  const s = String(rawSector ?? '').trim();
  if (!s) return '';
  // Игнорируем примечания вроде "или просто А, В и т.д."
  if (/^или\s+/i.test(s)) return '';
  // Если указана просто буква ("A", "B", "А", "Б") — оформляем как "Сектор A"
  if (/^[A-Za-zА-Яа-яЁё0-9]{1,2}$/.test(s)) {
    return `Сектор ${s.toUpperCase()}`;
  }
  return s;
}

function parseCombinedSeatText(text) {
  const s = String(text).trim();
  if (!s) return null;

  // "Ряд 12, Место 5" / "р.12 м.5" / "Ряд 12 Место 5"
  const rusMatch = s.match(/(?:ряд|р\.?)\s*(\d+)\s*[,;:\-\s]+(?:место|м\.?)\s*(\d+)/i);
  if (rusMatch) {
    return { row: Number(rusMatch[1]), seat: Number(rusMatch[2]) };
  }
  // "12-5" / "12:5" / "12/5"
  const pairMatch = s.match(/^(\d{1,3})\s*[-:/;]\s*(\d{1,3})$/);
  if (pairMatch) {
    return { row: Number(pairMatch[1]), seat: Number(pairMatch[2]) };
  }
  return null;
}

export function extractSeatsFromGrid(grid) {
  if (!grid || grid.length === 0) {
    return { seats: [], skippedRows: 0, detectedMode: 'empty', rawRowCount: 0, warnings: ['Таблица пустая'] };
  }

  // Находим строку заголовков среди первых 10 строк таблицы
  let headerRowIdx = -1;
  let colorCol = -1;
  let sectorCol = -1;
  let rowCol = -1;
  let seatCol = -1;
  let lastNameCol = -1;
  let firstNameCol = -1;
  let companyCol = -1;
  let categoryCol = -1;

  const scanLimit = Math.min(10, grid.length);
  for (let hr = 0; hr < scanLimit; hr++) {
    const candidate = grid[hr].map((c) => String(c || '').toLowerCase().trim());
    const cCol = candidate.findIndex((c) => c.includes('цвет') || c.includes('color'));
    const sCol = candidate.findIndex(
      (c, idx) => idx !== cCol && (c.includes('сектор') || c.includes('зона') || c.includes('sector') || c.includes('zone'))
    );
    const rCol = candidate.findIndex((c) => c === 'ряд' || c === 'row' || c.includes('ряд'));
    const mCol = candidate.findIndex((c) => c === 'место' || c === 'seat' || c.includes('место'));
    const lnCol = candidate.findIndex((c) => c.includes('фамил'));
    const fnCol = candidate.findIndex((c) => c === 'имя' || c.includes('участ'));

    if (rCol !== -1 || mCol !== -1) {
      headerRowIdx = hr;
      colorCol = cCol;
      sectorCol = sCol;
      rowCol = rCol;
      seatCol = mCol;
      lastNameCol = lnCol;
      firstNameCol = fnCol;
      companyCol = candidate.findIndex((c) => c.includes('компан') || c.includes('орган'));
      categoryCol = candidate.findIndex((c) => c.includes('категор'));
      break;
    }

    if (headerRowIdx === -1 && (sCol !== -1 || cCol !== -1 || lnCol !== -1 || fnCol !== -1)) {
      headerRowIdx = hr;
      colorCol = cCol;
      sectorCol = sCol;
      lastNameCol = lnCol;
      firstNameCol = fnCol;
      companyCol = candidate.findIndex((c) => c.includes('компан') || c.includes('орган'));
      categoryCol = candidate.findIndex((c) => c.includes('категор'));
    }
  }

  const hasHeader = headerRowIdx !== -1;
  const startRow = hasHeader ? headerRowIdx + 1 : 0;

  // Если заголовка нет, проверяем, являются ли первые 2 колонки числами
  if (!hasHeader && grid[0].length >= 2) {
    const sample = grid[0];
    if (/^\d+$/.test(sample[0]) && /^\d+$/.test(sample[1])) {
      rowCol = 0;
      seatCol = 1;
    }
  }

  const seats = [];
  const warnings = [];
  let skippedRows = 0;
  let detectedMode = 'structured-row-seat';

  for (let r = startRow; r < grid.length; r++) {
    const row = grid[r];
    if (!row || row.every((c) => !String(c || '').trim())) continue;

    const rawColor = colorCol !== -1 ? String(row[colorCol] ?? '').trim() : '';
    const rawSector = sectorCol !== -1 ? normalizeSectorLabel(row[sectorCol]) : '';

    // Собираем необязательную заметку об участнике (ФИО / Компания / Категория)
    const noteParts = [];
    const fio = [
      lastNameCol !== -1 ? row[lastNameCol] : '',
      firstNameCol !== -1 ? row[firstNameCol] : '',
    ]
      .map((x) => String(x || '').trim())
      .filter(Boolean)
      .join(' ');
    if (fio) noteParts.push(fio);
    if (companyCol !== -1 && row[companyCol]) noteParts.push(String(row[companyCol]).trim());
    if (categoryCol !== -1 && row[categoryCol]) noteParts.push(String(row[categoryCol]).trim());
    const extraNote = noteParts.join(' · ');

    if (rowCol !== -1 && seatCol !== -1) {
      const rVal = extractNumericSeatOrRow(row[rowCol]);
      const sVal = extractNumericSeatOrRow(row[seatCol]);

      // Если место или ряд не указаны (нет цифр) — строку не добавляем!
      if (rVal === null || sVal === null) {
        skippedRows++;
        continue;
      }

      seats.push(
        createSeat({
          row: rVal,
          seat: sVal,
          sectorName: rawSector,
          colorName: rawColor,
          extra: extraNote,
          uniqueIndex: seats.length + 1,
        })
      );
      continue;
    }

    if (seatCol !== -1 && rowCol === -1) {
      const sVal = extractNumericSeatOrRow(row[seatCol]);
      if (sVal === null) {
        skippedRows++;
        continue;
      }
      detectedMode = 'seat-only';
      seats.push(
        createSeat({
          row: null,
          seat: sVal,
          sectorName: rawSector,
          colorName: rawColor,
          extra: extraNote,
          uniqueIndex: seats.length + 1,
        })
      );
      continue;
    }

    // Резерв для одноколоночных списков вида "Ряд 5, Место 12"
    const firstNonEmpty = row.find((c) => String(c || '').trim() !== '') || '';
    const parsed = parseCombinedSeatText(firstNonEmpty);
    if (parsed) {
      detectedMode = 'combined-text';
      seats.push(
        createSeat({
          row: parsed.row,
          seat: parsed.seat,
          sectorName: rawSector,
          colorName: rawColor,
          extra: extraNote,
          uniqueIndex: seats.length + 1,
        })
      );
    } else {
      skippedRows++;
    }
  }

  if (seats.length === 0) {
    warnings.push('Не найдено ни одной строки, где указаны и Место, и Ряд (цифрами).');
  }

  return {
    seats,
    skippedRows,
    detectedMode,
    rawRowCount: grid.length - startRow,
    warnings,
  };
}

// ============================================================================
// 5. Генератор примера .XLSX с нуля (без зависимостей)
// ============================================================================

function xmlEscape(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function buildSampleXlsx(seats) {
  const enc = new TextEncoder();
  const sampleSeats = seats.slice(0, 60);

  const rowsXml = [
    `<row r="1"><c r="A1" t="inlineStr"><is><t>Цвет браслета</t></is></c><c r="B1" t="inlineStr"><is><t>Сектор</t></is></c><c r="C1" t="inlineStr"><is><t>Место</t></is></c><c r="D1" t="inlineStr"><is><t>Ряд</t></is></c></row>`,
  ];

  sampleSeats.forEach((seat, idx) => {
    const rIdx = idx + 2;
    const colorVal = `<c r="A${rIdx}" t="inlineStr"><is><t>${xmlEscape(seat.colorName || seat.sectorName)}</t></is></c>`;
    const secVal = `<c r="B${rIdx}" t="inlineStr"><is><t>${xmlEscape(seat.sectorRaw || seat.sectorName)}</t></is></c>`;
    const seatVal = seat.seat !== null ? `<c r="C${rIdx}"><v>${seat.seat}</v></c>` : `<c r="C${rIdx}" t="inlineStr"><is><t></t></is></c>`;
    const rowVal = seat.row !== null ? `<c r="D${rIdx}"><v>${seat.row}</v></c>` : `<c r="D${rIdx}" t="inlineStr"><is><t></t></is></c>`;
    rowsXml.push(`<row r="${rIdx}">${colorVal}${secVal}${seatVal}${rowVal}</row>`);
  });

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const wbRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Места" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const sheet1 = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <sheetData>${rowsXml.join('')}</sheetData>
</worksheet>`;

  return buildZip([
    { name: '[Content_Types].xml', data: enc.encode(contentTypes) },
    { name: '_rels/.rels', data: enc.encode(rels) },
    { name: 'xl/_rels/workbook.xml.rels', data: enc.encode(wbRels) },
    { name: 'xl/workbook.xml', data: enc.encode(workbook) },
    { name: 'xl/worksheets/sheet1.xml', data: enc.encode(sheet1) },
  ]);
}
