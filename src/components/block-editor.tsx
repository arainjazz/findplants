import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
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
/** 命令式接口。给「插入 PDF」这种一次要塞进 N 个块的操作用 —— `uploadFile`
 *  只能返回一个 URL，装不下一份 PDF 转出来的几十页。 */
export type BlockEditorHandle = {
  /** 在文档末尾追加一批图片块。 */
  appendImages: (urls: string[]) => void;
};

export const BlockEditor = forwardRef<BlockEditorHandle, BlockEditorProps>(
  function BlockEditor(props, ref) {
    const [mounted, setMounted] = useState(false);
    useEffect(() => setMounted(true), []);
    if (!mounted) {
      return (
        <div className="min-h-[320px] border border-rule rounded-lg bg-paper-deep/20 flex items-center justify-center text-sm text-ink-faint">
          编辑器载入中…
        </div>
      );
    }
    return <BlockEditorInner {...props} handleRef={ref} />;
  },
);

function BlockEditorInner({
  initialHTML,
  onChange,
  uploadFile,
  placeholder,
  handleRef,
}: BlockEditorProps & { handleRef?: React.Ref<BlockEditorHandle> }) {
  const editor = useCreateBlockNote({
    dictionary: zh,
    uploadFile,
  });
  const loaded = useRef(false);

  useImperativeHandle(
    handleRef,
    () => ({
      appendImages: (urls: string[]) => {
        if (!urls.length) return;
        const doc = editor.document;
        const last = doc[doc.length - 1];
        const blocks = urls.map((url) => ({ type: "image" as const, props: { url } }));
        if (last) editor.insertBlocks(blocks, last, "after");
        else editor.replaceBlocks(doc, blocks);
      },
    }),
    [editor],
  );

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
