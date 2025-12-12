import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { Role } from '@prisma/client';

export async function POST(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me || me.role !== Role.ADMIN) {
    return NextResponse.json({ error: 'Your session has ended. Please sign in again.' }, { status: 401 });
  }

  const body = await req.json();
  const { entityId, name, area, label } = body;

  if (!entityId || !name) {
    return NextResponse.json(
      { error: 'Please include both the device name and the entity id.' },
      { status: 400 }
    );
  }

  const admin = await prisma.user.findUnique({
    where: { id: me.id },
    include: { haConnection: true },
  });

  if (!admin || !admin.haConnection) {
    return NextResponse.json(
      { error: 'The homeowner’s Dinodia Hub connection is missing for this home.' },
      { status: 400 }
    );
  }

  const haConnectionId = admin.haConnection.id;

  const device = await prisma.device.upsert({
    where: {
      haConnectionId_entityId: {
        haConnectionId,
        entityId,
      },
    },
    update: {
      name,
      area: area && area.trim() !== '' ? area.trim() : null,
      label: label && label.trim() !== '' ? label.trim() : null,
    },
    create: {
      haConnectionId,
      entityId,
      name,
      area: area && area.trim() !== '' ? area.trim() : null,
      label: label && label.trim() !== '' ? label.trim() : null,
    },
  });

  return NextResponse.json({ ok: true, device });
}
