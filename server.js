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
const io = new Server(server, {
  cors: { origin: '*' },
  maxHttpBufferSize: 1e8 // 100 MB buffer
});

// Uploads directory configuration
const UPLOADS_DIR = path.join(__dirname, 'uploads');
if (!fs.existsSync(UPLOADS_DIR)) {
  fs.mkdirSync(UPLOADS_DIR, { recursive: true });
}

// In-memory data store
// roomsData: { [roomId]: [ { id, name, size, mimeType, filename, uploadedAt } ] }
const roomsData = {};
// activePeers: { [roomId]: { [socketId]: deviceInfo } }
const activePeers = {};

// Helper to get local network IP address
function getLocalIp() {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const net of interfaces[name]) {
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
    cb(null, `${fileId}-${originalName}`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 2000 * 1024 * 1024 } // 2 GB limit for server upload fallback
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

// Upload endpoint (Async / Server Relay fallback)
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
    mimeType: file.mimetype || 'application/octet-stream',
    filename: file.filename,
    uploadedAt: Date.now()
  };

  if (!roomsData[roomId]) {
    roomsData[roomId] = [];
  }
  roomsData[roomId].push(fileData);

  // Notify all sockets in room
  io.to(roomId).emit('file-shared', fileData);

  res.status(200).json({ success: true, file: fileData });
});

// High performance stream / range download endpoint
app.get('/api/download/:filename', (req, res) => {
  const filename = req.params.filename;
  const filePath = path.join(UPLOADS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    return res.status(404).send('File not found or expired.');
  }

  const stat = fs.statSync(filePath);
  const fileSize = stat.size;
  const originalName = filename.length > 37 ? filename.substring(37) : filename;
  const range = req.headers.range;

  if (range) {
    const parts = range.replace(/bytes=/, "").split("-");
    const start = parseInt(parts[0], 10);
    const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
    const chunksize = (end - start) + 1;
    const fileStream = fs.createReadStream(filePath, { start, end });

    res.writeHead(206, {
      'Content-Range': `bytes ${start}-${end}/${fileSize}`,
      'Accept-Ranges': 'bytes',
      'Content-Length': chunksize,
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(originalName)}"`
    });
    fileStream.pipe(res);
  } else {
    res.writeHead(200, {
      'Content-Length': fileSize,
      'Content-Type': 'application/octet-stream',
      'Content-Disposition': `attachment; filename="${encodeURIComponent(originalName)}"`
    });
    fs.createReadStream(filePath).pipe(res);
  }
});

// WebRTC Signaling & Room Socket Management
io.on('connection', (socket) => {
  let currentRoom = null;
  let currentPeerInfo = null;

  socket.on('join-room', ({ roomId, deviceInfo }) => {
    if (!roomId) return;

    currentRoom = roomId;
    currentPeerInfo = {
      peerId: socket.id,
      deviceName: deviceInfo?.name || 'Unknown Device',
      deviceType: deviceInfo?.type || 'desktop',
      browser: deviceInfo?.browser || 'Browser',
      os: deviceInfo?.os || 'OS',
      joinedAt: Date.now()
    };

    socket.join(roomId);

    if (!activePeers[roomId]) {
      activePeers[roomId] = {};
    }

    // Existing peers in this room
    const existingPeers = Object.values(activePeers[roomId]);

    // Add this socket to active peers list
    activePeers[roomId][socket.id] = currentPeerInfo;

    // Send existing peers list to newly joined peer
    socket.emit('room-peers', existingPeers);

    // Notify other peers in room about new peer
    socket.to(roomId).emit('peer-joined', currentPeerInfo);

    console.log(`[Socket] ${currentPeerInfo.deviceName} (${socket.id}) joined room "${roomId}"`);
  });

  // WebRTC P2P Signaling Relays
  socket.on('p2p-signal', ({ targetPeerId, signal }) => {
    io.to(targetPeerId).emit('p2p-signal', {
      senderPeerId: socket.id,
      signal
    });
  });

  socket.on('p2p-offer', ({ targetPeerId, offer, fileMeta }) => {
    io.to(targetPeerId).emit('p2p-offer', {
      senderPeerId: socket.id,
      offer,
      fileMeta
    });
  });

  socket.on('p2p-answer', ({ targetPeerId, answer }) => {
    io.to(targetPeerId).emit('p2p-answer', {
      senderPeerId: socket.id,
      answer
    });
  });

  socket.on('p2p-ice-candidate', ({ targetPeerId, candidate }) => {
    io.to(targetPeerId).emit('p2p-ice-candidate', {
      senderPeerId: socket.id,
      candidate
    });
  });

  // Text / Clipboard Beam feature
  socket.on('send-text-beam', ({ roomId, text }) => {
    if (!text || !roomId) return;
    const payload = {
      id: uuidv4(),
      text,
      senderPeerId: socket.id,
      senderName: currentPeerInfo?.deviceName || 'Peer',
      timestamp: Date.now()
    };
    io.to(roomId).emit('text-beam-received', payload);
  });

  // Clean disconnect
  socket.on('disconnect', () => {
    if (currentRoom && activePeers[currentRoom]) {
      delete activePeers[currentRoom][socket.id];
      if (Object.keys(activePeers[currentRoom]).length === 0) {
        delete activePeers[currentRoom];
      } else {
        io.to(currentRoom).emit('peer-left', { peerId: socket.id });
      }
    }
    console.log(`[Socket] Peer ${socket.id} disconnected`);
  });
});

// File Expiration Cleanup (Every 2 mins, delete files older than 1 hour)
const FILE_EXPIRY_MS = 60 * 60 * 1000;
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

// Start Server
const PORT = process.env.PORT || 3000;
const localIp = getLocalIp();

server.listen(PORT, '0.0.0.0', () => {
  console.log(`==================================================`);
  console.log(`🚀 AirShare Pro Transfer Server Active`);
  console.log(`  Local Access:   http://localhost:${PORT}`);
  console.log(`  Network Access: http://${localIp}:${PORT}`);
  console.log(`==================================================`);
});
