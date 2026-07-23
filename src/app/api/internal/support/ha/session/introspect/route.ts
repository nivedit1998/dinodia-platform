import { NextRequest, NextResponse } from 'next/server';
import { apiBadRequest, apiForbidden } from '@/lib/apiError';
import { isValidHaSupportInternalRequest } from '@/lib/haSupportInternalAuth';
import { prisma } from '@/lib/prisma';
import { introspectGatewaySupportSession } from '@/lib/supportHomeAccess';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  if (!isValidHaSupportInternalRequest(req)) {
    return apiForbidden('Worker access required.');
  }

  const body = await req.json().catch(() => null);
  const sessionToken = typeof body?.sessionToken === 'string' ? body.sessionToken : '';
  const hostname = typeof body?.hostname === 'string' ? body.hostname : '';
  const userAgent = typeof body?.userAgent === 'string' ? body.userAgent : null;

  if (!sessionToken || !/^ha[a-z0-9-]*\.dinodiasmartliving\.com$/i.test(hostname)) {
    return apiBadRequest('Invalid introspection request.');
  }

  const result = await introspectGatewaySupportSession({
    client: prisma,
    rawGatewaySessionToken: sessionToken,
    hostname,
    userAgent,
  });

  return NextResponse.json(result, { status: result.ok ? 200 : 410 });
}
