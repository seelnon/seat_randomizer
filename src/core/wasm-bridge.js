/**
 * Мост к WebAssembly-модулю (./src/wasm/engine.wasm).
 * Загружается через fetch() для полной совместимости со статическим хостингом (GitHub Pages).
 */

let wasmInstance = null;
let wasmInitPromise = null;

// Резервная таблица CRC-32 на JS на случай запуска без HTTP (например, file://)
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
})();

export async function initWasmEngine() {
  if (wasmInstance) return wasmInstance;
  if (wasmInitPromise) return wasmInitPromise;

  wasmInitPromise = (async () => {
    try {
      const response = await fetch('./src/wasm/engine.wasm');
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }
      const bytes = await response.arrayBuffer();
      const { instance } = await WebAssembly.instantiate(bytes, {});
      wasmInstance = instance;
      return wasmInstance;
    } catch (err) {
      console.warn('WASM-модуль не загружен, используется резервный режим JS:', err);
      return null;
    }
  })();

  return wasmInitPromise;
}

export function isWasmReady() {
  return Boolean(wasmInstance);
}

/**
 * Вычисление CRC-32 для произвольного Uint8Array.
 * Использует линейную память WASM при наличии модуля.
 */
export function computeCrc32(bytes) {
  if (wasmInstance && wasmInstance.exports.crc32 && wasmInstance.exports.memory) {
    const { memory, crc32 } = wasmInstance.exports;
    const neededBytes = bytes.length + 1024;
    if (memory.buffer.byteLength < neededBytes) {
      const pagesNeeded = Math.ceil((neededBytes - memory.buffer.byteLength) / 65536);
      memory.grow(pagesNeeded);
    }
    const memView = new Uint8Array(memory.buffer, 0, bytes.length);
    memView.set(bytes);
    return crc32(0, bytes.length) >>> 0;
  }

  let crc = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

/**
 * Возвращает криптостойкое случайное 32-битное число.
 */
export function randomSeed32() {
  const buf = new Uint32Array(1);
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    crypto.getRandomValues(buf);
  } else {
    buf[0] = (Math.random() * 0xffffffff) >>> 0;
  }
  return buf[0] || 0x9e3779b9;
}

/**
 * Перемешивает массив (не мутируя оригинал) с помощью WASM shuffle_indices
 * или криптографического Fisher-Yates на JS.
 */
export function shuffleArray(items) {
  const count = items.length;
  if (count <= 1) return items.slice();

  if (wasmInstance && wasmInstance.exports.shuffle_indices && wasmInstance.exports.memory) {
    const { memory, shuffle_indices } = wasmInstance.exports;
    const byteOffset = 4096;
    const neededBytes = byteOffset + count * 4 + 256;
    if (memory.buffer.byteLength < neededBytes) {
      const pagesNeeded = Math.ceil((neededBytes - memory.buffer.byteLength) / 65536);
      memory.grow(pagesNeeded);
    }
    const idxView = new Uint32Array(memory.buffer, byteOffset, count);
    for (let i = 0; i < count; i++) idxView[i] = i;

    shuffle_indices(byteOffset, count, randomSeed32());

    const result = new Array(count);
    for (let i = 0; i < count; i++) {
      result[i] = items[idxView[i]];
    }
    return result;
  }

  const copy = items.slice();
  for (let i = count - 1; i > 0; i--) {
    const j = randomSeed32() % (i + 1);
    const tmp = copy[i];
    copy[i] = copy[j];
    copy[j] = tmp;
  }
  return copy;
}
