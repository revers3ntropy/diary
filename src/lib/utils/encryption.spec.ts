import { describe, it, expect } from 'vitest';
import { encrypt, decrypt } from './encryption';

describe('encryption', () => {
    it('encrypts and decrypts', () => {
        const key = 'k'.repeat(32);
        const plaintext = 'plaintext';
        const ciphertext = encrypt(plaintext, key);
        const { err, val } = decrypt(ciphertext, key);
        expect(err).toBe(null);
        expect(val).toBe(plaintext);
    });

    it('encrypts and decrypts empty string', () => {
        const key = 'k'.repeat(32);
        const plaintext = '';
        const ciphertext = encrypt(plaintext, key);
        const { err, val } = decrypt(ciphertext, key);
        expect(err).toBe(null);
        expect(val).toBe(plaintext);
    });

    it('encrypts and decrypts with different keys', () => {
        const key1 = 'k'.repeat(32);
        const key2 = 'l'.repeat(32);
        const plaintext = 'plaintext';
        const ciphertext = encrypt(plaintext, key1);
        const { err, val } = decrypt(ciphertext, key2);
        console.log('ERR:', err, val);
        expect(val).toBeUndefined();
        expect(typeof err).toBe('string');
    });

    it('fails to decrypt random string', () => {
        const key1 = 'k'.repeat(32);
        const ciphertext = 'this is not a valid ciphertext';
        const { err, val } = decrypt(ciphertext, key1);
        expect(val).toBeUndefined();
        expect(typeof err).toBe('string');
    });

    it('decrypts empty ciphertext as empty plaintext', () => {
        const key = 'k'.repeat(32);
        const { err, val } = decrypt('', key);
        expect(err).toBe(null);
        expect(val).toBe('');
    });
});