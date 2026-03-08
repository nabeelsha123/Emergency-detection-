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

// Load all patients
async function loadPatients() {
    try {
        const response = await fetch('/api/patients', {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const patients = await response.json();
        
        const tbody = document.getElementById('patientsList');
        
        if (patients.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6" class="text-center">No patients added yet. Click "Add New Patient" to get started.</td></tr>';
            return;
        }
        
        tbody.innerHTML = patients.map(patient => `
            <tr>
                <td>${patient.full_name}</td>
                <td>${patient.age || '-'}</td>
                <td>${patient.gender || '-'}</td>
                <td>${patient.emergency_contact_name || '-'}</td>
                <td>${patient.emergency_contact_phone || '-'}</td>
                <td>
                    <div class="actions">
                        <button class="btn-icon" onclick="editPatient(${patient.id})" title="Edit">
                            <i class="fas fa-edit"></i>
                        </button>
                        <button class="btn-icon" onclick="sendAlert(${patient.id}, '${patient.full_name}', '${patient.emergency_contact_name}', '${patient.emergency_contact_phone}')" title="Send Alert">
                            <i class="fas fa-exclamation-triangle" style="color: #c62828;"></i>
                        </button>
                        <button class="btn-icon danger" onclick="deletePatient(${patient.id})" title="Delete">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </td>
            </tr>
        `).join('');
    } catch (error) {
        console.error('Error loading patients:', error);
        document.getElementById('patientsList').innerHTML = 
            '<tr><td colspan="6" class="text-center">Error loading patients</td></tr>';
    }
}

// Search functionality
document.getElementById('searchPatient').addEventListener('input', (e) => {
    const searchTerm = e.target.value.toLowerCase();
    const rows = document.querySelectorAll('#patientsList tr');
    
    rows.forEach(row => {
        const text = row.textContent.toLowerCase();
        row.style.display = text.includes(searchTerm) ? '' : 'none';
    });
});

// Open add patient modal
function openAddPatientModal() {
    document.getElementById('modalTitle').textContent = 'Add New Patient';
    document.getElementById('patientForm').reset();
    document.getElementById('patientId').value = '';
    openModal('patientModal');
}

// Edit patient
async function editPatient(id) {
    try {
        const response = await fetch(`/api/patients/${id}`, {
            headers: { 'Authorization': `Bearer ${token}` }
        });
        const patient = await response.json();
        
        if (response.ok) {
            document.getElementById('modalTitle').textContent = 'Edit Patient';
            document.getElementById('patientId').value = patient.id;
            document.getElementById('fullName').value = patient.full_name || '';
            document.getElementById('age').value = patient.age || '';
            document.getElementById('gender').value = patient.gender || '';
            document.getElementById('medicalConditions').value = patient.medical_conditions || '';
            document.getElementById('emergencyName').value = patient.emergency_contact_name || '';
            document.getElementById('emergencyPhone').value = patient.emergency_contact_phone || '';
            document.getElementById('emergencyRelation').value = patient.emergency_contact_relation || '';
            document.getElementById('address').value = patient.address || '';
            
            openModal('patientModal');
        } else {
            alert(patient.error || 'Failed to load patient');
        }
    } catch (error) {
        console.error('Error loading patient:', error);
        alert('Connection error');
    }
}

// Save patient
async function savePatient() {
    const patientId = document.getElementById('patientId').value;
    const patientData = {
        full_name: document.getElementById('fullName').value,
        age: document.getElementById('age').value,
        gender: document.getElementById('gender').value,
        medical_conditions: document.getElementById('medicalConditions').value,
        emergency_contact_name: document.getElementById('emergencyName').value,
        emergency_contact_phone: document.getElementById('emergencyPhone').value,
        emergency_contact_relation: document.getElementById('emergencyRelation').value,
        address: document.getElementById('address').value
    };
    
    // Validate required fields
    if (!patientData.full_name || !patientData.emergency_contact_name || !patientData.emergency_contact_phone) {
        alert('Please fill in all required fields');
        return;
    }
    
    try {
        const url = patientId ? `/api/patients/${patientId}` : '/api/patients';
        const method = patientId ? 'PUT' : 'POST';
        
        const response = await fetch(url, {
            method: method,
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify(patientData)
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert(patientId ? 'Patient updated successfully' : 'Patient added successfully');
            closeModal('patientModal');
            loadPatients();
        } else {
            alert(data.error || 'Failed to save patient');
        }
    } catch (error) {
        console.error('Error saving patient:', error);
        alert('Connection error');
    }
}

// Delete patient
async function deletePatient(id) {
    if (!confirm('Are you sure you want to delete this patient? This action cannot be undone.')) {
        return;
    }
    
    try {
        const response = await fetch(`/api/patients/${id}`, {
            method: 'DELETE',
            headers: { 'Authorization': `Bearer ${token}` }
        });
        
        const data = await response.json();
        
        if (response.ok) {
            alert('Patient deleted successfully');
            loadPatients();
        } else {
            alert(data.error || 'Failed to delete patient');
        }
    } catch (error) {
        console.error('Error deleting patient:', error);
        alert('Connection error');
    }
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

// Check for view parameter in URL
const urlParams = new URLSearchParams(window.location.search);
const viewId = urlParams.get('view');
if (viewId) {
    editPatient(viewId);
}

// Initialize
loadPatients();