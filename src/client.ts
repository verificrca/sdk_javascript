import { Cause, Effect, Exit } from "effect"
import { EroareConfigurare, VerificRcaError } from "./errors.js"
import { Setari, type SetariClient, type SetariRetry } from "./internal/http.js"
import * as opVerificari from "./internal/verificari.js"
import * as opVehicule from "./internal/vehicule.js"
import type { Vehicul } from "./schemas.js"
import type { CerereVerificare, VehiculNou } from "./validare.js"

/** Versiunea acestui SDK, trimisa si in headerul `User-Agent`. */
export const VERSIUNE_SDK = "0.1.0"
/** Adresa implicita a API-ului. */
export const URL_IMPLICIT = "https://www.verificrca.ro"

/** Optiunile constructorului {@link VerificRca}. Toate sunt optionale. */
export interface OptiuniClient {
	/**
	 * Cheia API (`vrca_...`) din https://www.verificrca.ro/dashboard/api.
	 * Implicit se citeste din variabila de mediu `VERIFICRCA_API_KEY`.
	 */
	readonly apiKey?: string
	/** Adresa API-ului. Implicit `https://www.verificrca.ro`; schimb-o doar pentru medii de test. */
	readonly baseUrl?: string
	/** Timeout per cerere HTTP. Implicit 30000 ms. */
	readonly timeoutMs?: number
	/**
	 * Reincercari pentru erori trecatoare (retea, 5xx, throttle la polling), cu
	 * backoff exponential si jitter. `false` le dezactiveaza.
	 * Implicit: 3 reincercari, de la 500 ms, maxim 10 s pe pauza.
	 */
	readonly retry?: Partial<SetariRetry> | false
	/** Implementare `fetch` proprie (proxy, teste). Implicit `globalThis.fetch`. */
	readonly fetch?: typeof globalThis.fetch
	/** Adaugat la `User-Agent`, ex: `"flota-mea/2.1"`. */
	readonly userAgent?: string
}

/** Optiuni acceptate de orice metoda a clientului, ca ultim argument. */
export interface OptiuniCerere {
	/** Anuleaza cererea (si reincercarile sau asteptarea ei). */
	readonly signal?: AbortSignal
}

const RETRY_IMPLICIT: SetariRetry = { incercari: 3, intarziereInitialaMs: 500, intarziereMaximaMs: 10_000 }

function citesteEnv(nume: string): string | undefined {
	const proces = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process
	return proces?.env?.[nume]
}

function construiesteSetari(optiuni: OptiuniClient): SetariClient {
	const apiKey = (optiuni.apiKey ?? citesteEnv("VERIFICRCA_API_KEY") ?? "").trim()
	if (!apiKey) {
		throw new EroareConfigurare({
			message: "Lipseste cheia API. Trimite `apiKey` sau seteaza variabila de mediu VERIFICRCA_API_KEY.",
			hint: "Cheia se genereaza din https://www.verificrca.ro/dashboard/api",
		})
	}
	if (apiKey.length < 16 || apiKey.length > 128) {
		throw new EroareConfigurare({ message: "Cheia API are un format invalid (intre 16 si 128 de caractere)." })
	}

	const baseUrl = optiuni.baseUrl ?? URL_IMPLICIT
	try {
		new URL(baseUrl)
	} catch {
		throw new EroareConfigurare({ message: `\`baseUrl\` invalid: ${baseUrl}` })
	}

	const fetchImpl = optiuni.fetch ?? globalThis.fetch
	if (typeof fetchImpl !== "function") {
		throw new EroareConfigurare({ message: "`fetch` nu exista in acest mediu. Foloseste Node.js 18+ sau trimite optiunea `fetch`." })
	}

	const timeoutMs = optiuni.timeoutMs ?? 30_000
	if (!(timeoutMs > 0)) throw new EroareConfigurare({ message: "`timeoutMs` trebuie sa fie pozitiv." })

	return {
		apiKey,
		baseUrl,
		timeoutMs,
		retry: optiuni.retry === false ? null : { ...RETRY_IMPLICIT, ...optiuni.retry },
		fetch: fetchImpl,
		userAgent: `verificrca-sdk-js/${VERSIUNE_SDK}${optiuni.userAgent ? ` ${optiuni.userAgent}` : ""}`,
	}
}

/** Ruleaza un efect intern si il transforma in Promise. */
type Rulare = <A, E>(efect: Effect.Effect<A, E, Setari>, optiuni?: OptiuniCerere) => Promise<A>

/**
 * Verificarile la cerere: RCA, ITP, rovinieta si ARR. Il accesezi prin
 * `vrca.verificari`, nu il construiesti direct.
 *
 * Doar `porneste()` si `verificaSiAsteapta()` consuma din cota planului API.
 * `rezultat()` si `asteapta()` sunt gratuite.
 */
export class ClientVerificari {
	readonly #ruleaza: Rulare

	/** @internal */
	constructor(ruleaza: Rulare) {
		this.#ruleaza = ruleaza
	}

	/**
	 * Porneste o verificare si consuma o unitate din cota planului.
	 *
	 * Daca vehiculul a fost verificat de curand, primesti imediat rezultatul
	 * existent. Altfel verificarea intra in
	 * coada si primesti `status: "processing"`; rezultatul il afli cu
	 * {@link ClientVerificari.rezultat}, {@link ClientVerificari.asteapta} sau
	 * prin webhook, daca ai trimis `callbackUrl`.
	 *
	 * Datele sunt validate local inainte de cerere: o greseala de tastare nu
	 * pleaca pe retea si nu consuma din cota.
	 *
	 * @param cerere tipul verificarii, identificatorul si, optional, VIN-ul si `callbackUrl`.
	 * @param optiuni `signal` pentru anulare.
	 * @returns rezultatul final sau o {@link VerificareInCurs}.
	 * @throws {@link EroareValidare} date invalide, local sau HTTP 400.
	 * @throws {@link EroareAutentificare} cheie API invalida (401).
	 * @throws {@link EroarePlanInactiv} contul nu are abonament API activ (402).
	 * @throws {@link EroareLimita} cota zilnica sau lunara atinsa (429, `cod: "COTA_ATINSA"`).
	 * @throws {@link EroareVerificare} sursa oficiala nu a putut fi interogata.
	 * @throws {@link EroareRetea} fara raspuns sau timeout.
	 * @throws {@link EroareServer} eroare 5xx.
	 * @example
	 * const r = await vrca.verificari.porneste({ tip: "itp", query: "WVWZZZ1JZXW000001" })
	 * if (r.status === "processing") {
	 *   const final = await vrca.verificari.asteapta(r)
	 * }
	 */
	porneste(cerere: CerereVerificare, optiuni?: OptiuniCerere): Promise<opVerificari.RaspunsVerificare> {
		return this.#ruleaza(opVerificari.porneste(cerere), optiuni)
	}

	/**
	 * Interogheaza o singura data rezultatul unei verificari. Nu consuma din cota.
	 *
	 * Serverul accepta cel mult o interogare la 2 secunde pentru aceeasi
	 * verificare; la depasire, SDK-ul asteapta cat cere `Retry-After` si reincearca.
	 *
	 * @param referinta obiectul primit de la `porneste()` sau `{ tip, query, serieSasiu?, since? }`.
	 * @param optiuni `signal` pentru anulare.
	 * @returns rezultatul final sau, daca sursa nu a raspuns inca, o {@link VerificareInCurs}.
	 * @throws {@link EroareVerificare} sursa oficiala nu a putut fi interogata; reia cu `porneste()`.
	 * @throws {@link EroareValidare} referinta invalida (400).
	 * @throws {@link EroareAutentificare} cheie API invalida (401).
	 * @throws {@link EroareRetea} fara raspuns sau timeout, dupa reincercari.
	 * @example
	 * const r = await vrca.verificari.rezultat({ tip: "rca", query: "B123ABC" })
	 * if (r.status !== "processing") console.log(r.status, r.expiresAt)
	 */
	rezultat(
		referinta: opVerificari.ReferintaVerificare,
		optiuni?: OptiuniCerere,
	): Promise<opVerificari.RaspunsVerificare> {
		return this.#ruleaza(opVerificari.rezultat(referinta), optiuni)
	}

	/**
	 * Interogheaza periodic pana la rezultatul final. Nu consuma din cota.
	 *
	 * @param referinta obiectul primit de la `porneste()` sau `{ tip, query, serieSasiu?, since? }`.
	 * @param optiuni `intervalMs` (implicit 3000, minim 2000), `timeoutMs` (implicit 5 minute) si `signal`.
	 * @returns rezultatul final al verificarii.
	 * @throws {@link EroareTimeoutVerificare} rezultatul nu a venit in `timeoutMs`.
	 * @throws {@link EroareVerificare} sursa oficiala nu a putut fi interogata; reia cu `porneste()`.
	 * @throws {@link EroareRetea} fara raspuns, dupa reincercari.
	 * @example
	 * const r = await vrca.verificari.porneste({ tip: "arr", query: "CJ45XYZ" })
	 * const final = r.status === "processing" ? await vrca.verificari.asteapta(r, { intervalMs: 5000 }) : r
	 */
	asteapta(
		referinta: opVerificari.ReferintaVerificare,
		optiuni?: opVerificari.OptiuniAsteptare & OptiuniCerere,
	): Promise<opVerificari.VerificareFinala> {
		return this.#ruleaza(opVerificari.asteapta(referinta, optiuni), optiuni)
	}

	/**
	 * Porneste verificarea si asteapta rezultatul final, intr-un singur apel.
	 * Consuma o unitate din cota (doar pornirea; pollingul e gratuit).
	 *
	 * @param cerere tipul verificarii, identificatorul si, optional, VIN-ul si `callbackUrl`.
	 * @param optiuni `intervalMs`, `timeoutMs` si `signal`, ca la {@link ClientVerificari.asteapta}.
	 * @returns rezultatul final al verificarii.
	 * @throws {@link EroareValidare} date invalide, local sau HTTP 400.
	 * @throws {@link EroareLimita} cota atinsa (`cod: "COTA_ATINSA"`).
	 * @throws {@link EroareTimeoutVerificare} rezultatul nu a venit in `timeoutMs`.
	 * @throws {@link EroareVerificare} sursa oficiala nu a putut fi interogata.
	 * @throws {@link VerificRcaError} orice alta eroare de la API sau de retea.
	 * @example
	 * const rovinieta = await vrca.verificari.verificaSiAsteapta({
	 *   tip: "rovinieta",
	 *   query: "B123ABC",
	 *   serieSasiu: "WVWZZZ1JZXW000001",
	 * })
	 * console.log(rovinieta.status, rovinieta.expiresAt)
	 */
	verificaSiAsteapta(
		cerere: CerereVerificare,
		optiuni?: opVerificari.OptiuniAsteptare & OptiuniCerere,
	): Promise<opVerificari.VerificareFinala> {
		return this.#ruleaza(opVerificari.verificaSiAsteapta(cerere, optiuni), optiuni)
	}
}

/**
 * Vehiculele monitorizate din cont. Il accesezi prin `vrca.vehicule`, nu il
 * construiesti direct.
 *
 * Operatiile sunt gratuite (nu consuma din cota de verificari), dar cer un plan
 * activ: abonament API sau plan de cont. Vehiculele din cont sunt verificate
 * automat si periodic, iar la apropierea expirarilor primesti notificari.
 */
export class ClientVehicule {
	readonly #ruleaza: Rulare

	/** @internal */
	constructor(ruleaza: Rulare) {
		this.#ruleaza = ruleaza
	}

	/**
	 * Listeaza toate vehiculele din cont, cu datele de expirare RCA, ITP,
	 * rovinieta si ARR.
	 *
	 * @param optiuni `signal` pentru anulare.
	 * @returns vehiculele contului; lista goala daca nu ai niciunul.
	 * @throws {@link EroareAutentificare} cheie API invalida (401).
	 * @throws {@link EroarePlanInactiv} contul nu are un plan activ (402).
	 * @throws {@link EroareRetea} fara raspuns, dupa reincercari.
	 * @example
	 * for (const v of await vrca.vehicule.lista()) {
	 *   console.log(v.numarInmatriculare, v.rcaExpiraLa, v.itpExpiraLa)
	 * }
	 */
	lista(optiuni?: OptiuniCerere): Promise<readonly Vehicul[]> {
		return this.#ruleaza(opVehicule.lista(), optiuni)
	}

	/**
	 * Adauga un vehicul in monitorizare. Trimite cel putin numarul de
	 * inmatriculare sau seria de sasiu; cu amandoua se pot urmari toate
	 * documentele (ITP-ul si rovinieta cer VIN).
	 *
	 * @param vehicul numarul, VIN-ul si, optional, `arrMonitorizat`.
	 * @param optiuni `signal` pentru anulare.
	 * @returns vehiculul creat, cu `id`-ul folosit la stergere.
	 * @throws {@link EroareValidare} lipseste identificatorul sau are caractere nepermise.
	 * @throws {@link EroareInterzis} `LIMIT_ATINS` (ai atins numarul de masini din plan, vezi `limita`) sau `ARR_NECESITA_PLAN`.
	 * @throws {@link EroareConflict} vehiculul exista deja in cont (`VEHICUL_EXISTENT`).
	 * @throws {@link EroareLimita} plafonul zilnic de adaugari prin API (`LIMITA_FLOTA_ATINSA`).
	 * @throws {@link EroarePlanInactiv} contul nu are un plan activ (402).
	 * @example
	 * const v = await vrca.vehicule.adauga({ numarInmatriculare: "B123ABC", serieSasiu: "WVWZZZ1JZXW000001" })
	 * console.log(v.id)
	 */
	adauga(vehicul: VehiculNou, optiuni?: OptiuniCerere): Promise<Vehicul> {
		return this.#ruleaza(opVehicule.adauga(vehicul), optiuni)
	}

	/**
	 * Scoate un vehicul din cont. Monitorizarea si notificarile lui se opresc.
	 *
	 * @param id `id`-ul vehiculului, din {@link ClientVehicule.lista} sau {@link ClientVehicule.adauga}.
	 * @param optiuni `signal` pentru anulare.
	 * @returns se rezolva fara valoare cand vehiculul a fost sters.
	 * @throws {@link EroareNegasit} vehiculul nu exista in contul cheii (404).
	 * @throws {@link EroareLimita} plafonul zilnic de stergeri prin API (`LIMITA_FLOTA_ATINSA`).
	 * @throws {@link EroareValidare} `id` gol.
	 * @example
	 * await vrca.vehicule.sterge("6f2c1b9e-0000-4000-8000-000000000001")
	 */
	sterge(id: string, optiuni?: OptiuniCerere): Promise<void> {
		return this.#ruleaza(opVehicule.sterge(id), optiuni)
	}
}

/**
 * Clientul API verificrca.ro: verificare RCA, ITP, rovinieta si ARR, plus
 * gestionarea vehiculelor monitorizate.
 *
 * Toate metodele intorc `Promise` si arunca subclase de {@link VerificRcaError}.
 * Erorile trecatoare (retea, 5xx, throttle la polling) sunt reincercate automat,
 * fara sa repete vreodata o verificare taxata.
 *
 * @example
 * import { VerificRca } from "@verificrca/sdk"
 *
 * const vrca = new VerificRca({ apiKey: process.env.VERIFICRCA_API_KEY })
 * const rca = await vrca.verificari.verificaSiAsteapta({ tip: "rca", query: "B123ABC" })
 * console.log(rca.status, rca.expiresAt)
 */
export class VerificRca {
	/** Verificari la cerere RCA, ITP, rovinieta si ARR. */
	readonly verificari: ClientVerificari
	/** Vehiculele monitorizate din cont. */
	readonly vehicule: ClientVehicule

	/**
	 * Creeaza un client. Nu face nicio cerere pe retea.
	 *
	 * @param optiuni cheia API si setarile de retea; toate sunt optionale daca
	 *   `VERIFICRCA_API_KEY` e setata.
	 * @throws {@link EroareConfigurare} lipseste cheia API sau o optiune e invalida.
	 * @example
	 * const vrca = new VerificRca({
	 *   apiKey: process.env.VERIFICRCA_API_KEY,
	 *   timeoutMs: 15_000,
	 *   retry: { incercari: 5 },
	 * })
	 */
	constructor(optiuni: OptiuniClient = {}) {
		const setari = construiesteSetari(optiuni)
		const ruleaza: Rulare = (efect, opt) =>
			Effect.runPromiseExit(
				Effect.provideService(efect, Setari, setari),
				opt?.signal ? { signal: opt.signal } : undefined,
			).then((exit) => {
				if (Exit.isSuccess(exit)) return exit.value
				if (Cause.isInterruptedOnly(exit.cause)) {
					throw new VerificRcaError({ message: "Cererea a fost anulata.", cod: "ANULATA" })
				}
				// Aruncam eroarea tipata, nu invelisul Effect.
				throw Cause.squash(exit.cause)
			})
		this.verificari = new ClientVerificari(ruleaza)
		this.vehicule = new ClientVehicule(ruleaza)
	}
}
