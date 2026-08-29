/**
 * Team Sharing Encryption Utilities
 *
 * Uses Web Crypto API for AES-256-GCM encryption
 * - AES-256-GCM provides authenticated encryption
 * - PBKDF2 for key derivation from password
 */

export interface EncryptedData {
  ciphertext: string // Base64 encoded
  iv: string // Base64 encoded
  salt: string // Base64 encoded
}

/**
 * Derive encryption key from password using PBKDF2
 */
async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const encoder = new TextEncoder()
  const passwordBuffer = encoder.encode(password)

  // Import password as key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    passwordBuffer,
    'PBKDF2',
    false,
    ['deriveKey'],
  )

  // Derive AES-256 key using PBKDF2
  return await crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt.buffer as ArrayBuffer,
      iterations: 100000, // OWASP recommended minimum
      hash: 'SHA-256',
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/**
 * Encrypt data with a password
 * Returns encrypted data with IV and salt for decryption
 */
export async function encryptWithPassword(
  data: string,
  password: string,
): Promise<EncryptedData> {
  const encoder = new TextEncoder()
  const dataBuffer = encoder.encode(data)

  // Generate random IV (12 bytes for GCM)
  const iv = crypto.getRandomValues(new Uint8Array(12))

  // Generate random salt (16 bytes)
  const salt = crypto.getRandomValues(new Uint8Array(16))

  // Derive key from password
  const key = await deriveKey(password, salt)

  // Encrypt with AES-GCM
  const ciphertext = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    dataBuffer,
  )

  // Convert to base64
  return {
    ciphertext: arrayBufferToBase64(ciphertext),
    iv: arrayBufferToBase64(iv),
    salt: arrayBufferToBase64(salt),
  }
}

/**
 * Decrypt data with a password
 */
export async function decryptWithPassword(
  encrypted: EncryptedData,
  password: string,
): Promise<string> {
  const iv = base64ToArrayBuffer(encrypted.iv)
  const salt = base64ToArrayBuffer(encrypted.salt)
  const ciphertext = base64ToArrayBuffer(encrypted.ciphertext)

  // Derive key from password
  const key = await deriveKey(password, new Uint8Array(salt))

  // Decrypt with AES-GCM
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: new Uint8Array(iv) },
    key,
    ciphertext as ArrayBuffer,
  )

  const decoder = new TextDecoder()
  return decoder.decode(decrypted)
}

/**
 * Check if a string is encrypted data
 */
export function isEncryptedData(value: unknown): value is EncryptedData {
  if (typeof value !== 'object' || value === null) return false
  const obj = value as Record<string, unknown>
  return (
    typeof obj.ciphertext === 'string' &&
    typeof obj.iv === 'string' &&
    typeof obj.salt === 'string'
  )
}

// Helper functions
function arrayBufferToBase64(buffer: ArrayBuffer | Uint8Array): string {
  const bytes = buffer instanceof Uint8Array ? buffer : new Uint8Array(buffer)
  let binary = ''
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i])
  }
  return btoa(binary)
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i)
  }
  return bytes.buffer as ArrayBuffer
}

/**
 * Validate password strength
 */
export function validatePasswordStrength(password: string): {
  valid: boolean
  message: string
} {
  if (password.length < 8) {
    return { valid: false, message: 'Password must be at least 8 characters' }
  }
  if (!/[A-Z]/.test(password)) {
    return {
      valid: false,
      message: 'Password must contain at least one uppercase letter',
    }
  }
  if (!/[a-z]/.test(password)) {
    return {
      valid: false,
      message: 'Password must contain at least one lowercase letter',
    }
  }
  if (!/\d/.test(password)) {
    return {
      valid: false,
      message: 'Password must contain at least one number',
    }
  }
  return { valid: true, message: 'Password is strong enough' }
}
