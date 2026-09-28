import { Effect, Either } from "effect"
import { describe, expect, it } from "vitest"
import { EroareValidare, esteNumarInmatriculareValid, esteVinValid, normalizeaza } from "../src/index.js"
import { valideazaCerereVerificare, valideazaVehiculNou, type CerereVerificare } from "../src/validare.js"
import { VIN } from "./helpers.js"

const valideaza = (c: CerereVerificare) => Effect.runSync(Effect.either(valideazaCerereVerificare(c)))

describe("numere si VIN", () => {
	it("normalizeaza spatii, cratime si litere mici", () => {
		expect(normalizeaza(" b-123 abc ")).toBe("B123ABC")
	})

	it.each(["B123ABC", "B12ABC", "CJ45XYZ", "IS08BCD", "CD123A", "TC1234AB", "b 123 abc"])("accepta numarul %s", (n) => {
		expect(esteNumarInmatriculareValid(n)).toBe(true)
	})

	it.each(["XX12ABC", "B1ABC", "123", ""])("respinge numarul %s", (n) => {
		expect(esteNumarInmatriculareValid(n)).toBe(false)
	})

	it("respinge VIN-uri cu I, O, Q sau lungime gresita", () => {
		expect(esteVinValid(VIN)).toBe(true)
		expect(esteVinValid("WVWZZZ1JZXW00000I")).toBe(false)
		expect(esteVinValid("WVWZZZ1JZXW0000")).toBe(false)
	})
})

describe("valideazaCerereVerificare", () => {
	it("RCA pe numar: pollingul merge pe numar", () => {
		const r = valideaza({ tip: "rca", query: "b 123 abc" })
		expect(Either.getOrThrow(r)).toMatchObject({ query: "B123ABC", serieSasiu: null, queryPolling: "B123ABC" })
	})

	it("RCA pe numar + VIN: pollingul merge pe VIN, ca in API", () => {
		const r = valideaza({ tip: "rca", query: "B123ABC", serieSasiu: VIN.toLowerCase() })
		expect(Either.getOrThrow(r)).toMatchObject({ query: "B123ABC", serieSasiu: VIN, queryPolling: VIN })
	})

	it("ITP pe numar fara VIN e respins local", () => {
		const r = valideaza({ tip: "itp", query: "B123ABC" })
		expect(Either.isLeft(r)).toBe(true)
		if (Either.isLeft(r)) {
			expect(r.left).toBeInstanceOf(EroareValidare)
			expect(r.left.message).toContain("RAR")
		}
	})

	it("rovinieta cere si VIN", () => {
		const r = valideaza({ tip: "rovinieta", query: "B123ABC" })
		expect(Either.isLeft(r) && r.left.camp).toBe("serieSasiu")
		expect(Either.isRight(valideaza({ tip: "rovinieta", query: "B123ABC", serieSasiu: VIN }))).toBe(true)
	})

	it("ARR nu accepta VIN", () => {
		expect(Either.isLeft(valideaza({ tip: "arr", query: VIN }))).toBe(true)
	})

	it("explica exact lungimea gresita a VIN-ului", () => {
		const r = valideaza({ tip: "itp", query: "WVWZZZ1JZXW0000" })
		expect(Either.isLeft(r) && r.left.message).toContain("15 caractere")
	})

	it("tip necunoscut intoarce valorile acceptate", () => {
		const r = valideaza({ tip: "casco" as never, query: "B123ABC" })
		expect(Either.isLeft(r) && r.left.acceptate).toEqual(["rca", "itp", "rovinieta", "arr"])
	})

	it("callbackUrl trebuie sa fie http(s)", () => {
		expect(Either.isLeft(valideaza({ tip: "rca", query: "B123ABC", callbackUrl: "ftp://x.ro" }))).toBe(true)
		expect(Either.isLeft(valideaza({ tip: "rca", query: "B123ABC", callbackUrl: "/relativ" }))).toBe(true)
	})
})

describe("valideazaVehiculNou", () => {
	it("cere cel putin un identificator", () => {
		expect(Either.isLeft(Effect.runSync(Effect.either(valideazaVehiculNou({}))))).toBe(true)
	})

	it("normalizeaza numarul ca in dashboard", () => {
		const r = Effect.runSync(valideazaVehiculNou({ numarInmatriculare: "b-123 abc", serieSasiu: "abc" }))
		expect(r).toEqual({ numarInmatriculare: "B123ABC", serieSasiu: "ABC" })
	})
})
