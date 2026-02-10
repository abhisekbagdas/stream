// Global Variables
let peer;
let connections = [];
let localStream;
let roomId;
let username;
let isMuted = false;
let isVideoOff = false;
let unreadCount = 0;
let isHost = false;
let myPeerId = null;

// DOM Elements
const authModal = document.getElementById('authModal');
const app = document.getElementById('app');
const chatMessages = document.getElementById('chatMessages');
const mobileChatMessages = document.getElementById('mobileChatMessages');
const videoGrid = document.getElementById('videoGrid');
const localVideo = document.getElementById('localVideo');
const typingIndicator = document.getElementById('typingIndicator');
const userCount = document.getElementById('userCount');

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    // Check for room ID in URL
    const urlParams = new URLSearchParams(window.location.search);
    const roomParam = urlParams.get('room');
    if (roomParam) {
        document.getElementById('roomIdInput').value = roomParam;
    }
    
    // Listen for storage events (cross-tab communication)
    window.addEventListener('storage', handleStorageEvent);
    
    // Initialize Lucide icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
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
    isHost = true;
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
    isHost = false;
    await initializeRoom();
}

// Generate Random Room ID
function generateRoomId() {
    return Math.random().toString(36).substring(2, 8).toUpperCase();
}

// Initialize Room
async function initializeRoom() {
    try {
        // Get user media first
        console.log('Requesting media permissions...');
        localStream = await navigator.mediaDevices.getUserMedia({ 
            video: true, 
            audio: true 
        });
        
        // Display local video
        localVideo.srcObject = localStream;
        localVideo.muted = true; // Mute local video to prevent feedback
        
        // Create deterministic peer ID based on room and username
        // Use timestamp only for uniqueness if same user joins twice
        myPeerId = `${roomId}-${username}-${Math.random().toString(36).substr(2, 5)}`;
        
        // Initialize PeerJS with public cloud server
        peer = new Peer(myPeerId, {
            host: '0.peerjs.com',
            port: 443,
            path: '/',
            secure: true,
            config: {
                iceServers: [
                    { urls: 'stun:stun.l.google.com:19302' },
                    { urls: 'stun:stun1.l.google.com:19302' },
                    { urls: 'stun:stun2.l.google.com:19302' }
                ]
            }
        });
        
        peer.on('open', (id) => {
            console.log('PeerJS connected with ID:', id);
            myPeerId = id;
            setupPeerListeners();
            enterRoom();
            
            // Signal presence to other tabs/devices
            signalPresence();
            
            // If joining existing room, try to connect to host
            if (!isHost) {
                setTimeout(() => discoverPeers(), 1000);
            }
        });
        
        peer.on('error', (err) => {
            console.error('Peer error:', err);
            if (err.type === 'unavailable-id') {
                // ID taken, retry with new random suffix
                myPeerId = `${roomId}-${username}-${Date.now()}`;
                initializeRoom();
            } else if (err.type === 'network') {
                alert('Network error. Please check your connection and try again.');
            } else {
                alert('Connection error: ' + err.message);
            }
        });
        
        peer.on('disconnected', () => {
            console.log('PeerJS disconnected, attempting reconnect...');
            peer.reconnect();
        });
        
    } catch (err) {
        console.error('Failed to get media:', err);
        if (err.name === 'NotAllowedError') {
            alert('Camera and microphone access denied. Please allow permissions in your browser and refresh.');
        } else if (err.name === 'NotFoundError') {
            alert('No camera or microphone found. Please connect a device and try again.');
        } else {
            alert('Could not access camera/microphone: ' + err.message);
        }
    }
}

// Signal presence via localStorage (works across tabs in same browser)
function signalPresence() {
    const signal = {
        type: 'peer-joined',
        roomId: roomId,
        peerId: myPeerId,
        username: username,
        timestamp: Date.now()
    };
    localStorage.setItem('streamsync-signal', JSON.stringify(signal));
    // Clear after short delay to allow others to see it
    setTimeout(() => localStorage.removeItem('streamsync-signal'), 1000);
}

// Handle storage events (for cross-tab communication)
function handleStorageEvent(e) {
    if (e.key === 'streamsync-signal' && e.newValue) {
        const data = JSON.parse(e.newValue);
        if (data.roomId === roomId && data.peerId !== myPeerId) {
            console.log('Detected peer via storage:', data.peerId);
            connectToPeer(data.peerId);
        }
    } else if (e.key === 'streamsync-message' && e.newValue) {
        const data = JSON.parse(e.newValue);
        if (data.roomId === roomId && data.peerId !== myPeerId) {
            handleIncomingData(data.payload, data.peerId);
        }
    }
}

// Setup Peer Listeners
function setupPeerListeners() {
    // Handle incoming data connections (chat)
    peer.on('connection', (conn) => {
        console.log('Incoming connection from:', conn.peer);
        setupConnection(conn);
    });
    
    // Handle incoming calls (video/audio)
    peer.on('call', (call) => {
        console.log('Incoming call from:', call.peer);
        call.answer(localStream);
        call.on('stream', (remoteStream) => {
            addRemoteVideo(call.peer, remoteStream);
        });
        call.on('close', () => {
            removeRemoteVideo(call.peer);
        });
        call.on('error', (err) => {
            console.error('Call error:', err);
        });
    });
}

// Connect to a specific peer
function connectToPeer(peerId) {
    if (peerId === myPeerId) return;
    if (connections.some(c => c.peer === peerId)) return; // Already connected
    
    console.log('Connecting to peer:', peerId);
    
    // Create data connection for chat
    const conn = peer.connect(peerId, {
        reliable: true,
        metadata: { username: username }
    });
    setupConnection(conn);
    
    // Create media call
    const call = peer.call(peerId, localStream);
    call.on('stream', (remoteStream) => {
        addRemoteVideo(peerId, remoteStream);
    });
    call.on('close', () => {
        removeRemoteVideo(peerId);
    });
}

// Setup Data Connection
function setupConnection(conn) {
    if (connections.some(c => c.peer === conn.peer)) {
        console.log('Already connected to:', conn.peer);
        return;
    }
    
    connections.push(conn);
    updateUserCount();
    
    conn.on('open', () => {
        console.log('Connection opened with:', conn.peer);
        showNotification('Someone joined the room!');
        
        // Send current stream URL if any
        const currentUrl = document.getElementById('streamUrl').value;
        if (currentUrl) {
            setTimeout(() => {
                conn.send({ type: 'stream', url: currentUrl });
            }, 500);
        }
        
        // Send greeting
        conn.send({ type: 'chat', username: 'System', message: `${username} joined the room` });
    });
    
    conn.on('data', (data) => {
        handleIncomingData(data, conn.peer);
    });
    
    conn.on('close', () => {
        console.log('Connection closed:', conn.peer);
        connections = connections.filter(c => c !== conn);
        removeRemoteVideo(conn.peer);
        updateUserCount();
    });
    
    conn.on('error', (err) => {
        console.error('Connection error:', err);
    });
}

// Handle Incoming Data
function handleIncomingData(data, peerId) {
    console.log('Received data:', data);
    switch(data.type) {
        case 'chat':
            if (data.username !== username) {
                displayMessage(data.username, data.message, false);
            }
            break;
        case 'stream':
            if (data.url && data.url !== document.getElementById('streamUrl').value) {
                document.getElementById('streamUrl').value = data.url;
                loadStream();
                showNotification(`${data.username || 'Someone'} changed the stream`);
            }
            break;
        case 'typing':
            showTypingIndicator(data.username);
            break;
        case 'sync':
            showNotification('Sync requested by ' + data.username);
            break;
    }
}

// Discover Peers in Room
function discoverPeers() {
    // Try to connect to likely host IDs
    const possiblePeers = [
        `${roomId}-Host`,
        `${roomId}-host`,
        `${roomId}-Admin`
    ];
    
    // Also check localStorage for recent peers
    const recentPeers = JSON.parse(localStorage.getItem('streamsync-peers-' + roomId) || '[]');
    recentPeers.forEach(peerId => {
        if (peerId !== myPeerId) {
            connectToPeer(peerId);
        }
    });
    
    // Try common patterns
    possiblePeers.forEach(peerId => {
        connectToPeer(peerId);
    });
    
    // Broadcast our presence
    signalPresence();
    
    // Store our peer ID for others to find
    const currentPeers = JSON.parse(localStorage.getItem('streamsync-peers-' + roomId) || '[]');
    if (!currentPeers.includes(myPeerId)) {
        currentPeers.push(myPeerId);
        localStorage.setItem('streamsync-peers-' + roomId, JSON.stringify(currentPeers));
    }
}

// Enter Room UI
function enterRoom() {
    authModal.classList.add('hidden');
    app.classList.remove('hidden');
    
    document.getElementById('displayRoomId').textContent = roomId;
    document.getElementById('userAvatar').textContent = username.charAt(0).toUpperCase();
    
    // Update URL
    window.history.replaceState({}, '', `?room=${roomId}`);
    
    // Start discovering peers
    setInterval(() => discoverPeers(), 5000); // Retry every 5 seconds
    
    // Update icons
    if (typeof lucide !== 'undefined') {
        lucide.createIcons();
    }
    
    // Add welcome message
    displayMessage('System', `Welcome to room ${roomId}! Share the room ID with friends to watch together.`, false);
}

// Load Stream
function loadStream() {
    const url = document.getElementById('streamUrl').value.trim();
    if (!url) {
        alert('Please enter a stream URL');
        return;
    }
    
    const container = document.getElementById('streamContainer');
    
    // Handle different URL types
    let embedUrl = url;
    
    try {
        // Convert YouTube watch URLs to embed
        if (url.includes('youtube.com/watch')) {
            const videoId = new URL(url).searchParams.get('v');
            if (videoId) {
                embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1`;
            }
        } else if (url.includes('youtu.be/')) {
            const videoId = url.split('youtu.be/')[1].split('?')[0];
            if (videoId) {
                embedUrl = `https://www.youtube.com/embed/${videoId}?autoplay=1&enablejsapi=1`;
            }
        } else if (url.includes('twitch.tv')) {
            const channel = url.split('twitch.tv/')[1].split('/')[0];
            if (channel) {
                embedUrl = `https://player.twitch.tv/?channel=${channel}&parent=${window.location.hostname}&autoplay=true`;
            }
        } else if (url.includes('vimeo.com')) {
            const videoId = url.split('vimeo.com/')[1].split('/')[0];
            if (videoId) {
                embedUrl = `https://player.vimeo.com/video/${videoId}?autoplay=1`;
            }
        }
        
        container.innerHTML = `<iframe src="${embedUrl}" allowfullscreen allow="autoplay; encrypted-media; picture-in-picture; fullscreen" frameborder="0"></iframe>`;
        
        // Broadcast to peers
        broadcastData({ type: 'stream', url: url, username: username });
        
        showNotification('Stream loaded!');
    } catch (err) {
        console.error('Error loading stream:', err);
        alert('Invalid URL format');
    }
}

// Sync Stream
function syncStream() {
    const url = document.getElementById('streamUrl').value;
    if (url) {
        broadcastData({ type: 'sync', username: username });
        broadcastData({ type: 'stream', url: url, username: username });
        showNotification('Sync sent to all peers!');
    } else {
        alert('No stream URL to sync');
    }
}

// Send Chat Message
function sendMessage(e) {
    e.preventDefault();
    const isMobile = window.innerWidth < 768;
    const input = isMobile ? 
        document.getElementById('mobileMessageInput') : 
        document.getElementById('messageInput');
    
    const message = input.value.trim();
    if (!message) return;
    
    input.value = '';
    
    // Display locally immediately
    displayMessage(username, message, true);
    
    // Broadcast to peers via WebRTC
    broadcastData({ type: 'chat', username, message });
    
    // Also broadcast via localStorage for cross-tab
    const signal = {
        roomId: roomId,
        peerId: myPeerId,
        payload: { type: 'chat', username, message }
    };
    localStorage.setItem('streamsync-message', JSON.stringify(signal));
    setTimeout(() => localStorage.removeItem('streamsync-message'), 100);
    
    // Hide typing indicator
    typingIndicator.textContent = '';
}

// Display Message
function displayMessage(user, message, isLocal) {
    const div = document.createElement('div');
    div.className = `chat-message flex gap-3 ${isLocal ? 'flex-row-reverse' : ''}`;
    
    const avatar = user.charAt(0).toUpperCase();
    const color = isLocal ? 'bg-indigo-600' : (user === 'System' ? 'bg-green-600' : 'bg-slate-700');
    
    div.innerHTML = `
        <div class="w-8 h-8 ${color} rounded-full flex items-center justify-center text-xs font-bold text-white flex-shrink-0">
            ${avatar}
        </div>
        <div class="${isLocal ? 'text-right' : ''} flex-1 min-w-0">
            <p class="text-xs text-gray-500 mb-1">${user}</p>
            <p class="text-sm text-gray-200 break-words bg-slate-800/50 p-2 rounded-lg inline-block max-w-full">
                ${escapeHtml(message)}
            </p>
        </div>
    `;
    
    chatMessages.appendChild(div);
    chatMessages.scrollTop = chatMessages.scrollHeight;
    
    // Clone to mobile chat
    const mobileDiv = div.cloneNode(true);
    mobileChatMessages.appendChild(mobileDiv);
    mobileChatMessages.scrollTop = mobileChatMessages.scrollHeight;
    
    // Update unread count if mobile chat is closed
    if (window.innerWidth < 768 && document.getElementById('mobileChat').classList.contains('hidden') && !isLocal) {
        unreadCount++;
        updateUnreadBadge();
    }
}

// Broadcast Data to All Connections
function broadcastData(data) {
    let sentCount = 0;
    connections.forEach(conn => {
        if (conn.open) {
            try {
                conn.send(data);
                sentCount++;
            } catch (err) {
                console.error('Error sending to peer:', err);
            }
        }
    });
    console.log('Broadcasted to', sentCount, 'peers');
}

// Toggle Mic
function toggleMic() {
    if (!localStream) return;
    
    const audioTrack = localStream.getAudioTracks()[0];
    if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        isMuted = !audioTrack.enabled;
        
        const btn = document.getElementById('micBtn');
        const indicator = document.getElementById('localAudioIndicator');
        
        if (isMuted) {
            btn.classList.add('bg-red-600', 'hover:bg-red-700');
            btn.classList.remove('bg-slate-700', 'hover:bg-slate-600');
            btn.innerHTML = '<i data-lucide="mic-off" class="w-5 h-5 text-white"></i>';
            if (indicator) indicator.classList.add('hidden');
        } else {
            btn.classList.remove('bg-red-600', 'hover:bg-red-700');
            btn.classList.add('bg-slate-700', 'hover:bg-slate-600');
            btn.innerHTML = '<i data-lucide="mic" class="w-5 h-5 text-white"></i>';
            if (indicator) indicator.classList.remove('hidden');
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
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
            btn.classList.add('bg-red-600', 'hover:bg-red-700');
            btn.classList.remove('bg-slate-700', 'hover:bg-slate-600');
            btn.innerHTML = '<i data-lucide="video-off" class="w-5 h-5 text-white"></i>';
            localVideo.style.display = 'none';
        } else {
            btn.classList.remove('bg-red-600', 'hover:bg-red-700');
            btn.classList.add('bg-slate-700', 'hover:bg-slate-600');
            btn.innerHTML = '<i data-lucide="video" class="w-5 h-5 text-white"></i>';
            localVideo.style.display = 'block';
        }
        if (typeof lucide !== 'undefined') lucide.createIcons();
    }
}

// Share Screen
async function shareScreen() {
    try {
        const screenStream = await navigator.mediaDevices.getDisplayMedia({ 
            video: true, 
            audio: true 
        });
        
        // Replace local video temporarily
        localVideo.srcObject = screenStream;
        
        // Replace track in peer connections
        const videoTrack = screenStream.getVideoTracks()[0];
        
        // In a real implementation, we'd renegotiate the peer connections
        // For now, just update the local display and notify
        showNotification('Screen sharing started');
        
        // Handle screen share stop
        videoTrack.onended = () => {
            localVideo.srcObject = localStream;
            showNotification('Screen sharing stopped');
        };
        
    } catch (err) {
        console.error('Screen share failed:', err);
        alert('Could not share screen: ' + err.message);
    }
}

// Add Remote Video
function addRemoteVideo(peerId, stream) {
    // Remove existing if any
    removeRemoteVideo(peerId);
    
    const div = document.createElement('div');
    div.id = `video-${peerId}`;
    div.className = 'relative bg-slate-800 rounded-lg overflow-hidden aspect-video shadow-lg';
    
    const video = document.createElement('video');
    video.className = 'user-video';
    video.autoplay = true;
    video.playsInline = true;
    video.srcObject = stream;
    
    const label = document.createElement('div');
    label.className = 'absolute bottom-2 left-2 px-2 py-1 bg-black/50 rounded text-xs text-white font-medium backdrop-blur-sm';
    label.textContent = 'Friend';
    
    // Add audio indicator
    const audioIndicator = document.createElement('div');
    audioIndicator.className = 'absolute top-2 right-2 w-3 h-3 bg-green-500 rounded-full pulse-ring hidden';
    audioIndicator.id = `audio-${peerId}`;
    
    div.appendChild(video);
    div.appendChild(label);
    div.appendChild(audioIndicator);
    videoGrid.appendChild(div);
    
    // Try to detect audio
    if (stream.getAudioTracks().length > 0) {
        const audioContext = new (window.AudioContext || window.webkitAudioContext)();
        const analyser = audioContext.createAnalyser();
        const microphone = audioContext.createMediaStreamSource(stream);
        microphone.connect(analyser);
        analyser.fftSize = 256;
        
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        
        function checkAudio() {
            if (!document.getElementById(`video-${peerId}`)) return;
            analyser.getByteFrequencyData(dataArray);
            const average = dataArray.reduce((a, b) => a + b) / dataArray.length;
            if (average > 10) {
                audioIndicator.classList.remove('hidden');
            } else {
                audioIndicator.classList.add('hidden');
            }
            requestAnimationFrame(checkAudio);
        }
        checkAudio();
    }
    
    updateUserCount();
    showNotification('New participant joined!');
}

// Remove Remote Video
function removeRemoteVideo(peerId) {
    const existing = document.getElementById(`video-${peerId}`);
    if (existing) {
        existing.remove();
        showNotification('Someone left the room');
    }
    updateUserCount();
}

// Update User Count
function updateUserCount() {
    const remoteCount = document.querySelectorAll('#videoGrid > div:not(:first-child)').length;
    const count = 1 + remoteCount;
    if (userCount) userCount.textContent = count;
}

// Copy Room ID
function copyRoomId() {
    navigator.clipboard.writeText(roomId).then(() => {
        showNotification('Room ID copied to clipboard!');
    }).catch(() => {
        // Fallback
        const textArea = document.createElement('textarea');
        textArea.value = roomId;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
        showNotification('Room ID copied!');
    });
}

// Show Notification
function showNotification(text) {
    const div = document.createElement('div');
    div.className = 'fixed top-20 left-1/2 transform -translate-x-1/2 bg-indigo-600 text-white px-6 py-3 rounded-lg shadow-2xl z-50 animate-bounce font-medium';
    div.textContent = text;
    document.body.appendChild(div);
    setTimeout(() => {
        div.style.opacity = '0';
        div.style.transition = 'opacity 0.5s';
        setTimeout(() => div.remove(), 500);
    }, 3000);
}

// Show Typing Indicator
let typingTimeout;
function showTypingIndicator(user) {
    if (user === username) return;
    typingIndicator.textContent = `${user} is typing...`;
    clearTimeout(typingTimeout);
    typingTimeout = setTimeout(() => {
        typingIndicator.textContent = '';
    }, 3000);
}

// Toggle Mobile Chat
function toggleMobileChat() {
    const chat = document.getElementById('mobileChat');
    chat.classList.toggle('hidden');
    if (!chat.classList.contains('hidden')) {
        unreadCount = 0;
        updateUnreadBadge();
        // Scroll to bottom
        mobileChatMessages.scrollTop = mobileChatMessages.scrollHeight;
    }
}

// Update Unread Badge
function updateUnreadBadge() {
    const badge = document.getElementById('unreadBadge');
    if (unreadCount > 0) {
        badge.textContent = unreadCount > 99 ? '99+' : unreadCount;
        badge.classList.remove('hidden');
    } else {
        badge.classList.add('hidden');
    }
}

// Leave Room
function leaveRoom() {
    if (confirm('Are you sure you want to leave this room?')) {
        cleanup();
        window.location.href = window.location.pathname;
    }
}

// Cleanup function
function cleanup() {
    // Stop all streams
    if (localStream) {
        localStream.getTracks().forEach(track => track.stop());
    }
    
    // Close all connections
    connections.forEach(conn => {
        if (conn.open) conn.close();
    });
    
    // Destroy peer
    if (peer) {
        peer.destroy();
    }
    
    // Clear storage
    const currentPeers = JSON.parse(localStorage.getItem('streamsync-peers-' + roomId) || '[]');
    const filtered = currentPeers.filter(id => id !== myPeerId);
    localStorage.setItem('streamsync-peers-' + roomId, JSON.stringify(filtered));
}

// Toggle Fullscreen
function toggleFullscreen() {
    const container = document.getElementById('streamContainer');
    if (!document.fullscreenElement) {
        container.requestFullscreen().catch(err => {
            console.error('Fullscreen error:', err);
        });
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

// Handle Typing
document.getElementById('messageInput')?.addEventListener('input', () => {
    broadcastData({ type: 'typing', username });
});

document.getElementById('mobileMessageInput')?.addEventListener('input', () => {
    broadcastData({ type: 'typing', username });
});

// Handle page unload
window.addEventListener('beforeunload', cleanup);

// Keyboard shortcuts
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !document.getElementById('mobileChat').classList.contains('hidden')) {
        toggleMobileChat();
    }
});