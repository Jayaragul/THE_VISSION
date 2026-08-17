// A deliberately small JSON Schema validator covering exactly the keywords used by
// schema/edition.schema.json. Hand-rolled so the toolchain has zero dependencies —
// if the schema grows a keyword this does not know, `assertSupported` shouts about it
// rather than silently passing everything.

const SUPPORTED = new Set([
  '$schema', '$id', '$ref', '$defs', '$comment', 'title', 'description', 'format',
  'type', 'required', 'additionalProperties', 'properties', 'items',
  'minLength', 'maxLength', 'pattern', 'enum', 'minimum', 'maximum',
  'minItems', 'maxItems',
]);

function typeOf(value) {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  if (Number.isInteger(value)) return 'integer';
  return typeof value;
}

function typeMatches(actual, expected) {
  if (expected === 'number') return actual === 'number' || actual === 'integer';
  if (expected === 'integer') return actual === 'integer';
  return actual === expected;
}

function resolve(schema, root) {
  if (!schema || !schema.$ref) return schema;
  const path = schema.$ref.replace(/^#\//, '').split('/');
  let node = root;
  for (const part of path) {
    node = node?.[part];
    if (!node) throw new Error(`Unresolvable $ref: ${schema.$ref}`);
  }
  return node;
}

export function assertSupported(schema, root = schema, where = '#') {
  for (const key of Object.keys(schema)) {
    if (!SUPPORTED.has(key)) {
      throw new Error(`schema uses unsupported keyword "${key}" at ${where}`);
    }
  }
  for (const [name, sub] of Object.entries(schema.properties || {})) {
    assertSupported(sub, root, `${where}/properties/${name}`);
  }
  for (const [name, sub] of Object.entries(schema.$defs || {})) {
    assertSupported(sub, root, `${where}/$defs/${name}`);
  }
  if (schema.items) assertSupported(schema.items, root, `${where}/items`);
}

/**
 * @returns {Array<{path: string, message: string}>} empty when valid
 */
export function validate(data, schema, root = schema, path = '') {
  const errors = [];
  const s = resolve(schema, root);
  const at = path || '(root)';

  if (s.type) {
    const actual = typeOf(data);
    if (!typeMatches(actual, s.type)) {
      errors.push({ path: at, message: `expected ${s.type}, got ${actual}` });
      return errors; // no point checking constraints against the wrong type
    }
  }

  if (s.enum && !s.enum.includes(data)) {
    errors.push({ path: at, message: `must be one of ${s.enum.join(' | ')} — got ${JSON.stringify(data)}` });
  }

  if (typeof data === 'string') {
    if (s.minLength != null && data.length < s.minLength) {
      errors.push({ path: at, message: `too short: ${data.length} chars, minimum ${s.minLength}` });
    }
    if (s.maxLength != null && data.length > s.maxLength) {
      errors.push({ path: at, message: `too long: ${data.length} chars, maximum ${s.maxLength}` });
    }
    if (s.pattern && !new RegExp(s.pattern).test(data)) {
      errors.push({ path: at, message: `does not match ${s.pattern}` });
    }
    if (s.format === 'date-time' && Number.isNaN(Date.parse(data))) {
      errors.push({ path: at, message: `not a parseable date-time: ${data}` });
    }
    if (s.format === 'uri' && !/^[a-z][a-z0-9+.-]*:/i.test(data)) {
      errors.push({ path: at, message: `not an absolute URI: ${data}` });
    }
  }

  if (typeof data === 'number') {
    if (s.minimum != null && data < s.minimum) {
      errors.push({ path: at, message: `must be >= ${s.minimum}` });
    }
    if (s.maximum != null && data > s.maximum) {
      errors.push({ path: at, message: `must be <= ${s.maximum}` });
    }
  }

  if (Array.isArray(data)) {
    if (s.minItems != null && data.length < s.minItems) {
      errors.push({ path: at, message: `needs at least ${s.minItems} item(s), has ${data.length}` });
    }
    if (s.maxItems != null && data.length > s.maxItems) {
      errors.push({ path: at, message: `allows at most ${s.maxItems} item(s), has ${data.length}` });
    }
    if (s.items) {
      data.forEach((item, i) => {
        errors.push(...validate(item, s.items, root, `${path}[${i}]`));
      });
    }
  }

  if (data && typeof data === 'object' && !Array.isArray(data)) {
    for (const key of s.required || []) {
      if (!(key in data)) {
        errors.push({ path: at, message: `missing required property "${key}"` });
      }
    }
    if (s.additionalProperties === false && s.properties) {
      for (const key of Object.keys(data)) {
        if (!(key in s.properties)) {
          errors.push({ path: at, message: `unknown property "${key}"` });
        }
      }
    }
    for (const [key, sub] of Object.entries(s.properties || {})) {
      if (key in data) {
        errors.push(...validate(data[key], sub, root, path ? `${path}.${key}` : key));
      }
    }
  }

  return errors;
}
