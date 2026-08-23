// AirShare Pro - Client WebRTC P2P & Server Relay Core Engine

// Global State
let roomId = '';
let socket = null;
let deviceInfo = null;
let activePeers = new Map(); // peerId -> peerInfo
let peerConnections = new Map(); // peerId -> RTCPeerConnection
let dataChannels = new Map(); // peerId -> RTCDataChannel
let receivingTransfers = new Map(); // transferId -> { name, size, mimeType, chunks, receivedBytes, startTime, totalChunks }

// Configuration Constants
const CHUNK_SIZE = 64 * 1024; // 64 KB binary chunk size for RTCDataChannel
const MAX_BUFFERED_AMOUNT = 1024 * 1024; // 1 MB high-water mark for backpressure
const RTC_CONFIG = {
  iceServers: [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    // Free community TURN servers (relay fallback for symmetric NAT)
    {
      urls: 'turn:openrelay.metered.ca:80',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    },
    {
      urls: 'turn:openrelay.metered.ca:443?transport=tcp',
      username: 'openrelayproject',
      credential: 'openrelayproject'
    }
  ]
};

// DOM Elements
const statusDot = document.getElementById('connection-status-dot');
const statusText = document.getElementById('connection-status-text');
const activePeerCountLabel = document.getElementById('active-peer-count');
const displayRoomId = document.getElementById('display-room-id');
const thisDeviceLabel = document.getElementById('this-device-label');
const shareLinkInput = document.getElementById('share-link-input');
const copyLinkBtn = document.getElementById('copy-link-btn');

// Tab Buttons & Sections
const tabP2p = document.getElementById('tab-p2p');
const tabVault = document.getElementById('tab-vault');
const tabText = document.getElementById('tab-text');
const sectionP2p = document.getElementById('section-p2p');
const sectionVault = document.getElementById('section-vault');
const sectionText = document.getElementById('section-text');

// P2P Elements
const peerListContainer = document.getElementById('peer-list-container');
const noPeersNotice = document.getElementById('no-peers-notice');
const p2pDropZone = document.getElementById('p2p-drop-zone');
const p2pFileInput = document.getElementById('p2p-file-input');
const p2pProgressCard = document.getElementById('p2p-progress-card');
const p2pTransferTitle = document.getElementById('p2p-transfer-title');
const p2pTransferPeer = document.getElementById('p2p-transfer-peer');
const p2pTransferPercent = document.getElementById('p2p-transfer-percent');
const p2pProgressBar = document.getElementById('p2p-progress-bar');
const p2pTransferSpeed = document.getElementById('p2p-transfer-speed');
const p2pTransferBytes = document.getElementById('p2p-transfer-bytes');
const p2pTransferEta = document.getElementById('p2p-transfer-eta');
const p2pReceivedList = document.getElementById('p2p-received-list');
const p2pEmptyReceived = document.getElementById('p2p-empty-received');
const p2pReceivedCount = document.getElementById('p2p-received-count');

// Vault Elements
const vaultDropZone = document.getElementById('vault-drop-zone');
const vaultFileInput = document.getElementById('vault-file-input');
const vaultProgressContainer = document.getElementById('vault-progress-container');
const vaultFilename = document.getElementById('vault-filename');
const vaultPercent = document.getElementById('vault-percent');
const vaultProgressBar = document.getElementById('vault-progress-bar');
const vaultFilesList = document.getElementById('vault-files-list');
const vaultEmptyState = document.getElementById('vault-empty-state');
const vaultCountSpan = document.getElementById('vault-count');

// Text Beam Elements
const textBeamInput = document.getElementById('text-beam-input');
const sendTextBeamBtn = document.getElementById('send-text-beam-btn');
const textBeamFeed = document.getElementById('text-beam-feed');
const textBeamEmpty = document.getElementById('text-beam-empty');
const clearTextHistoryBtn = document.getElementById('clear-text-history-btn');

// Modal & QR
const qrModal = document.getElementById('qr-modal');
const openQrModalBtn = document.getElementById('open-qr-modal-btn');
const closeQrModalBtn = document.getElementById('close-qr-modal-btn');
const radarQrBtn = document.getElementById('radar-qr-btn');
const qrcodeModalContainer = document.getElementById('qrcode-modal-container');
const newRoomTrigger = document.getElementById('new-room-trigger');

// Initialize Application
window.addEventListener('DOMContentLoaded', () => {
  deviceInfo = detectDeviceInfo();
  thisDeviceLabel.textContent = deviceInfo.name;

  setupRoomId();
  initializeSocket();
  setupEventListeners();
  setupTabNavigation();
  loadVaultFiles();
});

// 1. Device Fingerprinting Helper
function detectDeviceInfo() {
  const ua = navigator.userAgent;
  let browser = 'Browser';
  let os = 'OS';
  let type = 'desktop';

  if (/mobile/i.test(ua)) type = 'mobile';
  if (/tablet|ipad/i.test(ua)) type = 'tablet';

  if (/chrome|crios/i.test(ua)) browser = 'Chrome';
  else if (/firefox|fxios/i.test(ua)) browser = 'Firefox';
  else if (/safari/i.test(ua) && !/chrome/i.test(ua)) browser = 'Safari';
  else if (/edg/i.test(ua)) browser = 'Edge';

  if (/mac/i.test(ua)) os = 'macOS';
  else if (/win/i.test(ua)) os = 'Windows';
  else if (/android/i.test(ua)) os = 'Android';
  else if (/iphone|ipad|ipod/i.test(ua)) os = 'iOS';
  else if (/linux/i.test(ua)) os = 'Linux';

  return {
    name: `${browser} on ${os}`,
    type,
    browser,
    os
  };
}

// 2. Room Setup & History Routing
function setupRoomId() {
  const pathParts = window.location.pathname.split('/');
  if (pathParts.length >= 3 && pathParts[1] === 'room' && pathParts[2]) {
    roomId = pathParts[2];
  } else {
    roomId = Math.random().toString(36).substring(2, 8).toLowerCase();
    window.history.replaceState({}, '', `/room/${roomId}`);
  }
  
  displayRoomId.textContent = roomId;
  const fullUrl = `${window.location.origin}/room/${roomId}`;
  shareLinkInput.value = fullUrl;
}

// 3. Socket.IO Signaling Initialization
function initializeSocket() {
  socket = io();

  socket.on('connect', () => {
    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-400 status-glow';
    statusText.textContent = 'Connected';
    
    // Join room with device info
    socket.emit('join-room', { roomId, deviceInfo });
  });

  socket.on('disconnect', () => {
    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse';
    statusText.textContent = 'Disconnected';
  });

  // Room Peer Management
  socket.on('room-peers', (peers) => {
    activePeers.clear();
    peers.forEach(peer => {
      if (peer.peerId !== socket.id) {
        activePeers.set(peer.peerId, peer);
      }
    });
    updatePeerUI();
  });

  socket.on('peer-joined', (peer) => {
    if (peer.peerId !== socket.id) {
      activePeers.set(peer.peerId, peer);
      updatePeerUI();
      showToast(`🔌 Device connected: ${peer.deviceName}`, 'info');
      // Automatically initiate WebRTC connection
      initiateWebRTCConnection(peer.peerId);
    }
  });

  socket.on('peer-left', ({ peerId }) => {
    const peer = activePeers.get(peerId);
    if (peer) {
      showToast(`Device disconnected: ${peer.deviceName}`, 'warning');
      activePeers.delete(peerId);
      closeWebRTCConnection(peerId);
      updatePeerUI();
    }
  });

  // WebRTC Signaling Handlers
  socket.on('p2p-offer', async ({ senderPeerId, offer, fileMeta }) => {
    await handleWebRTCOffer(senderPeerId, offer, fileMeta);
  });

  socket.on('p2p-answer', async ({ senderPeerId, answer }) => {
    await handleWebRTCAnswer(senderPeerId, answer);
  });

  socket.on('p2p-ice-candidate', async ({ senderPeerId, candidate }) => {
    await handleWebRTCIceCandidate(senderPeerId, candidate);
  });

  // Server Room Updates
  socket.on('file-shared', (fileData) => {
    addVaultFileToUI(fileData);
    showToast(`New file in Room Vault: ${fileData.name}`, 'info');
  });

  socket.on('text-beam-received', (payload) => {
    addTextBeamToFeed(payload);
    showToast(`Text received from ${payload.senderName}`, 'success');
  });

  // ── Socket.IO Relay Receive Handlers (fallback when WebRTC unavailable) ──
  socket.on('relay-file-meta', (meta) => {
    if (meta.senderPeerId === socket.id) return; // ignore own
    receivingTransfers.set(meta.transferId, {
      transferId: meta.transferId,
      name: meta.name,
      size: meta.size,
      mimeType: meta.mimeType,
      totalChunks: meta.totalChunks,
      chunks: [],
      receivedBytes: 0,
      startTime: Date.now(),
      senderName: meta.senderName || 'Peer'
    });
    showP2PProgress(meta.name, meta.senderName);
  });

  socket.on('relay-file-chunk', ({ transferId, chunk, senderPeerId }) => {
    if (senderPeerId === socket.id) return;
    const transfer = receivingTransfers.get(transferId);
    if (!transfer) return;

    // chunk arrives as ArrayBuffer or base64 string
    let buffer;
    if (typeof chunk === 'string') {
      const binary = atob(chunk);
      buffer = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) buffer[i] = binary.charCodeAt(i);
      buffer = buffer.buffer;
    } else {
      buffer = chunk;
    }

    transfer.chunks.push(buffer);
    transfer.receivedBytes += buffer.byteLength;

    const percent = Math.min(100, Math.round((transfer.receivedBytes / transfer.size) * 100));
    const elapsed = (Date.now() - transfer.startTime) / 1000;
    const speed = elapsed > 0 ? transfer.receivedBytes / elapsed : 0;
    const etaSeconds = speed > 0 ? Math.ceil((transfer.size - transfer.receivedBytes) / speed) : 0;
    updateP2PProgressUI(percent, speed, transfer.receivedBytes, transfer.size, etaSeconds);
  });

  socket.on('relay-file-complete', ({ transferId, senderPeerId }) => {
    if (senderPeerId === socket.id) return;
    finalizeP2PFile(transferId);
  });
}

// 4. WebRTC Connection Signaling Implementation
async function initiateWebRTCConnection(targetPeerId) {
  if (peerConnections.has(targetPeerId)) return;

  const pc = new RTCPeerConnection(RTC_CONFIG);
  peerConnections.set(targetPeerId, pc);

  // Setup DataChannel
  const dc = pc.createDataChannel('airshare-p2p', { ordered: true });
  setupDataChannelHandlers(dc, targetPeerId);
  dataChannels.set(targetPeerId, dc);

  // ICE Candidates
  pc.onicecandidate = (event) => {
    if (event.candidate) {
      socket.emit('p2p-ice-candidate', {
        targetPeerId,
        candidate: event.candidate
      });
    }
  };

  try {
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    socket.emit('p2p-offer', { targetPeerId, offer });
  } catch (err) {
    console.error('Error creating WebRTC offer:', err);
  }
}

async function handleWebRTCOffer(senderPeerId, offer) {
  let pc = peerConnections.get(senderPeerId);
  if (!pc) {
    pc = new RTCPeerConnection(RTC_CONFIG);
    peerConnections.set(senderPeerId, pc);

    pc.ondatachannel = (event) => {
      const dc = event.channel;
      setupDataChannelHandlers(dc, senderPeerId);
      dataChannels.set(senderPeerId, dc);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        socket.emit('p2p-ice-candidate', {
          targetPeerId: senderPeerId,
          candidate: event.candidate
        });
      }
    };
  }

  await pc.setRemoteDescription(new RTCSessionDescription(offer));
  const answer = await pc.createAnswer();
  await pc.setLocalDescription(answer);

  socket.emit('p2p-answer', {
    targetPeerId: senderPeerId,
    answer
  });
}

async function handleWebRTCAnswer(senderPeerId, answer) {
  const pc = peerConnections.get(senderPeerId);
  if (pc) {
    await pc.setRemoteDescription(new RTCSessionDescription(answer));
  }
}

async function handleWebRTCIceCandidate(senderPeerId, candidate) {
  const pc = peerConnections.get(senderPeerId);
  if (pc) {
    try {
      await pc.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (err) {
      console.error('Error adding ICE candidate:', err);
    }
  }
}

function closeWebRTCConnection(peerId) {
  if (dataChannels.has(peerId)) {
    dataChannels.get(peerId).close();
    dataChannels.delete(peerId);
  }
  if (peerConnections.has(peerId)) {
    peerConnections.get(peerId).close();
    peerConnections.delete(peerId);
  }
}

// 5. DataChannel Data Transfer Engine (Chunks & Protocol)
function setupDataChannelHandlers(dc, peerId) {
  dc.binaryType = 'arraybuffer';

  dc.onopen = () => {
    console.log(`[WebRTC] P2P DataChannel connected with ${peerId}`);
    updatePeerUI();
  };

  dc.onclose = () => {
    console.log(`[WebRTC] P2P DataChannel closed with ${peerId}`);
  };

  dc.onerror = (err) => {
    console.error(`[WebRTC] DataChannel error:`, err);
  };

  dc.onmessage = (event) => {
    handleIncomingP2PMessage(event.data, peerId);
  };
}

// Handling Incoming Chunks / Messages
function handleIncomingP2PMessage(data, senderPeerId) {
  if (typeof data === 'string') {
    try {
      const msg = JSON.parse(data);
      if (msg.type === 'file-meta') {
        // Start receiving a new file
        receivingTransfers.set(msg.transferId, {
          transferId: msg.transferId,
          name: msg.name,
          size: msg.size,
          mimeType: msg.mimeType,
          totalChunks: msg.totalChunks,
          chunks: [],
          receivedBytes: 0,
          startTime: Date.now(),
          senderName: activePeers.get(senderPeerId)?.deviceName || 'Connected Peer'
        });
        showP2PProgress(msg.name, activePeers.get(senderPeerId)?.deviceName);
      } else if (msg.type === 'file-complete') {
        // Finalize transfer
        finalizeP2PFile(msg.transferId);
      }
    } catch (e) {
      console.error('Failed to parse text message:', e);
    }
  } else if (data instanceof ArrayBuffer) {
    // Standard binary chunk: first 36 bytes = transferId string
    const textDecoder = new TextDecoder();
    const transferId = textDecoder.decode(data.slice(0, 36));
    const chunkData = data.slice(36);

    const transfer = receivingTransfers.get(transferId);
    if (transfer) {
      transfer.chunks.push(chunkData);
      transfer.receivedBytes += chunkData.byteLength;

      const percent = Math.min(100, Math.round((transfer.receivedBytes / transfer.size) * 100));
      const elapsed = (Date.now() - transfer.startTime) / 1000;
      const speed = elapsed > 0 ? transfer.receivedBytes / elapsed : 0;
      const etaSeconds = speed > 0 ? Math.ceil((transfer.size - transfer.receivedBytes) / speed) : 0;

      updateP2PProgressUI(percent, speed, transfer.receivedBytes, transfer.size, etaSeconds);
    }
  }
}

// Finalize File Assembly & Automatic Browser Download
function finalizeP2PFile(transferId) {
  const transfer = receivingTransfers.get(transferId);
  if (!transfer) return;

  const blob = new Blob(transfer.chunks, { type: transfer.mimeType || 'application/octet-stream' });
  const downloadUrl = URL.createObjectURL(blob);

  // Trigger browser download
  const a = document.createElement('a');
  a.href = downloadUrl;
  a.download = transfer.name;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);

  // Add to Received Files UI
  addP2PReceivedCard(transfer, downloadUrl);

  showToast(`✅ File received & downloaded: ${transfer.name}`, 'success');
  receivingTransfers.delete(transferId);

  setTimeout(() => {
    p2pProgressCard.classList.add('hidden');
  }, 2000);
}

// 6. Sending Files — WebRTC DataChannel with Socket.IO relay fallback
function hasOpenDataChannel() {
  for (const [, dc] of dataChannels) {
    if (dc.readyState === 'open') return true;
  }
  return false;
}

async function sendFileViaP2P(file, targetPeerId = null) {
  const useRelay = !hasOpenDataChannel();

  if (useRelay && activePeers.size === 0) {
    showToast('No devices connected. Open this room on another device first.', 'warning');
    return;
  }

  const transferId = generateUUID();
  const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
  const fileMeta = {
    type: 'file-meta',
    transferId,
    name: file.name,
    size: file.size,
    mimeType: file.type,
    totalChunks
  };

  const mode = useRelay ? 'Server relay' : 'P2P direct';
  showP2PProgress(file.name, mode);

  if (useRelay) {
    // ── Socket.IO relay path ──
    socket.emit('relay-file-meta', fileMeta);

    const startTime = Date.now();
    let offset = 0;
    let chunkIndex = 0;

    const sendRelayChunk = () => {
      if (offset >= file.size) {
        socket.emit('relay-file-complete', { transferId });
        showToast(`Transfer complete: ${file.name}`, 'success');
        setTimeout(() => p2pProgressCard.classList.add('hidden'), 2000);
        return;
      }

      const slice = file.slice(offset, offset + CHUNK_SIZE);
      const reader = new FileReader();
      reader.onload = (e) => {
        const chunkBuffer = e.target.result;
        // Convert to base64 for Socket.IO transport
        const bytes = new Uint8Array(chunkBuffer);
        let binary = '';
        for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
        const base64 = btoa(binary);

        socket.emit('relay-file-chunk', { transferId, chunk: base64, chunkIndex });

        offset += slice.size;
        chunkIndex++;

        const percent = Math.min(100, Math.round((offset / file.size) * 100));
        const elapsed = (Date.now() - startTime) / 1000;
        const speed = elapsed > 0 ? offset / elapsed : 0;
        const etaSeconds = speed > 0 ? Math.ceil((file.size - offset) / speed) : 0;
        updateP2PProgressUI(percent, speed, offset, file.size, etaSeconds);

        // Throttle slightly to avoid flooding the socket
        setTimeout(sendRelayChunk, 5);
      };
      reader.readAsArrayBuffer(slice);
    };

    sendRelayChunk();
    return;
  }

  // ── WebRTC DataChannel path (original) ──
  const targets = targetPeerId ? [targetPeerId] : Array.from(dataChannels.keys());

  // Send metadata JSON to targets
  targets.forEach(peerId => {
    const dc = dataChannels.get(peerId);
    if (dc && dc.readyState === 'open') {
      dc.send(JSON.stringify(fileMeta));
    }
  });

  const startTime = Date.now();
  let offset = 0;
  let chunkIndex = 0;

  const readAndSendChunk = () => {
    if (offset >= file.size) {
      targets.forEach(peerId => {
        const dc = dataChannels.get(peerId);
        if (dc && dc.readyState === 'open') {
          dc.send(JSON.stringify({ type: 'file-complete', transferId }));
        }
      });

      showToast(`Transfer complete: ${file.name}`, 'success');
      setTimeout(() => p2pProgressCard.classList.add('hidden'), 2000);
      return;
    }

    let isBufferedFull = false;
    targets.forEach(peerId => {
      const dc = dataChannels.get(peerId);
      if (dc && dc.bufferedAmount > MAX_BUFFERED_AMOUNT) {
        isBufferedFull = true;
      }
    });

    if (isBufferedFull) {
      setTimeout(readAndSendChunk, 50);
      return;
    }

    const slice = file.slice(offset, offset + CHUNK_SIZE);
    const reader = new FileReader();

    reader.onload = (e) => {
      const chunkBuffer = e.target.result;

      const encoder = new TextEncoder();
      const idBytes = encoder.encode(transferId);
      const packet = new Uint8Array(idBytes.byteLength + chunkBuffer.byteLength);
      packet.set(idBytes, 0);
      packet.set(new Uint8Array(chunkBuffer), idBytes.byteLength);

      targets.forEach(peerId => {
        const dc = dataChannels.get(peerId);
        if (dc && dc.readyState === 'open') {
          dc.send(packet.buffer);
        }
      });

      offset += slice.size;
      chunkIndex++;

      const percent = Math.min(100, Math.round((offset / file.size) * 100));
      const elapsed = (Date.now() - startTime) / 1000;
      const speed = elapsed > 0 ? offset / elapsed : 0;
      const etaSeconds = speed > 0 ? Math.ceil((file.size - offset) / speed) : 0;

      updateP2PProgressUI(percent, speed, offset, file.size, etaSeconds);

      // Continue to next chunk
      setTimeout(readAndSendChunk, 0);
    };

    reader.readAsArrayBuffer(slice);
  };

  readAndSendChunk();
}

// 7. Room Vault (Server Relay) Upload Implementation
function uploadToVault(file) {
  if (file.size > 2000 * 1024 * 1024) {
    showToast('File size exceeds the 2GB server limit.', 'error');
    return;
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('roomId', roomId);

  const xhr = new XMLHttpRequest();
  vaultProgressContainer.classList.remove('hidden');
  vaultFilename.textContent = file.name;
  vaultProgressBar.style.width = '0%';
  vaultPercent.textContent = '0%';

  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) {
      const percent = Math.round((e.loaded / e.total) * 100);
      vaultProgressBar.style.width = `${percent}%`;
      vaultPercent.textContent = `${percent}%`;
    }
  });

  xhr.addEventListener('load', () => {
    if (xhr.status === 200) {
      showToast(`Vault upload complete: ${file.name}`, 'success');
      setTimeout(() => {
        vaultProgressContainer.classList.add('hidden');
      }, 1500);
    } else {
      showToast('Vault upload failed.', 'error');
      vaultProgressContainer.classList.add('hidden');
    }
    vaultFileInput.value = '';
  });

  xhr.addEventListener('error', () => {
    showToast('Network error during upload.', 'error');
    vaultProgressContainer.classList.add('hidden');
  });

  xhr.open('POST', '/api/upload');
  xhr.send(formData);
}

// Fetch Vault Files
async function loadVaultFiles() {
  try {
    const res = await fetch(`/api/room/${roomId}/files`);
    const files = await res.json();
    
    vaultFilesList.querySelectorAll('.vault-card').forEach(el => el.remove());
    
    if (files.length > 0) {
      vaultEmptyState.classList.add('hidden');
      files.forEach(file => addVaultFileToUI(file, false));
    } else {
      vaultEmptyState.classList.remove('hidden');
      vaultCountSpan.textContent = '0';
    }
  } catch (err) {
    console.error('Failed to load room vault files:', err);
  }
}

// Render Vault File Card
function addVaultFileToUI(fileData, incrementCounter = true) {
  vaultEmptyState.classList.add('hidden');
  if (document.getElementById(`vault-file-${fileData.id}`)) return;

  const card = document.createElement('div');
  card.id = `vault-file-${fileData.id}`;
  card.className = 'vault-card flex items-center justify-between p-4 bg-slate-900/80 rounded-2xl border border-slate-800 hover:border-slate-700 transition-all';
  
  const uploadTime = new Date(fileData.uploadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  card.innerHTML = `
    <div class="flex items-center gap-3.5 min-w-0 flex-1 pr-3">
      <div class="bg-emerald-500/10 p-3 rounded-xl border border-emerald-500/20 text-emerald-400 shrink-0">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      </div>
      <div class="min-w-0">
        <p class="text-sm font-bold text-slate-100 truncate hover:text-emerald-400 transition-colors" title="${fileData.name}">${fileData.name}</p>
        <div class="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400 font-medium">
          <span>${formatBytes(fileData.size)}</span>
          <span class="text-slate-600">•</span>
          <span>Uploaded ${uploadTime}</span>
        </div>
      </div>
    </div>
    <a href="/api/download/${fileData.filename}" download="${fileData.name}"
       class="bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white px-3.5 py-2 rounded-xl border border-emerald-500 text-xs font-semibold shrink-0 shadow-lg shadow-emerald-500/10 transition-all flex items-center gap-1.5">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
      <span>Download</span>
    </a>
  `;

  vaultFilesList.prepend(card);

  const totalCards = vaultFilesList.querySelectorAll('.vault-card').length;
  vaultCountSpan.textContent = totalCards;
}

// 8. Instant Text Beam Logic
function sendTextBeam() {
  const text = textBeamInput.value.trim();
  if (!text) {
    showToast('Please enter text to beam.', 'warning');
    return;
  }

  socket.emit('send-text-beam', { roomId, text });
  textBeamInput.value = '';
}

function addTextBeamToFeed(payload) {
  textBeamEmpty.classList.add('hidden');

  const card = document.createElement('div');
  card.className = 'glass-panel rounded-2xl p-4 flex flex-col gap-2 relative group border border-slate-800 hover:border-slate-700';

  const timeStr = new Date(payload.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  card.innerHTML = `
    <div class="flex justify-between items-center text-xs text-slate-400">
      <div class="flex items-center gap-2">
        <span class="font-bold text-fuchsia-400">${escapeHtml(payload.senderName)}</span>
        <span class="text-[10px] text-slate-500">${timeStr}</span>
      </div>
      <button class="copy-text-btn px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-medium transition-all active:scale-95">
        Copy Text
      </button>
    </div>
    <div class="text-xs font-mono text-slate-200 bg-slate-950/60 p-3 rounded-xl border border-slate-900 overflow-x-auto whitespace-pre-wrap selection:bg-fuchsia-500 selection:text-white">
      ${escapeHtml(payload.text)}
    </div>
  `;

  const copyBtn = card.querySelector('.copy-text-btn');
  copyBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(payload.text).then(() => {
      copyBtn.textContent = 'Copied!';
      copyBtn.classList.add('bg-emerald-600', 'text-white');
      setTimeout(() => {
        copyBtn.textContent = 'Copy Text';
        copyBtn.classList.remove('bg-emerald-600', 'text-white');
      }, 2000);
    });
  });

  textBeamFeed.prepend(card);
}

// 9. UI Peer Radar Updates
function updatePeerUI() {
  peerListContainer.innerHTML = '';
  
  const peerCount = activePeers.size + 1; // including self
  activePeerCountLabel.textContent = `${peerCount} Device${peerCount > 1 ? 's' : ''}`;

  if (activePeers.size === 0) {
    peerListContainer.appendChild(noPeersNotice);
    return;
  }

  activePeers.forEach((peer, peerId) => {
    const isP2PConnected = dataChannels.has(peerId) && dataChannels.get(peerId).readyState === 'open';

    const peerCard = document.createElement('div');
    peerCard.className = 'peer-card flex items-center justify-between p-3.5 bg-slate-900/90 rounded-2xl border border-slate-800';

    peerCard.innerHTML = `
      <div class="flex items-center gap-3">
        <div class="w-9 h-9 rounded-xl ${isP2PConnected ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/40' : 'bg-brand-500/20 text-brand-400 border border-brand-500/40'} flex items-center justify-center font-bold text-xs">
          ${peer.deviceType === 'mobile' ? '📱' : '💻'}
        </div>
        <div>
          <p class="text-xs font-bold text-slate-100 truncate max-w-[140px]">${escapeHtml(peer.deviceName)}</p>
          <div class="flex items-center gap-1.5 mt-0.5 text-[10px]">
            <span class="w-1.5 h-1.5 rounded-full ${isP2PConnected ? 'bg-emerald-400' : 'bg-amber-400'}"></span>
            <span class="text-slate-400">${isP2PConnected ? 'P2P Connected' : 'Connecting...'}</span>
          </div>
        </div>
      </div>
      <button class="direct-send-btn px-2.5 py-1.5 bg-brand-600 hover:bg-brand-500 text-white rounded-lg text-xs font-semibold shadow-md active:scale-95 transition-all">
        Send File
      </button>
    `;

    const directBtn = peerCard.querySelector('.direct-send-btn');
    directBtn.addEventListener('click', () => {
      p2pFileInput.dataset.targetPeer = peerId;
      p2pFileInput.click();
    });

    peerListContainer.appendChild(peerCard);
  });
}

// Progress Dashboard UI Helper
function showP2PProgress(title, peerName) {
  p2pProgressCard.classList.remove('hidden');
  p2pTransferTitle.textContent = title;
  p2pTransferPeer.textContent = `Target: ${peerName || 'All Peers'}`;
  p2pProgressBar.style.width = '0%';
  p2pTransferPercent.textContent = '0%';
  p2pTransferSpeed.textContent = '0 MB/s';
  p2pTransferEta.textContent = 'ETA: Calculating...';
}

function updateP2PProgressUI(percent, speedBytesPerSec, loadedBytes, totalBytes, etaSeconds) {
  p2pProgressBar.style.width = `${percent}%`;
  p2pTransferPercent.textContent = `${percent}%`;
  p2pTransferSpeed.textContent = formatSpeed(speedBytesPerSec);
  p2pTransferBytes.textContent = `${formatBytes(loadedBytes)} / ${formatBytes(totalBytes)}`;
  p2pTransferEta.textContent = `ETA: ${etaSeconds > 0 ? etaSeconds + 's' : 'Done'}`;
}

function addP2PReceivedCard(transfer, downloadUrl) {
  p2pEmptyReceived.classList.add('hidden');

  const card = document.createElement('div');
  card.className = 'flex items-center justify-between p-3.5 bg-slate-900/90 rounded-2xl border border-brand-500/30';

  card.innerHTML = `
    <div class="flex items-center gap-3 min-w-0 pr-2">
      <div class="p-2 rounded-xl bg-brand-500/10 border border-brand-500/30 text-brand-400">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
        </svg>
      </div>
      <div class="min-w-0">
        <p class="text-xs font-bold text-slate-100 truncate">${escapeHtml(transfer.name)}</p>
        <p class="text-[10px] text-slate-400 font-mono">${formatBytes(transfer.size)} • Direct P2P</p>
      </div>
    </div>
    <a href="${downloadUrl}" download="${transfer.name}" class="bg-brand-600 hover:bg-brand-500 text-white px-3 py-1.5 rounded-lg text-xs font-semibold shrink-0">
      Save
    </a>
  `;

  p2pReceivedList.prepend(card);
  p2pReceivedCount.textContent = `${p2pReceivedList.querySelectorAll('div').length} file(s)`;
}

// 10. Interaction & Drag & Drop Event Listeners
function setupEventListeners() {
  // Copy Link Button
  copyLinkBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(shareLinkInput.value).then(() => {
      copyLinkBtn.textContent = 'Copied!';
      copyLinkBtn.classList.add('bg-emerald-600');
      setTimeout(() => {
        copyLinkBtn.textContent = 'Copy';
        copyLinkBtn.classList.remove('bg-emerald-600');
      }, 2000);
    });
  });

  // P2P File Input
  p2pFileInput.addEventListener('change', () => {
    const targetPeer = p2pFileInput.dataset.targetPeer || null;
    Array.from(p2pFileInput.files).forEach(file => {
      sendFileViaP2P(file, targetPeer);
    });
    p2pFileInput.value = '';
    delete p2pFileInput.dataset.targetPeer;
  });

  // Vault File Input
  vaultFileInput.addEventListener('change', () => {
    Array.from(vaultFileInput.files).forEach(file => {
      uploadToVault(file);
    });
    vaultFileInput.value = '';
  });

  // Text Beam Trigger
  sendTextBeamBtn.addEventListener('click', sendTextBeam);
  textBeamInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      sendTextBeam();
    }
  });

  clearTextHistoryBtn.addEventListener('click', () => {
    textBeamFeed.innerHTML = '';
    textBeamFeed.appendChild(textBeamEmpty);
    textBeamEmpty.classList.remove('hidden');
  });

  // QR Modal Triggers
  const showQrModal = () => {
    generateQrCode();
    qrModal.classList.remove('hidden');
  };

  openQrModalBtn.addEventListener('click', showQrModal);
  if (radarQrBtn) radarQrBtn.addEventListener('click', showQrModal);

  closeQrModalBtn.addEventListener('click', () => {
    qrModal.classList.add('hidden');
  });

  newRoomTrigger.addEventListener('click', () => {
    const newId = Math.random().toString(36).substring(2, 8).toLowerCase();
    window.location.href = `/room/${newId}`;
  });

  // Drag & Drop for P2P Dropzone
  ['dragenter', 'dragover'].forEach(name => {
    p2pDropZone.addEventListener(name, (e) => {
      e.preventDefault();
      p2pDropZone.classList.add('drop-active');
    });
    vaultDropZone.addEventListener(name, (e) => {
      e.preventDefault();
      vaultDropZone.classList.add('border-emerald-500', 'bg-emerald-500/10');
    });
  });

  ['dragleave', 'drop'].forEach(name => {
    p2pDropZone.addEventListener(name, (e) => {
      e.preventDefault();
      p2pDropZone.classList.remove('drop-active');
    });
    vaultDropZone.addEventListener(name, (e) => {
      e.preventDefault();
      vaultDropZone.classList.remove('border-emerald-500', 'bg-emerald-500/10');
    });
  });

  p2pDropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    Array.from(files).forEach(file => sendFileViaP2P(file));
  });

  vaultDropZone.addEventListener('drop', (e) => {
    const files = e.dataTransfer.files;
    Array.from(files).forEach(file => uploadToVault(file));
  });
}

// Tab Switcher Handler
function setupTabNavigation() {
  const tabs = [
    { btn: tabP2p, section: sectionP2p },
    { btn: tabVault, section: sectionVault },
    { btn: tabText, section: sectionText }
  ];

  tabs.forEach(({ btn, section }) => {
    btn.addEventListener('click', () => {
      tabs.forEach(t => {
        t.btn.classList.remove('active');
        t.btn.classList.add('text-slate-400');
        t.section.classList.add('hidden');
        t.section.classList.remove('section-enter');
      });

      btn.classList.add('active');
      btn.classList.remove('text-slate-400');
      section.classList.remove('hidden');
      // Trigger reflow then add animation class
      void section.offsetWidth;
      section.classList.add('section-enter');
    });
  });
}

// QR Code Generator
function generateQrCode() {
  qrcodeModalContainer.innerHTML = '';
  const fullUrl = `${window.location.origin}/room/${roomId}`;
  
  new QRCode(qrcodeModalContainer, {
    text: fullUrl,
    width: 200,
    height: 200,
    colorDark: "#0b0f19",
    colorLight: "#ffffff",
    correctLevel: QRCode.CorrectLevel.H
  });
}

// Toast Notifications Helper
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  const toast = document.createElement('div');
  
  const colors = {
    info: 'bg-slate-900 border-slate-800 text-slate-100',
    success: 'bg-slate-900 border-slate-800 text-emerald-300',
    warning: 'bg-slate-900 border-slate-800 text-amber-300',
    error: 'bg-slate-900 border-slate-800 text-rose-300'
  };

  const toastTypeClass = `toast-${type}`;
  toast.className = `toast glass-panel p-3.5 rounded-2xl border text-xs font-semibold shadow-2xl flex items-center gap-2 max-w-sm ${colors[type] || colors.info} ${toastTypeClass}`;
  toast.innerHTML = `<span>${message}</span>`;

  container.appendChild(toast);
  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    setTimeout(() => toast.remove(), 300);
  }, 4000);
}

// Format Utilities
function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSec) {
  if (bytesPerSec === 0) return '0 KB/s';
  const k = 1024;
  const speed = bytesPerSec / k;
  if (speed > 1024) {
    return (speed / 1024).toFixed(1) + ' MB/s';
  }
  return speed.toFixed(0) + ' KB/s';
}

function generateUUID() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0, v = c == 'x' ? r : (r & 0x3 | 0x8);
    return v.toString(16);
  });
}

function escapeHtml(str) {
  return str.replace(/[&<>"']/g, function(m) {
    return {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#039;'
    }[m];
  });
}
