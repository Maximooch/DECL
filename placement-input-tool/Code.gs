/**
 * Random% Tournament placement entry sidebar.
 *
 * Expected sheet layout:
 *   Placements!A4:T4 = Player + map names
 *   Placements!A5:A  = player names
 *   Placements!B5:T  = placement inputs
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('Placement Tool')
    .addItem('Open placement input', 'showPlacementInput')
    .addSeparator()
    .addItem('Open Safari-safe input sheet', 'openPlacementInputSheet')
    .addItem('Apply from input sheet', 'applyFromPlacementInputSheet')
    .addSeparator()
    .addItem('Authorize / test connection', 'authorizePlacementTool')
    .addToUi();
}

function showPlacementInput() {
  const html = HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('Placement input');
  SpreadsheetApp.getUi().showSidebar(html);
}

function authorizePlacementTool() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName('Placements');
  if (!sheet) throw new Error('Could not find a sheet named Placements.');

  // Reading and writing the same value forces Sheets authorization while
  // leaving the workbook unchanged.
  const testCell = sheet.getRange('A1');
  const originalValue = testCell.getValue();
  testCell.setValue(originalValue);
  SpreadsheetApp.getUi().alert('Placement Tool is authorized and can write to this spreadsheet.');
}

function placementToolPing() {
  return {
    ok: true,
    message: 'Sidebar connection succeeded.',
    timestamp: new Date().toISOString(),
  };
}

function openPlacementInputSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  let inputSheet = spreadsheet.getSheetByName('Placement Input');

  if (!inputSheet) {
    inputSheet = spreadsheet.insertSheet('Placement Input');
    inputSheet.getRange('A1').setValue('Placement Input — Safari-safe');
    inputSheet.getRange('A2').setValue('Paste the complete Round/Map/ranked-player block into cell A4. Each pasted line may occupy its own row. Then choose Placement Tool → Apply from input sheet.');
    inputSheet.getRange('A4').setValue('Round 1:\nMap: Skylands\n\n1. Player name');
    inputSheet.getRange('A1').setFontWeight('bold').setFontSize(16);
    inputSheet.getRange('A2').setWrap(true);
    inputSheet.getRange('A4:A200').setWrap(true).setVerticalAlignment('top');
    inputSheet.setColumnWidth(1, 620);
    inputSheet.setRowHeight(2, 48);
  }

  spreadsheet.setActiveSheet(inputSheet);
  inputSheet.getRange('A4').activate();
}

function applyFromPlacementInputSheet() {
  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const inputSheet = spreadsheet.getSheetByName('Placement Input');
  if (!inputSheet) {
    SpreadsheetApp.getUi().alert('Placement Input sheet not found. Choose Placement Tool → Open Safari-safe input sheet first.');
    return;
  }

  const lastRow = Math.max(inputSheet.getLastRow(), 4);
  const inputText = inputSheet
    .getRange(4, 1, lastRow - 3, 1)
    .getDisplayValues()
    .flat()
    .join('\n')
    .trim();

  try {
    const message = writePlacementsInternal(inputText);
    SpreadsheetApp.getUi().alert(message);
  } catch (error) {
    const message = error && error.message ? error.message : String(error);
    SpreadsheetApp.getUi().alert('Not updated:\n\n' + message);
  }
}

function writePlacements(inputText) {
  try {
    return {
      ok: true,
      message: writePlacementsInternal(inputText),
    };
  } catch (error) {
    return {
      ok: false,
      message: error && error.message ? error.message : String(error),
      name: error && error.name ? error.name : 'Error',
      stack: error && error.stack ? error.stack : '',
    };
  }
}

function writePlacementsInternal(inputText) {
  if (!inputText || !inputText.trim()) {
    throw new Error('Paste at least one placement block first.');
  }

  const spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  const sheet = spreadsheet.getSheetByName('Placements');
  if (!sheet) throw new Error('Could not find a sheet named Placements.');

  const context = readPlacementContext(sheet);
  const parsed = /^\s*map\s*:/im.test(String(inputText))
    ? parseRankedResults(String(inputText), context)
    : parsePipeRows(String(inputText), context);

  if (parsed.errors.length) {
    throw new Error(parsed.errors.join('\n'));
  }
  if (!parsed.updates.length) {
    throw new Error('No placement entries were found.');
  }

  // Each Map: block represents the complete result for that map. Clearing the
  // map column first makes players omitted from the ranking blank/DNF.
  parsed.updates.forEach(({ map, entries }) => {
    sheet
      .getRange(context.firstDataRow, map.column, context.playerCount, 1)
      .clearContent();

    const values = Array.from({ length: context.playerCount }, () => ['']);
    entries.forEach(({ row, placement }) => {
      values[row - context.firstDataRow][0] = placement;
    });
    sheet
      .getRange(context.firstDataRow, map.column, context.playerCount, 1)
      .setValues(values);
  });

  SpreadsheetApp.flush();
  const mapNames = parsed.updates.map(({ map }) => map.name).join(', ');
  const entryCount = parsed.updates.reduce((sum, update) => sum + update.entries.length, 0);
  return `Updated ${entryCount} placement${entryCount === 1 ? '' : 's'} across ${parsed.updates.length} map${parsed.updates.length === 1 ? '' : 's'}: ${mapNames}`;
}

function readPlacementContext(sheet) {
  const headerRow = 4;
  const firstDataRow = 5;
  const lastColumn = sheet.getLastColumn();
  const headers = sheet.getRange(headerRow, 1, 1, lastColumn).getDisplayValues()[0];
  const playerColumn = headers.findIndex((header) => normalize(header) === 'player');
  if (playerColumn < 0) throw new Error('Could not find the Player header in row 4.');

  const maps = new Map();
  headers.forEach((header, index) => {
    if (index > playerColumn && String(header).trim()) {
      maps.set(normalize(header), {
        name: String(header).trim(),
        column: index + 1,
      });
    }
  });

  const lastRow = Math.max(sheet.getLastRow(), firstDataRow);
  const playerValues = sheet
    .getRange(firstDataRow, playerColumn + 1, lastRow - firstDataRow + 1, 1)
    .getDisplayValues()
    .flat();
  const playerRows = new Map();
  playerValues.forEach((player, offset) => {
    if (String(player).trim()) playerRows.set(normalize(player), firstDataRow + offset);
  });

  return {
    maps,
    playerRows,
    firstDataRow,
    playerCount: playerValues.length,
  };
}

function parseRankedResults(inputText, context) {
  const updates = [];
  const errors = [];
  const lines = String(inputText).split(/\r?\n/);
  let activeUpdate = null;

  lines.forEach((rawLine, lineIndex) => {
    const lineNumber = lineIndex + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith('#') || /^round\b/i.test(line)) return;

    const mapMatch = line.match(/^map\s*:\s*(.+?)\s*$/i);
    if (mapMatch) {
      const mapName = mapMatch[1].trim();
      const map = context.maps.get(normalize(mapName));
      if (!map) {
        errors.push(`Line ${lineNumber}: map not found: ${mapName}`);
        activeUpdate = null;
        return;
      }
      if (updates.some((update) => update.map.column === map.column)) {
        errors.push(`Line ${lineNumber}: map appears more than once: ${mapName}`);
        activeUpdate = null;
        return;
      }
      activeUpdate = { map, entries: [], seenPlayers: new Set() };
      updates.push(activeUpdate);
      return;
    }

    const placementMatch = line.match(/^(\d+)[.)]\s+(.+?)\s*$/);
    if (!placementMatch) {
      errors.push(`Line ${lineNumber}: expected "Map: map name" or "1. Player name".`);
      return;
    }
    if (!activeUpdate) {
      errors.push(`Line ${lineNumber}: add a Map: line before the ranked players.`);
      return;
    }

    const placement = Number(placementMatch[1]);
    const originalName = placementMatch[2].trim();
    const playerName = originalName.replace(/\s*\([^)]*\)\s*$/, '').trim();
    const playerKey = normalize(playerName);
    const row = context.playerRows.get(playerKey);

    if (!row) {
      errors.push(`Line ${lineNumber}: player not found: ${playerName}`);
      return;
    }
    if (activeUpdate.seenPlayers.has(playerKey)) {
      errors.push(`Line ${lineNumber}: duplicate player for ${activeUpdate.map.name}: ${playerName}`);
      return;
    }
    activeUpdate.seenPlayers.add(playerKey);
    activeUpdate.entries.push({ row, placement });
  });

  return { updates, errors };
}

// Backward-compatible format: Player | p1, p2, p3, ...
function parsePipeRows(inputText, context) {
  const errors = [];
  const updates = [];
  const mapList = Array.from(context.maps.values());
  const valuesByMap = new Map();

  String(inputText).split(/\r?\n/).forEach((rawLine, lineIndex) => {
    const lineNumber = lineIndex + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) return;
    const separator = line.indexOf('|');
    if (separator < 0) {
      errors.push(`Line ${lineNumber}: use Map: blocks or Player | placement, placement, ...`);
      return;
    }

    const playerName = line.slice(0, separator).trim();
    const tokens = line.slice(separator + 1).split(',').map((token) => token.trim());
    const row = context.playerRows.get(normalize(playerName));
    if (!row) errors.push(`Line ${lineNumber}: player not found: ${playerName}`);
    if (tokens.length !== mapList.length) {
      errors.push(`Line ${lineNumber}: ${playerName} has ${tokens.length} placements; expected ${mapList.length}.`);
      return;
    }

    tokens.forEach((token, index) => {
      if (!valuesByMap.has(index)) valuesByMap.set(index, []);
      if (!token || /^(?:-|dnf|none)$/i.test(token)) return;
      if (!/^\d+$/.test(token) || Number(token) < 1) {
        errors.push(`Line ${lineNumber}: invalid placement for ${playerName}: ${token}`);
        return;
      }
      valuesByMap.get(index).push({ row, placement: Number(token) });
    });
  });

  mapList.forEach((map, index) => updates.push({ map, entries: valuesByMap.get(index) || [] }));
  return { updates, errors };
}

function normalize(value) {
  return String(value).trim().replace(/\s+/g, ' ').toLowerCase();
}
