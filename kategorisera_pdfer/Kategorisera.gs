/**
 * Kategorisera inskannade PDF-filer som "Grammatik" eller "Övrigt" utifrån
 * OCR-tolkad text och en nyckelordslista.
 *
 * Så här funkar det:
 * 1. Filerna i CONFIG.FOLDER_ID (valfritt rekursivt genom undermappar)
 *    OCR-tolkas via Drive API:s inbyggda OCR-konvertering (skapar en
 *    tillfällig Google Docs-kopia med textlager, som raderas igen direkt
 *    efter att texten lästs ut).
 * 2. Texten söks igenom efter ord ur KEYWORDS. Filnamnet ger extra poäng
 *    om det innehåller "grammatik".
 * 3. Poäng >= CONFIG.MIN_SCORE ger kategorin "Grammatik", annars "Övrigt".
 * 4. Varje resultat skrivs till kalkylarket direkt när filen är klar —
 *    inga filer flyttas eller ändras.
 *
 * Stora mappar: Apps Script avbryts efter en viss körtid (6 eller 30
 * minuter beroende på kontotyp). Funktionen stoppar sig själv i god tid
 * innan dess och kommer ihåg (via Fil-ID-kolumnen i kalkylarket) vilka
 * filer som redan är klara. Kör bara funktionen `kategoriseraPdfer` igen
 * så fortsätter den med resterande filer, tills loggen säger att allt är
 * klart.
 *
 * Krav: Aktivera avancerad tjänst "Drive API" (v2) under Tjänster i
 * Apps Script-editorn innan du kör. Se README.md för fullständiga
 * installationssteg.
 */

const CONFIG = {
  FOLDER_ID: 'KLISTRA_IN_MAPP_ID_HÄR',
  RECURSIVE: true,
  MIN_SCORE: 2,
  MAX_RUNTIME_MINUTES: 5,
  OUTPUT_SPREADSHEET_NAME: 'PDF-kategorisering',
  OUTPUT_SHEET_NAME: 'Resultat',
};

const KEYWORDS = [
  'grammatik', 'substantiv', 'verb', 'adjektiv', 'pronomen', 'preposition',
  'konjunktion', 'adverb', 'räkneord', 'interjektion', 'subjekt', 'predikat',
  'objekt', 'bestämd form', 'obestämd form', 'singular', 'plural', 'presens',
  'preteritum', 'imperfekt', 'perfekt particip', 'pluskvamperfekt',
  'infinitiv', 'imperativ', 'particip', 'komparation', 'komparativ',
  'superlativ', 'huvudsats', 'bisats', 'ordföljd', 'satsdel', 'ordklass',
  'genus', 'kasus', 'artikel',
];

function kategoriseraPdfer() {
  const startTime = Date.now();
  const maxRuntimeMs = CONFIG.MAX_RUNTIME_MINUTES * 60 * 1000;

  const sheet = getOrCreateResultSheet_();
  const alreadyDone = getProcessedFileIds_(sheet);

  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const files = collectPdfs_(folder, CONFIG.RECURSIVE);
  const remaining = files.filter((f) => !alreadyDone.has(f.getId()));

  Logger.log(`${files.length} PDF-filer totalt, ${alreadyDone.size} redan klara sedan tidigare, ${remaining.length} kvar.`);

  let processed = 0;
  for (const file of remaining) {
    if (Date.now() - startTime > maxRuntimeMs) {
      Logger.log(`Tidsgräns nådd efter ${processed} filer denna körning (${remaining.length - processed} kvar). Kör kategoriseraPdfer igen för att fortsätta.`);
      return;
    }
    Logger.log(`(${processed + 1}/${remaining.length}) OCR-tolkar ${file.getName()}...`);
    let result;
    try {
      const text = ocrToText_(file);
      result = classify_(file, text);
    } catch (err) {
      Logger.log(`FEL vid ${file.getName()}: ${err}`);
      result = { name: file.getName(), url: file.getUrl(), category: 'FEL', score: 0, matched: [] };
    }
    appendResultRow_(sheet, file.getId(), result);
    processed++;
  }

  Logger.log(`Klart! ${processed} filer bearbetade denna körning, ${files.length} totalt. Se kalkylarket för resultat.`);
}

function collectPdfs_(rootFolder, recursive) {
  const pdfs = [];
  const foldersToScan = [rootFolder];
  while (foldersToScan.length > 0) {
    const folder = foldersToScan.pop();
    const fileIter = folder.getFilesByType(MimeType.PDF);
    while (fileIter.hasNext()) {
      pdfs.push(fileIter.next());
    }
    if (recursive) {
      const subIter = folder.getFolders();
      while (subIter.hasNext()) {
        foldersToScan.push(subIter.next());
      }
    }
  }
  return pdfs;
}

function ocrToText_(file) {
  const resource = {
    title: `[tmp-ocr] ${file.getName()}`,
    mimeType: MimeType.GOOGLE_DOCS,
  };
  const ocrFile = Drive.Files.copy(resource, file.getId(), {
    ocr: true,
    ocrLanguage: 'sv',
  });
  try {
    const doc = DocumentApp.openById(ocrFile.id);
    return doc.getBody().getText();
  } finally {
    Drive.Files.remove(ocrFile.id);
  }
}

function classify_(file, text) {
  const lowerText = text.toLowerCase();
  const lowerName = file.getName().toLowerCase();
  const matched = KEYWORDS.filter((kw) => lowerText.includes(kw));
  let score = matched.length;
  if (lowerName.includes('grammatik')) {
    score += 3;
  }
  const category = score >= CONFIG.MIN_SCORE ? 'Grammatik' : 'Övrigt';
  return {
    name: file.getName(),
    url: file.getUrl(),
    category,
    score,
    matched,
  };
}

function getOrCreateResultSheet_() {
  const ss = findOrCreateSpreadsheet_(CONFIG.OUTPUT_SPREADSHEET_NAME);
  let sheet = ss.getSheetByName(CONFIG.OUTPUT_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.OUTPUT_SHEET_NAME);
    sheet.appendRow(['Fil-ID', 'Filnamn', 'Kategori', 'Poäng', 'Matchade nyckelord', 'Länk']);
  }
  return sheet;
}

function getProcessedFileIds_(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return new Set();
  }
  const ids = sheet.getRange(2, 1, lastRow - 1, 1).getValues().flat();
  return new Set(ids.filter(String));
}

function appendResultRow_(sheet, fileId, result) {
  sheet.appendRow([fileId, result.name, result.category, result.score, result.matched.join(', '), result.url]);
  SpreadsheetApp.flush();
}

function findOrCreateSpreadsheet_(name) {
  const files = DriveApp.getFilesByName(name);
  if (files.hasNext()) {
    return SpreadsheetApp.open(files.next());
  }
  return SpreadsheetApp.create(name);
}
