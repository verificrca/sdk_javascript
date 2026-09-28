import { vi } from "vitest"
import { VerificRca, type OptiuniClient } from "../src/index.js"

export const CHEIE = "vrca_test_0123456789abcdef"

export interface RaspunsSimulat {
	status?: number
	body?: unknown
	headers?: Record<string, string>
	/** Arunca in loc sa raspunda (eroare de retea). */
	eroare?: unknown
}

/** Un `fetch` care raspunde pe rand cu valorile date si inregistreaza cererile. */
export function fetchSimulat(...raspunsuri: RaspunsSimulat[]) {
	const coada = [...raspunsuri]
	const fn = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => {
		const r = coada.shift()
		if (!r) throw new Error("fetchSimulat: nu mai sunt raspunsuri")
		if (r.eroare !== undefined) throw r.eroare
		const body = r.body === undefined ? "" : typeof r.body === "string" ? r.body : JSON.stringify(r.body)
		return new Response(body, { status: r.status ?? 200, headers: r.headers ?? {} })
	})
	return fn
}

export function client(fetch: typeof globalThis.fetch, extra: Partial<OptiuniClient> = {}) {
	return new VerificRca({
		apiKey: CHEIE,
		fetch,
		retry: { incercari: 3, intarziereInitialaMs: 1, intarziereMaximaMs: 5 },
		...extra,
	})
}

export function cerere(fn: ReturnType<typeof fetchSimulat>, index = 0) {
	const apel = fn.mock.calls[index]
	if (!apel) throw new Error(`nu exista apelul ${index}`)
	const [url, init] = apel
	return {
		url: new URL(String(url)),
		metoda: init?.method,
		headers: new Headers(init?.headers),
		body: init?.body ? JSON.parse(String(init.body)) : undefined,
	}
}

export const VIN = "WVWZZZ1JZXW000001"

export const rezultatValid = {
	tip: "rca",
	query: "B123ABC",
	numarInmatriculare: "B123ABC",
	serieSasiu: null,
	checkedAt: "2026-09-20T10:00:00.000Z",
	status: "valid",
	expiresAt: "2027-03-01T00:00:00.000Z",
}
