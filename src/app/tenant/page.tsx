import { getCurrentUser } from '@/lib/auth';
import TenantDashboard from './ui/TenantDashboard';
import { Role } from '@prisma/client';

export default async function TenantPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== Role.TENANT) {
    return (
      <div className="bg-white rounded-2xl shadow-lg p-8">
        <p className="text-sm">Unauthorized. Please go back to login.</p>
      </div>
    );
  }

  return <TenantDashboard username={user.username} />;
}
