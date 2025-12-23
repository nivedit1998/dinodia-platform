import { NextRequest, NextResponse } from 'next/server';
import { approveAuthChallengeByToken } from '@/lib/authChallenges';

export const runtime = 'nodejs';

const REASON_COPY: Record<string, string> = {
  EXPIRED: 'This verification link has expired. Please start again from your device.',
  ALREADY_CONSUMED: 'This verification link was already used.',
  NOT_FOUND: 'We could not find this verification request.',
};

export async function GET(req: NextRequest) {
  const token = req.nextUrl.searchParams.get('token');
  if (!token) {
    return new NextResponse(renderPage('Missing token.'), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  const result = await approveAuthChallengeByToken(token);

  if (!result.ok) {
    const message =
      REASON_COPY[result.reason ?? ''] ||
      'This verification link is not valid.';
    return new NextResponse(renderPage(message), {
      status: 400,
      headers: { 'Content-Type': 'text/html; charset=utf-8' },
    });
  }

  return new NextResponse(renderPage('Approved. Return to the device where you’re signing in.'), {
    status: 200,
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}

function renderPage(message: string) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Dinodia verification</title>
    <style>
      body { font-family: Arial, sans-serif; background: #f8fafc; color: #0f172a; margin: 0; padding: 40px; }
      .card { max-width: 560px; margin: 0 auto; background: #fff; border: 1px solid #e2e8f0; border-radius: 12px; padding: 24px; box-shadow: 0 12px 30px rgba(15, 23, 42, 0.08); }
      h1 { margin: 0 0 12px 0; font-size: 22px; }
      p { margin: 0; line-height: 1.5; }
    </style>
  </head>
  <body>
    <div class="card">
      <h1>Dinodia Smart Living</h1>
      <p>${message}</p>
    </div>
  </body>
</html>`;
}
