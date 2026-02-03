---
description: Automatically scaffold a new feature module (Frontend Page + Backend Service/Command)
---

1. [Input] Ask the user for the **Feature Name** (e.g., "Settings", "Profile") and a brief description of its purpose.
   // Stop here and wait for user input.

2. [Task] Create a new `task.md` or update the current one to track the scaffolding process.

3. [Frontend: Create Page]
   - Create a new file `src/pages/[Feature]Page.tsx`.
   - Add a basic functional component structure.
   - Example:
     ```tsx
     import React, { useState } from 'react';
     import { invoke } from "@tauri-apps/api/core";

     export function [Feature]Page() {
       const [status, setStatus] = useState("");

       const handleAction = async () => {
         try {
           const result = await invoke("run_[feature_lower]_cmd");
           setStatus(result as string);
         } catch (e) {
           console.error(e);
           setStatus("Error: " + e);
         }
       };

       return (
         <div className="container">
           <h2>[Feature]</h2>
           <button onClick={handleAction}>Run [Feature] Action</button>
           <p>Status: {status}</p>
         </div>
       );
     }
     ```

4. [Frontend: Register]
   - Edit `src/App.tsx`.
   - Update `type Tab`: Add `| "[feature_lower]"`.
   - Import the new page: `import { [Feature]Page } from "./pages/[Feature]Page";`.
   - Add a menu item to `menuItems` array:
     ```ts
     { id: "[feature_lower]", labelKey: "[feature_lower]", icon: <NewIcon /> },
     ```
     (Note: You might need to add a translation key to `src/i18n.ts` or just use a string for now, and create a simple Icon component).
   - Add the render block in the `content-area`:
     ```tsx
     <div style={{ display: activeTab === "[feature_lower]" ? "block" : "none" }}>
       <[Feature]Page />
     </div>
     ```

5. [Backend: Create Service]
   - Create `src-tauri/src/services/[feature_lower].rs`.
   - Define a simple struct and implementation.
   - Example:
     ```rust
     pub struct [Feature]Service;

     impl [Feature]Service {
         pub fn new() -> Self {
             Self {}
         }
         pub fn execute(&self) -> String {
             "Hello from [Feature] Service!".to_string()
         }
     }
     ```
   - Register the module in `src-tauri/src/services/mod.rs`: `pub mod [feature_lower];`.

6. [Backend: Create Command]
   - Create `src-tauri/src/commands/[feature_lower]_cmd.rs`.
   - Define the Tauri command.
   - Example:
     ```rust
     use crate::services::[feature_lower]::[Feature]Service;

     #[tauri::command]
     pub fn run_[feature_lower]_cmd() -> String {
         let service = [Feature]Service::new();
         service.execute()
     }
     ```
   - Register the module in `src-tauri/src/commands/mod.rs`: `pub mod [feature_lower]_cmd;`.

7. [Backend: Register Command]
   - Edit `src-tauri/src/main.rs`.
   - Add the command to the `tauri::generate_handler!` macro list:
     ```rust
     commands::[feature_lower]_cmd::run_[feature_lower]_cmd,
     ```

8. [Verification]
   - Compile the backend: `cargo check`.
   - (Optional) Run the app: `npm run tauri dev` (Note: This hangs, so maybe just check compilation).

9. [Notify] Inform the user that the scaffold is complete and ready for logic implementation.
