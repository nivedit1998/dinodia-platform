import { NextRequest, NextResponse } from 'next/server';
import { apiFailFromStatus } from '@/lib/apiError';
import { AuthChallengePurpose, Role } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { createAuthChallenge, buildVerifyUrl, getAppUrl } from '@/lib/authChallenges';
import { buildSupportApprovalEmail } from '@/lib/emailTemplates';
import { sendEmail } from '@/lib/email';
import { computeSupportApproval } from '@/lib/supportRequests';

const TTL_MINUTES = 60;

export async function POST(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || me.role !== Role.INSTALLER) {
    return apiFailFromStatus(401, 'Installer access required.');
  }

  const body = await req.json().catch(() => null);
  const homeId = Number(body?.homeId ?? 0);
  const userId = Number(body?.userId ?? 0);
  if (!Number.isInteger(homeId) || homeId <= 0 || !Number.isInteger(userId) || userId <= 0) {
    return apiFailFromStatus(400, 'Invalid home or user id.');
  }

  const targetUser = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, username: true, homeId: true },
  });

  if (!targetUser || targetUser.homeId !== homeId) {
    return apiFailFromStatus(404, 'User not found for this home.');
  }

  if (!targetUser.email) {
    return apiFailFromStatus(400, 'User has no email set for approvals.');
  }

  // Reuse existing approved request within window
  const existing = await prisma.supportRequest.findFirst({
    where: {
      kind: 'USER_REMOTE_ACCESS',
      homeId,
      installerUserId: me.id,
      targetUserId: targetUser.id,
    },
    orderBy: { createdAt: 'desc' },
    select: { id: true, authChallengeId: true },
  });
  if (existing) {
    const challenge = await prisma.authChallenge.findUnique({
      where: { id: existing.authChallengeId },
      select: { approvedAt: true, expiresAt: true, consumedAt: true },
    });
    const approval = computeSupportApproval(challenge);
    if (approval.status === 'APPROVED') {
      return NextResponse.json({
        ok: true,
        requestId: existing.id,
        expiresAt: approval.expiresAt,
        validUntil: approval.validUntil,
        approvedAt: approval.approvedAt,
      });
    }
  }

  const challenge = await createAuthChallenge({
    userId: targetUser.id,
    purpose: AuthChallengePurpose.SUPPORT_USER_REMOTE_SUPPORT,
    email: targetUser.email,
    ttlMinutes: TTL_MINUTES,
  });

  const supportRequest = await prisma.supportRequest.create({
    data: {
      kind: 'USER_REMOTE_ACCESS',
      homeId,
      targetUserId: targetUser.id,
      installerUserId: me.id,
      authChallengeId: challenge.id,
    },
  });

  const appUrl = getAppUrl();
  const verifyUrl = buildVerifyUrl(challenge.token);
  const email = buildSupportApprovalEmail({
    kind: 'SUPPORT_USER_REMOTE_SUPPORT',
    verifyUrl,
    appUrl,
    installerUsername: me.username,
    homeId,
    targetUsername: targetUser.username ?? undefined,
  });

  await sendEmail({
    to: targetUser.email,
    subject: email.subject,
    html: email.html,
    text: email.text,
  });

  return NextResponse.json({
    ok: true,
    requestId: supportRequest.id,
    expiresAt: challenge.expiresAt,
    validUntil: null,
    approvedAt: null,
  });
}
