package crypto

import (
	"testing"
)

func TestEncryptDecrypt(t *testing.T) {
	secretKey := "super-secure-key-123"
	original := "DATABASE_PASSWORD_p@ssw0rd!"

	encrypted, err := Encrypt(original, secretKey)
	if err != nil {
		t.Fatalf("Encrypt error: %v", err)
	}

	if encrypted == original {
		t.Fatalf("expected encrypted text to differ from original")
	}

	decrypted, err := Decrypt(encrypted, secretKey)
	if err != nil {
		t.Fatalf("Decrypt error: %v", err)
	}

	if decrypted != original {
		t.Fatalf("expected %q, got %q", original, decrypted)
	}
}

func TestDecryptPlaintext(t *testing.T) {
	plaintext := "regular-unencrypted-text"
	decrypted, err := Decrypt(plaintext, "any-key")
	if err != nil {
		t.Fatalf("expected no error for plaintext, got: %v", err)
	}
	if decrypted != plaintext {
		t.Fatalf("expected %q, got %q", plaintext, decrypted)
	}
}
