package db

import "time"

// Hook represents a webhook endpoint definition
type Hook struct {
	ID          int64     `json:"id"`
	Name        string    `json:"name"`
	Slug        string    `json:"slug"`
	SecretToken string    `json:"secret_token"`
	ScriptID    *int64    `json:"script_id"`
	Description string    `json:"description"`
	Enabled     bool      `json:"enabled"`
	CreatedAt   time.Time `json:"created_at"`
	UpdatedAt   time.Time `json:"updated_at"`
	// Joined
	ScriptName string `json:"script_name,omitempty"`
}

// Script represents a stored shell script
type Script struct {
	ID             int64     `json:"id"`
	Name           string    `json:"name"`
	Description    string    `json:"description"`
	Content        string    `json:"content"`
	TimeoutSeconds int       `json:"timeout_seconds"`
	EnvVars        string    `json:"env_vars"` // JSON string: {"KEY":"VAL"}
	WorkingDir     string    `json:"working_dir"`
	CreatedAt      time.Time `json:"created_at"`
	UpdatedAt      time.Time `json:"updated_at"`
}

// ExecutionLog represents a single hook execution record
type ExecutionLog struct {
	ID         int64     `json:"id"`
	HookID     int64     `json:"hook_id"`
	ScriptID   *int64    `json:"script_id"`
	TriggerIP  string    `json:"trigger_ip"`
	ExitCode   *int      `json:"exit_code"`
	Stdout     string    `json:"stdout"`
	Stderr     string    `json:"stderr"`
	DurationMs int64     `json:"duration_ms"`
	Status     string    `json:"status"` // running, success, failed, timeout
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
