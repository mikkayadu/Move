#!/usr/bin/env node
/**
 * Lists every model the configured Google AI Studio key can reach.
 *
 * Model ids differ between Gemma releases and serving surfaces, so rather than
 * hard-coding a guess this asks the API directly. Run it once after adding
 * your key, then set GEMMA_MODEL in .env to the id you want.
 *
 * Usage: npm run models   (from the repo root)
 */
const { readFileSync } = require('node:fs');
const { resolve } = require('node:path');

function loadEnv() {
  for (const candidate of ['../../.env', '.env']) {
    try {
      const raw = readFileSync(resolve(__dirname, '..', candidate), 'utf8');
      for (const line of raw.split(/\r?\n/)) {
        const match = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (match && !process.env[match[1]]) {
          process.env[match[1]] = match[2].replace(/^["']|["']$/g, '');
        }
      }
    } catch {
      // Missing file is fine; the variable may come from the real environment.
    }
  }
}

async function main() {
  loadEnv();

  const apiKey = process.env.GOOGLE_AI_API_KEY;
  if (!apiKey) {
    console.error('GOOGLE_AI_API_KEY is not set. Add it to .env first.');
    process.exit(1);
  }

  const response = await fetch('https://generativelanguage.googleapis.com/v1beta/models', {
    headers: { 'x-goog-api-key': apiKey },
  });

  if (!response.ok) {
    console.error(`Request failed: HTTP ${response.status}`);
    console.error(await response.text());
    process.exit(1);
  }

  const { models = [] } = await response.json();
  const ids = models
    .map((model) => model.name.replace(/^models\//, ''))
    .filter((id) => (model_supports_generate(models, id)))
    .sort();

  const gemma = ids.filter((id) => id.includes('gemma'));

  console.log(`\n${ids.length} models visible to this key.\n`);
  console.log('Gemma models:');
  if (gemma.length === 0) {
    console.log('  (none - your key may not have Gemma access on this surface)');
  } else {
    for (const id of gemma) console.log(`  ${id}`);
  }

  console.log('\nCurrently configured GEMMA_MODEL:', process.env.GEMMA_MODEL || '(unset)');
  console.log('\nAll visible models:');
  for (const id of ids) console.log(`  ${id}`);
  console.log('');
}

function model_supports_generate(models, id) {
  const entry = models.find((model) => model.name.replace(/^models\//, '') === id);
  const methods = entry?.supportedGenerationMethods ?? [];
  return methods.length === 0 || methods.includes('generateContent');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
