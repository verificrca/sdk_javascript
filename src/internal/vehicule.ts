import { Effect } from "effect"
import { EroareValidare, type EroareCerere } from "../errors.js"
import { ListaVehiculeSchema, StergereSchema, VehiculCreatSchema, type Vehicul } from "../schemas.js"
import { valideazaVehiculNou, type VehiculNou } from "../validare.js"
import { decodeaza, trimite, type Setari } from "./http.js"

const CALE = "/api/public/v1/vehicule"

/** GET: vehiculele din cont. Gratuit. */
export const lista = (): Effect.Effect<readonly Vehicul[], EroareCerere, Setari> =>
	trimite({ metoda: "GET", cale: CALE, idempotenta: true }).pipe(
		Effect.flatMap(decodeaza(ListaVehiculeSchema)),
		Effect.map((r) => r.vehicule),
	)

/** POST: adauga un vehicul in monitorizare. Gratuit, dar respecta limita de masini a planului. */
export const adauga = (vehicul: VehiculNou): Effect.Effect<Vehicul, EroareCerere, Setari> =>
	valideazaVehiculNou(vehicul).pipe(
		Effect.flatMap((body) => trimite({ metoda: "POST", cale: CALE, idempotenta: false, body })),
		Effect.flatMap(decodeaza(VehiculCreatSchema)),
		Effect.map((r) => r.vehicul),
	)

/** DELETE: scoate un vehicul din cont. */
export const sterge = (id: string): Effect.Effect<void, EroareCerere, Setari> =>
	id.trim()
		? trimite({ metoda: "DELETE", cale: `${CALE}/${encodeURIComponent(id.trim())}`, idempotenta: true }).pipe(
				Effect.flatMap(decodeaza(StergereSchema)),
				Effect.asVoid,
			)
		: Effect.fail(new EroareValidare({ message: "Lipseste ID-ul vehiculului.", camp: "id", cod: "VALIDARE_LOCALA" }))
