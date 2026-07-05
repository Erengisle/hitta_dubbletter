#!/usr/bin/env python3
"""Hitta dubbletter bland PDF-filer i en Google Drive-mapp.

Scriptet loggar in mot Google Drive API, listar alla PDF-filer i en
angiven mapp (valfritt rekursivt genom undermappar) och grupperar dem
efter Drives MD5-checksumma. Filer med samma checksumma är byte-för-byte
identiska (garanterade dubbletter). Filer med samma filnamn men olika
checksumma listas separat som en varning, eftersom det ofta rör sig om
omdöpta eller uppdaterade versioner av samma dokument.

Med --trash --yes kan exakta dubbletter flyttas till Google Drives
papperskorg (en fil per grupp behålls). Utan --yes är --trash en
dry-run som bara visar vad som skulle tas bort.

Se README.md för instruktioner om hur man skapar autentiseringsuppgifter.
"""

from __future__ import annotations

import argparse
import csv
import json
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterator

from google.auth.transport.requests import Request
from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
from googleapiclient.discovery import build
from googleapiclient.errors import HttpError

SCOPES = ["https://www.googleapis.com/auth/drive"]
FOLDER_MIME = "application/vnd.google-apps.folder"
PDF_MIME = "application/pdf"

FIELDS = "nextPageToken, files(id, name, md5Checksum, size, parents, webViewLink, modifiedTime, trashed)"


def get_credentials(credentials_path: Path, token_path: Path) -> Credentials:
    creds: Credentials | None = None
    if token_path.exists():
        creds = Credentials.from_authorized_user_file(str(token_path), SCOPES)
    if not creds or not creds.valid:
        if creds and creds.expired and creds.refresh_token:
            creds.refresh(Request())
        else:
            if not credentials_path.exists():
                sys.exit(
                    f"Hittar inte {credentials_path}. Se README.md för hur du "
                    "skapar OAuth-uppgifter i Google Cloud Console och laddar "
                    "ner filen som credentials.json."
                )
            flow = InstalledAppFlow.from_client_secrets_file(str(credentials_path), SCOPES)
            creds = flow.run_local_server(port=0)
        token_path.write_text(creds.to_json())
    return creds


def iter_subfolders(service: Any, folder_id: str) -> Iterator[str]:
    query = f"'{folder_id}' in parents and mimeType='{FOLDER_MIME}' and trashed=false"
    page_token = None
    while True:
        response = (
            service.files()
            .list(
                q=query,
                fields="nextPageToken, files(id)",
                pageToken=page_token,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            )
            .execute()
        )
        for f in response.get("files", []):
            yield f["id"]
        page_token = response.get("nextPageToken")
        if not page_token:
            break


def iter_pdfs_in_folder(service: Any, folder_id: str) -> Iterator[dict]:
    query = f"'{folder_id}' in parents and mimeType='{PDF_MIME}' and trashed=false"
    page_token = None
    while True:
        response = (
            service.files()
            .list(
                q=query,
                fields=FIELDS,
                pageToken=page_token,
                supportsAllDrives=True,
                includeItemsFromAllDrives=True,
            )
            .execute()
        )
        yield from response.get("files", [])
        page_token = response.get("nextPageToken")
        if not page_token:
            break


def collect_pdfs(service: Any, root_folder_id: str, recursive: bool) -> list[dict]:
    folders_to_scan = [root_folder_id]
    seen_folders = {root_folder_id}
    pdfs: list[dict] = []

    while folders_to_scan:
        current = folders_to_scan.pop()
        pdfs.extend(iter_pdfs_in_folder(service, current))
        if recursive:
            for sub_id in iter_subfolders(service, current):
                if sub_id not in seen_folders:
                    seen_folders.add(sub_id)
                    folders_to_scan.append(sub_id)

    return pdfs


def group_by_checksum(pdfs: list[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for f in pdfs:
        checksum = f.get("md5Checksum")
        if checksum:
            groups[checksum].append(f)
    return {k: v for k, v in groups.items() if len(v) > 1}


def group_by_name(pdfs: list[dict]) -> dict[str, list[dict]]:
    groups: dict[str, list[dict]] = defaultdict(list)
    for f in pdfs:
        groups[f["name"].strip().lower()].append(f)
    # Endast namngrupper där filerna INTE redan är exakta dubbletter
    # (dvs. de har olika checksumma) är intressanta att flagga separat.
    result = {}
    for name, files in groups.items():
        if len(files) > 1 and len({f.get("md5Checksum") for f in files}) > 1:
            result[name] = files
    return result


def format_size(num_bytes: str | None) -> str:
    if num_bytes is None:
        return "okänd storlek"
    n = int(num_bytes)
    for unit in ["B", "KB", "MB", "GB"]:
        if n < 1024:
            return f"{n:.0f}{unit}"
        n /= 1024
    return f"{n:.1f}TB"


def print_report(exact_dupes: dict[str, list[dict]], name_dupes: dict[str, list[dict]]) -> None:
    if not exact_dupes and not name_dupes:
        print("Inga dubbletter hittades.")
        return

    if exact_dupes:
        print(f"\n=== Exakta dubbletter (identiskt innehåll) — {len(exact_dupes)} grupp(er) ===\n")
        for i, (checksum, files) in enumerate(exact_dupes.items(), start=1):
            print(f"Grupp {i} ({len(files)} filer, md5={checksum}):")
            for f in files:
                size = format_size(f.get("size"))
                print(f"  - {f['name']} ({size}) — {f.get('webViewLink', f['id'])}")
            print()

    if name_dupes:
        print(f"\n=== Samma filnamn men olika innehåll — {len(name_dupes)} grupp(er) ===")
        print("(Kan vara omdöpta filer, uppdaterade versioner eller riktiga dubbletter — kontrollera manuellt)\n")
        for i, (name, files) in enumerate(name_dupes.items(), start=1):
            print(f"Grupp {i}: \"{files[0]['name']}\"")
            for f in files:
                size = format_size(f.get("size"))
                print(f"  - {f['name']} ({size}) md5={f.get('md5Checksum')} — {f.get('webViewLink', f['id'])}")
            print()


def write_output(path: Path, exact_dupes: dict[str, list[dict]], name_dupes: dict[str, list[dict]]) -> None:
    if path.suffix.lower() == ".json":
        data = {
            "exact_duplicates": [
                {"md5Checksum": k, "files": v} for k, v in exact_dupes.items()
            ],
            "same_name_different_content": [
                {"name": v[0]["name"], "files": v} for k, v in name_dupes.items()
            ],
        }
        path.write_text(json.dumps(data, indent=2, ensure_ascii=False))
    else:
        with path.open("w", newline="", encoding="utf-8") as fh:
            writer = csv.writer(fh)
            writer.writerow(["grupptyp", "grupp_id", "filnamn", "storlek_bytes", "md5", "fil_id", "lank"])
            for i, (checksum, files) in enumerate(exact_dupes.items(), start=1):
                for f in files:
                    writer.writerow(["exakt_dubblett", i, f["name"], f.get("size", ""), checksum, f["id"], f.get("webViewLink", "")])
            for i, (name, files) in enumerate(name_dupes.items(), start=1):
                for f in files:
                    writer.writerow(["samma_namn", i, f["name"], f.get("size", ""), f.get("md5Checksum", ""), f["id"], f.get("webViewLink", "")])
    print(f"Rapport skriven till {path}")


def pick_survivor(files: list[dict], keep: str) -> dict:
    def sort_key(f: dict) -> str:
        return f.get("modifiedTime") or ""

    ordered = sorted(files, key=sort_key)
    return ordered[0] if keep == "oldest" else ordered[-1]


def trash_duplicates(service: Any, exact_dupes: dict[str, list[dict]], keep: str, execute: bool) -> None:
    if not exact_dupes:
        print("Inga exakta dubbletter att papperskorga.")
        return

    to_trash: list[dict] = []
    for files in exact_dupes.values():
        survivor = pick_survivor(files, keep)
        to_trash.extend(f for f in files if f["id"] != survivor["id"])

    if not to_trash:
        return

    action = "Papperskorgar" if execute else "SKULLE papperskorga (dry-run, lägg till --yes för att köra)"
    print(f"\n=== {action} {len(to_trash)} fil(er), behåller {keep} fil per grupp ===\n")
    for f in to_trash:
        print(f"  - {f['name']} ({format_size(f.get('size'))}) — {f.get('webViewLink', f['id'])}")
        if execute:
            try:
                service.files().update(fileId=f["id"], body={"trashed": True}, supportsAllDrives=True).execute()
            except HttpError as err:
                print(f"    FEL: kunde inte papperskorga {f['name']}: {err}")

    if not execute:
        print("\nInget har tagits bort. Kör igen med --trash --yes för att flytta filerna ovan till papperskorgen.")
    else:
        print("\nKlart. Filerna ligger i Google Drives papperskorg och kan återställas därifrån vid behov.")


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("folder_id", help="ID för Google Drive-mappen som ska genomsökas")
    parser.add_argument(
        "--recursive", action="store_true", help="Sök även igenom undermappar"
    )
    parser.add_argument(
        "--credentials",
        type=Path,
        default=Path("credentials.json"),
        help="Sökväg till OAuth client secret-fil (default: credentials.json)",
    )
    parser.add_argument(
        "--token",
        type=Path,
        default=Path("token.json"),
        help="Sökväg där åtkomsttoken sparas mellan körningar (default: token.json)",
    )
    parser.add_argument(
        "--output",
        type=Path,
        help="Skriv rapport till fil (.csv eller .json) utöver terminalutskrift",
    )
    parser.add_argument(
        "--trash",
        action="store_true",
        help=(
            "Flytta exakta dubbletter till papperskorgen, en fil per grupp behålls. "
            "Utan --yes visas bara vad som SKULLE tas bort (dry-run). "
            "Namngrupper (samma namn, olika innehåll) papperskorgas aldrig automatiskt."
        ),
    )
    parser.add_argument(
        "--keep",
        choices=["oldest", "newest"],
        default="oldest",
        help="Vilken fil i varje dubblettgrupp som ska behållas (default: oldest)",
    )
    parser.add_argument(
        "--yes",
        action="store_true",
        help="Bekräfta att --trash faktiskt ska utföras, inte bara dry-run",
    )
    args = parser.parse_args()

    creds = get_credentials(args.credentials, args.token)
    service = build("drive", "v3", credentials=creds)

    print(f"Söker igenom mapp {args.folder_id}"
          f"{' (rekursivt)' if args.recursive else ''} efter PDF-filer...")

    try:
        pdfs = collect_pdfs(service, args.folder_id, args.recursive)
    except HttpError as err:
        sys.exit(f"Fel vid anrop till Google Drive API: {err}")

    print(f"Hittade {len(pdfs)} PDF-filer totalt.")

    exact_dupes = group_by_checksum(pdfs)
    name_dupes = group_by_name(pdfs)

    print_report(exact_dupes, name_dupes)

    if args.output:
        write_output(args.output, exact_dupes, name_dupes)

    if args.trash:
        trash_duplicates(service, exact_dupes, args.keep, execute=args.yes)


if __name__ == "__main__":
    main()
