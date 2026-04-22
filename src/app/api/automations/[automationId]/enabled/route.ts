import { NextRequest, NextResponse } from 'next/server';
import { apiFailFromStatus } from '@/lib/apiError';
import { Role } from '@prisma/client';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection, resolveHaForRequestedMode } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { setAutomationEnabled } from '@/lib/homeAssistantAutomations';
import { requireTrustedAdminDevice, toTrustedDeviceResponse } from '@/lib/deviceAuth';

function badRequest(message: string) {
  return apiFailFromStatus(400, message);
}

function forbidden(message: string) {
  return apiFailFromStatus(403, message);
}

function parseMode(value: string | null): 'home' | 'cloud' | undefined {
  if (value === 'home' || value === 'cloud') return value;
  return undefined;
}

async function getAllowedEntitiesForUser(userId: number, role: Role, haConnectionId: number) {
  const devices = await getDevicesForHaConnection(haConnectionId, { bypassCache: true });
  if (role === Role.ADMIN) {
    return new Set(devices.map((d) => d.entityId));
  }
  const { prisma } = await import('@/lib/prisma');
  const rules = await prisma.accessRule.findMany({ where: { userId } });
  const allowedAreas = new Set(rules.map((r) => r.area));
  const allowedDevices = devices.filter(
    (d) => d.areaName && allowedAreas.has(d.areaName)
  );
  return new Set(allowedDevices.map((d) => d.entityId));
}

async function guardAdminDevice(req: NextRequest, user: { id: number; role: Role }) {
  if (user.role !== Role.ADMIN) return null;
  try {
    await requireTrustedAdminDevice(req, user.id);
    return null;
  } catch (err) {
    const deviceError = toTrustedDeviceResponse(err);
    if (deviceError) return deviceError;
    throw err;
  }
}

export async function POST(
  req: NextRequest,
  context: { params: Promise<{ automationId: string }> }
) {
  const user = await getCurrentUserFromRequest(req);
  if (!user) {
    return apiFailFromStatus(401, 'Your session has ended. Please sign in again.');
  }

  const deviceError = await guardAdminDevice(req, user as { id: number; role: Role });
  if (deviceError) return deviceError;

  const { automationId } = await context.params;
  if (!automationId) return badRequest('Missing automation id');

  const mode = parseMode(req.nextUrl.searchParams.get('mode'));
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object' || typeof (body as Record<string, unknown>).enabled !== 'boolean') {
    return badRequest('enabled must be provided as boolean');
  }
  const enabled = (body as Record<string, unknown>).enabled as boolean;

  let haConnectionId: number;
  let ha;
  try {
    const result = await getUserWithHaConnection(user.id);
    haConnectionId = result.haConnection.id;
    ha = resolveHaForRequestedMode(result.haConnection, mode);
  } catch {
    return apiFailFromStatus(400, 'Dinodia Hub connection isn’t set up yet for this home.');
  }

  const allowedEntities = await getAllowedEntitiesForUser(user.id, user.role as Role, haConnectionId);
  if (allowedEntities.size === 0 && user.role === Role.TENANT) {
    return forbidden('You do not have permission to manage automations.');
  }

  try {
    await setAutomationEnabled(ha, `automation.${automationId}`, enabled);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error('[api/automations/[id]/enabled] Failed to toggle automation', err);
    return apiFailFromStatus(502, 'Dinodia Hub unavailable. Please refresh and try again.');
  }
}
