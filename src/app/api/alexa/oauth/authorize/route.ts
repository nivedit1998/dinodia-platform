import { NextRequest, NextResponse } from 'next/server';
import { authenticateWithCredentials } from '@/lib/auth';
import {
  AlexaOAuthError,
  buildOAuthRedirectUri,
  issueAlexaAuthorizationCode,
  validateAlexaClientRequest,
} from '@/lib/alexaOAuth';

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  if (!body || typeof body !== 'object') {
    return NextResponse.json({ error: 'Invalid body' }, { status: 400 });
  }

  const {
    username,
    password,
    clientId,
    redirectUri,
    responseType,
    state,
  } = body as {
    username?: string;
    password?: string;
    clientId?: string;
    redirectUri?: string;
    responseType?: string;
    state?: string;
  };

  if (!username || !password) {
    return NextResponse.json({ error: 'Missing username or password' }, { status: 400 });
  }

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: 'Missing OAuth details' }, { status: 400 });
  }

  if (responseType !== 'code') {
    return NextResponse.json({ error: 'Unsupported response_type' }, { status: 400 });
  }

  try {
    validateAlexaClientRequest(clientId, redirectUri);
  } catch (err) {
    if (err instanceof AlexaOAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }

  const authUser = await authenticateWithCredentials(username, password);
  if (!authUser) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  try {
    const code = await issueAlexaAuthorizationCode(authUser.id, clientId, redirectUri);
    const redirectTo = buildOAuthRedirectUri(redirectUri, code, state);
    return NextResponse.json({ redirectTo });
  } catch (err) {
    console.error('[api/alexa/oauth/authorize] failed to issue code', err);
    if (err instanceof AlexaOAuthError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    return NextResponse.json({ error: 'Failed to issue authorization code' }, { status: 500 });
  }
}
