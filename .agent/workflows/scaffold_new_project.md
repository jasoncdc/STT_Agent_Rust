---
description: Transform a fresh Tauri project into the "Modular Architecture" (Pages/Services/Commands)
---

1. [Setup Directories]
   - Create directories:
     - `src/pages`
     - `src-tauri/src/services`
     - `src-tauri/src/commands`

2. [Frontend: Basic App Structure]
   - Overwrite `src/App.tsx` with the "Sidebar + Tab State" template.
   - Create `src/App.css` with basic sidebar/layout styles.
   - Create `src/pages/HomePage.tsx` as a default starting page.

3. [Backend: Module System]
   - Create `src-tauri/src/services/mod.rs` (Empty for now, just `// Services module`).
   - Create `src-tauri/src/commands/mod.rs` (Empty for now, just `// Commands module`).
   - Create `src-tauri/src/commands/app_cmd.rs` with a basic `greet` or `exit` command.
   - Update `src-tauri/src/lib.rs`:
     - Add `pub mod services;`
     - Add `pub mod commands;`
   - Update `src-tauri/src/main.rs`:
     - Register the `app_cmd` module.

4. [Inherit Workflows]
   - Create `.agent/workflows/` directory.
   - Create `.agent/workflows/scaffold_feature.md` (Copy the content from the standard scaffold feature workflow).

5. [Verification]
   - Run `cargo check` to ensure backend modules are wired correctly.
   - Check if `App.tsx` imports are valid.

6. [Completion]
   - Notify the user that the project has been converted to the Modular Architecture.
