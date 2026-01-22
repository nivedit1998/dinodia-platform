type VerifyEmailKind =
  | 'ADMIN_EMAIL_VERIFY'
  | 'TENANT_ENABLE_2FA'
  | 'LOGIN_NEW_DEVICE'
  | 'REMOTE_ACCESS_SETUP'
  | 'SUPPORT_HOME_ACCESS'
  | 'SUPPORT_USER_REMOTE_SUPPORT';

export type BuildVerifyLinkEmailParams = {
  kind: VerifyEmailKind;
  verifyUrl: string;
  appUrl: string;
  username?: string;
  deviceLabel?: string;
};

export function buildVerifyLinkEmail(params: BuildVerifyLinkEmailParams) {
  const { kind, verifyUrl, appUrl, username, deviceLabel } = params;

  const subject = (() => {
    switch (kind) {
      case 'ADMIN_EMAIL_VERIFY':
        return 'Verify your Dinodia admin email';
      case 'TENANT_ENABLE_2FA':
        return 'Enable email verification for your Dinodia account';
      case 'LOGIN_NEW_DEVICE':
        return 'Approve new device login on Dinodia';
      case 'REMOTE_ACCESS_SETUP':
        return 'Approve remote access setup on Dinodia';
      case 'SUPPORT_HOME_ACCESS':
        return 'Approve installer home support access';
      case 'SUPPORT_USER_REMOTE_SUPPORT':
        return 'Approve installer remote support access';
      default:
        return 'Verify your Dinodia access';
    }
  })();

  const purposeCopy = (() => {
    switch (kind) {
      case 'ADMIN_EMAIL_VERIFY':
        return 'Confirm your email to continue as a Dinodia admin.';
      case 'TENANT_ENABLE_2FA':
        return 'Verify your email to turn on device verification for your account.';
      case 'LOGIN_NEW_DEVICE':
        return `Approve this sign-in${deviceLabel ? ` from "${deviceLabel}"` : ''} before continuing.`;
      case 'REMOTE_ACCESS_SETUP':
        return `Approve remote access setup${deviceLabel ? ` on "${deviceLabel}"` : ''} to continue.`;
      case 'SUPPORT_HOME_ACCESS':
        return 'Allow your installer to view sensitive home credentials for support.';
      case 'SUPPORT_USER_REMOTE_SUPPORT':
        return 'Allow your installer to access your Dinodia dashboard for support.';
      default:
        return 'Complete email verification to continue.';
    }
  })();

  const greeting = username ? `Hi ${username},` : 'Hi,';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; color: #0f172a;">
      <h2 style="color: #0f172a; margin-bottom: 12px;">Dinodia Smart Living</h2>
      <p style="margin: 0 0 12px 0;">${greeting}</p>
      <p style="margin: 0 0 12px 0;">${purposeCopy}</p>
      <p style="margin: 0 0 16px 0;">Click the button to continue:</p>
      <p style="margin: 0 0 16px 0;">
        <a href="${verifyUrl}" style="background:#111827;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;">Verify and continue</a>
      </p>
      <p style="margin: 0 0 12px 0;">Or open this link: <a href="${verifyUrl}">${verifyUrl}</a></p>
      <p style="margin: 0 0 12px 0; color: #475569;">This link expires soon.</p>
      <p style="margin: 0 0 12px 0; color: #475569;">You can always return to <a href="${appUrl}">${appUrl}</a> to sign in again.</p>
    </div>
  `;

  const text = [
    'Dinodia Smart Living',
    greeting,
    '',
    purposeCopy,
    'Verify and continue:',
    verifyUrl,
    '',
    'This link expires soon.',
    `Return to ${appUrl} to sign in again if needed.`,
  ].join('\n');

  return { subject, html, text };
}

export type BuildSupportApprovalEmailParams = {
  kind: 'SUPPORT_HOME_ACCESS' | 'SUPPORT_USER_REMOTE_SUPPORT';
  verifyUrl: string;
  appUrl: string;
  installerUsername: string;
  homeId: number;
  targetUsername?: string;
};

export function buildSupportApprovalEmail(params: BuildSupportApprovalEmailParams) {
  const { kind, verifyUrl, appUrl, installerUsername, homeId, targetUsername } = params;
  const isHome = kind === 'SUPPORT_HOME_ACCESS';
  const subject = isHome
    ? 'Approve installer home support access'
    : 'Approve installer remote support access';
  const greeting = targetUsername ? `Hi ${targetUsername},` : 'Hi,';
  const purposeCopy = isHome
    ? `Allow installer "${installerUsername}" to view home credentials for Home #${homeId} to troubleshoot.`
    : `Allow installer "${installerUsername}" to temporarily access your Dinodia dashboard for Home #${homeId}.`;

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; color: #0f172a;">
      <h2 style="color: #0f172a; margin-bottom: 12px;">Dinodia Smart Living</h2>
      <p style="margin: 0 0 12px 0;">${greeting}</p>
      <p style="margin: 0 0 12px 0;">${purposeCopy}</p>
      <p style="margin: 0 0 16px 0;">Click to approve this request:</p>
      <p style="margin: 0 0 16px 0;">
        <a href="${verifyUrl}" style="background:#111827;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;">Approve access</a>
      </p>
      <p style="margin: 0 0 12px 0;">Or open this link: <a href="${verifyUrl}">${verifyUrl}</a></p>
      <p style="margin: 0 0 12px 0; color: #475569;">This approval link expires soon.</p>
      <p style="margin: 0 0 12px 0; color: #475569;">You can return to <a href="${appUrl}">${appUrl}</a> anytime.</p>
    </div>
  `;

  const text = [
    'Dinodia Smart Living',
    greeting,
    '',
    purposeCopy,
    'Approve access:',
    verifyUrl,
    '',
    'This approval link expires soon.',
    `Return to ${appUrl} anytime.`,
  ].join('\n');

  return { subject, html, text };
}

export type BuildPasswordResetEmailParams = {
  resetUrl: string;
  appUrl: string;
  username?: string;
  ttlMinutes?: number;
};

export function buildPasswordResetEmail(params: BuildPasswordResetEmailParams) {
  const { resetUrl, appUrl, username, ttlMinutes = 10 } = params;

  const greeting = username ? `Hi ${username},` : 'Hi,';
  const ttlCopy = ttlMinutes ? `This link expires in ${ttlMinutes} minutes.` : 'This link expires soon.';

  const subject = 'Reset your Dinodia password';
  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; color: #0f172a;">
      <h2 style="color: #0f172a; margin-bottom: 12px;">Dinodia Smart Living</h2>
      <p style="margin: 0 0 12px 0;">${greeting}</p>
      <p style="margin: 0 0 12px 0;">We received a request to reset your Dinodia password. Click below to choose a new one.</p>
      <p style="margin: 0 0 16px 0;">
        <a href="${resetUrl}" style="background:#111827;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;">Reset password</a>
      </p>
      <p style="margin: 0 0 12px 0;">Or open this link: <a href="${resetUrl}">${resetUrl}</a></p>
      <p style="margin: 0 0 12px 0; color: #475569;">${ttlCopy}</p>
      <p style="margin: 0 0 12px 0; color: #475569;">If you didn’t request this, you can ignore this email. Your password won’t change until you reset it.</p>
      <p style="margin: 0 0 12px 0; color: #475569;">You can always return to <a href="${appUrl}">${appUrl}</a> to sign in again.</p>
    </div>
  `;

  const text = [
    'Dinodia Smart Living',
    greeting,
    '',
    'We received a request to reset your Dinodia password. Use the link below to choose a new one:',
    resetUrl,
    '',
    ttlCopy,
    'If you didn’t request this, you can ignore this email. Your password won’t change until you reset it.',
    `You can return to ${appUrl} to sign in again.`,
  ].join('\n');

  return { subject, html, text };
}

export type BuildClaimCodeEmailParams = {
  claimCode: string;
  appUrl: string;
  username?: string;
};

export function buildClaimCodeEmail(params: BuildClaimCodeEmailParams) {
  const { claimCode, appUrl, username } = params;
  const greeting = username ? `Hi ${username},` : 'Hi,';
  const claimUrl = `${appUrl.replace(/\/$/, '')}/claim`;

  const subject = 'Your Dinodia home claim code';

  const html = `
    <div style="font-family: Arial, sans-serif; max-width: 520px; color: #0f172a;">
      <h2 style="color: #0f172a; margin-bottom: 12px;">Dinodia Smart Living</h2>
      <p style="margin: 0 0 12px 0;">${greeting}</p>
      <p style="margin: 0 0 12px 0;">
        Here is the claim code for your home. Forward this email to the next homeowner.
      </p>
      <p style="margin: 0 0 16px 0; font-size: 18px;">
        Claim code: <strong style="letter-spacing: 0.08em;">${claimCode}</strong>
      </p>
      <p style="margin: 0 0 12px 0;">
        The next homeowner can start at <a href="${claimUrl}">${claimUrl}</a>.
      </p>
      <p style="margin: 0 0 12px 0; color: #475569;">
        This code can only be used once.
      </p>
    </div>
  `;

  const text = [
    'Dinodia Smart Living',
    greeting,
    '',
    'Here is the claim code for your home. Forward this email to the next homeowner.',
    `Claim code: ${claimCode}`,
    '',
    `The next homeowner can start at ${claimUrl}.`,
    'This code can only be used once.',
  ].join('\n');

  return { subject, html, text };
}
