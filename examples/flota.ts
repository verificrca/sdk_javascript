// Raport de expirari pentru toata flota: RCA, ITP, rovinieta si ARR in urmatoarele 30 de zile.
import { VerificRca, type Vehicul } from "../src/index.js"

const vrca = new VerificRca()
const ZI = 86_400_000
const limita = Date.now() + 30 * ZI

const documente = [
	["RCA", "rcaExpiraLa"],
	["ITP", "itpExpiraLa"],
	["Rovinieta", "rovinietaExpiraLa"],
	["ARR", "arrExpiraLa"],
] as const satisfies ReadonlyArray<readonly [string, keyof Vehicul]>

for (const v of await vrca.vehicule.lista()) {
	for (const [nume, camp] of documente) {
		const data = v[camp]
		if (data instanceof Date && data.getTime() <= limita) {
			const zile = Math.ceil((data.getTime() - Date.now()) / ZI)
			console.log(`${v.numarInmatriculare ?? v.serieSasiu}: ${nume} expira in ${zile} zile`)
		}
	}
}
