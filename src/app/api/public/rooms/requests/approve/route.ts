import { NextRequest, NextResponse } from 'next/server';
import { RoomAccessApprovalKind } from '@prisma/client';
import { approveOrRejectRoomAccessByToken } from '@/lib/roomAccess';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function redirectWithStatus(req: NextRequest, status: string) {
  const url = new URL('/rooms/requests/result', req.url);
  url.searchParams.set('status', status);
  return NextResponse.redirect(url, { status: 302 });
}

export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get('token')?.trim() ?? '';
  if (!token) return redirectWithStatus(req, 'NOT_FOUND');

  try {
    const result = await approveOrRejectRoomAccessByToken({ tokenRaw: token, kind: RoomAccessApprovalKind.APPROVE });
    if (!result.ok) {
      return redirectWithStatus(req, result.reason);
    }
    return redirectWithStatus(req, result.decision);
  } catch {
    return redirectWithStatus(req, 'ERROR');
  }
}
