import { NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';

export async function GET() {
  const me = await getCurrentUser();
  if (!me || (me.role !== Role.TENANT && me.role !== Role.ADMIN)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { haConnection } = await getUserWithHaConnection(me.id);
    const supportsHoliday = Boolean(
      haConnection.cloudUrl && haConnection.cloudUrl.trim().length > 0
    );
    return NextResponse.json({ supportsHoliday });
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'HA connection not configured' },
      { status: 400 }
    );
  }
}
