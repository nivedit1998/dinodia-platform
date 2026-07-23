import { NextRequest, NextResponse } from 'next/server';
import { apiBadRequest, apiForbidden } from '@/lib/apiError';
import { isValidHaSupportInternalRequest } from '@/lib/haSupportInternalAuth';
import { prisma } from '@/lib/prisma';
import { bootstrapGatewaySupportSession } from '@/lib/supportHomeAccess';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!isValidHaSupportInternalRequest(req)) {
    return apiForbidden('Worker access required.');
  }

  const body = await req.json().catch(() => null);
  const launchTicket = typeof body?.launchTicket === 'string' ? body.launchTicket : '';
  const hostname = typeof body?.hostname === 'string' ? body.hostname : '';
  const userAgent = typeof body?.userAgent === 'string' ? body.userAgent : null;
  const actorUsername = typeof body?.actorUsername === 'string' ? body.actorUsername : null;

  if (!launchTicket || !/^ha[a-z0-9-]*\.dinodiasmartliving\.com$/i.test(hostname)) {
    return apiBadRequest('Invalid bootstrap request.');
  }

  const result = await bootstrapGatewaySupportSession({
    client: prisma,
    rawLaunchTicket: launchTicket,
    hostname,
    userAgent,
    actorUsername,
  });

  if (!result.ok) {
    return NextResponse.json(result, { status: 410 });
  }

  return NextResponse.json({
    ok: true,
    supportRequestId: result.supportRequestId,
    homeId: result.homeId,
    sessionToken: result.sessionToken,
    sessionExpiresAt: result.sessionExpiresAt,
    cloudUrl: result.cloudUrl,
    haUsername: result.haUsername,
    haPassword: result.haPassword,
  });
}
