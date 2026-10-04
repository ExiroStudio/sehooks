package db

import "time"

// EnvVarItem represents a key-value environment variable item
type EnvVarItem struct {
	Key      string `json:"key"`
	Value    string `json:"value"`
	IsSecret bool   `json:"is_secret"`
}

// Environment represents a stored collection of environment variables
type Environment struct {
	ID          int64        `json:"id"`
	Name        string       `json:"name"`
	Description string       `json:"description"`
	Variables   []EnvVarItem `json:"variables"`
	CreatedAt   time.Time    `json:"created_at"`
	UpdatedAt   time.Time    `json:"updated_at"`
}

// Hook represents a webhook endpoint definition
type Hook struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Slug        string    `json:"slug"`
	SecretToken string    `json:"secret_token"`
	ScriptID    *int64    `json:"script_id"`
	EnvID       *int64    `json:"env_id"`
	Description string    `json:"description"`
	Enabled     bool      `json:"enabled"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	// Joined
	ScriptName string `json:"script_name,omitempty"`
	EnvName    string `json:"env_name,omitempty"`
}

// ScriptFile represents an auxiliary file stored for a script (e.g. nginx.conf, Dockerfile)
type ScriptFile struct {
	ID        int64     `json:"id"`
	ScriptID  int64     `json:"script_id"`
	Path      string    `json:"path"`
	Content   string    `json:"content"`
	CreatedAt time.Time `json:"created_at"`
	UpdatedAt time.Time `json:"updated_at"`
}

// Script represents a stored shell script or docker compose project
type Script struct {
	ID             int64        `json:"id"`
	Name           string       `json:"name"`
	Description    string       `json:"description"`
	ScriptType     string       `json:"script_type"` // "bash" (default) or "docker_compose"
	Content        string       `json:"content"`     // Bash script or docker-compose.yml
	ComposeCmd     string       `json:"compose_cmd"` // Custom compose command (e.g. docker compose up -d)
	TimeoutSeconds int          `json:"timeout_seconds"`
	EnvVars        string       `json:"env_vars"` // JSON string: {"KEY":"VAL"}
	EnvID          *int64       `json:"env_id"`
	WorkingDir     string       `json:"working_dir"`
	CreatedAt      time.Time    `json:"created_at"`
	UpdatedAt      time.Time    `json:"updated_at"`
	// Joined
	EnvName string       `json:"env_name,omitempty"`
	Files   []ScriptFile `json:"files,omitempty"`
}

// ExecutionLog represents a single hook execution record
type ExecutionLog struct {
	ID         int64     `json:"id"`
	HookID     *int64    `json:"hook_id"`
	ScriptID   *int64    `json:"script_id"`
	TriggerIP  string    `json:"trigger_ip"`
	ExitCode   *int      `json:"exit_code"`
	Stdout     string    `json:"stdout"`
	Stderr     string    `json:"stderr"`
	DurationMs int64     `json:"duration_ms"`
	Status     string    `json:"status"` // running, success, failed, timeout, interrupted
	Payload    string    `json:"payload"`
	CreatedAt  time.Time `json:"created_at"`
	// Joined
	HookName   string `json:"hook_name,omitempty"`
	ScriptName string `json:"script_name,omitempty"`
}

// AppConfig represents a key-value config entry
type AppConfig struct {
	Key       string    `json:"key"`
	Value     string    `json:"value"`
	UpdatedAt time.Time `json:"updated_at"`
}
