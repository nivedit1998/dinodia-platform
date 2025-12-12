import { NextRequest, NextResponse } from 'next/server';
import { authenticateWithCredentials, createSessionForUser, clearAuthCookie } from '@/lib/auth';

export async function POST(req: NextRequest) {
  try {
    const { username, password } = await req.json();

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Please enter both a username and password.' },
        { status: 400 }
      );
    }

    const user = await authenticateWithCredentials(username, password);
    if (!user) {
      return NextResponse.json(
        { error: 'Those details don’t match any Dinodia account.' },
        { status: 401 }
      );
    }

    await createSessionForUser(user);

    return NextResponse.json({ ok: true, role: user.role });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: 'We couldn’t log you in right now. Please try again in a moment.' },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  await clearAuthCookie();
  return NextResponse.json({ ok: true });
}
