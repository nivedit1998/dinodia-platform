import { HaWsClient } from '@/lib/haWebSocket';
import type { HaConnectionLike } from '@/lib/homeAssistant';

export type HaConfigFlowStep = {
  type: string;
  flow_id?: string;
  handler?: string;
  step_id?: string;
  data_schema?: unknown;
  description_placeholders?: Record<string, unknown>;
  errors?: Record<string, string>;
  progress_action?: string;
};

function sanitizeFlowStep(step: unknown): HaConfigFlowStep {
  if (!step || typeof step !== 'object') {
    return { type: 'unknown' };
  }
  const obj = step as Record<string, unknown>;
  return {
    type: typeof obj.type === 'string' ? obj.type : 'unknown',
    flow_id: typeof obj.flow_id === 'string' ? obj.flow_id : undefined,
    handler: typeof obj.handler === 'string' ? obj.handler : undefined,
    step_id: typeof obj.step_id === 'string' ? obj.step_id : undefined,
    data_schema: obj.data_schema,
    description_placeholders:
      obj.description_placeholders && typeof obj.description_placeholders === 'object'
        ? (obj.description_placeholders as Record<string, unknown>)
        : undefined,
    errors:
      obj.errors && typeof obj.errors === 'object'
        ? (obj.errors as Record<string, string>)
        : undefined,
    progress_action: typeof obj.progress_action === 'string' ? obj.progress_action : undefined,
  };
}

export async function startMatterConfigFlow(ha: HaConnectionLike): Promise<HaConfigFlowStep> {
  const client = await HaWsClient.connect(ha);
  try {
    const step = await client.call('config_entries/flow/init', {
      handler: 'matter',
      show_advanced_options: true,
    });
    return sanitizeFlowStep(step);
  } finally {
    client.close();
  }
}

export async function continueMatterConfigFlow(
  ha: HaConnectionLike,
  flowId: string,
  userInput: Record<string, unknown>
): Promise<HaConfigFlowStep> {
  const client = await HaWsClient.connect(ha);
  try {
    const step = await client.call('config_entries/flow/configure', {
      flow_id: flowId,
      user_input: userInput,
    });
    return sanitizeFlowStep(step);
  } finally {
    client.close();
  }
}

export async function abortMatterConfigFlow(ha: HaConnectionLike, flowId: string): Promise<void> {
  const client = await HaWsClient.connect(ha);
  try {
    await client.call('config_entries/flow/abort', {
      flow_id: flowId,
    });
  } catch (err) {
    console.warn('[matterConfigFlow] Failed to abort flow', { flowId, err });
  } finally {
    client.close();
  }
}
