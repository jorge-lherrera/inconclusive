const state = {
  token: localStorage.getItem("token"),
  profile: JSON.parse(localStorage.getItem("profile") ?? "null"),
  stages: [],
  parts: [],
}

const el = (id) => document.getElementById(id)

function authHeaders() {
  return state.token
    ? { "content-type": "application/json", authorization: `Bearer ${state.token}` }
    : { "content-type": "application/json" }
}

async function api(path, options = {}) {
  const response = await fetch(path, { ...options, headers: authHeaders() })
  const body = await response.json().catch(() => null)
  return { ok: response.ok, status: response.status, body }
}

let toastTimer = null
function toast(message, kind) {
  const node = el("toast")
  node.textContent = message
  node.className = kind === "error" ? "error" : ""
  clearTimeout(toastTimer)
  toastTimer = setTimeout(() => node.classList.add("hidden"), 6000)
}

function stageLabel(stageId) {
  const stage = state.stages.find((candidate) => candidate.id === stageId)
  return stage ? stage.label : stageId
}

/**
 * Only a label the cell actually cuts off gets a tooltip. A tooltip on every label is
 * noise that hides the one that matters.
 */
function applyLabelTooltips() {
  for (const node of document.querySelectorAll("td.label span.truncated")) {
    if (node.scrollWidth > node.clientWidth) {
      node.setAttribute("title", node.textContent)
    } else {
      node.removeAttribute("title")
    }
  }
}

function renderParts() {
  const body = el("parts-body")
  body.replaceChildren()

  if (state.parts.length === 0) {
    const empty = document.createElement("tr")
    const cell = document.createElement("td")
    cell.colSpan = 5
    cell.textContent = "No parts match this filter"
    empty.append(cell)
    body.append(empty)
    return
  }

  for (const part of state.parts) {
    const row = document.createElement("tr")
    row.dataset.id = part.id

    const code = document.createElement("td")
    code.textContent = part.code

    const label = document.createElement("td")
    label.className = "label"
    const text = document.createElement("span")
    text.className = "truncated"
    text.textContent = part.label
    label.append(text)

    const stage = document.createElement("td")
    stage.textContent = stageLabel(part.stageId)

    const stock = document.createElement("td")
    stock.textContent = String(part.stock)

    const actions = document.createElement("td")
    if (state.profile?.role === "admin") {
      const remove = document.createElement("button")
      remove.className = "danger"
      remove.type = "button"
      remove.dataset.action = "delete"
      remove.dataset.id = part.id
      remove.textContent = "Delete"
      actions.append(remove)
    }

    row.append(code, label, stage, stock, actions)
    body.append(row)
  }

  applyLabelTooltips()
}

async function loadStages() {
  const { body } = await api("/api/jobs/stages")
  state.stages = body?.data ?? []
  const select = el("stage-select")
  select.replaceChildren()
  for (const stage of state.stages) {
    const option = document.createElement("option")
    option.value = stage.id
    option.textContent = stage.label
    select.append(option)
  }
}

async function loadLabels() {
  const { body } = await api("/api/parts/labels")
  const select = el("part-select")
  select.replaceChildren()
  for (const item of body?.data ?? []) {
    const option = document.createElement("option")
    option.value = item.id
    option.textContent = item.label
    select.append(option)
  }
}

async function loadParts() {
  const { body } = await api("/api/parts/search", {
    method: "POST",
    body: JSON.stringify({ page: 0, size: 100 }),
  })
  state.parts = body?.data?.content ?? []
  renderParts()
}

function deleteFailureMessage(body) {
  const code = body?.code
  if (code === "PART_IN_USE") {
    const jobs = body.usedBy?.length ?? 0
    return `This part is used by ${jobs} open job${jobs === 1 ? "" : "s"} and cannot be deleted`
  }
  if (code === "FORBIDDEN") return "Your role cannot delete parts"
  return "Could not delete part"
}

async function deletePart(id) {
  const { ok, body } = await api(`/api/parts/${id}`, { method: "DELETE" })
  if (ok) {
    toast("Part deleted")
    await loadParts()
    return
  }
  toast(deleteFailureMessage(body), "error")
}

async function createPart() {
  const code = el("new-code").value.trim()
  const label = el("new-label").value.trim()
  if (!code || !label) return
  const { ok } = await api("/api/parts", { method: "POST", body: JSON.stringify({ code, label }) })
  if (!ok) {
    toast("Could not create part", "error")
    return
  }
  el("new-code").value = ""
  el("new-label").value = ""
  toast("Part created")
  await Promise.all([loadParts(), loadLabels()])
}

async function showApp() {
  state.profile = JSON.parse(localStorage.getItem("profile") ?? "null")
  el("session-name").textContent = state.profile ? `${state.profile.name} (${state.profile.role})` : ""
  el("session").classList.remove("hidden")
  el("login-view").classList.add("hidden")
  el("app-view").classList.remove("hidden")
  await loadStages()
  await Promise.all([loadParts(), loadLabels()])
}

async function signIn(event) {
  event.preventDefault()
  const email = el("login-email").value
  const password = el("login-password").value
  const response = await fetch("/api/session", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  })
  if (!response.ok) {
    const error = el("login-error")
    error.textContent = "Wrong email or password"
    error.classList.remove("hidden")
    return
  }
  const { data } = await response.json()
  state.token = data.token
  state.profile = data.profile
  localStorage.setItem("token", data.token)
  localStorage.setItem("profile", JSON.stringify(data.profile))
  await showApp()
}

function signOut() {
  localStorage.removeItem("token")
  localStorage.removeItem("profile")
  location.reload()
}

document.addEventListener("click", (event) => {
  const target = event.target
  if (target instanceof HTMLElement && target.dataset.action === "delete") {
    void deletePart(target.dataset.id)
  }
})

el("login-form").addEventListener("submit", signIn)
el("logout").addEventListener("click", signOut)
el("create-part").addEventListener("click", () => void createPart())

if (state.token) void showApp()
