export interface ThreadMessage {
    id: string;
    role: "user" | "assistant";
    content: string;
    createdAt: Date;
  }
  
  export type ThreadStatus = "pending" | "completed" | "streaming" | "awaiting_input" | "error";
  export type CliTool = "Claude Code" | "Codex" | "Droid" | "Amp";
  
export interface DemoThread {
  id: string;
  title?: string; // Optional title - falls back to first message
  messages: ThreadMessage[];
  status: ThreadStatus;
  cliTool: CliTool;
  isUnread: boolean; // true if user hasn't opened this thread yet
  branch?: string; // Optional git branch associated with this thread
  createdAt: Date;
  updatedAt: Date;
}

export const MOCK_THREADS: DemoThread[] = [
    {
      id: "thread-0",
      status: "pending",
      cliTool: "Claude Code",
      isUnread: true,
      branch: "feat/user-profile",
      createdAt: new Date("2026-02-04T08:00:00Z"),
      updatedAt: new Date("2026-02-04T08:00:00Z"),
      messages: [
        {
          id: "msg-0",
          role: "user",
          content: "How do I set up user profile editing?",
          createdAt: new Date("2026-02-04T08:00:00Z"),
        },
      ],
    },
    {
      id: "thread-1",
      status: "awaiting_input",
      cliTool: "Claude Code",
      isUnread: false,
      branch: "feat/task-prioritization",
      createdAt: new Date("2026-02-01T10:00:00Z"),
      updatedAt: new Date("2026-02-01T10:05:00Z"),
      messages: [
        {
          id: "msg-1",
          role: "user",
          content: "How should I prioritize my tasks for this sprint?",
          createdAt: new Date("2024-01-15T10:00:00Z"),
        },
        {
          id: "msg-2",
          role: "assistant",
          content:
            "I'd recommend using the Eisenhower Matrix to prioritize your tasks. Start by categorizing them into four quadrants:\n\n1. **Urgent & Important** - Do these first\n2. **Important but Not Urgent** - Schedule these\n3. **Urgent but Not Important** - Delegate if possible\n4. **Neither** - Consider dropping these\n\nWould you like me to help you categorize your current tasks?",
          createdAt: new Date("2024-01-15T10:01:00Z"),
        },
        {
          id: "msg-3",
          role: "user",
          content: "Yes, that would be helpful!",
          createdAt: new Date("2024-01-15T10:02:00Z"),
        },
        {
          id: "msg-4",
          role: "assistant",
          content:
            "Great! Please share your current task list and I'll help you categorize them. You can paste them here or describe what you're working on.",
          createdAt: new Date("2024-01-15T10:03:00Z"),
        },
      ],
    },
    {
      id: "thread-2",
      status: "completed",
      cliTool: "Droid",
      isUnread: true,
      createdAt: new Date("2024-01-14T14:00:00Z"),
      updatedAt: new Date("2024-01-14T14:10:00Z"),
      messages: [
        {
          id: "msg-5",
          role: "user",
          content: "Can you help me estimate the timeline for this feature?",
          createdAt: new Date("2024-01-14T14:00:00Z"),
        },
        {
          id: "msg-6",
          role: "assistant",
          content:
            "I'd be happy to help with timeline estimation! To give you an accurate estimate, I'll need some information:\n\n- What's the scope of the feature?\n- How many team members will be working on it?\n- Are there any dependencies on other teams or systems?\n- What's your team's typical velocity?",
          createdAt: new Date("2024-01-14T14:01:00Z"),
        },
      ],
    },
    {
      id: "thread-3",
      status: "streaming",
      cliTool: "Codex",
      isUnread: false,
      branch: "fix/settings-save-bug",
      createdAt: new Date("2024-01-13T09:00:00Z"),
      updatedAt: new Date("2024-01-13T09:15:00Z"),
      messages: [
        {
          id: "msg-7",
          role: "user",
          content:
            "There's a bug where users can't save their settings. Where should I start looking?",
          createdAt: new Date("2024-01-13T09:00:00Z"),
        },
        {
          id: "msg-8",
          role: "assistant",
          content:
            "Let's debug this systematically. Here's where I'd start:\n\n1. **Check the browser console** for any JavaScript errors\n2. **Inspect the network tab** to see if the save request is being sent and what response it gets\n3. **Review the server logs** for any errors around the time of the failed save\n4. **Check if it's reproducible** - does it happen for all users or specific ones?\n\nCan you tell me what you see in the network tab when trying to save?",
          createdAt: new Date("2024-01-13T09:02:00Z"),
        },
      ],
    },
    {
      id: "thread-4",
      status: "error",
      cliTool: "Amp",
      isUnread: true,
      createdAt: new Date("2024-01-12T15:30:00Z"),
      updatedAt: new Date("2024-01-12T15:35:00Z"),
      messages: [
        {
          id: "msg-9",
          role: "user",
          content: "Can you analyze this large dataset and provide insights?",
          createdAt: new Date("2024-01-12T15:30:00Z"),
        },
        {
          id: "msg-10",
          role: "assistant",
          content:
            "I encountered an error while processing the dataset. The file appears to be too large for the current context window. Please try:",
          createdAt: new Date("2024-01-12T15:32:00Z"),
        },
      ],
    },
    {
      id: "thread-5",
      status: "completed",
      cliTool: "Claude Code",
      isUnread: false,
      branch: "feat/nextauth-setup",
      createdAt: new Date("2024-01-11T11:00:00Z"),
      updatedAt: new Date("2024-01-11T11:15:00Z"),
      messages: [
        {
          id: "msg-11",
          role: "user",
          content: "How do I implement user authentication in Next.js?",
          createdAt: new Date("2024-01-11T11:00:00Z"),
        },
        {
          id: "msg-12",
          role: "assistant",
          content:
            "For Next.js authentication, I recommend using NextAuth.js. Here's a step-by-step guide to implement it:\n\n1. Install NextAuth: `npm install next-auth`\n2. Create the API route at `pages/api/auth/[...nextauth].js`\n3. Configure providers (Google, GitHub, credentials, etc.)\n4. Wrap your app with SessionProvider\n\nWould you like me to show you a complete example?",
          createdAt: new Date("2024-01-11T11:02:00Z"),
        },
      ],
    },
    {
      id: "thread-6",
      status: "completed",
      cliTool: "Droid",
      isUnread: false,
      createdAt: new Date("2024-01-10T16:00:00Z"),
      updatedAt: new Date("2024-01-10T16:20:00Z"),
      messages: [
        {
          id: "msg-13",
          role: "user",
          content: "What's the best way to optimize React component performance?",
          createdAt: new Date("2024-01-10T16:00:00Z"),
        },
        {
          id: "msg-14",
          role: "assistant",
          content:
            "Here are the key techniques for optimizing React performance:\n\n1. Use React.memo for pure components\n2. Implement useMemo for expensive calculations\n3. Use useCallback to prevent unnecessary re-renders\n4. Code splitting with React.lazy and Suspense\n5. Virtualize long lists with react-window\n6. Avoid inline object/function creation in JSX\n\nThe most important is to measure first using React DevTools Profiler before optimizing.",
          createdAt: new Date("2024-01-10T16:05:00Z"),
        },
      ],
    },
  ];
