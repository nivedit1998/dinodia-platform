import { NextRequest, NextResponse } from 'next/server';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { requireKioskDeviceSession } from '@/lib/deviceAuth';
import { prisma } from '@/lib/prisma';
import { getPublishedHubTokenPlaintext } from '@/lib/hubTokens';

export const runtime = 'nodejs';

export async function POST(req: NextRequest) {
  try {
    const { user } = await requireKioskDeviceSession(req);
    const { haConnection, user: fullUser } = await getUserWithHaConnection(user.id);
    if (!haConnection.baseUrl) {
      return NextResponse.json(
        { error: 'Dinodia Hub connection is not configured.' },
        { status: 400 }
      );
    }

    const homeId = fullUser.home?.id;
    if (!homeId) {
      return NextResponse.json(
        { error: 'Dinodia Hub connection is not configured for this home.' },
        { status: 400 }
      );
    }

    const hubInstall = await prisma.hubInstall.findFirst({
      where: { homeId },
      select: { id: true, publishedHubTokenVersion: true },
    });
    if (!hubInstall) {
      return NextResponse.json(
        { error: 'Dinodia Hub agent is not linked to this home yet.' },
        { status: 400 }
      );
    }

    const hubToken = await getPublishedHubTokenPlaintext(
      hubInstall.id,
      hubInstall.publishedHubTokenVersion
    );

    const base = new URL(haConnection.baseUrl);
    const port = process.env.HUB_AGENT_PORT || '8099';
    base.port = port;
    const hubBaseUrl = base.toString().replace(/\/+$/, '');

    return NextResponse.json({
      baseUrl: hubBaseUrl,
      longLivedToken: hubToken,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unable to load Dinodia Hub settings.';
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
