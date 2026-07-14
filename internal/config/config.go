package config

import (
	"os"
	"strconv"
)

// Config holds all runtime configuration
type Config struct {
	Host         string
	Port         int
	DatabasePath string
	AdminPassword string
	SecretKey    string
}

// Load reads config from environment variables with sensible defaults
func Load() *Config {
	return &Config{
		Host:          getEnv("SEH_HOST", "0.0.0.0"),
		Port:          getEnvInt("SEH_PORT", 8080),
		DatabasePath:  getEnv("SEH_DB_PATH", "./hooks.db"),
		AdminPassword: getEnv("SEH_ADMIN_PASSWORD", "admin"),
		SecretKey:     getEnv("SEH_SECRET_KEY", "change-me-in-production"),
	}
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getEnvInt(key string, fallback int) int {
	if v := os.Getenv(key); v != "" {
		if i, err := strconv.Atoi(v); err == nil {
			return i
		}
	}
	return fallback
}
