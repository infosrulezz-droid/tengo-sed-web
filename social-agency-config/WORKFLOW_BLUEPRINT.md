# 🗺️ n8n WORKFLOW BLUEPRINT (Pro-Edition)

This document maps the technical flow from AI idea to live social media post.

## 🔄 Loop 1: The Production (Cold Loop)
`Trigger: Weekly Schedule`
  --> `OpenAI Node (Strategist)` --> (Input: Anchor Content)
  --> `Google Sheets/Notion` (Create 7 Rows: "Planned")
  --> `OpenAI Node (Copywriter)` --> (Input: Topic + Brand Bible)
  --> `Google Sheets/Notion` (Update Row: "Drafting")
  --> `OpenAI Node (Visual Director)` --> (Input: Caption)
  --> `DALL-E 3 / Midjourney API` --> (Generate Image)
  --> `Google Sheets/Notion` (Update Row: "Ready" + Image URL)

## 🔄 Loop 2: The Approval (Human-in-the-Loop)
`Trigger: Row Status == 'Ready'`
  --> `Telegram/Discord Node` (Send Image + Caption + Approve/Edit Buttons)
  --> `Wait Node` (Wait for User Input)
  --> `Conditional Switch`
       - IF [Approve] --> Move to Loop 3.
       - IF [Edit] --> Route back to Copywriter.
       - IF [Reject] --> Delete Row.

## 🔄 Loop 3: The Publishing (Hot Loop)
`Trigger: Approval Received`
  --> `HTTP Request (AI Social Media Scheduler API)`
  --> `Payload: {caption, media_url, schedule_time}`
  --> `Google Sheets/Notion` (Update Status: "Scheduled")
  --> `Scheduler` (Pushes to YT/TikTok/IG at specified time)

## 🔄 Loop 4: The Growth (Engagement Loop)
`Trigger: Webhook (New Comment/DM)`
  --> `OpenAI Node (Engagement Manager)` --> (Input: Comment + Brand Bible)
  --> `Conditional Switch`
       - IF [Lead] --> Notify User via Telegram (Urgent).
       - IF [Question/Compliment] --> Post Reply to IG API.
