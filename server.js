const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const os = require('os');
const { v4: uuidv4 } = require('uuid');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Directory where files are uploaded
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR);
}

// In-memory database of rooms and files
// format: { roomId: [ { id: fileId, name: originalName, size: file.size, filename: file.filename, uploadedAt: timestamp } ] }
const roomsData = {};

// Helper to get local IP address
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
      // skip internal (i.e. 127.0.0.1) and non-ipv4 addresses
      if (net.family === 'IPv4' && !net.internal) {
        return net.address;
      }
    }
  }
  return 'localhost';
}

// Multer Storage Configuration
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, UPLOADS_DIR);
  },
  filename: (req, file, cb) => {
    const fileId = uuidv4();
    const originalName = file.originalname;
    // Prefix with a UUID to prevent collisions
    cb(null, `${fileId}-${originalName}`);
  }
});

const upload = multer({ 
  storage,
  limits: { fileSize: 500 * 1024 * 1024 } // 500 MB limit
});

// Middlewares
app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json());

// Routes
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/room/:roomId', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Get active files in a room
app.get('/api/room/:roomId/files', (req, res) => {
  const { roomId } = req.params;
  res.json(roomsData[roomId] || []);
});

// Upload endpoint
app.post('/api/upload', upload.single('file'), (req, res) => {
  const { roomId } = req.body;
  const file = req.file;

  if (!file || !roomId) {
    return res.status(400).json({ error: 'Missing file or room ID' });
  }

  const fileId = file.filename.substring(0, 36);
  const originalName = file.filename.substring(37);

  const fileData = {
    id: fileId,
    name: originalName,
    size: file.size,
    filename: file.filename,
    uploadedAt: Date.now()
  };

  if (!roomsData[roomId]) {
    roomsData[roomId] = [];
  }
  roomsData[roomId].push(fileData);

  // Notify socket room that a new file is available
  io.to(roomId).emit('file-shared', fileData);

  res.status(200).json({ success: true, file: fileData });
});

// Download endpoint
app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(UPLOADS_DIR, filename);

  if (fs.existsSync(filePath)) {
    const originalName = filename.substring(37);
    res.download(filePath, originalName);
  } else {
    res.status(404).send('File not found or expired.');
  }
});

// Socket.IO signaling
io.on('connection', (socket) => {
  socket.on('join-room', (roomId) => {
    socket.join(roomId);
    console.log(`[Socket] User ${socket.id} joined room ${roomId}`);
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] User ${socket.id} disconnected`);
  });
});

// File Expiration Cleanup (removes files older than 1 hour, runs every 2 minutes)
const FILE_EXPIRY_MS = 60 * 60 * 1000; // 1 hour
setInterval(() => {
  const now = Date.now();
  for (const roomId of Object.keys(roomsData)) {
    roomsData[roomId] = roomsData[roomId].filter(file => {
      const age = now - file.uploadedAt;
      if (age > FILE_EXPIRY_MS) {
        const filePath = path.join(UPLOADS_DIR, file.filename);
        if (fs.existsSync(filePath)) {
          fs.unlink(filePath, (err) => {
            if (err) console.error(`Failed to delete expired file ${file.filename}:`, err);
            else console.log(`Deleted expired file: ${file.filename}`);
          });
        }
        return false;
      }
      return true;
    });

    if (roomsData[roomId].length === 0) {
      delete roomsData[roomId];
    }
  }
}, 2 * 60 * 1000);

// Start server
const PORT = process.env.PORT || 3000;
const localIp = getLocalIp();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`==================================================`);
  console.log(`File Share server running locally:`);
  console.log(`  Local:   http://localhost:${PORT}`);
  console.log(`  Network: http://${localIp}:${PORT}`);
  console.log(`==================================================`);
});
