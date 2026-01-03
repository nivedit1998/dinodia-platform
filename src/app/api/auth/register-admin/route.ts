import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import { Role, HomeStatus } from '@prisma/client';
import { createAuthChallenge, buildVerifyUrl, getAppUrl } from '@/lib/authChallenges';
import { buildVerifyLinkEmail } from '@/lib/emailTemplates';
import { sendEmail } from '@/lib/email';
import { HubInstallError, verifyBootstrapClaim } from '@/lib/hubInstall';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const { username, password, email, deviceId, deviceLabel, dinodiaSerial, bootstrapSecret } = body;

    if (!username || !password || !email || !deviceId || !dinodiaSerial || !bootstrapSecret) {
      return NextResponse.json({ error: 'Please fill in all fields to connect your Dinodia Hub.' }, { status: 400 });
    }

    const emailRegex = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
    if (!emailRegex.test(email)) {
      return NextResponse.json(
        { error: 'Please enter a valid email address.' },
        { status: 400 }
      );
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) {
      return NextResponse.json({ error: 'That username is already taken. Try another one.' }, { status: 400 });
    }

    let hubInstall;
    try {
      hubInstall = await verifyBootstrapClaim(dinodiaSerial, bootstrapSecret);
    } catch (err) {
      if (err instanceof HubInstallError) {
        return NextResponse.json({ error: err.message }, { status: err.status });
      }
      throw err;
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

    const { admin } = await prisma.$transaction(async (tx) => {
      const createdAdmin = await tx.user.create({
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
        data: { ownerId: createdAdmin.id },
      });

      await tx.home.update({
        where: { id: homeId },
        data: { status: HomeStatus.ACTIVE },
      });

      return { admin: createdAdmin };
    });

    const challenge = await createAuthChallenge({
      userId: admin.id,
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
      username: admin.username,
      deviceLabel,
    });

    await sendEmail({
      to: email,
      subject: emailContent.subject,
      html: emailContent.html,
      text: emailContent.text,
      replyTo: 'niveditgupta@dinodiasmartliving.com',
    });

    return NextResponse.json({
      ok: true,
      requiresEmailVerification: true,
      challengeId: challenge.id,
    });
  } catch (err) {
    console.error(err);
    return NextResponse.json(
      { error: 'We couldn’t finish setting up the homeowner account. Please try again.' },
      { status: 500 }
    );
  }
}
