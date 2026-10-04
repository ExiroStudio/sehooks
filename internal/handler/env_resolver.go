package handler

import (
	"github.com/script-execution-hooks/internal/db"
	"github.com/script-execution-hooks/internal/executor"
)

// ResolveExecutionEnv merges variables from the linked environment (hook override or script env)
// and script-specific env_vars into a single map.
func ResolveExecutionEnv(database *db.DB, hook *db.Hook, script *db.Script) map[string]string {
	envVars := make(map[string]string)

	var envID *int64
	if hook != nil && hook.EnvID != nil {
		envID = hook.EnvID
	} else if script != nil && script.EnvID != nil {
		envID = script.EnvID
	}

	if envID != nil {
		if env, err := database.GetEnvironmentByID(*envID); err == nil && env != nil {
			for _, item := range env.Variables {
				if item.Key != "" {
					envVars[item.Key] = item.Value
				}
			}
		}
	}

	if script != nil && script.EnvVars != "" {
		if scriptVars, err := executor.ParseEnvVars(script.EnvVars); err == nil {
			for k, v := range scriptVars {
				envVars[k] = v
			}
		}
	}

	return envVars
}
