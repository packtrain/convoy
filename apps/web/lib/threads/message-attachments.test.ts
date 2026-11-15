import { expect, test } from "vitest";
import { dedupeAttachmentFileName, serializeAttachmentReference, splitAttachmentReferences } from "./message-attachments";

test.each([
  ["image.png", ["IMAGE.PNG", "image-2.png"], "image-3.png"],
  ["notes", ["notes"], "notes-2"],
  [".env", [".env"], ".env-2"],
  ["a.tar.gz", ["a.tar.gz"], "a.tar-2.gz"],
  ["image-2.png", ["image-2.png"], "image-2-2.png"],
  ["日本語.png", ["日本語.png"], "日本語-2.png"],
  ["Keep.PNG", [], "Keep.PNG"],
])("reserves %s without changing its extension or display casing", (name, existing, expected) => {
  expect(dedupeAttachmentFileName(name, new Set(existing))).toBe(expected);
});


test.each(['before shot.png', 'quote"name.png', 'back\\slash.png', '日本語 #1.png', 'image.png'])('matches serialized name %s without changing surrounding prose', (name) => {
  const token = serializeAttachmentReference(name);
  expect(splitAttachmentReferences(`See ${token}. Then (${token})`, [name])).toEqual([
    { type: "text", value: "See " }, { type: "attachment", filename: name },
    { type: "text", value: ". Then (" }, { type: "attachment", filename: name },
    { type: "text", value: ")" },
  ]);
});

test("leaves partial names, URL fragments, hashtags, and duplicates alone", () => {
  const text = 'https://example.com/#image.png #image.png.bak #unknown x#image.png';
  expect(splitAttachmentReferences(text, ['image.png'])).toEqual([{ type: "text", value: text }]);
  expect(splitAttachmentReferences('#image.png', ['image.png', 'IMAGE.PNG'])).toEqual([{ type: "text", value: '#image.png' }]);
});

test("prefers a complete longer filename over a shorter prefix", () => {
  expect(splitAttachmentReferences('#image.png.bak #image.png', ['image.png', 'image.png.bak'])).toEqual([
    { type: "attachment", filename: "image.png.bak" }, { type: "text", value: " " }, { type: "attachment", filename: "image.png" },
  ]);
});
