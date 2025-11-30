import { getCurrentUser } from '@/lib/auth';
import { Role } from '@prisma/client';
import AdminDashboard from './ui/AdminDashboard';

export default async function AdminPage() {
  const user = await getCurrentUser();
  if (!user || user.role !== Role.ADMIN) {
    // Very simple guard – could redirect
    return (
      <div className="bg-white rounded-2xl shadow-lg p-8">
        <p className="text-sm">Unauthorized. Please go back to login.</p>
      </div>
    );
  }

  return <AdminDashboard username={user.username} />;
}
