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
 * 4. Resultatet skrivs till ett kalkylark — inga filer flyttas eller ändras.
 *
 * Krav: Aktivera avancerad tjänst "Drive API" (v2) under Tjänster i
 * Apps Script-editorn innan du kör. Se README.md för fullständiga
 * installationssteg.
 */

const CONFIG = {
  FOLDER_ID: 'KLISTRA_IN_MAPP_ID_HÄR',
  RECURSIVE: true,
  MIN_SCORE: 2,
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
  const folder = DriveApp.getFolderById(CONFIG.FOLDER_ID);
  const files = collectPdfs_(folder, CONFIG.RECURSIVE);
  Logger.log(`Hittade ${files.length} PDF-filer.`);

  const results = files.map((file, i) => {
    Logger.log(`(${i + 1}/${files.length}) OCR-tolkar ${file.getName()}...`);
    try {
      const text = ocrToText_(file);
      return classify_(file, text);
    } catch (err) {
      Logger.log(`FEL vid ${file.getName()}: ${err}`);
      return { name: file.getName(), url: file.getUrl(), category: 'FEL', score: 0, matched: [] };
    }
  });

  writeReport_(results);
  Logger.log('Klart. Se kalkylarket för resultat.');
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

function writeReport_(results) {
  const ss = findOrCreateSpreadsheet_(CONFIG.OUTPUT_SPREADSHEET_NAME);
  let sheet = ss.getSheetByName(CONFIG.OUTPUT_SHEET_NAME);
  if (sheet) {
    sheet.clear();
  } else {
    sheet = ss.insertSheet(CONFIG.OUTPUT_SHEET_NAME);
  }
  sheet.appendRow(['Filnamn', 'Kategori', 'Poäng', 'Matchade nyckelord', 'Länk']);
  results.forEach((r) => {
    sheet.appendRow([r.name, r.category, r.score, r.matched.join(', '), r.url]);
  });
  sheet.autoResizeColumns(1, 5);
  Logger.log(`Rapport: ${ss.getUrl()}`);
}

function findOrCreateSpreadsheet_(name) {
  const files = DriveApp.getFilesByName(name);
  if (files.hasNext()) {
    return SpreadsheetApp.open(files.next());
  }
  return SpreadsheetApp.create(name);
}
