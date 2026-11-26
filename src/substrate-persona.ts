import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { lstat, mkdir, mkdtemp, readFile, rename, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";
import { canonical, sha256 } from "./private-state.js";
import { type PersonaProvider, validatePersonaSnapshot } from "./persona-provider.js";
import { PidaError } from "./runtime.js";
import type { WorkspacePersonaContext } from "./workspace.js";

const execute = promisify(execFile);
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Discover an installed console script only in absolute host PATH entries. */
export function substratePython(): string | undefined {
  if (process.env.PIDA_PERSONA_SUBSTRATE_PYTHON) return process.env.PIDA_PERSONA_SUBSTRATE_PYTHON;
  const win = process.platform === "win32";
  for (const dir of (process.env.PATH ?? "").split(delimiter).filter(isAbsolute)) {
    if (!existsSync(join(dir, win ? "persona-substrate.exe" : "persona-substrate"))) continue;
    const names = win ? ["python.exe", "../python.exe"] : ["python3", "python"];
    for (const name of names) if (existsSync(join(dir, name))) return join(dir, name);
  }
  return undefined;
}
export function createSubstratePersona(python: string, root: string, context: WorkspacePersonaContext, source = "workspace",
  existing?: { store: string; ownerId: string }): PersonaProvider {
  if (!isAbsolute(python) || !isAbsolute(root)) throw new PidaError("PERSONA_CONFIGURATION_INVALID", 500);
  const { agentId, principal, workspaceId, role } = context;
  const scopeId = sha256(canonical({ workspaceId, agentId, principal: principal.id, source }));
  if (existing && (!isAbsolute(existing.store) || !uuid.test(existing.ownerId)))
    throw new PidaError("PERSONA_CONFIGURATION_INVALID", 500);
  const store = existing?.store ?? join(root, scopeId);
  async function readOwner() {
    if (!(await lstat(store)).isDirectory()) throw new Error("PERSONA_STORE_INVALID");
    const path = join(store, "manifest.json");
    if (!(await lstat(path)).isFile()) throw new Error("PERSONA_STORE_INVALID");
    const manifest = JSON.parse(await readFile(path, "utf8"));
    if (manifest.kind !== "manifest" || manifest.axis !== "member" || !uuid.test(manifest.owner_agent_id))
      throw new Error("PERSONA_STORE_INVALID");
    if (existing && manifest.owner_agent_id !== existing.ownerId) throw new PidaError("PERSONA_OWNER_MISMATCH", 403);
    return String(manifest.owner_agent_id);
  }
  async function identity(signal: AbortSignal) {
    if (existing) return readOwner();
    const current = await lstat(store).catch(error => {
      if (error.code !== "ENOENT") throw error;
      return null;
    });
    if (current) return readOwner();
    await mkdir(root, { recursive: true, mode: 0o700 });
    const stage = await mkdtemp(join(root, ".init-"));
    try {
      await execute(python, ["-I", "-B", "-m", "persona_substrate", "--store", stage, "init",
        "--axis", "member", "--owner-agent-id", randomUUID()], { signal, timeout: 20000, windowsHide: true });
      try { await rename(stage, store); }
      catch (error) {
        if (!["EEXIST", "ENOTEMPTY", "EPERM"].includes((error as NodeJS.ErrnoException).code ?? "")) throw error;
      }
      return await readOwner();
    } finally { await rm(stage, { recursive: true, force: true }); }
  }
  const id = "pida.persona-substrate/1";
  const provider: PersonaProvider = { id, agentId, authority: "external",
    async resolveContext(request) {
      request.signal.throwIfAborted();
      if (request.agentId !== agentId || request.principal.id !== principal.id)
        throw new PidaError("PERSONA_SCOPE_DENIED", 403);
      const personaId = await identity(request.signal);
      const { stdout } = await execute(python, ["-I", "-B", "-m", "persona_substrate", "--store", store, "status"],
        { signal: request.signal, timeout: 20000, windowsHide: true, maxBuffer: 131072 });
      // A current case can contain private goals and artifacts. Only the control state is shared.
      const control = stdout.trim() === "No live case" ? null : JSON.parse(stdout).control;
      if (control !== null && (typeof control !== "string" || control.length > 64)) throw new Error("PERSONA_STATE_INVALID");
      const text = JSON.stringify({ personaId, control });
      const digest = sha256(text);
      const snapshot = { text, descriptor: { schemaVersion: 1 as const, rendererVersion: id, truncated: false,
        personaRevision: null, informationState: null, experiences: [], personaBinding: {
          schemaVersion: 1 as const, authority: "external" as const, providerId: id, agentId, role, scopeId, personaId,
          contextRevision: digest, contextDigest: digest, rendererVersion: id, omitted: false } } };
      validatePersonaSnapshot(snapshot, provider);
      return snapshot;
    } };
  return provider;
}
