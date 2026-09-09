begin;

-- Inventory must retain ledger-only anomalies even if a FLOW payload cannot be
-- decoded. These read-only helpers never repair, rewrite or bless stored data.
create function partner_hub.inventory_json(payload text)
returns jsonb language plpgsql immutable set search_path = pg_catalog as $$
begin
  return payload::jsonb;
exception when data_exception then return '{}'::jsonb;
end;
$$;
create function partner_hub.inventory_unique_json(payload text)
returns boolean language plpgsql immutable set search_path = pg_catalog as $$
begin
  -- Check json BEFORE jsonb folding so duplicate keys cannot gain a proof.
  return coalesce(partner_hub.flow_json_unique_keys(payload::json), false);
exception when data_exception then return false;
end;
$$;
revoke all on function partner_hub.inventory_json(text), partner_hub.inventory_unique_json(text)
  from public, anon, authenticated;
grant execute on function partner_hub.inventory_json(text), partner_hub.inventory_unique_json(text)
  to service_role;

commit;
