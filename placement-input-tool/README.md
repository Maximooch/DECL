# Placement input tool

This is a small Google Apps Script sidebar for the `RandomPercent_Tourney_Example.xlsx` layout.

## Install in Google Sheets

1. Open the workbook with edit access. If it is still an `.xlsx`, use **File → Save as Google Sheets**.
2. Open **Extensions → Apps Script**.
3. Replace the default script with the contents of `Code.gs`.
4. Add an HTML file named `Index` and paste in `Index.html`.
5. Save and reload the spreadsheet.
6. Choose **Placement Tool → Authorize / test connection** and approve access.
7. Choose **Placement Tool → Open placement input**.

Do not open `Index.html` directly from Finder or as a `file://` page; that is only a visual preview and cannot access the spreadsheet. The working version must be opened as the sidebar from the spreadsheet's **Placement Tool** menu.

## Input format

Paste results in ranked-list form. You can include multiple `Map:` blocks in one submission:

```text
Round 1:

Map: Skylands

1. Maximoochie
2. Supermoar
3. Ryxei
4. Paris_Labrador
5. Bluwu
6. CraftainJulius (no tas qj)
7. Kingowiec
8. XXC
9. ThatGuyIsWill
```

The tool ignores `Round 1:` and parenthetical notes. It writes the numbered placements under the matching map header. Players omitted from a map block are cleared to blank/DNF for that map; other maps are left unchanged.

In the sidebar, press **Shift+Enter** after a `Map:` line to insert `1.`, then press **Shift+Enter** after each numbered player to insert the next number automatically. Use **Test connection** to distinguish sidebar/browser transport failures from placement validation errors; technical details print beneath the buttons.

## Safari-safe fallback

If Safari prevents the sidebar from calling Apps Script:

1. Use the sidebar to type and auto-number the results, then click **Copy input**.
2. Choose **Placement Tool → Open Safari-safe input sheet**.
3. Select cell `A4` and paste. Multiple lines may fill multiple rows; both layouts are supported.
4. Choose **Placement Tool → Apply from input sheet**.

This path runs from the spreadsheet menu and does not use `google.script.run`.

The older one-line format is also supported:

```text
Supermoar | 1, 8, 3, 9, 6, 3, 1, -, 6, 2, 2, 11, -, 3, 2, 1, 8, 4, 2
```

Use `-`, `DNF`, or an empty comma slot for a blank/DNF cell in the older format. The tool validates map names, player names, and placement lines before changing anything.
