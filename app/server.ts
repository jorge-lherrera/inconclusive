import { file } from "bun"
import path from "node:path"
import { handleApi } from "./api"

const PORT = Number(process.env.PORT ?? 3100)
const PUBLIC_DIR = path.join(import.meta.dir, "public")

const STATIC: Record<string, string> = {
  "/": "index.html",
  "/index.html": "index.html",
  "/app.js": "app.js",
  "/app.css": "app.css",
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 60,
  async fetch(request) {
    const { pathname } = new URL(request.url)

    if (pathname.startsWith("/api/")) {
      const response = await handleApi(request, pathname)
      if (response) return response
    }

    const asset = STATIC[pathname]
    if (asset) {
      const handle = file(path.join(PUBLIC_DIR, asset))
      if (await handle.exists()) return new Response(handle)
    }

    return new Response("Not found", { status: 404 })
  },
})

console.log(`app under test listening on http://localhost:${server.port}`)
