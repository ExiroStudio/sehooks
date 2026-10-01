package db

import (
	"database/sql"
	"fmt"
	"log"
	"time"

	_ "modernc.org/sqlite"
)

// DB wraps the sql.DB connection
type DB struct {
	conn *sql.DB
}

// New opens a SQLite connection and runs migrations
func New(path string) (*DB, error) {
	conn, err := sql.Open("sqlite", path+"?_journal_mode=WAL&_busy_timeout=5000&_foreign_keys=on")
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}
	conn.SetMaxOpenConns(1) // SQLite is single-writer
	d := &DB{conn: conn}
	if err := d.migrate(); err != nil {
		return nil, fmt.Errorf("migrate: %w", err)
	}
	_ = d.RecoverStaleLogs()
	return d, nil
}

// Close closes the database connection
func (d *DB) Close() error {
	return d.conn.Close()
}

func (d *DB) migrate() error {
	schema := `
	CREATE TABLE IF NOT EXISTS scripts (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		description TEXT DEFAULT '',
		content TEXT NOT NULL DEFAULT '',
		timeout_seconds INTEGER DEFAULT 30,
		env_vars TEXT DEFAULT '{}',
		working_dir TEXT DEFAULT '/tmp',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS hooks (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		name TEXT NOT NULL,
		slug TEXT UNIQUE NOT NULL,
		secret_token TEXT NOT NULL,
		script_id INTEGER REFERENCES scripts(id) ON DELETE SET NULL,
		description TEXT DEFAULT '',
		enabled INTEGER DEFAULT 1,
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS execution_logs (
		id INTEGER PRIMARY KEY AUTOINCREMENT,
		hook_id INTEGER REFERENCES hooks(id) ON DELETE CASCADE,
		script_id INTEGER REFERENCES scripts(id) ON DELETE SET NULL,
		trigger_ip TEXT DEFAULT '',
		exit_code INTEGER,
		stdout TEXT DEFAULT '',
		stderr TEXT DEFAULT '',
		duration_ms INTEGER DEFAULT 0,
		status TEXT DEFAULT 'running',
		payload TEXT DEFAULT '',
		created_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE TABLE IF NOT EXISTS app_config (
		key TEXT PRIMARY KEY,
		value TEXT NOT NULL DEFAULT '',
		updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
	);

	CREATE INDEX IF NOT EXISTS idx_execution_logs_hook_id ON execution_logs(hook_id);
	CREATE INDEX IF NOT EXISTS idx_execution_logs_created_at ON execution_logs(created_at DESC);
	`
	if _, err := d.conn.Exec(schema); err != nil {
		return err
	}

	// Migrate execution_logs if hook_id is NOT NULL or if payload column is missing
	var notNull int
	row := d.conn.QueryRow(`SELECT "notnull" FROM pragma_table_info('execution_logs') WHERE name = 'hook_id'`)
	if err := row.Scan(&notNull); err == nil && notNull == 1 {
		_, _ = d.conn.Exec(`
			PRAGMA foreign_keys=off;
			CREATE TABLE IF NOT EXISTS execution_logs_new (
				id INTEGER PRIMARY KEY AUTOINCREMENT,
				hook_id INTEGER REFERENCES hooks(id) ON DELETE CASCADE,
				script_id INTEGER REFERENCES scripts(id) ON DELETE SET NULL,
				trigger_ip TEXT DEFAULT '',
				exit_code INTEGER,
				stdout TEXT DEFAULT '',
				stderr TEXT DEFAULT '',
				duration_ms INTEGER DEFAULT 0,
				status TEXT DEFAULT 'running',
				payload TEXT DEFAULT '',
				created_at DATETIME DEFAULT CURRENT_TIMESTAMP
			);
			INSERT INTO execution_logs_new(id, hook_id, script_id, trigger_ip, exit_code, stdout, stderr, duration_ms, status, created_at)
			SELECT id, hook_id, script_id, trigger_ip, exit_code, stdout, stderr, duration_ms, status, created_at FROM execution_logs;
			DROP TABLE execution_logs;
			ALTER TABLE execution_logs_new RENAME TO execution_logs;
			CREATE INDEX IF NOT EXISTS idx_execution_logs_hook_id ON execution_logs(hook_id);
			CREATE INDEX IF NOT EXISTS idx_execution_logs_created_at ON execution_logs(created_at DESC);
			PRAGMA foreign_keys=on;
		`)
	} else {
		_, _ = d.conn.Exec(`ALTER TABLE execution_logs ADD COLUMN payload TEXT DEFAULT ''`)
	}

	// Seed default config
	defaults := map[string]string{
		"max_concurrent_executions": "5",
		"log_retention_days":        "30",
		"allow_concurrent_hooks":    "true",
	}
	for k, v := range defaults {
		if _, err := d.conn.Exec(`INSERT OR IGNORE INTO app_config(key, value) VALUES(?,?)`, k, v); err != nil {
			log.Printf("seed config %s: %v", k, err)
		}
	}
	return nil
}

// ─── Hooks ───────────────────────────────────────────────────────────────────

func (d *DB) ListHooks() ([]Hook, error) {
	rows, err := d.conn.Query(`
		SELECT h.id, h.name, h.slug, h.secret_token, h.script_id, h.description,
		       h.enabled, h.created_at, h.updated_at, COALESCE(s.name,'') as script_name
		FROM hooks h
		LEFT JOIN scripts s ON s.id = h.script_id
		ORDER BY h.created_at DESC
	`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var hooks []Hook
	for rows.Next() {
		var h Hook
		var enabled int
		if err := rows.Scan(&h.ID, &h.Name, &h.Slug, &h.SecretToken, &h.ScriptID, &h.Description,
			&enabled, &h.CreatedAt, &h.UpdatedAt, &h.ScriptName); err != nil {
			return nil, err
		}
		h.Enabled = enabled == 1
		hooks = append(hooks, h)
	}
	return hooks, nil
}

func (d *DB) GetHookByID(id int64) (*Hook, error) {
	row := d.conn.QueryRow(`
		SELECT h.id, h.name, h.slug, h.secret_token, h.script_id, h.description,
		       h.enabled, h.created_at, h.updated_at, COALESCE(s.name,'') as script_name
		FROM hooks h
		LEFT JOIN scripts s ON s.id = h.script_id
		WHERE h.id = ?`, id)
	return scanHook(row)
}

func (d *DB) GetHookByToken(token string) (*Hook, error) {
	row := d.conn.QueryRow(`
		SELECT h.id, h.name, h.slug, h.secret_token, h.script_id, h.description,
		       h.enabled, h.created_at, h.updated_at, COALESCE(s.name,'') as script_name
		FROM hooks h
		LEFT JOIN scripts s ON s.id = h.script_id
		WHERE h.secret_token = ? AND h.enabled = 1`, token)
	return scanHook(row)
}

func scanHook(row *sql.Row) (*Hook, error) {
	var h Hook
	var enabled int
	err := row.Scan(&h.ID, &h.Name, &h.Slug, &h.SecretToken, &h.ScriptID, &h.Description,
		&enabled, &h.CreatedAt, &h.UpdatedAt, &h.ScriptName)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	h.Enabled = enabled == 1
	return &h, nil
}

func (d *DB) CreateHook(h *Hook) (int64, error) {
	res, err := d.conn.Exec(`
		INSERT INTO hooks(name, slug, secret_token, script_id, description, enabled)
		VALUES(?,?,?,?,?,?)`,
		h.Name, h.Slug, h.SecretToken, h.ScriptID, h.Description, boolInt(h.Enabled))
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (d *DB) UpdateHook(h *Hook) error {
	_, err := d.conn.Exec(`
		UPDATE hooks SET name=?, slug=?, script_id=?, description=?, enabled=?, updated_at=CURRENT_TIMESTAMP
		WHERE id=?`,
		h.Name, h.Slug, h.ScriptID, h.Description, boolInt(h.Enabled), h.ID)
	return err
}

func (d *DB) DeleteHook(id int64) error {
	_, err := d.conn.Exec(`DELETE FROM hooks WHERE id=?`, id)
	return err
}

func (d *DB) RegenToken(id int64, token string) error {
	_, err := d.conn.Exec(`UPDATE hooks SET secret_token=?, updated_at=CURRENT_TIMESTAMP WHERE id=?`, token, id)
	return err
}

// ─── Scripts ─────────────────────────────────────────────────────────────────

func (d *DB) ListScripts() ([]Script, error) {
	rows, err := d.conn.Query(`SELECT id, name, description, content, timeout_seconds, env_vars, working_dir, created_at, updated_at FROM scripts ORDER BY created_at DESC`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var scripts []Script
	for rows.Next() {
		var s Script
		if err := rows.Scan(&s.ID, &s.Name, &s.Description, &s.Content, &s.TimeoutSeconds, &s.EnvVars, &s.WorkingDir, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		scripts = append(scripts, s)
	}
	return scripts, nil
}

func (d *DB) GetScriptByID(id int64) (*Script, error) {
	row := d.conn.QueryRow(`SELECT id, name, description, content, timeout_seconds, env_vars, working_dir, created_at, updated_at FROM scripts WHERE id=?`, id)
	var s Script
	err := row.Scan(&s.ID, &s.Name, &s.Description, &s.Content, &s.TimeoutSeconds, &s.EnvVars, &s.WorkingDir, &s.CreatedAt, &s.UpdatedAt)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	return &s, err
}

func (d *DB) CreateScript(s *Script) (int64, error) {
	res, err := d.conn.Exec(`
		INSERT INTO scripts(name, description, content, timeout_seconds, env_vars, working_dir)
		VALUES(?,?,?,?,?,?)`,
		s.Name, s.Description, s.Content, s.TimeoutSeconds, s.EnvVars, s.WorkingDir)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (d *DB) UpdateScript(s *Script) error {
	_, err := d.conn.Exec(`
		UPDATE scripts SET name=?, description=?, content=?, timeout_seconds=?, env_vars=?, working_dir=?, updated_at=CURRENT_TIMESTAMP
		WHERE id=?`,
		s.Name, s.Description, s.Content, s.TimeoutSeconds, s.EnvVars, s.WorkingDir, s.ID)
	return err
}

func (d *DB) DeleteScript(id int64) error {
	_, err := d.conn.Exec(`DELETE FROM scripts WHERE id=?`, id)
	return err
}

// ─── Execution Logs ──────────────────────────────────────────────────────────

func (d *DB) CreateLog(l *ExecutionLog) (int64, error) {
	res, err := d.conn.Exec(`
		INSERT INTO execution_logs(hook_id, script_id, trigger_ip, status, payload)
		VALUES(?,?,?,?,?)`,
		l.HookID, l.ScriptID, l.TriggerIP, l.Status, l.Payload)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (d *DB) UpdateLog(id int64, exitCode *int, stdout, stderr string, durationMs int64, status string) error {
	_, err := d.conn.Exec(`
		UPDATE execution_logs SET exit_code=?, stdout=?, stderr=?, duration_ms=?, status=?
		WHERE id=?`,
		exitCode, stdout, stderr, durationMs, status, id)
	return err
}

func (d *DB) ListLogsFiltered(hookID int64, status, search string, limit, offset int) ([]ExecutionLog, error) {
	query := `
		SELECT l.id, l.hook_id, l.script_id, l.trigger_ip, l.exit_code, l.stdout, l.stderr, l.duration_ms, l.status, COALESCE(l.payload,''), l.created_at,
		       COALESCE(h.name,'Manual / Test') as hook_name, COALESCE(s.name,'') as script_name
		FROM execution_logs l
		LEFT JOIN hooks h ON h.id = l.hook_id
		LEFT JOIN scripts s ON s.id = l.script_id
		WHERE 1=1
	`
	var args []any
	if hookID > 0 {
		query += " AND l.hook_id = ?"
		args = append(args, hookID)
	}
	if status != "" && status != "all" {
		query += " AND l.status = ?"
		args = append(args, status)
	}
	if search != "" {
		query += " AND (COALESCE(h.name,'') LIKE ? OR COALESCE(s.name,'') LIKE ? OR l.trigger_ip LIKE ? OR l.stdout LIKE ? OR l.stderr LIKE ?)"
		term := "%" + search + "%"
		args = append(args, term, term, term, term, term)
	}
	query += " ORDER BY l.created_at DESC LIMIT ? OFFSET ?"
	args = append(args, limit, offset)

	rows, err := d.conn.Query(query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	return scanLogs(rows)
}

func (d *DB) ListLogs(limit, offset int) ([]ExecutionLog, error) {
	return d.ListLogsFiltered(0, "", "", limit, offset)
}

func (d *DB) ListLogsByHook(hookID int64, limit, offset int) ([]ExecutionLog, error) {
	return d.ListLogsFiltered(hookID, "", "", limit, offset)
}

func scanLogs(rows *sql.Rows) ([]ExecutionLog, error) {
	var logs []ExecutionLog
	for rows.Next() {
		var l ExecutionLog
		if err := rows.Scan(&l.ID, &l.HookID, &l.ScriptID, &l.TriggerIP, &l.ExitCode,
			&l.Stdout, &l.Stderr, &l.DurationMs, &l.Status, &l.Payload, &l.CreatedAt,
			&l.HookName, &l.ScriptName); err != nil {
			return nil, err
		}
		logs = append(logs, l)
	}
	return logs, nil
}

func (d *DB) DeleteLog(id int64) error {
	_, err := d.conn.Exec(`DELETE FROM execution_logs WHERE id=?`, id)
	return err
}

func (d *DB) ClearAllLogs() error {
	_, err := d.conn.Exec(`DELETE FROM execution_logs`)
	return err
}

func (d *DB) RecoverStaleLogs() error {
	_, err := d.conn.Exec(`
		UPDATE execution_logs 
		SET status = 'interrupted', 
		    stderr = CASE WHEN stderr = '' THEN '[ABORTED: server restarted or process interrupted]' ELSE stderr || char(10) || '[ABORTED: server restarted or process interrupted]' END
		WHERE status = 'running'
	`)
	return err
}

func (d *DB) PurgeOldLogs(retentionDays int) error {
	cutoff := time.Now().AddDate(0, 0, -retentionDays).Format("2006-01-02")
	_, err := d.conn.Exec(`DELETE FROM execution_logs WHERE created_at < ?`, cutoff)
	return err
}

// ─── Config ──────────────────────────────────────────────────────────────────

func (d *DB) GetAllConfig() (map[string]string, error) {
	rows, err := d.conn.Query(`SELECT key, value FROM app_config`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	cfg := make(map[string]string)
	for rows.Next() {
		var k, v string
		if err := rows.Scan(&k, &v); err != nil {
			return nil, err
		}
		cfg[k] = v
	}
	return cfg, nil
}

func (d *DB) SetConfig(key, value string) error {
	_, err := d.conn.Exec(`INSERT OR REPLACE INTO app_config(key, value, updated_at) VALUES(?,?,CURRENT_TIMESTAMP)`, key, value)
	return err
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

func boolInt(b bool) int {
	if b {
		return 1
	}
	return 0
}
