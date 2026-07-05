# hitta_dubbletter

Script som söker igenom en mapp på Google Drive efter PDF-filer och listar
vilka som är dubbletter.

Två typer av dubbletter rapporteras:

1. **Exakta dubbletter** — filer med identiskt innehåll (samma MD5-checksumma
   från Google Drive). Dessa är garanterat samma fil, oavsett filnamn.
2. **Samma filnamn, olika innehåll** — flaggas separat som en varning, eftersom
   det kan vara omdöpta filer, nya versioner av samma dokument, eller
   faktiska dubbletter som blivit redigerade. Kräver manuell koll.

Scriptet listar bara vad det hittar som standard — inget tas bort. Det
finns en valfri `--trash`-flagga (se nedan) för att flytta bekräftade
exakta dubbletter till papperskorgen.

## Installation

```bash
python3 -m venv venv
source venv/bin/activate
pip install -r requirements.txt
```

## Skapa autentiseringsuppgifter (en gång)

1. Gå till [Google Cloud Console](https://console.cloud.google.com/) och skapa
   ett projekt (eller använd ett befintligt).
2. Aktivera **Google Drive API** under "APIs & Services" → "Library".
3. Gå till "APIs & Services" → "Credentials" → "Create Credentials" →
   "OAuth client ID".
   - Applikationstyp: **Desktop app**.
4. Ladda ner JSON-filen och spara den som `credentials.json` i projektmappen.

Scriptet begär full åtkomst till din Drive (`drive`-scopet), inte bara
läsbehörighet, eftersom den valfria `--trash`-funktionen behöver kunna
ändra filer. Om du bara vill lista dubbletter används skrivbehörigheten
aldrig.

Om du körde en äldre version av scriptet med enbart läsbehörighet: ta
bort `token.json` och kör om, så loggas du in på nytt med rätt behörighet.

Filerna `credentials.json` och `token.json` innehåller känsliga
uppgifter och ska **inte** checkas in i git (de ligger redan i
`.gitignore`).

## Användning

Hitta mappens ID genom att öppna den i webbläsaren — ID:t är den sista
delen av URL:en:
`https://drive.google.com/drive/folders/<FOLDER_ID>`

```bash
python3 find_duplicates.py <FOLDER_ID>
```

Sök även igenom undermappar:

```bash
python3 find_duplicates.py <FOLDER_ID> --recursive
```

Spara en rapport till fil (CSV eller JSON):

```bash
python3 find_duplicates.py <FOLDER_ID> --recursive --output dubbletter.csv
```

### Ta bort dubbletter (papperskorg)

Flytta exakta dubbletter till Google Drives papperskorg, en fil per grupp
behålls (namngrupper med olika innehåll rörs aldrig automatiskt):

```bash
# Dry-run: visar bara vad som SKULLE tas bort, inget ändras
python3 find_duplicates.py <FOLDER_ID> --recursive --trash

# Kör på riktigt
python3 find_duplicates.py <FOLDER_ID> --recursive --trash --yes
```

Standard är att behålla den äldsta filen i varje grupp (`--keep oldest`).
Använd `--keep newest` för att behålla den senast ändrade filen istället.

Filerna raderas inte permanent — de hamnar i Drives papperskorg och kan
återställas därifrån om något blev fel.

Första gången du kör scriptet öppnas en webbläsare där du loggar in med
ditt Google-konto och godkänner åtkomst (endast läsbehörighet). Efter det
sparas en token lokalt (`token.json`) så du slipper logga in varje gång.
