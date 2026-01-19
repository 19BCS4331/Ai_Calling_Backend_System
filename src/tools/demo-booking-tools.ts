/**
 * Demo Booking Tools
 * Built-in tools for the VoiceDemo demo booking assistant
 * Integrates with Supabase for enquiry storage and n8n for calendar/email
 */

import { RegisteredTool } from '../types';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL || '';
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || '';

let supabase: SupabaseClient | null = null;

function getSupabaseClient(): SupabaseClient {
  if (!supabase && supabaseUrl && supabaseServiceKey) {
    supabase = createClient(supabaseUrl, supabaseServiceKey);
  }
  if (!supabase) {
    throw new Error('Supabase not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY');
  }
  return supabase;
}

/**
 * Demo booking tools for the voice demo assistant
 */
export const demoBookingTools: RegisteredTool[] = [
  {
    definition: {
      name: 'save_enquiry',
      description: 'Save or update customer enquiry information. Call this when you collect customer details like name, email, phone, or company.',
      parameters: {
        type: 'object',
        properties: {
          customer_name: {
            type: 'string',
            description: 'Customer\'s full name'
          },
          email: {
            type: 'string',
            description: 'Customer\'s email address'
          },
          mobile_number: {
            type: 'string',
            description: 'Customer\'s mobile number with country code (e.g., +91-9876543210)'
          },
          company_name: {
            type: 'string',
            description: 'Customer\'s company name (optional)'
          },
          use_case: {
            type: 'string',
            description: 'What the customer wants to use VocaCore AI for'
          }
        },
        required: ['customer_name']
      }
    },
    handler: async (args, context) => {
      try {
        const db = getSupabaseClient();
        
        // Check if enquiry already exists for this session
        const { data: existing } = await db
          .from('demo_enquiries')
          .select('id')
          .eq('session_id', context.sessionId)
          .single();

        const enquiryData = {
          customer_name: args.customer_name as string,
          email: args.email as string || null,
          mobile_number: args.mobile_number as string || null,
          company_name: args.company_name as string || null,
          metadata: {
            use_case: args.use_case as string || null,
            collected_at: new Date().toISOString()
          },
          session_id: context.sessionId,
          updated_at: new Date().toISOString()
        };

        if (existing) {
          // Update existing enquiry
          const { error } = await db
            .from('demo_enquiries')
            .update(enquiryData)
            .eq('id', existing.id);

          if (error) throw error;
          
          context.logger.info('Enquiry updated', { sessionId: context.sessionId });
          return { 
            success: true, 
            message: 'Customer information saved successfully',
            enquiry_id: existing.id
          };
        } else {
          // Create new enquiry
          const { data, error } = await db
            .from('demo_enquiries')
            .insert({
              ...enquiryData,
              status: 'new',
              source: 'voice_demo'
            })
            .select('id')
            .single();

          if (error) throw error;
          
          context.logger.info('Enquiry created', { sessionId: context.sessionId, enquiryId: data.id });
          return { 
            success: true, 
            message: 'Customer information saved successfully',
            enquiry_id: data.id
          };
        }
      } catch (error) {
        context.logger.error('Failed to save enquiry', { error: (error as Error).message });
        return { 
          success: false, 
          message: 'I encountered an issue saving your information. Let me try again.',
          error: (error as Error).message
        };
      }
    }
  },

  {
    definition: {
      name: 'check_calendar',
      description: 'Check available demo slots for a given date. Use this when customer asks about availability.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Date to check availability for (YYYY-MM-DD format or natural like "tomorrow", "next Monday")'
          },
          timezone: {
            type: 'string',
            description: 'Customer\'s timezone (default: Asia/Kolkata)'
          }
        },
        required: ['date']
      }
    },
    handler: async (args, context) => {
      // This is a placeholder that returns mock availability
      // In production, this would call n8n workflow to check Google Calendar
      const date = args.date as string;
      const timezone = (args.timezone as string) || 'Asia/Kolkata';
      
      context.logger.info('Checking calendar availability', { date, timezone });
      
      // Parse natural language dates
      let targetDate = new Date();
      const lowerDate = date.toLowerCase();
      
      if (lowerDate === 'tomorrow') {
        targetDate.setDate(targetDate.getDate() + 1);
      } else if (lowerDate.includes('monday')) {
        const daysUntilMonday = (1 - targetDate.getDay() + 7) % 7 || 7;
        targetDate.setDate(targetDate.getDate() + daysUntilMonday);
      } else if (lowerDate.includes('tuesday')) {
        const daysUntilTuesday = (2 - targetDate.getDay() + 7) % 7 || 7;
        targetDate.setDate(targetDate.getDate() + daysUntilTuesday);
      } else if (lowerDate.includes('wednesday')) {
        const daysUntilWed = (3 - targetDate.getDay() + 7) % 7 || 7;
        targetDate.setDate(targetDate.getDate() + daysUntilWed);
      } else if (lowerDate.includes('thursday')) {
        const daysUntilThurs = (4 - targetDate.getDay() + 7) % 7 || 7;
        targetDate.setDate(targetDate.getDate() + daysUntilThurs);
      } else if (lowerDate.includes('friday')) {
        const daysUntilFri = (5 - targetDate.getDay() + 7) % 7 || 7;
        targetDate.setDate(targetDate.getDate() + daysUntilFri);
      } else {
        // Try parsing as date
        const parsed = new Date(date);
        if (!isNaN(parsed.getTime())) {
          targetDate = parsed;
        }
      }

      const dayOfWeek = targetDate.getDay();
      const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;
      
      if (isWeekend) {
        return {
          date: targetDate.toISOString().split('T')[0],
          available: false,
          message: 'We don\'t have demo slots on weekends. Would you like to check a weekday instead?',
          available_slots: []
        };
      }

      // Mock available slots (in production, fetch from Google Calendar via n8n)
      const slots = [
        '10:00 AM',
        '11:30 AM',
        '2:00 PM',
        '3:30 PM',
        '5:00 PM'
      ];

      return {
        date: targetDate.toISOString().split('T')[0],
        day: targetDate.toLocaleDateString('en-US', { weekday: 'long' }),
        available: true,
        available_slots: slots,
        timezone,
        message: `I have slots available on ${targetDate.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}`
      };
    }
  },

  {
    definition: {
      name: 'book_demo',
      description: 'Book a demo slot for the customer. Use this after confirming date, time, and customer details.',
      parameters: {
        type: 'object',
        properties: {
          date: {
            type: 'string',
            description: 'Demo date (YYYY-MM-DD format)'
          },
          time: {
            type: 'string',
            description: 'Demo time (e.g., "10:00 AM", "2:30 PM")'
          },
          customer_name: {
            type: 'string',
            description: 'Customer\'s name for the booking'
          },
          customer_email: {
            type: 'string',
            description: 'Customer\'s email for calendar invite'
          },
          notes: {
            type: 'string',
            description: 'Any special notes or requirements'
          }
        },
        required: ['date', 'time', 'customer_name', 'customer_email']
      }
    },
    handler: async (args, context) => {
      try {
        const db = getSupabaseClient();
        
        const bookingDate = new Date(`${args.date}T${args.time}`);
        
        // Update the enquiry with scheduled demo info
        const { error } = await db
          .from('demo_enquiries')
          .update({
            scheduled_date: bookingDate.toISOString(),
            status: 'demo_scheduled',
            customer_name: args.customer_name,
            email: args.customer_email,
            notes: args.notes || null,
            metadata: {
              booked_at: new Date().toISOString(),
              booked_time: args.time,
              booked_date: args.date
            },
            updated_at: new Date().toISOString()
          })
          .eq('session_id', context.sessionId);

        if (error) throw error;

        context.logger.info('Demo booked', { 
          sessionId: context.sessionId,
          date: args.date,
          time: args.time,
          customer: args.customer_name
        });

        // In production, this would trigger n8n workflow to:
        // 1. Create Google Calendar event
        // 2. Send confirmation email

        return {
          success: true,
          booking_confirmed: true,
          date: args.date,
          time: args.time,
          customer_name: args.customer_name,
          customer_email: args.customer_email,
          message: `Demo booked for ${args.customer_name} on ${args.date} at ${args.time}. A calendar invite will be sent to ${args.customer_email}.`
        };
      } catch (error) {
        context.logger.error('Failed to book demo', { error: (error as Error).message });
        return {
          success: false,
          message: 'I had trouble booking the demo. Let me try again.',
          error: (error as Error).message
        };
      }
    }
  },

  {
    definition: {
      name: 'send_followup_email',
      description: 'Queue a follow-up email to be sent after the call ends. Call this when the conversation is wrapping up.',
      parameters: {
        type: 'object',
        properties: {
          email_type: {
            type: 'string',
            enum: ['thank_you', 'demo_confirmation', 'more_info'],
            description: 'Type of follow-up email to send'
          },
          customer_email: {
            type: 'string',
            description: 'Customer\'s email address'
          },
          customer_name: {
            type: 'string',
            description: 'Customer\'s name for personalization'
          }
        },
        required: ['email_type', 'customer_email', 'customer_name']
      }
    },
    handler: async (args, context) => {
      try {
        const db = getSupabaseClient();
        
        // Mark the enquiry for follow-up email
        const { error } = await db
          .from('demo_enquiries')
          .update({
            metadata: {
              pending_email: {
                type: args.email_type,
                customer_email: args.customer_email,
                customer_name: args.customer_name,
                queued_at: new Date().toISOString()
              }
            },
            updated_at: new Date().toISOString()
          })
          .eq('session_id', context.sessionId);

        if (error) throw error;

        context.logger.info('Follow-up email queued', { 
          sessionId: context.sessionId,
          emailType: args.email_type,
          customer: args.customer_email
        });

        const emailType = args.email_type as string;
        return {
          success: true,
          message: `A ${emailType.replace('_', ' ')} email will be sent to ${args.customer_email} after our call.`,
          email_type: emailType
        };
      } catch (error) {
        context.logger.error('Failed to queue email', { error: (error as Error).message });
        return {
          success: false,
          message: 'I\'ll make sure someone follows up with you by email.',
          error: (error as Error).message
        };
      }
    }
  }
];

export default demoBookingTools;
