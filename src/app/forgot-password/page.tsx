'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { friendlyErrorFromUnknown, parseApiError } from '@/lib/authClientError';
import { AuthShell } from '@/components/ui/AuthShell';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Field } from '@/components/ui/Field';

export default function ForgotPasswordPage() {
  const router = useRouter();
  const [identifier, setIdentifier] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setInfo(null);

    if (!identifier.trim()) {
      setError('Please enter your username or email.');
      return;
    }

    setLoading(true);
    try {
      const res = await fetch('/api/auth/password-reset/request', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ identifier }),
      });

      const data = await res.json().catch(() => ({}));
      setLoading(false);

      if (!res.ok) {
        const parsed = parseApiError(
          data,
          'Unsuccessful - please try again in a moment.'
        );
        setError(parsed.message);
        return;
      }

      setInfo(
        'If we found a matching account, a reset link is on the way.'
      );
    } catch (err) {
      console.error(err);
      setLoading(false);
      setError(friendlyErrorFromUnknown(err, 'Unsuccessful - please try again in a moment.'));
    }
  }

  return (
    <AuthShell
      title="Reset your password"
      subtitle="Enter your username or email and we will guide you securely."
      footer={
        <button
          className="font-semibold text-[var(--indigo)] hover:underline"
          onClick={() => router.push('/login')}
        >
          Back to sign in
        </button>
      }
    >
      {error ? (
        <Card className="mb-4 rounded-[14px] border-[color:var(--danger)] bg-[color:var(--danger)]/12 p-3 text-sm text-foreground">
          {error}
        </Card>
      ) : null}
      {info ? (
        <Card className="mb-4 rounded-[14px] border-[color:var(--success)] bg-[color:var(--success)]/12 p-3 text-sm text-foreground">
          {info}
        </Card>
      ) : null}

      <form onSubmit={handleSubmit} className="space-y-4">
        <Field
          label="Username or email"
          value={identifier}
          onChange={(e) => setIdentifier(e.target.value)}
          autoComplete="username"
          required
        />
        <Button type="submit" loading={loading} fullWidth>
          {loading ? 'Sending secure link' : 'Send reset link'}
        </Button>
      </form>
    </AuthShell>
  );
}
