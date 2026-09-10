const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
function load(relative, mocks) {
  const filename = path.join(__dirname, '..', relative);
  const mod = { exports: {} };
  const real = createRequire(filename);
  vm.runInThisContext(`(function(require,module,exports){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(name => mocks[name] || real(name), mod, mod.exports);
  return mod.exports;
}
test('storage preferences validate types and persist independently per user', async () => {
  const records = new Map();
  const service = load('services/storageSettings.js', {
    '../public/scripts/db': { async execute(sql, args) {
      if (sql.startsWith('SELECT')) return [records.has(args[0]) ? [records.get(args[0])] : []];
      records.set(args[0], Object.fromEntries(Object.keys(service.defaults).map((key, i) => [key, args[i + 1]])));
      return [{}];
    } }
  });
  assert.deepEqual(await service.get(1), service.defaults);
  const settings = service.validate({ ...service.defaults, save_text: false, save_pdfs: false, max_file_size_mb: 25 });
  await service.save(1, settings);
  assert.deepEqual(await service.get(1), settings);
  assert.deepEqual(await service.get(2), service.defaults);
  for (const value of [0, -1, 1.5, '25', 100001, undefined]) {
    assert.throws(() => service.validate({ ...service.defaults, max_file_size_mb: value }));
  }
  assert.throws(() => service.validate({ ...service.defaults, save_text: 'false' }));
  assert.throws(() => service.validate({ ...service.defaults, user_id: 2 }));
});

test('settings routes require authentication and use session ownership', async () => {
  const routes = {};
  const auth = () => {};
  const router = {
    get(path, middleware, handler) { assert.equal(middleware, auth); routes['GET ' + path] = handler; },
    put(path, middleware, handler) { assert.equal(middleware, auth); routes['PUT ' + path] = handler; }
  };
  let saved;
  load('routes/storage.js', {
    express: { Router: () => router }, '../public/scripts/db': {}, '../services/s3Media': {},
    '../middleware/requireAuth': auth,
    '../services/storageSettings': {
      async get(id) { assert.equal(id, 7); return { save_text: false }; },
      validate(body) { if (!body.valid) throw new Error('Invalid settings'); return { save_text: false }; },
      async save(id, settings) { saved = { id, settings }; }
    }
  });
  const res = { code: 200, set() {}, json(body) { this.body = body; }, status(code) { this.code = code; return this; } };
  await routes['GET /settings']({ auth: { userId: 7 } }, res);
  assert.equal(res.body.settings.save_text, false);
  await routes['PUT /settings']({ auth: { userId: 7 }, body: { valid: true } }, res);
  assert.equal(saved.id, 7);
  await routes['PUT /settings']({ auth: { userId: 7 }, body: {} }, res);
  assert.equal(res.code, 400);
});
test('S3 totals paginate, isolate users, and count PDFs once without reading files', async () => {
  const previous = { bucket: process.env.S3_BUCKET_NAME, region: process.env.AWS_REGION };
  process.env.S3_BUCKET_NAME = 'test'; process.env.AWS_REGION = 'us-east-1';
  try {
    const calls = [];
    const prefix = 'users/1/telegram_accounts/2/';
    class Command { constructor(input) { this.input = input; } }
    const service = load('services/s3Media.js', { '@aws-sdk/client-s3': {
      ListObjectsV2Command: Command,
      S3Client: class { async send(command) {
        calls.push(command.input);
        return calls.length === 1 ? { Contents: [
          { Key: prefix + 'images/a.jpg', Size: 100 },
          { Key: prefix + 'documents/a.PDF', Size: 200 },
          { Key: 'users/10/telegram_accounts/2/images/private.jpg', Size: 999 },
          { Key: prefix + 'images/', Size: 50 }
        ], IsTruncated: true, NextContinuationToken: 'next' } : { Contents: [
          { Key: prefix + 'documents/no-extension', Size: 300 },
          { Key: prefix + 'pdf_exports/id/export', Size: 400 }
        ] };
      } }
    } });
    assert.deepEqual(await service.storageTotals('1', new Set([prefix + 'documents/no-extension'])), { mediaBytes: 100, pdfBytes: 900 });
    assert.equal(calls.length, 2);
    assert.equal(calls[0].Prefix, 'users/1/telegram_accounts/');
    assert.equal(calls[1].ContinuationToken, 'next');
    await assert.rejects(service.storageTotals('../2'));
  } finally {
    for (const [key, value] of [['S3_BUCKET_NAME', previous.bucket], ['AWS_REGION', previous.region]]) {
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
    }
  }
});
test('overview scopes database queries, caches per user, refreshes, and reports failures', async () => {
  let handler; let calls = 0; let fail = false;
  const router = { get(route, auth, callback) { assert.equal(auth, authentication); if (route === '/') handler = callback; }, put() {} };
  function authentication() {}
  load('routes/storage.js', {
    express: { Router: () => router },
    '../middleware/requireAuth': authentication,
    '../public/scripts/db': { async query(sql, args) {
      assert.match(sql, /ta.user_id = \?/);
      assert.ok(['1', '2'].includes(args[0]));
      return sql.includes('OCTET_LENGTH') ? [[{ bytes: '8' }]] : [[{ s3_key: 'pdf-key' }]];
    } },
    '../services/s3Media': { async storageTotals(user, keys) {
      calls++; assert.ok(keys.has('pdf-key'));
      if (fail) throw new Error('S3 unavailable');
      return { mediaBytes: Number(user) * 100, pdfBytes: 20 };
    } }
  });
  async function request(user, refresh) {
    const res = { code: 200, set() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ auth: { userId: user }, query: { refresh } }, res);
    return res;
  }
  assert.equal((await request(1)).body.total_bytes, 128);
  await request(1); assert.equal(calls, 1);
  assert.equal((await request(2)).body.total_bytes, 228);
  await request(1, '1'); assert.equal(calls, 3);
  fail = true;
  assert.equal((await request(1, '1')).code, 503);
});
