/**
 * Paths that answer to POST but only read. This list belongs to YOUR api: an older
 * backend that paginates, searches or exports behind POST needs every one of those
 * spelled out here. The app under test has exactly one, on purpose, so the shape of
 * the problem is visible without pretending the list is universal.
 */
const READ_ONLY_POST = [/\/search$/i, /\/export$/i, /\/count$/i, /\/lookup$/i]

export type Verdict = { mutates: boolean; reason: string }

export function classify(method: string, pathname: string): Verdict {
  const verb = method.toUpperCase()

  if (verb === "GET" || verb === "HEAD" || verb === "OPTIONS") {
    return { mutates: false, reason: `${verb} reads` }
  }
  if (verb === "PUT" || verb === "PATCH" || verb === "DELETE") {
    return { mutates: true, reason: `${verb} always writes` }
  }
  if (verb === "POST") {
    const hit = READ_ONLY_POST.find((pattern) => pattern.test(pathname))
    if (hit) return { mutates: false, reason: `read-shaped POST (${hit})` }
    return { mutates: true, reason: `POST ${pathname} matches no known read pattern` }
  }
  return { mutates: true, reason: `${verb} is unknown, assumed to write` }
}

/**
 * Origin AND path, not host alone. An api served from the app's own origin — a route
 * handler, a server action — is invisible to a guard that only compares hosts, and
 * that is the common case in a modern frontend.
 */
export function isApiCall(url: string, appOrigin: string, apiPrefix = "/api/"): boolean {
  try {
    const parsed = new URL(url)
    return parsed.origin === new URL(appOrigin).origin && parsed.pathname.startsWith(apiPrefix)
  } catch {
    return false
  }
}
