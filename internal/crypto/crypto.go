package crypto

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"errors"
	"io"
	"strings"
)

const encPrefix = "enc:"

// DeriveKey derives a 32-byte AES-256 key from a passphrase using SHA-256
func DeriveKey(passphrase string) []byte {
	h := sha256.Sum256([]byte(passphrase))
	return h[:]
}

// Encrypt encrypts plaintext string using AES-256-GCM with the derived key.
// Returns a base64 encoded string prefixed with "enc:"
func Encrypt(plaintext, secretKey string) (string, error) {
	if plaintext == "" {
		return "", nil
	}
	key := DeriveKey(secretKey)
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonce := make([]byte, gcm.NonceSize())
	if _, err := io.ReadFull(rand.Reader, nonce); err != nil {
		return "", err
	}

	ciphertext := gcm.Seal(nonce, nonce, []byte(plaintext), nil)
	return encPrefix + base64.StdEncoding.EncodeToString(ciphertext), nil
}

// Decrypt decrypts an "enc:" prefixed base64 string using AES-256-GCM.
// If the text does not start with "enc:", it returns the text as-is.
func Decrypt(ciphertext, secretKey string) (string, error) {
	if !strings.HasPrefix(ciphertext, encPrefix) {
		return ciphertext, nil
	}

	rawB64 := strings.TrimPrefix(ciphertext, encPrefix)
	data, err := base64.StdEncoding.DecodeString(rawB64)
	if err != nil {
		return "", err
	}

	key := DeriveKey(secretKey)
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}

	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return "", err
	}

	nonceSize := gcm.NonceSize()
	if len(data) < nonceSize {
		return "", errors.New("ciphertext too short")
	}

	nonce, encrypted := data[:nonceSize], data[nonceSize:]
	plaintext, err := gcm.Open(nil, nonce, encrypted, nil)
	if err != nil {
		return "", err
	}

	return string(plaintext), nil
}
