import { NextRequest, NextResponse } from 'next/server';
import { prisma } from '@/lib/prisma';
import { getCurrentUser } from '@/lib/auth';
import { Role } from '@prisma/client';

type HaState = {
  entity_id: string;
  state: string;
  attributes: {
    friendly_name?: string;
    area?: string;
    label?: string;
    [key: string]: any;
  };
};

export async function GET(req: NextRequest) {
  const me = await getCurrentUser();
  if (!me) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const user = await prisma.user.findUnique({
    where: { id: me.id },
    include: {
      haConnection: true,
      accessRules: true,
    },
  });

  if (!user || !user.haConnection) {
    return NextResponse.json({ error: 'HA connection not configured' }, { status: 400 });
  }

  const { baseUrl, longLivedToken } = user.haConnection;

  let states: HaState[] = [];
  try {
    const res = await fetch(`${baseUrl}/api/states`, {
      headers: {
        Authorization: `Bearer ${longLivedToken}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('HA error:', text);
      return NextResponse.json({ error: 'Failed to fetch HA states' }, { status: 502 });
    }

    states = await res.json();
  } catch (e) {
    console.error(e);
    return NextResponse.json({ error: 'Failed to connect to HA' }, { status: 502 });
  }

  let filtered = states;

  if (user.role === Role.TENANT) {
    const rules = user.accessRules;
    filtered = states.filter((s) => {
      const area = (s.attributes as any).area;
      const label = (s.attributes as any).label;
      return rules.some((r) => r.area === area && r.label === label);
    });
  }

  // Shape data for UI
  const devices = filtered.map((s) => ({
    entityId: s.entity_id,
    name: s.attributes.friendly_name ?? s.entity_id,
    state: s.state,
    area: (s.attributes as any).area ?? null,
    label: (s.attributes as any).label ?? null,
  }));

  return NextResponse.json({ devices });
}
