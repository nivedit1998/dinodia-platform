import { NextRequest, NextResponse } from 'next/server';

export async function POST(req: NextRequest) {
  return NextResponse.json(
    { error: 'Deprecated. Bootstrap the first CXO with a one-time SQL insert.' },
    { status: 410 }
  );
}
