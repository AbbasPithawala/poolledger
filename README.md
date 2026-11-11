# Pool Ledger

Offline ledger for a shop owner: several money pools ("sources"), loans between them, settlements,
PDF/Excel export and JSON backup. React Native + Expo, data in AsyncStorage (`ledger_v1`). No backend.

## Files
- `App.js` – all screens and UI (Google Cloud console style).
- `ledger.js` – pure logic (balances, nets, transfers, settle, backup parsing). No React.
- `exports.js` – builds the PDF HTML and the Excel rows.
- `ledger.test.mjs`, `exports.test.mjs` – tests (worked examples from the brief, section 13).

## Run
```bash
npm install
npm test            # logic tests
npx expo start      # scan the QR code with Expo Go on Android
```

## Build the APK
```bash
npm install -g eas-cli
eas login
eas build -p android --profile preview
```
`android.package` is `com.abbas.ledger`. **Never change it**, or a new APK will not install over the
old one and the data is lost. Uninstalling the app erases all data, so use *Export backup* regularly.

## Entries, filter and downloads
- Every entry (and settlement) needs a **payment type**, Cash or UPI. **Profit** is optional and only
  for plain credit/debit entries. Entries saved before this feature show a dash under Payment.
- The source table has a **Show: All / Cash / UPI** filter. PDF and Excel exports follow the filter.
- Exports and backups are **saved to a folder on the phone**, not shared. The first time, create a
  folder inside Download (Android does not allow Download itself), for example `Pool Ledger`, and tap
  "Use this folder". It is remembered; the Saved message has a button to pick another folder.

## Choices made where the brief was open
- Credit amounts are green, debit amounts red.
- Export covers the whole history of the source, or only the Cash / UPI rows when that filter is on.
- A source can be deleted once nothing is owed to or by it; its entries go with it.
