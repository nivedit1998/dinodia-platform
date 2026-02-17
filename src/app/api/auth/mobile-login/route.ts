import { NextRequest, NextResponse } from 'next/server';
import { Role } from '@prisma/client';
import { authenticateWithCredentials, createKioskToken, hashPassword } from '@/lib/auth';
import { prisma } from '@/lib/prisma';
import {
  createAuthChallenge,
  buildVerifyUrl,
  getAppUrl,
} from '@/lib/authChallenges';
import { buildVerifyLinkEmail } from '@/lib/emailTemplates';
import { sendEmail } from '@/lib/email';
import { isDeviceTrusted, touchTrustedDevice, trustDevice } from '@/lib/deviceTrust';
import { registerOrValidateDevice, DeviceBlockedError } from '@/lib/deviceRegistry';
import { checkRateLimit } from '@/lib/rateLimit';
import { getClientIp } from '@/lib/requestInfo';

const REPLY_TO = 'niveditgupta@dinodiasmartliving.com';
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const APPLE_REVIEW_DEMO_BYPASS_ENABLED =
  (process.env.APPLE_REVIEW_DEMO_BYPASS_ENABLED || '').toLowerCase() === 'true';
const APPLE_REVIEW_DEMO_USERNAME = (process.env.APPLE_REVIEW_DEMO_USERNAME || '').toLowerCase();

export async function POST(req: NextRequest) {
  try {
    const {
      username,
      password,
      deviceId,
      deviceLabel,
      email,
      newPassword,
      confirmNewPassword,
    } = await req.json();

    const ip = getClientIp(req);
    const rateKey = `mobile-login:${ip}:${(username || '').toLowerCase()}`;
    const allowed = await checkRateLimit(rateKey, { maxRequests: 12, windowMs: 60_000 });
    if (!allowed) {
      return NextResponse.json(
        { error: 'Too many login attempts. Please wait a moment and try again.' },
        { status: 429 }
      );
    }

    if (!username || !password) {
      return NextResponse.json(
        { error: 'Please enter both a username and password.' },
        { status: 400 }
      );
    }

    const authUser = await authenticateWithCredentials(username, password);
    if (!authUser) {
      return NextResponse.json(
        { error: 'Those details don’t match any Dinodia account.' },
        { status: 401 }
      );
    }

    const user = await prisma.user.findUnique({
      where: { id: authUser.id },
      select: {
        id: true,
        username: true,
        role: true,
        mustChangePassword: true,
        email: true,
        emailPending: true,
        emailVerifiedAt: true,
        email2faEnabled: true,
        home: {
          select: {
            haConnection: {
              select: {
                cloudUrl: true,
              },
            },
          },
        },
      },
    });

    if (!user) {
      return NextResponse.json(
        { error: 'We could not find your account. Please try again.' },
        { status: 404 }
      );
    }

    const sessionUser = {
      id: user.id,
      username: user.username,
      role: user.role,
    };
    const cloudEnabled = Boolean(user.home?.haConnection?.cloudUrl?.trim());
    const appUrl = getAppUrl();

    if (!deviceId) {
      return NextResponse.json(
        { error: 'Device information is required to continue.' },
        { status: 400 }
      );
    }

    // Enforce first-login password change for tenants before any bypass/token issuance.
    if (user.role === Role.TENANT && user.mustChangePassword) {
      if (typeof newPassword !== 'string' || typeof confirmNewPassword !== 'string') {
        return NextResponse.json({
          ok: true,
          role: user.role,
          requiresPasswordChange: true,
          passwordPolicy: { minLength: 8 },
        });
      }
      if (newPassword !== confirmNewPassword) {
        return NextResponse.json({ error: 'New passwords do not match.' }, { status: 400 });
      }
      if (newPassword.length < 8) {
        return NextResponse.json(
          { error: 'Password must be at least 8 characters.' },
          { status: 400 }
        );
      }
      if (newPassword === password) {
        return NextResponse.json(
          { error: 'New password must be different from the current password.' },
          { status: 400 }
        );
      }

      const now = new Date();
      const passwordHash = await hashPassword(newPassword);
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash, mustChangePassword: false, passwordChangedAt: now },
      });
    }

    // Apple review bypass: trust device + skip email/device verification for the configured demo user.
    const isAppleDemoUser =
      APPLE_REVIEW_DEMO_BYPASS_ENABLED &&
      APPLE_REVIEW_DEMO_USERNAME.length > 0 &&
      user.username.toLowerCase() === APPLE_REVIEW_DEMO_USERNAME;

    if (isAppleDemoUser) {
      await trustDevice(user.id, deviceId, deviceLabel);
      const trustedRow = await prisma.trustedDevice.findUnique({
        where: { userId_deviceId: { userId: user.id, deviceId } },
      });
      type SessionVersionRow = { sessionVersion?: number | null };
      const sessionVersion = (trustedRow as unknown as SessionVersionRow | null)?.sessionVersion ?? 0;
      const token = createKioskToken(sessionUser, deviceId, sessionVersion);
      console.log('[mobile-login] Apple review bypass', {
        userId: user.id,
        username: user.username,
        deviceId,
      });
      return NextResponse.json({ ok: true, token, role: user.role, cloudEnabled });
    }

    try {
      await registerOrValidateDevice(deviceId);
    } catch (err) {
      const message =
        err instanceof DeviceBlockedError ? err.message : 'This device is blocked. Please contact support.';
      return NextResponse.json({ error: message }, { status: 403 });
    }

    if (user.role === Role.ADMIN) {
      if (!user.emailVerifiedAt) {
        let targetEmail = user.emailPending || user.email;

        if (!targetEmail) {
          if (!email) {
            return NextResponse.json({
              ok: true,
              requiresEmailVerification: true,
              needsEmailInput: true,
              role: user.role,
            });
          }
          if (!EMAIL_REGEX.test(email)) {
            return NextResponse.json(
              { error: 'Please enter a valid email address.' },
              { status: 400 }
            );
          }
          targetEmail = email;
          await prisma.user.update({
            where: { id: user.id },
            data: { emailPending: targetEmail, emailVerifiedAt: null },
          });
        }

        if (!targetEmail) {
          return NextResponse.json(
            { error: 'An email address is required for verification.' },
            { status: 400 }
          );
        }

        if (!deviceId) {
          return NextResponse.json(
            { error: 'Device information is required for verification.' },
            { status: 400 }
          );
        }

        const challenge = await createAuthChallenge({
          userId: user.id,
          purpose: 'ADMIN_EMAIL_VERIFY',
          email: targetEmail,
          deviceId,
        });

        const verifyUrl = buildVerifyUrl(challenge.token);
        const emailContent = buildVerifyLinkEmail({
          kind: 'ADMIN_EMAIL_VERIFY',
          verifyUrl,
          appUrl,
          username: user.username,
          deviceLabel,
        });

        await sendEmail({
          to: targetEmail,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
          replyTo: REPLY_TO,
        });

        console.log('[mobile-login] Sent admin email verification challenge', {
          userId: user.id,
          challengeId: challenge.id,
        });

        return NextResponse.json({
          ok: true,
          requiresEmailVerification: true,
          challengeId: challenge.id,
          role: user.role,
        });
      }

      if (!deviceId) {
        return NextResponse.json(
          { error: 'Device information is required to continue.' },
          { status: 400 }
        );
      }

      const trusted = await isDeviceTrusted(user.id, deviceId);
      if (!trusted) {
        if (!user.email) {
          return NextResponse.json(
            { error: 'Admin email is missing. Please contact support.' },
            { status: 400 }
          );
        }

        const challenge = await createAuthChallenge({
          userId: user.id,
          purpose: 'LOGIN_NEW_DEVICE',
          email: user.email,
          deviceId,
        });

        const verifyUrl = buildVerifyUrl(challenge.token);
        const emailContent = buildVerifyLinkEmail({
          kind: 'LOGIN_NEW_DEVICE',
          verifyUrl,
          appUrl,
          username: user.username,
          deviceLabel,
        });

        await sendEmail({
          to: user.email,
          subject: emailContent.subject,
          html: emailContent.html,
          text: emailContent.text,
          replyTo: REPLY_TO,
        });

        console.log('[mobile-login] Sent admin new device challenge', {
          userId: user.id,
          challengeId: challenge.id,
        });

        return NextResponse.json({
          ok: true,
          requiresEmailVerification: true,
          challengeId: challenge.id,
          role: user.role,
        });
      }

      await touchTrustedDevice(user.id, deviceId);
      const trustedRow = await prisma.trustedDevice.findUnique({
        where: { userId_deviceId: { userId: user.id, deviceId } },
      });
      type SessionVersionRow = { sessionVersion?: number | null };
      const sessionVersion = (trustedRow as unknown as SessionVersionRow | null)?.sessionVersion ?? 0;
      const token = createKioskToken(sessionUser, deviceId, sessionVersion);
      console.log('[mobile-login] Admin login successful', { userId: user.id });
      return NextResponse.json({ ok: true, token, role: user.role, cloudEnabled });
    }

    // Tenant
    const hasVerifiedEmail = Boolean(user.email && user.emailVerifiedAt);
    const requiresInitialEmailSetup = !hasVerifiedEmail || user.email2faEnabled === false;

    if (requiresInitialEmailSetup) {
      if (!deviceId) {
        return NextResponse.json(
          { error: 'Device information is required for verification.' },
          { status: 400 }
        );
      }

      let targetEmail = user.emailPending || user.email;
      if (!targetEmail) {
        if (email) {
          if (!EMAIL_REGEX.test(email)) {
            return NextResponse.json(
              { error: 'Please enter a valid email address.' },
              { status: 400 }
            );
          }
          targetEmail = email;
          await prisma.user.update({
            where: { id: user.id },
            data: { emailPending: targetEmail, emailVerifiedAt: null },
          });
        } else {
          return NextResponse.json({
            ok: true,
            requiresEmailVerification: true,
            needsEmailInput: true,
            role: user.role,
          });
        }
      }

      const safeEmail = targetEmail ?? email ?? '';

      const challenge = await createAuthChallenge({
        userId: user.id,
        purpose: 'TENANT_ENABLE_2FA',
        email: safeEmail,
        deviceId,
      });
      const verifyUrl = buildVerifyUrl(challenge.token);
      const emailContent = buildVerifyLinkEmail({
        kind: 'TENANT_ENABLE_2FA',
        verifyUrl,
        appUrl,
        username: user.username,
        deviceLabel,
      });
      await sendEmail({
        to: safeEmail,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
        replyTo: REPLY_TO,
      });

      console.log('[mobile-login] Sent tenant email verification challenge', {
        userId: user.id,
        challengeId: challenge.id,
      });

      return NextResponse.json({
        ok: true,
        requiresEmailVerification: true,
        challengeId: challenge.id,
        role: user.role,
      });
    }

    if (!deviceId) {
      return NextResponse.json(
        { error: 'Device information is required to continue.' },
        { status: 400 }
      );
    }

    if (!user.email) {
      return NextResponse.json(
        { error: 'Email is required for verification. Please contact support.' },
        { status: 400 }
      );
    }

    const trusted = await isDeviceTrusted(user.id, deviceId);
    if (!trusted) {
      const challenge = await createAuthChallenge({
        userId: user.id,
        purpose: 'LOGIN_NEW_DEVICE',
        email: user.email,
        deviceId,
      });
      const verifyUrl = buildVerifyUrl(challenge.token);
      const emailContent = buildVerifyLinkEmail({
        kind: 'LOGIN_NEW_DEVICE',
        verifyUrl,
        appUrl,
        username: user.username,
        deviceLabel,
      });
      await sendEmail({
        to: user.email,
        subject: emailContent.subject,
        html: emailContent.html,
        text: emailContent.text,
        replyTo: REPLY_TO,
      });

      console.log('[mobile-login] Sent tenant new device challenge', {
        userId: user.id,
        challengeId: challenge.id,
      });

      return NextResponse.json({
        ok: true,
        requiresEmailVerification: true,
        challengeId: challenge.id,
        role: user.role,
      });
    }

    await touchTrustedDevice(user.id, deviceId);
    const trustedRow = await prisma.trustedDevice.findUnique({
      where: { userId_deviceId: { userId: user.id, deviceId } },
    });
    type SessionVersionRow = { sessionVersion?: number | null };
    const sessionVersion = (trustedRow as unknown as SessionVersionRow | null)?.sessionVersion ?? 0;
    const token = createKioskToken(sessionUser, deviceId, sessionVersion);
    console.log('[mobile-login] Tenant login successful', { userId: user.id });
    return NextResponse.json({ ok: true, token, role: user.role, cloudEnabled });
  } catch (err) {
    console.error('[mobile-login] Login error', err);
    return NextResponse.json(
      { error: 'We couldn’t log you in right now. Please try again in a moment.' },
      { status: 500 }
    );
  }
}
