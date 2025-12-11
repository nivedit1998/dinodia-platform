import { AlexaAuthorizeForm } from './AlexaAuthorizeForm';
import { AlexaOAuthError, validateAlexaClientRequest } from '@/lib/alexaOAuth';

type SearchParams = { [key: string]: string | string[] | undefined };

function getParam(params: SearchParams, key: string): string | undefined {
  const value = params[key];
  if (Array.isArray(value)) return value[0];
  return value ?? undefined;
}

export default function AlexaAuthorizePage({
  searchParams,
}: {
  searchParams: SearchParams;
}) {
  const responseType = getParam(searchParams, 'response_type') ?? 'code';
  const clientId = getParam(searchParams, 'client_id');
  const redirectUri = getParam(searchParams, 'redirect_uri');
  const state = getParam(searchParams, 'state');
  const scope = getParam(searchParams, 'scope');

  let error: string | null = null;

  if (responseType !== 'code') {
    error = 'Unsupported response_type. Alexa must request an authorization code.';
  } else if (!clientId || !redirectUri) {
    error = 'Missing client_id or redirect_uri.';
  } else {
    try {
      validateAlexaClientRequest(clientId, redirectUri);
    } catch (err) {
      if (err instanceof AlexaOAuthError) {
        error = 'Alexa request is not valid. Please contact Dinodia support.';
      } else {
        throw err;
      }
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-slate-50 px-4 py-10">
      <div className="w-full max-w-md bg-white shadow-lg rounded-2xl p-8">
        <div className="text-center mb-6">
          <h1 className="text-2xl font-semibold">Link Dinodia to Alexa</h1>
          <p className="text-sm text-slate-500 mt-2">
            Sign in with your Dinodia account to connect Alexa to this home.
          </p>
        </div>

        {error ? (
          <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2 text-center">
            {error}
          </div>
        ) : (
          <AlexaAuthorizeForm
            clientId={clientId!}
            redirectUri={redirectUri!}
            responseType={responseType}
            state={state}
            scope={scope}
          />
        )}
      </div>
    </div>
  );
}
