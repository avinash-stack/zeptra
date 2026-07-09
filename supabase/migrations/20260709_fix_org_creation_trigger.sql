-- Fix: Allow org_id assignment when user has NO org yet
-- Root cause: The prevent_unauthorized_user_updates trigger blocked ALL
-- org_id changes, including the initial assignment during create_organization.
-- This caused "Organization creation failed: Users cannot change their own
-- organization" for every new signup.

CREATE OR REPLACE FUNCTION public.prevent_unauthorized_user_updates()
RETURNS TRIGGER LANGUAGE plpgsql
SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF auth.uid() = NEW.id
     AND NOT (public.has_role(auth.uid(), 'admin')
              OR public.has_role(auth.uid(), 'hr')) THEN

    IF OLD.manager_id IS DISTINCT FROM NEW.manager_id THEN
      RAISE EXCEPTION 'Users cannot change their own manager';
    END IF;
    IF OLD.status IS DISTINCT FROM NEW.status THEN
      RAISE EXCEPTION 'Users cannot change their own status';
    END IF;
    IF OLD.is_active IS DISTINCT FROM NEW.is_active THEN
      RAISE EXCEPTION 'Users cannot change their own active status';
    END IF;

    -- Only block org_id change if user ALREADY has an org.
    -- New users (org_id IS NULL) are always allowed to set their org.
    IF OLD.org_id IS NOT NULL
       AND OLD.org_id IS DISTINCT FROM NEW.org_id THEN
      RAISE EXCEPTION 'Users cannot change their own organization';
    END IF;

  END IF;
  RETURN NEW;
END;
$$;
