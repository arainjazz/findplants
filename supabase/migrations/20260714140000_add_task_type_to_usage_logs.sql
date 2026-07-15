-- Add task_type column to ai_usage_logs for detailed statistics
-- Task types: quick_identify, enrich_draft, gold_page, chat

ALTER TABLE ai_usage_logs
ADD COLUMN IF NOT EXISTS task_type VARCHAR(50);

-- Add index for better query performance when grouping by task_type
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_task_type
ON ai_usage_logs(task_type);

-- Add index for combined model + task_type queries
CREATE INDEX IF NOT EXISTS idx_ai_usage_logs_model_task
ON ai_usage_logs(model, task_type);

COMMENT ON COLUMN ai_usage_logs.task_type IS 'Task type: quick_identify (快速识别), enrich_draft (银叶草稿), gold_page (金叶详页), chat (小P对话)';
