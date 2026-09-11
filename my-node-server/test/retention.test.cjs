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
const forever = { text_retention_days: null, media_retention_days: null, pdf_retention_days: null };
test('retention validates periods and recognizes shortening independently', () => {
  const service = load('services/retention.js', { '../public/scripts/db': {}, './s3Media': {} });
  assert.deepEqual(service.validate(forever), forever);
  for (const value of [0, -1, 1.5, '30', undefined, 36501]) assert.throws(() => service.validate({ ...forever, text_retention_days: value }));
  assert.equal(service.shortened(forever, { ...forever, pdf_retention_days: 30 }), true);
  assert.equal(service.shortened({ ...forever, text_retention_days: 30 }, forever), false);
});
test('preview uses saved dates, ownership, S3-only attachments and combines PDF counts', async () => {
  const queries = [];
  const db = { query: async () => [[{ now: '2026-09-10 12:00:00' }]], execute: async (sql, args) => {
    queries.push(sql); assert.equal(args[0], 7); assert.equal(args[2], '2026-09-10 12:00:00');
    assert.match(sql, /user_id = \?/); assert.match(sql, /<= TIMESTAMPADD\(DAY, -\?, \?\)/);
    return [[{ count: 2 }]];
  } };
  const service = load('services/retention.js', { '../public/scripts/db': db, './s3Media': {} });
  assert.deepEqual(await service.preview(7, { text_retention_days: 30, media_retention_days: 90, pdf_retention_days: 365 }), { text: 2, media: 2, pdfs: 4 });
  assert.match(queries[0], /m.saved_at/);
  assert.match(queries[1], /md.s3_key IS NOT NULL/);
  assert.match(queries[1], /AND NOT /);
  assert.match(queries[2], /application\/pdf/);
  assert.match(queries[3], /pe.created_at/);
  queries.length = 0;
  assert.deepEqual(await service.preview(7, forever), { text: 0, media: 0, pdfs: 0 });
  assert.equal(queries.length, 0);
});
test('cleanup preserves messages, deletes S3 first and retains failed files for retry', async () => {
  const actions = [];
  const settings = { text_retention_days: 30, media_retention_days: 90, pdf_retention_days: 365 };
  const db = {
    beginTransaction: async () => actions.push('begin'), commit: async () => actions.push('commit'), rollback: async () => actions.push('rollback'),
    query: async () => [[{ now: '2026-09-10 12:00:00' }]],
    execute: async (sql, args) => {
      if (sql.startsWith('INSERT')) return [{}];
      if (sql.includes('FROM user_storage_settings')) { assert.match(sql, /FOR UPDATE/); return [[settings]]; }
      if (sql.startsWith('UPDATE') || sql.startsWith('DELETE')) { actions.push(sql + ':' + args[0]); return [{}]; }
      assert.match(sql, /LIMIT 100 FOR UPDATE/); assert.equal(args[0], 7);
      if (sql.includes('FROM messages')) return [[{ id: 1 }]];
      if (sql.includes('FROM pdf_exports')) return [[{ id: 4, storage_key: 'pdf', user_id: 7, telegram_account_id: 8 }]];
      return sql.includes('AND NOT ') ? [[{ id: 2 }, { id: 3 }]] : [[]];
    }
  };
  const service = load('services/retention.js', { '../public/scripts/db': {}, './s3Media': {
    deleteObject: async row => { actions.push('s3:' + row.id); if (row.id === 3) throw new Error('denied'); },
    deletePdfExportObject: async () => actions.push('s3:4')
  } });
  await service.cleanupUser(7, db);
  assert.ok(actions.includes('UPDATE messages SET text = NULL WHERE id = ?:1'));
  assert.ok(actions.indexOf('s3:2') < actions.indexOf('DELETE FROM media WHERE id = ?:2'));
  assert.ok(!actions.includes('DELETE FROM media WHERE id = ?:3'));
  assert.ok(actions.indexOf('s3:4') < actions.indexOf('DELETE FROM pdf_exports WHERE id = ?:4'));
  assert.equal(actions.at(-1), 'commit');
});
test('shorter settings cannot be saved without a matching unexpired user preview', async () => {
  const routes = {};
  const router = { use() {}, get(path, fn) { routes['GET' + path] = fn; }, post(path, fn) { routes['POST' + path] = fn; }, put(path, fn) { routes['PUT' + path] = fn; } };
  let writes = 0;
  const db = { beginTransaction: async () => {}, rollback: async () => {}, commit: async () => {}, release() {}, execute: async () => { writes++; } };
  const service = load('services/retention.js', { '../public/scripts/db': {}, './s3Media': {} });
  service.get = async () => forever;
  load('routes/retention.js', { express: { Router: () => router }, '../public/scripts/db': { getConnection: async () => db }, '../middleware/requireAuth': () => {}, '../services/retention': service });
  const settings = { ...forever, media_retention_days: 30 };
  const req = { auth: { userId: 7 }, session: {}, body: { settings, confirmation_token: 'token' } };
  const res = { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; } };
  await routes['PUT/'](req, res); assert.equal(res.code, 409); assert.equal(writes, 0);
  const preview = { token: 'token', userId: '7', before: service.fingerprint(forever), after: service.fingerprint(settings), expires: Date.now() + 60000 };
  for (const change of [{ userId: '8' }, { expires: 1 }, { after: 'different' }, { before: 'stale' }]) {
    req.session.retentionPreview = { ...preview, ...change };
    await routes['PUT/'](req, res); assert.equal(writes, 0);
  }
  req.session.retentionPreview = preview;
  await routes['PUT/'](req, res); assert.equal(writes, 1); assert.equal(req.session.retentionPreview, undefined);
});
