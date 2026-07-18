-- Purpose: lock down remotely callable public helper functions and default grants.
-- Preconditions: executed by the application database owner or a role allowed to adjust grants.
-- Compatibility: additive/revocation-only; no data or objects are dropped.
-- Recovery: restore only explicitly required grants through a reviewed forward migration.

REVOKE ALL ON FUNCTION public.auto_enable_rls() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.auto_enable_rls() FROM anon;
REVOKE ALL ON FUNCTION public.auto_enable_rls() FROM authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
