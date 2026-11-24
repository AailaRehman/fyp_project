// Lists shared by the database model, the rules and the request checks, so they cannot drift apart.
export const GAZE_EVENT_TYPES = ["looking_away", "no_face", "multiple_faces"];

// What the browser can report as a rule break during an interview (Layer 1 anti-cheating).
export const VIOLATION_TYPES = ["tab_switch", "window_blur", "copy", "cut", "paste", "context_menu"];
// Which of them count towards the automatic submission. Right-click is blocked and logged, but people do it by habit,
// so it is a note and not a strike. Change this list to change the rule.
export const COUNTED_VIOLATION_TYPES = ["tab_switch", "window_blur", "copy", "cut", "paste"];
