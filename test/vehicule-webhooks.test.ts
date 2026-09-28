import { describe, expect, it } from "vitest"
import {
	EroareConflict,
	EroareInterzis,
	EroareNegasit,
	EroareWebhook,
	parseazaWebhookRezultat,
	verificaWebhookNotificare,
} from "../src/index.js"
import { VIN, cerere, client, fetchSimulat, rezultatValid } from "./helpers.js"

const vehicul = {
	id: "6f2c1b9e-0000-4000-8000-000000000001",
	numarInmatriculare: "B123ABC",
	serieSasiu: VIN,
	rcaExpiraLa: "2027-03-01T00:00:00.000Z",
	itpExpiraLa: null,
	rovinietaExpiraLa: "2026-12-31T00:00:00.000Z",
	arrExpiraLa: null,
	arrMonitorizat: false,
	activ: true,
	createdAt: "2026-09-01T08:00:00.000Z",
	campNouDeLaServer: "ignorat",
}

describe("vehicule", () => {
	it("lista decodeaza datele", async () => {
		const fetch = fetchSimulat({ body: { vehicule: [vehicul] } })
		const [v] = await client(fetch).vehicule.lista()
		expect(v?.rcaExpiraLa).toBeInstanceOf(Date)
		expect(v?.itpExpiraLa).toBeNull()
		expect(v).not.toHaveProperty("campNouDeLaServer")
	})

	it("adauga trimite forma canonica", async () => {
		const fetch = fetchSimulat({ status: 201, body: { vehicul } })
		const v = await client(fetch).vehicule.adauga({ numarInmatriculare: "b 123-abc", arrMonitorizat: false })
		expect(v.id).toBe(vehicul.id)
		expect(cerere(fetch).body).toEqual({ numarInmatriculare: "B123ABC", arrMonitorizat: false })
	})

	it("409 VEHICUL_EXISTENT si 403 LIMIT_ATINS", async () => {
		const f1 = fetchSimulat({ status: 409, body: { error: "Exista deja.", code: "VEHICUL_EXISTENT" } })
		await expect(client(f1).vehicule.adauga({ numarInmatriculare: "B123ABC" })).rejects.toBeInstanceOf(EroareConflict)

		const f2 = fetchSimulat({ status: 403, body: { error: "Limita.", code: "LIMIT_ATINS", limita: 5 } })
		const err = await client(f2).vehicule.adauga({ numarInmatriculare: "B123ABC" }).catch((e: unknown) => e)
		expect(err).toBeInstanceOf(EroareInterzis)
		expect(err).toMatchObject({ cod: "LIMIT_ATINS", limita: 5 })
	})

	it("sterge encodeaza id-ul si mapeaza 404", async () => {
		const f1 = fetchSimulat({ body: { success: true } })
		await client(f1).vehicule.sterge("abc/def")
		expect(cerere(f1).metoda).toBe("DELETE")
		expect(cerere(f1).url.pathname).toBe("/api/public/v1/vehicule/abc%2Fdef")

		const f2 = fetchSimulat({ status: 404, body: { error: "Vehicul negasit.", code: "NEGASIT" } })
		await expect(client(f2).vehicule.sterge("x")).rejects.toBeInstanceOf(EroareNegasit)
	})
})

describe("webhook-uri", () => {
	it("parseaza rezultatul unei verificari din string", () => {
		const corp = JSON.stringify({
			requestId: "req_1",
			tip: "rca",
			query: "B123ABC",
			serieSasiu: null,
			status: "valid",
			result: rezultatValid,
			checkedAt: rezultatValid.checkedAt,
		})
		const w = parseazaWebhookRezultat(corp)
		expect(w.requestId).toBe("req_1")
		expect(w.result?.expiresAt).toBeInstanceOf(Date)
	})

	it("parseaza rezultatul de eroare", () => {
		const w = parseazaWebhookRezultat({
			requestId: "req_2",
			tip: "itp",
			query: VIN,
			serieSasiu: VIN,
			status: "error",
			result: null,
			checkedAt: null,
			error: "Verificarea nu s-a putut finaliza.",
		})
		expect(w.status).toBe("error")
	})

	it("respinge JSON invalid", () => {
		expect(() => parseazaWebhookRezultat("{nu e json")).toThrow(EroareWebhook)
	})

	const expira = {
		event: "document.expira",
		id: "liv_1",
		vehicul: { id: "v1", numarInmatriculare: "B123ABC", serieSasiu: null },
		document: "itp",
		expiraLa: "2026-10-10T00:00:00.000Z",
		zileRamase: 11,
		prag: 14,
		trimisLa: "2026-09-29T10:00:00.000Z",
	}

	it("accepta notificarea cu cheia corecta, din Headers sau obiect Node", () => {
		const cheie = "whsec_abc123"
		const n1 = verificaWebhookNotificare(JSON.stringify(expira), new Headers({ "X-Verificrca-Key": cheie }), { cheie })
		expect(n1.event).toBe("document.expira")

		const n2 = verificaWebhookNotificare(Buffer.from(JSON.stringify(expira)), { "x-verificrca-key": cheie }, { cheie })
		if (n2.event !== "document.expira") throw new Error("neasteptat")
		expect(n2.expiraLa).toBeInstanceOf(Date)
		expect(n2.prag).toBe(14)
	})

	it("accepta evenimentul de test", () => {
		const n = verificaWebhookNotificare(
			{ event: "webhook.test", id: "t1", mesaj: "Test", trimisLa: "2026-09-29T10:00:00.000Z" },
			{ "X-Verificrca-Key": "k" },
			{ cheie: "k" },
		)
		expect(n.event).toBe("webhook.test")
	})

	it("respinge cheia gresita sau lipsa", () => {
		expect(() => verificaWebhookNotificare(expira, { "x-verificrca-key": "gresit" }, { cheie: "whsec_abc" })).toThrow(
			EroareWebhook,
		)
		expect(() => verificaWebhookNotificare(expira, {}, { cheie: "whsec_abc" })).toThrow(/X-Verificrca-Key/)
	})
})
