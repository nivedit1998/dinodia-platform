import { NextRequest, NextResponse } from 'next/server';
import { Role, StepUpPurpose } from '@prisma/client';
import { readDeviceHeaders, requireKioskDeviceSession } from '@/lib/deviceAuth';
import { validateRemoteAccessLease } from '@/lib/remoteAccessLease';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  const { user, deviceId } = await requireKioskDeviceSession(req);
  if (!user || user.role !== Role.ADMIN) {
    return NextResponse.json({ error: 'Admin access required.' }, { status: 401 });
  }

  const { deviceId: headerDeviceId } = readDeviceHeaders(req);
  const effectiveDeviceId = headerDeviceId || deviceId;

  const body = (await req.json().catch(() => null)) as { leaseToken?: unknown } | null;
  const leaseToken = typeof body?.leaseToken === 'string' ? body.leaseToken : '';
  const lease = await validateRemoteAccessLease(
    user.id,
    effectiveDeviceId,
    StepUpPurpose.REMOTE_ACCESS_SETUP,
    leaseToken
  );
  if (!lease) {
    return NextResponse.json(
      { error: 'Email verification is required.', stepUpRequired: true },
      { status: 403 }
    );
  }

  // Remote access setup has been retired; do not return HA credentials.
  return NextResponse.json(
    { error: 'Remote access setup has been retired. Contact support if you need help.', retired: true },
    { status: 410 }
  );
}
