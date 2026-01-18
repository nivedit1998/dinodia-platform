import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import HomeSupportClient from './HomeSupportClient';

export const dynamic = 'force-dynamic';

export default async function InstallerHomeSupportPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/installer/login');
  if (user.role !== Role.INSTALLER) redirect('/login');

  return <HomeSupportClient installerName={user.username} />;
}
