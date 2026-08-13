# Microsoft To Do Integration & Synchronization

This document outlines the bidirectional synchronization setup with Microsoft To Do.

## Synchronization Architecture
- **Companion Plugin**: `obsidian-MicrosoftToDoLink` (`microsoft-todo-link`) handles OAuth2 Device Code Flow and Microsoft Graph API communication.
- **Central Sync Target**: `MicrosoftTodoTasks.md` (Vault root).
- **Fluent Tasks Data**: `TodoData/*.md` (Strictly isolated from central sync to prevent schema corruption).

## Core Safety Constraints
- **Central Sync Mode Only**: Do NOT bind `TodoData/*.md` directly to remote lists without an atomic bridge parser.
- **Soft Deletion (`complete`)**: Completed tasks are checked off rather than hard-deleted.
- **Safety Limits**: Max 10 remote deletions per sync; automatic abort on empty local files.

%% Waypoint %%

