const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '.env') });

const { Pool } = require('pg');

// Disable SSL verification
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.error('❌ DATABASE_URL not set in .env file');
  process.exit(1);
}

console.log('📡 Connection string:', connectionString.substring(0, 50) + '...');

// Parse connection string manually
// Format: postgresql://user:password@host:port/database?params
const url = new URL(connectionString);

const pool = new Pool({
  user: url.username,
  password: decodeURIComponent(url.password),
  host: url.hostname,
  port: url.port || 5432,
  database: url.pathname.slice(1),
  ssl: { rejectUnauthorized: false, require: true },
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

async function retrieveUsers() {
  try {
    console.log('📡 Attempting connection...\n');
    const result = await pool.query(
      'SELECT id, email, name, created_at, is_active, is_verified FROM users ORDER BY created_at DESC'
    );
    
    console.log('\n✅ Successfully connected!\n');
    console.log('=== Existing Users in Database ===\n');
    console.log('Total users:', result.rows.length);
    
    if (result.rows.length > 0) {
      console.log('\nUser Details:');
      console.table(result.rows);
    } else {
      console.log('\n⚠️  No users found in the database.');
    }
    
  } catch (error) {
    console.error('❌ Error retrieving users:', error.message);
    console.error('Details:', error);
  } finally {
    await pool.end();
  }
}

retrieveUsers();
