/**
 * Photo storage. With BLOB_READ_WRITE_TOKEN set (Vercel Blob) photos go to the cloud;
 * otherwise they are written to server/uploads and served by Express (local development).
 */
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

export const UPLOAD_DIR = fileURLToPath(new URL('../uploads/', import.meta.url));
export const usingBlob = () => !!process.env.BLOB_READ_WRITE_TOKEN;

const EXT: Record<string, string> = { 'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/heic': '.heic', 'image/heif': '.heif' };

export async function saveImage(buf: Buffer, mimetype: string): Promise<string> {
  const name = `${Date.now()}-${randomBytes(8).toString('hex')}${EXT[mimetype] ?? '.jpg'}`;
  if (usingBlob()) {
    const { put } = await import('@vercel/blob');
    const blob = await put(`photos/${name}`, buf, { access: 'public', contentType: mimetype, addRandomSuffix: false });
    return blob.url;
  }
  mkdirSync(UPLOAD_DIR, { recursive: true });
  writeFileSync(UPLOAD_DIR + name, buf);
  return `/uploads/${name}`;
}

/** Only photos we stored ourselves are accepted in listings and profiles. */
export const PHOTO_URL = /^(\/uploads\/[\w.-]+|https:\/\/[a-z0-9-]+\.public\.blob\.vercel-storage\.com\/[\w./-]+)$/;
