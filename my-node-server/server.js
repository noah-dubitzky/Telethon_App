const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');
const bodyParser = require("body-parser");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const filtersRouter = require('./routes/filters');

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.static(path.join(__dirname, 'public', 'desktop')));

app.get('/', function(req, res) {
    res.sendFile(path.join(__dirname, 'public', 'desktop', 'index.html'));
});

app.use('/api/filters', filtersRouter);

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
