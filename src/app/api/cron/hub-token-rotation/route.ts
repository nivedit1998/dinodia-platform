import { NextRequest, NextResponse } from 'next/server';
import { HubTokenStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { generateHubToken, revokeExpiredGraceTokens } from '@/lib/hubTokens';

const EXPECTED_SECRET = process.env.CRON_SECRET;

export async function GET(req: NextRequest) {
  if (!EXPECTED_SECRET) {
    return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 500 });
  }

  const authHeader = req.headers.get('authorization');
  const bearer =
    authHeader && authHeader.toLowerCase().startsWith('bearer ')
      ? authHeader.slice('bearer '.length)
      : null;
  const secretParam = req.nextUrl.searchParams.get('secret');
  const secret = bearer ?? secretParam;
  if (!secret || secret !== EXPECTED_SECRET) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const now = new Date();
  const installs = await prisma.hubInstall.findMany({
    where: { platformSyncEnabled: true },
    select: {
      id: true,
      rotateEveryDays: true,
      graceMinutes: true,
      publishedHubTokenVersion: true,
      hubTokens: {
        orderBy: { version: 'asc' },
        select: { id: true, version: true, status: true, publishedAt: true },
      },
    },
  });

  let created = 0;
  let expired = 0;

  for (const install of installs) {
    await revokeExpiredGraceTokens(install.id, now);

    const tokens = install.hubTokens;
    const latestVersion = tokens.length ? tokens[tokens.length - 1].version : 0;

    if (tokens.length === 0) {
      const seed = generateHubToken();
      await prisma.hubToken.create({
        data: {
          hubInstallId: install.id,
          version: 1,
          status: HubTokenStatus.PENDING,
          tokenHash: seed.hash,
          tokenCiphertext: seed.ciphertext,
        },
      });
      created += 1;
      continue;
    }

    const active = tokens.find((t) => t.status === HubTokenStatus.ACTIVE && t.publishedAt);
    const pending = tokens.find((t) => t.status === HubTokenStatus.PENDING);
    const graceExpired = await prisma.hubToken.updateMany({
      where: {
        hubInstallId: install.id,
        status: HubTokenStatus.GRACE,
        graceUntil: { lt: now },
      },
      data: { status: HubTokenStatus.REVOKED },
    });
    expired += graceExpired.count;

    if (!active || pending) {
      continue;
    }

    const ageMs = now.getTime() - new Date(active.publishedAt as Date).getTime();
    const rotateMs = install.rotateEveryDays * 24 * 60 * 60 * 1000;
    if (ageMs < rotateMs) continue;

    const newToken = generateHubToken();
    await prisma.hubToken.create({
      data: {
        hubInstallId: install.id,
        version: latestVersion + 1,
        status: HubTokenStatus.PENDING,
        tokenHash: newToken.hash,
        tokenCiphertext: newToken.ciphertext,
      },
    });
    created += 1;
  }

  return NextResponse.json({ ok: true, created, expired });
}
