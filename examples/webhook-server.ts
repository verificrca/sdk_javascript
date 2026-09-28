// Server minim care primeste ambele tipuri de webhook, doar cu node:http.
import { createServer } from "node:http"
import { EroareWebhook, parseazaWebhookRezultat, verificaWebhookNotificare } from "../src/index.js"

const CHEIE_WEBHOOK = process.env.VERIFICRCA_WEBHOOK_KEY ?? ""

createServer(async (req, res) => {
	const bucati: Buffer[] = []
	for await (const b of req) bucati.push(b as Buffer)
	const corp = Buffer.concat(bucati)

	try {
		if (req.url === "/verificrca/rezultat-9f3k2") {
			const r = parseazaWebhookRezultat(corp)
			console.log(`Rezultat ${r.requestId}: ${r.tip} ${r.query} = ${r.status}`)
		} else if (req.url === "/verificrca/notificari") {
			const n = verificaWebhookNotificare(corp, req.headers, { cheie: CHEIE_WEBHOOK })
			if (n.event === "document.expira") {
				console.log(`${n.vehicul.numarInmatriculare}: ${n.document} expira in ${n.zileRamase} zile`)
			}
		}
		res.writeHead(200).end()
	} catch (err) {
		res.writeHead(err instanceof EroareWebhook ? 400 : 500).end()
	}
}).listen(3000)
