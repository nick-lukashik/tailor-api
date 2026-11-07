-- Demo rows for the skeleton of Tailor: what tailor-web shows until the pipeline
-- creates real applications. A later migration deletes them by these ids.
INSERT INTO "applications" ("id", "company", "role", "vacancy_url", "vacancy_text", "status", "created_at") VALUES
	('019a5f00-0000-7000-8000-000000000001', 'Example Labs', 'Senior Full-stack Engineer', 'https://example.com/jobs/1', 'Demo vacancy: TypeScript, React, Node.js.', 'sent', '2026-11-05T10:00:00.000Z'),
	('019a5f00-0000-7000-8000-000000000002', 'Demo Systems', 'AI Product Engineer', 'https://example.com/jobs/2', 'Demo vacancy: LLM features, product work.', 'interview', '2026-11-06T10:00:00.000Z'),
	('019a5f00-0000-7000-8000-000000000003', 'Sample Cloud', 'Backend Engineer', NULL, 'Demo vacancy: NestJS, PostgreSQL.', 'new', '2026-11-07T10:00:00.000Z')
ON CONFLICT ("id") DO NOTHING;
