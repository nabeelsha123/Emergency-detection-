// Check authentication
const token = localStorage.getItem('token');
if (!token) {
    window.location.href = '/login.html';
}

// Set user info
const user = JSON.parse(localStorage.getItem('user') || '{}');
document.getElementById('userName').textContent = user.full_name || 'User';

// Logout functionality
document.getElementById('logoutBtn').addEventListener('click', (e) => {
    e.preventDefault();
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login.html';
});

// Load dashboard stats
async function loadStats() {
    try {
        const response = await fetch('/api/stats', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const stats = await response.json();
        
        document.getElementById('totalPatients').textContent = stats.totalPatients || 0;
        document.getElementById('totalAlerts').textContent = stats.totalAlerts || 0;
        document.getElementById('todayAlerts').textContent = stats.todayAlerts || 0;
        document.getElementById('todayDetections').textContent = stats.todayDetections || 0;
    } catch (error) {
        console.error('Error loading stats:', error);
    }
}

// Load recent patients
async function loadRecentPatients() {
    try {
        const response = await fetch('/api/patients', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const patients = await response.json();
        
        const tbody = document.getElementById('patientsList');
        
        if (patients.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center">No patients added yet</td></tr>';
            return;
        }
        
        // Show only first 5 patients
        const recentPatients = patients.slice(0, 5);
        
        tbody.innerHTML = recentPatients.map(patient => `
            <tr>
                <td>${patient.full_name}</td>
                <td>${patient.age || '-'}</td>
                <td>${patient.gender || '-'}</td>
                <td>${patient.emergency_contact_name || '-'}</td>
                <td>
                    <div class="actions">
                        <button class="btn-icon" onclick="viewPatient(${patient.id})" title="View">
                            <i class="fas fa-eye"></i>
                        </button>
                        <button class="btn-icon" onclick="sendAlert(${patient.id}, '${patient.full_name}', '${patient.emergency_contact_name}', '${patient.emergency_contact_phone}')" title="Send Alert">
                            <i class="fas fa-exclamation-triangle" style="color: #c62828;"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading patients:', error);
        document.getElementById('patientsList').innerHTML = 
            '<tr><td colspan="5" class="text-center">Error loading patients</td></tr>';
    }
}

// Load recent alerts
async function loadRecentAlerts() {
    try {
        const response = await fetch('/api/alerts', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const alerts = await response.json();
        
        const tbody = document.getElementById('alertsList');
        
        if (alerts.length === 0) {
            tbody.innerHTML = '<tr><td colspan="5" class="text-center">No alerts yet</td></tr>';
            return;
        }
        
        // Show only first 5 alerts
        const recentAlerts = alerts.slice(0, 5);
        
        tbody.innerHTML = recentAlerts.map(alert => `
            <tr>
                <td>${alert.patient_name}</td>
                <td><span class="badge" style="background: ${getAlertColor(alert.alert_type)}">${alert.alert_type}</span></td>
                <td>${alert.message.substring(0, 50)}${alert.message.length > 50 ? '...' : ''}</td>
                <td>${new Date(alert.created_at).toLocaleString()}</td>
                <td><span class="badge" style="background: ${getStatusColor(alert.status)}">${alert.status}</span></td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading alerts:', error);
    }
}

function getAlertColor(type) {
    const colors = {
        'fall': '#c62828',
        'gesture': '#e65100',
        'voice': '#2e7d32',
        'manual': '#1976d2'
    };
    return colors[type] || '#6c757d';
}

function getStatusColor(status) {
    const colors = {
        'pending': '#e65100',
        'resolved': '#2e7d32',
        'dismissed': '#6c757d'
    };
    return colors[status] || '#6c757d';
}

// View patient details
function viewPatient(id) {
    window.location.href = `/patients.html?view=${id}`;
}

// Send emergency alert
let currentAlertPatient = null;

function sendAlert(id, name, contactName, contactPhone) {
    currentAlertPatient = { id, name, contactName, contactPhone };
    document.getElementById('alertPatientId').value = id;
    document.getElementById('alertPatientName').textContent = name;
    document.getElementById('alertContactInfo').textContent = `${contactName} (${contactPhone})`;
    document.getElementById('alertMessage').value = '';
    openModal('alertModal');
}

async function sendEmergencyAlert() {
    if (!currentAlertPatient) return;
    
    const message = document.getElementById('alertMessage').value || 
        `🚨 EMERGENCY! ${currentAlertPatient.name} needs immediate help!`;
    
    try {
        const response = await fetch('/api/send-emergency', {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({
                patient_id: currentAlertPatient.id,
                message: message
            })
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert('Emergency alert sent successfully!');
            closeModal('alertModal');
            loadRecentAlerts(); // Refresh alerts
        } else {
            alert(data.error || 'Failed to send alert');
        }
    } catch (error) {
        console.error('Error sending alert:', error);
        alert('Connection error. Please try again.');
    }
}

// Modal functions
function openModal(modalId) {
    document.getElementById(modalId).classList.add('show');
}

function closeModal(modalId) {
    document.getElementById(modalId).classList.remove('show');
}

// Close modal when clicking outside
window.onclick = function(event) {
    if (event.target.classList.contains('modal')) {
        event.target.classList.remove('show');
    }
};

// Initialize
loadStats();
loadRecentPatients();
loadRecentAlerts();

// Refresh stats every 30 seconds
setInterval(() => {
    loadStats();
    loadRecentAlerts();
}, 30000);