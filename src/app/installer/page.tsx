import { redirect } from 'next/navigation';
import { Role } from '@prisma/client';
import { getCurrentUser } from '@/lib/auth';

export default async function InstallerIndexPage() {
  const user = await getCurrentUser();
  if (user?.role === Role.INSTALLER) {
    redirect('/installer/provision');
  }
  redirect('/installer/login');
}
