# Kategorisera PDF:er (grammatik / övrigt)

Google Apps Script som OCR-tolkar inskannade PDF-filer i en Drive-mapp och
föreslår om varje fil hör till kategorin **Grammatik** eller **Övrigt**,
baserat på en nyckelordslista. Resultatet skrivs till ett kalkylark —
inga filer flyttas eller ändras.

## Hur klassificeringen fungerar

1. Varje PDF konverteras tillfälligt till en Google Docs-kopia med Drive
   API:s OCR (`ocr: true`, `ocrLanguage: 'sv'`). Kopian raderas igen direkt
   efter att texten lästs ut.
2. Texten söks igenom efter ord ur listan `KEYWORDS` i `Kategorisera.gs`
   (t.ex. "substantiv", "verb", "bisats", "böjning"...).
3. Varje träff ger 1 poäng. Om filnamnet innehåller "grammatik" ges 3 extra
   poäng.
4. Poäng ≥ `MIN_SCORE` (standard 2) → **Grammatik**, annars **Övrigt**.

Justera `KEYWORDS` och `MIN_SCORE` i toppen av scriptet efter behov — det
här är en enkel startpunkt, inte en färdig lösning. Om nyckelordsmetoden
missar för många filer kan ett senare steg använda en språkmodell istället.

## Installation

1. Gå till [script.google.com](https://script.google.com) → **Nytt
   projekt**.
2. Klistra in innehållet i `Kategorisera.gs`.
3. Aktivera avancerad tjänst: klicka på **+** bredvid "Tjänster" i
   vänstermenyn → välj **Drive API** → **Lägg till**.
4. Sätt `CONFIG.FOLDER_ID` till ID:t för mappen som ska genomsökas
   (sista delen av mapp-URL:en:
   `https://drive.google.com/drive/folders/<FOLDER_ID>`).

## Användning

Kör funktionen `kategoriseraPdfer` (Kör-knappen i editorn, välj funktionen
i listan). Första gången ber Google om godkännande för Drive-, Dokument-
och Kalkylarksåtkomst.

Ett kalkylark med namnet **PDF-kategorisering** skapas automatiskt (eller
återanvänds om det redan finns) i din Drive, med kolumnerna:

| Fil-ID | Filnamn | Kategori | Poäng | Matchade nyckelord | Länk |

Varje fil skrivs till arket direkt när den är klar (inte allt på en gång i
slutet), så inget resultat går förlorat om körningen avbryts.

## Stora mappar (många PDF:er)

Apps Script avbryter automatiskt körningen efter 6 minuter (privata
Google-konton) eller 30 minuter (Google Workspace/skolkonto). Funktionen
`kategoriseraPdfer` stoppar sig själv efter `CONFIG.MAX_RUNTIME_MINUTES`
(standard 5 minuter, för att fungera på båda kontotyperna) och kommer
ihåg vilka filer som redan är klara via Fil-ID-kolumnen.

Har du väldigt många filer: kör bara funktionen igen (Kör-knappen) så
fortsätter den automatiskt med resterande filer, utan att skriva över det
som redan gjorts. Upprepa tills loggen (Visa → Loggar) säger "Klart! X
filer bearbetade denna körning, Y totalt" och X + tidigare klara = Y.

Om du kör på ett skolkonto kan du höja `MAX_RUNTIME_MINUTES` (t.ex. till
25) för att bli klar på färre körningar.

Vill du köra om en enskild fil som fick kategorin **FEL** (t.ex. om OCR
misslyckades): radera den raden i kalkylarket och kör funktionen igen —
då tolkas den som "inte klar" och bearbetas på nytt.

## Begränsningar

- OCR-kvaliteten avgör träffsäkerheten — dålig skanningskvalitet ger
  sämre klassificering.
