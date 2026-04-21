import { AUTH_ERROR_CODES, type AuthErrorCode } from '@/lib/authErrorCodes';

type ApiErrorPayload = {
  errorCode?: unknown;
  error?: unknown;
};

function toStringOrEmpty(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

export function friendlyAuthError(errorCode: string | undefined, fallbackMessage: string): string {
  const code = (errorCode ?? '').trim() as AuthErrorCode;
  switch (code) {
    case AUTH_ERROR_CODES.USERNAME_NOT_FOUND:
      return 'This username doesn\'t exist. Ask your homeowner to create it first.';
    case AUTH_ERROR_CODES.INVALID_PASSWORD:
      return 'That password is incorrect. Please try again.';
    case AUTH_ERROR_CODES.INVALID_LOGIN_INPUT:
      return 'Please check your details and try again.';
    case AUTH_ERROR_CODES.RATE_LIMITED:
      return 'Too many attempts. Please wait a moment and try again.';
    case AUTH_ERROR_CODES.DEVICE_REQUIRED:
      return 'We couldn\'t verify this device. Please try again.';
    case AUTH_ERROR_CODES.EMAIL_REQUIRED:
      return 'Please enter your email to continue.';
    case AUTH_ERROR_CODES.EMAIL_INVALID:
      return 'Please enter a valid email address.';
    case AUTH_ERROR_CODES.VERIFICATION_REQUIRED:
      return 'Email verification is required to continue.';
    case AUTH_ERROR_CODES.VERIFICATION_FAILED:
      return 'We couldn\'t complete verification. Please try again.';
    case AUTH_ERROR_CODES.REGISTRATION_BLOCKED:
      return fallbackMessage || 'Setup is not available right now. Please contact support.';
    case AUTH_ERROR_CODES.CLAIM_INVALID:
      return fallbackMessage || 'We couldn\'t validate this claim. Please check the code and try again.';
    case AUTH_ERROR_CODES.INTERNAL_ERROR:
      return fallbackMessage || 'Something went wrong. Please try again in a moment.';
    default:
      return fallbackMessage;
  }
}

export function parseApiError(data: unknown, fallbackMessage: string): { errorCode?: string; message: string } {
  if (!data || typeof data !== 'object') {
    return { message: fallbackMessage };
  }

  const payload = data as ApiErrorPayload;
  const errorCode = toStringOrEmpty(payload.errorCode) || undefined;
  const messageFromApi = toStringOrEmpty(payload.error);
  const message = friendlyAuthError(errorCode, messageFromApi || fallbackMessage);

  return { errorCode, message };
}

export function friendlyErrorFromUnknown(error: unknown, fallbackMessage: string): string {
  if (!error) return fallbackMessage;

  const raw = error instanceof Error ? error.message : String(error);
  const trimmed = raw.trim();
  if (!trimmed) return fallbackMessage;

  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed) as ApiErrorPayload;
      return parseApiError(parsed, fallbackMessage).message;
    } catch {
      return fallbackMessage;
    }
  }

  if (/network|failed to fetch|timeout|timed out|http\s*5\d\d/i.test(trimmed)) {
    return 'We couldn\'t reach Dinodia right now. Please try again.';
  }

  return trimmed;
}
