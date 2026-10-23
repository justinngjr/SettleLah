-- Trigger functions are never called through PostgREST, yet /rest/v1/rpc
-- exposes every function the API roles may execute (Supabase's security
-- advisor flags the SECURITY DEFINER ones). Only the table owner needs to
-- fire a trigger, so drop EXECUTE from the API roles. The earlier blanket
-- `revoke ... from public, anon` left `authenticated` with the default grant
-- on the trigger functions created before and after it.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.ledger_events_immutable() from public, anon, authenticated;
revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.payment_claims_default_amount() from public, anon, authenticated;
