// Global Variables
let peer;
let connections = [];
let localStream;
let roomId;
let username;
let isMuted = false;
let isVideoOff = false;
let myPeerId = null;

// DOM Elements
const authModal = document.getElementById('authModal');
const app = document.getElementById('app');
const chatMessages = document.getElementById('chatMessages');
const mobileChatMessages = document.getElementById('mobileChatMessages');
const videoGrid = document.getElementById('videoGrid');
const localVideo = document.getElementById('localVideo');
const userCount = document.getElementById('userCount');

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
        document.getElementById('roomIdInput').value = roomParam;
    }
});

// Create Room
async function createRoom() {
    const name = document.getElementById('usernameInput').value.trim();
    if (!name) {
        alert('Please enter your name');
        return;
    }

    username = name;
    roomId = generateRoomId();
    await initializeRoom();
}

// Join Room
async function joinRoom() {
    const name = document.getElementById('usernameInput').value.trim();
    const room = document.getElementById('roomIdInput').value.trim();

    if (!name) {
        alert('Please enter your name');
        return;
    }
    if (!room) {
        alert('Please enter a room ID');
        return;
    }

    username = name;
    roomId = room.toUpperCase();
    await initializeRoom();
}

// Generate Random Room ID
function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Initialize Room
async function initializeRoom() {
    try {
        console.log('Requesting media...');
        localStream = await navigator.mediaDevices.getUserMedia({
            video: { width: { ideal: 1280 }, height: { ideal: 720 } },
            audio: true
        });

        localVideo.srcObject = localStream;

        // Generate unique peer ID
        myPeerId = `${roomId}-${username}-${Date.now()}`;

        // Initialize PeerJS
        peer = new Peer(myPeerId, {
            host: '0.peerjs.com',
            port: 443,
            path: '/',
            secure: true,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' }
                ]
            }
        });

        peer.on('open', () => {
            console.log('Peer connected:', myPeerId);
            setupPeerListeners();
            enterRoom();
            setTimeout(() => discoverPeers(), 500);
        });

        peer.on('error', (err) => {
            console.error('Peer error:', err.type, err.message);
            showNotification('Connection error: ' + err.type);
        });

        peer.on('disconnected', () => {
            console.log('Disconnected, reconnecting...');
            peer.reconnect();
        });

    } catch (err) {
        console.error('Media error:', err);
        if (err.name === 'NotAllowedError') {
            alert('Camera/microphone access denied. Please allow permissions.');
        } else if (err.name === 'NotFoundError') {
            alert('No camera or microphone found.');
        } else {
            alert('Error: ' + err.message);
        }
    }
}

// Setup Peer Listeners
function setupPeerListeners() {
    peer.on('connection', (conn) => {
        console.log('Incoming connection:', conn.peer);
        setupConnection(conn);
    });

    peer.on('call', (call) => {
        console.log('Incoming call:', call.peer);
        call.answer(localStream);
        call.on('stream', (remoteStream) => {
            addRemoteVideo(call.peer, remoteStream);
        });
        call.on('close', () => removeRemoteVideo(call.peer));
        call.on('error', (err) => console.error('Call error:', err));
    });
}

// Connect to Peer
function connectToPeer(peerId) {
    if (peerId === myPeerId) return;
    if (connections.some(c => c.peer === peerId)) return;

    console.log('Connecting to:', peerId);

    // Data connection for chat
    const conn = peer.connect(peerId, {
        reliable: true,
        metadata: { username: username }
    });
    setupConnection(conn);

    // Media call
    const call = peer.call(peerId, localStream);
    call.on('stream', (remoteStream) => addRemoteVideo(peerId, remoteStream));
    call.on('close', () => removeRemoteVideo(peerId));
}

// Setup Data Connection
function setupConnection(conn) {
    if (connections.some(c => c.peer === conn.peer)) return;

    connections.push(conn);
    updateUserCount();

    conn.on('open', () => {
        console.log('Connection opened:', conn.peer);
        showNotification('Someone joined!');

        const currentUrl = document.getElementById('streamUrl').value;
        if (currentUrl) {
            conn.send({ type: 'stream', url: currentUrl });
        }
    });

    conn.on('data', (data) => {
        switch(data.type) {
            case 'chat':
                if (data.username !== username) {
                    displayMessage(data.username, data.message, false);
                }
                break;
            case 'stream':
                if (data.url !== document.getElementById('streamUrl').value) {
                    document.getElementById('streamUrl').value = data.url;
                    loadStream();
                    showNotification(`${data.username} changed stream`);
                }
                break;
        }
    });

    conn.on('close', () => {
        connections = connections.filter(c => c !== conn);
        removeRemoteVideo(conn.peer);
        updateUserCount();
    });

    conn.on('error', (err) => console.error('Connection error:', err));
}

// Discover Peers
function discoverPeers() {
    const stored = JSON.parse(localStorage.getItem(`peers-${roomId}`) || '[]');
    stored.forEach(peerId => {
        if (peerId !== myPeerId) {
            connectToPeer(peerId);
        }
    });

    const currentPeers = JSON.parse(localStorage.getItem(`peers-${roomId}`) || '[]');
    if (!currentPeers.includes(myPeerId)) {
        currentPeers.push(myPeerId);
        localStorage.setItem(`peers-${roomId}`, JSON.stringify(currentPeers));
    }
}

// Enter Room UI
function enterRoom() {
    authModal.classList.add('hidden');
    app.classList.remove('hidden');

    document.getElementById('displayRoomId').textContent = roomId;
    window.history.replaceState({}, '', `?room=${roomId}`);

    displayMessage('System', `Welcome! Share code: ${roomId}`, false);

    // Re-discover peers every 3 seconds
    setInterval(() => discoverPeers(), 3000);
}

// Load Stream
function loadStream() {
    const url = document.getElementById('streamUrl').value.trim();
    if (!url) {
        alert('Enter a stream URL');
        return;
    }

    const container = document.getElementById('streamContainer');
    let embedUrl = url;

    try {
        if (url.includes('youtube.com/watch')) {
            const videoId = new URL(url).searchParams.get('v');
            if (videoId) {
                embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1`;
            }
        } else if (url.includes('youtu.be/')) {
            const videoId = url.split('youtu.be/')[1]?.split('?')[0];
            if (videoId) {
                embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1`;
            }
        } else if (url.includes('twitch.tv')) {
            const channel = url.split('twitch.tv/')[1]?.split('/')[0];
            if (channel) {
                embedUrl = `https://player.twitch.tv/?channel=${channel}&parent=${window.location.hostname}`;
            }
        }

        container.innerHTML = `<iframe src="${embedUrl}" allow="autoplay" style="width:100%; height:100%; border:none;"></iframe>`;
        broadcastData({ type: 'stream', url: url, username: username });
        showNotification('Stream loaded!');
    } catch (err) {
        console.error('Load error:', err);
        alert('Invalid URL');
    }
}

// Sync Stream
function syncStream() {
    const url = document.getElementById('streamUrl').value;
    if (url) {
        broadcastData({ type: 'stream', url: url, username: username });
        showNotification('Synced!');
    } else {
        alert('No stream to sync');
    }
}

// Send Message
function sendMessage(e) {
    e.preventDefault();
    const isMobile = window.innerWidth < 768;
    const input = isMobile ? document.getElementById('mobileMessageInput') : document.getElementById('messageInput');
    const message = input.value.trim();

    if (!message) return;

    input.value = '';
    displayMessage(username, message, true);
    broadcastData({ type: 'chat', username, message });
}

// Display Message
function displayMessage(user, message, isLocal) {
    const div = document.createElement('div');
    div.className = `chat-message flex gap-2 ${isLocal ? 'justify-end' : ''}`;

    const color = isLocal ? 'bg-indigo-600' : (user === 'System' ? 'bg-green-600' : 'bg-slate-700');

    div.innerHTML = `
        <div class="w-6 h-6 ${color} rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
            ${user.charAt(0).toUpperCase()}
        </div>
        <div class="${isLocal ? 'text-right' : ''} flex-1">
            <p class="text-xs text-gray-500">${user}</p>
            <p class="text-sm text-gray-200 bg-slate-800 p-2 rounded max-w-xs break-words">
                ${escapeHtml(message)}
            </p>
        </div>
    `;

    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;

    const mobileDiv = div.cloneNode(true);
    mobileChatMessages.appendChild(mobileDiv);
    mobileChatMessages.scrollTop = mobileChatMessages.scrollHeight;
}

// Broadcast Data
function broadcastData(data) {
    connections.forEach(conn => {
        if (conn.open) {
            try {
                conn.send(data);
            } catch (err) {
                console.error('Send error:', err);
            }
        }
    });
}

// Toggle Mic
function toggleMic() {
    if (!localStream) return;

    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        isMuted = !audioTrack.enabled;

        const btn = document.getElementById('micBtn');
        if (isMuted) {
            btn.classList.add('bg-red-600');
            btn.classList.remove('bg-slate-700');
            btn.textContent = '🔇';
        } else {
            btn.classList.remove('bg-red-600');
            btn.classList.add('bg-slate-700');
            btn.textContent = '🎤';
        }
    }
}

// Toggle Camera
function toggleCam() {
    if (!localStream) return;

    const videoTrack = localStream.getVideoTracks()[0];
    if (videoTrack) {
        videoTrack.enabled = !videoTrack.enabled;
        isVideoOff = !videoTrack.enabled;

        const btn = document.getElementById('camBtn');
        if (isVideoOff) {
            btn.classList.add('bg-red-600');
            btn.classList.remove('bg-slate-700');
            btn.textContent = '📹❌';
            localVideo.style.opacity = '0.3';
        } else {
            btn.classList.remove('bg-red-600');
            btn.classList.add('bg-slate-700');
            btn.textContent = '📹';
            localVideo.style.opacity = '1';
        }
    }
}

// Add Remote Video
function addRemoteVideo(peerId, stream) {
    removeRemoteVideo(peerId);

    const div = document.createElement('div');
    div.id = `video-${peerId}`;
    div.className = 'relative bg-slate-800 rounded-lg overflow-hidden aspect-video shadow-lg';

    const video = document.createElement('video');
    video.className = 'w-full h-full object-cover';
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;

    const label = document.createElement('div');
    label.className = 'absolute bottom-2 left-2 px-2 py-1 bg-black/70 rounded text-xs text-white font-medium';
    label.textContent = 'Friend';

    div.appendChild(video);
    div.appendChild(label);
    videoGrid.appendChild(div);

    updateUserCount();
    showNotification('New participant!');
}

// Remove Remote Video
function removeRemoteVideo(peerId) {
    const element = document.getElementById(`video-${peerId}`);
    if (element) {
        element.remove();
        showNotification('Someone left');
    }
    updateUserCount();
}

// Update User Count
function updateUserCount() {
    const remoteCount = document.querySelectorAll('#videoGrid > div:not(:first-child)').length;
    const count = 1 + remoteCount;
    userCount.textContent = count;
}

// Copy Room ID
function copyRoomId() {
    navigator.clipboard.writeText(roomId).then(() => {
        showNotification('Room ID copied!');
    }).catch(() => {
        const textArea = document.createElement('textarea');
        textArea.value = roomId;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showNotification('Copied!');
    });
}

// Show Notification
function showNotification(text) {
    const div = document.createElement('div');
    div.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 bg-indigo-600 text-white px-6 py-3 rounded-lg shadow-2xl z-50 font-medium';
    div.textContent = text;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.opacity = '0';
        div.style.transition = 'opacity 0.5s';
        setTimeout(() => div.remove(), 500);
    }, 2000);
}

// Toggle Mobile Chat
function toggleMobileChat() {
    const chat = document.getElementById('mobileChat');
    chat.classList.toggle('hidden');
    if (!chat.classList.contains('hidden')) {
        mobileChatMessages.scrollTop = mobileChatMessages.scrollHeight;
    }
}

// Leave Room
function leaveRoom() {
    if (confirm('Leave room?')) {
        if (localStream) {
            localStream.getTracks().forEach(track => track.stop());
        }
        connections.forEach(conn => {
            if (conn.open) conn.close();
        });
        if (peer) {
            peer.destroy();
        }
        window.location.href = window.location.pathname;
    }
}

// Toggle Fullscreen
function toggleFullscreen() {
    const container = document.getElementById('streamContainer');
    if (!document.fullscreenElement) {
        container.requestFullscreen().catch(err => console.error('Fullscreen error:', err));
    } else {
        document.exitFullscreen();
    }
}

// Escape HTML
function escapeHtml(text) {
    if (!text) return '';
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
}

// Cleanup on page close
window.addEventListener('beforeunload', () => {
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    connections.forEach(conn => {
        if (conn.open) conn.close();
    });
    if (peer) {
        peer.destroy();
    }
});

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
        const mobileChat = document.getElementById('mobileChat');
        if (!mobileChat.classList.contains('hidden')) {
            toggleMobileChat();
        }
    }
});
