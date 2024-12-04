const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const bodyParser = require("body-parser");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const UploadHandler = require('./uploadHandler');
const uploadHandler = new UploadHandler(); // Instantiate the upload handler

let lastMessage = null;
let lastImage = null;

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

// Handle incoming HTTP POST requests
app.use(express.json());

app.post('/receive', (req, res) => {
    lastMessage = req.body; // Update the last message
    console.log('Received Data:', lastMessage);

    // Emit the new message to all connected WebSocket clients
    io.emit('updateMessage', lastMessage);

    res.send("Message received and broadcasted to the page!");
});

// Routes for image uploads
app.post('/upload-image', uploadHandler.getImageUploader().single('image'), (req, res) => {
    if (req.file) {
        console.log('Image uploaded:', req.file);
        res.status(200).send('Image uploaded successfully');

        lastImage = req.file.path; // Update the last message

        // Emit the new message to all connected WebSocket clients
        io.emit('updateImage', lastImage);

    } else {
        res.status(400).send('No image uploaded');
    }
});

// Routes for video uploads
app.post('/upload-video', uploadHandler.getVideoUploader().single('video'), (req, res) => {
    if (req.file) {
        console.log('Video uploaded:', req.file);
        res.status(200).send('Video uploaded successfully');
    } else {
        res.status(400).send('No video uploaded');
    }
});

// Start the server
const PORT = 3000;
server.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
