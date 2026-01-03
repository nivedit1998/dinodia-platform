import { NextRequest, NextResponse } from 'next/server';
import { Role, HomeStatus } from '@prisma/client';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import { buildVerifyLinkEmail } from '@/lib/emailTemplates';
import { createAuthChallenge, buildVerifyUrl, getAppUrl } from '@/lib/authChallenges';
import { sendEmail } from '@/lib/email';
import { HubInstallError, verifyBootstrapClaim } from '@/lib/hubInstall';

const REPLY_TO = 'niveditgupta@dinodiasmartliving.com';
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export async function POST(req: NextRequest) {
  let body: {
    serial?: string;
    bootstrapSecret?: string;
    username?: string;
    password?: string;
    email?: string;
    deviceId?: string;
    deviceLabel?: string;
  };

  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const {
    serial,
    bootstrapSecret,
    username,
    password,
    email,
    deviceId,
    deviceLabel,
  } = body ?? {};

  if (!serial || !bootstrapSecret || !username || !password || !email || !deviceId) {
    return NextResponse.json({ error: 'All fields are required.' }, { status: 400 });
  }

  if (!EMAIL_REGEX.test(email)) {
    return NextResponse.json({ error: 'Please enter a valid email address.' }, { status: 400 });
  }

  const existingUser = await prisma.user.findUnique({ where: { username } });
  if (existingUser) {
    return NextResponse.json({ error: 'That username is already taken.' }, { status: 409 });
  }

  const hubInstall = await verifyBootstrapClaim(serial, bootstrapSecret).catch((err) => {
    if (err instanceof HubInstallError) {
      return err;
    }
    throw err;
  });
  if (hubInstall instanceof HubInstallError) {
    return NextResponse.json({ error: hubInstall.message }, { status: hubInstall.status });
  }

  const homeId = hubInstall.homeId;
  if (!homeId) {
    return NextResponse.json(
      { error: 'This Dinodia Hub is not fully provisioned. Ask your installer to provision it.' },
      { status: 400 }
    );
  }

  const home = await prisma.home.findUnique({
    where: { id: homeId },
    include: {
      users: { select: { id: true }, take: 1 },
      haConnection: true,
    },
  });
  if (!home || !home.haConnection) {
    return NextResponse.json(
      { error: 'Dinodia Hub provisioning is incomplete. Ask your installer to provision it again.' },
      { status: 400 }
    );
  }
  if (home.users.length > 0) {
    return NextResponse.json({ error: 'This Dinodia Hub is already claimed.' }, { status: 409 });
  }

  const passwordHash = await hashPassword(password);

  const result = await prisma.$transaction(async (tx) => {
    const admin = await tx.user.create({
      data: {
        username,
        passwordHash,
        role: Role.ADMIN,
        emailPending: email,
        emailVerifiedAt: null,
        homeId,
        haConnectionId: home.haConnection.id,
      },
    });

    await tx.haConnection.update({
      where: { id: home.haConnection.id },
      data: { ownerId: admin.id },
    });

    await tx.home.update({
      where: { id: homeId },
      data: { status: HomeStatus.ACTIVE },
    });

    return { admin, homeId };
  });

  const challenge = await createAuthChallenge({
    userId: result.admin.id,
    purpose: 'ADMIN_EMAIL_VERIFY',
    email,
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
    to: email,
    subject: emailContent.subject,
    html: emailContent.html,
    text: emailContent.text,
    replyTo: REPLY_TO,
  });

  return NextResponse.json({
    ok: true,
    requiresEmailVerification: true,
    challengeId: challenge.id,
    homeId: result.homeId,
  });
}
