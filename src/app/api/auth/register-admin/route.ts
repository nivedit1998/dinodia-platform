import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { hashPassword } from '@/lib/auth';
import { Role } from '@prisma/client';
import { createAuthChallenge, buildVerifyUrl, getAppUrl } from '@/lib/authChallenges';
import { buildVerifyLinkEmail } from '@/lib/emailTemplates';
import { sendEmail } from '@/lib/email';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();

    const {
      username,
      password,
      email,
      haUsername,
      haPassword,
      haBaseUrl,
      haCloudUrl,
      haLongLivedToken,
      deviceId,
      deviceLabel,
    } = body;

    if (!username || !password || !haUsername || !haPassword || !haBaseUrl || !haLongLivedToken || !email || !deviceId) {
      return NextResponse.json(
        { error: 'Please fill in all fields to connect your Dinodia Hub.' },
        { status: 400 }
      );
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

    const passwordHash = await hashPassword(password);

    const admin = await prisma.user.create({
      data: {
        username,
        passwordHash,
        role: Role.ADMIN,
        emailPending: email,
        emailVerifiedAt: null,
      },
    });

    const haConnection = await prisma.haConnection.create({
      data: {
        baseUrl: haBaseUrl.trim().replace(/\/+$/, ''),
        cloudUrl: haCloudUrl ? haCloudUrl.trim().replace(/\/+$/, '') : null,
        haUsername,
        haPassword,
        longLivedToken: haLongLivedToken,
        ownerId: admin.id,
      },
    });

    await prisma.user.update({
      where: { id: admin.id },
      data: { haConnectionId: haConnection.id },
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
