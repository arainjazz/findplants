-- Realtime on plant_edits
ALTER TABLE public.plant_edits REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'plant_edits'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.plant_edits';
  END IF;
END $$;

-- Editor applications table
CREATE TYPE public.editor_application_status AS ENUM ('pending', 'approved', 'rejected');

CREATE TABLE public.editor_applications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  bio TEXT NOT NULL,
  status public.editor_application_status NOT NULL DEFAULT 'pending',
  reject_reason TEXT,
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_editor_applications_status ON public.editor_applications(status);
CREATE INDEX idx_editor_applications_user ON public.editor_applications(user_id);

ALTER TABLE public.editor_applications ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view their own application or admins all"
  ON public.editor_applications FOR SELECT
  USING (auth.uid() = user_id OR has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Users can insert their own application"
  ON public.editor_applications FOR INSERT
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users update own pending or admin updates any"
  ON public.editor_applications FOR UPDATE
  USING ((auth.uid() = user_id AND status = 'pending') OR has_role(auth.uid(), 'admin'::app_role));

CREATE TRIGGER trg_editor_applications_updated_at
  BEFORE UPDATE ON public.editor_applications
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();

ALTER TABLE public.editor_applications REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime' AND tablename = 'editor_applications'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.editor_applications';
  END IF;
END $$;

-- Helper: approved editor (admin OR editor)
CREATE OR REPLACE FUNCTION public.is_approved_editor(_user_id UUID)
RETURNS BOOLEAN
LANGUAGE SQL STABLE SECURITY DEFINER SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = _user_id AND role IN ('admin'::app_role, 'editor'::app_role)
  )
$$;