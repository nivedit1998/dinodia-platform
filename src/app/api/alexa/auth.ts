import { NextRequest } from 'next/server';
import { AuthUser, getCurrentUser, getUserFromAuthorizationHeader } from '@/lib/auth';

export async function resolveAlexaAuthUser(req: NextRequest): Promise<AuthUser | null> {
  const authorization = req.headers.get('authorization');
  const bearerUser = await getUserFromAuthorizationHeader(authorization);
  if (bearerUser) return bearerUser;
  return getCurrentUser();
}
