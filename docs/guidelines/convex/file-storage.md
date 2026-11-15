# Convex File Storage Guide

This document provides a comprehensive reference for implementing file uploads, storage, and serving in Convex applications.

## Official Documentation Links

- [File Storage Overview](https://docs.convex.dev/file-storage)
- [Upload Files](https://docs.convex.dev/file-storage/upload-files)
- [Store Files](https://docs.convex.dev/file-storage/store-files)
- [Serve Files](https://docs.convex.dev/file-storage/serve-files)
- [Delete Files](https://docs.convex.dev/file-storage/delete-files)
- [File Metadata](https://docs.convex.dev/file-storage/file-metadata)

---

## Overview

Convex File Storage enables:
- Uploading files from client applications
- Storing files from server-side code (actions, HTTP actions)
- Serving files to users via URLs or HTTP endpoints
- Managing file metadata and deletion

All file types are supported.

---

## Storage ID Type

Storage IDs reference entries in the `"_storage"` system table:

```typescript
import { v } from "convex/values";
import { Id } from "./_generated/dataModel";

// Type for storage IDs
type StorageId = Id<"_storage">;

// Validator for storage IDs in function args
args: {
  storageId: v.id("_storage"),
}
```

---

## 1. Uploading Files (Client to Convex)

### Method A: Upload URLs (Recommended for Large Files)

A three-step process that handles arbitrarily large files:

**Step 1: Create mutation to generate upload URL**

```typescript
// convex/files.ts
import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const generateUploadUrl = mutation({
  args: {},
  returns: v.string(),
  handler: async (ctx) => {
    // Optional: Add authentication check here
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    return await ctx.storage.generateUploadUrl();
  },
});
```

**Step 2: Create mutation to save storage ID**

```typescript
// convex/files.ts
export const saveFile = mutation({
  args: {
    storageId: v.id("_storage"),
    fileName: v.string(),
  },
  returns: v.id("files"),
  handler: async (ctx, args) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) {
      throw new Error("Not authenticated");
    }

    return await ctx.db.insert("files", {
      storageId: args.storageId,
      fileName: args.fileName,
      uploadedAt: Date.now(),
    });
  },
});
```

**Step 3: Client-side upload implementation**

```typescript
// React component
import { useMutation } from "convex/react";
import { api } from "../convex/_generated/api";

function FileUpload() {
  const generateUploadUrl = useMutation(api.files.generateUploadUrl);
  const saveFile = useMutation(api.files.saveFile);

  const handleUpload = async (file: File) => {
    // Step 1: Get upload URL
    const uploadUrl = await generateUploadUrl();

    // Step 2: POST file to upload URL
    const result = await fetch(uploadUrl, {
      method: "POST",
      headers: { "Content-Type": file.type },
      body: file,
    });

    if (!result.ok) {
      throw new Error(`Upload failed: ${result.statusText}`);
    }

    // Response contains the storage ID
    const { storageId } = await result.json();

    // Step 3: Save reference to database
    await saveFile({ storageId, fileName: file.name });
  };

  return (
    <input
      type="file"
      onChange={(e) => {
        const file = e.target.files?.[0];
        if (file) handleUpload(file);
      }}
    />
  );
}
```

**Important Constraints:**
- Upload URL expires in **1 hour** - generate it shortly before use
- Upload POST request has a **2 minute timeout**

### Method B: HTTP Actions (Single Request, Size-Limited)

For simpler workflows with smaller files (< 20MB):

```typescript
// convex/http.ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

const http = httpRouter();

http.route({
  path: "/upload",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    // Get file from request body
    const blob = await request.blob();

    // Store directly
    const storageId = await ctx.storage.store(blob);

    // Save to database via internal mutation
    await ctx.runMutation(internal.files.saveFileInternal, {
      storageId,
      contentType: request.headers.get("Content-Type") ?? "application/octet-stream",
    });

    return new Response(JSON.stringify({ storageId }), {
      headers: { "Content-Type": "application/json" },
    });
  }),
});

export default http;
```

**Limitation:** HTTP action request size is limited to **20MB**.

---

## 2. Storing Files (Server-Side)

For files fetched from external APIs or generated server-side:

```typescript
// convex/images.ts
import { action, internalMutation } from "./_generated/server";
import { internal } from "./_generated/api";
import { v } from "convex/values";

export const fetchAndStoreImage = action({
  args: { imageUrl: v.string() },
  returns: v.id("_storage"),
  handler: async (ctx, args) => {
    // Fetch from external source
    const response = await fetch(args.imageUrl);
    if (!response.ok) {
      throw new Error(`Failed to fetch image: ${response.statusText}`);
    }

    // Convert to blob
    const blob = await response.blob();

    // Store in Convex
    const storageId = await ctx.storage.store(blob);

    // Save reference to database
    await ctx.runMutation(internal.images.saveImage, {
      storageId,
      sourceUrl: args.imageUrl,
    });

    return storageId;
  },
});

export const saveImage = internalMutation({
  args: {
    storageId: v.id("_storage"),
    sourceUrl: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("images", {
      storageId: args.storageId,
      sourceUrl: args.sourceUrl,
      createdAt: Date.now(),
    });
    return null;
  },
});
```

---

## 3. Serving Files

### Method A: Generate URLs in Queries (Simple)

Best for straightforward file serving:

```typescript
// convex/files.ts
import { query } from "./_generated/server";
import { v } from "convex/values";

export const getFileUrl = query({
  args: { storageId: v.id("_storage") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    return await ctx.storage.getUrl(args.storageId);
  },
});

// Or return URLs with other data
export const listFiles = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("files"),
      fileName: v.string(),
      url: v.union(v.string(), v.null()),
    })
  ),
  handler: async (ctx) => {
    const files = await ctx.db.query("files").collect();

    return Promise.all(
      files.map(async (file) => ({
        _id: file._id,
        fileName: file.fileName,
        url: await ctx.storage.getUrl(file.storageId),
      }))
    );
  },
});
```

**Client usage:**

```tsx
import { useQuery } from "convex/react";
import { api } from "../convex/_generated/api";

function FileDisplay({ storageId }: { storageId: Id<"_storage"> }) {
  const url = useQuery(api.files.getFileUrl, { storageId });

  if (!url) return null;
  return <img src={url} alt="Uploaded file" />;
}
```

### Method B: HTTP Actions (Access Control at Serve Time)

For granular access control when files are served:

```typescript
// convex/http.ts
import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";

const http = httpRouter();

http.route({
  path: "/file",
  method: "GET",
  handler: httpAction(async (ctx, request) => {
    const url = new URL(request.url);
    const storageId = url.searchParams.get("id");

    if (!storageId) {
      return new Response("Missing storage ID", { status: 400 });
    }

    // Optional: Add access control checks here
    // const identity = await ctx.auth.getUserIdentity();
    // ... verify user has access to this file

    const blob = await ctx.storage.get(storageId as Id<"_storage">);

    if (!blob) {
      return new Response("File not found", { status: 404 });
    }

    return new Response(blob, {
      headers: {
        "Content-Type": blob.type,
      },
    });
  }),
});

export default http;
```

**Limitation:** HTTP action responses are limited to **20MB**.

---

## 4. Deleting Files

```typescript
// convex/files.ts
import { mutation } from "./_generated/server";
import { v } from "convex/values";

export const deleteFile = mutation({
  args: { storageId: v.id("_storage") },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Optional: Verify user has permission to delete

    // Delete the file from storage
    await ctx.storage.delete(args.storageId);

    // Also delete database references
    const fileDoc = await ctx.db
      .query("files")
      .withIndex("by_storageId", (q) => q.eq("storageId", args.storageId))
      .unique();

    if (fileDoc) {
      await ctx.db.delete(fileDoc._id);
    }

    return null;
  },
});
```

---

## 5. File Metadata

Metadata is stored in the `"_storage"` system table:

| Field | Type | Description |
|-------|------|-------------|
| `_id` | `Id<"_storage">` | Storage identifier |
| `_creationTime` | `number` | Timestamp when file was stored |
| `sha256` | `string` | Base16 encoded SHA256 checksum |
| `size` | `number` | File size in bytes |
| `contentType` | `string` | MIME type provided during upload |

### Querying Metadata

```typescript
// convex/files.ts
import { query } from "./_generated/server";
import { v } from "convex/values";

export const getFileMetadata = query({
  args: { storageId: v.id("_storage") },
  returns: v.union(
    v.object({
      _id: v.id("_storage"),
      _creationTime: v.number(),
      sha256: v.string(),
      size: v.number(),
      contentType: v.optional(v.string()),
    }),
    v.null()
  ),
  handler: async (ctx, args) => {
    return await ctx.db.system.get(args.storageId);
  },
});
```

---

## Schema Example

If you want to track files in your database:

```typescript
// convex/schema.ts
import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export default defineSchema({
  files: defineTable({
    storageId: v.id("_storage"),
    fileName: v.string(),
    uploadedBy: v.id("users"),
    uploadedAt: v.number(),
  })
    .index("by_storageId", ["storageId"])
    .index("by_uploadedBy", ["uploadedBy"]),

  // Example: Tasks with attachments
  tasks: defineTable({
    name: v.string(),
    attachmentId: v.optional(v.id("_storage")),
    // ... other fields
  }),
});
```

---

## Quick Reference

| Operation | Method | Context | Size Limit |
|-----------|--------|---------|------------|
| Generate upload URL | `ctx.storage.generateUploadUrl()` | Mutation | None (URL expires in 1hr) |
| Store file (server) | `ctx.storage.store(blob)` | Action, HTTP Action | - |
| Get file URL | `ctx.storage.getUrl(storageId)` | Query, Mutation, Action | - |
| Get file blob | `ctx.storage.get(storageId)` | Action, HTTP Action | - |
| Delete file | `ctx.storage.delete(storageId)` | Mutation, Action | - |
| Get metadata | `ctx.db.system.get(storageId)` | Query, Mutation | - |
| HTTP upload | `storage.store()` in HTTP action | HTTP Action | 20MB request |
| HTTP serve | `storage.get()` in HTTP action | HTTP Action | 20MB response |

---

## Best Practices

1. **Always validate storage IDs** using `v.id("_storage")`
2. **Add authentication checks** before generating upload URLs
3. **Store metadata in your database** (filename, uploader, etc.) alongside the storage ID
4. **Clean up storage** when deleting database records that reference files
5. **Use upload URLs for large files** to avoid the 20MB HTTP action limit
6. **Generate upload URLs shortly before use** (they expire in 1 hour)
7. **Handle upload errors gracefully** - POST has a 2-minute timeout
