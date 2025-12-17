import { randomUUID } from 'crypto';
import { prisma } from '@/lib/prisma';
import { AlexaProperty } from '@/lib/alexaProperties';

type AlexaEventTokenPayload = {
  accessToken: string;
  refreshToken: string;
  expiresAt: number; // epoch ms
};

type AlexaChangeReportCause =
  | 'PHYSICAL_INTERACTION'
  | 'APP_INTERACTION'
  | 'VOICE_INTERACTION'
  | 'PERIODIC_POLL'
  | 'RULE_TRIGGER';

function getGatewayEndpoint() {
  return process.env.ALEXA_EVENT_GATEWAY_ENDPOINT || 'https://api.amazonalexa.com/v3/events';
}

function getEventsClientCredentials() {
  const clientId = process.env.ALEXA_EVENTS_CLIENT_ID;
  const clientSecret = process.env.ALEXA_EVENTS_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error('Alexa events client credentials are not configured');
  }
  return { clientId, clientSecret };
}

export async function exchangeAcceptGrantCode(
  code: string
): Promise<AlexaEventTokenPayload> {
  const { clientId, clientSecret } = getEventsClientCredentials();

  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[alexaEvents] AcceptGrant exchange failed', res.status, text);
    throw new Error('Failed to exchange AcceptGrant code');
  }

  const data = await res.json();
  const now = Date.now();
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: now + expiresIn * 1000,
  };
}

export async function refreshAlexaEventToken(
  refreshToken: string
): Promise<AlexaEventTokenPayload> {
  const { clientId, clientSecret } = getEventsClientCredentials();

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  });

  const res = await fetch('https://api.amazon.com/auth/o2/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    console.error('[alexaEvents] Token refresh failed', res.status, text);
    throw new Error('Failed to refresh Alexa event token');
  }

  const data = await res.json();
  const now = Date.now();
  const expiresIn = typeof data.expires_in === 'number' ? data.expires_in : 3600;

  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token ?? refreshToken,
    expiresAt: now + expiresIn * 1000,
  };
}

export async function getAlexaEventAccessTokenForUser(userId: number): Promise<string> {
  let record = await prisma.alexaEventToken.findUnique({ where: { userId } });

  if (!record) {
    console.warn('[alexaEvents] No Event Gateway token for user', userId);
    throw new Error('No Alexa Event Gateway token for user');
  }

  const now = Date.now();
  if (record.expiresAt.getTime() - 5000 < now) {
    const refreshed = await refreshAlexaEventToken(record.refreshToken);
    record = await prisma.alexaEventToken.update({
      where: { userId },
      data: {
        accessToken: refreshed.accessToken,
        refreshToken: refreshed.refreshToken,
        expiresAt: new Date(refreshed.expiresAt),
      },
    });
  }

  return record.accessToken;
}

export async function sendAlexaChangeReport(
  userId: number,
  endpointId: string,
  properties: AlexaProperty[],
  causeType: AlexaChangeReportCause = 'PHYSICAL_INTERACTION'
) {
  if (!endpointId) {
    console.warn('[alexaEvents] Missing endpointId for ChangeReport');
    return;
  }

  if (!properties || properties.length === 0) {
    console.warn('[alexaEvents] No properties provided for ChangeReport', endpointId);
    return;
  }

  const gateway = getGatewayEndpoint();
  const token = await getAlexaEventAccessTokenForUser(userId);

  console.log('[alexaEvents] ChangeReport POST', {
    endpoint: gateway,
    endpointId,
    causeType,
    namespaces: properties.map((p) => p.namespace),
  });

  const changePayload = {
    event: {
      header: {
        namespace: 'Alexa',
        name: 'ChangeReport',
        messageId: randomUUID(),
        payloadVersion: '3',
      },
      endpoint: {
        endpointId,
      },
      payload: {
        change: {
          cause: {
            type: causeType,
          },
          properties,
        },
      },
    },
    context: {
      properties,
    },
  };

  const res = await fetch(gateway, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(changePayload),
  });

  const text = await res.text().catch(() => '');

  console.log('[alexaEvents] ChangeReport response', {
    endpointId,
    status: res.status,
    ok: res.ok,
    bodySnippet: text.slice(0, 200),
  });

  if (!res.ok) {
    console.error(
      '[alexaEvents] ChangeReport failed',
      endpointId,
      res.status,
      text
    );
    return;
  }

  console.log('[alexaEvents] ChangeReport sent', endpointId, causeType);
}
