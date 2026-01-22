'use client';

export async function logout() {
  try {
    const res = await fetch('/api/auth/logout', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      cache: 'no-store',
    });
    const data = await res.json().catch(() => null);
    if (data?.restoredInstaller) {
      window.location.href = '/installer/HomeSupport';
      return;
    }
  } catch (err) {
    console.error('Failed to logout', err);
  } finally {
    window.location.href = '/login';
  }
}
