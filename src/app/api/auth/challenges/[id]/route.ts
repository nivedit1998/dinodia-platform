import { NextRequest, NextResponse } from 'next/server';
import { getChallengeStatus } from '@/lib/authChallenges';

export const runtime = 'nodejs';

export async function GET(
  _req: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  const { id } = await context.params;
  const status = await getChallengeStatus(id);
  if (status === 'NOT_FOUND') {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  return NextResponse.json({ status });
}
