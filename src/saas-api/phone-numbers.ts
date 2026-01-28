/**
 * Phone Numbers Helper Functions
 * Functions for retrieving phone number and agent information for telephony routing
 */

import { supabaseAdmin } from './db';
import { Agent } from './types';

export interface PhoneNumberWithAgent {
  id: string;
  phone_number: string;
  country_code: string;
  telephony_provider: string;
  agent_id: string | null;
  agent?: Agent | null;
}

/**
 * Get phone number by number string
 */
export async function getPhoneNumberByNumber(
  phoneNumber: string
): Promise<PhoneNumberWithAgent | null> {
  console.log('[phone-numbers] Looking up phone number:', phoneNumber);
  
  // Normalize phone number - remove + prefix if present
  const normalizedNumber = phoneNumber.startsWith('+') ? phoneNumber.substring(1) : phoneNumber;
  
  console.log('[phone-numbers] Normalized phone number:', normalizedNumber);
  
  const { data, error } = await supabaseAdmin
    .from('phone_numbers')
    .select(`
      *,
      agent:agents(*)
    `)
    .eq('phone_number', normalizedNumber)
    .eq('is_active', true)
    .single();

  if (error) {
    console.error('[phone-numbers] Error looking up phone number:', {
      phoneNumber,
      error: error.message,
      code: error.code
    });
    return null;
  }

  if (!data) {
    console.log('[phone-numbers] No phone number found for:', phoneNumber);
    return null;
  }

  console.log('[phone-numbers] Found phone number:', {
    id: data.id,
    phone_number: data.phone_number,
    agent_id: data.agent_id,
    has_agent: !!data.agent
  });

  return data as PhoneNumberWithAgent;
}

/**
 * Get agent configuration for a phone number
 */
export async function getAgentForPhoneNumber(
  phoneNumber: string
): Promise<Agent | null> {
  console.log('[phone-numbers] Getting agent for phone number:', phoneNumber);
  
  const phoneNumberData = await getPhoneNumberByNumber(phoneNumber);
  
  if (!phoneNumberData) {
    console.log('[phone-numbers] No phone number data found');
    return null;
  }

  if (!phoneNumberData.agent_id) {
    console.log('[phone-numbers] Phone number has no agent_id');
    return null;
  }

  console.log('[phone-numbers] Returning agent:', {
    agent_id: phoneNumberData.agent_id,
    agent_name: phoneNumberData.agent?.name
  });

  return phoneNumberData.agent as Agent | null;
}
