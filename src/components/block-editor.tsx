import { useEffect, useRef, useState } from "react";
import { zh } from "@blocknote/core/locales";
import { useCreateBlockNote } from "@blocknote/react";
import { BlockNoteView } from "@blocknote/mantine";
import "@blocknote/core/fonts/inter.css";
import "@blocknote/mantine/style.css";

export type BlockEditorProps = {
  /** Initial content as HTML (empty for a new document). */
  initialHTML?: string;
  /** Fires with the current content serialized to HTML on every edit. */
  onChange: (html: string) => void;
  /** Optional file uploader (returns a public URL) for inserted images/files. */
  uploadFile?: (file: File) => Promise<string>;
  placeholder?: string;
};

/**
 * Notion-style block editor (BlockNote). Content is stored as HTML so it renders
 * with the same markup the blog/plant pages already use. Client-only — BlockNote
 * touches the DOM, so we mount it after hydration to stay SSR-safe.
 */
export function BlockEditor(props: BlockEditorProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) {
    return (
      <div className="min-h-[320px] border border-rule rounded-lg bg-paper-deep/20 flex items-center justify-center text-sm text-ink-faint">
        编辑器载入中…
      </div>
    );
  }
  return <BlockEditorInner {...props} />;
}

function BlockEditorInner({ initialHTML, onChange, uploadFile, placeholder }: BlockEditorProps) {
  const editor = useCreateBlockNote({
    dictionary: zh,
    uploadFile,
  });
  const loaded = useRef(false);

  // Load the initial HTML into the editor exactly once.
  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    (async () => {
      const html = (initialHTML || "").trim();
      if (!html) return;
      try {
        const blocks = await editor.tryParseHTMLToBlocks(html);
        if (blocks.length) editor.replaceBlocks(editor.document, blocks);
      } catch {
        /* malformed HTML — start blank rather than crash */
      }
    })();
  }, [editor, initialHTML]);

  const emit = async () => {
    try {
      const html = await editor.blocksToFullHTML(editor.document);
      onChange(html);
    } catch {
      /* ignore transient serialization errors */
    }
  };

  return (
    <div className="block-editor border border-rule rounded-lg bg-background min-h-[320px] py-2">
      <BlockNoteView
        editor={editor}
        theme="light"
        onChange={emit}
        data-placeholder={placeholder}
      />
    </div>
  );
}
