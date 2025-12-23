import 'server-only';

import { Prisma, PrismaClient } from '@prisma/client';
import { prisma } from './prisma';

export async function isDeviceTrusted(userId: number, deviceId: string): Promise<boolean> {
  if (!deviceId) return false;
  const device = await prisma.trustedDevice.findUnique({
    where: { userId_deviceId: { userId, deviceId } },
    select: { revokedAt: true },
  });
  return !!device && device.revokedAt === null;
}

type PrismaClientOrTx = PrismaClient | Prisma.TransactionClient;

export async function trustDevice(
  userId: number,
  deviceId: string,
  label?: string | null,
  client: PrismaClientOrTx = prisma
) {
  if (!deviceId) return;
  await client.trustedDevice.upsert({
    where: { userId_deviceId: { userId, deviceId } },
    update: {
      lastSeenAt: new Date(),
      label: label ?? undefined,
      revokedAt: null,
    },
    create: {
      userId,
      deviceId,
      label: label ?? undefined,
      firstSeenAt: new Date(),
      lastSeenAt: new Date(),
    },
  });
}

export async function touchTrustedDevice(userId: number, deviceId: string) {
  if (!deviceId) return;
  await prisma.trustedDevice.updateMany({
    where: { userId, deviceId },
    data: { lastSeenAt: new Date() },
  });
}
