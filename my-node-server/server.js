const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require("body-parser");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

let lastMessage = null;

// parse requests of content-type: application/json
app.use(bodyParser.json());

// parse requests of content-type: application/x-www-form-urlencoded
app.use(bodyParser.urlencoded({ extended: true }));

// simple route, this will send a json message whenever a get request is sent to the root of our program
// Express Middleware for serving static files

app.use(express.static('public'));

app.get('/', function(req, res) {
    res.send('hello world');
});

// Middleware
app.use(express.json());

const getRoutes = require('./routes/messages.get');
const postRoutes = require('./routes/messages.post');

// mount them both under /messages
app.use('/messages', getRoutes);
app.use('/messages', postRoutes);

// Handle incoming HTTP POST requests
app.use(express.json());

app.post('/receive', (req, res) => {
    lastMessage = req.body; // Update the last message
    console.log('Received Data:', lastMessage);

    // Emit the new message to all connected WebSocket clients
    io.emit('updateMessage', lastMessage);
    
    res.send("Message received and broadcasted to the page!");
});

// Start the server
const PORT = 80;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
