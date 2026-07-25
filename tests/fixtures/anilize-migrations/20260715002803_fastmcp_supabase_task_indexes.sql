CREATE INDEX idx_fastmcp_key_value_task_queue ON platform.fastmcp_key_value USING btree (collection, ((value ->> 'queue_name'::text)), ((value ->> 'status'::text)), ((value ->> 'execution_state'::text)), ((value ->> 'created_at'::text))) WHERE (collection = 'anilize-mcp:tasks:v1'::text);

CREATE INDEX idx_fastmcp_key_value_task_scope ON platform.fastmcp_key_value USING btree (collection, ((value ->> 'queue_name'::text)), ((value ->> 'task_scope'::text)), ((value ->> 'created_at'::text))) WHERE (collection = 'anilize-mcp:tasks:v1'::text);
