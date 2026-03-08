const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');

// Database path
const dbPath = path.join(__dirname, '../data/guardian_net.db');

// Create database connection
const db = new sqlite3.Database(dbPath);

// Initialize database tables
function initializeDatabase() {
    db.serialize(() => {
        // Caretakers table
        db.run(`CREATE TABLE IF NOT EXISTS caretakers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE,
            password TEXT,
            full_name TEXT,
            email TEXT UNIQUE,
            phone TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )`);

        // Patients table
        db.run(`CREATE TABLE IF NOT EXISTS patients (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            caretaker_id INTEGER,
            full_name TEXT,
            age INTEGER,
            gender TEXT,
            medical_conditions TEXT,
            emergency_contact_name TEXT,
            emergency_contact_phone TEXT,
            emergency_contact_relation TEXT,
            address TEXT,
            is_active INTEGER DEFAULT 1,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (caretaker_id) REFERENCES caretakers(id)
        )`);

        // Emergency alerts table
        db.run(`CREATE TABLE IF NOT EXISTS emergency_alerts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER,
            alert_type TEXT,
            message TEXT,
            status TEXT DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            resolved_at DATETIME,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        )`);

        // Detection events table
        db.run(`CREATE TABLE IF NOT EXISTS detection_events (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            patient_id INTEGER,
            event_type TEXT,
            confidence REAL,
            details TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            FOREIGN KEY (patient_id) REFERENCES patients(id)
        )`);

        // Create default admin if not exists
        db.get('SELECT * FROM caretakers WHERE username = ?', ['admin'], (err, row) => {
            if (!row) {
                const hashedPassword = bcrypt.hashSync('admin123', 10);
                db.run('INSERT INTO caretakers (username, password, full_name, email, phone) VALUES (?, ?, ?, ?, ?)',
                    ['admin', hashedPassword, 'System Administrator', 'admin@guardian.net', '+1234567890']);
                console.log('✅ Default admin created');
            }
        });

        console.log('✅ Database initialized');
    });
}

// Initialize on load
initializeDatabase();

module.exports = db;