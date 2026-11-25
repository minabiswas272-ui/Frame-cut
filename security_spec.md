# Firestore Security Specification — FrameCut Studio

## 1. Data Invariants
1. **Strict Ownership Isolation**: Every `/users/{userId}` document and every subcollection document `/users/{userId}/notes/{noteId}` belongs strictly to the authenticated, email-verified user whose `request.auth.uid == userId`. No user can read, list, create, update, or delete another user's workspace or notes.
2. **Master Gate Parent Existence**: Creating, reading, updating, or deleting a note in `/users/{userId}/notes/{noteId}` requires the parent `/users/{userId}` workspace document to exist and belong to `request.auth.uid`.
3. **Immutable Identity & Timestamps**: `ownerId` and `createdAt` cannot be modified after creation. `createdAt` on create and `updatedAt` on create/update must equal `request.time`.
4. **Strict Field Allowlist & Bounds**: Shadow/unknown fields are rejected via `hasOnly()` / `affectedKeys().hasOnly()`. All strings enforce explicit `.size()` upper bounds matching `firebase-blueprint.json`, and document IDs match `^[a-zA-Z0-9_\-]+$` with `<= 128` chars.
5. **Secure List Queries**: `allow list` on `/users/{userId}/notes` explicitly evaluates `resource.data.ownerId == request.auth.uid && userId == request.auth.uid`. Listing `/users` is completely denied.

## 2. The "Dirty Dozen" Adversarial Payloads
1. **Unauthenticated Workspace Read**: `GET /users/userA` with `auth == null` -> `PERMISSION_DENIED`.
2. **Cross-User Workspace Read**: `GET /users/userA` as `userB` -> `PERMISSION_DENIED`.
3. **Blanket Users List Scrape**: `LIST /users` as `userA` -> `PERMISSION_DENIED`.
4. **Unverified Email Write**: `CREATE /users/userA` with `email_verified: false` -> `PERMISSION_DENIED`.
5. **Identity Spoofing on Create**: `CREATE /users/userA` with `ownerId: "userB"` -> `PERMISSION_DENIED`.
6. **Shadow Field Injection**: `CREATE /users/userA` with extra field `isAdmin: true` -> `PERMISSION_DENIED`.
7. **Resource Poisoning (Oversized ID)**: `CREATE /users/userA/notes/<200-char-id>` -> `PERMISSION_DENIED`.
8. **Resource Poisoning (Oversized Content)**: `CREATE /users/userA/notes/n1` with 2,500-char `content` -> `PERMISSION_DENIED`.
9. **Client Timestamp Forgery**: `CREATE /users/userA/notes/n1` with backdated `createdAt` != `request.time` -> `PERMISSION_DENIED`.
10. **Immutable Field Tampering**: `UPDATE /users/userA/notes/n1` changing `ownerId` or `createdAt` -> `PERMISSION_DENIED`.
11. **Value Poisoning on Allowed Key**: `UPDATE /users/userA` setting `defaultFps: "invalid"` or `defaultFps: 999` -> `PERMISSION_DENIED`.
12. **Orphaned Subcollection Write**: `CREATE /users/userA/notes/n1` when parent `/users/userA` does not exist -> `PERMISSION_DENIED`.
