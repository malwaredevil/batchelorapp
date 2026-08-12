import { useEffect, useRef, useState } from "react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import UnderlineExt from "@tiptap/extension-underline";
import Placeholder from "@tiptap/extension-placeholder";
import Highlight from "@tiptap/extension-highlight";
import TextAlign from "@tiptap/extension-text-align";
import LinkExt from "@tiptap/extension-link";
import ImageExt from "@tiptap/extension-image";
import {
  Bold,
  Italic,
  Underline,
  List,
  ListOrdered,
  Highlighter,
  AlignLeft,
  AlignCenter,
  AlignRight,
  Link as LinkIcon,
  Image as ImageIcon,
  Loader2,
} from "lucide-react";

function ToolBtn({
  active,
  onClick,
  title,
  children,
}: {
  active?: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`flex items-center justify-center w-7 h-7 rounded text-sm transition-colors
        ${
          active
            ? "bg-primary text-primary-foreground"
            : "text-muted-foreground hover:text-foreground hover:bg-muted"
        }`}
    >
      {children}
    </button>
  );
}

function Divider() {
  return <div className="w-px h-5 bg-border/60 mx-0.5" />;
}

/**
 * Shared rich text editor (bold, italic, underline, highlight, lists, align).
 * Content is plain TipTap HTML — no extra JSON wrapping. Kept in sync with
 * an externally-owned `value` string via a live `onChange` callback, so the
 * caller can include it in a larger form's save payload.
 */
export function RichTextEditor({
  value,
  onChange,
  placeholder = "Add notes…",
  autoFocus = false,
}: {
  value: string;
  onChange: (html: string) => void;
  placeholder?: string;
  autoFocus?: boolean;
}) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingImage, setUploadingImage] = useState(false);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: false,
        codeBlock: false,
        code: false,
        blockquote: false,
      }),
      UnderlineExt,
      Highlight.configure({ multicolor: false }),
      TextAlign.configure({ types: ["paragraph", "listItem"] }),
      Placeholder.configure({ placeholder }),
      LinkExt.configure({
        openOnClick: false,
        autolink: true,
        HTMLAttributes: { rel: "noopener noreferrer", target: "_blank" },
      }),
      ImageExt.configure({ HTMLAttributes: { class: "rounded-md" } }),
    ],
    content: value || "",
    autofocus: autoFocus ? "end" : false,
    onUpdate: ({ editor: ed }) => {
      const raw = ed.getHTML();
      onChange(raw === "<p></p>" ? "" : raw);
    },
  });

  // Keep the editor's content in sync when `value` changes from outside
  // (e.g. the dialog is reopened with a different record) — but never while
  // the user is actively typing in it.
  useEffect(() => {
    if (!editor) return;
    if (editor.isFocused) return;
    const current = editor.getHTML();
    const next = value || "";
    if (current === next || (current === "<p></p>" && next === "")) return;
    editor.commands.setContent(next, false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, editor]);

  const setLink = () => {
    if (!editor) return;
    const previous = editor.getAttributes("link").href as string | undefined;
    const url = window.prompt("Link URL", previous || "https://");
    if (url === null) return; // cancelled
    if (url.trim() === "") {
      editor.chain().focus().extendMarkRange("link").unsetLink().run();
      return;
    }
    editor.chain().focus().extendMarkRange("link").setLink({ href: url.trim() }).run();
  };

  const pickImage = () => fileInputRef.current?.click();

  const handleImageFile = async (file: File | undefined) => {
    if (!file || !editor) return;
    setUploadingImage(true);
    try {
      const form = new FormData();
      form.append("file", file);
      // raw-fetch-ok: shared cross-module image upload has no generated hook
      const res = await fetch("/api/rich-text/upload-image", {
        method: "POST",
        body: form,
        credentials: "include",
      });
      if (!res.ok) throw new Error(`Upload failed: ${res.status}`);
      const { url } = (await res.json()) as { url: string };
      editor.chain().focus().setImage({ src: url }).run();
    } catch {
      window.alert("Image upload failed. Please try again.");
    } finally {
      setUploadingImage(false);
    }
  };

  if (!editor) return null;

  return (
    <div className="tiptap-rich rounded-lg border border-input bg-background shadow-sm overflow-hidden">
      <input
        ref={fileInputRef}
        type="file"
        accept="image/jpeg,image/png,image/webp"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          void handleImageFile(file);
          e.target.value = "";
        }}
      />
      <div className="flex items-center gap-0.5 px-2 py-1.5 border-b border-border/50 bg-muted/30 flex-wrap">
        <ToolBtn
          title="Bold"
          active={editor.isActive("bold")}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          <Bold className="w-3.5 h-3.5" strokeWidth={2.5} />
        </ToolBtn>
        <ToolBtn
          title="Italic"
          active={editor.isActive("italic")}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          <Italic className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn
          title="Underline"
          active={editor.isActive("underline")}
          onClick={() => editor.chain().focus().toggleUnderline().run()}
        >
          <Underline className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn
          title="Highlight"
          active={editor.isActive("highlight")}
          onClick={() => editor.chain().focus().toggleHighlight().run()}
        >
          <Highlighter className="w-3.5 h-3.5" />
        </ToolBtn>

        <Divider />

        <ToolBtn
          title="Bullet list"
          active={editor.isActive("bulletList")}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <List className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn
          title="Numbered list"
          active={editor.isActive("orderedList")}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <ListOrdered className="w-3.5 h-3.5" />
        </ToolBtn>

        <Divider />

        <ToolBtn
          title="Align left"
          active={editor.isActive({ textAlign: "left" })}
          onClick={() => editor.chain().focus().setTextAlign("left").run()}
        >
          <AlignLeft className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn
          title="Align centre"
          active={editor.isActive({ textAlign: "center" })}
          onClick={() => editor.chain().focus().setTextAlign("center").run()}
        >
          <AlignCenter className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn
          title="Align right"
          active={editor.isActive({ textAlign: "right" })}
          onClick={() => editor.chain().focus().setTextAlign("right").run()}
        >
          <AlignRight className="w-3.5 h-3.5" />
        </ToolBtn>

        <Divider />

        <ToolBtn title="Add link" active={editor.isActive("link")} onClick={setLink}>
          <LinkIcon className="w-3.5 h-3.5" />
        </ToolBtn>
        <ToolBtn title="Insert image" onClick={pickImage}>
          {uploadingImage ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <ImageIcon className="w-3.5 h-3.5" />
          )}
        </ToolBtn>
      </div>

      <EditorContent editor={editor} />
    </div>
  );
}
