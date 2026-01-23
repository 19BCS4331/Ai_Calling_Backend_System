-- Debug script to check which tools are enabled for an agent
-- Run this in Supabase SQL Editor to see the actual state

-- First, find your agent ID (replace with your agent name)
SELECT id, name, slug FROM agents WHERE name LIKE '%your_agent_name%';

-- Then check which tools are attached and their enabled status
-- Replace 'YOUR_AGENT_ID' with the actual agent ID from above
SELECT 
  at.id as agent_tool_id,
  at.is_enabled,
  t.name as tool_name,
  t.slug as tool_slug,
  t.type as tool_type,
  at.sort_order
FROM agent_tools at
JOIN tools t ON at.tool_id = t.id
WHERE at.agent_id = 'YOUR_AGENT_ID'
ORDER BY at.sort_order, t.name;

-- Count enabled vs disabled tools
SELECT 
  is_enabled,
  COUNT(*) as count
FROM agent_tools at
WHERE at.agent_id = 'YOUR_AGENT_ID'
GROUP BY is_enabled;
