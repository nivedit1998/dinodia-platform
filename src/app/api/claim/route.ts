import { NextRequest, NextResponse } from 'next/server';
import { AuditEventType, HomeStatus, Prisma, Role } from '@prisma/client';
import { hashPassword } from '@/lib/auth';
import { hashClaimCode } from '@/lib/claimCode';
import { createAuthChallenge, buildVerifyUrl, getAppUrl } from '@/lib/authChallenges';
import { buildVerifyLinkEmail } from '@/lib/emailTemplates';
import { sendEmail } from '@/lib/email';
import { prisma } from '@/lib/prisma';
import { AUTH_ERROR_CODES, type AuthErrorCode } from '@/lib/authErrorCodes';
import { checkRateLimit } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/requestInfo';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const REPLY_TO = 'niveditgupta@dinodiasmartliving.com';

type ClaimErrorCode =
  | 'HOME_NOT_FOUND'
  | 'CLAIM_CONSUMED'
  | 'HOME_ACTIVE'
  | 'HOME_HAS_OWNER';

class ClaimFlowError extends Error {
  constructor(public code: ClaimErrorCode, public details?: Record<string, unknown>) {
    super(code);
    this.name = 'ClaimFlowError';
  }
}

function errorResponse(
  message: string,
  status = 400,
  errorCode: AuthErrorCode = AUTH_ERROR_CODES.CLAIM_INVALID,
  extras: Record<string, unknown> = {}
) {
  return NextResponse.json({ ok: false, errorCode, error: message, ...extras }, { status });
}

async function getClaimableHome(
  client: typeof prisma | Prisma.TransactionClient,
  claimCodeHash: string
) {
  const home = await client.home.findUnique({
    where: { claimCodeHash },
    include: { haConnection: true },
  });

  if (!home || !home.haConnection) throw new ClaimFlowError('HOME_NOT_FOUND');
  if (home.claimCodeConsumedAt) throw new ClaimFlowError('CLAIM_CONSUMED');
  if (home.status === HomeStatus.ACTIVE) throw new ClaimFlowError('HOME_ACTIVE');
  if (home.haConnection.ownerId) throw new ClaimFlowError('HOME_HAS_OWNER');

  return { home };
}

function handleClaimError(err: unknown) {
  if (err instanceof ClaimFlowError) {
    switch (err.code) {
      case 'HOME_NOT_FOUND':
        return errorResponse('That claim code is not valid for any home.', 404, AUTH_ERROR_CODES.CLAIM_INVALID);
      case 'CLAIM_CONSUMED':
        return errorResponse(
          'This claim code has already been used. Request a new one.',
          409,
          AUTH_ERROR_CODES.CLAIM_INVALID
        );
      case 'HOME_ACTIVE':
        return errorResponse('This home is already active with an owner.', 409, AUTH_ERROR_CODES.CLAIM_INVALID);
      case 'HOME_HAS_OWNER':
        return errorResponse(
          'Another owner is already linked to this Dinodia Hub.',
          409,
          AUTH_ERROR_CODES.CLAIM_INVALID
        );
      default:
        return errorResponse('We could not start the claim. Please try again.', 400, AUTH_ERROR_CODES.CLAIM_INVALID);
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);

  const validateOnly = body?.validateOnly === true;
  const claimCode = typeof body?.claimCode === 'string' ? body.claimCode.trim() : '';
  const username = typeof body?.username === 'string' ? body.username.trim() : '';
  const password = typeof body?.password === 'string' ? body.password : '';
  const email = typeof body?.email === 'string' ? body.email.trim() : '';
  const deviceId = typeof body?.deviceId === 'string' ? body.deviceId.trim() : '';
  const deviceLabel = typeof body?.deviceLabel === 'string' ? body.deviceLabel : undefined;
  if (!claimCode) return errorResponse('Enter the claim code from the previous owner.', 400, AUTH_ERROR_CODES.CLAIM_INVALID);

  const ip = getClientIp(req);
  const rateKey = `claim:${ip}:${claimCode.toUpperCase()}:${validateOnly ? 'validate' : 'start'}`;
  const allowed = await checkRateLimit(rateKey, { maxRequests: 12, windowMs: 10 * 60_000 });
  if (!allowed) {
    return errorResponse(
      'Too many claim attempts. Please wait a few minutes and try again.',
      429,
      AUTH_ERROR_CODES.RATE_LIMITED
    );
  }

  if (!validateOnly) {
    if (!username || !password) {
      return errorResponse('Create a username and password to continue.', 400, AUTH_ERROR_CODES.INVALID_LOGIN_INPUT);
    }
    if (!email) {
      return errorResponse('Enter an email address to verify your admin account.', 400, AUTH_ERROR_CODES.EMAIL_REQUIRED);
    }
    if (!EMAIL_REGEX.test(email)) {
      return errorResponse('Please enter a valid email address.', 400, AUTH_ERROR_CODES.EMAIL_INVALID);
    }
    if (!deviceId) {
      return errorResponse('We need your device info to secure this claim.', 400, AUTH_ERROR_CODES.DEVICE_REQUIRED);
    }
  }

  let claimCodeHash: string;
  try {
    claimCodeHash = hashClaimCode(claimCode);
  } catch (err) {
    const message =
      err instanceof Error && err.message.includes('CLAIM_CODE_PEPPER')
        ? 'Claiming is not available right now. Please try again later.'
        : 'Invalid claim code.';
    return errorResponse(message, 500, AUTH_ERROR_CODES.INTERNAL_ERROR);
  }

  if (validateOnly) {
    try {
      const claimable = await getClaimableHome(prisma, claimCodeHash);
      return NextResponse.json({
        ok: true,
        homeStatus: claimable.home.status,
      });
    } catch (err) {
      const mapped = handleClaimError(err);
      if (mapped) return mapped;
      console.error('[api/claim] Failed to validate claim code', err);
      return errorResponse('We could not validate this claim code. Please try again.', 500, AUTH_ERROR_CODES.INTERNAL_ERROR);
    }
  }

  const existingUser = await prisma.user.findFirst({
    where: { username: { equals: username, mode: 'insensitive' } },
    select: { id: true },
  });
  if (existingUser) {
    return errorResponse('That username is already taken. Choose another one.', 409, AUTH_ERROR_CODES.REGISTRATION_BLOCKED);
  }

  const passwordHash = await hashPassword(password);

  let adminId: number;
  let challengeEmail: string;
  let homeId: number;
  try {
    const result = await prisma.$transaction(async (tx) => {
      const claimable = await getClaimableHome(tx, claimCodeHash);
      const { home } = claimable;

      const pendingAdminsDeleted = await tx.user.deleteMany({
        where: {
          role: Role.ADMIN,
          homeId: home.id,
          haConnectionId: home.haConnectionId,
          emailVerifiedAt: null,
          emailPending: { not: null },
        },
      });

      const admin = await tx.user.create({
        data: {
          username,
          passwordHash,
          role: Role.ADMIN,
          emailPending: email,
          emailVerifiedAt: null,
          homeId: home.id,
          haConnectionId: home.haConnectionId,
        },
      });

      await tx.auditEvent.create({
        data: {
          type: AuditEventType.HOME_CLAIM_ATTEMPTED,
          homeId: home.id,
          metadata: {
            username,
            email,
            pendingAdminsDeleted: pendingAdminsDeleted.count,
            statusAtAttempt: home.status,
            haConnectionId: home.haConnectionId,
          },
        },
      });

      return { adminId: admin.id, homeId: home.id };
    });

    adminId = result.adminId;
    homeId = result.homeId;
    challengeEmail = email;
  } catch (err) {
    const mapped = handleClaimError(err);
    if (mapped) return mapped;
    console.error('[api/claim] Failed to start claim', err);
    return errorResponse('We could not start the claim. Please try again.', 500, AUTH_ERROR_CODES.INTERNAL_ERROR);
  }

  try {
    const challenge = await createAuthChallenge({
      userId: adminId,
      purpose: 'ADMIN_EMAIL_VERIFY',
      email: challengeEmail,
      deviceId,
    });

    const appUrl = getAppUrl();
    const verifyUrl = buildVerifyUrl(challenge.token);
    const emailContent = buildVerifyLinkEmail({
      kind: 'ADMIN_EMAIL_VERIFY',
      verifyUrl,
      appUrl,
      username,
      deviceLabel,
    });

    await sendEmail({
      to: challengeEmail,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      replyTo: REPLY_TO,
    });

    return NextResponse.json({
      ok: true,
      requiresEmailVerification: true,
      challengeId: challenge.id,
      homeId,
    });
  } catch (err) {
    console.error('[api/claim] Failed to send verification email', err);
    return errorResponse(
      'We could not send the verification email. Please try again.',
      500,
      AUTH_ERROR_CODES.INTERNAL_ERROR
    );
  }
}
