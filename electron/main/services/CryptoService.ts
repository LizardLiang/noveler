import { safeStorage } from 'electron';

class CryptoService {
  encrypt(plaintext: string): Buffer {
    if (!safeStorage.isEncryptionAvailable()) {
      // Fallback: store as base64 if encryption not available (dev environment)
      return Buffer.from(Buffer.from(plaintext).toString('base64'));
    }
    return safeStorage.encryptString(plaintext);
  }

  decrypt(encrypted: Buffer): string {
    if (!safeStorage.isEncryptionAvailable()) {
      // Fallback: decode base64
      return Buffer.from(encrypted.toString(), 'base64').toString('utf-8');
    }
    try {
      return safeStorage.decryptString(encrypted);
    } catch {
      // If decryption fails (e.g., key rotation), return empty string
      return '';
    }
  }

  isAvailable(): boolean {
    return safeStorage.isEncryptionAvailable();
  }
}

let instance: CryptoService | null = null;

export function getCryptoService(): CryptoService {
  if (!instance) {
    instance = new CryptoService();
  }
  return instance;
}

export { CryptoService };
