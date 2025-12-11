import { NextRequest, NextResponse } from 'next/server';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { Role } from '@prisma/client';
import { resolveAlexaAuthUser } from '@/app/api/alexa/auth';

export async function GET(req: NextRequest) {
  const authUser = await resolveAlexaAuthUser(req);
  if (!authUser) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { user, haConnection } = await getUserWithHaConnection(authUser.id);
    const devices = await getDevicesForHaConnection(haConnection.id, { logSample: true });

    const filteredDevices =
      user.role === Role.TENANT
        ? devices.filter(
            (device) =>
              device.areaName !== null &&
              user.accessRules.some((rule) => rule.area === device.areaName)
          )
        : devices;

    return NextResponse.json({ devices: filteredDevices });
  } catch (err) {
    console.error('[api/alexa/devices] error', err);
    const message = err instanceof Error ? err.message : 'Failed to fetch devices';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
