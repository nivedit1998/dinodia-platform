'use client';

import { useCallback, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { getDeviceLabel, getOrCreateDeviceId } from '@/lib/clientDevice';
import { parseApiError } from '@/lib/authClientError';
import { AuthShell } from '@/components/ui/AuthShell';
import { Button } from '@/components/ui/Button';
import { Field } from '@/components/ui/Field';
import { Card } from '@/components/ui/Card';

type ChallengeStatus = 'PENDING' | 'APPROVED' | 'CONSUMED' | 'EXPIRED' | null;

export default function LoginPage() {
  const router = useRouter();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [confirmEmail, setConfirmEmail] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [challengeStatus, setChallengeStatus] = useState<ChallengeStatus>(null);
  const [needsEmailInput, setNeedsEmailInput] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [deviceId] = useState(() =>
    typeof window === 'undefined' ? '' : getOrCreateDeviceId()
  );
  const [deviceLabel] = useState(() =>
    typeof window === 'undefined' ? '' : getDeviceLabel()
  );

  const awaitingVerification = !!challengeId;
  const TENANT_SETUP_KEY = 'tenant_setup_state';
  const TENANT_FIRST_LOGIN_KEY = 'tenant_first_login_state';

  const persistTenantSetupState = useCallback(
    (state: {
      loginIntentId: string;
      deviceId: string;
      deviceLabel: string;
      challengeId?: string | null;
    }) => {
      try {
        sessionStorage.setItem(
          TENANT_SETUP_KEY,
          JSON.stringify({
            ...state,
            challengeId: state.challengeId ?? null,
          })
        );
      } catch {
        // best effort
      }
    },
    []
  );

  const persistTenantFirstLoginState = useCallback(
    (state: { loginIntentId: string; deviceId: string; deviceLabel: string }) => {
      try {
        sessionStorage.setItem(TENANT_FIRST_LOGIN_KEY, JSON.stringify(state));
      } catch {
        // best effort
      }
    },
    []
  );

  const resetVerification = useCallback(() => {
    setChallengeId(null);
    setChallengeStatus(null);
    setNeedsEmailInput(false);
    setCompleting(false);
    setInfo(null);
  }, []);

  const completeChallenge = useCallback(
    async (id: string) => {
      if (!deviceId) {
        setError('We could not verify this device right now. Please try again.');
        resetVerification();
        return;
      }

      setCompleting(true);
      const res = await fetch(`/api/auth/challenges/${id}/complete`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ deviceId, deviceLabel }),
      });
      const data = await res.json();
      setCompleting(false);

      if (!res.ok) {
        const parsed = parseApiError(data, 'Unsuccessful - please try again.');
        setError(parsed.message);
        resetVerification();
        return;
      }

      if (data.role === 'ADMIN' && data.requiresHomeownerPolicyAcceptance) {
        router.push('/homeowner/policy');
        return;
      }
      if (data.role === 'ADMIN') router.push('/admin/dashboard');
      else router.push('/tenant/dashboard');
    },
    [deviceId, deviceLabel, resetVerification, router]
  );

  useEffect(() => {
    if (!awaitingVerification || !challengeId) return;
    const id = challengeId;
    let cancelled = false;

    async function pollStatus() {
      try {
        const res = await fetch(`/api/auth/challenges/${id}`);
        const data = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (!cancelled) {
            const parsed = parseApiError(data, 'Verification has timed out. Please try again.');
            setError(parsed.message);
            resetVerification();
          }
          return;
        }
        if (cancelled) return;
        setChallengeStatus(data.status);

        if (data.status === 'APPROVED' && !completing) {
          await completeChallenge(id);
          return;
        }

        if (data.status === 'EXPIRED' || data.status === 'CONSUMED') {
          setError('Verification has timed out. Please try again.');
          resetVerification();
        }
      } catch {
        // ignore transient errors
      }
    }

    pollStatus();
    const interval = setInterval(pollStatus, 2000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [awaitingVerification, challengeId, completing, completeChallenge, resetVerification]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!deviceId) {
      setError('Preparing your secure sign-in details. Please try again in a moment.');
      return;
    }

    if (needsEmailInput) {
      if (!email) {
        setError('Please enter an email address.');
        return;
      }
      if (email !== confirmEmail) {
        setError('Email addresses must match.');
        return;
      }
    }

    setLoading(true);
    const payload: Record<string, unknown> = {
      username,
      password,
      deviceId,
      deviceLabel,
    };
    if (needsEmailInput) payload.email = email;

    const res = await fetch('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: { 'Content-Type': 'application/json' },
    });

    const data = await res.json();
    setLoading(false);

    if (!res.ok) {
      const parsed = parseApiError(data, 'We couldn’t log you in. Check your details and try again.');
      setError(parsed.message);
      return;
    }

    if (data.requiresPasswordChange && data.role === 'TENANT') {
      if (!data.loginIntentId) {
        setError('We could not continue this sign-in session. Please try again.');
        return;
      }
      if (!deviceId || !deviceLabel) {
        setError('We could not verify this device right now. Please try again.');
        return;
      }
      persistTenantFirstLoginState({
        loginIntentId: data.loginIntentId,
        deviceId,
        deviceLabel,
      });
      router.push('/tenant/first-login');
      return;
    }

    if (data.requiresEmailVerification) {
      const isTenant = data.role === 'TENANT';

      if (isTenant) {
        if (!data.loginIntentId) {
          setError('We could not continue this sign-in session. Please try again.');
          return;
        }
        if (!deviceId || !deviceLabel) {
          setError('We could not verify this device right now. Please try again.');
          return;
        }
        persistTenantSetupState({
          loginIntentId: data.loginIntentId,
          deviceId,
          deviceLabel,
          challengeId: data.challengeId ?? null,
        });
        router.push('/tenant/setup-2fa');
        return;
      }

      // Admin flow (existing inline email collection)
      if (data.needsEmailInput) {
        setNeedsEmailInput(true);
        setChallengeId(null);
        setChallengeStatus(null);
        setInfo('Add an admin email to continue.');
        return;
      }

      if (data.challengeId) {
        setChallengeId(data.challengeId);
        setNeedsEmailInput(false);
        setChallengeStatus('PENDING');
        setInfo('Check your email to approve this device.');
        return;
      }

      setError('We could not start verification. Please try again.');
      return;
    }

      if (data.role === 'ADMIN' && data.requiresHomeownerPolicyAcceptance) {
        router.push('/homeowner/policy');
        return;
      }
      if (data.role === 'ADMIN') router.push('/admin/dashboard');
      else router.push('/tenant/dashboard');
  }

  async function handleResend() {
    if (!challengeId) return;
    setError(null);
    setInfo(null);
    const res = await fetch(`/api/auth/challenges/${challengeId}/resend`, {
      method: 'POST',
    });
    const data = await res.json();
    if (!res.ok) {
      const parsed = parseApiError(data, 'Unable to resend the verification email right now.');
      setError(parsed.message);
      return;
    }
    setInfo('A fresh verification email is on the way.');
  }

  return (
    <AuthShell
      title="Welcome back"
      subtitle="Sign in to continue managing your Dinodia home."
      footer={
        <>
          First time here?{' '}
          <button
            className="font-semibold text-[var(--indigo)] hover:underline"
            onClick={() => router.push('/register-admin')}
          >
            Set up this home
          </button>
          <span className="mx-2 text-muted">|</span>
          Have a claim code?{' '}
          <button
            className="font-semibold text-[var(--indigo)] hover:underline"
            onClick={() => router.push('/claim')}
          >
            Go to claim
          </button>
        </>
      }
    >
      {error && (
        <Card className="mb-4 rounded-[14px] border-[var(--danger)]/35 bg-[var(--danger)]/12 p-3 text-sm text-foreground">
          {error}
        </Card>
      )}
      {info && (
        <Card className="mb-4 rounded-[14px] border-[var(--warning)]/35 bg-[var(--warning)]/12 p-3 text-sm text-foreground">
          {info}
        </Card>
      )}

      {!awaitingVerification ? (
        <form onSubmit={handleSubmit} className="space-y-4">
          <Field
            label="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            required
          />
          <Field
            label="Password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            required
          />

          {needsEmailInput ? (
            <Card surface="muted" className="space-y-3 rounded-[14px] p-3">
              <p className="text-xs text-muted">
                Please add your homeowner email to complete secure sign-in.
              </p>
              <Field
                label="Homeowner email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
              <Field
                label="Confirm email"
                type="email"
                value={confirmEmail}
                onChange={(e) => setConfirmEmail(e.target.value)}
                autoComplete="email"
              />
            </Card>
          ) : null}

          <Button type="submit" loading={loading} fullWidth>
            {loading ? 'Signing you in' : 'Continue'}
          </Button>
          <div className="text-right">
            <button
              type="button"
              className="text-xs font-semibold text-[var(--indigo)] hover:underline"
              onClick={() => router.push('/forgot-password')}
            >
              Forgot password?
            </button>
          </div>
        </form>
      ) : (
        <div className="space-y-3 text-sm">
          <p className="text-foreground">
            Open your email and approve this device. We will complete sign-in here.
          </p>
          <Card surface="muted" className="rounded-[14px] p-3 text-xs text-muted">
            <div className="font-semibold text-foreground">Status</div>
            <div>{challengeStatus ?? 'Waiting for approval...'}</div>
          </Card>
          <div className="flex gap-2">
            <Button type="button" variant="secondary" className="flex-1" onClick={handleResend}>
              Resend email
            </Button>
            <Button type="button" variant="secondary" className="flex-1" onClick={resetVerification}>
              Start over
            </Button>
          </div>
          {completing ? (
            <p className="text-xs text-muted">Finalizing secure sign-in...</p>
          ) : null}
        </div>
      )}
    </AuthShell>
  );
}
