-- Preserve historical publications, but require complete documents for future writes.
alter table public.shared_configuration add constraint shared_configuration_required_fields check (
  (jsonb_typeof(document) = 'object'
   and document ?& array['schemaVersion','revision','publishedAt','catalog','templates','availabilityPolicy','replyTemplates']
   and jsonb_typeof(document->'schemaVersion') = 'number'
   and jsonb_typeof(document->'revision') = 'number'
   and jsonb_typeof(document->'publishedAt') = 'string'
   and jsonb_typeof(document->'catalog') = 'object'
   and jsonb_typeof(document->'templates') = 'object'
   and jsonb_typeof(document->'availabilityPolicy') = 'object'
   and jsonb_typeof(document->'replyTemplates') = 'array'
  ) is true
) not valid;
