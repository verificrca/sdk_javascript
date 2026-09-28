import { Context, Duration, Effect, ParseResult, Schedule, Schema } from "effect"
import {
	EroareAutentificare,
	EroareConflict,
	EroareHttp,
	EroareInterzis,
	EroareLimita,
	EroareNegasit,
	EroarePlanInactiv,
	EroareRaspunsInvalid,
	EroareRetea,
	EroareServer,
	EroareValidare,
	type EroareCerere,
} from "../errors.js"
import { CorpEroareSchema } from "../schemas.js"

/**
 * Politica de reincercare pentru erorile trecatoare. Pauzele cresc exponential
 * (x2), cu jitter, si nu scad sub `Retry-After` cand serverul il trimite.
 */
export interface SetariRetry {
	/** Numarul maxim de reincercari dupa prima cerere. */
	readonly incercari: number
	/** Prima pauza; creste exponential (x2) cu jitter. */
	readonly intarziereInitialaMs: number
	/** Plafonul unei singure pauze. */
	readonly intarziereMaximaMs: number
}

export interface SetariClient {
	readonly apiKey: string
	readonly baseUrl: string
	readonly timeoutMs: number
	readonly retry: SetariRetry | null
	readonly fetch: typeof globalThis.fetch
	readonly userAgent: string
}

export class Setari extends Context.Tag("@verificrca/sdk/Setari")<Setari, SetariClient>() {}

export interface Cerere {
	readonly metoda: "GET" | "POST" | "DELETE"
	readonly cale: string
	readonly query?: Readonly<Record<string, string | undefined>>
	readonly body?: unknown
	/** Cererea poate fi repetata fara efecte in plus (GET, DELETE). */
	readonly idempotenta: boolean
}

export interface Raspuns {
	readonly status: number
	readonly headers: Headers
	readonly body: unknown
}

// Coduri de sistem care garanteaza ca cererea nu a plecat spre server.
const CODURI_NEAJUNSE = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"])

function codSistem(err: unknown): string | undefined {
	let curent: unknown = err
	for (let i = 0; i < 4 && curent && typeof curent === "object"; i++) {
		const cod = (curent as { code?: unknown }).code
		if (typeof cod === "string") return cod
		curent = (curent as { cause?: unknown }).cause
	}
	return undefined
}

function mesaj(err: unknown): string {
	return err instanceof Error ? err.message : String(err)
}

/** `Retry-After` vine in secunde sau ca data HTTP. */
export function citesteRetryAfter(headers: Headers): number | undefined {
	const valoare = headers.get("retry-after")
	if (!valoare) return undefined
	const secunde = Number(valoare)
	if (Number.isFinite(secunde)) return Math.max(0, secunde * 1000)
	const data = Date.parse(valoare)
	return Number.isNaN(data) ? undefined : Math.max(0, data - Date.now())
}

const decodeazaCorpEroare = Schema.decodeUnknownOption(CorpEroareSchema)

/** Transforma un raspuns non-2xx in eroarea tipata potrivita. */
export function eroareDinRaspuns(status: number, headers: Headers, body: unknown): EroareCerere {
	const corp = decodeazaCorpEroare(body)
	const c = corp._tag === "Some" ? corp.value : undefined
	const comun = {
		message: c?.error ?? `Cererea a esuat cu HTTP ${status}.`,
		status,
		raspuns: body,
		...(c?.hint !== undefined && { hint: c.hint }),
		...(c?.code !== undefined && { cod: c.code }),
	}

	switch (status) {
		case 400:
			return new EroareValidare({ ...comun, ...(c?.accepted && { acceptate: c.accepted }) })
		case 401:
			return new EroareAutentificare(comun)
		case 402:
			return new EroarePlanInactiv(comun)
		case 403:
			return new EroareInterzis({ ...comun, ...(c?.limita !== undefined && { limita: c.limita }) })
		case 404:
			return new EroareNegasit(comun)
		case 409:
			return new EroareConflict(comun)
		case 429: {
			const retryAfterMs = citesteRetryAfter(headers)
			const cod = c?.code ?? (c?.dailyUsage || c?.monthlyUsage ? "COTA_ATINSA" : "PREA_MULTE_CERERI")
			return new EroareLimita({
				...comun,
				cod,
				...(retryAfterMs !== undefined && { retryAfterMs }),
				...(c?.dailyUsage !== undefined && { utilizareZi: c.dailyUsage }),
				...(c?.monthlyUsage !== undefined && { utilizareLuna: c.monthlyUsage }),
			})
		}
		default:
			return status >= 500 ? new EroareServer(comun) : new EroareHttp(comun)
	}
}

function construiesteUrl(baseUrl: string, cerere: Cerere): string {
	const url = new URL(baseUrl.replace(/\/+$/, "") + cerere.cale)
	for (const [cheie, valoare] of Object.entries(cerere.query ?? {})) {
		if (valoare !== undefined) url.searchParams.set(cheie, valoare)
	}
	return url.toString()
}

/** O singura incercare, fara retry. */
const trimiteOData = (cerere: Cerere): Effect.Effect<Raspuns, EroareCerere, Setari> =>
	Effect.gen(function* () {
		const s = yield* Setari
		const url = construiesteUrl(s.baseUrl, cerere)
		const headers: Record<string, string> = {
			Authorization: `Bearer ${s.apiKey}`,
			Accept: "application/json",
			"User-Agent": s.userAgent,
		}
		if (cerere.body !== undefined) headers["Content-Type"] = "application/json"

		const res = yield* Effect.tryPromise({
			try: (signal) =>
				s.fetch(url, {
					method: cerere.metoda,
					headers,
					signal,
					...(cerere.body !== undefined && { body: JSON.stringify(cerere.body) }),
				}),
			catch: (err) =>
				new EroareRetea({
					message: `Cererea ${cerere.metoda} ${cerere.cale} nu a primit raspuns: ${mesaj(err)}`,
					cause: err,
					neajunsa: CODURI_NEAJUNSE.has(codSistem(err) ?? ""),
				}),
		}).pipe(
			Effect.timeoutFail({
				duration: Duration.millis(s.timeoutMs),
				onTimeout: () =>
					new EroareRetea({
						message: `Cererea ${cerere.metoda} ${cerere.cale} a depasit ${s.timeoutMs} ms.`,
						timeout: true,
					}),
			}),
		)

		const text = yield* Effect.tryPromise({
			try: () => res.text(),
			catch: (err) =>
				new EroareRetea({ message: `Raspunsul la ${cerere.metoda} ${cerere.cale} s-a intrerupt: ${mesaj(err)}`, cause: err }),
		})

		let body: unknown = null
		if (text) {
			try {
				body = JSON.parse(text)
			} catch {
				if (res.ok) {
					return yield* Effect.fail(
						new EroareRaspunsInvalid({ message: "API-ul a raspuns cu un corp care nu e JSON.", status: res.status, raspuns: text }),
					)
				}
				body = text
			}
		}

		if (!res.ok) return yield* Effect.fail(eroareDinRaspuns(res.status, res.headers, body))
		return { status: res.status, headers: res.headers, body }
	})

/**
 * Decide daca o eroare merita reincercata. Regula de baza: nu repetam un POST
 * care ar fi putut ajunge la server, pentru ca o verificare se taxeaza.
 */
export function sePoateReincerca(cerere: Cerere, eroare: EroareCerere, retry: SetariRetry): boolean {
	switch (eroare._tag) {
		case "EroareRetea":
			return cerere.idempotenta || eroare.neajunsa === true
		case "EroareServer":
			// 502/503/504 vin de la proxy: cererea nu a ajuns la aplicatie.
			return cerere.idempotenta || eroare.status === 502 || eroare.status === 503 || eroare.status === 504
		case "EroareLimita":
			// Doar throttle-ul de polling e trecator; cota si plafonul de flota nu se reseteaza in secunde.
			return (
				cerere.idempotenta &&
				eroare.cod === "PREA_MULTE_CERERI" &&
				(eroare.retryAfterMs ?? 0) <= retry.intarziereMaximaMs
			)
		default:
			return false
	}
}

/**
 * Backoff exponential cu jitter, plafonat la `intarziereMaximaMs`. Cand serverul
 * trimite `Retry-After`, pauza nu coboara sub valoarea ceruta.
 */
export function politicaRetry(retry: SetariRetry): Schedule.Schedule<unknown, EroareCerere> {
	const backoff = Schedule.exponential(Duration.millis(retry.intarziereInitialaMs), 2).pipe(
		Schedule.jittered,
		Schedule.modifyDelay((_, d) => Duration.min(d, Duration.millis(retry.intarziereMaximaMs))),
		Schedule.intersect(Schedule.recurs(retry.incercari)),
	)
	return Schedule.intersect(Schedule.identity<EroareCerere>(), backoff).pipe(
		Schedule.modifyDelay(([eroare], d) =>
			eroare._tag === "EroareLimita" && eroare.retryAfterMs !== undefined
				? Duration.max(d, Duration.millis(eroare.retryAfterMs))
				: d,
		),
	)
}

/** Trimite o cerere cu politica de retry din setari. */
export const trimite = (cerere: Cerere): Effect.Effect<Raspuns, EroareCerere, Setari> =>
	Effect.gen(function* () {
		const s = yield* Setari
		if (!s.retry) return yield* trimiteOData(cerere)
		const retry = s.retry
		return yield* trimiteOData(cerere).pipe(
			Effect.retry({ schedule: politicaRetry(retry), while: (e) => sePoateReincerca(cerere, e, retry) }),
		)
	})

/** Decodeaza corpul unui raspuns cu o schema; o nepotrivire devine `EroareRaspunsInvalid`. */
export const decodeaza =
	<A, I>(schema: Schema.Schema<A, I>) =>
	(raspuns: Raspuns): Effect.Effect<A, EroareRaspunsInvalid> =>
		Schema.decodeUnknown(schema)(raspuns.body).pipe(
			Effect.mapError(
				(err) =>
					new EroareRaspunsInvalid({
						message: `Raspunsul API-ului nu are forma asteptata: ${ParseResult.TreeFormatter.formatErrorSync(err)}`,
						status: raspuns.status,
						raspuns: raspuns.body,
						cause: err,
					}),
			),
		)
