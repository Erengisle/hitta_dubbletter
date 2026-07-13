/**
 * Kategorisera inskannade PDF-filer som "Grammatik", "Religion" eller
 * "Övrigt" utifrån OCR-tolkad text och nyckelordslistor.
 *
 * Så här funkar det:
 * 1. Filerna i CONFIG.FOLDER_ID (valfritt rekursivt genom undermappar)
 *    OCR-tolkas via Drive API:s inbyggda OCR-konvertering (skapar en
 *    tillfällig Google Docs-kopia med textlager, som raderas igen direkt
 *    efter att texten lästs ut).
 * 2. Texten söks igenom efter ord ur GRAMMATIK_KEYWORDS respektive
 *    RELIGION_KEYWORDS (ordgränsmatchning, inte delsträng, så t.ex. "tro"
 *    inte råkar träffa inuti "kontroll"). Filnamnet ger extra poäng om det
 *    innehåller "grammatik"/"religion". Text som till stor del är på
 *    engelska (se ENGLISH_STOPWORDS och CONFIG.ENGLISH_MIN_RATIO) ger
 *    extra poäng till Religion — och kan ALDRIG bli Grammatik, oavsett
 *    ordträffar (grammatikundervisningen är på svenska). Kort text,
 *    ifyllnadsluckor ("___") eller numrerade uppgifter ger extra poäng
 *    till Grammatik (se looksLikeExercise_) eftersom grammatikövningar
 *    ofta saknar grammatiktermer men är korta/strukturerade.
 * 3. Religionspoäng >= CONFIG.MIN_SCORE_RELIGION och >= grammatikpoäng ger
 *    kategorin "Religion". Annars ger grammatikpoäng >= CONFIG.MIN_SCORE
 *    kategorin "Grammatik". Annars "Övrigt" — dit hamnar t.ex. historia,
 *    så länge den inte råkar träffa religionsordlistan (mytologiska gudar
 *    i en historietext kan fortfarande ge falska Religion-träffar).
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
 * Vill du slippa köra om manuellt: kör funktionen `skapaTrigger` en gång.
 * Den ställer in `kategoriseraPdfer` att köras automatiskt var 10:e minut,
 * och tar bort sig själv automatiskt när alla filer är klara.
 *
 * Ombearbeta gamla resultat: filer som klassades innan Religion-kategorin
 * eller senare regeljusteringar fanns i koden blir hängande med sitt gamla
 * (ofta felaktiga) resultat, eftersom `kategoriseraPdfer` hoppar över
 * filer som redan finns som rad i kalkylarket. Kör `ombearbetaOvrigtOchFel`
 * (eller `skapaOmbearbetningTrigger` för automatisk upprepning) för att
 * OCR-tolka om och klassificera om alla rader märkta "Övrigt" eller "FEL"
 * med nuvarande kod, och skriva över raden istället för att lägga till en
 * ny.
 *
 * Krav: Aktivera avancerad tjänst "Drive API" (v2) under Tjänster i
 * Apps Script-editorn innan du kör. Se README.md för fullständiga
 * installationssteg.
 */

const CONFIG = {
  FOLDER_ID: 'KLISTRA_IN_MAPP_ID_HÄR',
  RECURSIVE: true,
  MIN_SCORE: 2,
  MIN_SCORE_RELIGION: 2,
  ENGLISH_MIN_RATIO: 0.12,
  ENGLISH_MIN_WORDS: 20,
  ENGLISH_SCORE_BONUS: 2,
  EXERCISE_MAX_WORDS: 25,
  EXERCISE_MIN_BLANKS: 2,
  EXERCISE_MIN_NUMBERED_ITEMS: 3,
  EXERCISE_SCORE_BONUS: 2,
  MAX_RUNTIME_MINUTES: 25,
  OUTPUT_SPREADSHEET_NAME: 'PDF-kategorisering',
  OUTPUT_SHEET_NAME: 'Resultat',
  GRAMMATIK_FOLDER_ID: 'KLISTRA_IN_MÅLMAPP_ID_HÄR',
  RELIGION_FOLDER_ID: 'KLISTRA_IN_MÅLMAPP_ID_HÄR',
  FLYTTA_BEKRÄFTA: false,
};

const GRAMMATIK_KEYWORDS = [
  'grammatik', 'substantiv', 'verb', 'adjektiv', 'pronomen', 'preposition',
  'konjunktion', 'adverb', 'räkneord', 'interjektion', 'subjekt', 'predikat',
  'objekt', 'bestämd form', 'obestämd form', 'singular', 'plural', 'presens',
  'preteritum', 'imperfekt', 'perfekt particip', 'pluskvamperfekt',
  'infinitiv', 'imperativ', 'particip', 'komparation', 'komparativ',
  'superlativ', 'huvudsats', 'bisats', 'ordföljd', 'satsdel', 'ordklass',
  'genus', 'kasus', 'artikel',
];

// Ord för religionskategorin: religionsnamn/-begrepp, namn på gudar och
// centrala religiösa gestalter, samt institutioner/högtider/skrifter.
const RELIGION_KEYWORDS = [
  'religion', 'kristendom', 'islam', 'judendom', 'hinduism', 'buddhism',
  'tro', 'troende', 'gud', 'gudar', 'gudinna', 'gudinnor',
  'allah', 'muhammed', 'jesus', 'kristus', 'jahve', 'jehova',
  'buddha', 'shiva', 'vishnu', 'brahma', 'ganesha', 'moses', 'abraham',
  'kyrka', 'kyrkan', 'moské', 'synagoga', 'tempel',
  'bön', 'böner', 'helig', 'heliga', 'helgon',
  'profet', 'profeten', 'apostel', 'apostlarna',
  'jul', 'påsk', 'pingst', 'ramadan', 'sabbat', 'fastan', 'pilgrim',
  'dop', 'nattvard', 'gudstjänst', 'präst', 'pastor', 'biskop', 'imam',
  'rabbin', 'koranen', 'koran', 'bibeln', 'bibel', 'torah', 'tora',
  'evangelium', 'ängel', 'änglar', 'satan', 'djävul', 'paradis',
  'reinkarnation', 'karma', 'nirvana',
];

// Vanliga engelska funktionsord, används för att gissa om en text
// huvudsakligen är skriven på engelska (se detectEnglish_).
const ENGLISH_STOPWORDS = [
  'the', 'and', 'of', 'is', 'was', 'were', 'to', 'in', 'that', 'with',
  'this', 'are', 'for', 'as', 'on', 'it', 'from', 'you', 'your', 'have',
  'has', 'be', 'by', 'an', 'at', 'not', 'but', 'his', 'her', 'they',
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
  deleteTriggersForFunction_('kategoriseraPdfer');
}

function skapaTrigger() {
  deleteTriggersForFunction_('kategoriseraPdfer');
  ScriptApp.newTrigger('kategoriseraPdfer')
    .timeBased()
    .everyMinutes(10)
    .create();
  Logger.log('Trigger skapad. kategoriseraPdfer körs nu automatiskt var 10:e minut tills alla filer är klara, då tas triggern bort automatiskt.');
}

// Kör om OCR + klassificering (med nuvarande KEYWORDS/regler) för alla
// rader i kalkylarket märkta "Övrigt" eller "FEL", och skriver över raden
// med det nya resultatet. Tänkt att fånga upp filer som klassades innan
// Religion-kategorin eller senare regeljusteringar fanns i koden — de
// hoppas annars alltid över av kategoriseraPdfer eftersom de redan finns
// som rad (dedup på Fil-ID).
//
// Kolumn 7 ("Ombearbetad") markerar vilka rader som redan setts över i en
// ombearbetningsomgång, så funktionen kan köras flera gånger (eller via
// skapaOmbearbetningTrigger) utan att fastna i en loop på rader som
// fortfarande hamnar i Övrigt efter ombearbetning.
function ombearbetaOvrigtOchFel() {
  const startTime = Date.now();
  const maxRuntimeMs = CONFIG.MAX_RUNTIME_MINUTES * 60 * 1000;

  const sheet = getOrCreateResultSheet_();
  ensureOmbearbetadKolumn_(sheet);

  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('Inga resultat i kalkylarket ännu.');
    return;
  }

  const data = sheet.getRange(2, 1, lastRow - 1, 7).getValues(); // Fil-ID..Ombearbetad
  const toProcess = [];
  data.forEach((row, i) => {
    const [fileId, fileName, kategori, , , , ombearbetad] = row;
    if ((kategori === 'Övrigt' || kategori === 'FEL') && !ombearbetad) {
      toProcess.push({ rowNumber: i + 2, fileId, fileName });
    }
  });

  Logger.log(`${toProcess.length} rad(er) att ombearbeta (Övrigt/FEL utan Ombearbetad-markering).`);

  let processed = 0;
  for (const item of toProcess) {
    if (Date.now() - startTime > maxRuntimeMs) {
      Logger.log(`Tidsgräns nådd efter ${processed} rad(er) denna körning (${toProcess.length - processed} kvar). Kör ombearbetaOvrigtOchFel igen för att fortsätta.`);
      return;
    }
    Logger.log(`(${processed + 1}/${toProcess.length}) OCR-tolkar om ${item.fileName}...`);
    let result;
    try {
      const file = DriveApp.getFileById(item.fileId);
      const text = ocrToText_(file);
      result = classify_(file, text);
    } catch (err) {
      Logger.log(`FEL vid ombearbetning av ${item.fileName}: ${err}`);
      result = { category: 'FEL', score: 0, matched: [] };
    }
    updateResultRow_(sheet, item.rowNumber, result);
    processed++;
  }

  Logger.log(`Klart! ${processed} rad(er) ombearbetade denna körning. Se kalkylarket för resultat.`);
  deleteTriggersForFunction_('ombearbetaOvrigtOchFel');
}

function skapaOmbearbetningTrigger() {
  deleteTriggersForFunction_('ombearbetaOvrigtOchFel');
  ScriptApp.newTrigger('ombearbetaOvrigtOchFel')
    .timeBased()
    .everyMinutes(10)
    .create();
  Logger.log('Trigger skapad. ombearbetaOvrigtOchFel körs nu automatiskt var 10:e minut tills alla Övrigt/FEL-rader är ombearbetade, då tas triggern bort automatiskt.');
}

function ensureOmbearbetadKolumn_(sheet) {
  if (sheet.getRange(1, 7).getValue() !== 'Ombearbetad') {
    sheet.getRange(1, 7).setValue('Ombearbetad');
  }
}

function updateResultRow_(sheet, rowNumber, result) {
  sheet.getRange(rowNumber, 3, 1, 3).setValues([[result.category, result.score, (result.matched || []).join(', ')]]);
  sheet.getRange(rowNumber, 7).setValue(new Date());
  SpreadsheetApp.flush();
}

function deleteTriggersForFunction_(functionName) {
  ScriptApp.getProjectTriggers().forEach((trigger) => {
    if (trigger.getHandlerFunction() === functionName) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function flyttaGrammatikTillMapp() {
  flyttaKategoriTillMapp_('Grammatik', CONFIG.GRAMMATIK_FOLDER_ID);
}

function flyttaReligionTillMapp() {
  flyttaKategoriTillMapp_('Religion', CONFIG.RELIGION_FOLDER_ID);
}

function flyttaKategoriTillMapp_(category, folderId) {
  const sheet = getOrCreateResultSheet_();
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    Logger.log('Inga resultat i kalkylarket ännu.');
    return;
  }

  const rows = sheet.getRange(2, 1, lastRow - 1, 3).getValues(); // Fil-ID, Filnamn, Kategori
  const matchingRows = rows.filter((r) => r[2] === category);

  if (matchingRows.length === 0) {
    Logger.log(`Inga filer kategoriserade som ${category} hittades.`);
    return;
  }

  if (!CONFIG.FLYTTA_BEKRÄFTA) {
    Logger.log(`TORRKÖRNING: ${matchingRows.length} fil(er) SKULLE flyttas till målmappen för ${category}. Inget har flyttats. Sätt CONFIG.FLYTTA_BEKRÄFTA = true och kör igen för att faktiskt flytta.`);
    matchingRows.forEach((r) => Logger.log(`  - ${r[1]}`));
    return;
  }

  const destFolder = DriveApp.getFolderById(folderId);
  let moved = 0;
  matchingRows.forEach((r) => {
    const [fileId, fileName] = r;
    try {
      moveFileToFolder_(DriveApp.getFileById(fileId), destFolder);
      moved++;
    } catch (err) {
      Logger.log(`FEL vid flytt av ${fileName}: ${err}`);
    }
  });
  Logger.log(`Klart. ${moved} av ${matchingRows.length} fil(er) flyttade till målmappen för ${category}.`);
}

function moveFileToFolder_(file, destFolder) {
  const parents = file.getParents();
  while (parents.hasNext()) {
    parents.next().removeFile(file);
  }
  destFolder.addFile(file);
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
  const isEnglish = detectEnglish_(lowerText);

  // Engelsk text är per definition aldrig Grammatik (svensk grammatik-
  // undervisning), oavsett om enstaka ord råkar sammanfalla med
  // GRAMMATIK_KEYWORDS (t.ex. "verb", "preposition", "adverb", "genus").
  let grammatikMatched = [];
  let grammatikScore = 0;
  if (!isEnglish) {
    grammatikMatched = GRAMMATIK_KEYWORDS.filter((kw) => containsWord_(lowerText, kw));
    grammatikScore = grammatikMatched.length;
    if (lowerName.includes('grammatik')) {
      grammatikScore += 3;
    }
    if (looksLikeExercise_(text)) {
      grammatikScore += CONFIG.EXERCISE_SCORE_BONUS;
      grammatikMatched = grammatikMatched.concat(['[kort/övningsliknande text]']);
    }
  }

  const religionMatched = RELIGION_KEYWORDS.filter((kw) => containsWord_(lowerText, kw));
  let religionScore = religionMatched.length;
  if (lowerName.includes('religion')) {
    religionScore += 3;
  }
  if (isEnglish) {
    religionScore += CONFIG.ENGLISH_SCORE_BONUS;
  }

  let category = 'Övrigt';
  let score = 0;
  let matched = [];
  if (religionScore >= CONFIG.MIN_SCORE_RELIGION && religionScore >= grammatikScore) {
    category = 'Religion';
    score = religionScore;
    matched = religionMatched;
  } else if (grammatikScore >= CONFIG.MIN_SCORE) {
    category = 'Grammatik';
    score = grammatikScore;
    matched = grammatikMatched;
  }
  if (isEnglish) {
    matched = matched.concat(['[engelsk text]']);
  }

  return {
    name: file.getName(),
    url: file.getUrl(),
    category,
    score,
    matched,
  };
}

// Matchar kw som ett helt ord i text (inte som delsträng i ett större ord),
// t.ex. "tro" ska inte träffa "kontroll". Hanterar å/ä/ö som bokstäver.
function containsWord_(text, kw) {
  const escaped = kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const pattern = new RegExp(`(^|[^a-zåäö])${escaped}([^a-zåäö]|$)`, 'i');
  return pattern.test(text);
}

// Gissar om text huvudsakligen är på engelska genom att räkna andelen ord
// som är vanliga engelska funktionsord. Kräver ett minsta antal ord för
// att inte ge utslag på korta/tomma OCR-resultat.
function detectEnglish_(text) {
  const words = text.split(/[^a-zåäö]+/i).filter(Boolean);
  if (words.length < CONFIG.ENGLISH_MIN_WORDS) {
    return false;
  }
  const englishHits = words.filter((w) => ENGLISH_STOPWORDS.includes(w)).length;
  return englishHits / words.length >= CONFIG.ENGLISH_MIN_RATIO;
}

// Gissar om texten är en grammatikövning snarare än en berättande text:
// grammatikövningar är ofta korta (enstaka meningar), har luckor att
// fylla i ("___") eller är numrerade uppgiftslistor ("1. ... 2. ...").
// Detta är en svag signal (kort/numrerat/luckor förekommer i uppgifter
// för andra ämnen också) och tänkt att komplettera nyckelordsträffar,
// inte ersätta dem.
function looksLikeExercise_(text) {
  const wordCount = text.split(/[^a-zA-ZåäöÅÄÖ]+/).filter(Boolean).length;
  if (wordCount > 0 && wordCount <= CONFIG.EXERCISE_MAX_WORDS) {
    return true;
  }
  const blankCount = (text.match(/_{3,}/g) || []).length;
  if (blankCount >= CONFIG.EXERCISE_MIN_BLANKS) {
    return true;
  }
  const numberedItemCount = (text.match(/(^|\n)\s*\d{1,2}[.)]\s/g) || []).length;
  if (numberedItemCount >= CONFIG.EXERCISE_MIN_NUMBERED_ITEMS) {
    return true;
  }
  return false;
}

function getOrCreateResultSheet_() {
  const ss = findOrCreateSpreadsheet_(CONFIG.OUTPUT_SPREADSHEET_NAME);
  let sheet = ss.getSheetByName(CONFIG.OUTPUT_SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(CONFIG.OUTPUT_SHEET_NAME);
    sheet.appendRow(['Fil-ID', 'Filnamn', 'Kategori', 'Poäng', 'Matchade nyckelord', 'Länk', 'Ombearbetad']);
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
