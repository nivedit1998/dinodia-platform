import { HubTokenStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { decryptSecret, encryptSecret, generateRandomHex, hashSha256 } from './hubCrypto';

export function generateHubToken() {
  const plaintext = generateRandomHex(32);
  return {
    plaintext,
    hash: hashSha256(plaintext),
    ciphertext: encryptSecret(plaintext),
  };
}

export function encryptSyncSecret(secret: string): string {
  return encryptSecret(secret);
}

export function decryptSyncSecret(ciphertext: string): string {
  return decryptSecret(ciphertext);
}

export function encryptBootstrapSecret(secret: string): string {
  return encryptSecret(secret);
}

export function decryptBootstrapSecret(ciphertext: string): string {
  return decryptSecret(ciphertext);
}

export async function revokeExpiredGraceTokens(hubInstallId: string, now = new Date()) {
  await prisma.hubToken.updateMany({
    where: {
      hubInstallId,
      status: HubTokenStatus.GRACE,
      graceUntil: { lt: now },
    },
    data: { status: HubTokenStatus.REVOKED },
  });
}

export async function getAcceptedTokenHashes(hubInstallId: string, now = new Date()) {
  const tokens = await prisma.hubToken.findMany({
    where: {
      hubInstallId,
      status: { in: [HubTokenStatus.ACTIVE, HubTokenStatus.PENDING, HubTokenStatus.GRACE] },
      OR: [{ graceUntil: null }, { graceUntil: { gt: now } }],
    },
    orderBy: { version: 'asc' },
    select: { tokenHash: true },
  });
  return tokens.map((t) => t.tokenHash);
}

export async function getLatestVersion(hubInstallId: string): Promise<number> {
  const latest = await prisma.hubToken.findFirst({
    where: { hubInstallId },
    orderBy: { version: 'desc' },
    select: { version: true },
  });
  return latest?.version ?? 0;
}

export async function publishPendingIfAcked(
  hubInstallId: string,
  pendingVersion: number,
  publishedVersion: number,
  graceMinutes: number
) {
  const now = new Date();
  const graceUntil = new Date(now.getTime() + graceMinutes * 60 * 1000);

  const pending = await prisma.hubToken.findFirst({
    where: { hubInstallId, version: pendingVersion, status: HubTokenStatus.PENDING },
  });
  if (!pending) return publishedVersion;

  const previous = await prisma.hubToken.findFirst({
    where: { hubInstallId, version: publishedVersion },
  });

  await prisma.$transaction(async (tx) => {
    if (previous) {
      await tx.hubToken.update({
        where: { id: previous.id },
        data: { status: HubTokenStatus.GRACE, graceUntil },
      });
    }
    await tx.hubToken.update({
      where: { id: pending.id },
      data: { status: HubTokenStatus.ACTIVE, publishedAt: now },
    });
    await tx.hubInstall.update({
      where: { id: hubInstallId },
      data: { publishedHubTokenVersion: pendingVersion },
    });
  });

  return pendingVersion;
}

export function decryptTokenPlaintext(ciphertext: string): string {
  return decryptSecret(ciphertext);
}

export async function getPublishedHubTokenPlaintext(
  hubInstallId: string,
  publishedVersion?: number | null
): Promise<string> {
  const version =
    typeof publishedVersion === 'number' && Number.isFinite(publishedVersion) && publishedVersion > 0
      ? publishedVersion
      : (
          await prisma.hubInstall.findUnique({
            where: { id: hubInstallId },
            select: { publishedHubTokenVersion: true },
          })
        )?.publishedHubTokenVersion ?? 0;

  if (!version || version <= 0) {
    throw new Error('No published hub token is available.');
  }

  const token = await prisma.hubToken.findFirst({
    where: { hubInstallId, version },
    select: { tokenCiphertext: true },
  });
  if (!token) throw new Error('Published hub token not found.');
  return decryptTokenPlaintext(token.tokenCiphertext);
}
