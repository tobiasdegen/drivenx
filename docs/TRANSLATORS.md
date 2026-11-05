# Translating DriveNX

**Reference language:** English (`locales/en-US.json`). The other built-in language is German (`locales/de-DE.json`). DriveNX uses BCP 47 locale IDs `en-US` and `de-DE` consistently in the renderer, main process, settings and translation filenames. On first start the system language is mapped to German or English; unsupported languages use English. Only these two catalogs are maintained. The selected UI locale also determines numeric and date formatting.

## Contributing a translation

1. Run `npm ci` if needed and `npm run translations:export`. This generates `translations-template.csv` from the English reference catalog.
2. Open the CSV with UTF-8 encoding (it includes a BOM). Translate only the **Translation** column, using the English source and context as guidance.
3. Preserve translation keys and all placeholders, for example `{count}`. Do not change SMART field IDs, device paths or protocol codes.
4. Submit the completed CSV with a proposed language code (such as `fr-FR`) in an issue or pull request. The CSV is an **exchange format**, not a loaded runtime catalog.
5. A maintainer must import the translation into `locales/<code>.json`, register the new language in the UI/settings and report locale handling, and extend the catalog parity tests. Translation alone does not enable a new language.

For changes to existing strings, edit **both** `locales/en-US.json` and `locales/de-DE.json` in the same pull request. Keep structural keys and placeholder sets identical. Validate with `npm run translations:check` and `npm run release:check`.

## Localization architecture

- The Renderer reads the catalogs in `src/i18n.mts`; the Electron main process reads them in `electron/ui/translator.js`.
- Errors intended for users generally use `userMessageKey` from `electron/security/user-errors.js` and are localized at the IPC boundary using the `backendErrors` catalog section.
- The `attributeGlossary` contains `ata.<ID>` and `nvme.<field>` keys with `label`, `description` and `interpretation`. The identifiers are **not** translated.
- Some technical messages and manufacturer data are intentionally shown verbatim; never fabricate a meaning or silently turn unknown data into a reassuring diagnosis.
- Reports and UI messages must communicate the same severity and limitations in each language.

For other contribution rules and data-handling precautions, see [CONTRIBUTING.md](../CONTRIBUTING.md).
