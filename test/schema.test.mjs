import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, assertSupported } from '../tools/lib/schema.mjs';

const personSchema = {
  type: 'object',
  required: ['name', 'age'],
  additionalProperties: false,
  properties: {
    name: { type: 'string', minLength: 2, maxLength: 40 },
    age: { type: 'integer', minimum: 0, maximum: 150 },
    email: { type: 'string', format: 'uri' },
    tags: { type: 'array', minItems: 0, maxItems: 5, items: { type: 'string', pattern: '^[a-z]+$' } },
  },
};

test('a fully valid document produces zero errors', () => {
  const errs = validate({ name: 'Ada', age: 36, tags: ['pioneer'] }, personSchema);
  assert.deepEqual(errs, []);
});

test('missing a required property is reported', () => {
  const errs = validate({ name: 'Ada' }, personSchema);
  assert.equal(errs.length, 1);
  assert.match(errs[0].message, /missing required property "age"/);
});

test('additionalProperties:false rejects an unknown key', () => {
  const errs = validate({ name: 'Ada', age: 36, favouriteColour: 'blue' }, personSchema);
  assert.ok(errs.some((e) => /unknown property "favouriteColour"/.test(e.message)));
});

test('wrong type is caught and short-circuits deeper checks on that field', () => {
  const errs = validate({ name: 'Ada', age: 'thirty-six' }, personSchema);
  assert.ok(errs.some((e) => /expected integer, got string/.test(e.message)));
});

test('string length bounds, numeric bounds and array item patterns all enforce', () => {
  const errs = validate({ name: 'A', age: 200, tags: ['NotLowercase'] }, personSchema);
  assert.ok(errs.some((e) => /too short/.test(e.message)));
  assert.ok(errs.some((e) => /must be <= 150/.test(e.message)));
  assert.ok(errs.some((e) => /does not match/.test(e.message)));
});

test('$ref resolves against $defs', () => {
  const schema = {
    type: 'object',
    properties: { owner: { $ref: '#/$defs/person' } },
    $defs: { person: personSchema },
  };
  const errs = validate({ owner: { name: 'Ada' } }, schema);
  assert.ok(errs.some((e) => /missing required property "age"/.test(e.message)));
});

test('assertSupported throws on an unrecognised keyword instead of silently ignoring it', () => {
  assert.throws(
    () => assertSupported({ type: 'string', unevaluatedProperties: false }),
    /unsupported keyword "unevaluatedProperties"/
  );
});

test('assertSupported accepts the real edition schema without throwing', async () => {
  const { readFileSync } = await import('node:fs');
  const { fileURLToPath } = await import('node:url');
  const path = fileURLToPath(new URL('../schema/edition.schema.json', import.meta.url));
  const schema = JSON.parse(readFileSync(path, 'utf8'));
  assert.doesNotThrow(() => assertSupported(schema));
});
