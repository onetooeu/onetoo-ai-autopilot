import fs from 'node:fs';
import path from 'node:path';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);

const dir = path.join(process.cwd(), 'schemas');
const files = fs.readdirSync(dir).filter(f => f.endsWith('.json'));

const schemas = [];
for (const f of files) {
  const p = path.join(dir, f);
  const json = JSON.parse(fs.readFileSync(p, 'utf8'));
  schemas.push({ f, json });
}

// Add all schemas first so $ref across files resolves.
for (const { json } of schemas) {
  if (json.$id) ajv.addSchema(json, json.$id);
}

let ok = true;
for (const { f, json } of schemas) {
  try {
    ajv.compile(json);
  } catch (e) {
    ok = false;
    console.error(`Schema compile failed: ${f}`);
    console.error(e);
  }
}

if (!ok) process.exit(1);
console.log(`OK: compiled ${files.length} schemas`);
