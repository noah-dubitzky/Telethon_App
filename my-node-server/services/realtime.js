'use strict';

function roomForUser(userId) {
  return `user:${Number(userId)}`;
}

function wrapSessionMiddleware(middleware) {
  return (socket, next) => middleware(socket.request, {}, next);
}

function createRealtime({ io, sessionMiddleware, sessionStore, isSessionValid }) {
  io.use(wrapSessionMiddleware(sessionMiddleware));
  io.use(async (socket, next) => {
    const userId = Number(socket.request.session?.userId);
    if (!Number.isSafeInteger(userId) || userId <= 0) {
      return next(new Error('Authentication required'));
    }
    try {
      if (isSessionValid && !await isSessionValid(socket.request.session)) {
        return next(new Error('Authentication required'));
      }
    } catch (_) {
      return next(new Error('Authentication required'));
    }
    socket.data.userId = userId;
    socket.data.sessionId = socket.request.sessionID;
    return next();
  });

  io.on('connection', (socket) => {
    const room = roomForUser(socket.data.userId);
    socket.join(room);
    console.log(`Socket connected: user=${socket.data.userId}`);
    socket.on('disconnect', (reason) => {
      console.log(`Socket disconnected: user=${socket.data.userId} reason=${reason}`);
    });
  });

  function getSession(sessionId) {
    return new Promise((resolve, reject) => {
      sessionStore.get(sessionId, (error, value) => error ? reject(error) : resolve(value));
    });
  }

  async function emitToUser(userId, eventName, payload) {
    const room = roomForUser(userId);
    const sockets = await io.in(room).fetchSockets();
    for (const socket of sockets) {
      try {
        const currentSession = await getSession(socket.data.sessionId);
        if (Number(currentSession?.userId) !== Number(userId)
          || (isSessionValid && !await isSessionValid(currentSession))) {
          socket.disconnect(true);
          continue;
        }
        socket.emit(eventName, payload);
      } catch (error) {
        // A session-store failure must never turn a private emit into fail-open access.
        console.error(`Socket session validation failed: user=${userId} reason=${error.code || 'unknown'}`);
        socket.disconnect(true);
      }
    }
    console.log(`Socket event routed: user=${userId} event=${eventName} sockets=${sockets.length}`);
  }

  async function disconnectSession(sessionId) {
    if (!sessionId) return;
    const sockets = await io.fetchSockets();
    await Promise.all(sockets
      .filter((socket) => socket.data.sessionId === sessionId)
      .map((socket) => socket.disconnect(true)));
  }

  async function disconnectOtherSessions(userId, sessionId) {
    const sockets = await io.in(roomForUser(userId)).fetchSockets();
    sockets.filter(socket => socket.data.sessionId !== sessionId).forEach(socket => socket.disconnect(true));
  }

  return { emitToUser, disconnectSession, disconnectOtherSessions, roomForUser };
}

module.exports = { createRealtime, roomForUser, wrapSessionMiddleware };
