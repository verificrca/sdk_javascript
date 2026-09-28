import { Effect, Either, ParseResult, Schema } from "effect"
import { EroareWebhook } from "./errors.js"
import {
	WebhookNotificareSchema,
	WebhookRezultatSchema,
	type WebhookNotificare,
	type WebhookRezultat,
} from "./schemas.js"

/** Headerul cu cheia de webhook a contului (`whsec_...`). */
export const HEADER_CHEIE_WEBHOOK = "x-verificrca-key"
/** Headerul cu numele evenimentului (`document.expira`, `webhook.test`). */
export const HEADER_EVENIMENT_WEBHOOK = "x-verificrca-event"

/** Headerele unei cereri, fie `Headers` (fetch, Next.js), fie obiectul din Node/Express. */
export type HeadereCerere = Headers | Readonly<Record<string, string | readonly string[] | undefined>>

function citesteHeader(headers: HeadereCerere, nume: string): string | undefined {
	if (typeof (headers as Headers).get === "function") return (headers as Headers).get(nume) ?? undefined
	const obiect = headers as Readonly<Record<string, string | readonly string[] | undefined>>
	for (const [cheie, valoare] of Object.entries(obiect)) {
		if (cheie.toLowerCase() !== nume) continue
		return typeof valoare === "string" ? valoare : valoare?.[0]
	}
	return undefined
}

/** Comparatie in timp constant, ca durata sa nu dezvaluie cheia. */
function egaleConstant(a: string, b: string): boolean {
	const ea = new TextEncoder().encode(a)
	const eb = new TextEncoder().encode(b)
	let diferenta = ea.length ^ eb.length
	const lungime = Math.max(ea.length, eb.length)
	for (let i = 0; i < lungime; i++) diferenta |= (ea[i] ?? 0) ^ (eb[i] ?? 0)
	return diferenta === 0
}

const parseazaCorp = (corp: unknown): Effect.Effect<unknown, EroareWebhook> => {
	if (typeof corp !== "string" && !(corp instanceof Uint8Array)) return Effect.succeed(corp)
	const text = typeof corp === "string" ? corp : new TextDecoder().decode(corp)
	return Effect.try({
		try: () => JSON.parse(text) as unknown,
		catch: (err) => new EroareWebhook({ message: "Corpul webhook-ului nu e JSON valid.", cod: "JSON_INVALID", cause: err }),
	})
}

const decodeazaWebhook =
	<A, I>(schema: Schema.Schema<A, I>) =>
	(corp: unknown): Effect.Effect<A, EroareWebhook> =>
		Schema.decodeUnknown(schema)(corp).pipe(
			Effect.mapError(
				(err) =>
					new EroareWebhook({
						message: `Payload webhook invalid: ${ParseResult.TreeFormatter.formatErrorSync(err)}`,
						cod: "PAYLOAD_INVALID",
						raspuns: corp,
						cause: err,
					}),
			),
		)

function ruleaza<A>(efect: Effect.Effect<A, EroareWebhook>): A {
	const rezultat = Effect.runSync(Effect.either(efect))
	if (Either.isLeft(rezultat)) throw rezultat.left
	return rezultat.right
}

/**
 * Citeste rezultatul trimis la `callbackUrl` dupa o verificare.
 *
 * Foloseste un `callbackUrl` pe HTTPS, greu de ghicit (de exemplu cu un token
 * secret in cale), si potriveste `requestId` cu cel primit la `porneste()`
 * inainte sa ai incredere in continut.
 *
 * @param corp corpul cererii: string, Buffer/Uint8Array sau obiect deja parsat.
 * @returns rezultatul tipat, cu datele ca `Date`.
 * @throws {@link EroareWebhook} corpul nu e JSON (`JSON_INVALID`) sau nu e un rezultat valid (`PAYLOAD_INVALID`).
 * @example
 * app.post("/webhooks/verificrca/9f3k2", express.raw({ type: "application/json" }), (req, res) => {
 *   const r = parseazaWebhookRezultat(req.body)
 *   if (r.status !== "error") salveaza(r.requestId, r.result?.expiresAt)
 *   res.sendStatus(200)
 * })
 */
export function parseazaWebhookRezultat(corp: unknown): WebhookRezultat {
	return ruleaza(parseazaCorp(corp).pipe(Effect.flatMap(decodeazaWebhook(WebhookRezultatSchema))))
}

/** Optiunile pentru {@link verificaWebhookNotificare}. */
export interface OptiuniWebhookNotificare {
	/** Cheia de webhook din dashboard (`whsec_...`). */
	readonly cheie: string
}

/**
 * Verifica si citeste o notificare de expirare (`document.expira`) sau un test
 * (`webhook.test`) trimise la URL-ul de webhook al contului.
 *
 * Cheia vine in clar in headerul `X-Verificrca-Key` si e comparata in timp
 * constant cu cea din dashboard. Pastreaza URL-ul pe HTTPS.
 *
 * @param corp corpul cererii: string, Buffer/Uint8Array sau obiect deja parsat.
 * @param headers headerele cererii: `Headers` (fetch, Next.js) sau `req.headers` din Node/Express.
 * @param optiuni cheia de webhook din dashboard.
 * @returns evenimentul tipat; distinge-l dupa `event`.
 * @throws {@link EroareWebhook} cheia lipseste din optiuni (`CHEIE_NECONFIGURATA`), din header sau nu se
 *   potriveste (`CHEIE_INVALIDA`), ori payloadul e invalid (`JSON_INVALID`, `PAYLOAD_INVALID`).
 * @example
 * const ev = verificaWebhookNotificare(req.body, req.headers, { cheie: process.env.VERIFICRCA_WEBHOOK_KEY! })
 * if (ev.event === "document.expira") {
 *   console.log(`${ev.vehicul.numarInmatriculare}: ${ev.document} expira in ${ev.zileRamase} zile`)
 * }
 */
export function verificaWebhookNotificare(
	corp: unknown,
	headers: HeadereCerere,
	optiuni: OptiuniWebhookNotificare,
): WebhookNotificare {
	return ruleaza(
		Effect.gen(function* () {
			if (!optiuni.cheie) {
				return yield* Effect.fail(new EroareWebhook({ message: "Lipseste cheia de webhook din optiuni.", cod: "CHEIE_NECONFIGURATA" }))
			}
			const primita = citesteHeader(headers, HEADER_CHEIE_WEBHOOK)
			if (!primita || !egaleConstant(primita, optiuni.cheie)) {
				return yield* Effect.fail(
					new EroareWebhook({ message: "Cheia din headerul X-Verificrca-Key lipseste sau nu se potriveste.", cod: "CHEIE_INVALIDA" }),
				)
			}
			const json = yield* parseazaCorp(corp)
			return yield* decodeazaWebhook(WebhookNotificareSchema)(json)
		}),
	)
}
