const express = require('express');
const cors = require('cors');
const path = require('path');
const db = require('./database');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = 3000;
const JWT_SECRET = 'guardian_net_secret_key_2024';

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, '../public')));

// JWT Authentication middleware
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (!token) {
        return res.status(401).json({ error: 'Access denied' });
    }

    jwt.verify(token, JWT_SECRET, (err, user) => {
        if (err) {
            return res.status(403).json({ error: 'Invalid token' });
        }
        req.user = user;
        next();
    });
};

// ==================== AUTHENTICATION ROUTES ====================

// Register new caretaker
app.post('/api/register', async (req, res) => {
    const { username, password, full_name, email, phone } = req.body;

    if (!username || !password || !full_name || !email) {
        return res.status(400).json({ error: 'All fields are required' });
    }

    try {
        const hashedPassword = await bcrypt.hash(password, 10);

        db.run('INSERT INTO caretakers (username, password, full_name, email, phone) VALUES (?, ?, ?, ?, ?)',
            [username, hashedPassword, full_name, email, phone],
            function(err) {
                if (err) {
                    if (err.message.includes('UNIQUE')) {
                        return res.status(400).json({ error: 'Username or email already exists' });
                    }
                    return res.status(500).json({ error: err.message });
                }

                const token = jwt.sign(
                    { id: this.lastID, username, full_name },
                    JWT_SECRET,
                    { expiresIn: '24h' }
                );

                res.json({
                    message: 'Registration successful',
                    token,
                    user: { id: this.lastID, username, full_name, email, phone }
                });
            });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Login
app.post('/api/login', (req, res) => {
    const { username, password } = req.body;

    if (!username || !password) {
        return res.status(400).json({ error: 'Username and password required' });
    }

    db.get('SELECT * FROM caretakers WHERE username = ?', [username], async (err, user) => {
        if (err) {
            return res.status(500).json({ error: err.message });
        }

        if (!user) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const validPassword = await bcrypt.compare(password, user.password);
        if (!validPassword) {
            return res.status(401).json({ error: 'Invalid username or password' });
        }

        const token = jwt.sign(
            { id: user.id, username: user.username, full_name: user.full_name },
            JWT_SECRET,
            { expiresIn: '24h' }
        );

        res.json({
            message: 'Login successful',
            token,
            user: {
                id: user.id,
                username: user.username,
                full_name: user.full_name,
                email: user.email,
                phone: user.phone
            }
        });
    });
});

// ==================== PATIENT ROUTES ====================

// Get all patients for a caretaker
app.get('/api/patients', authenticateToken, (req, res) => {
    db.all('SELECT * FROM patients WHERE caretaker_id = ? AND is_active = 1 ORDER BY created_at DESC',
        [req.user.id],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json(rows);
        });
});

// Get single patient
app.get('/api/patients/:id', authenticateToken, (req, res) => {
    db.get('SELECT * FROM patients WHERE id = ? AND caretaker_id = ?',
        [req.params.id, req.user.id],
        (err, row) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (!row) {
                return res.status(404).json({ error: 'Patient not found' });
            }
            res.json(row);
        });
});

// Add new patient
app.post('/api/patients', authenticateToken, (req, res) => {
    const {
        full_name,
        age,
        gender,
        medical_conditions,
        emergency_contact_name,
        emergency_contact_phone,
        emergency_contact_relation,
        address
    } = req.body;

    if (!full_name || !emergency_contact_name || !emergency_contact_phone) {
        return res.status(400).json({ error: 'Required fields missing' });
    }

    db.run(`INSERT INTO patients 
        (caretaker_id, full_name, age, gender, medical_conditions, 
         emergency_contact_name, emergency_contact_phone, emergency_contact_relation, address) 
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [req.user.id, full_name, age, gender, medical_conditions,
         emergency_contact_name, emergency_contact_phone, emergency_contact_relation, address],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json({
                id: this.lastID,
                message: 'Patient added successfully'
            });
        });
});

// Update patient
app.put('/api/patients/:id', authenticateToken, (req, res) => {
    const {
        full_name,
        age,
        gender,
        medical_conditions,
        emergency_contact_name,
        emergency_contact_phone,
        emergency_contact_relation,
        address
    } = req.body;

    db.run(`UPDATE patients SET 
        full_name = ?, age = ?, gender = ?, medical_conditions = ?,
        emergency_contact_name = ?, emergency_contact_phone = ?,
        emergency_contact_relation = ?, address = ?
        WHERE id = ? AND caretaker_id = ?`,
        [full_name, age, gender, medical_conditions,
         emergency_contact_name, emergency_contact_phone,
         emergency_contact_relation, address,
         req.params.id, req.user.id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Patient not found' });
            }
            res.json({ message: 'Patient updated successfully' });
        });
});

// Delete patient (soft delete)
app.delete('/api/patients/:id', authenticateToken, (req, res) => {
    db.run('UPDATE patients SET is_active = 0 WHERE id = ? AND caretaker_id = ?',
        [req.params.id, req.user.id],
        function(err) {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (this.changes === 0) {
                return res.status(404).json({ error: 'Patient not found' });
            }
            res.json({ message: 'Patient deleted successfully' });
        });
});

// ==================== EMERGENCY ALERT ROUTES ====================

// API endpoint for Python detector to send alerts
app.post('/api/detector/alert', async (req, res) => {
    const { patient_id, alert_type, message, confidence } = req.body;

    if (!patient_id || !alert_type) {
        return res.status(400).json({ error: 'Patient ID and alert type required' });
    }

    // Get patient details with caretaker info
    db.get(`SELECT p.*, c.id as caretaker_id, c.full_name as caretaker_name, c.phone as caretaker_phone 
            FROM patients p
            JOIN caretakers c ON p.caretaker_id = c.id
            WHERE p.id = ? AND p.is_active = 1`,
        [patient_id],
        async (err, patient) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (!patient) {
                return res.status(404).json({ error: 'Patient not found' });
            }

            const alertMessage = message || `🚨 ${alert_type.toUpperCase()} DETECTED! ${patient.full_name} needs immediate help!`;

            // Save alert to database
            db.run('INSERT INTO emergency_alerts (patient_id, alert_type, message, status) VALUES (?, ?, ?, ?)',
                [patient_id, alert_type, alertMessage, 'pending'],
                function(err) {
                    if (err) {
                        console.error('Error saving alert:', err);
                    }
                });

            // Save detection event
            db.run('INSERT INTO detection_events (patient_id, event_type, confidence, details) VALUES (?, ?, ?, ?)',
                [patient_id, alert_type, confidence || 0.0, message || ''],
                function(err) {
                    if (err) {
                        console.error('Error saving detection event:', err);
                    }
                });

            // Log the alert
            console.log('\n🚨🚨🚨 EMERGENCY ALERT DETECTED! 🚨🚨🚨');
            console.log(`   Patient: ${patient.full_name}`);
            console.log(`   Alert Type: ${alert_type}`);
            console.log(`   Confidence: ${confidence || 'N/A'}`);
            console.log(`   Emergency Contact: ${patient.emergency_contact_name} (${patient.emergency_contact_phone})`);
            console.log(`   Caretaker: ${patient.caretaker_name} (${patient.caretaker_phone})`);
            console.log(`   Message: ${alertMessage}`);
            console.log('=' .repeat(50));

            res.json({
                success: true,
                message: 'Emergency alert logged',
                alert: {
                    id: this?.lastID || Date.now(),
                    patient: patient.full_name,
                    contact: patient.emergency_contact_phone,
                    caretaker: patient.caretaker_phone,
                    message: alertMessage
                }
            });
        });
});

// Manual send emergency alert
app.post('/api/send-emergency', authenticateToken, async (req, res) => {
    const { patient_id, message } = req.body;

    if (!patient_id) {
        return res.status(400).json({ error: 'Patient ID required' });
    }

    db.get('SELECT * FROM patients WHERE id = ? AND caretaker_id = ?',
        [patient_id, req.user.id],
        async (err, patient) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            if (!patient) {
                return res.status(404).json({ error: 'Patient not found' });
            }

            const alertMessage = message || `🚨 EMERGENCY ALERT! ${patient.full_name} needs immediate help!`;

            db.run('INSERT INTO emergency_alerts (patient_id, alert_type, message) VALUES (?, ?, ?)',
                [patient_id, 'manual', alertMessage],
                function(err) {
                    if (err) {
                        console.error('Error saving alert:', err);
                    }
                });

            console.log('\n📱 MANUAL EMERGENCY ALERT:');
            console.log(`   Patient: ${patient.full_name}`);
            console.log(`   Contact: ${patient.emergency_contact_name} (${patient.emergency_contact_phone})`);
            console.log(`   Message: ${alertMessage}`);

            res.json({
                message: 'Emergency alert sent successfully',
                alert: {
                    id: Date.now(),
                    patient: patient.full_name,
                    contact: patient.emergency_contact_phone,
                    message: alertMessage
                }
            });
        });
});

// Get alert history
app.get('/api/alerts', authenticateToken, (req, res) => {
    db.all(`SELECT a.*, p.full_name as patient_name 
            FROM emergency_alerts a
            JOIN patients p ON a.patient_id = p.id
            WHERE p.caretaker_id = ?
            ORDER BY a.created_at DESC`,
        [req.user.id],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json(rows);
        });
});

// Get detection events
app.get('/api/detections', authenticateToken, (req, res) => {
    db.all(`SELECT d.*, p.full_name as patient_name 
            FROM detection_events d
            JOIN patients p ON d.patient_id = p.id
            WHERE p.caretaker_id = ?
            ORDER BY d.created_at DESC
            LIMIT 50`,
        [req.user.id],
        (err, rows) => {
            if (err) {
                return res.status(500).json({ error: err.message });
            }
            res.json(rows);
        });
});

// ==================== STATS ROUTES ====================

// Get dashboard stats
app.get('/api/stats', authenticateToken, (req, res) => {
    const stats = {};

    db.get('SELECT COUNT(*) as total FROM patients WHERE caretaker_id = ? AND is_active = 1',
        [req.user.id],
        (err, row) => {
            stats.totalPatients = row ? row.total : 0;

            db.get('SELECT COUNT(*) as total FROM emergency_alerts a JOIN patients p ON a.patient_id = p.id WHERE p.caretaker_id = ?',
                [req.user.id],
                (err, row) => {
                    stats.totalAlerts = row ? row.total : 0;

                    db.get('SELECT COUNT(*) as total FROM emergency_alerts a JOIN patients p ON a.patient_id = p.id WHERE p.caretaker_id = ? AND date(a.created_at) = date("now")',
                        [req.user.id],
                        (err, row) => {
                            stats.todayAlerts = row ? row.total : 0;

                            db.get('SELECT COUNT(*) as total FROM detection_events d JOIN patients p ON d.patient_id = p.id WHERE p.caretaker_id = ? AND date(d.created_at) = date("now")',
                                [req.user.id],
                                (err, row) => {
                                    stats.todayDetections = row ? row.total : 0;
                                    res.json(stats);
                                });
                        });
                });
        });
});

// Serve frontend - catch-all route
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, '../public/index.html'));
});

app.listen(PORT, () => {
    console.log('\n' + '='.repeat(50));
    console.log('🚀 Guardian Net Server Started!');
    console.log('='.repeat(50));
    console.log(`📱 Website: http://localhost:${PORT}`);
    console.log(`🔑 Default login: admin / admin123`);
    console.log(`📡 Detector API: http://localhost:${PORT}/api/detector/alert`);
    console.log('='.repeat(50) + '\n');
});