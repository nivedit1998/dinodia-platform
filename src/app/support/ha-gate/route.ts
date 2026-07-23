import { NextRequest, NextResponse } from 'next/server';
import { canAccessHomeSupport } from '@/lib/companyPortalAccess';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { escapeHtml } from '@/lib/htmlEscape';
import { prisma } from '@/lib/prisma';
import { buildSupportFailureMessage, createHomeSupportLaunchTicket } from '@/lib/supportHomeAccess';

export const runtime = 'nodejs';

function isValidHaHostname(raw: string | null) {
  if (!raw) return false;
  return /^ha[a-z0-9-]*\.dinodiasmartliving\.com$/i.test(raw.trim());
}

function renderGatePage(input: {
  title: string;
  message: string;
  requestId?: string | null;
  homeId?: string | null;
  host?: string | null;
  showCodeForm?: boolean;
  showLoginLink?: boolean;
}) {
  const safeTitle = escapeHtml(input.title);
  const safeMessage = escapeHtml(input.message);
  const hiddenFields =
    input.requestId && input.homeId && input.host
      ? `
        <input type="hidden" name="requestId" value="${escapeHtml(input.requestId)}" />
        <input type="hidden" name="homeId" value="${escapeHtml(input.homeId)}" />
        <input type="hidden" name="host" value="${escapeHtml(input.host)}" />
      `
      : '';
  const codeForm =
    input.showCodeForm && input.requestId && input.homeId && input.host
      ? `
      <form method="POST" style="margin-top:16px;">
        ${hiddenFields}
        <label style="display:block;font-size:12px;color:#475569;font-weight:600;margin-bottom:8px;">Enter the one-time HASecurityCode</label>
        <input type="text" name="code" inputmode="numeric" maxlength="6" autocomplete="one-time-code" style="width:100%;max-width:220px;padding:10px 12px;border:1px solid #cbd5e1;border-radius:8px;font-size:16px;letter-spacing:0.16em;" />
        <div style="margin-top:12px;">
          <button type="submit" style="padding:10px 16px; background:#111827; color:#fff; border:none; border-radius:8px; cursor:pointer;">Connect to the Dinodia hub</button>
        </div>
      </form>`
      : '';
  const loginLink = input.showLoginLink
    ? `<p style="margin-top:16px;"><a href="/companylogin/login" style="display:inline-block;padding:10px 16px;background:#111827;color:#fff;border-radius:8px;text-decoration:none;">Company login</a></p>`
    : '';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dinodia support gate</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 40px; }
      .card { max-width: 640px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08); }
      h1 { margin: 0 0 12px 0; font-size: 22px; }
      p { margin: 0; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>${safeTitle}</h1>
      <p>${safeMessage}</p>
      ${codeForm}
      ${loginLink}
    </div>
  </body>
</html>`;
}

function html(input: Parameters<typeof renderGatePage>[0], status = 200) {
  return new NextResponse(renderGatePage(input), {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

export async function GET(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  const requestId = req.nextUrl.searchParams.get('requestId');
  const homeId = req.nextUrl.searchParams.get('homeId');
  const host = req.nextUrl.searchParams.get('host');

  if (!me || !canAccessHomeSupport(me.role)) {
    return html(
      {
        title: 'Company login required',
        message:
          'Dinodia company login is required before remote Home Assistant access can continue. Sign in, then return to this page from Home Support.',
        showLoginLink: true,
      },
      401
    );
  }

  if (!requestId || !homeId || !isValidHaHostname(host)) {
    return html({
      title: 'Support request required',
      message:
        'No active Home Support request was supplied for this home. Start from the Home Support page and request approved access first.',
    });
  }

  const supportRequest = await prisma.supportRequest.findUnique({
    where: { id: requestId },
    select: {
      id: true,
      homeId: true,
      installerUserId: true,
      approvedAt: true,
      approvalValidUntil: true,
      approvalRecipientName: true,
      approvalRecipientEmail: true,
      revokedAt: true,
      haSessionFailureAt: true,
      haSessionStartedAt: true,
      haSessionExpiresAt: true,
    },
  });

  if (!supportRequest || supportRequest.homeId !== Number(homeId) || supportRequest.installerUserId !== me.id) {
    return html({
      title: 'Support request not found',
      message: 'This support request does not belong to your company account or no longer exists.',
    }, 404);
  }

  if (!supportRequest.approvedAt || !supportRequest.approvalValidUntil) {
    return html({
      title: 'Approval required',
      message: 'This support request has not been approved yet. Return to Home Support and wait for the homeowner or property manager approval email.',
      requestId,
      homeId,
      host,
    });
  }

  if (supportRequest.revokedAt) {
    return html({
      title: 'Access revoked',
      message: 'This support request has already been revoked.',
    }, 410);
  }

  if (supportRequest.haSessionFailureAt) {
    return html({
      title: 'Connection failed',
      message: buildSupportFailureMessage(),
    }, 410);
  }

  if (supportRequest.approvalValidUntil.getTime() <= Date.now()) {
    return html({
      title: 'Approval expired',
      message: 'This support approval has expired. Request approval again from Home Support.',
    }, 410);
  }

  if (
    supportRequest.haSessionStartedAt &&
    supportRequest.haSessionExpiresAt &&
    supportRequest.haSessionExpiresAt.getTime() > Date.now()
  ) {
    return html({
      title: 'Session already active',
      message: 'This support session is already in use on another device or tab. Request access again if needed.',
    }, 409);
  }

  const approvedBy = supportRequest.approvalRecipientName || supportRequest.approvalRecipientEmail || 'the approver';
  return html({
    title: 'Connect to the Dinodia hub',
    message: `Approved by ${approvedBy}. Enter the current one-time HASecurityCode to continue into Home Assistant.`,
    requestId,
    homeId,
    host,
    showCodeForm: true,
  });
}

export async function POST(req: NextRequest) {
  const me = await getCurrentUserFromRequest(req);
  if (!me || !canAccessHomeSupport(me.role)) {
    return html(
      {
        title: 'Company login required',
        message:
          'Dinodia company login is required before remote Home Assistant access can continue. Sign in, then return to this page from Home Support.',
        showLoginLink: true,
      },
      401
    );
  }

  const form = await req.formData().catch(() => null);
  const requestId = form?.get('requestId')?.toString() || null;
  const homeId = form?.get('homeId')?.toString() || null;
  const host = form?.get('host')?.toString() || null;
  const code = form?.get('code')?.toString().trim() || '';

  if (!requestId || !homeId || !isValidHaHostname(host)) {
    return html({
      title: 'Support request required',
      message: 'No valid support request was supplied for this home.',
    }, 400);
  }

  if (!/^\d{6}$/.test(code)) {
    return html({
      title: 'Code required',
      message: 'Enter the 6-digit HASecurityCode shown to the homeowner or property manager after approval.',
      requestId,
      homeId,
      host,
      showCodeForm: true,
    }, 400);
  }

  const result = await createHomeSupportLaunchTicket({
    client: prisma,
    supportRequestId: requestId,
    installerUserId: me.id,
    code,
    hostname: host!,
    actorUserId: me.id,
    actorUsername: me.username,
  });

  if (!result.ok) {
    const message =
      result.reason === 'ACTIVE'
        ? 'This support session is already in use on another device or tab. Request access again if needed.'
        : result.reason === 'INVALID_CODE'
          ? 'The HASecurityCode is not valid for this request. Approval must be requested again.'
          : buildSupportFailureMessage();
    return html(
      {
        title: 'Connection failed',
        message,
      },
      result.reason === 'ACTIVE' ? 409 : 410
    );
  }

  const redirectTo = new URL(`https://${host}/__dinodia/launch`);
  redirectTo.searchParams.set('ticket', result.launchTicket);
  return NextResponse.redirect(redirectTo, 303);
}
