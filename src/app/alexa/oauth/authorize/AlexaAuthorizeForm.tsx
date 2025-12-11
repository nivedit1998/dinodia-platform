'use client';

import { useState } from 'react';

type Props = {
  clientId: string;
  redirectUri: string;
  responseType: string;
  state?: string;
  scope?: string;
};

export function AlexaAuthorizeForm({
  clientId,
  redirectUri,
  responseType,
  state,
  scope,
}: Props) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const res = await fetch('/api/alexa/oauth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          clientId,
          redirectUri,
          responseType,
          state,
          scope,
        }),
      });

      const data = await res.json().catch(() => ({}));

      if (!res.ok) {
        setError(data.error || 'Unable to link Alexa right now.');
        setLoading(false);
        return;
      }

      if (!data.redirectTo) {
        setError('Missing redirect target.');
        setLoading(false);
        return;
      }

      window.location.href = data.redirectTo as string;
    } catch (err) {
      console.error('Alexa authorize failed', err);
      setError('Network error. Please try again.');
      setLoading(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      <div>
        <label className="block text-sm font-medium mb-1">Dinodia Username</label>
        <input
          className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          autoComplete="username"
          required
        />
      </div>
      <div>
        <label className="block text-sm font-medium mb-1">Password</label>
        <input
          type="password"
          className="w-full border rounded-lg px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-indigo-500"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
      </div>

      {error && (
        <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={loading}
        className="w-full bg-indigo-600 text-white rounded-lg py-2 text-sm font-medium hover:bg-indigo-700 disabled:opacity-60"
      >
        {loading ? 'Linking…' : 'Link Dinodia to Alexa'}
      </button>
    </form>
  );
}
