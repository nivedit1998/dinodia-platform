import { NextRequest, NextResponse } from 'next/server';
import { getCurrentUserFromRequest } from '@/lib/auth';
import { getUserWithHaConnection } from '@/lib/haConnection';
import { getDevicesForHaConnection } from '@/lib/devicesSnapshot';
import { Role } from '@prisma/client';
import { logApiHit } from '@/lib/requestLog';
import { safeLog } from '@/lib/safeLogger';
import { getTenantOwnedTargetsForHome, getTenantOwnedTargetsForUser } from '@/lib/tenantOwnership';
import { getServicesForTargetWs } from '@/lib/homeAssistant';
import type { HaConnectionLike } from '@/lib/homeAssistant';

export async function GET(req: NextRequest) {
  logApiHit(req, '/api/devices', { fresh: req.nextUrl.searchParams.get('fresh') === '1' });

  const me = await getCurrentUserFromRequest(req);
  if (!me) {
    return NextResponse.json(
      { error: 'Your session has ended. Please sign in again.' },
      { status: 401 }
    );
  }

  if (me.role === Role.ADMIN) {
    return NextResponse.json(
      { error: 'Admin dashboards are observe-only.' },
      { status: 403 }
    );
  }

  const fresh = req.nextUrl.searchParams.get('fresh');
  const bypassCache = fresh === '1';
  const includeServicesForTarget =
    req.nextUrl.searchParams.get('include_services_for_target') === '1';

  const debugServicesForTarget = req.nextUrl.searchParams.get('debug_services_for_target') === '1';
  const debugEntityId = String(req.nextUrl.searchParams.get('debug_entity_id') || '').trim();

  let user;
  let haConnection;
  try {
    ({ user, haConnection } = await getUserWithHaConnection(me.id));
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message || 'Dinodia Hub connection isn’t set up yet for this home.' },
      { status: 400 }
    );
  }

  let devices: Awaited<ReturnType<typeof getDevicesForHaConnection>>;
  try {
    devices = await getDevicesForHaConnection(haConnection.id, {
      bypassCache,
      labelsOnly: true,
      includeServicesForTarget,
    });
  } catch (err) {
    safeLog('error', '[api/devices] Failed to fetch devices from HA', { error: err });
    return NextResponse.json(
      { error: 'Dinodia Hub did not respond when loading devices.' },
      { status: 502 }
    );
  }

  const tenantOwnedForHome = await getTenantOwnedTargetsForHome(user.homeId!, haConnection.id);
  const tenantOwnedForUser = await getTenantOwnedTargetsForUser(user.id, haConnection.id);
  const allTenantOwnedEntityIds = new Set(tenantOwnedForHome.entityIds);
  const ownTenantOwnedEntityIds = new Set(tenantOwnedForUser.entityIds);
  const allowedAreas = new Set((user.accessRules ?? []).map((rule) => rule.area));

  const result = devices.filter((device) => {
    if (ownTenantOwnedEntityIds.has(device.entityId)) {
      return true;
    }

    if (allTenantOwnedEntityIds.has(device.entityId)) {
      return false;
    }

    return Boolean(device.areaName && allowedAreas.has(device.areaName));
  });

  if (debugServicesForTarget && debugEntityId) {
    const isAccessible = result.some((d) => d.entityId === debugEntityId);
    if (!isAccessible) {
      safeLog('warn', '[api/devices] debug_services_for_target skipped (entity not accessible)', {
        entityId: debugEntityId,
        resultCount: result.length,
      });
    } else {
      const normalizeUrl = (url: string) => url.trim().replace(/\/+$/, '');
      const candidates: Array<{ endpoint: 'cloud' | 'base'; ha: HaConnectionLike }> = [];

      const cloudUrl =
        typeof haConnection.cloudUrl === 'string' ? normalizeUrl(haConnection.cloudUrl) : '';
      const baseUrl = normalizeUrl(haConnection.baseUrl);

      if (cloudUrl) {
        candidates.push({
          endpoint: 'cloud',
          ha: { baseUrl: cloudUrl, longLivedToken: haConnection.longLivedToken },
        });
      }
      candidates.push({
        endpoint: 'base',
        ha: { baseUrl, longLivedToken: haConnection.longLivedToken },
      });

      let lastError: unknown = null;
      for (const candidate of candidates) {
        try {
          const services = await getServicesForTargetWs(candidate.ha, debugEntityId);
          safeLog('info', '[api/devices] get_services_for_target', {
            entityId: debugEntityId,
            endpoint: candidate.endpoint,
            serviceCount: services.length,
            servicesPreview: services.slice(0, 25).join(', '),
          });
          lastError = null;
          break;
        } catch (err) {
          lastError = err;
          safeLog('warn', '[api/devices] get_services_for_target failed', {
            entityId: debugEntityId,
            endpoint: candidate.endpoint,
            error: err,
          });
        }
      }

      if (lastError) {
        safeLog('warn', '[api/devices] get_services_for_target exhausted candidates', {
          entityId: debugEntityId,
        });
      }
    }
  }

  if (process.env.NODE_ENV !== 'production') {
    const interestingLabels = new Set(['Motion Sensor', 'TV', 'Spotify']);
    const sample = result.filter((d) => {
      const labels = Array.isArray(d.labels) ? d.labels : [];
      const candidates = [
        d.label ?? '',
        ...labels,
        d.labelCategory ?? '',
      ].map((lbl) => (lbl ? lbl.toString().trim() : ''));
      return candidates.some((lbl) => interestingLabels.has(lbl));
    });
    if (sample.length > 0) {
      safeLog('debug', '[api/devices] sample summary', {
        sampleCount: sample.length,
        resultCount: result.length,
      });
    }
  }

  return NextResponse.json({ devices: result });
}
