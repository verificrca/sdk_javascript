import { Effect } from "effect"
import { EroareValidare } from "./errors.js"
import type { TipVerificare } from "./schemas.js"

// Aceleasi reguli ca prevalidarea din API. O cerere pe care sursa oficiala ar
// refuza-o oricum e oprita aici: nu pleaca pe retea si nu consuma din cota.

const JUDETE =
	"AB|AR|AG|BC|BH|BN|BT|BV|BR|BZ|CS|CL|CJ|CT|CV|DB|DJ|GL|GR|GJ|HD|HR|IL|IS|IF|MM|MH|MS|NT|OT|PH|SM|SJ|SB|SV|TR|TM|TL|VS|VL|VN"

const NUMAR_REGEX = new RegExp(
	`^(B\\d{2,3}[A-Z]{2,3}|(${JUDETE})\\d{2}[A-Z]{2,3}|CD\\d{3}[A-Z]{1,3}|TC\\d{4}[A-Z]{2})$`,
	"i",
)
const VIN_REGEX = /^[A-HJ-NPR-Z0-9]{17}$/i
const LUNGIME_VIN = 17

/** Toate tipurile de verificare acceptate de API, in ordine: `["rca", "itp", "rovinieta", "arr"]`. */
export const TIPURI_VERIFICARE: readonly TipVerificare[] = ["rca", "itp", "rovinieta", "arr"]

/**
 * Aduce un numar de inmatriculare sau un VIN la forma canonica: fara spatii,
 * cratime sau underscore, cu majuscule.
 *
 * @param valoare textul introdus de utilizator.
 * @returns forma normalizata.
 * @example
 * normalizeaza(" b-123 abc ") // "B123ABC"
 */
export function normalizeaza(valoare: string): string {
	return valoare.trim().toUpperCase().replace(/[\s\-_]/g, "")
}

/**
 * Verifica un numar de inmatriculare romanesc: Bucuresti (`B123ABC`), judete
 * (`CJ45XYZ`), corp diplomatic (`CD123A`) si numere temporare (`TC1234AB`).
 * Accepta si forme cu spatii sau cratime.
 *
 * @param valoare numarul de verificat.
 * @returns `true` daca numarul are un format valid.
 * @example
 * esteNumarInmatriculareValid("CJ 45 XYZ") // true
 * esteNumarInmatriculareValid("XX12ABC")   // false: XX nu e un judet
 */
export function esteNumarInmatriculareValid(valoare: string): boolean {
	return NUMAR_REGEX.test(normalizeaza(valoare))
}

/**
 * Verifica o serie de sasiu (VIN) dupa ISO 3779: exact 17 caractere, cifre si
 * litere, fara I, O si Q.
 *
 * @param valoare VIN-ul de verificat (spatiile si cratimele sunt ignorate).
 * @returns `true` daca VIN-ul are un format valid.
 * @example
 * esteVinValid("WVWZZZ1JZXW000001") // true
 * esteVinValid("WVWZZZ1JZXW00000I") // false: litera I nu e permisa
 */
export function esteVinValid(valoare: string): boolean {
	return VIN_REGEX.test(normalizeaza(valoare))
}

function explicaVin(valoare: string): string {
	if (!valoare) return "Lipseste seria de sasiu (VIN)."
	if (valoare.length !== LUNGIME_VIN) {
		return `Seria de sasiu are ${valoare.length} caractere, sunt necesare exact ${LUNGIME_VIN}.`
	}
	return "Seria de sasiu contine caractere neacceptate. Standardul ISO 3779 exclude literele I, O si Q."
}

/** Datele pentru pornirea unei verificari. */
export interface CerereVerificare {
	/** `rca`, `itp`, `rovinieta` sau `arr`. */
	readonly tip: TipVerificare
	/**
	 * Identificatorul principal:
	 * - `rca`: numar de inmatriculare sau VIN;
	 * - `itp`: VIN (RAR nu cauta dupa numar);
	 * - `rovinieta`: numar de inmatriculare (VIN-ul merge in `serieSasiu`);
	 * - `arr`: numar de inmatriculare (ARR nu cauta dupa VIN).
	 */
	readonly query: string
	/** Seria de sasiu (VIN). Obligatorie la rovinieta, recomandata la RCA. */
	readonly serieSasiu?: string
	/** URL http(s) unde API-ul trimite rezultatul prin POST cand e gata. */
	readonly callbackUrl?: string
}

/** Cererea validata: ce trimitem la API si dupa ce facem polling. */
export interface TintaVerificare {
	readonly tip: TipVerificare
	/** `query` normalizat, trimis la POST. */
	readonly query: string
	readonly serieSasiu: string | null
	/** Identificatorul folosit de API la polling (la RCA cu VIN, VIN-ul). */
	readonly queryPolling: string
	readonly callbackUrl: string | null
}

const eroare = (message: string, camp: string, acceptate?: readonly string[]) =>
	new EroareValidare({ message, camp, cod: "VALIDARE_LOCALA", ...(acceptate && { acceptate }) })

function valideazaCallbackUrl(raw: string | undefined): Effect.Effect<string | null, EroareValidare> {
	if (raw === undefined || raw.trim() === "") return Effect.succeed(null)
	const trimis = raw.trim()
	if (trimis.length > 2000) {
		return Effect.fail(eroare("`callbackUrl` e prea lung (maxim 2000 de caractere).", "callbackUrl"))
	}
	try {
		const url = new URL(trimis)
		if (url.protocol !== "http:" && url.protocol !== "https:") {
			return Effect.fail(eroare("`callbackUrl` trebuie sa foloseasca http sau https.", "callbackUrl"))
		}
		return Effect.succeed(trimis)
	} catch {
		return Effect.fail(eroare("`callbackUrl` trebuie sa fie un URL absolut http(s).", "callbackUrl"))
	}
}

function valideazaIdentificatori(
	tip: TipVerificare,
	query: string,
	serieSasiu: string,
): Effect.Effect<Omit<TintaVerificare, "callbackUrl">, EroareValidare> {
	if (!query) {
		return Effect.fail(eroare("Lipseste `query` (numar de inmatriculare sau serie de sasiu).", "query"))
	}

	switch (tip) {
		case "rca": {
			if (NUMAR_REGEX.test(query)) {
				if (!serieSasiu) return Effect.succeed({ tip, query, serieSasiu: null, queryPolling: query })
				if (!VIN_REGEX.test(serieSasiu)) {
					return Effect.fail(eroare(`\`serieSasiu\` invalid. ${explicaVin(serieSasiu)}`, "serieSasiu"))
				}
				// Cu VIN, API-ul cauta polita dupa VIN, deci si pollingul merge pe VIN.
				return Effect.succeed({ tip, query, serieSasiu, queryPolling: serieSasiu })
			}
			if (VIN_REGEX.test(query)) return Effect.succeed({ tip, query, serieSasiu: null, queryPolling: query })
			return Effect.fail(
				eroare(
					`\`query\` invalid: se accepta un numar de inmatriculare romanesc (ex: B123ABC) sau o serie de sasiu de ${LUNGIME_VIN} caractere. ${explicaVin(query)}`,
					"query",
				),
			)
		}
		case "itp": {
			const vin = VIN_REGEX.test(query) ? query : VIN_REGEX.test(serieSasiu) ? serieSasiu : null
			if (!vin) {
				return Effect.fail(
					eroare(
						`Verificarea ITP cere seria de sasiu (VIN, ${LUNGIME_VIN} caractere). RAR nu cauta dupa numarul de inmatriculare. ${explicaVin(serieSasiu || query)}`,
						"query",
					),
				)
			}
			return Effect.succeed({ tip, query, serieSasiu: serieSasiu || null, queryPolling: vin })
		}
		case "arr": {
			if (!NUMAR_REGEX.test(query)) {
				return Effect.fail(
					eroare("Verificarea ARR cere numarul de inmatriculare in `query` (ex: B123ABC). ARR nu cauta dupa VIN.", "query"),
				)
			}
			return Effect.succeed({ tip, query, serieSasiu: null, queryPolling: query })
		}
		case "rovinieta": {
			if (!NUMAR_REGEX.test(query)) {
				return Effect.fail(
					eroare("Verificarea rovinietei cere numarul de inmatriculare in `query` (ex: B123ABC).", "query"),
				)
			}
			if (!VIN_REGEX.test(serieSasiu)) {
				return Effect.fail(
					eroare(`Verificarea rovinietei cere si seria de sasiu in \`serieSasiu\`. ${explicaVin(serieSasiu)}`, "serieSasiu"),
				)
			}
			return Effect.succeed({ tip, query, serieSasiu, queryPolling: query })
		}
	}
}

/** Valideaza si normalizeaza o cerere de verificare, cu aceleasi reguli ca API-ul. */
export function valideazaCerereVerificare(cerere: CerereVerificare): Effect.Effect<TintaVerificare, EroareValidare> {
	const tip = typeof cerere.tip === "string" ? (cerere.tip.toLowerCase() as TipVerificare) : cerere.tip
	if (!TIPURI_VERIFICARE.includes(tip)) {
		return Effect.fail(eroare("`tip` invalid.", "tip", TIPURI_VERIFICARE))
	}
	const query = typeof cerere.query === "string" ? normalizeaza(cerere.query) : ""
	const serieSasiu = typeof cerere.serieSasiu === "string" ? normalizeaza(cerere.serieSasiu) : ""

	return Effect.all({
		tinta: valideazaIdentificatori(tip, query, serieSasiu),
		callbackUrl: valideazaCallbackUrl(cerere.callbackUrl),
	}).pipe(Effect.map(({ tinta, callbackUrl }) => ({ ...tinta, callbackUrl })))
}

/** Datele unui vehicul adaugat in flota. */
export interface VehiculNou {
	/** Numarul de inmatriculare. Spatiile si cratimele sunt eliminate. Maxim 20 de caractere. */
	readonly numarInmatriculare?: string
	/** Seria de sasiu (VIN). Necesara pentru ITP si rovinieta. Maxim 50 de caractere. */
	readonly serieSasiu?: string
	/** Monitorizeaza si copia conforma ARR. Cere un plan activ. */
	readonly arrMonitorizat?: boolean
}

/** Valideaza un vehicul nou cu regulile API-ului: cel putin un identificator. */
export function valideazaVehiculNou(vehicul: VehiculNou): Effect.Effect<Record<string, unknown>, EroareValidare> {
	const numar = vehicul.numarInmatriculare?.trim() ?? ""
	const serie = vehicul.serieSasiu?.trim() ?? ""

	if (numar && (numar.length > 20 || !/^[A-Z0-9\s-]*$/i.test(numar))) {
		return Effect.fail(eroare("`numarInmatriculare` poate contine doar litere, cifre, spatii si cratime (maxim 20).", "numarInmatriculare"))
	}
	if (serie && (serie.length > 50 || !/^[A-Z0-9]*$/i.test(serie))) {
		return Effect.fail(eroare("`serieSasiu` poate contine doar litere si cifre (maxim 50).", "serieSasiu"))
	}

	const numarNormalizat = numar.toUpperCase().replace(/[\s-]+/g, "")
	const serieNormalizata = serie.toUpperCase()
	if (!numarNormalizat && !serieNormalizata) {
		return Effect.fail(eroare("Trimite numarul de inmatriculare sau seria de sasiu.", "numarInmatriculare"))
	}

	return Effect.succeed({
		...(numarNormalizat && { numarInmatriculare: numarNormalizat }),
		...(serieNormalizata && { serieSasiu: serieNormalizata }),
		...(vehicul.arrMonitorizat !== undefined && { arrMonitorizat: vehicul.arrMonitorizat }),
	})
}
