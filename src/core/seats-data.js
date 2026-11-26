/**
 * Конфигурация зала по умолчанию (430 мест, 23 ряда, 5 цветовых секторов)
 * и вспомогательные функции для работы с пулом мест и цветами из таблиц.
 */

export const SECTORS = {
  yellow: {
    id: 'yellow',
    name: 'Жёлтый сектор',
    shortName: 'Жёлтый',
    color: '#EAB308',
    textOnColor: '#111827',
    rows: [1, 2],
  },
  orange: {
    id: 'orange',
    name: 'Оранжевый сектор',
    shortName: 'Оранжевый',
    color: '#F97316',
    textOnColor: '#111827',
    rows: [3, 4, 5],
  },
  burgundy: {
    id: 'burgundy',
    name: 'Бордовый сектор',
    shortName: 'Бордовый',
    color: '#BE123C',
    textOnColor: '#F8FAFC',
    rows: [6, 7, 8, 9, 10, 11, 12, 13],
  },
  gray: {
    id: 'gray',
    name: 'Серый сектор',
    shortName: 'Серый',
    color: '#64748B',
    textOnColor: '#F8FAFC',
    rows: [14, 15, 16, 17, 18, 19],
  },
  white: {
    id: 'white',
    name: 'Белый сектор',
    shortName: 'Белый',
    color: '#E2E8F0',
    textOnColor: '#0F172A',
    rows: [20, 21, 22, 23],
  },
  blue: {
    id: 'blue',
    name: 'Синий',
    shortName: 'Синий',
    color: '#3B82F6',
    textOnColor: '#F8FAFC',
    rows: [],
  },
  red: {
    id: 'red',
    name: 'Красный',
    shortName: 'Красный',
    color: '#EF4444',
    textOnColor: '#F8FAFC',
    rows: [],
  },
  green: {
    id: 'green',
    name: 'Зелёный',
    shortName: 'Зелёный',
    color: '#22C55E',
    textOnColor: '#0F172A',
    rows: [],
  },
  purple: {
    id: 'purple',
    name: 'Фиолетовый',
    shortName: 'Фиолетовый',
    color: '#A855F7',
    textOnColor: '#F8FAFC',
    rows: [],
  },
  black: {
    id: 'black',
    name: 'Чёрный',
    shortName: 'Чёрный',
    color: '#475569',
    textOnColor: '#F8FAFC',
    rows: [],
  },
  custom: {
    id: 'custom',
    name: 'Импортированный список',
    shortName: 'Список',
    color: '#F59E0B',
    textOnColor: '#111827',
    rows: [],
  },
};

export const DEFAULT_ROW_CONFIG = [
  { row: 1, count: 17, sectorId: 'yellow' },
  { row: 2, count: 17, sectorId: 'yellow' },
  { row: 3, count: 20, sectorId: 'orange' },
  { row: 4, count: 20, sectorId: 'orange' },
  { row: 5, count: 20, sectorId: 'orange' },
  { row: 6, count: 20, sectorId: 'burgundy' },
  { row: 7, count: 20, sectorId: 'burgundy' },
  { row: 8, count: 16, sectorId: 'burgundy' },
  { row: 9, count: 16, sectorId: 'burgundy' },
  { row: 10, count: 16, sectorId: 'burgundy' },
  { row: 11, count: 16, sectorId: 'burgundy' },
  { row: 12, count: 16, sectorId: 'burgundy' },
  { row: 13, count: 16, sectorId: 'burgundy' },
  { row: 14, count: 20, sectorId: 'gray' },
  { row: 15, count: 20, sectorId: 'gray' },
  { row: 16, count: 20, sectorId: 'gray' },
  { row: 17, count: 20, sectorId: 'gray' },
  { row: 18, count: 20, sectorId: 'gray' },
  { row: 19, count: 20, sectorId: 'gray' },
  { row: 20, count: 20, sectorId: 'white' },
  { row: 21, count: 20, sectorId: 'white' },
  { row: 22, count: 20, sectorId: 'white' },
  { row: 23, count: 20, sectorId: 'white' },
];

export function resolveSectorByRow(rowNum) {
  const num = Number(rowNum);
  if (num >= 1 && num <= 2) return SECTORS.yellow;
  if (num >= 3 && num <= 5) return SECTORS.orange;
  if (num >= 6 && num <= 13) return SECTORS.burgundy;
  if (num >= 14 && num <= 19) return SECTORS.gray;
  if (num >= 20 && num <= 23) return SECTORS.white;
  return SECTORS.custom;
}

export function resolveSectorByName(name) {
  if (!name) return null;
  const s = String(name).toLowerCase().trim();
  if (s.includes('желт') || s.includes('жёлт') || s.includes('yellow')) return SECTORS.yellow;
  if (s.includes('оранж') || s.includes('orange')) return SECTORS.orange;
  if (s.includes('борд') || s.includes('burgund') || s.includes('maroon')) return SECTORS.burgundy;
  if (s.includes('красн') || s.includes('red')) return SECTORS.red;
  if (s.includes('син') || s.includes('голуб') || s.includes('blue')) return SECTORS.blue;
  if (s.includes('зелен') || s.includes('зелён') || s.includes('green')) return SECTORS.green;
  if (s.includes('сер') || s.includes('gray') || s.includes('grey')) return SECTORS.gray;
  if (s.includes('бел') || s.includes('white')) return SECTORS.white;
  if (s.includes('фиолет') || s.includes('сирен') || s.includes('purple')) return SECTORS.purple;
  if (s.includes('черн') || s.includes('чёрн') || s.includes('black')) return SECTORS.black;
  return null;
}

export function createSeat({
  row,
  seat,
  sectorName = '',
  colorName = '',
  extra = '',
  uniqueIndex = null,
}) {
  const hasNumericRow = row !== null && row !== undefined && row !== '' && Number.isFinite(Number(row));
  const hasNumericSeat = seat !== null && seat !== undefined && seat !== '' && Number.isFinite(Number(seat));

  const rowVal = hasNumericRow ? Number(row) : null;
  const seatVal = hasNumericSeat ? Number(seat) : null;

  const cleanSector = String(sectorName || '').trim();
  const cleanColor = String(colorName || '').trim();

  const colorObj =
    resolveSectorByName(cleanColor) ||
    resolveSectorByName(cleanSector) ||
    (rowVal !== null ? resolveSectorByRow(rowVal) : SECTORS.custom);

  // Формируем отображаемое имя сектора и цвета
  let displaySector = '';
  if (cleanSector && cleanColor && cleanSector.toLowerCase() !== cleanColor.toLowerCase()) {
    displaySector = `${cleanSector} · ${cleanColor}`;
  } else {
    displaySector = cleanSector || cleanColor || colorObj.name;
  }

  const label =
    rowVal !== null && seatVal !== null
      ? `Ряд ${rowVal}, Место ${seatVal}`
      : String(extra || seat || row || 'Место').trim();

  const rowSeatKey = rowVal !== null && seatVal !== null ? `r${rowVal}-s${seatVal}` : '';
  const sectorSlug = cleanSector ? cleanSector.toLowerCase().replace(/\s+/g, '_') : '';
  const baseId = rowSeatKey
    ? sectorSlug
      ? `${sectorSlug}-${rowSeatKey}`
      : rowSeatKey
    : `custom-${label.toLowerCase().replace(/\s+/g, '_')}`;

  const id = uniqueIndex !== null ? `${baseId}#${uniqueIndex}` : baseId;

  return {
    id,
    rowSeatKey,
    row: rowVal,
    seat: seatVal,
    sectorId: colorObj.id,
    sectorName: displaySector,
    sectorRaw: cleanSector,
    colorName: cleanColor || colorObj.shortName,
    sectorColor: colorObj.color,
    label,
    extra: extra ? String(extra).trim() : '',
    active: true,
    drawn: false,
  };
}

export function generateDefaultSeats() {
  const list = [];
  for (const cfg of DEFAULT_ROW_CONFIG) {
    for (let s = 1; s <= cfg.count; s++) {
      list.push(
        createSeat({
          row: cfg.row,
          seat: s,
          sectorName: SECTORS[cfg.sectorId].name,
          colorName: SECTORS[cfg.sectorId].shortName,
        })
      );
    }
  }
  return list;
}

export function formatSeatParts(seatObj) {
  if (!seatObj) {
    return {
      rowText: '—',
      seatText: 'Готовы',
      singleLine: 'Готовы?',
      sectorText: 'Выберите место',
      color: '#F59E0B',
    };
  }
  if (seatObj.row !== null && seatObj.seat !== null) {
    return {
      rowText: `Ряд ${seatObj.row}`,
      seatText: `Место ${seatObj.seat}`,
      singleLine: `Ряд ${seatObj.row}, Место ${seatObj.seat}`,
      sectorText: seatObj.sectorName,
      color: seatObj.sectorColor,
    };
  }
  return {
    rowText: seatObj.sectorName || 'Участник',
    seatText: seatObj.label,
    singleLine: seatObj.label,
    sectorText: seatObj.extra || 'Список из файла',
    color: seatObj.sectorColor || '#F59E0B',
  };
}
