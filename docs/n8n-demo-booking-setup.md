# n8n Demo Booking Workflow Setup

This guide explains how to set up n8n workflows for the VocaCore AI demo booking system.

## Overview

The demo booking system uses n8n as an MCP (Model Context Protocol) server to:
1. Check Google Calendar availability
2. Create calendar events for demo bookings
3. Send personalized follow-up emails

## Prerequisites

- n8n instance (self-hosted or cloud)
- Google Calendar API access
- Email service (SMTP, SendGrid, or Resend)

## n8n Workflow Structure

Create the following workflows in n8n:

### 1. Check Calendar Availability

**Trigger**: Webhook (MCP tool call)  
**Name**: `check_calendar`

```
Webhook → Google Calendar (Get Events) → Code (Filter Available Slots) → Respond to Webhook
```

**Input Parameters**:
- `date`: Date to check (YYYY-MM-DD)
- `timezone`: Customer's timezone

**Output**:
```json
{
  "available": true,
  "slots": ["10:00 AM", "11:30 AM", "2:00 PM", "3:30 PM"],
  "date": "2024-01-20"
}
```

### 2. Book Demo Slot

**Trigger**: Webhook (MCP tool call)  
**Name**: `book_demo`

```
Webhook → Google Calendar (Create Event) → Send Email (Confirmation) → Respond to Webhook
```

**Input Parameters**:
- `date`: Demo date
- `time`: Demo time
- `customer_name`: Customer's name
- `customer_email`: Customer's email
- `notes`: Any special requirements

**Output**:
```json
{
  "success": true,
  "calendar_event_id": "abc123",
  "message": "Demo scheduled successfully"
}
```

### 3. Send Follow-up Email

**Trigger**: Webhook (MCP tool call)  
**Name**: `send_followup_email`

```
Webhook → Code (Select Template) → Send Email → Update Supabase → Respond to Webhook
```

**Email Templates**:

#### Thank You Email
```
Subject: Thanks for trying VocaCore AI, {{customer_name}}!

Hi {{customer_name}},

Thank you for taking the time to experience VocaCore AI today. It was great chatting with you!

If you have any questions about what you heard, or want to explore how VocaCore AI can help your business, just reply to this email.

Looking forward to hearing from you!

Best,
Maya
VocaCore AI Team
```

#### Demo Confirmation Email
```
Subject: Your VocaCore AI Demo is Confirmed! 📅

Hi {{customer_name}},

Great news! Your personalized VocaCore AI demo is scheduled for:

📅 Date: {{demo_date}}
⏰ Time: {{demo_time}} IST
📍 Meeting Link: [Will be shared before the demo]

What to expect:
- 30-minute personalized walkthrough
- Live demo tailored to your use case
- Q&A with our product team
- Special early-adopter pricing (if interested)

See you soon!

Best,
The VocaCore AI Team
```

## n8n MCP Setup

1. Install the n8n MCP community node (if not already installed)
2. Enable MCP in your n8n settings
3. Configure the MCP endpoint URL

### Exposing n8n as MCP Server

Add this to your n8n environment:

```bash
N8N_MCP_ENABLED=true
N8N_MCP_PATH=/mcp
```

The MCP endpoint will be available at: `http://your-n8n-url/mcp/sse`

## Environment Variables

Add these to your VocaCore AI `.env` file:

```bash
# n8n MCP Connection
N8N_MCP_URL=http://localhost:5678/mcp/sse
N8N_MCP_API_KEY=your_n8n_api_key

# Google Calendar
GOOGLE_CALENDAR_ID=your_calendar@group.calendar.google.com

# Email Settings
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password
DEMO_FROM_EMAIL=maya@vocaai.com
DEMO_FROM_NAME=Maya from VocaCore AI
```

## Testing the Integration

1. Start your n8n instance
2. Import the workflow templates
3. Test each webhook endpoint manually
4. Start the VocaCore AI backend with MCP enabled
5. Try the voice demo - the AI should be able to:
   - Save your contact info
   - Check calendar availability
   - Book a demo slot
   - Queue a follow-up email

## Fallback Behavior

If n8n is unavailable, the built-in tools will:
- `save_enquiry`: Store data in Supabase directly ✅
- `check_calendar`: Return mock availability ✅
- `book_demo`: Store booking in Supabase, flag for manual calendar entry ✅
- `send_followup_email`: Queue email in Supabase for batch sending ✅

## Supabase Table Schema

The `demo_enquiries` table stores all enquiry data:

```sql
CREATE TABLE demo_enquiries (
  id UUID PRIMARY KEY,
  customer_name VARCHAR(255),
  mobile_number VARCHAR(20),
  email VARCHAR(255),
  company_name VARCHAR(255),
  preferred_dates JSONB,
  scheduled_date TIMESTAMPTZ,
  calendar_event_id VARCHAR(255),
  session_id UUID,
  call_duration_seconds INTEGER,
  transcript TEXT,
  status enquiry_status,  -- new, contacted, demo_scheduled, demo_completed, converted, not_interested
  notes TEXT,
  follow_up_email_sent BOOLEAN,
  follow_up_email_sent_at TIMESTAMPTZ,
  source VARCHAR(50),
  metadata JSONB,
  created_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ
);
```

## Monitoring

Check the `demo_enquiries` table for:
- New leads: `status = 'new'`
- Pending emails: `follow_up_email_sent = false AND email IS NOT NULL`
- Scheduled demos: `status = 'demo_scheduled'`

Set up a daily n8n workflow to:
1. Send pending follow-up emails
2. Update email sent status
3. Alert on failed bookings
