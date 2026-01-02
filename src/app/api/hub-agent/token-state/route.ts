import { NextRequest, NextResponse } from 'next/server';
import { HubTokenStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import {
  decryptSyncSecret,
  getAcceptedTokenHashes,
  getLatestVersion,
  publishPendingIfAcked,
  revokeExpiredGraceTokens,
} from '@/lib/hubTokens';
import { verifyHmac } from '@/lib/hubCrypto';

export async function POST(req: NextRequest) {
  let body: { serial?: string; ts?: number; nonce?: string; sig?: string; agentSeenVersion?: number };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const { serial, ts, nonce, sig } = body ?? {};
  const agentSeenVersion = Number(body?.agentSeenVersion ?? 0);

  if (!serial || typeof ts !== 'number' || !nonce || !sig) {
    return NextResponse.json({ error: 'serial, ts, nonce, sig are required.' }, { status: 400 });
  }

  const hubInstall = await prisma.hubInstall.findUnique({
    where: { serial: serial.trim() },
    include: { hubTokens: true },
  });
  if (!hubInstall) {
    return NextResponse.json({ error: 'Unknown hub serial.' }, { status: 404 });
  }

  if (!hubInstall.syncSecretCiphertext) {
    return NextResponse.json({ error: 'Hub not paired yet.' }, { status: 401 });
  }

  const syncSecret = decryptSyncSecret(hubInstall.syncSecretCiphertext);
  try {
    verifyHmac({ serial, ts, nonce, sig }, syncSecret);
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 401 });
  }

  const now = new Date();
  await revokeExpiredGraceTokens(hubInstall.id, now);

  let publishedVersion = hubInstall.publishedHubTokenVersion ?? 0;

  const pending = hubInstall.hubTokens
    .filter((t) => t.status === HubTokenStatus.PENDING)
    .sort((a, b) => a.version - b.version)[0];
  if (pending && agentSeenVersion >= pending.version) {
    publishedVersion = await publishPendingIfAcked(
      hubInstall.id,
      pending.version,
      publishedVersion,
      hubInstall.graceMinutes
    );
  }

  const latestVersion = await getLatestVersion(hubInstall.id);
  const hashes = await getAcceptedTokenHashes(hubInstall.id, now);

  await prisma.hubInstall.update({
    where: { id: hubInstall.id },
    data: {
      lastSeenAt: now,
      lastAckedHubTokenVersion: Math.max(agentSeenVersion, hubInstall.lastAckedHubTokenVersion ?? 0),
    },
  });

  return NextResponse.json({
    ok: true,
    platformSyncEnabled: hubInstall.platformSyncEnabled,
    platformSyncIntervalMinutes: hubInstall.platformSyncIntervalMinutes,
    publishedVersion,
    latestVersion,
    hubTokenHashes: hashes,
  });
}
