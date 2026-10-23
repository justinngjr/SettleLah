
export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[]

export type Database = {
  
  "graphql_public": {
          Tables: {
            [_ in never]: never
          }
          Views: {
            [_ in never]: never
          }
          Functions: {
            "graphql":
{ Args: { "extensions"?: Json,"operationName"?: string,"query"?: string,"variables"?: Json }; Returns: Json
                           }
          }
          Enums: {
            [_ in never]: never
          }
          CompositeTypes: {
            [_ in never]: never
          }
        },"public": {
          Tables: {
            "agent_actions": {
                  Row: {
                    "conversation_id": string,"created_at": string,"error": string | null,"executed_at": string | null,"expires_at": string,"host_id": string,"id": string,"input": NonNullable<Json>,"preview": NonNullable<Json>,"preview_hash": string,"resolved_at": string | null,"result": Json | null,"status": Database["public"]['Enums']["agent_action_status"],"tool": string,"tool_call_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "conversation_id": string,"created_at"?: string,"error"?: string | null,"executed_at"?: string | null,"expires_at"?: string,"host_id": string,"id"?: string,"input": NonNullable<Json>,"preview": NonNullable<Json>,"preview_hash": string,"resolved_at"?: string | null,"result"?: Json | null,"status"?: Database["public"]['Enums']["agent_action_status"],"tool": string,"tool_call_id": string
                  }
                  Update: {
                    "conversation_id"?: string,"created_at"?: string,"error"?: string | null,"executed_at"?: string | null,"expires_at"?: string,"host_id"?: string,"id"?: string,"input"?: NonNullable<Json>,"preview"?: NonNullable<Json>,"preview_hash"?: string,"resolved_at"?: string | null,"result"?: Json | null,"status"?: Database["public"]['Enums']["agent_action_status"],"tool"?: string,"tool_call_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_actions_conversation_fkey"
      columns: ["conversation_id","host_id"]
isOneToOne: false
      referencedRelation: "agent_conversations"
      referencedColumns: ["id","host_id"]
    }
                  ]
                },"agent_conversations": {
                  Row: {
                    "created_at": string,"host_id": string,"id": string,"title": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"host_id": string,"id"?: string,"title"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "created_at"?: string,"host_id"?: string,"id"?: string,"title"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"agent_messages": {
                  Row: {
                    "content": string,"conversation_id": string,"created_at": string,"host_id": string,"id": string,"role": Database["public"]['Enums']["agent_message_role"],"seq": number,"tool_call_id": string | null,"tool_calls": Json | null,"tool_result": Json | null
                  }
                  ComputedFields: never
                  Insert: {
                    "content"?: string,"conversation_id": string,"created_at"?: string,"host_id": string,"id"?: string,"role": Database["public"]['Enums']["agent_message_role"],"seq"?: never,"tool_call_id"?: string | null,"tool_calls"?: Json | null,"tool_result"?: Json | null
                  }
                  Update: {
                    "content"?: string,"conversation_id"?: string,"created_at"?: string,"host_id"?: string,"id"?: string,"role"?: Database["public"]['Enums']["agent_message_role"],"seq"?: never,"tool_call_id"?: string | null,"tool_calls"?: Json | null,"tool_result"?: Json | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "agent_messages_conversation_fkey"
      columns: ["conversation_id","host_id"]
isOneToOne: false
      referencedRelation: "agent_conversations"
      referencedColumns: ["id","host_id"]
    }
                  ]
                },"bank_alerts": {
                  Row: {
                    "amount": number,"bank": string,"created_at": string,"host_id": string,"id": string,"match_confidence": string | null,"match_reason": string | null,"payer_name": string | null,"proposed_friend_id": string | null,"proposed_payment_request_id": string | null,"raw_hash": string,"reason": string | null,"received_at": string,"reference": string | null,"sender": string | null,"status": Database["public"]['Enums']["bank_alert_status"],"subject": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"bank": string,"created_at"?: string,"host_id": string,"id"?: string,"match_confidence"?: string | null,"match_reason"?: string | null,"payer_name"?: string | null,"proposed_friend_id"?: string | null,"proposed_payment_request_id"?: string | null,"raw_hash": string,"reason"?: string | null,"received_at"?: string,"reference"?: string | null,"sender"?: string | null,"status"?: Database["public"]['Enums']["bank_alert_status"],"subject"?: string | null
                  }
                  Update: {
                    "amount"?: number,"bank"?: string,"created_at"?: string,"host_id"?: string,"id"?: string,"match_confidence"?: string | null,"match_reason"?: string | null,"payer_name"?: string | null,"proposed_friend_id"?: string | null,"proposed_payment_request_id"?: string | null,"raw_hash"?: string,"reason"?: string | null,"received_at"?: string,"reference"?: string | null,"sender"?: string | null,"status"?: Database["public"]['Enums']["bank_alert_status"],"subject"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "bank_alerts_proposed_friend_fkey"
      columns: ["proposed_friend_id","host_id"]
isOneToOne: false
      referencedRelation: "friend_balances"
      referencedColumns: ["friend_id","host_id"]
    },{
      foreignKeyName: "bank_alerts_proposed_friend_fkey"
      columns: ["proposed_friend_id","host_id"]
isOneToOne: false
      referencedRelation: "friends"
      referencedColumns: ["id","host_id"]
    },{
      foreignKeyName: "bank_alerts_proposed_payment_request_fkey"
      columns: ["proposed_payment_request_id","host_id"]
isOneToOne: false
      referencedRelation: "payment_requests"
      referencedColumns: ["id","host_id"]
    }
                  ]
                },"friends": {
                  Row: {
                    "archived": boolean,"created_at": string,"display_name": string,"host_id": string,"id": string,"known_bank_names": (string)[],"private_chat_started": boolean,"telegram_user_id": number | null,"telegram_username": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "archived"?: boolean,"created_at"?: string,"display_name": string,"host_id": string,"id"?: string,"known_bank_names"?: (string)[],"private_chat_started"?: boolean,"telegram_user_id"?: number | null,"telegram_username"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "archived"?: boolean,"created_at"?: string,"display_name"?: string,"host_id"?: string,"id"?: string,"known_bank_names"?: (string)[],"private_chat_started"?: boolean,"telegram_user_id"?: number | null,"telegram_username"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"inbound_email_routes": {
                  Row: {
                    "created_at": string,"host_id": string,"id": string,"revoked_at": string | null,"token": string
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"host_id": string,"id"?: string,"revoked_at"?: string | null,"token": string
                  }
                  Update: {
                    "created_at"?: string,"host_id"?: string,"id"?: string,"revoked_at"?: string | null,"token"?: string
                  }
                  Relationships: [
                    
                  ]
                },"ledger_events": {
                  Row: {
                    "amount": number,"bank_alert_id": string | null,"created_at": string,"created_by": Database["public"]['Enums']["actor_type"],"friend_id": string,"host_id": string,"id": string,"note": string | null,"payment_request_id": string | null,"receipt_id": string | null,"type": Database["public"]['Enums']["ledger_event_type"]
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"bank_alert_id"?: string | null,"created_at"?: string,"created_by"?: Database["public"]['Enums']["actor_type"],"friend_id": string,"host_id": string,"id"?: string,"note"?: string | null,"payment_request_id"?: string | null,"receipt_id"?: string | null,"type": Database["public"]['Enums']["ledger_event_type"]
                  }
                  Update: {
                    "amount"?: number,"bank_alert_id"?: string | null,"created_at"?: string,"created_by"?: Database["public"]['Enums']["actor_type"],"friend_id"?: string,"host_id"?: string,"id"?: string,"note"?: string | null,"payment_request_id"?: string | null,"receipt_id"?: string | null,"type"?: Database["public"]['Enums']["ledger_event_type"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "ledger_events_bank_alert_fkey"
      columns: ["bank_alert_id","host_id"]
isOneToOne: false
      referencedRelation: "bank_alerts"
      referencedColumns: ["id","host_id"]
    },{
      foreignKeyName: "ledger_events_friend_fkey"
      columns: ["friend_id","host_id"]
isOneToOne: false
      referencedRelation: "friend_balances"
      referencedColumns: ["friend_id","host_id"]
    },{
      foreignKeyName: "ledger_events_friend_fkey"
      columns: ["friend_id","host_id"]
isOneToOne: false
      referencedRelation: "friends"
      referencedColumns: ["id","host_id"]
    },{
      foreignKeyName: "ledger_events_payment_request_fkey"
      columns: ["payment_request_id","host_id"]
isOneToOne: false
      referencedRelation: "payment_requests"
      referencedColumns: ["id","host_id"]
    },{
      foreignKeyName: "ledger_events_receipt_fkey"
      columns: ["receipt_id","host_id"]
isOneToOne: false
      referencedRelation: "receipts"
      referencedColumns: ["id","host_id"]
    }
                  ]
                },"payment_claims": {
                  Row: {
                    "amount": number | null,"bank_alert_id": string | null,"claimed_at": string,"host_id": string,"id": string,"payment_request_id": string,"resolved_at": string | null,"source": Database["public"]['Enums']["payment_claim_source"],"status": Database["public"]['Enums']["payment_claim_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "amount"?: number | null,"bank_alert_id"?: string | null,"claimed_at"?: string,"host_id": string,"id"?: string,"payment_request_id": string,"resolved_at"?: string | null,"source": Database["public"]['Enums']["payment_claim_source"],"status"?: Database["public"]['Enums']["payment_claim_status"]
                  }
                  Update: {
                    "amount"?: number | null,"bank_alert_id"?: string | null,"claimed_at"?: string,"host_id"?: string,"id"?: string,"payment_request_id"?: string,"resolved_at"?: string | null,"source"?: Database["public"]['Enums']["payment_claim_source"],"status"?: Database["public"]['Enums']["payment_claim_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_claims_bank_alert_fkey"
      columns: ["bank_alert_id","host_id"]
isOneToOne: false
      referencedRelation: "bank_alerts"
      referencedColumns: ["id","host_id"]
    },{
      foreignKeyName: "payment_claims_request_fkey"
      columns: ["payment_request_id","host_id"]
isOneToOne: false
      referencedRelation: "payment_requests"
      referencedColumns: ["id","host_id"]
    }
                  ]
                },"payment_requests": {
                  Row: {
                    "amount": number,"cancelled_at": string | null,"created_at": string,"friend_id": string,"host_id": string,"id": string,"note": string | null,"paid_at": string | null,"receipt_id": string | null,"reference": string,"status": Database["public"]['Enums']["payment_request_status"]
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"cancelled_at"?: string | null,"created_at"?: string,"friend_id": string,"host_id": string,"id"?: string,"note"?: string | null,"paid_at"?: string | null,"receipt_id"?: string | null,"reference": string,"status"?: Database["public"]['Enums']["payment_request_status"]
                  }
                  Update: {
                    "amount"?: number,"cancelled_at"?: string | null,"created_at"?: string,"friend_id"?: string,"host_id"?: string,"id"?: string,"note"?: string | null,"paid_at"?: string | null,"receipt_id"?: string | null,"reference"?: string,"status"?: Database["public"]['Enums']["payment_request_status"]
                  }
                  Relationships: [
                    {
      foreignKeyName: "payment_requests_friend_fkey"
      columns: ["friend_id","host_id"]
isOneToOne: false
      referencedRelation: "friend_balances"
      referencedColumns: ["friend_id","host_id"]
    },{
      foreignKeyName: "payment_requests_friend_fkey"
      columns: ["friend_id","host_id"]
isOneToOne: false
      referencedRelation: "friends"
      referencedColumns: ["id","host_id"]
    },{
      foreignKeyName: "payment_requests_receipt_fkey"
      columns: ["receipt_id","host_id"]
isOneToOne: false
      referencedRelation: "receipts"
      referencedColumns: ["id","host_id"]
    }
                  ]
                },"profiles": {
                  Row: {
                    "auto_confirm_bank_alerts": boolean,"created_at": string,"display_name": string | null,"id": string,"paynow_display_name": string | null,"paynow_proxy_type": Database["public"]['Enums']["paynow_proxy_type"] | null,"paynow_proxy_value": string | null,"telegram_user_id": number | null,"telegram_username": string | null,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "auto_confirm_bank_alerts"?: boolean,"created_at"?: string,"display_name"?: string | null,"id": string,"paynow_display_name"?: string | null,"paynow_proxy_type"?: Database["public"]['Enums']["paynow_proxy_type"] | null,"paynow_proxy_value"?: string | null,"telegram_user_id"?: number | null,"telegram_username"?: string | null,"updated_at"?: string
                  }
                  Update: {
                    "auto_confirm_bank_alerts"?: boolean,"created_at"?: string,"display_name"?: string | null,"id"?: string,"paynow_display_name"?: string | null,"paynow_proxy_type"?: Database["public"]['Enums']["paynow_proxy_type"] | null,"paynow_proxy_value"?: string | null,"telegram_user_id"?: number | null,"telegram_username"?: string | null,"updated_at"?: string
                  }
                  Relationships: [
                    
                  ]
                },"receipt_shares": {
                  Row: {
                    "amount": number,"friend_id": string | null,"host_id": string,"id": string,"items_subtotal": number,"pays_nothing": boolean,"receipt_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "amount": number,"friend_id"?: string | null,"host_id": string,"id"?: string,"items_subtotal"?: number,"pays_nothing"?: boolean,"receipt_id": string
                  }
                  Update: {
                    "amount"?: number,"friend_id"?: string | null,"host_id"?: string,"id"?: string,"items_subtotal"?: number,"pays_nothing"?: boolean,"receipt_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "receipt_shares_friend_fkey"
      columns: ["friend_id","host_id"]
isOneToOne: false
      referencedRelation: "friend_balances"
      referencedColumns: ["friend_id","host_id"]
    },{
      foreignKeyName: "receipt_shares_friend_fkey"
      columns: ["friend_id","host_id"]
isOneToOne: false
      referencedRelation: "friends"
      referencedColumns: ["id","host_id"]
    },{
      foreignKeyName: "receipt_shares_receipt_fkey"
      columns: ["receipt_id","host_id"]
isOneToOne: false
      referencedRelation: "receipts"
      referencedColumns: ["id","host_id"]
    }
                  ]
                },"receipts": {
                  Row: {
                    "created_at": string,"gst": number,"gst_bps": number,"host_id": string,"id": string,"interpretation": Json | null,"occurred_at": string,"recurring_expense_id": string | null,"service_charge": number,"service_charge_bps": number,"source": Database["public"]['Enums']["receipt_source"],"split_input": NonNullable<Json>,"subtotal": number,"telegram_chat_id": number | null,"title": string,"total": number
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"gst": number,"gst_bps": number,"host_id": string,"id"?: string,"interpretation"?: Json | null,"occurred_at"?: string,"recurring_expense_id"?: string | null,"service_charge": number,"service_charge_bps": number,"source": Database["public"]['Enums']["receipt_source"],"split_input": NonNullable<Json>,"subtotal": number,"telegram_chat_id"?: number | null,"title": string,"total": number
                  }
                  Update: {
                    "created_at"?: string,"gst"?: number,"gst_bps"?: number,"host_id"?: string,"id"?: string,"interpretation"?: Json | null,"occurred_at"?: string,"recurring_expense_id"?: string | null,"service_charge"?: number,"service_charge_bps"?: number,"source"?: Database["public"]['Enums']["receipt_source"],"split_input"?: NonNullable<Json>,"subtotal"?: number,"telegram_chat_id"?: number | null,"title"?: string,"total"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "receipts_recurring_expense_fkey"
      columns: ["recurring_expense_id","host_id"]
isOneToOne: false
      referencedRelation: "recurring_expenses"
      referencedColumns: ["id","host_id"]
    },{
      foreignKeyName: "receipts_telegram_chat_fkey"
      columns: ["host_id","telegram_chat_id"]
isOneToOne: false
      referencedRelation: "telegram_chats"
      referencedColumns: ["host_id","telegram_chat_id"]
    }
                  ]
                },"recurring_expenses": {
                  Row: {
                    "active": boolean,"amount": number,"anchor_day": number,"cadence": Database["public"]['Enums']["recurring_cadence"],"created_at": string,"gst_bps": number,"host_id": string,"id": string,"next_run_at": string | null,"participants": NonNullable<Json>,"service_charge_bps": number,"telegram_chat_id": number | null,"title": string,"updated_at": string
                  }
                  ComputedFields: never
                  Insert: {
                    "active"?: boolean,"amount": number,"anchor_day": number,"cadence": Database["public"]['Enums']["recurring_cadence"],"created_at"?: string,"gst_bps"?: number,"host_id": string,"id"?: string,"next_run_at"?: string | null,"participants"?: NonNullable<Json>,"service_charge_bps"?: number,"telegram_chat_id"?: number | null,"title": string,"updated_at"?: string
                  }
                  Update: {
                    "active"?: boolean,"amount"?: number,"anchor_day"?: number,"cadence"?: Database["public"]['Enums']["recurring_cadence"],"created_at"?: string,"gst_bps"?: number,"host_id"?: string,"id"?: string,"next_run_at"?: string | null,"participants"?: NonNullable<Json>,"service_charge_bps"?: number,"telegram_chat_id"?: number | null,"title"?: string,"updated_at"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "recurring_expenses_telegram_chat_fkey"
      columns: ["host_id","telegram_chat_id"]
isOneToOne: false
      referencedRelation: "telegram_chats"
      referencedColumns: ["host_id","telegram_chat_id"]
    }
                  ]
                },"recurring_runs": {
                  Row: {
                    "host_id": string,"id": string,"period_key": string,"ran_at": string,"receipt_id": string | null,"recurring_expense_id": string
                  }
                  ComputedFields: never
                  Insert: {
                    "host_id": string,"id"?: string,"period_key": string,"ran_at"?: string,"receipt_id"?: string | null,"recurring_expense_id": string
                  }
                  Update: {
                    "host_id"?: string,"id"?: string,"period_key"?: string,"ran_at"?: string,"receipt_id"?: string | null,"recurring_expense_id"?: string
                  }
                  Relationships: [
                    {
      foreignKeyName: "recurring_runs_expense_fkey"
      columns: ["recurring_expense_id","host_id"]
isOneToOne: false
      referencedRelation: "recurring_expenses"
      referencedColumns: ["id","host_id"]
    },{
      foreignKeyName: "recurring_runs_receipt_fkey"
      columns: ["receipt_id","host_id"]
isOneToOne: false
      referencedRelation: "receipts"
      referencedColumns: ["id","host_id"]
    }
                  ]
                },"reminders": {
                  Row: {
                    "channel": Database["public"]['Enums']["reminder_channel"],"escalated_at": string | null,"host_id": string,"id": string,"last_sent_at": string | null,"next_at": string,"payment_request_id": string,"snoozed_until": string | null,"stage": number
                  }
                  ComputedFields: never
                  Insert: {
                    "channel"?: Database["public"]['Enums']["reminder_channel"],"escalated_at"?: string | null,"host_id": string,"id"?: string,"last_sent_at"?: string | null,"next_at": string,"payment_request_id": string,"snoozed_until"?: string | null,"stage"?: number
                  }
                  Update: {
                    "channel"?: Database["public"]['Enums']["reminder_channel"],"escalated_at"?: string | null,"host_id"?: string,"id"?: string,"last_sent_at"?: string | null,"next_at"?: string,"payment_request_id"?: string,"snoozed_until"?: string | null,"stage"?: number
                  }
                  Relationships: [
                    {
      foreignKeyName: "reminders_request_fkey"
      columns: ["payment_request_id","host_id"]
isOneToOne: false
      referencedRelation: "payment_requests"
      referencedColumns: ["id","host_id"]
    }
                  ]
                },"telegram_binding_requests": {
                  Row: {
                    "created_at": string,"friend_id": string,"host_id": string,"host_message_id": number | null,"id": string,"resolved_at": string | null,"source_chat_id": number | null,"status": Database["public"]['Enums']["telegram_binding_status"],"telegram_first_name": string | null,"telegram_user_id": number,"telegram_username": string | null,"via_private_chat": boolean
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"friend_id": string,"host_id": string,"host_message_id"?: number | null,"id"?: string,"resolved_at"?: string | null,"source_chat_id"?: number | null,"status"?: Database["public"]['Enums']["telegram_binding_status"],"telegram_first_name"?: string | null,"telegram_user_id": number,"telegram_username"?: string | null,"via_private_chat"?: boolean
                  }
                  Update: {
                    "created_at"?: string,"friend_id"?: string,"host_id"?: string,"host_message_id"?: number | null,"id"?: string,"resolved_at"?: string | null,"source_chat_id"?: number | null,"status"?: Database["public"]['Enums']["telegram_binding_status"],"telegram_first_name"?: string | null,"telegram_user_id"?: number,"telegram_username"?: string | null,"via_private_chat"?: boolean
                  }
                  Relationships: [
                    {
      foreignKeyName: "telegram_binding_requests_friend_fkey"
      columns: ["friend_id","host_id"]
isOneToOne: false
      referencedRelation: "friend_balances"
      referencedColumns: ["friend_id","host_id"]
    },{
      foreignKeyName: "telegram_binding_requests_friend_fkey"
      columns: ["friend_id","host_id"]
isOneToOne: false
      referencedRelation: "friends"
      referencedColumns: ["id","host_id"]
    }
                  ]
                },"telegram_chats": {
                  Row: {
                    "host_id": string,"id": string,"linked_at": string,"telegram_chat_id": number,"title": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "host_id": string,"id"?: string,"linked_at"?: string,"telegram_chat_id": number,"title"?: string | null
                  }
                  Update: {
                    "host_id"?: string,"id"?: string,"linked_at"?: string,"telegram_chat_id"?: number,"title"?: string | null
                  }
                  Relationships: [
                    
                  ]
                },"telegram_link_tokens": {
                  Row: {
                    "created_at": string,"expires_at": string,"host_id": string,"id": string,"kind": Database["public"]['Enums']["telegram_link_kind"],"receipt_id": string | null,"single_use": boolean,"token_hash": string,"used_at": string | null
                  }
                  ComputedFields: never
                  Insert: {
                    "created_at"?: string,"expires_at": string,"host_id": string,"id"?: string,"kind": Database["public"]['Enums']["telegram_link_kind"],"receipt_id"?: string | null,"single_use"?: boolean,"token_hash": string,"used_at"?: string | null
                  }
                  Update: {
                    "created_at"?: string,"expires_at"?: string,"host_id"?: string,"id"?: string,"kind"?: Database["public"]['Enums']["telegram_link_kind"],"receipt_id"?: string | null,"single_use"?: boolean,"token_hash"?: string,"used_at"?: string | null
                  }
                  Relationships: [
                    {
      foreignKeyName: "telegram_link_tokens_receipt_fkey"
      columns: ["receipt_id","host_id"]
isOneToOne: false
      referencedRelation: "receipts"
      referencedColumns: ["id","host_id"]
    }
                  ]
                }
          }
          Views: {
            "friend_balances": {
                  Row: {
                    "balance": number | null,"event_count": number | null,"friend_id": string,"host_id": string
                  }
                  ComputedFields: never
                  Relationships: [
                    
                  ]
                }
          }
          Functions: {
            "confirm_payment_claim":
{ Args: { "p_amount"?: number,"p_claim_id": string }; Returns: string
                           },
"friend_balance":
{ Args: { "p_friend_id": string,"p_host_id": string }; Returns: number
                           },
"ledger_signed_amount":
{ Args: { "amount": number,"event_type": Database["public"]['Enums']["ledger_event_type"] }; Returns: number
                           },
"reject_payment_claim":
{ Args: { "p_claim_id": string }; Returns: undefined
                           },
"run_recurring_expense":
{ Args: { "p_next_run_at": string,"p_period_key": string,"p_receipt": Json,"p_recurring_expense_id": string,"p_shares": Json }; Returns: string
                           },
"save_split":
{ Args: { "p_receipt": Json,"p_shares": Json }; Returns: string
                           }
          }
          Enums: {
            "actor_type": "host"|"system","agent_action_status": "pending"|"approved"|"rejected"|"executed"|"failed"|"expired","agent_message_role": "user"|"assistant"|"tool","bank_alert_status": "unmatched"|"proposed"|"confirmed"|"ignored","ledger_event_type": "expense_share"|"payment"|"credit"|"friend_fronted","payment_claim_source": "friend_button"|"bank_alert","payment_claim_status": "pending"|"confirmed"|"rejected","payment_request_status": "open"|"paid"|"cancelled","paynow_proxy_type": "mobile"|"uen","receipt_source": "manual"|"llm","recurring_cadence": "monthly"|"weekly","reminder_channel": "group"|"private","telegram_binding_status": "pending"|"approved"|"rejected","telegram_link_kind": "host"|"group"|"friend"
          }
          CompositeTypes: {
            [_ in never]: never
          }
        }
}

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
  ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
      Row: infer R
    }
    ? R
    : never
  : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Insert: infer I
    }
    ? I
    : never
  : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
  ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
      Update: infer U
    }
    ? U
    : never
  : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
  ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
  : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
  ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
  : never

export const Constants = {
  "graphql_public": {
          Enums: {
            
          }
        },"public": {
          Enums: {
            "actor_type": ["host", "system"],"agent_action_status": ["pending", "approved", "rejected", "executed", "failed", "expired"],"agent_message_role": ["user", "assistant", "tool"],"bank_alert_status": ["unmatched", "proposed", "confirmed", "ignored"],"ledger_event_type": ["expense_share", "payment", "credit", "friend_fronted"],"payment_claim_source": ["friend_button", "bank_alert"],"payment_claim_status": ["pending", "confirmed", "rejected"],"payment_request_status": ["open", "paid", "cancelled"],"paynow_proxy_type": ["mobile", "uen"],"receipt_source": ["manual", "llm"],"recurring_cadence": ["monthly", "weekly"],"reminder_channel": ["group", "private"],"telegram_binding_status": ["pending", "approved", "rejected"],"telegram_link_kind": ["host", "group", "friend"]
          }
        }
} as const
