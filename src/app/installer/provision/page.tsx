import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';
import ProvisionClient from './provisionClient';

export const dynamic = 'force-dynamic';

export default async function InstallerProvisionPage() {
  const user = await getCurrentUser();
  if (!user) redirect('/installer/login');
  if (user.role !== Role.INSTALLER) redirect('/login');

  return <ProvisionClient installerName={user.username} />;
}
