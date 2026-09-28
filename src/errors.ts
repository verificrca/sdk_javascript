import { Data } from "effect"

/** Campurile comune tuturor erorilor SDK-ului. */
export interface DateEroare {
	/** Mesajul, in romana, exact cum vine de la API cand exista. */
	readonly message: string
	/** Statusul HTTP, cand eroarea vine dintr-un raspuns. */
	readonly status?: number
	/** Codul masinii (`LIMIT_ATINS`, `VEHICUL_EXISTENT`, `NEGASIT` etc.). */
	readonly cod?: string
	/** Indicatia API-ului despre cum se rezolva problema. */
	readonly hint?: string
	/** Corpul brut al raspunsului, pentru depanare. */
	readonly raspuns?: unknown
	/** Eroarea originala (de retea, de parsare), cand exista. */
	readonly cause?: unknown
}

/**
 * Baza tuturor erorilor aruncate de SDK. `instanceof VerificRcaError` prinde
 * orice eroare de la verificrca, iar `_tag` spune exact care e.
 */
export class VerificRcaError extends Data.Error<DateEroare> {
	/** Discriminantul erorii. Fiecare subclasa are propria valoare, ex: `"EroareLimita"`. */
	readonly _tag: string = "VerificRcaError"
	/** Numele clasei, afisat in loguri si in stack trace. */
	override readonly name: string = "VerificRcaError"
}

/** Optiunile clientului sunt invalide (cheie API lipsa, URL gresit etc.). */
export class EroareConfigurare extends VerificRcaError {
	/** Discriminantul erorii: `"EroareConfigurare"`. Util in `switch (err._tag)`. */
	override readonly _tag = "EroareConfigurare"
	/** Numele clasei, afisat in loguri si in stack trace. */
	override readonly name = "EroareConfigurare"
}

/**
 * Datele trimise sunt invalide. Apare fie local, inainte de orice cerere (nu se
 * consuma nimic din cota), fie ca raspuns 400 de la API.
 */
export class EroareValidare extends VerificRcaError {
	/** Discriminantul erorii: `"EroareValidare"`. Util in `switch (err._tag)`. */
	override readonly _tag = "EroareValidare"
	/** Numele clasei, afisat in loguri si in stack trace. */
	override readonly name = "EroareValidare"
	/** Valorile acceptate, cand API-ul le trimite (ex: tipurile de verificare). */
	declare readonly acceptate?: readonly string[]
	/** Campul cu problema, cand eroarea e detectata local. */
	declare readonly camp?: string

	/**
	 * Creeaza eroarea. SDK-ul o construieste singur; o creezi manual doar in teste.
	 *
	 * @param args mesajul, detaliile comune ({@link DateEroare}) si campurile specifice acestei erori.
	 */
	constructor(args: DateEroare & { readonly acceptate?: readonly string[]; readonly camp?: string }) {
		super(args)
	}
}

/** 401: cheia API lipseste, e invalida sau a fost dezactivata. */
export class EroareAutentificare extends VerificRcaError {
	/** Discriminantul erorii: `"EroareAutentificare"`. Util in `switch (err._tag)`. */
	override readonly _tag = "EroareAutentificare"
	/** Numele clasei, afisat in loguri si in stack trace. */
	override readonly name = "EroareAutentificare"
}

/** 402: contul nu are un abonament activ pentru operatia ceruta. */
export class EroarePlanInactiv extends VerificRcaError {
	/** Discriminantul erorii: `"EroarePlanInactiv"`. Util in `switch (err._tag)`. */
	override readonly _tag = "EroarePlanInactiv"
	/** Numele clasei, afisat in loguri si in stack trace. */
	override readonly name = "EroarePlanInactiv"
}

/** 403: operatia nu e permisa pe planul curent (`LIMIT_ATINS`, `ARR_NECESITA_PLAN`). */
export class EroareInterzis extends VerificRcaError {
	/** Discriminantul erorii: `"EroareInterzis"`. Util in `switch (err._tag)`. */
	override readonly _tag = "EroareInterzis"
	/** Numele clasei, afisat in loguri si in stack trace. */
	override readonly name = "EroareInterzis"
	/** Numarul de masini permis de plan, la `LIMIT_ATINS`. */
	declare readonly limita?: number

	/**
	 * Creeaza eroarea. SDK-ul o construieste singur; o creezi manual doar in teste.
	 *
	 * @param args mesajul, detaliile comune ({@link DateEroare}) si campurile specifice acestei erori.
	 */
	constructor(args: DateEroare & { readonly limita?: number }) {
		super(args)
	}
}

/** 404: resursa nu exista sau nu apartine contului cheii. */
export class EroareNegasit extends VerificRcaError {
	/** Discriminantul erorii: `"EroareNegasit"`. Util in `switch (err._tag)`. */
	override readonly _tag = "EroareNegasit"
	/** Numele clasei, afisat in loguri si in stack trace. */
	override readonly name = "EroareNegasit"
}

/** 409: vehiculul exista deja in cont (`VEHICUL_EXISTENT`). */
export class EroareConflict extends VerificRcaError {
	/** Discriminantul erorii: `"EroareConflict"`. Util in `switch (err._tag)`. */
	override readonly _tag = "EroareConflict"
	/** Numele clasei, afisat in loguri si in stack trace. */
	override readonly name = "EroareConflict"
}

/**
 * 429: limita a fost atinsa. `cod` spune care:
 * - `COTA_ATINSA`: cota zilnica sau lunara de verificari a planului;
 * - `LIMITA_FLOTA_ATINSA`: plafonul zilnic de adaugari/stergeri de vehicule;
 * - `PREA_MULTE_CERERI`: polling prea des (SDK-ul reincearca singur).
 */
export class EroareLimita extends VerificRcaError {
	/** Discriminantul erorii: `"EroareLimita"`. Util in `switch (err._tag)`. */
	override readonly _tag = "EroareLimita"
	/** Numele clasei, afisat in loguri si in stack trace. */
	override readonly name = "EroareLimita"
	/** Cat sa astepti inainte de o cerere noua, din headerul `Retry-After`. */
	declare readonly retryAfterMs?: number
	/** Consumul zilnic, ex: `"300/300"`. */
	declare readonly utilizareZi?: string
	/** Consumul lunar, ex: `"4120/10000"`. */
	declare readonly utilizareLuna?: string

	/**
	 * Creeaza eroarea. SDK-ul o construieste singur; o creezi manual doar in teste.
	 *
	 * @param args mesajul, detaliile comune ({@link DateEroare}) si campurile specifice acestei erori.
	 */
	constructor(
		args: DateEroare & {
			readonly retryAfterMs?: number
			readonly utilizareZi?: string
			readonly utilizareLuna?: string
		},
	) {
		super(args)
	}
}

/** 5xx: eroare pe serverul verificrca. Cererile sigure se reincearca automat. */
export class EroareServer extends VerificRcaError {
	/** Discriminantul erorii: `"EroareServer"`. Util in `switch (err._tag)`. */
	override readonly _tag = "EroareServer"
	/** Numele clasei, afisat in loguri si in stack trace. */
	override readonly name = "EroareServer"
}

/** Orice alt status HTTP neasteptat. */
export class EroareHttp extends VerificRcaError {
	/** Discriminantul erorii: `"EroareHttp"`. Util in `switch (err._tag)`. */
	override readonly _tag = "EroareHttp"
	/** Numele clasei, afisat in loguri si in stack trace. */
	override readonly name = "EroareHttp"
}

/** Cererea nu a primit raspuns: retea cazuta, DNS, conexiune refuzata sau timeout. */
export class EroareRetea extends VerificRcaError {
	/** Discriminantul erorii: `"EroareRetea"`. Util in `switch (err._tag)`. */
	override readonly _tag = "EroareRetea"
	/** Numele clasei, afisat in loguri si in stack trace. */
	override readonly name = "EroareRetea"
	/** Adevarat cand cererea a depasit `timeoutMs`. */
	declare readonly timeout?: boolean
	/**
	 * Adevarat cand e sigur ca cererea nu a ajuns la server (DNS, conexiune
	 * refuzata), deci se poate repeta fara risc chiar si pentru un POST.
	 */
	declare readonly neajunsa?: boolean

	/**
	 * Creeaza eroarea. SDK-ul o construieste singur; o creezi manual doar in teste.
	 *
	 * @param args mesajul, detaliile comune ({@link DateEroare}) si campurile specifice acestei erori.
	 */
	constructor(args: DateEroare & { readonly timeout?: boolean; readonly neajunsa?: boolean }) {
		super(args)
	}
}

/** Raspunsul API-ului nu are forma asteptata (JSON invalid sau campuri lipsa). */
export class EroareRaspunsInvalid extends VerificRcaError {
	/** Discriminantul erorii: `"EroareRaspunsInvalid"`. Util in `switch (err._tag)`. */
	override readonly _tag = "EroareRaspunsInvalid"
	/** Numele clasei, afisat in loguri si in stack trace. */
	override readonly name = "EroareRaspunsInvalid"
}

/**
 * Sursa oficiala nu a putut fi interogata (statusul `error` la polling sau in
 * webhook). Verificarea poate fi reluata cu o cerere noua.
 */
export class EroareVerificare extends VerificRcaError {
	/** Discriminantul erorii: `"EroareVerificare"`. Util in `switch (err._tag)`. */
	override readonly _tag = "EroareVerificare"
	/** Numele clasei, afisat in loguri si in stack trace. */
	override readonly name = "EroareVerificare"
}

/** `verificaSiAsteapta` a depasit timpul maxim de asteptare. */
export class EroareTimeoutVerificare extends VerificRcaError {
	/** Discriminantul erorii: `"EroareTimeoutVerificare"`. Util in `switch (err._tag)`. */
	override readonly _tag = "EroareTimeoutVerificare"
	/** Numele clasei, afisat in loguri si in stack trace. */
	override readonly name = "EroareTimeoutVerificare"
}

/** Un webhook primit nu poate fi acceptat: cheie gresita sau payload invalid. */
export class EroareWebhook extends VerificRcaError {
	/** Discriminantul erorii: `"EroareWebhook"`. Util in `switch (err._tag)`. */
	override readonly _tag = "EroareWebhook"
	/** Numele clasei, afisat in loguri si in stack trace. */
	override readonly name = "EroareWebhook"
}

/** Erorile pe care le poate produce o cerere HTTP catre API. */
export type EroareCerere =
	| EroareValidare
	| EroareAutentificare
	| EroarePlanInactiv
	| EroareInterzis
	| EroareNegasit
	| EroareConflict
	| EroareLimita
	| EroareServer
	| EroareHttp
	| EroareRetea
	| EroareRaspunsInvalid
