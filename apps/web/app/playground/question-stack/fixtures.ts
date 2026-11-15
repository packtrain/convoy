export type DemoQuestion = {
  id: string;
  title: string;
  question: string;
  options: string[];
};

export const QUESTIONS: DemoQuestion[] = [
  { id: "color", title: "Color palette", question: "Which color should lead the new page?", options: ["Blue", "Warm orange", "Monochrome"] },
  { id: "animal", title: "Animal mascot", question: "Which animal should we use for the empty state?", options: ["Otter", "Fox", "Cat"] },
  { id: "tone", title: "Writing style", question: "How should the welcome message sound?", options: ["Friendly and casual", "Short and direct", "Calm and reassuring"] },
  { id: "layout", title: "Page layout", question: "What should people see first?", options: ["Recent work", "A quick-start checklist", "A blank canvas"] },
  { id: "theme", title: "Default theme", question: "Which theme should we start with?", options: ["Follow system", "Light", "Dark"] },
  { id: "density", title: "Content density", question: "How much information should each row show?", options: ["Compact", "Comfortable", "Detailed"] },
  { id: "invites", title: "Team invitations", question: "When should we suggest inviting teammates?", options: ["During setup", "After the first task", "Leave it to the user"] },
  { id: "notifications", title: "Notification preferences", question: "Which updates should be enabled initially?", options: ["Mentions only", "Mentions and assignments", "All activity"] },
];
