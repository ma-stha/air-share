// State variables
let roomId = '';
let socket = null;
let qrCodeInstance = null;

// DOM Elements
const statusDot = document.getElementById('connection-status-dot');
const statusText = document.getElementById('connection-status-text');
const qrCodeDiv = document.getElementById('qrcode');
const shareLinkInput = document.getElementById('share-link-input');
const copyLinkBtn = document.getElementById('copy-link-btn');
const displayRoomId = document.getElementById('display-room-id');
const newRoomBtn = document.getElementById('new-room-btn');
const fileInput = document.getElementById('file-input');
const dropZone = document.getElementById('drop-zone');
const progressContainer = document.getElementById('progress-container');
const progressFilename = document.getElementById('progress-filename');
const progressPercent = document.getElementById('progress-percent');
const progressBar = document.getElementById('progress-bar');
const progressSpeed = document.getElementById('progress-speed');
const progressBytes = document.getElementById('progress-bytes');
const filesList = document.getElementById('files-list');
const emptyState = document.getElementById('empty-state');
const fileCountSpan = document.getElementById('file-count');

// Initialize the app on page load
window.addEventListener('DOMContentLoaded', () => {
  setupRoomId();
  initializeSocket();
  setupEventListeners();
  loadExistingFiles();
  generateQrCode();
});

// 1. Setup Room ID from URL or generate a new one
function setupRoomId() {
  const pathParts = window.location.pathname.split('/');
  // Expected path format: /room/<roomId>
  if (pathParts.length >= 3 && pathParts[1] === 'room' && pathParts[2]) {
    roomId = pathParts[2];
  } else {
    // Generate a random 6-character room ID
    roomId = Math.random().toString(36).substring(2, 8).toLowerCase();
    // Update the browser URL without reloading
    window.history.replaceState({}, '', `/room/${roomId}`);
  }
  
  displayRoomId.textContent = roomId;
  
  const fullUrl = window.location.origin + `/room/${roomId}`;
  shareLinkInput.value = fullUrl;
}

// 2. Initialize Socket.IO connection
function initializeSocket() {
  socket = io();

  socket.on('connect', () => {
    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-emerald-500';
    statusText.textContent = 'Connected';
    socket.emit('join-room', roomId);
  });

  socket.on('disconnect', () => {
    statusDot.className = 'w-2.5 h-2.5 rounded-full bg-rose-500 animate-pulse';
    statusText.textContent = 'Disconnected';
  });

  // Listen for real-time file uploads in this room
  socket.on('file-shared', (fileData) => {
    addFileToUI(fileData);
  });
}

// 3. Generate QR Code containing the room URL
function generateQrCode() {
  const fullUrl = window.location.origin + `/room/${roomId}`;
  
  // Clear container
  qrCodeDiv.innerHTML = '';
  
  // Initialize QRCode
  qrCodeInstance = new QRCode(qrCodeDiv, {
    text: fullUrl,
    width: 180,
    height: 180,
    colorDark : "#0f172a", // slate-900
    colorLight : "#ffffff",
    correctLevel : QRCode.CorrectLevel.M
  });
}

// 4. Setup interaction listeners
function setupEventListeners() {
  // Copy Link Button
  copyLinkBtn.addEventListener('click', () => {
    navigator.clipboard.writeText(shareLinkInput.value).then(() => {
      copyLinkBtn.textContent = 'Copied!';
      copyLinkBtn.classList.add('bg-emerald-600', 'text-white');
      setTimeout(() => {
        copyLinkBtn.textContent = 'Copy';
        copyLinkBtn.classList.remove('bg-emerald-600', 'text-white');
      }, 2000);
    });
  });

  // Create New Room
  newRoomBtn.addEventListener('click', () => {
    // Generate a fresh ID and reload to that path
    const newId = Math.random().toString(36).substring(2, 8).toLowerCase();
    window.location.href = `/room/${newId}`;
  });

  // Drag and drop events
  ['dragenter', 'dragover'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.add('border-brand-500', 'bg-slate-800/40');
    }, false);
  });

  ['dragleave', 'drop'].forEach(eventName => {
    dropZone.addEventListener(eventName, (e) => {
      e.preventDefault();
      dropZone.classList.remove('border-brand-500', 'bg-slate-800/40');
    }, false);
  });

  dropZone.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    const files = dt.files;
    if (files.length > 0) {
      uploadFile(files[0]);
    }
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files.length > 0) {
      uploadFile(fileInput.files[0]);
    }
  });
}

// 5. Upload File utilizing XMLHttpRequest for upload progress tracking
function uploadFile(file) {
  if (file.size > 500 * 1024 * 1024) {
    alert("File size exceeds the 500MB limit.");
    return;
  }

  const formData = new FormData();
  formData.append('file', file);
  formData.append('roomId', roomId);

  const xhr = new XMLHttpRequest();
  
  // Show progress container
  progressContainer.classList.remove('hidden');
  progressFilename.textContent = file.name;
  progressBar.style.width = '0%';
  progressPercent.textContent = '0%';
  progressSpeed.textContent = 'Calculating speed...';
  
  let startTime = Date.now();

  // Track progress events
  xhr.upload.addEventListener('progress', (e) => {
    if (e.lengthComputable) {
      const percentComplete = Math.round((e.loaded / e.total) * 100);
      progressBar.style.width = percentComplete + '%';
      progressPercent.textContent = percentComplete + '%';
      
      // Calculate speed
      const duration = (Date.now() - startTime) / 1000; // in seconds
      if (duration > 0) {
        const speedBytesPerSec = e.loaded / duration;
        progressSpeed.textContent = formatSpeed(speedBytesPerSec);
      }
      
      progressBytes.textContent = `${formatBytes(e.loaded)} / ${formatBytes(e.total)}`;
    }
  });

  // Handle upload completion
  xhr.addEventListener('load', () => {
    if (xhr.status === 200) {
      console.log('Upload complete');
      setTimeout(() => {
        progressContainer.classList.add('hidden');
      }, 1500);
    } else {
      alert('Upload failed: ' + xhr.responseText);
      progressContainer.classList.add('hidden');
    }
    fileInput.value = ''; // Reset file input
  });

  xhr.addEventListener('error', () => {
    alert('Upload error occurred.');
    progressContainer.classList.add('hidden');
    fileInput.value = '';
  });

  xhr.open('POST', '/api/upload');
  xhr.send(formData);
}

// 6. Fetch existing files in the room on load
async function loadExistingFiles() {
  try {
    const res = await fetch(`/api/room/${roomId}/files`);
    const files = await res.json();
    
    // Clear list (except empty state)
    const existingFileCards = filesList.querySelectorAll('.file-card');
    existingFileCards.forEach(card => card.remove());
    
    if (files.length > 0) {
      emptyState.classList.add('hidden');
      files.forEach(file => addFileToUI(file, false));
    } else {
      emptyState.classList.remove('hidden');
      fileCountSpan.textContent = '0';
    }
  } catch (err) {
    console.error('Failed to load files:', err);
  }
}

// 7. Add file details to shared files list in DOM
function addFileToUI(fileData, incrementCounter = true) {
  // Hide empty state if showing
  emptyState.classList.add('hidden');

  // Check if file is already listed (avoid duplicate appends)
  if (document.getElementById(`file-${fileData.id}`)) return;

  const fileCard = document.createElement('div');
  fileCard.id = `file-${fileData.id}`;
  fileCard.className = 'file-card flex items-center justify-between p-4 bg-slate-800/80 rounded-2xl border border-slate-700/30 shadow-sm transition-all hover:border-slate-700/60';
  
  const uploadTime = new Date(fileData.uploadedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  fileCard.innerHTML = `
    <div class="flex items-center gap-3 min-w-0 flex-1 pr-3">
      <!-- File Icon -->
      <div class="bg-slate-900 p-2.5 rounded-xl border border-slate-800 shrink-0 text-brand-500">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m2.25 0H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
        </svg>
      </div>
      <div class="min-w-0">
        <p class="text-sm font-bold text-slate-100 truncate hover:text-brand-400 transition-colors" title="${fileData.name}">${fileData.name}</p>
        <div class="flex items-center gap-2 mt-0.5 text-[11px] text-slate-400 font-medium">
          <span>${formatBytes(fileData.size)}</span>
          <span class="text-slate-600">•</span>
          <span>Shared at ${uploadTime}</span>
        </div>
      </div>
    </div>
    <a href="/api/download/${fileData.filename}" download="${fileData.name}"
       class="bg-brand-500 hover:bg-brand-600 active:scale-95 text-white p-2.5 rounded-xl border border-brand-600 shrink-0 shadow-md shadow-brand-500/10 transition-all flex items-center justify-center">
      <svg class="w-4 h-4" fill="none" stroke="currentColor" stroke-width="2.5" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5M16.5 12L12 16.5m0 0L7.5 12m4.5 4.5V3" />
      </svg>
    </a>
  `;

  filesList.prepend(fileCard);
  
  if (incrementCounter) {
    const currentCount = parseInt(fileCountSpan.textContent) || 0;
    fileCountSpan.textContent = currentCount + 1;
  } else {
    // Set absolute number
    const totalCards = filesList.querySelectorAll('.file-card').length;
    fileCountSpan.textContent = totalCards;
  }
}

// Helper: Format Bytes to human readable string
function formatBytes(bytes, decimals = 1) {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(dm)) + ' ' + sizes[i];
}

// Helper: Format Transfer Speed
function formatSpeed(bytesPerSec) {
  if (bytesPerSec === 0) return '0 KB/s';
  const k = 1024;
  const speed = bytesPerSec / k; // in KB/s
  if (speed > 1024) {
    return (speed / 1024).toFixed(1) + ' MB/s';
  }
  return speed.toFixed(0) + ' KB/s';
}
