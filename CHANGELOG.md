# Changelog

## 0.1.0 (2026-09-29)

Prima versiune.

- Client `VerificRca` cu `verificari.porneste`, `rezultat`, `asteapta` si `verificaSiAsteapta` pentru RCA, ITP, rovinieta si ARR.
- Gestionarea flotei: `vehicule.lista`, `adauga`, `sterge`.
- Webhook-uri: `parseazaWebhookRezultat` si `verificaWebhookNotificare` (cheie comparata in timp constant).
- Validare locala a numarului de inmatriculare si a VIN-ului, cu aceleasi reguli ca API-ul.
- Erori tipate, retry cu backoff exponential si jitter, `Retry-After` respectat, niciun POST taxat repetat.
- ESM si CommonJS, tipuri TypeScript complete, Node.js 18.17+.
