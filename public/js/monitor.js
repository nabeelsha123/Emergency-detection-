// Monitor page JavaScript - FIXED with null checks

// ==================== AUTHENTICATION ====================
const token = localStorage.getItem('token');
if (!token) window.location.href = '/login.html';

const user = JSON.parse(localStorage.getItem('user') || '{}');
const userNameEl = document.getElementById('userName');
if (userNameEl) userNameEl.textContent = user.full_name || 'User';

// Logout handler
const logoutBtn = document.getElementById('logoutBtn');
if (logoutBtn) {
    logoutBtn.addEventListener('click', (e) => {
        e.preventDefault();
        localStorage.removeItem('token');
        localStorage.removeItem('user');
        window.location.href = '/login.html';
    });
}

// ==================== STATE MANAGEMENT ====================
let ws = null;
let reconnectAttempts = 0;
const maxReconnectAttempts = 5;

let stats = {
    fall: { count: 0, lastTime: null, confidence: 0 },
    voice: { count: 0, lastTime: null, keywords: [] },
    alerts: 0,
    state: 'MONITORING'
};

let detectionLog = [];
let startTime = Date.now();
let detectorRunning = false;

// ==================== DOM ELEMENT REFERENCES ====================
function safeGetElement(id) {
    const el = document.getElementById(id);
    if (!el) console.warn(`Element with id '${id}' not found`);
    return el;
}

// ==================== WEBSOCKET CONNECTION ====================
function connectWebSocket() {
    try {
        ws = new WebSocket('ws://localhost:3000');

        ws.onopen = function() {
            console.log('WebSocket connected');
            reconnectAttempts = 0;
            updateConnectionStatus(true);
            addLog('System', 'Connected to server');
            startTime = Date.now();
            updateUptime();
        };

        ws.onmessage = function(event) {
            try {
                const data = JSON.parse(event.data);
                if (data.type === 'detection') {
                    handleDetection(data);
                } else if (data.type === 'status') {
                    updateStatus(data.data);
                }
            } catch (e) {
                console.error('Error parsing message:', e);
            }
        };

        ws.onclose = function() {
            console.log('WebSocket disconnected');
            updateConnectionStatus(false);

            if (reconnectAttempts < maxReconnectAttempts) {
                reconnectAttempts++;
                setTimeout(connectWebSocket, 3000);
            } else {
                addLog('System', 'Failed to reconnect to server');
            }
        };

        ws.onerror = function(error) {
            console.error('WebSocket error:', error);
            updateConnectionStatus(false);
        };

    } catch (error) {
        console.error('WebSocket connection error:', error);
        setTimeout(connectWebSocket, 3000);
    }
}

function updateConnectionStatus(connected) {
    const connectionLed = safeGetElement('connectionLed');
    const connectionText = safeGetElement('connectionText');
    const systemLed = safeGetElement('systemLed');
    const systemStatus = safeGetElement('systemStatus');
    const cameraLed = safeGetElement('cameraLed');
    const cameraStatusText = safeGetElement('cameraStatusText');
    const noFeedMessage = safeGetElement('noFeedMessage');
    const detectionOverlay = safeGetElement('detectionOverlay');
    
    if (connectionLed) connectionLed.className = connected ? 'status-led active' : 'status-led offline';
    if (connectionText) connectionText.textContent = connected ? 'Connected' : 'Disconnected';
    if (systemLed) systemLed.className = connected ? 'status-led active' : 'status-led offline';
    if (systemStatus) systemStatus.textContent = connected ? 'Connected' : 'Disconnected';
    
    if (cameraLed) cameraLed.className = (connected && detectorRunning) ? 'status-led active' : 'status-led offline';
    if (cameraStatusText) cameraStatusText.textContent = (connected && detectorRunning) ? 'Camera Active' : 'Camera Offline';
    
    if (noFeedMessage) noFeedMessage.style.display = (connected && detectorRunning) ? 'none' : 'flex';
    if (detectionOverlay) detectionOverlay.style.display = (connected && detectorRunning) ? 'block' : 'none';
}

// ==================== DETECTOR CONTROL ====================
function startDetector() {
    const loadingOverlay = safeGetElement('loadingOverlay');
    const loadingMessage = safeGetElement('loadingMessage');
    
    if (loadingOverlay) loadingOverlay.classList.add('show');
    if (loadingMessage) loadingMessage.textContent = 'Starting detector...';

    fetch('/api/detector/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(res => res.json())
    .then(data => {
        if (loadingOverlay) loadingOverlay.classList.remove('show');
        
        if (data.success) {
            detectorRunning = true;
            const startBtn = safeGetElement('startDetectorBtn');
            const stopBtn = safeGetElement('stopDetectorBtn');
            const cameraLed = safeGetElement('cameraLed');
            const cameraStatusText = safeGetElement('cameraStatusText');
            const noFeedMessage = safeGetElement('noFeedMessage');
            const detectionOverlay = safeGetElement('detectionOverlay');
            
            if (startBtn) startBtn.disabled = true;
            if (stopBtn) stopBtn.disabled = false;
            if (cameraLed) cameraLed.className = 'status-led active';
            if (cameraStatusText) cameraStatusText.textContent = 'Camera Active';
            if (noFeedMessage) noFeedMessage.style.display = 'none';
            if (detectionOverlay) detectionOverlay.style.display = 'block';
            
            addLog('System', 'Detector started');
        } else {
            alert('Failed to start detector: ' + (data.error || 'Unknown error'));
        }
    })
    .catch(error => {
        if (loadingOverlay) loadingOverlay.classList.remove('show');
        alert('Failed to start detector: ' + error.message);
    });
}

function stopDetector() {
    fetch('/api/detector/stop', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' }
    })
    .then(res => res.json())
    .then(data => {
        if (data.success) {
            detectorRunning = false;
            const startBtn = safeGetElement('startDetectorBtn');
            const stopBtn = safeGetElement('stopDetectorBtn');
            const cameraLed = safeGetElement('cameraLed');
            const cameraStatusText = safeGetElement('cameraStatusText');
            const noFeedMessage = safeGetElement('noFeedMessage');
            const detectionOverlay = safeGetElement('detectionOverlay');
            
            if (startBtn) startBtn.disabled = false;
            if (stopBtn) stopBtn.disabled = true;
            if (cameraLed) cameraLed.className = 'status-led offline';
            if (cameraStatusText) cameraStatusText.textContent = 'Camera Offline';
            if (noFeedMessage) noFeedMessage.style.display = 'flex';
            if (detectionOverlay) detectionOverlay.style.display = 'none';
            
            addLog('System', 'Detector stopped');
        }
    })
    .catch(error => {
        alert('Failed to stop detector: ' + error.message);
    });
}

// ==================== DETECTION HANDLING ====================
function handleDetection(data) {
    const type = data.event_type;
    const message = data.details || `${type} detected`;
    const confidence = data.confidence || 0;
    const keywords = data.keywords || [];
    const timestamp = new Date(data.timestamp || Date.now());

    // Update stats
    if (type === 'fall') {
        stats.fall.count++;
        stats.fall.lastTime = timestamp;
        stats.fall.confidence = confidence;

        updateFallDisplay();
        showEmergency('FALL DETECTED!', message);
        playAlarm('fall');
        addLog('FALL', message, confidence);

        // Animate card
        const fallCard = safeGetElement('fallStatCard');
        if (fallCard) {
            fallCard.style.animation = 'pulse 1s';
            setTimeout(() => { if (fallCard) fallCard.style.animation = ''; }, 1000);
        }

    } else if (type === 'voice') {
        stats.voice.count++;
        stats.voice.lastTime = timestamp;
        stats.voice.keywords = keywords;

        updateVoiceDisplay();
        showEmergency('VOICE EMERGENCY!', message);
        playAlarm('voice');
        addLog('VOICE', message, confidence, keywords);

        // Animate card
        const voiceCard = safeGetElement('voiceStatCard');
        if (voiceCard) {
            voiceCard.style.animation = 'pulse 1s';
            setTimeout(() => { if (voiceCard) voiceCard.style.animation = ''; }, 1000);
        }
    }

    // Update total alerts
    stats.alerts = stats.fall.count + stats.voice.count;
    stats.state = type === 'fall' ? 'FALL_DETECTED' : 'VOICE_DETECTED';

    updateAlertDisplay();
    addToTable(type, message, confidence, keywords);

    // Update LED states
    const fallLed = safeGetElement('fallLed');
    const fallStatus = safeGetElement('fallStatus');
    const voiceLed = safeGetElement('voiceLed');
    const voiceStatus = safeGetElement('voiceStatus');
    const detectionText = safeGetElement('detectionText');
    const detectionBadge = safeGetElement('detectionBadge');
    
    if (fallLed) fallLed.className = 'status-led emergency';
    if (fallStatus) fallStatus.textContent = type === 'fall' ? 'FALL DETECTED!' : 'Active';
    if (voiceLed) voiceLed.className = 'status-led emergency';
    if (voiceStatus) voiceStatus.textContent = type === 'voice' ? 'VOICE DETECTED!' : 'Active';
    if (detectionText) detectionText.textContent = type === 'fall' ? 'FALL DETECTED' : 'VOICE EMERGENCY';
    if (detectionBadge) {
        detectionBadge.style.background = type === 'fall' ? 'rgba(239, 68, 68, 0.9)' : 'rgba(16, 185, 129, 0.9)';
    }

    // Update progress bars
    const fallProgress = safeGetElement('fallProgress');
    const confidenceBar = safeGetElement('confidenceBar');
    const confidenceValue = safeGetElement('confidenceValue');
    
    if (fallProgress) fallProgress.style.width = `${confidence * 100}%`;
    if (confidenceBar) confidenceBar.style.width = `${confidence * 100}%`;
    if (confidenceValue) confidenceValue.textContent = `${Math.round(confidence * 100)}%`;

    // Reset after 5 seconds
    setTimeout(() => {
        if (detectorRunning) {
            if (fallLed) fallLed.className = 'status-led active';
            if (fallStatus) fallStatus.textContent = 'Active';
            if (voiceLed) voiceLed.className = 'status-led active';
            if (voiceStatus) voiceStatus.textContent = 'Active';
            
            const currentState = safeGetElement('currentState');
            if (currentState) currentState.textContent = 'State: MONITORING';
            stats.state = 'MONITORING';
            
            if (detectionText) detectionText.textContent = 'MONITORING';
            if (detectionBadge) detectionBadge.style.background = 'rgba(0, 0, 0, 0.7)';
        }
    }, 5000);
}

function updateFallDisplay() {
    const fallCount = safeGetElement('fallCount');
    const fallLastTime = safeGetElement('fallLastTime');
    const fallConfidence = safeGetElement('fallConfidence');
    
    if (fallCount) fallCount.textContent = stats.fall.count;
    if (stats.fall.lastTime) {
        if (fallLastTime) fallLastTime.textContent = `Last: ${stats.fall.lastTime.toLocaleTimeString()}`;
        if (fallConfidence) fallConfidence.textContent = `Confidence: ${Math.round(stats.fall.confidence * 100)}%`;
    }
}

function updateVoiceDisplay() {
    const voiceCount = safeGetElement('voiceCount');
    const voiceLastTime = safeGetElement('voiceLastTime');
    const voiceKeywords = safeGetElement('voiceKeywords');
    
    if (voiceCount) voiceCount.textContent = stats.voice.count;
    if (stats.voice.lastTime) {
        if (voiceLastTime) voiceLastTime.textContent = `Last: ${stats.voice.lastTime.toLocaleTimeString()}`;
        if (stats.voice.keywords.length && voiceKeywords) {
            voiceKeywords.textContent = `Keywords: ${stats.voice.keywords.join(', ')}`;
        }
    }
}

function updateAlertDisplay() {
    const alertCount = safeGetElement('alertCount');
    const currentState = safeGetElement('currentState');
    const lastAlertTime = safeGetElement('lastAlertTime');
    
    if (alertCount) alertCount.textContent = stats.alerts;
    if (currentState) currentState.textContent = `State: ${stats.state}`;
    
    if (stats.fall.lastTime || stats.voice.lastTime) {
        const lastTime = stats.fall.lastTime > stats.voice.lastTime ? stats.fall.lastTime : stats.voice.lastTime;
        if (lastAlertTime) lastAlertTime.textContent = `Last: ${lastTime.toLocaleTimeString()}`;
    }
}

// ==================== UI UPDATES ====================
function updateStatus(status) {
    if (!status) return;

    // Update fall status
    if (status.fall) {
        const fallLed = safeGetElement('fallLed');
        const fallStatus = safeGetElement('fallStatus');
        const fallCount = safeGetElement('fallCount');
        const fallProgress = safeGetElement('fallProgress');
        
        if (fallLed) fallLed.className = status.fall.active ? 'status-led active' : 'status-led offline';
        if (fallStatus) fallStatus.textContent = status.fall.active ? 'Active' : 'Inactive';
        stats.fall.count = status.fall.total || 0;
        if (fallCount) fallCount.textContent = stats.fall.count;

        if (status.fall.confidence && fallProgress) {
            fallProgress.style.width = `${status.fall.confidence * 100}%`;
        }
    }

    // Update voice status
    if (status.voice) {
        const voiceLed = safeGetElement('voiceLed');
        const voiceStatus = safeGetElement('voiceStatus');
        const voiceCount = safeGetElement('voiceCount');
        
        if (voiceLed) voiceLed.className = status.voice.active ? 'status-led active' : 'status-led offline';
        if (voiceStatus) voiceStatus.textContent = status.voice.active ? 'Active' : 'Inactive';
        stats.voice.count = status.voice.total || 0;
        if (voiceCount) voiceCount.textContent = stats.voice.count;
    }

    // Update system status
    stats.alerts = (status.fall?.total || 0) + (status.voice?.total || 0);
    const alertCount = safeGetElement('alertCount');
    if (alertCount) alertCount.textContent = stats.alerts;

    if (status.currentState) {
        stats.state = status.currentState;
        const currentState = safeGetElement('currentState');
        if (currentState) currentState.textContent = `State: ${status.currentState}`;
    }

    if (status.connected !== undefined) {
        detectorRunning = status.connected;
        const startBtn = safeGetElement('startDetectorBtn');
        const stopBtn = safeGetElement('stopDetectorBtn');
        const cameraLed = safeGetElement('cameraLed');
        const cameraStatusText = safeGetElement('cameraStatusText');
        const noFeedMessage = safeGetElement('noFeedMessage');
        const detectionOverlay = safeGetElement('detectionOverlay');
        
        if (startBtn) startBtn.disabled = detectorRunning;
        if (stopBtn) stopBtn.disabled = !detectorRunning;
        if (cameraLed) cameraLed.className = detectorRunning ? 'status-led active' : 'status-led offline';
        if (cameraStatusText) cameraStatusText.textContent = detectorRunning ? 'Camera Active' : 'Camera Offline';
        
        if (noFeedMessage) noFeedMessage.style.display = detectorRunning ? 'none' : 'flex';
        if (detectionOverlay) detectionOverlay.style.display = detectorRunning ? 'block' : 'none';
    }
}

function showEmergency(title, message) {
    const popup = safeGetElement('emergencyPopup');
    const emergencyTitle = safeGetElement('emergencyTitle');
    const emergencyMessage = safeGetElement('emergencyMessage');
    const emergencyTime = safeGetElement('emergencyTime');
    
    if (emergencyTitle) emergencyTitle.textContent = title;
    if (emergencyMessage) emergencyMessage.textContent = message;
    if (emergencyTime) emergencyTime.textContent = new Date().toLocaleString();
    if (popup) popup.classList.add('show');

    // Auto hide after 8 seconds
    setTimeout(() => {
        if (popup) popup.classList.remove('show');
    }, 8000);
}

function acknowledgeEmergency() {
    const popup = safeGetElement('emergencyPopup');
    if (popup) popup.classList.remove('show');
    addLog('System', 'Emergency acknowledged');
}

function playAlarm(type) {
    try {
        const audioCtx = new (window.AudioContext || window.webkitAudioContext)();

        if (type === 'fall') {
            // Fall alarm - descending siren
            playTone(audioCtx, 1000, 200);
            setTimeout(() => playTone(audioCtx, 800, 200), 200);
            setTimeout(() => playTone(audioCtx, 600, 200), 400);
            setTimeout(() => playTone(audioCtx, 800, 200), 600);
            setTimeout(() => playTone(audioCtx, 1000, 400), 800);
        } else {
            // Voice alarm - ascending siren
            playTone(audioCtx, 600, 200);
            setTimeout(() => playTone(audioCtx, 800, 200), 200);
            setTimeout(() => playTone(audioCtx, 1000, 200), 400);
            setTimeout(() => playTone(audioCtx, 1200, 200), 600);
            setTimeout(() => playTone(audioCtx, 1000, 400), 800);
        }
    } catch (e) {
        // Fallback to audio element
        const alarmSound = safeGetElement('alarmSound');
        if (alarmSound) alarmSound.play().catch(() => {});
    }
}

function playTone(audioCtx, frequency, duration) {
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.frequency.value = frequency;
    gainNode.gain.value = 0.3;

    oscillator.start();
    oscillator.stop(audioCtx.currentTime + duration / 1000);
}

// ==================== LOGGING ====================
function addLog(type, message, confidence) {
    const log = safeGetElement('logContainer');
    if (!log) return;
    
    const entry = document.createElement('div');
    entry.className = 'log-entry';

    const time = new Date().toLocaleTimeString();
    const confidenceText = confidence ? ` ${Math.round(confidence * 100)}%` : '';

    entry.innerHTML = `
        <span class="log-time">${time}</span>
        <span class="log-type ${type.toLowerCase()}">${type}</span>
        <span class="log-message">${message}${confidenceText}</span>
    `;

    log.insertBefore(entry, log.firstChild);

    // Keep only last 50 logs
    while (log.children.length > 50) {
        log.removeChild(log.lastChild);
    }
}

function addToTable(type, message, confidence, keywords) {
    const tbody = safeGetElement('detectionsList');
    if (!tbody) return;
    
    // Remove "No detections" row if present
    if (tbody.children.length === 1 && tbody.children[0].colSpan) {
        tbody.innerHTML = '';
    }

    const row = tbody.insertRow(0);
    const time = new Date().toLocaleString();
    const confidenceText = confidence ? `${Math.round(confidence * 100)}%` : '-';
    const keywordsText = keywords && keywords.length ? keywords.join(', ') : '-';

    row.innerHTML = `
        <td>${time}</td>
        <td><span class="badge badge-${type}">${type}</span></td>
        <td>${message}</td>
        <td>${confidenceText}</td>
        <td>${keywordsText}</td>
    `;

    // Keep only last 20 rows
    while (tbody.children.length > 20) {
        tbody.deleteRow(-1);
    }
}

function clearLog() {
    const log = safeGetElement('logContainer');
    if (log) {
        log.innerHTML = `
            <div class="log-entry system">
                <span class="log-time">System</span>
                <span class="log-message">Log cleared</span>
            </div>
        `;
    }
    addLog('System', 'Log cleared');
}

function exportLog() {
    const logs = [];
    const log = safeGetElement('logContainer');
    if (!log) return;
    
    const entries = log.querySelectorAll('.log-entry');

    entries.forEach(entry => {
        const time = entry.querySelector('.log-time')?.textContent || '';
        const type = entry.querySelector('.log-type')?.textContent || '';
        const message = entry.querySelector('.log-message')?.textContent || '';
        logs.push(`${time} [${type}] ${message}`);
    });

    const blob = new Blob([logs.join('\n')], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `detection_log_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);

    addLog('System', 'Log exported');
}

// ==================== UTILITIES ====================
function resetCounters() {
    if (confirm('Reset all counters?')) {
        stats = {
            fall: { count: 0, lastTime: null, confidence: 0 },
            voice: { count: 0, lastTime: null, keywords: [] },
            alerts: 0,
            state: 'MONITORING'
        };

        const fallCount = safeGetElement('fallCount');
        const voiceCount = safeGetElement('voiceCount');
        const alertCount = safeGetElement('alertCount');
        const fallLastTime = safeGetElement('fallLastTime');
        const fallConfidence = safeGetElement('fallConfidence');
        const voiceLastTime = safeGetElement('voiceLastTime');
        const voiceKeywords = safeGetElement('voiceKeywords');
        const currentState = safeGetElement('currentState');
        const lastAlertTime = safeGetElement('lastAlertTime');
        const fallProgress = safeGetElement('fallProgress');
        const confidenceBar = safeGetElement('confidenceBar');
        const confidenceValue = safeGetElement('confidenceValue');
        
        if (fallCount) fallCount.textContent = '0';
        if (voiceCount) voiceCount.textContent = '0';
        if (alertCount) alertCount.textContent = '0';
        if (fallLastTime) fallLastTime.textContent = 'Last: -';
        if (fallConfidence) fallConfidence.textContent = 'Confidence: -';
        if (voiceLastTime) voiceLastTime.textContent = 'Last: -';
        if (voiceKeywords) voiceKeywords.textContent = 'Keywords: -';
        if (currentState) currentState.textContent = 'State: MONITORING';
        if (lastAlertTime) lastAlertTime.textContent = 'Last: -';
        if (fallProgress) fallProgress.style.width = '0%';
        if (confidenceBar) confidenceBar.style.width = '0%';
        if (confidenceValue) confidenceValue.textContent = '0%';

        addLog('System', 'Counters reset');
    }
}

function changePatient() {
    const select = safeGetElement('patientSelect');
    const patientIdSpan = safeGetElement('patientId');
    if (select && patientIdSpan) {
        const patientId = select.value;
        patientIdSpan.textContent = patientId;
        addLog('System', `Switched to Patient ID: ${patientId}`);
    }
}

function updateUptime() {
    const uptimeEl = safeGetElement('uptime');
    
    setInterval(() => {
        if (detectorRunning && uptimeEl) {
            const seconds = Math.floor((Date.now() - startTime) / 1000);
            const hours = Math.floor(seconds / 3600);
            const minutes = Math.floor((seconds % 3600) / 60);
            const secs = seconds % 60;
            uptimeEl.textContent = `${hours}h ${minutes}m ${secs}s`;
        }
    }, 1000);
}

// ==================== INITIALIZATION ====================
// Load patients for dropdown
fetch('/api/patients', {
    headers: { 'Authorization': `Bearer ${token}` }
})
.then(res => res.json())
.then(patients => {
    const select = safeGetElement('patientSelect');
    if (select && patients && patients.length) {
        select.innerHTML = patients.map(p =>
            `<option value="${p.id}">${p.full_name} (Room ${p.room_number || 'N/A'})</option>`
        ).join('');
    }
})
.catch(() => {});

// Load initial status
fetch('/api/detector/status')
.then(res => res.json())
.then(data => {
    updateStatus(data);
    detectorRunning = data.connected || false;
})
.catch(() => {});

// Connect WebSocket
setTimeout(connectWebSocket, 500);

// Handle page visibility
document.addEventListener('visibilitychange', () => {
    if (!document.hidden && (!ws || ws.readyState !== WebSocket.OPEN)) {
        connectWebSocket();
    }
});

// Handle before unload
window.addEventListener('beforeunload', () => {
    if (ws) {
        ws.close();
    }
});