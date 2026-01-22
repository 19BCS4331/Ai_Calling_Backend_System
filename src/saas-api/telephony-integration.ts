/**
 * Telephony Integration Service
 * Handles Plivo account integration, application creation, and phone number management
 */

import { supabaseAdmin } from './db';
import { SaaSError, OrgContext } from './types';
import { createLogger } from '../utils/logger';

const logger = createLogger('telephony-integration');

interface PlivoCredentials {
  authId: string;
  authToken: string;
}

interface PlivoApplication {
  app_id: string;
  app_name: string;
  answer_url: string;
  hangup_url: string;
}

interface PlivoNumber {
  number: string;
  country_iso: string;
  type: string;
  application?: string;
  voice_enabled: boolean;
  sms_enabled: boolean;
  monthly_rental_rate: string;
}

interface PlivoNumbersResponse {
  objects: PlivoNumber[];
}

/**
 * Validate Plivo credentials by making a test API call
 */
export async function validatePlivoCredentials(
  authId: string,
  authToken: string
): Promise<boolean> {
  try {
    const response = await fetch(
      `https://api.plivo.com/v1/Account/${authId}/`,
      {
        method: 'GET',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${authId}:${authToken}`).toString('base64'),
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      logger.warn('Plivo credential validation failed', { 
        status: response.status,
        authId 
      });
      return false;
    }

    return true;
  } catch (error) {
    logger.error('Error validating Plivo credentials', { 
      error: (error as Error).message 
    });
    return false;
  }
}

/**
 * Create a Plivo application with our webhook URLs
 */
export async function createPlivoApplication(
  authId: string,
  authToken: string,
  webhookBaseUrl: string,
  appName: string = 'VocaCore-AI'
): Promise<PlivoApplication> {
  try {
    // Sanitize app name: Plivo only allows letters, numbers, hyphens, and underscores
    const sanitizedAppName = appName
      .replace(/[^a-zA-Z0-9\-_]/g, '-')  // Replace invalid chars with hyphen
      .replace(/-+/g, '-')                // Replace multiple hyphens with single
      .replace(/^-|-$/g, '');             // Remove leading/trailing hyphens
    
    const answerUrl = `${webhookBaseUrl}/telephony/plivo/answer`;
    const hangupUrl = `${webhookBaseUrl}/telephony/plivo/status`;

    const response = await fetch(
      `https://api.plivo.com/v1/Account/${authId}/Application/`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${authId}:${authToken}`).toString('base64'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          app_name: sanitizedAppName,
          answer_url: answerUrl,
          answer_method: 'POST',
          hangup_url: hangupUrl,
          hangup_method: 'POST'
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to create Plivo application: ${error}`);
    }

    const data = await response.json() as { app_id: string; message: string; api_id: string };
    
    return {
      app_id: data.app_id,
      app_name: sanitizedAppName,
      answer_url: answerUrl,
      hangup_url: hangupUrl
    };
  } catch (error) {
    logger.error('Error creating Plivo application', { 
      error: (error as Error).message 
    });
    throw error;
  }
}

/**
 * Fetch all phone numbers from Plivo account
 */
export async function fetchPlivoNumbers(
  authId: string,
  authToken: string
): Promise<PlivoNumber[]> {
  try {
    const response = await fetch(
      `https://api.plivo.com/v1/Account/${authId}/Number/`,
      {
        method: 'GET',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${authId}:${authToken}`).toString('base64'),
          'Content-Type': 'application/json'
        }
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to fetch Plivo numbers: ${error}`);
    }

    const data = await response.json() as PlivoNumbersResponse;
    return data.objects || [];
  } catch (error) {
    logger.error('Error fetching Plivo numbers', { 
      error: (error as Error).message 
    });
    throw error;
  }
}

/**
 * Link a phone number to a Plivo application
 */
export async function linkNumberToApplication(
  authId: string,
  authToken: string,
  phoneNumber: string,
  appId: string
): Promise<void> {
  try {
    const response = await fetch(
      `https://api.plivo.com/v1/Account/${authId}/Number/${phoneNumber}/`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${authId}:${authToken}`).toString('base64'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          app_id: appId
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to link number to application: ${error}`);
    }

    logger.info('Phone number linked to Plivo application', { 
      phoneNumber, 
      appId 
    });
  } catch (error) {
    logger.error('Error linking number to application', { 
      error: (error as Error).message,
      phoneNumber,
      appId
    });
    throw error;
  }
}

/**
 * Unlink a phone number from a Plivo application
 */
export async function unlinkNumberFromApplication(
  authId: string,
  authToken: string,
  phoneNumber: string
): Promise<void> {
  try {
    const response = await fetch(
      `https://api.plivo.com/v1/Account/${authId}/Number/${phoneNumber}/`,
      {
        method: 'POST',
        headers: {
          'Authorization': 'Basic ' + Buffer.from(`${authId}:${authToken}`).toString('base64'),
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          app_id: ''
        })
      }
    );

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Failed to unlink number from application: ${error}`);
    }

    logger.info('Phone number unlinked from Plivo application', { phoneNumber });
  } catch (error) {
    logger.error('Error unlinking number from application', { 
      error: (error as Error).message,
      phoneNumber
    });
    throw error;
  }
}

/**
 * Store encrypted telephony credentials for an organization
 */
export async function storeTelephonyCredentials(
  orgId: string,
  provider: string,
  credentials: Record<string, string>
): Promise<void> {
  try {
    // Get provider ID
    const { data: providerData, error: providerError } = await supabaseAdmin
      .from('providers')
      .select('id')
      .eq('type', 'telephony')
      .eq('slug', provider)
      .single();

    if (providerError || !providerData) {
      throw new Error(`Provider not found: ${provider}`);
    }

    // Store credentials (encrypted at database level with pgcrypto)
    const { error: credError } = await supabaseAdmin
      .from('organization_provider_credentials')
      .upsert({
        organization_id: orgId,
        provider_id: providerData.id,
        credentials_encrypted: JSON.stringify(credentials),
        is_active: true,
        last_validated_at: new Date().toISOString()
      }, {
        onConflict: 'organization_id,provider_id'
      });

    if (credError) {
      throw credError;
    }

    logger.info('Telephony credentials stored', { orgId, provider });
  } catch (error) {
    logger.error('Error storing telephony credentials', { 
      error: (error as Error).message,
      orgId,
      provider
    });
    throw error;
  }
}

/**
 * Retrieve telephony credentials for an organization
 */
export async function getTelephonyCredentials(
  orgId: string,
  provider: string
): Promise<PlivoCredentials | null> {
  try {
    const { data: providerData, error: providerError } = await supabaseAdmin
      .from('providers')
      .select('id')
      .eq('type', 'telephony')
      .eq('slug', provider)
      .single();

    if (providerError || !providerData) {
      return null;
    }

    const { data: credData, error: credError } = await supabaseAdmin
      .from('organization_provider_credentials')
      .select('credentials_encrypted')
      .eq('organization_id', orgId)
      .eq('provider_id', providerData.id)
      .eq('is_active', true)
      .single();

    if (credError || !credData) {
      return null;
    }

    const credentials = JSON.parse(credData.credentials_encrypted);
    return credentials as PlivoCredentials;
  } catch (error) {
    logger.error('Error retrieving telephony credentials', { 
      error: (error as Error).message,
      orgId,
      provider
    });
    return null;
  }
}

/**
 * Delete telephony credentials for an organization
 */
export async function deleteTelephonyCredentials(
  orgId: string,
  provider: string
): Promise<void> {
  try {
    const { data: providerData, error: providerError } = await supabaseAdmin
      .from('providers')
      .select('id')
      .eq('type', 'telephony')
      .eq('slug', provider)
      .single();

    if (providerError || !providerData) {
      throw new Error(`Provider not found: ${provider}`);
    }

    const { error: deleteError } = await supabaseAdmin
      .from('organization_provider_credentials')
      .delete()
      .eq('organization_id', orgId)
      .eq('provider_id', providerData.id);

    if (deleteError) {
      throw deleteError;
    }

    logger.info('Telephony credentials deleted', { orgId, provider });
  } catch (error) {
    logger.error('Error deleting telephony credentials', { 
      error: (error as Error).message,
      orgId,
      provider
    });
    throw error;
  }
}

/**
 * Connect Plivo account - validates credentials, creates app, stores credentials
 */
export async function connectPlivoAccount(
  orgContext: OrgContext,
  authId: string,
  authToken: string,
  webhookBaseUrl: string
): Promise<{ appId: string; message: string }> {
  const orgId = orgContext.organization.id;

  // Step 1: Validate credentials
  const isValid = await validatePlivoCredentials(authId, authToken);
  if (!isValid) {
    throw SaaSError.validation('Invalid Plivo credentials');
  }

  // Step 2: Create Plivo application
  const app = await createPlivoApplication(
    authId,
    authToken,
    webhookBaseUrl,
    `VocaCore AI - ${orgContext.organization.name}`
  );

  // Step 3: Store credentials
  await storeTelephonyCredentials(orgId, 'plivo', {
    authId,
    authToken
  });

  // Step 4: Update organization with app ID
  const { error: updateError } = await supabaseAdmin
    .from('organizations')
    .update({ plivo_app_id: app.app_id })
    .eq('id', orgId);

  if (updateError) {
    throw new Error(`Failed to update organization: ${updateError.message}`);
  }

  logger.info('Plivo account connected', { 
    orgId, 
    appId: app.app_id 
  });

  return {
    appId: app.app_id,
    message: 'Plivo account connected successfully'
  };
}

/**
 * Disconnect Plivo account - removes credentials and app ID
 */
export async function disconnectPlivoAccount(
  orgContext: OrgContext
): Promise<void> {
  const orgId = orgContext.organization.id;

  // Remove credentials
  await deleteTelephonyCredentials(orgId, 'plivo');

  // Remove app ID from organization
  const { error: updateError } = await supabaseAdmin
    .from('organizations')
    .update({ plivo_app_id: null })
    .eq('id', orgId);

  if (updateError) {
    throw new Error(`Failed to update organization: ${updateError.message}`);
  }

  logger.info('Plivo account disconnected', { orgId });
}

/**
 * Get Plivo connection status for an organization
 */
export async function getPlivoConnectionStatus(
  orgContext: OrgContext
): Promise<{
  connected: boolean;
  appId: string | null;
  authId: string | null;
  numberCount: number;
}> {
  const orgId = orgContext.organization.id;

  // Get credentials
  const credentials = await getTelephonyCredentials(orgId, 'plivo');
  
  // Get app ID
  const { data: orgData } = await supabaseAdmin
    .from('organizations')
    .select('plivo_app_id')
    .eq('id', orgId)
    .single();

  // Count phone numbers
  const { count } = await supabaseAdmin
    .from('phone_numbers')
    .select('*', { count: 'exact', head: true })
    .eq('organization_id', orgId)
    .eq('telephony_provider', 'plivo');

  return {
    connected: !!credentials && !!orgData?.plivo_app_id,
    appId: orgData?.plivo_app_id || null,
    authId: credentials?.authId || null,
    numberCount: count || 0
  };
}
