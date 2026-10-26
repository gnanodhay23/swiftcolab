const fs = require('fs');
const path = require('path');
const { getClient, pool } = require('./index');

async function runMigrations() {
  const client = await getClient();
  try {
    await client.query('BEGIN');
    await client.query(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        id VARCHAR(255) PRIMARY KEY,
        applied_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
      )
    `);

    const migrationsDir = path.join(__dirname, 'migrations');
    const files = fs.readdirSync(migrationsDir)
      .filter(file => file.endsWith('.sql'))
      .sort();

    for (const file of files) {
      const alreadyApplied = await client.query(
        'SELECT 1 FROM schema_migrations WHERE id = $1',
        [file]
      );
      if (alreadyApplied.rowCount > 0) continue;

      const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (id) VALUES ($1)', [file]);
      console.log(`[DB] Applied migration ${file}`);
    }

    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

if (require.main === module) {
  runMigrations()
    .catch(error => {
      console.error('[DB] Migration failed:', error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await pool?.end();
    });
}

module.exports = { runMigrations };
