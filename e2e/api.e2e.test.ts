import { afterAll, describe, expect, it } from "vitest"
import {
	EroareAutentificare,
	EroareConflict,
	EroareNegasit,
	VerificRca,
	type VerificareFinala,
	type Vehicul,
} from "../src/index.js"

// Teste pe API-ul real. Configurarea sta in .env.e2e (vezi .env.e2e.example).
// Testele care costa (cota, verificari pe surse) ruleaza doar cu flag explicit.

const env = process.env
const CHEIE = env.VERIFICRCA_API_KEY?.trim() || undefined
const BASE_URL = env.VERIFICRCA_BASE_URL?.trim() || undefined
const NUMAR = env.VERIFICRCA_E2E_NUMAR?.trim() || undefined
const VIN = env.VERIFICRCA_E2E_VIN?.trim() || undefined
const CU_VERIFICARI = env.VERIFICRCA_E2E_VERIFICARI === "1"
const CU_FLOTA = env.VERIFICRCA_E2E_FLOTA === "1"

const STATUSURI_FINALE = ["valid", "warning", "expired", "not_found"]

function client(apiKey = CHEIE): VerificRca {
	return new VerificRca({
		...(apiKey && { apiKey }),
		...(BASE_URL && { baseUrl: BASE_URL }),
		userAgent: "e2e",
	})
}

function verificaFinal(r: VerificareFinala) {
	expect(STATUSURI_FINALE).toContain(r.status)
	expect(r.checkedAt).toBeInstanceOf(Date)
	expect(Number.isNaN(r.checkedAt.getTime())).toBe(false)
	if (r.expiresAt !== null) expect(r.expiresAt).toBeInstanceOf(Date)
}

describe("autentificare", () => {
	it("o cheie inexistenta primeste EroareAutentificare (401)", async () => {
		const err = await client("vrca_e2e_cheie_inexistenta_0000").vehicule.lista().catch((e: unknown) => e)
		expect(err).toBeInstanceOf(EroareAutentificare)
		expect(err).toMatchObject({ status: 401 })
	})
})

describe.skipIf(!CHEIE)("vehicule.lista (gratuit)", () => {
	it("intoarce vehiculele contului, cu datele decodate", async () => {
		const vehicule = await client().vehicule.lista()
		expect(Array.isArray(vehicule)).toBe(true)
		for (const v of vehicule) {
			expect(typeof v.id).toBe("string")
			expect(v.createdAt).toBeInstanceOf(Date)
			for (const data of [v.rcaExpiraLa, v.itpExpiraLa, v.rovinietaExpiraLa, v.arrExpiraLa]) {
				if (data !== null) expect(data).toBeInstanceOf(Date)
			}
		}
	})
})

describe.skipIf(!CHEIE || !CU_FLOTA || !NUMAR)("vehicule.adauga / sterge (VERIFICRCA_E2E_FLOTA=1)", () => {
	// Construit lazy: callback-ul unui describe sarit ruleaza oricum la colectare.
	let vrca: VerificRca
	let creatId: string | undefined

	afterAll(async () => {
		// Curatenie si cand un test pica la jumatate.
		if (creatId && vrca) await vrca.vehicule.sterge(creatId).catch(() => undefined)
	})

	it("adauga vehiculul, il gaseste in lista, il sterge", async () => {
		vrca = client()
		let adaugat: Vehicul
		try {
			adaugat = await vrca.vehicule.adauga({ numarInmatriculare: NUMAR!, ...(VIN && { serieSasiu: VIN }) })
		} catch (err) {
			// Vehiculul e deja in cont: nu il atingem, validam doar raspunsul 409.
			if (err instanceof EroareConflict) {
				expect(err).toMatchObject({ status: 409 })
				return
			}
			throw err
		}

		const id = adaugat.id
		creatId = id
		expect(adaugat.numarInmatriculare).toBe(NUMAR!.toUpperCase().replace(/[\s-]+/g, ""))
		expect((await vrca.vehicule.lista()).some((v) => v.id === id)).toBe(true)

		await vrca.vehicule.sterge(id)
		creatId = undefined
		expect((await vrca.vehicule.lista()).some((v) => v.id === id)).toBe(false)

		await expect(vrca.vehicule.sterge(id)).rejects.toBeInstanceOf(EroareNegasit)
	})
})

describe.skipIf(!CHEIE || !CU_VERIFICARI || !NUMAR)("verificari (VERIFICRCA_E2E_VERIFICARI=1, consuma din cota)", () => {
	it("RCA: porneste, asteapta si reciteste rezultatul gratuit", async () => {
		const vrca = client()
		const pornit = await vrca.verificari.porneste({ tip: "rca", query: NUMAR!, ...(VIN && { serieSasiu: VIN }) })
		expect(pornit.limite?.zi.limita).toBeGreaterThan(0)

		const final = pornit.status === "processing" ? await vrca.verificari.asteapta(pornit) : pornit
		verificaFinal(final)

		// GET-ul nu consuma din cota si trebuie sa dea acelasi rezultat.
		const recitit = await vrca.verificari.rezultat({ tip: "rca", query: final.query })
		expect(recitit.status).toBe(final.status)
	})

	it.skipIf(!VIN)("ITP dupa VIN, cu verificaSiAsteapta", async () => {
		const itp = await client().verificari.verificaSiAsteapta({ tip: "itp", query: VIN! })
		verificaFinal(itp)
		expect(itp.tip).toBe("itp")
	})
})
