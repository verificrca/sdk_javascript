import { Duration, Effect, Schedule } from "effect"
import { EroareTimeoutVerificare, EroareVerificare, type EroareCerere } from "../errors.js"
import { RaspunsVerificareSchema, RezultatVerificareSchema, type TipVerificare } from "../schemas.js"
import { valideazaCerereVerificare, type CerereVerificare } from "../validare.js"
import { decodeaza, trimite, type Raspuns, type Setari } from "./http.js"

const CALE = "/api/public/v1/verificare"

/** Cat mai ai din cota planului, din headerele `X-RateLimit-*`. */
export interface Limite {
	/** Cota zilnica; se reseteaza la miezul noptii. */
	readonly zi: {
		/** Verificari permise pe zi de plan. */
		readonly limita: number
		/** Verificari ramase azi, dupa aceasta cerere. */
		readonly ramase: number
	}
	/** Cota lunara. */
	readonly luna: {
		/** Verificari permise pe luna de plan. */
		readonly limita: number
		/** Verificari ramase luna aceasta, dupa aceasta cerere. */
		readonly ramase: number
	}
}

/** Rezultatul final al unei verificari. */
export type VerificareFinala = typeof RezultatVerificareSchema.Type & {
	/** Cota ramasa dupa aceasta cerere, cand API-ul o trimite. */
	readonly limite?: Limite
}

/**
 * Verificare pusa in coada: sursa oficiala e interogata acum. Paseaz-o la
 * `rezultat()` sau `asteapta()` ca sa afli raspunsul.
 */
export interface VerificareInCurs {
	/** Mereu `"processing"`: sursa oficiala e interogata acum. */
	readonly status: "processing"
	/** Tipul verificarii. */
	readonly tip: TipVerificare
	/** Identificatorul dupa care se face pollingul. */
	readonly query: string
	/** Seria de sasiu trimisa la polling; completata doar la rovinieta. */
	readonly serieSasiu: string | null
	/** Momentul (ms) de la care un rezultat e considerat nou. */
	readonly since: number
	/** Prezent cand ai trimis `callbackUrl`; apare si in webhook. */
	readonly requestId?: string
	/** Cand a intrat verificarea in coada. */
	readonly queuedAt?: Date
	/** Recomandarea API-ului, ex: sa trimiti si VIN-ul la RCA. */
	readonly hint?: string
	/** Cota ramasa dupa cererea POST. */
	readonly limite?: Limite
}

/**
 * Raspunsul la `porneste()` sau `rezultat()`: rezultatul final sau verificarea
 * in curs. Distinge-le dupa `status === "processing"`.
 */
export type RaspunsVerificare = VerificareFinala | VerificareInCurs

/** Ce trebuie ca sa interoghezi rezultatul unei verificari. */
export interface ReferintaVerificare {
	/** Tipul verificarii. */
	readonly tip: TipVerificare
	/** Identificatorul dupa care se face pollingul (la RCA cu VIN, VIN-ul). */
	readonly query: string
	/** Doar la rovinieta. */
	readonly serieSasiu?: string | null
	/**
	 * Momentul (ms) cererii POST. Fara el, orice rezultat din ultima perioada e
	 * acceptat, chiar daca e mai vechi decat cererea ta.
	 */
	readonly since?: number
}

/** Optiunile pentru `asteapta()` si `verificaSiAsteapta()`. */
export interface OptiuniAsteptare {
	/** Pauza intre doua interogari. Implicit 3000 ms, minim 2000 ms (plafonul API-ului). */
	readonly intervalMs?: number
	/** Cat asteptam in total. Implicit 5 minute. */
	readonly timeoutMs?: number
}

const INTERVAL_IMPLICIT_MS = 3_000
const INTERVAL_MINIM_MS = 2_000
const TIMEOUT_IMPLICIT_MS = 5 * 60_000

function limiteDin(raspuns: Raspuns): Limite | undefined {
	const h = raspuns.headers
	const numar = (nume: string) => {
		const v = h.get(nume)
		return v === null ? NaN : Number(v)
	}
	const valori = [
		numar("x-ratelimit-limit-day"),
		numar("x-ratelimit-remaining-day"),
		numar("x-ratelimit-limit-month"),
		numar("x-ratelimit-remaining-month"),
	] as const
	if (!valori.every(Number.isFinite)) return undefined
	return {
		zi: { limita: valori[0], ramase: valori[1] },
		luna: { limita: valori[2], ramase: valori[3] },
	}
}

/** Citeste `since` din `pollUrl`, ca pollingul sa foloseasca ceasul serverului. */
function sinceDinPollUrl(pollUrl: string | undefined): number | undefined {
	if (!pollUrl) return undefined
	const intrebare = pollUrl.indexOf("?")
	if (intrebare === -1) return undefined
	const since = Number(new URLSearchParams(pollUrl.slice(intrebare + 1)).get("since"))
	return Number.isFinite(since) && since > 0 ? since : undefined
}

const interpreteaza = (
	raspuns: Raspuns,
	serieSasiu: string | null,
	sinceImplicit: number | undefined,
): Effect.Effect<RaspunsVerificare, EroareCerere | EroareVerificare> =>
	decodeaza(RaspunsVerificareSchema)(raspuns).pipe(
		Effect.flatMap((corp): Effect.Effect<RaspunsVerificare, EroareVerificare> => {
			const limite = limiteDin(raspuns)
			if (corp.status === "error") {
				return Effect.fail(
					new EroareVerificare({ message: corp.error, cod: "VERIFICARE_ESUATA", raspuns: corp, ...(corp.hint && { hint: corp.hint }) }),
				)
			}
			if (corp.status === "processing") {
				const since = sinceDinPollUrl(corp.pollUrl) ?? sinceImplicit ?? Date.now()
				return Effect.succeed({
					status: "processing",
					tip: corp.tip,
					query: corp.query,
					serieSasiu: corp.tip === "rovinieta" ? serieSasiu : null,
					since,
					...(corp.requestId !== undefined && { requestId: corp.requestId }),
					...(corp.queuedAt !== undefined && { queuedAt: corp.queuedAt }),
					...(corp.hint !== undefined && { hint: corp.hint }),
					...(limite && { limite }),
				})
			}
			return Effect.succeed({ ...corp, ...(limite && { limite }) })
		}),
	)

/** POST: porneste verificarea. Consuma o unitate din cota planului. */
export const porneste = (
	cerere: CerereVerificare,
): Effect.Effect<RaspunsVerificare, EroareCerere | EroareVerificare, Setari> =>
	Effect.gen(function* () {
		const tinta = yield* valideazaCerereVerificare(cerere)
		const inainte = Date.now()
		const raspuns = yield* trimite({
			metoda: "POST",
			cale: CALE,
			idempotenta: false,
			body: {
				tip: tinta.tip,
				query: tinta.query,
				...(tinta.serieSasiu && { serieSasiu: tinta.serieSasiu }),
				...(tinta.callbackUrl && { callbackUrl: tinta.callbackUrl }),
			},
		})
		return yield* interpreteaza(raspuns, tinta.serieSasiu, inainte)
	})

/** GET: interogheaza rezultatul. Nu consuma din cota. */
export const rezultat = (
	ref: ReferintaVerificare,
): Effect.Effect<RaspunsVerificare, EroareCerere | EroareVerificare, Setari> =>
	Effect.gen(function* () {
		const raspuns = yield* trimite({
			metoda: "GET",
			cale: CALE,
			idempotenta: true,
			query: {
				tip: ref.tip,
				query: ref.query,
				serieSasiu: ref.tip === "rovinieta" && ref.serieSasiu ? ref.serieSasiu : undefined,
				since: ref.since !== undefined ? String(ref.since) : undefined,
			},
		})
		return yield* interpreteaza(raspuns, ref.serieSasiu ?? null, ref.since)
	})

/** Interogheaza periodic pana la rezultatul final. */
export const asteapta = (
	ref: ReferintaVerificare,
	optiuni: OptiuniAsteptare = {},
): Effect.Effect<VerificareFinala, EroareCerere | EroareVerificare | EroareTimeoutVerificare, Setari> => {
	const intervalMs = Math.max(INTERVAL_MINIM_MS, optiuni.intervalMs ?? INTERVAL_IMPLICIT_MS)
	const timeoutMs = optiuni.timeoutMs ?? TIMEOUT_IMPLICIT_MS

	return rezultat(ref).pipe(
		Effect.delay(Duration.millis(intervalMs)),
		// recurWhile intoarce ultimul raspuns, deci repeat-ul iese cu rezultatul final.
		Effect.repeat(
			Schedule.recurWhile<RaspunsVerificare>((r) => r.status === "processing").pipe(
				Schedule.addDelay(() => Duration.millis(intervalMs)),
			),
		),
		Effect.flatMap((r) =>
			r.status === "processing"
				? Effect.fail(new EroareTimeoutVerificare({ message: "Verificarea nu s-a finalizat." }))
				: Effect.succeed(r),
		),
		Effect.timeoutFail({
			duration: Duration.millis(timeoutMs),
			onTimeout: () =>
				new EroareTimeoutVerificare({
					message: `Verificarea ${ref.tip} pentru ${ref.query} nu s-a finalizat in ${Math.round(timeoutMs / 1000)} secunde.`,
					cod: "TIMEOUT_VERIFICARE",
				}),
		}),
	)
}

/** POST + asteptare: intoarce direct rezultatul final. */
export const verificaSiAsteapta = (
	cerere: CerereVerificare,
	optiuni: OptiuniAsteptare = {},
): Effect.Effect<VerificareFinala, EroareCerere | EroareVerificare | EroareTimeoutVerificare, Setari> =>
	porneste(cerere).pipe(
		Effect.flatMap((r) => (r.status === "processing" ? asteapta(r, optiuni) : Effect.succeed(r))),
	)
