import { Schema } from "effect"

// Schemele descriu exact ce trimite API-ul. Datele ISO devin obiecte `Date` la
// decodare. Campurile noi adaugate de server sunt ignorate, deci o versiune mai
// veche a SDK-ului nu se strica atunci cand API-ul creste.

/** Tipurile de verificare: RCA (AIDA/BAAR), ITP (RAR), rovinieta (CNAIR), ARR (copie conforma). */
export const TipVerificare = Schema.Literal("rca", "itp", "rovinieta", "arr")
/** Tipul verificarii: `"rca"`, `"itp"`, `"rovinieta"` sau `"arr"`. */
export type TipVerificare = typeof TipVerificare.Type

/**
 * Starea documentului:
 * - `valid`: valabil si departe de expirare;
 * - `warning`: expira curand (RCA 14 zile, ITP 30, rovinieta 7, ARR 14);
 * - `expired`: expirat sau inexistent, confirmat de sursa oficiala;
 * - `not_found`: sursa nu a gasit vehiculul.
 */
export const StatusDocument = Schema.Literal("valid", "warning", "expired", "not_found")
/** Starea documentului: `"valid"`, `"warning"`, `"expired"` sau `"not_found"`. Vezi {@link StatusDocument}. */
export type StatusDocument = typeof StatusDocument.Type

const DataNullabila = Schema.NullOr(Schema.Date)

// ─── Verificari ──────────────────────────────────────────────────────────────

export const RezultatVerificareSchema = Schema.Struct({
	/** Tipul verificarii. */
	tip: TipVerificare,
	/** Identificatorul dupa care s-a cautat (la RCA cu VIN, acesta e VIN-ul). */
	query: Schema.String,
	/** Numarul de inmatriculare verificat, `null` cand cautarea s-a facut doar dupa VIN. */
	numarInmatriculare: Schema.NullOr(Schema.String),
	/** Seria de sasiu (VIN) verificata, `null` cand cautarea s-a facut doar dupa numar. */
	serieSasiu: Schema.NullOr(Schema.String),
	/** Cand a fost interogata sursa oficiala. */
	checkedAt: Schema.Date,
	/** Starea documentului. Vezi {@link StatusDocument}. */
	status: StatusDocument,
	/** Data expirarii documentului, `null` daca nu exista document valabil. */
	expiresAt: DataNullabila,
	/** ID-ul cererii, prezent doar cand ai trimis `callbackUrl`. Apare si in webhook. */
	requestId: Schema.optional(Schema.String),
	/** Recomandarea API-ului, ex: la RCA cerut doar dupa numar, sa trimiti si VIN-ul. */
	hint: Schema.optional(Schema.String),
})

export const InCursSchema = Schema.Struct({
	tip: TipVerificare,
	query: Schema.String,
	status: Schema.Literal("processing"),
	requestId: Schema.optional(Schema.String),
	queuedAt: Schema.optional(Schema.Date),
	pollUrl: Schema.optional(Schema.String),
	hint: Schema.optional(Schema.String),
})

export const EsuataSchema = Schema.Struct({
	tip: TipVerificare,
	query: Schema.String,
	status: Schema.Literal("error"),
	error: Schema.String,
	hint: Schema.optional(Schema.String),
})

export const RaspunsVerificareSchema = Schema.Union(RezultatVerificareSchema, InCursSchema, EsuataSchema)

// ─── Erori ───────────────────────────────────────────────────────────────────

export const CorpEroareSchema = Schema.Struct({
	error: Schema.String,
	hint: Schema.optional(Schema.String),
	accepted: Schema.optional(Schema.Array(Schema.String)),
	code: Schema.optional(Schema.String),
	limita: Schema.optional(Schema.Number),
	dailyUsage: Schema.optional(Schema.String),
	monthlyUsage: Schema.optional(Schema.String),
})

// ─── Vehicule (flota) ────────────────────────────────────────────────────────

export const VehiculSchema = Schema.Struct({
	/** ID-ul vehiculului in cont, folosit la stergere. */
	id: Schema.String,
	/** Numarul de inmatriculare, `null` daca vehiculul a fost adaugat doar cu VIN. */
	numarInmatriculare: Schema.NullOr(Schema.String),
	/** Seria de sasiu (VIN), `null` daca vehiculul a fost adaugat doar cu numarul. */
	serieSasiu: Schema.NullOr(Schema.String),
	/** Data expirarii RCA, `null` daca nu e cunoscuta inca. */
	rcaExpiraLa: DataNullabila,
	/** Data expirarii ITP, `null` daca nu e cunoscuta inca (ITP-ul cere VIN). */
	itpExpiraLa: DataNullabila,
	/** Data expirarii rovinietei, `null` daca nu e cunoscuta inca (rovinieta cere numar si VIN). */
	rovinietaExpiraLa: DataNullabila,
	/** Data expirarii copiei conforme ARR. Completata doar cand `arrMonitorizat` e `true`. */
	arrExpiraLa: DataNullabila,
	/** Vehiculul e monitorizat si pentru copia conforma ARR (cere un plan activ). */
	arrMonitorizat: Schema.Boolean,
	/** Cand a fost adaugat vehiculul in cont. */
	createdAt: Schema.Date,
	/** Vehiculul e verificat automat si primeste notificari de expirare. */
	activ: Schema.Boolean,
})
/** Un vehicul monitorizat din cont, cu datele de expirare ale documentelor. */
export type Vehicul = typeof VehiculSchema.Type

export const ListaVehiculeSchema = Schema.Struct({ vehicule: Schema.Array(VehiculSchema) })
export const VehiculCreatSchema = Schema.Struct({ vehicul: VehiculSchema })
export const StergereSchema = Schema.Struct({ success: Schema.Literal(true) })

// ─── Webhook-uri ─────────────────────────────────────────────────────────────

/** Rezultatul livrat la `callbackUrl` dupa o verificare. */
export const WebhookRezultatSchema = Schema.Struct({
	/** ID-ul cererii, acelasi cu `requestId` primit de la `porneste()`. */
	requestId: Schema.String,
	/** Tipul verificarii. */
	tip: TipVerificare,
	/** Identificatorul dupa care s-a cautat. */
	query: Schema.String,
	/** Seria de sasiu trimisa in cerere, daca exista. */
	serieSasiu: Schema.NullOr(Schema.String),
	/** Starea documentului sau `"error"` cand sursa oficiala nu a raspuns. */
	status: Schema.Union(StatusDocument, Schema.Literal("error")),
	/** Rezultatul complet, `null` la `status: "error"`. */
	result: Schema.NullOr(RezultatVerificareSchema),
	/** Cand a fost interogata sursa, `null` la eroare. */
	checkedAt: DataNullabila,
	/** Mesajul de eroare, doar la `status: "error"`. */
	error: Schema.optional(Schema.String),
})
/** Payloadul POST trimis la `callbackUrl` cand o verificare se termina. */
export type WebhookRezultat = typeof WebhookRezultatSchema.Type

/** Evenimentul `document.expira`: un document a intrat intr-un prag de expirare. */
export const WebhookDocumentExpiraSchema = Schema.Struct({
	/** Numele evenimentului. */
	event: Schema.Literal("document.expira"),
	/** ID unic al livrarii. Foloseste-l pentru deduplicare. */
	id: Schema.String,
	/** Vehiculul la care expira documentul. */
	vehicul: Schema.Struct({
		/** ID-ul vehiculului in cont, acelasi ca in `vehicule.lista()`. */
		id: Schema.String,
		/** Numarul de inmatriculare, daca e cunoscut. */
		numarInmatriculare: Schema.NullOr(Schema.String),
		/** Seria de sasiu (VIN), daca e cunoscuta. */
		serieSasiu: Schema.NullOr(Schema.String),
	}),
	/** Documentul care expira. */
	document: TipVerificare,
	/** Data expirarii documentului. */
	expiraLa: Schema.Date,
	/** Zile intregi ramase pana la expirare (minim 0). */
	zileRamase: Schema.Number,
	/** Pragul de notificare atins, in zile (RCA/ITP/rovinieta: 30, 14, 3; ARR: 60, 50, 45). */
	prag: Schema.Number,
	/** Cand a fost trimisa notificarea. */
	trimisLa: Schema.Date,
})
/** Notificarea trimisa cand un document intra intr-un prag de expirare. */
export type WebhookDocumentExpira = typeof WebhookDocumentExpiraSchema.Type

/** Evenimentul `webhook.test`, trimis din butonul de test din dashboard. */
export const WebhookTestSchema = Schema.Struct({
	/** Numele evenimentului. */
	event: Schema.Literal("webhook.test"),
	/** ID unic al testului. */
	id: Schema.String,
	/** Mesajul de confirmare. */
	mesaj: Schema.String,
	/** Cand a fost trimis testul. */
	trimisLa: Schema.Date,
})
/** Evenimentul trimis de butonul de test din dashboard. */
export type WebhookTest = typeof WebhookTestSchema.Type

export const WebhookNotificareSchema = Schema.Union(WebhookDocumentExpiraSchema, WebhookTestSchema)
/** Orice notificare trimisa la URL-ul de webhook al contului. Distinge-le dupa `event`. */
export type WebhookNotificare = typeof WebhookNotificareSchema.Type
