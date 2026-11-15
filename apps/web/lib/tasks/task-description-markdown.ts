import {
  MarkdownSerializer,
  defaultMarkdownSerializer,
} from "@tiptap/pm/markdown";
import type { Node as ProseMirrorNode } from "@tiptap/pm/model";

type NodeSerializers = ConstructorParameters<typeof MarkdownSerializer>[0];
type MarkSerializers = ConstructorParameters<typeof MarkdownSerializer>[1];

const defaultNodes = defaultMarkdownSerializer.nodes;
const defaultMarks = defaultMarkdownSerializer.marks;

// TODO(OS-967): Revisit this adapter once `@tiptap/markdown` is out of beta,
// provided task descriptions are still backed by Tiptap.
const nodeSerializers: NodeSerializers = {
  blockquote: defaultNodes.blockquote,
  codeBlock(state, node) {
    const backticks = node.textContent.match(/`{3,}/gm);
    const fence = backticks ? `${backticks.sort().slice(-1)[0]}\`` : "```";
    const language = typeof node.attrs.language === "string" ? node.attrs.language : "";

    state.write(`${fence}${language}\n`);
    state.text(node.textContent, false);
    state.write("\n");
    state.write(fence);
    state.closeBlock(node);
  },
  heading: defaultNodes.heading,
  bulletList: defaultNodes.bullet_list,
  orderedList: defaultNodes.ordered_list,
  listItem: defaultNodes.list_item,
  paragraph: defaultNodes.paragraph,
  image: defaultNodes.image,
  hardBreak: defaultNodes.hard_break,
  text: defaultNodes.text,
  taskList(state, node) {
    state.renderList(node, "  ", (index) => {
      const item = node.child(index);
      return item.attrs.checked ? "- [x] " : "- [ ] ";
    });
  },
  taskItem: defaultNodes.list_item,
};

const markSerializers: MarkSerializers = {
  bold: defaultMarks.strong,
  italic: defaultMarks.em,
  link: defaultMarks.link,
  code: defaultMarks.code,
  strike: { open: "~~", close: "~~", mixable: true, expelEnclosingWhitespace: true },
};

const taskDescriptionMarkdownSerializer = new MarkdownSerializer(
  nodeSerializers,
  markSerializers,
  {
    hardBreakNodeName: "hardBreak",
    strict: false,
  }
);

export function serializeTaskDescriptionDocAsMarkdown(doc: ProseMirrorNode) {
  return taskDescriptionMarkdownSerializer.serialize(doc, { tightLists: true }).trimEnd();
}
