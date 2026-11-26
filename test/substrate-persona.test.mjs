import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { initWorkspace, readConfig, createWorkspace } from '../dist/workspace.js';

test('two unnamed personas receive independent member stores and retain their identity after restart',
  { skip: !process.env.PIDA_TEST_SUBSTRATE_PYTHON }, async t => {
    const prior = process.env.PIDA_PERSONA_SUBSTRATE_PYTHON;
    process.env.PIDA_PERSONA_SUBSTRATE_PYTHON = process.env.PIDA_TEST_SUBSTRATE_PYTHON;
    t.after(() => { if (prior === undefined) delete process.env.PIDA_PERSONA_SUBSTRATE_PYTHON;
      else process.env.PIDA_PERSONA_SUBSTRATE_PYTHON = prior; });
    const directory = await mkdtemp(join(tmpdir(), 'pida-personas-'));
    t.after(() => rm(directory, { recursive: true, force: true }));
    initWorkspace(directory);
    const config = readConfig(directory);
    config.tools.enabled = [];
    await writeFile(join(directory, 'pida.config.json'), JSON.stringify(config));
    let app = await createWorkspace(directory);
    t.after(async () => { await app.close(); });
    const principal = { id: 'local-user', permissions: ['lots:read'] };
    const agents = ['one', 'two'].map(name => app.agents.register(principal, { name }).id);
    const run = async id => {
      const runtime = await app.agents.getRuntime(id, principal);
      const session = await runtime.createSession(principal);
      await runtime.run(session.sessionId, principal, 'LOT-001');
    };
    const stores = join(directory, app.config.stateDir, 'persona-stores');
    async function owners() {
      const dirs = await readdir(stores);
      return Promise.all(dirs.sort().map(async dir => {
        const manifest = JSON.parse(await readFile(join(stores, dir, 'manifest.json')));
        assert.equal(manifest.axis, 'member');
        return manifest.owner_agent_id;
      }));
    }
    for (const agent of agents) await run(agent);
    const first = await owners();
    assert.equal(first.length, 2);
    assert.equal(new Set(first).size, 2);
    await app.close();
    app = await createWorkspace(directory);
    for (const agent of agents) await run(agent);
    assert.deepEqual(await owners(), first);
  });
import { createSubstratePersona } from '../dist/substrate-persona.js';
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

test('an explicitly bound store checks both owner and principal', { skip: !process.env.PIDA_TEST_SUBSTRATE_PYTHON }, async t => {
  const root = await mkdtemp(join(tmpdir(), 'pida-existing-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const python = process.env.PIDA_TEST_SUBSTRATE_PYTHON;
  const ownerId = randomUUID(), store = join(root, 'member');
  execFileSync(python, ['-I','-B','-m','persona_substrate','--store',store,'init','--axis','member','--owner-agent-id',ownerId]);
  const context = { workspaceId: root, agentId: 'agent', role: 'worker', principal: { id: 'admin', permissions: [] } };
  const request = { ...context, signal: new AbortController().signal };
  const bind = id => createSubstratePersona(python, root, context, 'member', { store, ownerId: id });
  assert.equal((await bind(ownerId).resolveContext(request)).descriptor.personaBinding.personaId, ownerId);
  await assert.rejects(bind(randomUUID()).resolveContext(request), { code: 'PERSONA_OWNER_MISMATCH' });
  await assert.rejects(bind(ownerId).resolveContext({ ...request, principal: { id: 'other', permissions: [] } }), { code: 'PERSONA_SCOPE_DENIED' });
});
