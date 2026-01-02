import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { requireTrustedPrivilegedDevice } from '@/lib/deviceAuth';
import { encryptBootstrapSecret, generateHubToken } from '@/lib/hubTokens';
import { generateRandomHex } from '@/lib/hubCrypto';

export async function POST(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.INSTALLER) {
    return NextResponse.json({ error: 'Installer access required.' }, { status: 401 });
  }

  const deviceError = await requireTrustedPrivilegedDevice(req, me.id).catch((err) => err);
  if (deviceError instanceof Error) {
    return NextResponse.json({ error: deviceError.message }, { status: 403 });
  }

  let body: { serial?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request body.' }, { status: 400 });
  }

  const serial = body?.serial?.trim();
  if (!serial) {
    return NextResponse.json({ error: 'serial is required.' }, { status: 400 });
  }

  const existing = await prisma.hubInstall.findUnique({ where: { serial } });
  if (existing) {
    return NextResponse.json({ error: 'That serial is already provisioned.' }, { status: 409 });
  }

  const bootstrapSecret = generateRandomHex(24);
  const encryptedBootstrap = encryptBootstrapSecret(bootstrapSecret);

  const hubInstall = await prisma.hubInstall.create({
    data: {
      serial,
      bootstrapSecretCiphertext: encryptedBootstrap,
      platformSyncEnabled: true,
      platformSyncIntervalMinutes: 5,
      rotateEveryDays: 14,
      graceMinutes: 60 * 24 * 7,
    },
  });

  // Seed initial pending hub token (version 1)
  const token = generateHubToken();
  await prisma.hubToken.create({
    data: {
      hubInstallId: hubInstall.id,
      version: 1,
      status: 'PENDING',
      tokenHash: token.hash,
      tokenCiphertext: token.ciphertext,
    },
  });

  return NextResponse.json({
    ok: true,
    serial,
    bootstrapSecret,
  });
}
