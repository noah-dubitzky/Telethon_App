require('dotenv').config();

const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const session = require('express-session');
const MySQLSessionStore = require('express-mysql-session')(session);

if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
  throw new Error('SESSION_SECRET must be set to at least 32 characters');
}
const app = express();
const server = http.createServer(app);
const io = new Server(server);

const filtersRouter = require('./routes/filters');
const pdfExportRouter = require('./routes/pdf.export');
const authRouter = require('./routes/auth');
const telegramAccountsRouter = require('./routes/telegram-accounts');
const mediaRouter = require('./routes/media');

const sessionCookieName = 'telesaver.sid';
const sessionCookieOptions = {
  httpOnly: true,
  secure: process.env.NODE_ENV === 'production',
  sameSite: 'lax',
  maxAge: 1000 * 60 * 60 * 24 * 7,
  path: '/'
};
const sessionCookieClearOptions = {
  httpOnly: sessionCookieOptions.httpOnly,
  secure: sessionCookieOptions.secure,
  sameSite: sessionCookieOptions.sameSite,
  path: sessionCookieOptions.path
};
const sessionStore = process.env.NODE_ENV === 'production'
  ? new MySQLSessionStore({
      createDatabaseTable: true,
      schema: { tableName: 'website_sessions' }
    }, {
      host: process.env.DB_HOST,
      port: Number(process.env.DB_PORT || 3306),
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      database: process.env.DB_NAME || 'messaging_personal'
    })
  : undefined;

if (process.env.NODE_ENV === 'production') {
  app.set('trust proxy', 1);
}
app.locals.sessionCookieName = sessionCookieName;
app.locals.sessionCookieClearOptions = sessionCookieClearOptions;

app.use(express.json());
app.use(session({
  name: sessionCookieName,
  secret: process.env.SESSION_SECRET,
  store: sessionStore,
  resave: false,
  saveUninitialized: false,
  cookie: sessionCookieOptions
}));
app.get('/favicon.ico', (req, res) => res.status(204).end());
// Private uploads must be intercepted before the general public static mount.
app.use('/uploads', mediaRouter);
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname, 'public', 'middleware', 'index.html'));
});
app.use(express.static(path.join(__dirname, 'public', 'desktop')));

app.use('/api/filters', filtersRouter);
app.use('/api/auth', authRouter);
app.use('/api/telegram-accounts', telegramAccountsRouter);
app.use('/export', pdfExportRouter);

const getRoutes = require('./routes/messages.get');
const postRoutes = require('./routes/messages.post');
const filterCheckRoute = require('./routes/filters.check');

app.use(filterCheckRoute);
app.use('/messages', getRoutes);
app.use('/messages', postRoutes);

app.post('/receive', (req, res) => {
    const lastMessage = req.body;
    console.log('Received Data:', lastMessage);
    io.emit('updateMessage', lastMessage);
    res.send("Message received and broadcasted to the page!");
});

const PORT = process.env.PORT || 80;
const HOST = process.env.HOST || '0.0.0.0';

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
});
