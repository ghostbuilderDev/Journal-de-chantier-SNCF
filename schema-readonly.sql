-- Diagnostic de structure uniquement : aucune ligne applicative, aucun corps de fonction.
-- La transaction interdit les écritures ; le résultat JSON tient sur une seule ligne.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '20s';
SET LOCAL lock_timeout = '5s';
WITH scoped_tables AS (
  SELECT c.oid, n.nspname AS schema_name, c.relname AS table_name,
         c.relkind, c.relrowsecurity, c.relforcerowsecurity
  FROM pg_catalog.pg_class AS c
  JOIN pg_catalog.pg_namespace AS n ON n.oid = c.relnamespace
  WHERE c.relkind IN ('r', 'p')
    AND (n.nspname = 'public'
      OR (n.nspname = 'auth' AND c.relname = 'users')
      OR (n.nspname = 'storage' AND c.relname IN ('objects', 'buckets')))
), table_columns AS (
  SELECT t.schema_name, t.table_name, a.attnum AS position, a.attname AS column_name,
         pg_catalog.format_type(a.atttypid, a.atttypmod) AS data_type,
         a.attnotnull AS not_null, a.attidentity AS identity_kind,
         a.attgenerated AS generated_kind, a.atthasdef AS has_default
  FROM scoped_tables AS t
  JOIN pg_catalog.pg_attribute AS a ON a.attrelid = t.oid
  WHERE a.attnum > 0 AND NOT a.attisdropped
), check_constraints AS (
  SELECT t.schema_name, t.table_name, c.conname AS constraint_name,
         c.convalidated AS validated,
         pg_catalog.pg_get_constraintdef(c.oid, true) AS definition,
         ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
               ORDER BY k.ord) AS columns
  FROM pg_catalog.pg_constraint AS c
  JOIN scoped_tables AS t ON t.oid = c.conrelid
  WHERE c.contype = 'c'
), foreign_keys AS (
  SELECT sn.nspname AS source_schema, s.relname AS source_table, c.conname AS constraint_name,
         tn.nspname AS target_schema, t.relname AS target_table,
         ARRAY(SELECT a.attname FROM unnest(c.conkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.conrelid AND a.attnum = k.attnum
               ORDER BY k.ord) AS source_columns,
         ARRAY(SELECT a.attname FROM unnest(c.confkey) WITH ORDINALITY AS k(attnum, ord)
               JOIN pg_catalog.pg_attribute AS a ON a.attrelid = c.confrelid AND a.attnum = k.attnum
               ORDER BY k.ord) AS target_columns,
         c.confdeltype AS delete_action, c.confupdtype AS update_action,
         c.condeferrable AS deferrable, c.condeferred AS initially_deferred,
         c.convalidated AS validated,
         pg_catalog.pg_get_constraintdef(c.oid, true) AS definition
  FROM pg_catalog.pg_constraint AS c
  JOIN pg_catalog.pg_class AS s ON s.oid = c.conrelid
  JOIN pg_catalog.pg_namespace AS sn ON sn.oid = s.relnamespace
  JOIN pg_catalog.pg_class AS t ON t.oid = c.confrelid
  JOIN pg_catalog.pg_namespace AS tn ON tn.oid = t.relnamespace
  WHERE c.contype = 'f'
    AND (c.conrelid IN (SELECT oid FROM scoped_tables)
      OR c.confrelid IN (SELECT oid FROM scoped_tables))
), unique_indexes AS (
  SELECT t.schema_name, t.table_name, ic.relname AS index_name,
         i.indisprimary AS primary_key, i.indisvalid AS valid, i.indisready AS ready,
         pg_catalog.pg_get_indexdef(i.indexrelid, 0, true) AS definition
  FROM scoped_tables AS t
  JOIN pg_catalog.pg_index AS i ON i.indrelid = t.oid
  JOIN pg_catalog.pg_class AS ic ON ic.oid = i.indexrelid
  WHERE i.indisunique
), custom_triggers AS (
  SELECT t.schema_name, t.table_name, g.tgname AS trigger_name, g.tgenabled AS enabled,
         g.tgtype AS trigger_type_bits, g.tgnargs > 0 AS has_arguments,
         pn.nspname AS function_schema, p.proname AS function_name
  FROM scoped_tables AS t
  JOIN pg_catalog.pg_trigger AS g ON g.tgrelid = t.oid
  JOIN pg_catalog.pg_proc AS p ON p.oid = g.tgfoid
  JOIN pg_catalog.pg_namespace AS pn ON pn.oid = p.pronamespace
  -- Trigger arguments can hold webhook authorization headers: never export them.
  WHERE NOT g.tgisinternal
), rpc_signatures AS (
  SELECT n.nspname AS schema_name, p.proname AS function_name,
         pg_catalog.pg_get_function_identity_arguments(p.oid) AS identity_arguments,
         pg_catalog.pg_get_function_result(p.oid) AS result_type,
         p.prosecdef AS security_definer, p.provolatile AS volatility,
         p.prokind AS routine_kind, l.lanname AS language
  FROM pg_catalog.pg_proc AS p
  JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
  JOIN pg_catalog.pg_language AS l ON l.oid = p.prolang
  WHERE n.nspname = 'public' AND p.prokind IN ('f', 'p')
    AND (p.proname LIKE '%journal%' OR p.proname LIKE '%chantier%')
), enum_values AS (
  SELECT n.nspname AS schema_name, t.typname AS type_name,
         jsonb_agg(e.enumlabel ORDER BY e.enumsortorder) AS values
  FROM pg_catalog.pg_type AS t
  JOIN pg_catalog.pg_namespace AS n ON n.oid = t.typnamespace
  JOIN pg_catalog.pg_enum AS e ON e.enumtypid = t.oid
  WHERE t.oid IN (
    SELECT a.atttypid FROM scoped_tables AS s
    JOIN pg_catalog.pg_attribute AS a ON a.attrelid = s.oid
    WHERE a.attnum > 0 AND NOT a.attisdropped
  )
  GROUP BY n.nspname, t.typname
)
SELECT jsonb_build_object(
  'schema_version', 1,
  'transaction_read_only', current_setting('transaction_read_only'),
  'server_version', current_setting('server_version'),
  'tables', COALESCE((SELECT jsonb_agg(jsonb_build_object(
      'schema_name', schema_name, 'table_name', table_name,
      'kind', relkind, 'row_level_security', relrowsecurity,
      'force_row_level_security', relforcerowsecurity)
      ORDER BY schema_name, table_name) FROM scoped_tables), '[]'::jsonb),
  'columns', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY schema_name, table_name, position)
      FROM table_columns AS c), '[]'::jsonb),
  'constraints', COALESCE((SELECT jsonb_agg(item ORDER BY sort_schema, sort_table, sort_name)
      FROM (
        SELECT to_jsonb(c) || jsonb_build_object('constraint_type', 'check') AS item,
          schema_name AS sort_schema, table_name AS sort_table, constraint_name AS sort_name
        FROM check_constraints AS c
        UNION ALL
        SELECT to_jsonb(c) || jsonb_build_object('constraint_type', 'foreign_key'),
          source_schema, source_table, constraint_name
        FROM foreign_keys AS c
      ) AS all_constraints), '[]'::jsonb),
  'indexes', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY schema_name, table_name, index_name)
      FROM unique_indexes AS c), '[]'::jsonb),
  'triggers', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY schema_name, table_name, trigger_name)
      FROM custom_triggers AS c), '[]'::jsonb),
  'functions', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY schema_name, function_name, identity_arguments)
      FROM rpc_signatures AS c), '[]'::jsonb),
  'enum_values', COALESCE((SELECT jsonb_agg(to_jsonb(c) ORDER BY schema_name, type_name)
      FROM enum_values AS c), '[]'::jsonb)
)::text AS schema_diagnostic;
ROLLBACK;
