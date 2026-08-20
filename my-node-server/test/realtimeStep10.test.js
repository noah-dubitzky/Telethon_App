'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { createRealtime, roomForUser } = require('../services/realtime');

assert.strictEqual(roomForUser(12), 'user:12');
assert.strictEqual(roomForUser('19'), 'user:19');

const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
const ingestion = fs.readFileSync(path.join(__dirname, '..', 'routes', 'messages.post.js'), 'utf8');
const auth = fs.readFileSync(path.join(__dirname, '..', 'routes', 'auth.js'), 'utf8');
const realtime = fs.readFileSync(path.join(__dirname, '..', 'services', 'realtime.js'), 'utf8');

assert.doesNotMatch(server, /io\.emit\s*\(/, 'private data must not be globally broadcast');
assert.doesNotMatch(server, /app\.post\(['"]\/receive/, 'legacy unauthenticated live endpoint must be removed');
assert.match(server, /createRealtime\(\{ io, sessionMiddleware, sessionStore \}\)/);
assert.match(realtime, /socket\.request\.session\?\.userId/);
assert.match(realtime, /socket\.join\(room\)/);
assert.match(realtime, /sessionStore\.get\(sessionId/);
assert.match(ingestion, /await conn\.commit\(\)[\s\S]*emitToUser/,
  'archive commit must happen before live delivery');
assert.match(ingestion, /SELECT user_id FROM telegram_accounts WHERE id = \?/,
  'the database must resolve account ownership');
assert.match(auth, /disconnectSession\(sessionId\)/,
  'logout must disconnect sockets belonging to the destroyed session');

for (const relative of [
  'public/scripts/account_dashboard.js',
  'public/scripts/socket_load_messages.js'
]) {
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  assert.match(source, /data\.telegram_account_id/, `${relative} must filter live data by account`);
}

for (const relative of [
  'public/desktop/sender.html',
  'public/desktop/channels.html',
  'public/mobile/sender.html',
  'public/mobile/channels.html'
]) {
  const source = fs.readFileSync(path.join(__dirname, '..', relative), 'utf8');
  assert.match(source, /socket_load_messages\.js/, `${relative} must load the shared live refresh handler`);
  assert.doesNotMatch(source, /socket\.on\(['"]updateMessage/, `${relative} must not register a duplicate inline handler`);
}

const liveReload = fs.readFileSync(path.join(__dirname, '..', 'public', 'scripts', 'socket_load_messages.js'), 'utf8');
assert.match(liveReload, /data\.sender_database_id/);
assert.match(liveReload, /data\.channel_database_id/);
assert.match(liveReload, /getMessagesBySender\(entityId, 0, accountId\)/);
assert.match(liveReload, /getMessagesByChannel\(entityId, 0, accountId\)/);

class FakeSocket {
  constructor(userId, sessionId) {
    this.data = { userId, sessionId };
    this.rooms = new Set();
    this.events = [];
    this.disconnected = false;
  }
  join(room) { this.rooms.add(room); }
  on() {}
  emit(event, payload) { this.events.push({ event, payload }); }
  disconnect() { this.disconnected = true; }
}

class FakeIo {
  constructor(sockets) { this.sockets = sockets; this.middleware = []; }
  use(fn) { this.middleware.push(fn); }
  on() {}
  in(room) { return { fetchSockets: async () => this.sockets.filter(socket => socket.rooms.has(room)) }; }
  async fetchSockets() { return this.sockets; }
}

(async () => {
  const aTabOne = new FakeSocket(12, 'a1');
  const aTabTwo = new FakeSocket(12, 'a2');
  const bTab = new FakeSocket(19, 'b1');
  const expiredATab = new FakeSocket(12, 'expired');
  [aTabOne, aTabTwo, expiredATab].forEach(socket => socket.join('user:12'));
  bTab.join('user:19');
  const io = new FakeIo([aTabOne, aTabTwo, bTab, expiredATab]);
  const sessions = new Map([
    ['a1', { userId: 12 }], ['a2', { userId: 12 }], ['b1', { userId: 19 }]
  ]);
  const sessionStore = {
    get(id, callback) { callback(null, sessions.get(id)); }
  };
  const realtimeService = createRealtime({
    io,
    sessionStore,
    sessionMiddleware: (_request, _response, next) => next()
  });

  await realtimeService.emitToUser(12, 'updateMessage', { telegram_account_id: 27 });
  assert.strictEqual(aTabOne.events.length, 1, 'first User A tab receives its event');
  assert.strictEqual(aTabTwo.events.length, 1, 'second User A tab receives its event');
  assert.strictEqual(bTab.events.length, 0, 'User B never receives User A data');
  assert.strictEqual(expiredATab.events.length, 0, 'expired sessions receive no private data');
  assert.strictEqual(expiredATab.disconnected, true, 'expired sessions are disconnected');

  await realtimeService.emitToUser(19, 'updateMessage', { telegram_account_id: 52 });
  assert.strictEqual(bTab.events.length, 1, 'User B receives its own event');
  assert.strictEqual(aTabOne.events.length, 1, 'User A never receives User B data');

  await realtimeService.disconnectSession('a1');
  assert.strictEqual(aTabOne.disconnected, true, 'logout disconnects only that browser session');
  assert.strictEqual(aTabTwo.disconnected, false, 'another valid session remains connected');
  console.log('Step 10 realtime security tests passed');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
