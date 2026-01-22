import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { setAuthCookie } from '@/lib/auth';

const BACKUP_COOKIE_NAME = 'dinodia_installer_backup_token';

export async function GET() {
  const cookieStore = await cookies();
  const backup = cookieStore.get(BACKUP_COOKIE_NAME)?.value ?? null;
  if (!backup) {
    return NextResponse.json({ ok: true, restored: false });
  }

  await setAuthCookie(backup);
  cookieStore.set(BACKUP_COOKIE_NAME, '', {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
    maxAge: 0,
  });

  return NextResponse.json({ ok: true, restored: true });
}
