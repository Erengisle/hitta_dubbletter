# hitta_dubbletter

Script som söker igenom en mapp på Google Drive efter PDF-filer och listar
vilka som är dubbletter.

Två typer av dubbletter rapporteras:

1. **Exakta dubbletter** — filer med identiskt innehåll (samma MD5-checksumma
   från Google Drive). Dessa är garanterat samma fil, oavsett filnamn.
2. **Samma filnamn, olika innehåll** — flaggas separat som en varning, eftersom
   det kan vara omdöpta filer, nya versioner av samma dokument, eller
   faktiska dubbletter som blivit redigerade. Kräver manuell koll.

Scriptet tar **inte** bort eller flyttar några filer — det bara listar vad
det hittar, så du kan besluta vad som ska göras.

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

Första gången du kör scriptet öppnas en webbläsare där du loggar in med
ditt Google-konto och godkänner åtkomst (endast läsbehörighet). Efter det
sparas en token lokalt (`token.json`) så du slipper logga in varje gång.
