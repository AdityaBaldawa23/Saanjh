import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import jwt from 'jsonwebtoken';
import type { Request, Response, NextFunction } from 'express';
import { one, now } from './db.ts';
import { AppError, conflict } from './services/common.ts';
import { ensureWallet } from './credits.ts';

let secret: string | null = null;
function getSecret() {
  if (secret) return secret;
  if (process.env.JWT_SECRET) return (secret = process.env.JWT_SECRET);
  if (process.env.VERCEL || process.env.NODE_ENV === 'production')
    throw new AppError(500, 'config', 'Server is missing the JWT_SECRET environment variable.');
  // Local development: generate once and keep it in server/data
  const dir = fileURLToPath(new URL('../data/', import.meta.url));
  const file = dir + '.jwt-secret';
  mkdirSync(dir, { recursive: true });
  if (!existsSync(file)) writeFileSync(file, randomBytes(48).toString('hex'));
  return (secret = readFileSync(file, 'utf8'));
}
const COOKIE = 'saanjha_session';
const MAX_AGE = 30 * 86_400_000;

export function hashPassword(pw: string) {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(pw, salt, 64).toString('hex')}`;
}
export function verifyPassword(pw: string, stored: string) {
  const [salt, hash] = stored.split(':');
  const a = Buffer.from(hash, 'hex');
  const b = scryptSync(pw, Buffer.from(salt, 'hex'), 64);
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function registerUser(name: string, email: string, password: string) {
  const e = email.trim().toLowerCase();
  if (await one('SELECT 1 FROM users WHERE email = ?', e)) throw conflict('An account with this email already exists. Try signing in.');
  const { id } = (await one<{ id: number }>('INSERT INTO users (name, email, password_hash, created_at) VALUES (?,?,?,?) RETURNING id',
    name.trim(), e, hashPassword(password), now()))!;
  await ensureWallet(id);
  return id;
}

export async function loginUser(email: string, password: string) {
  const u = await one<{ id: number; password_hash: string }>('SELECT id, password_hash FROM users WHERE email = ?', email.trim().toLowerCase());
  if (!u || !verifyPassword(password, u.password_hash)) throw new AppError(401, 'invalid_credentials', 'Incorrect email or password.');
  return u.id;
}

export async function setSession(res: Response, userId: number) {
  const u = (await one<{ created_at: number }>('SELECT created_at FROM users WHERE id = ?', userId))!;
  // Bound to the account's creation time, so a re-seeded database never maps an old cookie to a different person.
  const token = jwt.sign({ sub: userId, ca: u.created_at }, getSecret(), { expiresIn: '30d' });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', maxAge: MAX_AGE, path: '/' });
}
export const clearSession = (res: Response) => res.clearCookie(COOKIE, { path: '/' });

declare global {
  namespace Express { interface Request { userId?: number } }
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  const token = req.cookies?.[COOKIE];
  if (!token) return next(new AppError(401, 'unauthenticated', 'Please sign in.'));
  let payload: { sub: number; ca: number };
  try {
    payload = jwt.verify(token, getSecret()) as unknown as { sub: number; ca: number };
  } catch (e) {
    if (e instanceof AppError) return next(e);
    return next(new AppError(401, 'unauthenticated', 'Your session has expired. Please sign in again.'));
  }
  try {
    if (!(await one('SELECT 1 FROM users WHERE id = ? AND created_at = ?', payload.sub, payload.ca)))
      return next(new AppError(401, 'unauthenticated', 'Your session has expired. Please sign in again.'));
    req.userId = Number(payload.sub);
    next();
  } catch (e) { next(e); }
}
