import { describe, expect, it } from 'vitest';
import { decodeImageDataUrl, sniffImage, StorageService } from './storage.service';

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);

describe('sniffImage', () => {
  it('recognises images by their bytes', () => {
    expect(sniffImage(PNG)).toBe('image/png');
    expect(sniffImage(Buffer.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg');
    expect(sniffImage(Buffer.from('RIFF\0\0\0\0WEBPVP8 ', 'ascii'))).toBe('image/webp');
  });

  it('rejects anything else, including SVG', () => {
    expect(sniffImage(Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'))).toBeNull();
    expect(sniffImage(Buffer.from('%PDF-1.7'))).toBeNull();
  });
});

describe('decodeImageDataUrl', () => {
  it('decodes a canvas export', () => {
    const decoded = decodeImageDataUrl(`data:image/png;base64,${PNG.toString('base64')}`);
    expect(decoded?.type).toBe('image/png');
  });

  it('rejects a data URL whose bytes do not match an image', () => {
    const svg = Buffer.from('<svg/>').toString('base64');
    expect(decodeImageDataUrl(`data:image/png;base64,${svg}`)).toBeNull();
    expect(decodeImageDataUrl(`data:image/svg+xml;base64,${svg}`)).toBeNull();
  });
});

describe('StorageService.isKey', () => {
  it('accepts only server-generated keys', () => {
    expect(StorageService.isKey('designs/2026-09/0199a3c4-5b6e-7f80-9a1b-2c3d4e5f6a7b.jpg')).toBe(true);
    expect(StorageService.isKey('../.env')).toBe(false);
    expect(StorageService.isKey('designs/2026-09/../../secret.jpg')).toBe(false);
  });
});
