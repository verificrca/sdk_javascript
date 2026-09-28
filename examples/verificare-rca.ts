// Verificare RCA dupa numar de inmatriculare si VIN, cu asteptarea rezultatului.
// Rulare: VERIFICRCA_API_KEY=vrca_... npx tsx examples/verificare-rca.ts
import { EroareLimita, EroareValidare, VerificRca } from "../src/index.js"

const vrca = new VerificRca()

try {
	const rca = await vrca.verificari.verificaSiAsteapta({
		tip: "rca",
		query: "B123ABC",
		serieSasiu: "WVWZZZ1JZXW000001",
	})
	console.log(`RCA ${rca.status}, expira la ${rca.expiresAt?.toLocaleDateString("ro-RO") ?? "-"}`)
	console.log(`Mai ai ${rca.limite?.zi.ramase ?? "?"} verificari azi.`)
} catch (err) {
	if (err instanceof EroareValidare) console.error("Date gresite:", err.message)
	else if (err instanceof EroareLimita) console.error("Cota atinsa:", err.utilizareZi)
	else throw err
}
