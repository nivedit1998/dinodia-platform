import { NextRequest, NextResponse } from 'next/server';
import { exchangeAcceptGrantCode } from '@/lib/alexaEvents';
import { prisma } from '@/lib/prisma';

export async function POST(req: NextRequest) {
  const secretHeader = req.headers.get('x-internal-secret');
  if (!secretHeader || secretHeader !== process.env.ALEXA_EVENTS_INTERNAL_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const userId = body?.userId;
  const code = body?.code;
  if (!userId || !code) {
    return NextResponse.json({ error: 'Missing userId or code' }, { status: 400 });
  }

  const tokenPayload = await exchangeAcceptGrantCode(code);
  await prisma.alexaEventToken.upsert({
    where: { userId },
    create: {
      userId,
      accessToken: tokenPayload.accessToken,
      refreshToken: tokenPayload.refreshToken,
      expiresAt: new Date(tokenPayload.expiresAt),
    },
    update: {
      accessToken: tokenPayload.accessToken,
      refreshToken: tokenPayload.refreshToken,
      expiresAt: new Date(tokenPayload.expiresAt),
    },
  });

  return NextResponse.json({ ok: true });
}
