import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { isAbsolute, join } from 'node:path';
import { createSubstratePersona } from '../dist/substrate-persona.js';

async function settings() {
  const file = process.env.PIDA_PERSONA_CATALOGUE;
  const python = process.env.PIDA_PERSONA_SUBSTRATE_PYTHON;
  if (!file || !isAbsolute(file) || !python || !isAbsolute(python)) throw Error('PERSONA_CATALOGUE_CONFIG_REQUIRED');
  const raw = await readFile(file, 'utf8');
  const entries = JSON.parse(raw);
  if (!Array.isArray(entries) || entries.length > 32) throw Error('PERSONA_CATALOGUE_INVALID');
  return { entries, python, digest: createHash('sha256').update(JSON.stringify([python, raw])).digest('hex') };
}
export async function hostPersonaIdentity() { return (await settings()).digest; }
export async function createHostPersona() {
  const { entries, python } = await settings();
  return { mode: 'persona-substrate/1', close() {}, personaSources: entries.map(({ id, label, principalIds }) => ({
    id, label, principalIds, create: context => createSubstratePersona(python,
      join(context.workspaceId, '.pida', 'persona-stores'), context, id)
  })) };
}
