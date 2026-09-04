import { createHmac, timingSafeEqual } from "node:crypto"
import { buildJobs, buildParts, STAGES, USERS, type Job, type Part } from "./data"

const SECRET = process.env.APP_JWT_SECRET ?? "inconclusive-demo-secret"
const TOKEN_TTL_SECONDS = 30 * 60

type Store = { parts: Part[]; jobs: Job[] }

const store: Store = { parts: buildParts(), jobs: buildJobs() }

function base64url(input: Buffer | string): string {
  return Buffer.from(input).toString("base64url")
}

function sign(payload: Record<string, unknown>): string {
  const header = base64url(JSON.stringify({ alg: "HS256", typ: "JWT" }))
  const body = base64url(JSON.stringify(payload))
  const signature = createHmac("sha256", SECRET).update(`${header}.${body}`).digest("base64url")
  return `${header}.${body}.${signature}`
}

export function verify(token: string): Record<string, unknown> | null {
  const [header, body, signature] = token.split(".")
  if (!header || !body || !signature) return null
  const expected = createHmac("sha256", SECRET).update(`${header}.${body}`).digest("base64url")
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null
  const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Record<string, unknown>
  const exp = payload.exp
  if (typeof exp === "number" && exp * 1000 < Date.now()) return null
  return payload
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  })
}

/**
 * Codes are segmented decimals, so "630.5" sorts before "630.10" and "10" after "4".
 * A frontend that re-sorts the payload as text gets both of those backwards, which is
 * exactly what the natural-order spec pins down.
 */
function naturalCompare(a: string, b: string): number {
  const left = a.split(".").map(Number)
  const right = b.split(".").map(Number)
  const length = Math.max(left.length, right.length)
  for (let index = 0; index < length; index += 1) {
    const diff = (left[index] ?? 0) - (right[index] ?? 0)
    if (diff !== 0) return diff
  }
  return 0
}

function openJobsUsing(partId: string): Job[] {
  return store.jobs.filter((job) => job.status === "open" && job.partIds.includes(partId))
}

function bearer(request: Request): Record<string, unknown> | null {
  const header = request.headers.get("authorization")
  if (!header?.startsWith("Bearer ")) return null
  return verify(header.slice("Bearer ".length))
}

function requireAuth(request: Request): Response | null {
  return bearer(request) ? null : json({ code: "UNAUTHENTICATED" }, 401)
}

export async function handleApi(request: Request, pathname: string): Promise<Response | null> {
  const method = request.method.toUpperCase()

  if (method === "POST" && pathname === "/api/session") {
    const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string }
    const user = USERS.find((candidate) => candidate.email === body.email && candidate.password === body.password)
    if (!user) return json({ code: "BAD_CREDENTIALS" }, 401)
    const issuedAt = Math.floor(Date.now() / 1000)
    const token = sign({
      sub: user.email,
      email: user.email,
      name: user.name,
      role: user.role,
      iat: issuedAt,
      exp: issuedAt + TOKEN_TTL_SECONDS,
    })
    return json({ data: { token, profile: { email: user.email, name: user.name, role: user.role } } })
  }

  if (!pathname.startsWith("/api/")) return null

  const unauthenticated = requireAuth(request)
  if (unauthenticated) return unauthenticated

  if (method === "GET" && pathname === "/api/profile") {
    return json({ data: bearer(request) })
  }

  if (method === "GET" && pathname === "/api/jobs/stages") {
    return json({ data: STAGES })
  }

  /**
   * A listing behind POST. It exists because read-shaped POSTs are common in older
   * APIs and the write guard has to be able to tell them apart from a real mutation.
   */
  if (method === "POST" && pathname === "/api/parts/search") {
    const body = (await request.json().catch(() => ({}))) as { page?: number; size?: number; query?: string }
    const query = (body.query ?? "").trim().toLowerCase()
    const matches = store.parts.filter(
      (part) => !query || part.label.toLowerCase().includes(query) || part.code.includes(query)
    )
    const size = body.size ?? 100
    const page = body.page ?? 0
    const content = matches.slice(page * size, page * size + size)
    return json({ data: { content, totalElements: matches.length, page, size } })
  }

  if (method === "GET" && pathname === "/api/parts/labels") {
    const labels = [...store.parts]
      .sort((a, b) => naturalCompare(a.code, b.code))
      .map((part) => ({ id: part.id, code: part.code, label: `[${part.code}] ${part.label}` }))
    return json({ data: labels })
  }

  if (method === "POST" && pathname === "/api/parts") {
    const body = (await request.json().catch(() => ({}))) as { code?: string; label?: string; stageId?: string }
    if (!body.code || !body.label) return json({ code: "CODE_AND_LABEL_REQUIRED" }, 400)
    const part: Part = {
      id: `part-${String(store.parts.length + 1).padStart(3, "0")}`,
      code: body.code,
      label: body.label,
      stageId: body.stageId ?? STAGES[0]!.id,
      stock: 0,
    }
    store.parts.push(part)
    return json({ data: part }, 201)
  }

  const partMatch = /^\/api\/parts\/([\w-]+)$/.exec(pathname)
  if (partMatch) {
    const id = partMatch[1]!
    const index = store.parts.findIndex((part) => part.id === id)
    if (index === -1) return json({ code: "PART_NOT_FOUND" }, 404)

    if (method === "GET") return json({ data: store.parts[index] })

    if (method === "DELETE") {
      const claims = bearer(request)
      if (claims?.role !== "admin") return json({ code: "FORBIDDEN" }, 403)
      const blocking = openJobsUsing(id)
      if (blocking.length > 0) {
        return json({ code: "PART_IN_USE", usedBy: blocking.map((job) => job.id) }, 409)
      }
      store.parts.splice(index, 1)
      return json({ data: { id } })
    }
  }

  return json({ code: "NOT_FOUND" }, 404)
}
