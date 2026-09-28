import { afterEach, describe, expect, it, vi } from "vitest"
import {
	EroareAutentificare,
	EroareConfigurare,
	EroareLimita,
	EroareRaspunsInvalid,
	EroareRetea,
	EroareServer,
	EroareTimeoutVerificare,
	EroareValidare,
	EroareVerificare,
	VerificRca,
	VerificRcaError,
} from "../src/index.js"
import { CHEIE, VIN, cerere, client, fetchSimulat, rezultatValid } from "./helpers.js"

const headereCota = {
	"X-RateLimit-Limit-Day": "300",
	"X-RateLimit-Remaining-Day": "299",
	"X-RateLimit-Limit-Month": "10000",
	"X-RateLimit-Remaining-Month": "9876",
}

afterEach(() => {
	vi.useRealTimers()
	vi.unstubAllEnvs()
})

describe("configurare", () => {
	it("fara cheie arunca EroareConfigurare", () => {
		vi.stubEnv("VERIFICRCA_API_KEY", "")
		expect(() => new VerificRca({ fetch: fetchSimulat() })).toThrow(EroareConfigurare)
	})

	it("citeste cheia din VERIFICRCA_API_KEY", async () => {
		vi.stubEnv("VERIFICRCA_API_KEY", CHEIE)
		const fetch = fetchSimulat({ body: { vehicule: [] } })
		await new VerificRca({ fetch }).vehicule.lista()
		expect(cerere(fetch).headers.get("authorization")).toBe(`Bearer ${CHEIE}`)
	})
})

describe("verificari.porneste", () => {
	it("rezultat din cache: date convertite si cota citita din headere", async () => {
		const fetch = fetchSimulat({ body: rezultatValid, headers: headereCota })
		const r = await client(fetch).verificari.porneste({ tip: "rca", query: "b-123-abc" })

		expect(r.status).toBe("valid")
		if (r.status === "processing") throw new Error("neasteptat")
		expect(r.expiresAt).toBeInstanceOf(Date)
		expect(r.expiresAt?.toISOString()).toBe("2027-03-01T00:00:00.000Z")
		expect(r.limite).toEqual({ zi: { limita: 300, ramase: 299 }, luna: { limita: 10000, ramase: 9876 } })

		const c = cerere(fetch)
		expect(c.metoda).toBe("POST")
		expect(c.url.pathname).toBe("/api/public/v1/verificare")
		expect(c.body).toEqual({ tip: "rca", query: "B123ABC" })
		expect(c.headers.get("user-agent")).toMatch(/^verificrca-sdk-js\//)
	})

	it("in coada: since vine din pollUrl-ul serverului", async () => {
		const fetch = fetchSimulat({
			status: 202,
			body: {
				tip: "rca",
				query: VIN,
				status: "processing",
				requestId: "req_1",
				queuedAt: "2026-09-29T10:00:00.000Z",
				pollUrl: `GET /api/public/v1/verificare?tip=rca&query=${VIN}&since=1790000000000`,
			},
		})
		const r = await client(fetch).verificari.porneste({
			tip: "rca",
			query: "B123ABC",
			serieSasiu: VIN,
			callbackUrl: "https://example.com/hook/secret",
		})

		expect(r).toMatchObject({ status: "processing", query: VIN, since: 1790000000000, requestId: "req_1" })
		expect(cerere(fetch).body).toEqual({
			tip: "rca",
			query: "B123ABC",
			serieSasiu: VIN,
			callbackUrl: "https://example.com/hook/secret",
		})
	})

	it("validarea locala nu trimite nicio cerere", async () => {
		const fetch = fetchSimulat()
		await expect(client(fetch).verificari.porneste({ tip: "itp", query: "B123ABC" })).rejects.toBeInstanceOf(EroareValidare)
		expect(fetch).not.toHaveBeenCalled()
	})

	it("401 devine EroareAutentificare, cu hint-ul API-ului", async () => {
		const fetch = fetchSimulat({ status: 401, body: { error: "Autentificare esuata.", hint: "Transmite API key-ul" } })
		const err = await client(fetch).verificari.porneste({ tip: "rca", query: "B123ABC" }).catch((e: unknown) => e)
		expect(err).toBeInstanceOf(EroareAutentificare)
		expect(err).toBeInstanceOf(VerificRcaError)
		expect(err).toMatchObject({ _tag: "EroareAutentificare", status: 401, message: "Autentificare esuata.", hint: "Transmite API key-ul" })
	})

	it("cota atinsa: EroareLimita fara reincercare", async () => {
		const fetch = fetchSimulat({
			status: 429,
			body: { error: "Limita de requesturi atinsa.", dailyUsage: "300/300", monthlyUsage: "4000/10000" },
		})
		const err = await client(fetch).verificari.porneste({ tip: "rca", query: "B123ABC" }).catch((e: unknown) => e)
		expect(err).toBeInstanceOf(EroareLimita)
		expect(err).toMatchObject({ cod: "COTA_ATINSA", utilizareZi: "300/300" })
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it("POST cu 500 nu se repeta (verificarea s-ar taxa de doua ori)", async () => {
		const fetch = fetchSimulat({ status: 500, body: { error: "Eroare interna." } })
		await expect(client(fetch).verificari.porneste({ tip: "rca", query: "B123ABC" })).rejects.toBeInstanceOf(EroareServer)
		expect(fetch).toHaveBeenCalledTimes(1)
	})

	it("POST cu 503 de la proxy se repeta", async () => {
		const fetch = fetchSimulat({ status: 503 }, { body: rezultatValid })
		const r = await client(fetch).verificari.porneste({ tip: "rca", query: "B123ABC" })
		expect(r.status).toBe("valid")
		expect(fetch).toHaveBeenCalledTimes(2)
	})

	it("POST cu conexiune refuzata se repeta, cu ECONNRESET nu", async () => {
		const refuzat = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNREFUSED" } })
		const resetat = Object.assign(new TypeError("fetch failed"), { cause: { code: "ECONNRESET" } })

		const f1 = fetchSimulat({ eroare: refuzat }, { body: rezultatValid })
		await client(f1).verificari.porneste({ tip: "rca", query: "B123ABC" })
		expect(f1).toHaveBeenCalledTimes(2)

		const f2 = fetchSimulat({ eroare: resetat })
		await expect(client(f2).verificari.porneste({ tip: "rca", query: "B123ABC" })).rejects.toBeInstanceOf(EroareRetea)
		expect(f2).toHaveBeenCalledTimes(1)
	})

	it("raspuns cu forma gresita devine EroareRaspunsInvalid", async () => {
		const fetch = fetchSimulat({ body: { ceva: "altceva" } })
		await expect(client(fetch).verificari.porneste({ tip: "rca", query: "B123ABC" })).rejects.toBeInstanceOf(
			EroareRaspunsInvalid,
		)
	})
})

describe("verificari.rezultat", () => {
	it("trimite since si serieSasiu doar la rovinieta", async () => {
		const fetch = fetchSimulat({ body: { ...rezultatValid, tip: "rovinieta" } })
		await client(fetch).verificari.rezultat({ tip: "rovinieta", query: "B123ABC", serieSasiu: VIN, since: 42 })
		const q = cerere(fetch).url.searchParams
		expect(Object.fromEntries(q)).toEqual({ tip: "rovinieta", query: "B123ABC", serieSasiu: VIN, since: "42" })
	})

	it("GET cu 5xx si throttle se reincearca, respectand Retry-After", async () => {
		const fetch = fetchSimulat(
			{ status: 502 },
			{ status: 429, body: { error: "Prea multe cereri de polling." }, headers: { "Retry-After": "0" } },
			{ body: rezultatValid },
		)
		const r = await client(fetch).verificari.rezultat({ tip: "rca", query: "B123ABC" })
		expect(r.status).toBe("valid")
		expect(fetch).toHaveBeenCalledTimes(3)
	})

	it("renunta dupa numarul configurat de reincercari", async () => {
		const fetch = fetchSimulat({ status: 500 }, { status: 500 }, { status: 500 }, { status: 500 })
		await expect(client(fetch).verificari.rezultat({ tip: "rca", query: "B123ABC" })).rejects.toBeInstanceOf(EroareServer)
		expect(fetch).toHaveBeenCalledTimes(4)
	})

	it("statusul error devine EroareVerificare", async () => {
		const fetch = fetchSimulat({
			body: { tip: "rca", query: "B123ABC", status: "error", error: "Verificarea nu s-a putut finaliza." },
		})
		await expect(client(fetch).verificari.rezultat({ tip: "rca", query: "B123ABC" })).rejects.toBeInstanceOf(EroareVerificare)
	})

	it("timeout per cerere devine EroareRetea cu timeout: true", async () => {
		const fetch = vi.fn(
			(_u: string | URL | Request, init?: RequestInit) =>
				new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
		)
		const err = await client(fetch, { timeoutMs: 20, retry: false })
			.verificari.rezultat({ tip: "rca", query: "B123ABC" })
			.catch((e: unknown) => e)
		expect(err).toBeInstanceOf(EroareRetea)
		expect(err).toMatchObject({ timeout: true })
	})

	it("un AbortSignal anuleaza cererea", async () => {
		const fetch = vi.fn(
			(_u: string | URL | Request, init?: RequestInit) =>
				new Promise<Response>((_, reject) => init?.signal?.addEventListener("abort", () => reject(new Error("aborted")))),
		)
		const ctrl = new AbortController()
		const promisiune = client(fetch).verificari.rezultat({ tip: "rca", query: "B123ABC" }, { signal: ctrl.signal })
		setTimeout(() => ctrl.abort(), 10)
		await expect(promisiune).rejects.toMatchObject({ cod: "ANULATA" })
	})
})

describe("verificari.verificaSiAsteapta", () => {
	const inCurs = { tip: "rca", query: "B123ABC", status: "processing" }

	it("interogheaza pana la rezultatul final", async () => {
		vi.useFakeTimers()
		const fetch = fetchSimulat(
			{ status: 202, body: { ...inCurs, pollUrl: "GET /api/public/v1/verificare?tip=rca&query=B123ABC&since=5" } },
			{ body: inCurs },
			{ body: rezultatValid },
		)
		const promisiune = client(fetch).verificari.verificaSiAsteapta({ tip: "rca", query: "B123ABC" })
		await vi.advanceTimersByTimeAsync(10_000)
		const r = await promisiune

		expect(r.status).toBe("valid")
		expect(fetch).toHaveBeenCalledTimes(3)
		expect(cerere(fetch, 1).url.searchParams.get("since")).toBe("5")
	})

	it("depaseste timeoutMs cu EroareTimeoutVerificare", async () => {
		vi.useFakeTimers()
		const fetch = vi.fn(async () => new Response(JSON.stringify(inCurs), { status: 200 }))
		const promisiune = client(fetch)
			.verificari.verificaSiAsteapta({ tip: "rca", query: "B123ABC" }, { timeoutMs: 7_000 })
			.catch((e: unknown) => e)
		await vi.advanceTimersByTimeAsync(10_000)
		expect(await promisiune).toBeInstanceOf(EroareTimeoutVerificare)
	})
})
