-- RETIRED: the previous single-user schema used unsafe permissive policies.
-- Deliberately fail closed; never use this file to initialize or upgrade a DB.
-- See README.md and sql/ for the reviewed existing-project migrations.
do $$ begin
  raise exception 'Retired insecure schema: use reviewed versioned migrations instead';
end $$;
