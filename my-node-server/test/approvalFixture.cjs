'use strict';
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { createRequire } = require('node:module');
function load(relative, mocks = {}) {
  const filename = path.join(__dirname, '..', relative);
  const mod = { exports: {} };
  const realRequire = createRequire(filename);
  vm.runInThisContext(`(function(require,module,exports,__dirname,__filename){${fs.readFileSync(filename, 'utf8')}\n})`, { filename })(
    name => Object.hasOwn(mocks, name) ? mocks[name] : realRequire(name), mod, mod.exports, path.dirname(filename), filename);
  return mod.exports;
}
async function listen(t, app) {
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  t.after(() => new Promise(resolve => { server.closeAllConnections(); server.close(resolve); }));
  return `http://127.0.0.1:${server.address().port}`;
}
module.exports = { load, listen };
