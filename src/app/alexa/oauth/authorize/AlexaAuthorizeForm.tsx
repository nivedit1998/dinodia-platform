'use client';

import { useEffect, useState } from 'react';

type OAuthParams = {
  clientId: string | null;
  redirectUri: string | null;
  responseType: string | null;
  state: string | null;
  scope: string | null;
};

export function AlexaAuthorizeForm() {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [oauth, setOauth] = useState<OAuthParams | null>(null);

  useEffect(() => {
    try {
      const params = new URLSearchParams(window.location.search);
      const clientId = params.get('client_id');
      const redirectUri = params.get('redirect_uri');
      const responseType = params.get('response_type') || 'code';
      const state = params.get('state');
      const scope = params.get('scope');

      if (!clientId || !redirectUri) {
        setError('Missing client_id or redirect_uri.');
      }

      setOauth({ clientId, redirectUri, responseType, state, scope });
    } catch (err) {
      console.error('Failed to parse OAuth parameters', err);
      setError('Invalid Alexa link. Please try again.');
    }
  }, []);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    if (!oauth || !oauth.clientId || !oauth.redirectUri || !oauth.responseType) {
      setError('Missing OAuth details. Please relaunch linking from Alexa.');
      return;
    }

    setLoading(true);

    try {
      const res = await fetch('/api/alexa/oauth/authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username,
          password,
          clientId: oauth.clientId,
          redirectUri: oauth.redirectUri,
          responseType: oauth.responseType,
          state: oauth.state ?? undefined,
          scope: oauth.scope ?? undefined,
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
