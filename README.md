# @verificrca/sdk: API verificare RCA, ITP, rovinietă și ARR pentru Node.js

[![npm](https://img.shields.io/npm/v/@verificrca/sdk.svg)](https://www.npmjs.com/package/@verificrca/sdk)
[![licență MIT](https://img.shields.io/npm/l/@verificrca/sdk.svg)](./LICENSE)
[![tipuri TypeScript](https://img.shields.io/npm/types/@verificrca/sdk.svg)](https://www.npmjs.com/package/@verificrca/sdk)

SDK-ul oficial Node.js și TypeScript pentru [API-ul verificrca.ro](https://www.verificrca.ro/api-acces). Cu el verifici din cod dacă o mașină are RCA valabil, ITP la zi, rovinietă plătită sau copie conformă ARR, după numărul de înmatriculare sau seria de șasiu (VIN). Datele vin din sursele oficiale: baza AIDA pentru asigurarea RCA, RAR pentru inspecția tehnică periodică, CNAIR pentru rovinietă și ARR pentru transportul rutier.

Pe lângă verificările la cerere, SDK-ul gestionează vehiculele monitorizate din cont și citește webhook-urile trimise când un document se apropie de expirare. Dacă ai o firmă de leasing, rent-a-car sau curierat, un service auto ori pur și simplu o flotă, afli din timp ce RCA, ITP sau rovinietă expiră, înainte să vină amenda.

> Ai nevoie de o cheie API (`vrca_...`). O generezi din [contul tău verificrca.ro](https://www.verificrca.ro/dashboard/api), după ce alegi un plan de pe [pagina API](https://www.verificrca.ro/api-acces).

```ts
import { VerificRca } from "@verificrca/sdk"

const vrca = new VerificRca({ apiKey: process.env.VERIFICRCA_API_KEY })

const rca = await vrca.verificari.verificaSiAsteapta({ tip: "rca", query: "B123ABC" })
console.log(rca.status, rca.expiresAt) // "valid" 2027-03-01T00:00:00.000Z
```

## Cuprins

- [Ce face SDK-ul](#ce-face-sdk-ul)
- [Instalare](#instalare)
- [Pornire rapidă](#pornire-rapidă)
- [Ce identificator cere fiecare verificare](#ce-identificator-cere-fiecare-verificare)
- [Cum decurge o verificare](#cum-decurge-o-verificare)
- [Referință API](#referință-api)
- [Webhook-uri](#webhook-uri)
- [Erori](#erori)
- [Reîncercări, backoff și timeout](#reîncercări-backoff-și-timeout)
- [Cotă și limite](#cotă-și-limite)
- [Exemple](#exemple)
- [Întrebări frecvente](#întrebări-frecvente)

## Ce face SDK-ul

| Funcție | Ce primești |
|---|---|
| Verificare RCA după număr sau VIN | Starea poliței RCA și data expirării, din baza AIDA |
| Verificare ITP după VIN | Data până la care e valabilă inspecția tehnică, din RAR |
| Verificare rovinietă | Dacă rovinieta e plătită și până când, din CNAIR |
| Verificare copie conformă ARR | Valabilitatea copiei conforme pentru transportatori |
| Gestionare flotă | Adaugi, listezi și ștergi vehiculele monitorizate automat |
| Webhook-uri | Rezultatul verificării la URL-ul tău, alerte `document.expira` la 30, 14 și 3 zile |
| Validare locală | Numărul de înmatriculare și VIN-ul sunt verificate înainte de cerere, deci o greșeală de tastare nu consumă din cotă |
| Erori tipate | O clasă de eroare pentru fiecare situație, cu mesaj în română și `hint` de rezolvare |
| Reîncercări sigure | Backoff exponențial cu jitter, `Retry-After` respectat, niciun POST taxat de două ori |

## Instalare

```bash
npm install @verificrca/sdk
# sau
pnpm add @verificrca/sdk
# sau
yarn add @verificrca/sdk
```

Cheia API o poți da direct în constructor sau prin variabila de mediu `VERIFICRCA_API_KEY`:

```bash
export VERIFICRCA_API_KEY=vrca_xxxxxxxxxxxxxxxx
```

Nu pune cheia în cod care ajunge în browser. Cheia dă acces la cota contului tău și la vehiculele din el, deci o folosești doar pe server.

## Pornire rapidă

### Verificare RCA după număr de înmatriculare

```ts
import { VerificRca } from "@verificrca/sdk"

const vrca = new VerificRca() // citește VERIFICRCA_API_KEY

const rca = await vrca.verificari.verificaSiAsteapta({ tip: "rca", query: "B 123 ABC" })

if (rca.status === "expired") {
	console.log("Mașina nu are RCA valabil.")
} else if (rca.status === "warning") {
	console.log(`RCA-ul expiră curând, pe ${rca.expiresAt?.toLocaleDateString("ro-RO")}`)
}
```

Pentru RCA îți recomandăm să trimiți și VIN-ul. Baza AIDA găsește polița mai sigur după seria de șasiu, iar uneori o poliță emisă pe VIN nu apare la căutarea după număr:

```ts
await vrca.verificari.verificaSiAsteapta({ tip: "rca", query: "B123ABC", serieSasiu: "WVWZZZ1JZXW000001" })
```

### Verificare ITP după serie de șasiu

```ts
const itp = await vrca.verificari.verificaSiAsteapta({ tip: "itp", query: "WVWZZZ1JZXW000001" })
console.log(`ITP valabil până la ${itp.expiresAt?.toLocaleDateString("ro-RO")}`)
```

### Verificare rovinietă

```ts
const rovinieta = await vrca.verificari.verificaSiAsteapta({
	tip: "rovinieta",
	query: "B123ABC",
	serieSasiu: "WVWZZZ1JZXW000001",
})
```

### Verificare copie conformă ARR

```ts
const arr = await vrca.verificari.verificaSiAsteapta({ tip: "arr", query: "CJ45XYZ" })
```

## Ce identificator cere fiecare verificare

Fiecare sursă oficială caută după alt identificator. SDK-ul aplică aceleași reguli ca API-ul și te oprește înainte de cerere dacă lipsește ceva.

| `tip` | `query` | `serieSasiu` | Sursa |
|---|---|---|---|
| `rca` | număr de înmatriculare **sau** VIN | opțional, recomandat | AIDA / BAAR |
| `itp` | VIN (17 caractere) | nu | RAR |
| `rovinieta` | număr de înmatriculare | **obligatoriu** | CNAIR |
| `arr` | număr de înmatriculare | nu | ARR |

Formatele de număr acceptate: București (`B123ABC`, `B12ABC`), județe (`CJ45XYZ`, `IS08BCD`), corp diplomatic (`CD123A`) și numere temporare (`TC1234AB`). Spațiile și cratimele sunt eliminate automat, deci `b-123 abc` devine `B123ABC`. VIN-ul trebuie să aibă exact 17 caractere, fără literele I, O și Q (standardul ISO 3779).

## Cum decurge o verificare

1. **Cerere** (`porneste`). Dacă există un rezultat recent pentru mașina respectivă, îl primești imediat. Altfel verificarea intră în coadă și primești `status: "processing"`.
2. **Interogarea sursei.** Sursa oficială e consultată în fundal. Dacă nu răspunde în 4 minute, verificarea se încheie cu eroare.
3. **Rezultatul** ajunge la tine pe una din trei căi:
   - `verificaSiAsteapta()` face tot drumul și întoarce direct rezultatul final;
   - `rezultat()` sau `asteapta()` fac polling, fără să consume din cotă;
   - webhook: dacă trimiți `callbackUrl`, API-ul face POST cu rezultatul la adresa ta.

Doar pasul 1 consumă din cota planului. Interogările de rezultat sunt gratuite.

### Statusuri

| `status` | Înseamnă | `expiresAt` |
|---|---|---|
| `valid` | Document valabil | data expirării |
| `warning` | Expiră curând: RCA în 14 zile, ITP în 30, rovinietă în 7, ARR în 14 | data expirării |
| `expired` | Expirat sau inexistent, confirmat de sursă | data expirării sau `null` |
| `not_found` | Sursa nu a găsit vehiculul | `null` |
| `processing` | Verificarea e încă în curs | nu există |

Când sursa oficială nu răspunde, SDK-ul aruncă `EroareVerificare` și poți relua cererea.

## Referință API

### `new VerificRca(optiuni?)`

| Opțiune | Tip | Implicit | Descriere |
|---|---|---|---|
| `apiKey` | `string` | `process.env.VERIFICRCA_API_KEY` | Cheia API `vrca_...` |
| `baseUrl` | `string` | `https://www.verificrca.ro` | Adresa API-ului |
| `timeoutMs` | `number` | `30000` | Timeout pe fiecare cerere HTTP |
| `retry` | `object \| false` | `{ incercari: 3, intarziereInitialaMs: 500, intarziereMaximaMs: 10000 }` | Politica de reîncercare; `false` o oprește |
| `fetch` | `typeof fetch` | `globalThis.fetch` | Alt `fetch` (proxy, agent HTTP, teste) |
| `userAgent` | `string` | | Adăugat la `User-Agent`, util în loguri |

Constructorul aruncă `EroareConfigurare` dacă lipsește cheia sau dacă o opțiune e invalidă.

Toate metodele primesc ca ultim argument `{ signal?: AbortSignal }`. Cu el poți anula cererea împreună cu reîncercările și așteptarea ei.

### `verificari.porneste(cerere)`

Pornește o verificare și **consumă o unitate din cotă**. Întoarce fie rezultatul final (dacă există unul recent), fie un obiect `VerificareInCurs` pe care îl poți da mai departe la `rezultat()` sau `asteapta()`.

```ts
const r = await vrca.verificari.porneste({
	tip: "itp",
	query: "WVWZZZ1JZXW000001",
	callbackUrl: "https://example.com/webhooks/verificrca/9f3k2", // opțional
})

if (r.status === "processing") {
	console.log("În coadă, requestId:", r.requestId)
	const final = await vrca.verificari.asteapta(r)
}
```

### `verificari.rezultat(referinta)`

Interoghează o singură dată. Nu consumă din cotă. Primește obiectul întors de `porneste()` sau `{ tip, query, serieSasiu?, since? }`.

### `verificari.asteapta(referinta, optiuni?)`

Face polling până la rezultatul final. Opțiuni: `intervalMs` (implicit 3000, minim 2000) și `timeoutMs` (implicit 5 minute). La depășire aruncă `EroareTimeoutVerificare`.

### `verificari.verificaSiAsteapta(cerere, optiuni?)`

`porneste()` urmat de `asteapta()`, într-un singur apel. E calea cea mai simplă pentru scripturi și joburi cron.

### `vehicule.lista()`

Toate vehiculele din cont, cu datele de expirare `rcaExpiraLa`, `itpExpiraLa`, `rovinietaExpiraLa` și `arrExpiraLa` (ca `Date` sau `null`). Câmpul `activ` e `true` cât timp vehiculul e verificat automat și primește notificări de expirare. Vehiculele din cont sunt verificate automat și periodic, deci lista îți dă o imagine la zi a flotei fără să consume din cota de verificări.

### `vehicule.adauga({ numarInmatriculare?, serieSasiu?, arrMonitorizat? })`

Adaugă un vehicul în monitorizare. Trimite cel puțin un identificator. Poți primi `EroareInterzis` cu `cod: "LIMIT_ATINS"` când ai atins numărul de mașini din plan, sau `EroareConflict` când vehiculul există deja.

### `vehicule.sterge(id)`

Scoate vehiculul din cont. Aruncă `EroareNegasit` dacă ID-ul nu există în contul cheii.

Operațiile pe vehicule nu consumă din cota de verificări, dar cer un plan activ.

### Utilitare de validare

```ts
import { esteNumarInmatriculareValid, esteVinValid, normalizeaza } from "@verificrca/sdk"

esteNumarInmatriculareValid("CJ 45 XYZ") // true
esteVinValid("WVWZZZ1JZXW00000I")        // false: litera I nu e permisă în VIN
normalizeaza(" b-123 abc ")              // "B123ABC"
```

Le poți folosi pentru formularele tale, ca să validezi datele înainte să ajungă la server.

### Constante exportate

| Constantă | Valoare |
|---|---|
| `TIPURI_VERIFICARE` | `["rca", "itp", "rovinieta", "arr"]`, util pentru dropdown-uri și validare |
| `HEADER_CHEIE_WEBHOOK` | `"x-verificrca-key"`, headerul cu cheia de webhook |
| `HEADER_EVENIMENT_WEBHOOK` | `"x-verificrca-event"`, headerul cu numele evenimentului |
| `URL_IMPLICIT` | `"https://www.verificrca.ro"` |
| `VERSIUNE_SDK` | versiunea pachetului, trimisă în `User-Agent` |

### Documentația completă a tipurilor

Fiecare metodă, câmp și clasă de eroare are documentație JSDoc, cu parametri, valoare întoarsă, erorile posibile și un exemplu. O vezi direct în editor, la hover. Ca s-o generezi ca site HTML, rulează `pnpm docs` în repo; rezultatul ajunge în `docs/`.

## Webhook-uri

API-ul trimite două feluri de webhook. SDK-ul le validează cu scheme stricte și îți dă obiecte tipate, cu datele ca `Date`.

### Rezultatul unei verificări (`callbackUrl`)

Când trimiți `callbackUrl` la `porneste()`, primești un POST cu rezultatul imediat ce e gata. Dacă sursa nu răspunde, primești `status: "error"`.

```ts
import { parseazaWebhookRezultat } from "@verificrca/sdk"

app.post("/webhooks/verificrca/9f3k2", express.raw({ type: "application/json" }), (req, res) => {
	const r = parseazaWebhookRezultat(req.body) // string, Buffer sau obiect
	if (r.status !== "error") salveaza(r.requestId, r.result?.expiresAt)
	res.sendStatus(200)
})
```

Pune un segment greu de ghicit în URL, păstrează-l pe HTTPS și verifică dacă `requestId`-ul primit corespunde celui întors de `porneste()` înainte să te bazezi pe conținut.

### Notificări de expirare (`document.expira`)

Pe planurile care includ webhook-uri, configurezi un URL în dashboard și primești câte un eveniment când un document al unui vehicul monitorizat intră într-un prag de expirare. Pentru RCA, ITP și rovinietă pragurile sunt 30, 14 și 3 zile, iar pentru ARR 60, 50 și 45 de zile. Fiecare cerere vine cu cheia contului în headerul `X-Verificrca-Key`. SDK-ul o compară în timp constant, ca să nu dezvăluie nimic prin durata comparației:

```ts
import { verificaWebhookNotificare, EroareWebhook } from "@verificrca/sdk"

app.post("/webhooks/verificrca", express.raw({ type: "application/json" }), (req, res) => {
	try {
		const ev = verificaWebhookNotificare(req.body, req.headers, { cheie: process.env.VERIFICRCA_WEBHOOK_KEY! })
		if (ev.event === "document.expira") {
			trimiteAlerta(`${ev.vehicul.numarInmatriculare}: ${ev.document} expiră în ${ev.zileRamase} zile`)
		}
		res.sendStatus(200)
	} catch (err) {
		res.sendStatus(err instanceof EroareWebhook ? 401 : 500)
	}
})
```

Folosește `ev.id` pentru deduplicare. Un eveniment poate ajunge de mai multe ori dacă serverul tău nu răspunde cu 2xx. Butonul de test din dashboard trimite `event: "webhook.test"`.

## Erori

Toate erorile moștenesc `VerificRcaError`, care la rândul ei moștenește `Error`. Fiecare are `_tag`, `message` (în română), plus `status`, `cod`, `hint` și `raspuns` când vin de la API.

| Clasă | Când apare | Câmpuri utile |
|---|---|---|
| `EroareConfigurare` | Cheie lipsă sau opțiuni invalide | |
| `EroareValidare` | Date greșite, local sau HTTP 400 | `camp`, `acceptate` |
| `EroareAutentificare` | 401: cheie invalidă sau dezactivată | `hint` |
| `EroarePlanInactiv` | 402: fără abonament activ | `hint` |
| `EroareInterzis` | 403: `LIMIT_ATINS`, `ARR_NECESITA_PLAN` | `cod`, `limita` |
| `EroareNegasit` | 404: vehicul inexistent în cont | |
| `EroareConflict` | 409: `VEHICUL_EXISTENT` | |
| `EroareLimita` | 429: cotă, plafon de flotă sau polling prea des | `cod`, `retryAfterMs`, `utilizareZi`, `utilizareLuna` |
| `EroareServer` | 5xx | `status` |
| `EroareRetea` | Fără răspuns sau timeout | `timeout`, `neajunsa` |
| `EroareRaspunsInvalid` | Răspuns cu formă neașteptată | `raspuns` |
| `EroareVerificare` | Sursa oficială nu a putut fi interogată | |
| `EroareTimeoutVerificare` | `asteapta()` a depășit `timeoutMs` | |
| `EroareWebhook` | Cheie greșită sau payload invalid | `cod` |

```ts
import { EroareLimita, EroareValidare, VerificRcaError } from "@verificrca/sdk"

try {
	await vrca.verificari.porneste({ tip: "rca", query: numar })
} catch (err) {
	if (err instanceof EroareValidare) return arataUtilizatorului(err.message)
	if (err instanceof EroareLimita && err.cod === "COTA_ATINSA") return amanaPanaMaine()
	if (err instanceof VerificRcaError) logger.error(err._tag, err.message, err.hint)
	throw err
}
```

## Reîncercări, backoff și timeout

Erorile trecătoare sunt reîncercate automat, cu backoff exponențial (x2) și jitter, plafonat la `intarziereMaximaMs`. Când serverul trimite `Retry-After`, pauza nu coboară sub valoarea cerută.

SDK-ul nu trimite niciodată de două ori o verificare taxată.

| Situație | GET / DELETE | POST |
|---|---|---|
| Rețea căzută, timeout | se reîncearcă | nu (cererea poate să fi ajuns) |
| DNS, conexiune refuzată | se reîncearcă | se reîncearcă (sigur nu a ajuns) |
| 502, 503, 504 | se reîncearcă | se reîncearcă (proxy, nu aplicația) |
| 500 | se reîncearcă | nu |
| 429 la polling | se reîncearcă după `Retry-After` | |
| 429 cotă sau plafon flotă | nu | nu |
| 4xx | nu | nu |

```ts
const vrca = new VerificRca({
	timeoutMs: 15_000,
	retry: { incercari: 5, intarziereInitialaMs: 250, intarziereMaximaMs: 8_000 },
})
```

## Cotă și limite

Fiecare `porneste()` consumă o unitate din cota zilnică și lunară a planului. Dacă mașina a fost verificată de curând, primești imediat rezultatul existent. Cererea tot consumă din cotă.

Rezultatele au câmpul `limite`, completat din headerele `X-RateLimit-*`:

```ts
const r = await vrca.verificari.porneste({ tip: "rca", query: "B123ABC" })
console.log(r.limite) // { zi: { limita: 300, ramase: 287 }, luna: { limita: 10000, ramase: 9412 } }
```

Cota zilnică se resetează la miezul nopții. Limitele fiecărui plan le găsești pe [pagina API](https://www.verificrca.ro/api-acces).

## Exemple

Folderul [`examples/`](./examples) conține scripturi gata de rulat:

- [`verificare-rca.ts`](./examples/verificare-rca.ts): verificare RCA cu număr și VIN, tratarea erorilor;
- [`flota.ts`](./examples/flota.ts): raport cu RCA, ITP, rovinietă și ARR care expiră în 30 de zile, pentru toată flota;
- [`webhook-server.ts`](./examples/webhook-server.ts): server `node:http` care primește ambele tipuri de webhook.

### Verificare în masă

```ts
const numere = ["B123ABC", "CJ45XYZ", "IS08BCD"]

const rezultate = await Promise.allSettled(
	numere.map((query) => vrca.verificari.verificaSiAsteapta({ tip: "rca", query })),
)
```

Pentru liste mari, adaugă vehiculele în cont cu `vehicule.adauga()`. Sunt monitorizate automat și primești notificările de expirare, fără să consumi din cota de verificări.

## Întrebări frecvente

### Cum verific RCA-ul unei mașini din Node.js?

Instalezi `@verificrca/sdk`, creezi un client cu cheia API și apelezi `verificari.verificaSiAsteapta({ tip: "rca", query: "B123ABC" })`. Primești statusul poliței și data expirării, din baza de date AIDA.

### Pot verifica ITP-ul după numărul de înmatriculare?

Nu. RAR caută inspecția tehnică periodică doar după seria de șasiu (VIN), așa că SDK-ul respinge cererea înainte să plece, fără să consume din cotă. VIN-ul îl găsești în talon, la rubrica E.

### De unde vin datele?

Din sursele oficiale: AIDA (baza de date a asigurărilor RCA administrată de BAAR), Registrul Auto Român pentru ITP, CNAIR pentru rovinietă și Autoritatea Rutieră Română pentru copia conformă. Nu estimăm nimic: fiecare rezultat e exact ce a răspuns sursa.

### De ce o poliță RCA nouă apare ca expirată?

Asigurătorul are nevoie de timp ca să înregistreze polița nouă în AIDA, de obicei între 1 și 7 zile. În acest interval verificarea poate arăta polița veche. Detalii în articolul despre [amenzile pentru RCA expirat](https://www.verificrca.ro/postari/amenzi-rca-expirat-2026).

### Merge în browser?

Tehnic da, dar nu trebuie să-l folosești acolo, pentru că ar expune cheia API. Folosește-l pe server (Node.js, Next.js route handlers, funcții serverless) și trimite spre browser doar rezultatul.

### Există SDK pentru PHP sau Python?

Urmează. Până atunci, [documentația API](https://www.verificrca.ro/api-acces) are exemple pentru cURL, PHP și Python.

## Linkuri utile

- [Documentația API verificrca.ro](https://www.verificrca.ro/api-acces)
- [Verificare RCA online](https://www.verificrca.ro/verificare-rca)
- [Verificare ITP online](https://www.verificrca.ro/verificare-itp)
- [Verificare rovinietă online](https://www.verificrca.ro/verificare-rovinieta)
- [Monitorizare flote auto](https://www.verificrca.ro/flote)
- [Changelog](./CHANGELOG.md)

## Dezvoltare

```bash
pnpm install
pnpm test        # teste unitare, fără rețea
pnpm test:e2e    # teste pe API-ul real
```

Testele e2e citesc configurarea din `.env.e2e`, fișier ignorat de git. Pornești de la șablon:

```bash
cp .env.e2e.example .env.e2e
```

Fără cheie rulează doar testul de autentificare. Cu `VERIFICRCA_API_KEY` se adaugă listarea vehiculelor, care e gratuită. Verificările reale (`VERIFICRCA_E2E_VERIFICARI=1`) consumă din cotă, iar testul de flotă (`VERIFICRCA_E2E_FLOTA=1`) adaugă și șterge un vehicul. Amândouă pornesc doar dacă le activezi explicit.

## Licență

[MIT](./LICENSE), © verificrca.ro
