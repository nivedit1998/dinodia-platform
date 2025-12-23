type VerifyEmailKind = 'ADMIN_EMAIL_VERIFY' | 'TENANT_ENABLE_2FA' | 'LOGIN_NEW_DEVICE';

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
