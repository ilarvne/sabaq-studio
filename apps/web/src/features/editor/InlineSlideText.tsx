import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { EditorContent, useEditor } from '@tiptap/react';
import type { Editor as TipEditor, JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import TextAlign from '@tiptap/extension-text-align';
import {
  CheckIcon, LinkIcon, ListBulletsIcon, TextAlignCenterIcon, TextAlignLeftIcon,
  TextAlignRightIcon, TextBIcon, TextItalicIcon, TreeStructureIcon,
} from '@phosphor-icons/react';
import type { Slide } from '@sabaq/lesson/types';
import { slotDocument, type TextSlot } from '@sabaq/slide-renderer/canvas';
import { Button } from '@/components/shadcn/button';
import { Sheet, SheetClose, SheetHeader, SheetPopup, SheetTitle } from '@/components/coss/sheet';
import { Toolbar } from '@/components/coss/toolbar';
import { IconButton } from './EditorControls';
import type { EditorCopy } from './editorCopy';

export function ActiveSlot({
  slide,
  slot,
  c,
  onChange,
  onInstance,
  onEnd,
}: {
  slide: Slide;
  slot: TextSlot;
  c: EditorCopy;
  onChange: (doc: JSONContent) => void;
  onInstance: (editor: TipEditor | null) => void;
  onEnd: () => void;
}) {
  const change = useRef(onChange);
  const dismiss = useRef(onEnd);
  useLayoutEffect(() => {
    change.current = onChange;
    dismiss.current = onEnd;
  });
  const editor = useEditor(
    {
      extensions: [
        StarterKit.configure({
          link: { openOnClick: false, autolink: false },
          heading: false,
          codeBlock: false,
          code: false,
          blockquote: false,
          horizontalRule: false,
          strike: false,
          underline: false,
        }),
        TextAlign.configure({ types: ['paragraph'] }),
      ],
      content: slotDocument(slide, slot),
      autofocus: 'end',
      editorProps: {
        attributes: {
          'aria-label': slot === 'title' ? c.title : c.body,
          'aria-multiline': 'true',
          class: 'ed-live-text',
        },
        handleKeyDown: (_view, event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            dismiss.current();
            return true;
          }
          return false;
        },
      },
      onUpdate: ({ editor: instance }) => change.current(instance.getJSON()),
    },
    [slide.id, slot],
  );
  useEffect(() => {
    onInstance(editor);
    return () => onInstance(null);
  }, [editor, onInstance]);
  useEffect(() => {
    if (!editor || editor.isDestroyed || editor.view.composing) return;
    const content = slotDocument(slide, slot);
    if (JSON.stringify(content) !== JSON.stringify(editor.getJSON()))
      editor.commands.setContent(content, { emitUpdate: false });
  }, [editor, slide.richText, slide[slot], slot]);
  return (
    <div className="ed-slot" data-editing={slot}>
      <EditorContent editor={editor} />
    </div>
  );
}

export function ToolRow({
  editor,
  c,
  onEnd,
  onLink,
  diagram,
  assistant,
}: {
  diagram?: {label:string; selected:(text:string)=>void};
  assistant?: ReactNode;
  editor: TipEditor;
  c: EditorCopy;
  onEnd?: () => void;
  onLink: () => void;
}) {
  const [, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((value) => value + 1);
    editor.on('transaction', refresh);
    return () => {
      editor.off('transaction', refresh);
    };
  }, [editor]);
  return (
    <Toolbar
      className="ed-edit-tools"
      aria-label={c.editContent}
      onMouseDown={(e) => e.preventDefault()}
    >
      <IconButton
        toolbar
        label={c.bold}
        pressed={editor.isActive('bold')}
        onClick={() => {
          editor.chain().focus().toggleBold().run();
        }}
      >
        <TextBIcon />
      </IconButton>
      <IconButton
        toolbar
        label={c.italic}
        pressed={editor.isActive('italic')}
        onClick={() => {
          editor.chain().focus().toggleItalic().run();
        }}
      >
        <TextItalicIcon />
      </IconButton>
      <IconButton
        toolbar
        label={c.list}
        pressed={editor.isActive('bulletList')}
        onClick={() => {
          editor.chain().focus().toggleBulletList().run();
        }}
      >
        <ListBulletsIcon />
      </IconButton>
      <IconButton toolbar label={c.link} pressed={editor.isActive('link')} onClick={onLink}>
        <LinkIcon />
      </IconButton>
      <IconButton
        toolbar
        label={c.left}
        pressed={editor.isActive({ textAlign: 'left' }) || editor.isActive({ textAlign: null })}
        onClick={() => {
          editor.chain().focus().setTextAlign('left').run();
        }}
      >
        <TextAlignLeftIcon />
      </IconButton>
      <IconButton
        toolbar
        label={c.center}
        pressed={editor.isActive({ textAlign: 'center' })}
        onClick={() => {
          editor.chain().focus().setTextAlign('center').run();
        }}
      >
        <TextAlignCenterIcon />
      </IconButton>
      <IconButton
        toolbar
        label={c.right}
        pressed={editor.isActive({ textAlign: 'right' })}
        onClick={() => {
          editor.chain().focus().setTextAlign('right').run();
        }}
      >
        <TextAlignRightIcon />
      </IconButton>
      {diagram && <IconButton toolbar label={diagram.label} disabled={editor.state.selection.empty}
        onClick={()=>{
          const {from,to}=editor.state.selection;
          diagram.selected(editor.state.doc.textBetween(from,to,'\n','\n'));
        }}><TreeStructureIcon/></IconButton>}
      {assistant}
      {onEnd && <IconButton toolbar label={c.done} onClick={onEnd}><CheckIcon /></IconButton>}
    </Toolbar>
  );
}

export function TextSheet({ title, done, entry, onEnd, children }: {
  title: string;
  done: string;
  entry: RefObject<HTMLElement | null>;
  onEnd: () => void;
  children: ReactNode;
}) {
  const popup = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return;
    const update = () => {
      const inset = viewport.scale === 1
        ? Math.max(0, window.innerHeight - viewport.height - viewport.offsetTop)
        : 0;
      popup.current?.style.setProperty('--text-keyboard-inset', `${inset}px`);
    };
    update();
    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    return () => {
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
    };
  }, []);
  return (
    <Sheet defaultOpen onOpenChange={(open) => { if (!open) onEnd(); }}>
      <SheetPopup ref={popup} className="ed-text-sheet" side="bottom" showCloseButton={false}
        initialFocus={() => popup.current?.querySelector<HTMLElement>('[contenteditable="true"]') ?? false}
        finalFocus={entry}>
        <SheetHeader className="ed-text-sheet-heading">
          <SheetTitle>{title}</SheetTitle>
          <SheetClose render={<Button size="sm" />}>{done}</SheetClose>
        </SheetHeader>
        {children}
      </SheetPopup>
    </Sheet>
  );
}
